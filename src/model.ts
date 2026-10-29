import { conditionalEnd, quotedEnd } from "./strings.js";

export type Value = bigint | string;
export interface Source { file: string; line: number }
export interface Line extends Source {
  text: string;
  /** Assignment text before comment stripping; string assignments treat semicolons as data. */
  assignmentText?: string;
}
export interface Routine extends Source {
  name: string;
  /** The label as written, for GETDOINGFUNCTION. */
  label?: string;
  parameters: string[];
  lines: Line[];
  directives: Line[];
}
export interface ExecutionContext {
  game: string;
  gameVersion: string;
  server?: { game: string; session: string; step: number; action: string };
  debug: boolean;
  jit: boolean;
  action: string;
  instruction?: string;
  routines: string[];
  instructions: number;
  instructionLimit: number;
  outputCharacters: number;
  outputLimit: number;
  outputEvents: number;
  deferredEvents: number;
  lastLoadedSlot: string;
}
export interface Diagnostic extends Source { message: string; trace?: string[]; context?: ExecutionContext }
export class EraError extends Error {
  /** Calling lines, innermost caller first, recorded as the error unwinds. */
  trace: Source[] = [];
  context?: ExecutionContext;
  constructor(message: string, public source?: Source) {
    super(message);
    this.name = "EraError";
  }
  diagnostic(): Diagnostic {
    return { file: this.source?.file ?? "<runtime>", line: this.source?.line ?? 0, message: this.message, ...(this.trace.length ? { trace: this.trace.map((source) => `${source.file}:${source.line}`) } : {}), ...(this.context ? { context: this.context } : {}) };
  }
}
const keyCache = new Map<string, string>();
export function key(name: string): string {
  const cached = keyCache.get(name);
  if (cached !== undefined) return cached;
  const normalized = name.normalize("NFC").toUpperCase();
  if (name.length <= 256) {
    // Clear wholesale: evicting the oldest entry one by one makes V8 rescan deleted slots on every miss.
    if (keyCache.size >= 65_536) keyCache.clear();
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
/**
 * Emuera's ISNUMERIC/TOINT parsing: a digit (or sign then digit), an integer literal
 * (0x/0b prefixes and p/e exponents included) and an optional ".digits" tail.
 * ISNUMERIC rejects signed/empty exponents; TOINT accepts signed exponents but
 * reports an empty exponent as an error. Overflow is an error in either mode.
 */
export function numericString(source: string, mode: "check" | "convert" = "check"): bigint | undefined {
  if (/[^\x00-\x7f]/.test(source)) return undefined;
  if (/^0[bB]\d*[2-9]/.test(source)) throw new EraError("Binary notation contains illegal characters");
  if (/^0[xX]-/.test(source)) throw new EraError("Hexadecimal notation cannot contain a minus sign");
  const match = /^(?:0[xX]([0-9a-fA-F]*)(?:[pP]([0-9a-fA-F]*))?|0[bB]([01]*)(?:[pPeE]([01]*))?|([+-]?\d+)(?:[pPeE]([+-]?\d*))?)(?:\.\d*)?$/.exec(source);
  if (!match) return undefined;
  const [, hex, hexExponent, binary, binaryExponent, decimal, decimalExponent] = match;
  const [digits, base, exponentDigits, exponentBase] = hex !== undefined ? [hex, 16, hexExponent, 2]
    : binary !== undefined ? [binary, 2, binaryExponent, /[eE]/.test(source) ? 10 : 2] : [decimal!, 10, decimalExponent, /[eE]/.test(source) ? 10 : 2];
  if (!digits) return undefined;
  if (exponentDigits !== undefined && !/^\d/.test(exponentDigits)) {
    if (mode === "check") return undefined;
    if (!/^[+-]\d+$/.test(exponentDigits)) throw new EraError(`"${source}" cannot be converted to an integer value`);
  }
  const minimum = -(1n << 63n), maximum = (1n << 63n) - 1n;
  const overflow = (): never => { throw new EraError(`"${source}" is outside the 64-bit integer range`); };
  const parse = (value: string | undefined, radix: number): bigint => {
    if (value === undefined) return 0n;
    const parsed = radix === 10 ? BigInt(value) : BigInt((radix === 16 ? "0x" : "0b") + value);
    if (parsed < minimum || parsed > (radix === 10 ? maximum : (1n << 64n) - 1n)) overflow();
    return BigInt.asIntN(64, parsed);
  };
  let value = parse(digits, base);
  const exponent = parse(exponentDigits, base);
  if (value === 0n) return 0n;
  if (exponent < 0n) {
    if (exponent < -63n) return 0n;
    value /= BigInt(exponentBase) ** -exponent;
  } else if (exponent > 0n) {
    if (exponent > 63n) overflow();
    value *= BigInt(exponentBase) ** exponent;
  }
  if (value < minimum || value > maximum) overflow();
  return value;
}
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
// Instructions whose argument is raw text: ';' and further spaces are output.
/** Emuera's event functions: the only names that may be defined repeatedly (all definitions run; see Runtime.dispatch). */
/** Character CSV keys (Emuera matches them case-insensitively) and the variables they fill; 番号/NO is the number. */
export const CHARACTER_FIELDS: ReadonlyMap<string, string> = new Map([
  ["名前", "NAME"], ["呼び名", "CALLNAME"], ["あだ名", "NICKNAME"], ["主人の呼び方", "MASTERNAME"],
  ["基礎", "MAXBASE"], ["能力", "ABL"], ["素質", "TALENT"], ["経験", "EXP"], ["フラグ", "CFLAG"],
  ["相性", "RELATION"], ["刻印", "MARK"], ["装着物", "EQUIP"], ["珠", "JUEL"],
  ...["NAME", "CALLNAME", "NICKNAME", "MASTERNAME", "ABL", "TALENT", "EXP", "CFLAG", "RELATION", "MARK", "EQUIP", "JUEL", "CSTR"].map((name) => [name, name] as const),
  ["BASE", "MAXBASE"],
]);
export const characterField = (name: string | undefined): string | undefined => name === undefined ? undefined : CHARACTER_FIELDS.get(name.toUpperCase());
export const isCharacterNumberField = (name: string | undefined): boolean => name === "番号" || name?.toUpperCase() === "NO";
export const EVENT_FUNCTIONS: ReadonlySet<string> = new Set(["EVENTFIRST", "EVENTTRAIN", "EVENTSHOP", "EVENTBUY", "EVENTCOM", "EVENTTURNEND", "EVENTCOMEND", "EVENTEND", "EVENTLOAD"]);
export const LITERAL_TEXT_INSTRUCTION = /^(?:(?:DEBUG)?PRINT(?:SINGLE)?(?:FORM)?(?:C|LC)?[KD]?[LW]?|PRINTPLAIN(?:FORM)?|DATA(?:FORM)?|PUTFORM|RETURNFORM)$/i;
/**
 * Emuera whitespace is space and tab; the full-width space U+3000 counts only when the
 * config 全角スペースをホワイトスペースに含める is enabled (Emuera's default).
 */
export function trimEndWhitespace(value: string, fullWidth = true): string {
  return fullWidth ? value.trimEnd() : value.replace(/[ \t\r\n]+$/, "");
}
export function allowsFullWidthSpace(config: ReadonlyMap<string, string>): boolean {
  return config.get("全角スペースをホワイトスペースに含める")?.toUpperCase() !== "NO";
}
export function stripComment(line: string, fullWidthSpace = true): string {
  const first = /^\s*([^\s;]+)(?:\s|$)/.exec(line)?.[1];
  if (first && LITERAL_TEXT_INSTRUCTION.test(first)) return line.trimStart();
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (line.startsWith("\\@", i)) { i = conditionalEnd(line, i) - 1; continue; }
    if (c === '"' || line.startsWith('@"', i)) { i = quotedEnd(line, i) - 1; continue; }
    if (c === ";") return trimEndWhitespace(line.slice(0, i), fullWidthSpace);
  }
  return trimEndWhitespace(line, fullWidthSpace);
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
