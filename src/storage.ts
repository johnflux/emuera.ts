import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EraError } from "./model.js";
import type { GlobalData } from "./variables.js";

export interface GlobalStore {
  load(): GlobalData | null;
  save(data: GlobalData): void;
}
export class MemoryGlobalStore implements GlobalStore {
  private data: GlobalData | null = null;
  load(): GlobalData | null { return structuredClone(this.data); }
  save(data: GlobalData): void { this.data = structuredClone(data); }
}
export class FileGlobalStore implements GlobalStore {
  constructor(private file: string) {}
  load(): GlobalData | null {
    let source: string;
    try { source = readFileSync(this.file, "utf8"); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw new EraError(`Cannot load global data: ${error instanceof Error ? error.message : String(error)}`);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(source); }
    catch (error) { throw new EraError(`Invalid global data JSON: ${error instanceof Error ? error.message : String(error)}`); }
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== 1 || !("variables" in parsed))
      throw new EraError("Unsupported global data format");
    const variables = parsed.variables;
    if (!variables || typeof variables !== "object" || Array.isArray(variables)) throw new EraError("Invalid global variable data");
    const result: GlobalData = Object.create(null);
    for (const [name, entries] of Object.entries(variables)) {
      if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new EraError(`Invalid global variable: ${name}`);
      const values: Record<string, string> = Object.create(null);
      for (const [index, value] of Object.entries(entries)) {
        if (typeof value !== "string") throw new EraError(`Invalid global value: ${name}:${index}`);
        values[index] = value;
      }
      result[name] = values;
    }
    return result;
  }
  save(data: GlobalData): void {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    let created = false;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(temporary, JSON.stringify({ version: 1, variables: data }), { mode: 0o600, flag: "wx" });
      created = true;
      renameSync(temporary, this.file);
      created = false;
    } catch (error) {
      throw new EraError(`Cannot save global data: ${error instanceof Error ? error.message : String(error)}`);
    } finally { if (created) unlinkSync(temporary); }
  }
}

/** Named save files (SAVEDATA slots, SAVECHARA files and SAVETEXT texts), stored as opaque text. */
export interface SaveStore {
  read(name: string): string | null;
  write(name: string, data: string): void;
  remove(name: string): void;
  /** Names of all stored files. */
  list(): string[];
}
function checkSaveName(name: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.startsWith(".")) throw new EraError(`Invalid save file name: ${name}`);
  return name;
}
export class MemorySaveStore implements SaveStore {
  private files = new Map<string, string>();
  read(name: string): string | null { return this.files.get(checkSaveName(name)) ?? null; }
  write(name: string, data: string): void { this.files.set(checkSaveName(name), data); }
  remove(name: string): void { this.files.delete(checkSaveName(name)); }
  list(): string[] { return [...this.files.keys()]; }
}
export class FileSaveStore implements SaveStore {
  constructor(private directory: string) {}
  read(name: string): string | null {
    try { return readFileSync(path.join(this.directory, checkSaveName(name)), "utf8"); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw new EraError(`Cannot read save file ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  write(name: string, data: string): void {
    const file = path.join(this.directory, checkSaveName(name));
    const temporary = `${file}.${randomUUID()}.tmp`;
    let created = false;
    try {
      mkdirSync(this.directory, { recursive: true });
      writeFileSync(temporary, data, { mode: 0o600, flag: "wx" });
      created = true;
      renameSync(temporary, file);
      created = false;
    } catch (error) {
      throw new EraError(`Cannot write save file ${name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally { if (created) unlinkSync(temporary); }
  }
  remove(name: string): void {
    try { unlinkSync(path.join(this.directory, checkSaveName(name))); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw new EraError(`Cannot delete save file ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  list(): string[] {
    try { return readdirSync(this.directory).filter((name) => !name.endsWith(".tmp") && /^[A-Za-z0-9_.-]+$/.test(name) && !name.startsWith(".")); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw new EraError(`Cannot list save files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Wraps the stores so writes can be held back: while staging, writes are kept in memory (and seen by reads) until
 * commit() passes them on, or discard() drops them. Runtime.prefetch uses this so running ahead of a
 * click-to-continue only persists anything once the player actually continues.
 */
export class StagedStores {
  private files: Map<string, string | null> | null = null;
  private global: GlobalData | undefined;
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
      load: () => this.global ? structuredClone(this.global) : innerStore.load(),
      save: (data) => {
        if (this.files) this.global = structuredClone(data);
        else innerStore.save(data);
      },
    };
  }
  get staging(): boolean { return this.files !== null; }
  stage(): void { this.files ??= new Map(); }
  commit(): void {
    const files = this.files, global = this.global;
    this.discard();
    for (const [name, data] of files ?? []) {
      if (data === null) this.innerSaves.remove(name);
      else this.innerSaves.write(name, data);
    }
    if (global) this.innerStore.save(global);
  }
  discard(): void {
    this.files = null;
    this.global = undefined;
  }
}
