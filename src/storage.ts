import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EraError } from "./model.js";
import type { GlobalData } from "./variables.js";
import { readNativeSave, writeNativeSave, type SaveMetadata } from "./save-format.js";
import { configSetting } from "./config-items.js";

function savePath(directory: string, name: string): string {
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
  return /^(YES|TRUE|1)$/i.test(configSetting(config, "UseSaveFolder") ?? "") ? savePath(root, "sav") : root;
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
  read(name: string): string | Buffer | null;
  write(name: string, data: string | Buffer): void;
  remove(name: string): void;
  /** Names of all stored files. */
  list(): string[];
}
function validSaveName(name: string): boolean {
  return !!name && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !name.startsWith(".") && !/[. ]$/.test(name);
}
function checkSaveName(name: string): string {
  if (!validSaveName(name)) throw new EraError(`Invalid save file name: ${name}`);
  return name;
}
export class MemorySaveStore implements SaveStore {
  private files = new Map<string, string | Buffer>();
  read(name: string): string | Buffer | null { return this.files.get(checkSaveName(name)) ?? null; }
  write(name: string, data: string | Buffer): void { this.files.set(checkSaveName(name), data); }
  remove(name: string): void { this.files.delete(checkSaveName(name)); }
  list(): string[] { return [...this.files.keys()]; }
}
export class FileSaveStore implements SaveStore {
  constructor(private directory: string, private characterDirectory = directory) {}
  private directoryFor(name: string): string {
    return /^chara_.*\.dat$/i.test(name) ? this.characterDirectory : this.directory;
  }
  read(name: string): string | Buffer | null {
    try {
      const bytes = readFileSync(savePath(this.directoryFor(name), checkSaveName(name)));
      return /\.(sav|dat|png)$/i.test(name) ? bytes : bytes.toString("utf8");
    }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw new EraError(`Cannot read save file ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  write(name: string, data: string | Buffer): void {
    const directory = this.directoryFor(name);
    const temporary = `${path.join(directory, checkSaveName(name))}.${randomUUID()}.tmp`;
    let created = false;
    try {
      const file = savePath(directory, name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(temporary, data, { mode: 0o600, flag: "wx" });
      created = true;
      renameSync(temporary, file);
      created = false;
    } catch (error) {
      throw new EraError(`Cannot write save file ${name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally { if (created) unlinkSync(temporary); }
  }
  remove(name: string): void {
    try { unlinkSync(savePath(this.directoryFor(name), checkSaveName(name))); }
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
