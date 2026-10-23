import { conditionalEnd, quotedEnd } from "./strings.js";

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
const keyCache = new Map<string, string>();
export function key(name: string): string {
  const cached = keyCache.get(name);
  if (cached !== undefined) return cached;
  const normalized = name.normalize("NFC").toUpperCase();
  if (name.length <= 256) {
    if (keyCache.size >= 65_536) keyCache.delete(keyCache.keys().next().value!);
    keyCache.set(name, normalized);
  }
  return normalized;
}
export function integer(value: Value): bigint {
  if (typeof value !== "bigint") throw new EraError("Expected an integer, received a string");
  return value;
}
export function text(value: Value): string {
  if (typeof value !== "string") throw new EraError("Expected a string, received an integer");
  return value;
}
export const INTEGER_LITERAL = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+)(?:([pPeE])([+-]?\d+))?/;
export function integerLiteral(source: string): bigint {
  const match = INTEGER_LITERAL.exec(source);
  if (!match || match[0] !== source) throw new EraError(`Invalid integer literal: ${source}`);
  let value = BigInt(match[1]!);
  if (match[2]) {
    const exponent = Number(match[3]);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 63) throw new EraError(`Integer exponent out of range: ${source}`);
    const scale = (match[2].toLowerCase() === "p" ? 2n : 10n) ** BigInt(Math.abs(exponent));
    value = exponent < 0 ? value / scale : value * scale;
  }
  return value;
}
export function stripComment(line: string): string {
  if (/^\s*(?:PRINT(?:FORM)?[LW]?|PRINTPLAIN(?:FORM)?|DATA(?:FORM)?)(?:\s|$)/i.test(line)) return line.trimStart();
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (line.startsWith("\\@", i)) { i = conditionalEnd(line, i) - 1; continue; }
    if (c === '"' || line.startsWith('@"', i)) { i = quotedEnd(line, i) - 1; continue; }
    if (c === ";") return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}
export function splitArguments(input: string): string[] {
  const parts: string[] = [];
  let start = 0, depth = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (input.startsWith("\\@", i)) {
      const end = conditionalEnd(input, i);
      if (end > input.length) throw new EraError("Unclosed FORM conditional in argument list");
      i = end - 1;
      continue;
    }
    if (c === '"' || input.startsWith('@"', i)) {
      const end = quotedEnd(input, i);
      if (end > input.length) throw new EraError("Unbalanced argument list");
      i = end - 1;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { parts.push(input.slice(start, i).trim()); start = i + 1; }
  }
  if (depth !== 0) throw new EraError("Unbalanced argument list");
  parts.push(input.slice(start).trim());
  return parts;
}
