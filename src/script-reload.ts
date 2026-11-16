import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { applyHotpatches, gameDirectory, loadGame, type Game } from "./loader.js";
import { checkSyntax } from "./syntax-check.js";
import { EraError, type Diagnostic, type Routine } from "./model.js";

type ReloadEvent = {
  revision: number; time: string; status: "reloaded" | "error"; durationMs: number;
  files: string[]; routines: string[]; errors: Diagnostic[];
};
const diagnosticKey = (diagnostic: Diagnostic) => JSON.stringify(diagnostic);

/** Watches only script inputs; never writes game files or persistent state. */
export class ScriptReload {
  private files = new Map<string, string>();
  private watchers: FSWatcher[] = [];
  private timer: NodeJS.Timeout | undefined;
  private scanning: Promise<void> | undefined;
  private events: ReloadEvent[] = [];
  private revision = 0;
  private reloading = false;
  private closed = false;
  readonly ready: Promise<void>;

  constructor(
    private game: Game,
    private hotpatch: string | undefined,
    private targets: () => Game[],
    private apply: (previous: Game, next: Game) => void,
  ) {
    this.ready = this.initialize();
  }
  private roots(): string[] {
    return [gameDirectory(this.game.root, "ERB"), ...(this.hotpatch ? [this.hotpatch] : [])];
  }
  private async manifest(): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (entry.isFile() && /\.(erb|erh)$/i.test(file))
          files.set(file, createHash("sha256").update(await readFile(file)).digest("hex"));
      }
    };
    for (const root of this.roots()) await walk(root);
    return files;
  }
  private record(status: ReloadEvent["status"], files: string[], routines: string[], errors: Diagnostic[], durationMs = 0): void {
    this.events.push({ revision: ++this.revision, time: new Date().toISOString(), status, durationMs, files, routines, errors });
    if (this.events.length > 100) this.events.shift();
    if (status === "error") console.error("Script reload failed:", errors);
    else console.log(`Reloaded ${files.length} script files (${routines.length} routines) in ${durationMs}ms`);
  }
  private failure(error: unknown, files: string[] = [], durationMs = 0): void {
    this.record("error", files, [], [error instanceof EraError ? error.diagnostic()
      : { file: this.game.root, line: 0, message: error instanceof Error ? error.message : String(error) }], durationMs);
  }
  private async initialize(): Promise<void> {
    try {
      this.files = await this.manifest();
      if (this.closed) return;
      for (const root of this.roots()) {
        const watcher = watch(root, { recursive: true }, (_event, file) => {
          if (!file || /\.(erb|erh)$/i.test(file) || !path.extname(file)) this.schedule();
        });
        watcher.on("error", error => this.failure(error));
        this.watchers.push(watcher);
      }
    } catch (error) { this.failure(error); }
  }
  private schedule(): void {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.scan(); }, 250);
  }
  async scan(): Promise<void> {
    await this.ready;
    if (this.closed) return;
    if (this.scanning) {
      await this.scanning;
      return this.scan();
    }
    this.scanning = this.reload();
    try { await this.scanning; }
    finally { this.scanning = undefined; }
  }
  private async reload(): Promise<void> {
    const started = performance.now();
    const duration = () => Math.round(performance.now() - started);
    let changed: string[] = [];
    try {
      const files = await this.manifest();
      changed = [...new Set([...files.keys(), ...this.files.keys()])].filter(file => files.get(file) !== this.files.get(file)).sort();
      if (!changed.length) return;
      this.files = files;
      this.reloading = true;
      const targets = [...new Set([this.game, ...this.targets()])];
      const replacements: { previous: Game; next: Game }[] = [];
      const errors: Diagnostic[] = [];
      const routines = new Set<string>();
      for (const previous of targets) {
        const next = await loadGame(this.game.root, { debug: !!previous.debug });
        if (this.hotpatch) await applyHotpatches(next, this.hotpatch);
        const oldRoutines = new Set<Routine>(), newRoutines = new Set<Routine>();
        for (const name of new Set([...previous.routines.keys(), ...next.routines.keys()])) {
          const before = previous.routines.get(name), after = next.routines.get(name);
          if (JSON.stringify(before) === JSON.stringify(after) && after && before) next.routines.set(name, before);
          else {
            routines.add(name);
            before?.forEach(routine => oldRoutines.add(routine));
            after?.forEach(routine => newRoutines.add(routine));
          }
        }
        const headersChanged = JSON.stringify(previous.headers) !== JSON.stringify(next.headers)
          || JSON.stringify([...previous.macros]) !== JSON.stringify([...next.macros]);
        const baseline = new Set((await checkSyntax(previous, headersChanged ? undefined : oldRoutines)).diagnostics.map(diagnosticKey));
        const report = await checkSyntax(next, headersChanged ? undefined : newRoutines);
        errors.push(...report.diagnostics.filter(diagnostic => !baseline.has(diagnosticKey(diagnostic))));
        replacements.push({ previous, next });
      }
      if (this.closed) return;
      if (errors.length) { this.record("error", changed, [], [...new Map(errors.map(error => [diagnosticKey(error), error])).values()], duration()); return; }
      for (const { previous, next } of replacements) this.apply(previous, next);
      this.record("reloaded", changed, [...routines].sort(), [], duration());
    } catch (error) { this.failure(error, changed, duration()); }
    finally { this.reloading = false; }
  }
  status(since: number) {
    return {
      revision: this.revision, reloading: this.reloading, watching: this.watchers.length > 0, roots: this.roots(),
      truncated: since < (this.events[0]?.revision ?? 1) - 1,
      events: this.events.filter(event => event.revision > since),
      last: this.events.at(-1) ?? null,
    };
  }
  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }
}
