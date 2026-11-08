import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EraError } from "./model.js";
import type { GlobalData } from "./variables.js";
import { readNativeSave, writeNativeSave, type SaveMetadata } from "./save-format.js";
import { configSetting } from "./config-items.js";

function savePath(directory: string, name: string): string {
  const exact = path.join(directory, name);
  try { statSync(exact); return exact; }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return caseInsensitiveSavePath(directory, name);
}
function caseInsensitiveSavePath(directory: string, name: string): string {
  try {
    const entries = readdirSync(directory);
    const found = entries.includes(name) ? name : entries.find((entry) => entry.toUpperCase() === name.toUpperCase());
    return path.join(directory, found ?? name);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return path.join(directory, name);
    throw error;
  }
}
export function gameSaveDirectory(root: string, config: ReadonlyMap<string, string>): string {
  return /^(YES|TRUE|1)$/i.test(configSetting(config, "UseSaveFolder") ?? "") ? caseInsensitiveSavePath(root, "sav") : root;
}

export interface GlobalStore {
  load(code?: string): GlobalData | null;
  save(data: GlobalData, metadata?: SaveMetadata): void;
}
export class MemoryGlobalStore implements GlobalStore {
  private data: GlobalData | null = null;
  load(): GlobalData | null { return structuredClone(this.data); }
  save(data: GlobalData): void { this.data = structuredClone(data); }
}
export class FileGlobalStore implements GlobalStore {
  constructor(private file: string) {}
  load(code?: string): GlobalData | null {
    let source: Buffer;
    try { source = readFileSync(savePath(path.dirname(this.file), path.basename(this.file))); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw new EraError(`Cannot load global data: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const record = readNativeSave(source);
      if (record.type !== 1) throw new EraError("Expected Emuera global save");
      if (code !== undefined && record.code !== "0" && record.code !== code)
        throw new EraError("Global data belongs to another game");
      return record.data.variables;
    } catch (error) { throw new EraError(`Invalid global data: ${error instanceof Error ? error.message : String(error)}`); }
  }
  save(data: GlobalData, metadata?: SaveMetadata): void {
    if (!metadata) throw new EraError("Global save metadata is required");
    const bytes = writeNativeSave({
      type: 1, code: metadata.code, gameVersion: metadata.gameVersion, text: "",
      data: { characters: 0, variables: data }, characters: [], containers: { maps: {}, xmls: {}, dts: {} },
    }, metadata);
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    let created = false;
    try {
      const file = savePath(path.dirname(this.file), path.basename(this.file));
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
      created = true;
      renameSync(temporary, file);
      created = false;
    } catch (error) {
      throw new EraError(`Cannot save global data: ${error instanceof Error ? error.message : String(error)}`);
    } finally { if (created) unlinkSync(temporary); }
  }
}

/** Native binary saves and plain text files in the game's save directory. */
export interface SaveStore {
  /** In-process game-save write generation, when the store supports it. */
  readonly revision?: number;
  read(name: string): string | Buffer | null;
  write(name: string, data: string | Buffer): void;
  remove(name: string): void;
  /** Names of all stored files. */
  list(): string[];
  /** Modification time in epoch milliseconds, or null when the file is missing. */
  modified(name: string): number | null;
}
export const MIDDAY_FILE = "midday.erasuspend";
function isGameSave(name: string): boolean { return /^save\d+\.sav$/i.test(name) || name.toLowerCase() === MIDDAY_FILE; }
export function latestGameSave(store: SaveStore, midday: boolean): { name: string; kind: "native" | "midday"; modified: number } | null {
  let newest: ReturnType<typeof latestGameSave> = null;
  for (const name of store.list().filter((name) => /^save\d+\.sav$/i.test(name)).sort()) {
    const modified = store.modified(name);
    if (modified !== null && (!newest || modified > newest.modified)) newest = { name, kind: "native", modified };
  }
  const modified = midday ? store.modified(MIDDAY_FILE) : null;
  if (modified !== null && (!newest || modified > newest.modified)) return { name: MIDDAY_FILE, kind: "midday", modified };
  return newest;
}
function validSaveName(name: string): boolean {
  return !!name && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !name.startsWith(".") && !/[. ]$/.test(name);
}
function checkSaveName(name: string): string {
  if (!validSaveName(name)) throw new EraError(`Invalid save file name: ${name}`);
  return name;
}
export class MemorySaveStore implements SaveStore {
  revision = 0;
  private files = new Map<string, string | Buffer>();
  private modifiedTimes = new Map<string, number>();
  read(name: string): string | Buffer | null { return this.files.get(checkSaveName(name)) ?? null; }
  write(name: string, data: string | Buffer): void {
    this.files.set(checkSaveName(name), data);
    this.modifiedTimes.set(name, Date.now());
    if (isGameSave(name)) this.revision++;
  }
  remove(name: string): void {
    this.files.delete(checkSaveName(name));
    this.modifiedTimes.delete(name);
    if (isGameSave(name)) this.revision++;
  }
  list(): string[] { return [...this.files.keys()]; }
  modified(name: string): number | null { return this.modifiedTimes.get(checkSaveName(name)) ?? null; }
}
export interface PreparedSaveWrite { file: string; temporary: string }
export class FileSaveStore implements SaveStore {
  revision = 0;
  constructor(private directory: string, private characterDirectory = directory) {}
  private directoryFor(name: string): string {
    return /^chara_.*\.dat$/i.test(name) ? this.characterDirectory : this.directory;
  }
  read(name: string): string | Buffer | null {
    try {
      const bytes = readFileSync(savePath(this.directoryFor(name), checkSaveName(name)));
      return /\.(sav|dat|png|erasuspend)$/i.test(name) ? bytes : bytes.toString("utf8");
    }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw new EraError(`Cannot read save file ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  modified(name: string): number | null {
    try { return statSync(savePath(this.directoryFor(name), checkSaveName(name))).mtimeMs; }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw new EraError(`Cannot inspect save file ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  backgroundDirectory(name: string): string { return this.directoryFor(checkSaveName(name)); }
  prepareWrite(name: string, data: string | Buffer): PreparedSaveWrite {
    const directory = this.directoryFor(name);
    const temporary = `${path.join(directory, checkSaveName(name))}.${randomUUID()}.tmp`;
    let created = false;
    try {
      const file = savePath(directory, name);
      mkdirSync(directory, { recursive: true });
      const fd = openSync(temporary, "wx", 0o600);
      created = true;
      try { writeFileSync(fd, data); } finally { closeSync(fd); }
      created = false;
      return { file, temporary };
    } catch (error) {
      throw new EraError(`Cannot write save file ${name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally { if (created) unlinkSync(temporary); }
  }
  commitWrite(prepared: PreparedSaveWrite): void {
    try {
      renameSync(prepared.temporary, prepared.file);
      if (isGameSave(path.basename(prepared.file))) this.revision++;
    }
    catch (error) {
      throw new EraError(`Cannot commit save file ${path.basename(prepared.file)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  discardWrite(prepared: PreparedSaveWrite): void { unlinkSync(prepared.temporary); }
  write(name: string, data: string | Buffer): void {
    const prepared = this.prepareWrite(name, data);
    try { this.commitWrite(prepared); }
    catch (error) { this.discardWrite(prepared); throw error; }
  }
  remove(name: string): void {
    try {
      unlinkSync(savePath(this.directoryFor(name), checkSaveName(name)));
      if (isGameSave(name)) this.revision++;
    }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw new EraError(`Cannot delete save file ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  list(): string[] {
    const names: string[] = [];
    for (const directory of new Set([this.directory, this.characterDirectory])) {
      try {
        names.push(...readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isFile() && !entry.name.endsWith(".tmp") && validSaveName(entry.name)
            && this.directoryFor(entry.name) === directory).map((entry) => entry.name));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
        throw new EraError(`Cannot list save files: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return names;
  }
}

/**
 * Wraps the stores so writes can be held back: while staging, writes are kept in memory (and seen by reads) until
 * commit() passes them on, or discard() drops them. Runtime.prefetch uses this so running ahead of a
 * click-to-continue only persists anything once the player actually continues.
 */
export class StagedStores {
  private files: Map<string, string | Buffer | null> | null = null;
  private global: GlobalData | undefined;
  private globalMetadata: SaveMetadata | undefined;
  readonly saves: SaveStore;
  readonly store: GlobalStore;
  constructor(private readonly innerSaves: SaveStore, private readonly innerStore: GlobalStore) {
    this.saves = {
      read: (name) => {
        const file = this.files?.get(checkSaveName(name));
        return file !== undefined ? file : innerSaves.read(name);
      },
      write: (name, data) => {
        if (this.files) this.files.set(checkSaveName(name), data);
        else innerSaves.write(name, data);
      },
      remove: (name) => {
        if (this.files) this.files.set(checkSaveName(name), null);
        else innerSaves.remove(name);
      },
      list: () => {
        const names = new Set(innerSaves.list());
        for (const [name, data] of this.files ?? []) {
          if (data === null) names.delete(name);
          else names.add(name);
        }
        return [...names];
      },
      modified: (name) => {
        const staged = this.files?.get(checkSaveName(name));
        return staged === null ? null : staged !== undefined ? Date.now() : innerSaves.modified(name);
      },
    };
    this.store = {
      load: (code) => this.global ? structuredClone(this.global) : innerStore.load(code),
      save: (data, metadata) => {
        if (this.files) { this.global = structuredClone(data); this.globalMetadata = metadata; }
        else innerStore.save(data, metadata);
      },
    };
  }
  get staging(): boolean { return this.files !== null; }
  stage(): void { this.files ??= new Map(); }
  commit(): void {
    const files = this.files, global = this.global, metadata = this.globalMetadata;
    this.discard();
    for (const [name, data] of files ?? []) {
      if (data === null) this.innerSaves.remove(name);
      else this.innerSaves.write(name, data);
    }
    if (global) this.innerStore.save(global, metadata);
  }
  discard(): void {
    this.files = null;
    this.global = undefined;
    this.globalMetadata = undefined;
  }
}
