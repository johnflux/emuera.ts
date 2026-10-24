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
