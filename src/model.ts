export type Value = bigint | string;
export interface Source { file: string; line: number }
export interface Line extends Source { text: string }
export interface Routine extends Source {
  name: string;
  parameters: string[];
  lines: Line[];
  directives: Line[];
}
export interface Diagnostic extends Source { message: string }
export class EraError extends Error {
  constructor(message: string, public source?: Source) {
    super(message);
    this.name = "EraError";
  }
  diagnostic(): Diagnostic {
    return { file: this.source?.file ?? "<runtime>", line: this.source?.line ?? 0, message: this.message };
  }
}
export const key = (name: string): string => name.normalize("NFC").toUpperCase();
export function integer(value: Value): bigint {
  if (typeof value !== "bigint") throw new EraError("Expected an integer, received a string");
  return value;
}
export function text(value: Value): string {
  if (typeof value !== "string") throw new EraError("Expected a string, received an integer");
  return value;
}
export function stripComment(line: string): string {
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\" && quoted) { escaped = true; continue; }
    if (c === '"') quoted = !quoted;
    if (c === ";" && !quoted) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}
export function splitArguments(input: string): string[] {
  const parts: string[] = [];
  let start = 0, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\" && quoted) { escaped = true; continue; }
    if (c === '"') quoted = !quoted;
    if (!quoted) {
      if (c === "(") depth++;
      if (c === ")") depth--;
      if (c === "," && depth === 0) { parts.push(input.slice(start, i).trim()); start = i + 1; }
    }
  }
  if (quoted || depth !== 0) throw new EraError("Unbalanced argument list");
  parts.push(input.slice(start).trim());
  return parts;
}
