import { evaluate, parseExpression, type EvaluationContext, type Expr } from "./expression.js";
import type { Game } from "./loader.js";
import { EraError, integer, key, splitArguments, type Line, type Value } from "./model.js";
import type { SaveLayout } from "./save-format.js";

interface Variable {
  string: boolean;
  constant: boolean;
  dimensions: number[];
  /** Elements keyed by row-major linear index; save files use the "i:j:k" address form instead. */
  values: Map<number, Value>;
  character?: boolean;
  strides?: number[];
}
// Strides ignore dimensions[0], so a character variable's layout survives adding or removing characters.
function strides(variable: Variable): number[] {
  if (variable.strides) return variable.strides;
  const result = new Array<number>(variable.dimensions.length);
  let stride = 1;
  for (let i = variable.dimensions.length - 1; i >= 0; i--) {
    result[i] = stride;
    if (i > 0) stride *= variable.dimensions[i]!;
  }
  // Leave room for 2^20 characters (or first-dimension elements) without losing integer precision.
  if (stride > 2 ** 32) throw new EraError("Variable is too large");
  return variable.strides = result;
}
function decode(variable: Variable, index: number): number[] {
  return strides(variable).map((stride, i) => i ? Math.floor(index / stride) % variable.dimensions[i]! : Math.floor(index / stride));
}
function addressText(variable: Variable, index: number): string {
  return decode(variable, index).join(":");
}
/** Linear index of a saved "i:j:k" address, or undefined when it does not fit the variable's current shape. */
function parseAddress(variable: Variable, address: string): number | undefined {
  const parts = address.split(":");
  if (parts.length !== variable.dimensions.length) return undefined;
  const stride = strides(variable);
  let index = 0;
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isSafeInteger(n) || n < 0 || n >= variable.dimensions[i]!) return undefined;
    index += n * stride[i]!;
  }
  return index;
}
// EM ConstantData.GetKeywordDictionary: variables that index by another CSV's names.
const SYMBOL_ALIASES: Record<string, string> = {
  MAXBASE: "BASE", DOWNBASE: "BASE", LOSEBASE: "BASE", JUEL: "PALAM", GOTJUEL: "PALAM", UP: "PALAM", DOWN: "PALAM",
  CUP: "PALAM", CDOWN: "PALAM", NOWEX: "EX", ITEMSALES: "ITEM", ITEMPRICE: "ITEM",
  CDFLAGNAME1: "CDFLAG1", CDFLAGNAME2: "CDFLAG2",
};
const symbolTables = new Map<string, string>();
/** The CSV name table a variable's indices are named by (TRAINNAME → TRAIN, MAXBASE → BASE). */
export function symbolTable(name: string): string {
  let table = symbolTables.get(name);
  if (table === undefined) {
    const normalized = name.replace(/NAME$/, "");
    table = SYMBOL_ALIASES[normalized] ?? normalized;
    symbolTables.set(name, table);
  }
  return table;
}
export type GlobalData = Record<string, Record<string, string>>;
export interface SaveData { characters: number; variables: GlobalData }
// Built-ins that Emuera does not write to save files (STR comes from Str.csv; CHARANUM is derived).
const UNSAVED = new Set(["STR", "RESULTS", "SAVEDATA_TEXT", "GLOBAL", "GLOBALS", "WINDOW_TITLE", "CHARANUM", "LOCAL", "LOCALS", "ARG", "ARGS"]);
export interface Resolved {
  name: string;
  variable: Variable;
  symbols: Map<string, number> | undefined;
  dimensionSymbols: (Map<string, number> | undefined)[];
}
// Bumped whenever any scope's name table changes, invalidating every scope's resolution cache.
// Exported as an object so compiled routines can check it without a call.
export const GENERATION = { value: 0 };
export class Variables {
  private values = new Map<string, Variable>();
  /** Resolutions by name as written, valid while `cacheGeneration` matches `GENERATION.value`. */
  private resolved = new Map<string, Resolved>();
  private known = new Map<string, boolean>();
  private cacheGeneration = -1;
  private declarations = new Map<string, Line>();
  private initializing = new Set<string>();
  private hasChildren = false;
  /** Counts this scope's own name-table changes; with GENERATION it tells holders of resolutions when to re-resolve. */
  stamp = 0;
  /** A per-call scope of DYNAMIC and REF variables over a routine's static scope. */
  transient = false;
  constructor(private game: Game, public parent?: Variables) {
    if (parent) parent.hasChildren = true;
  }
  /** Name-table changes only affect lookups through this scope, so childless scopes flush just their own cache. */
  private invalidate(): void {
    this.stamp++;
    if (this.hasChildren) GENERATION.value++;
    else { this.resolved.clear(); this.known.clear(); }
  }
  define(name: string, string = false, dimensions = [1000], constant = false): void {
    this.invalidate();
    this.values.set(key(name), { string, dimensions, constant, values: new Map() });
  }
  defineCharacter(name: string, string = false, dimensions: number[] = []): void {
    this.invalidate();
    this.values.set(key(name), { string, dimensions: [0, ...dimensions], constant: false, character: true, values: new Map() });
  }
  addCharacter(): number {
    const variables = [...this.values.values()].filter((variable) => variable.character);
    const index = variables[0]?.dimensions[0] ?? 0;
    for (const variable of variables) variable.dimensions[0] = index + 1;
    return index;
  }
  characterCount(): number {
    for (const variable of this.values.values()) if (variable.character) return variable.dimensions[0]!;
    return 0;
  }
  /** Rebuilds every character variable; `source(i)` names the old index whose data the new index i receives. */
  rearrangeCharacters(count: number, source: (index: number) => number): void {
    for (const variable of this.values.values()) {
      if (!variable.character) continue;
      const stride = strides(variable)[0]!;
      const byCharacter = new Map<number, [number, Value][]>();
      for (const [index, value] of variable.values) {
        const character = Math.floor(index / stride);
        let list = byCharacter.get(character);
        if (!list) byCharacter.set(character, list = []);
        list.push([index - character * stride, value]);
      }
      variable.values = new Map();
      for (let i = 0; i < count; i++)
        for (const [rest, value] of byCharacter.get(source(i)) ?? []) variable.values.set(i * stride + rest, value);
      variable.dimensions[0] = count;
    }
  }
  /** Resets every element (of every character, for character variables) to its default. */
  clear(name: string, context: EvaluationContext): void {
    this.resolve(key(name), context).values.clear();
  }
  resetData(): void {
    const preserved = new Set(this.globalNames());
    for (const [name, variable] of this.values) {
      if (variable.constant || preserved.has(name) || name.startsWith("GAMEBASE_") || name === "WINDOW_TITLE") continue;
      if (this.declarations.has(name)) { this.values.delete(name); this.invalidate(); }
      else variable.values.clear();
      if (variable.character) variable.dimensions[0] = 0;
    }
  }
  resetGlobals(context: EvaluationContext): void {
    for (const name of this.globalNames()) {
      const variable = this.resolve(name, context);
      if (this.declarations.has(name)) {
        this.values.delete(name);
        this.invalidate();
        const initial = this.resolve(name, context);
        variable.values = initial.values;
        this.values.set(name, variable);
        this.invalidate();
      } else variable.values.clear();
    }
  }
  declaredNames(): string[] {
    return [...new Set([...this.values.keys(), ...this.declarations.keys()])].map((name) =>
      /^#DIMS?\s+(?:(?:CONST|DYNAMIC|GLOBAL|SAVEDATA|REF|CHARADATA)\s+)*([^\s,=]+)/i.exec(this.declarations.get(name)?.text ?? "")?.[1] ?? name);
  }
  declare(line: Line, local = false): void {
    const match = /^#DIM(S)?\s+((?:(?:CONST|DYNAMIC|GLOBAL|SAVEDATA|REF|CHARADATA)\s+)*)([^\s,=]+)(.*)$/i.exec(line.text);
    if (!match) throw new EraError(`Unsupported declaration: ${line.text}`, line);
    const name = key(match[3]!);
    if (local && /^[A-Z]$/i.test(match[3]!)) throw new EraError(`Cannot declare one-letter local variable: ${name}`, line);
    if (this.values.has(name) || this.declarations.has(name)) throw new EraError(`Duplicate variable: ${name}`, line);
    this.declarations.set(name, line);
    this.invalidate();
  }
  bindReference(name: string, source: Variables, sourceName: string, indices: Expr[], context: EvaluationContext): void {
    name = key(name);
    sourceName = key(sourceName);
    const declaration = this.declarations.get(name);
    if (!declaration || !/^#DIMS?\s+REF\s/i.test(declaration.text)) throw new EraError(`Not a REF parameter: ${name}`);
    const match = /^#DIM(S)?\s+REF\s+[^\s,=]+\s*(?:,(.*))?$/i.exec(declaration.text.trim());
    if (!match) throw new EraError(`Invalid REF declaration: ${name}`, declaration);
    // Emuera (ReferenceToken.MatchType) binds the whole array: indices on the argument are ignored, and
    // constants, character variables, other types and other ranks are rejected. A sizeless REF is 1-D.
    const rank = match[2] === undefined ? 1 : match[2].split(",").length;
    const variable = source.resolve(sourceName, context);
    if (variable.constant) throw new EraError(`REF cannot refer to constant ${sourceName}: ${name}`, declaration);
    if (variable.character) throw new EraError(`REF cannot refer to character variable ${sourceName}: ${name}`, declaration);
    if (variable.string !== !!match[1]) throw new EraError(`REF type mismatch (${sourceName}): ${name}`, declaration);
    if (variable.dimensions.length !== rank) throw new EraError(`REF dimension mismatch (${sourceName} has ${variable.dimensions.length}, ${name} expects ${rank})`, declaration);
    this.values.set(name, variable);
    this.invalidate();
  }
  /** Whether this scope itself (not a parent) declares or holds the name. */
  owns(written: string): boolean {
    const name = key(written);
    return this.values.has(name) || this.declarations.has(name);
  }
  has(name: string): boolean {
    if (this.cacheGeneration !== GENERATION.value) { this.resolved.clear(); this.known.clear(); this.cacheGeneration = GENERATION.value; }
    let known = this.known.get(name);
    if (known === undefined) this.known.set(name, known = this.hasKey(key(name)));
    return known;
  }
  private hasKey(name: string): boolean {
    if (name === "GAMEBASE_GAMECODE") name = "GAMEBASE_CODE";
    return this.values.has(name) || this.declarations.has(name) || !!this.parent?.hasKey(name);
  }
  isCharacter(name: string, context: EvaluationContext): boolean {
    name = key(name);
    return !!this.resolve(name, context).character;
  }
  /** Number of indices after the character index (0 for scalars such as NAME). */
  characterRank(name: string, context: EvaluationContext): number {
    return this.resolve(key(name), context).dimensions.length - 1;
  }
  /** One element across all characters, resolving its indices once before sorting. */
  characterValues(name: string, indices: Expr[], context: EvaluationContext): Value[] {
    const variable = this.resolve(key(name), context);
    if (!variable.character) throw new EraError(`Expected a character variable: ${name}`);
    const index = this.address(name, [{ kind: "literal", value: 0n }, ...indices], context);
    const stride = strides(variable)[0]!;
    return Array.from({ length: variable.dimensions[0]! }, (_, i) =>
      variable.values.get(index + i * stride) ?? (variable.string ? "" : 0n));
  }
  dimensions(name: string, context: EvaluationContext): number[] {
    name = key(name);
    const variable = this.resolve(name, context);
    const dimensions = variable.character ? variable.dimensions.slice(1) : [...variable.dimensions];
    return dimensions.length ? dimensions : [1];
  }
  // VARSET: element indices are ignored except a character variable's character.
  // The range applies only to one-dimensional arrays (per character).
  fill(name: string, indices: Expr[], value: Value | undefined, range: [number | undefined, number | undefined], context: EvaluationContext): void {
    name = key(name);
    const variable = this.resolve(name, context);
    if (variable.constant) throw new EraError(`Cannot assign constant: ${name}`);
    const fill = value ?? (variable.string ? "" : 0n);
    if ((typeof fill === "string") !== variable.string) throw new EraError(`Assignment type mismatch: ${name}`);
    let base = 0;
    let dimensions = variable.dimensions;
    if (variable.character) {
      const character = indices.length
        ? Math.floor(this.address(name, indices, context) / strides(variable)[0]!)
        : Number(integer(context.get("TARGET", [])));
      if (!Number.isSafeInteger(character) || character < 0 || character >= dimensions[0]!) throw new EraError(`Character index ${character} out of range for ${name}`);
      base = character * strides(variable)[0]!;
      dimensions = dimensions.slice(1);
    }
    let start = 0, end = dimensions[0]!;
    if (dimensions.length === 1) {
      start = range[0] ?? 0;
      end = range[1] ?? dimensions[0]!;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > dimensions[0]! || start > end)
        throw new EraError(`Invalid VARSET range ${start}-${end} for ${name}`);
    }
    const isDefault = fill === (variable.string ? "" : 0n);
    if (isDefault && !variable.character && start === 0 && end === dimensions[0]) { variable.values.clear(); return; }
    if (!dimensions.length) return;
    if (dimensions.length > 1) { start = 0; end = dimensions.reduce((a, b) => a * b, 1); }
    for (let i = base + start; i < base + end; i++) {
      if (isDefault) variable.values.delete(i);
      else variable.values.set(i, fill);
    }
  }
  /** Elements along the last dimension selected by `indices` (trailing index ignored; implicit TARGET for character data). */
  row(name: string, indices: Expr[], context: EvaluationContext): { size: number; string: boolean; get(i: number): Value; set(i: number, value: Value): void } {
    name = key(name);
    const variable = this.resolve(name, context);
    const full = variable.dimensions.length;
    const base = indices.length === full || (variable.character && indices.length === full - 1) ? indices.slice(0, -1) : indices;
    const index = this.address(name, [...base, { kind: "literal", value: 0n }], context);
    const size = variable.dimensions.at(-1)!;
    const empty: Value = variable.string ? "" : 0n;
    return {
      size, string: variable.string,
      get: (i) => variable.values.get(index + i) ?? empty,
      set: (i, value) => {
        if (variable.constant) throw new EraError(`Cannot modify constant: ${name}`);
        if ((typeof value === "string") !== variable.string) throw new EraError(`Assignment type mismatch: ${name}`);
        variable.values.set(index + i, value);
      },
    };
  }
  /** VARSETEX fills final-dimension slices; only numeric non-character arrays expand across rows. */
  fillExtended(name: string, indices: Expr[], value: Value, all: boolean, from: bigint, to: bigint | undefined, context: EvaluationContext): void {
    const variable = this.lookup(name, context).variable;
    if (variable.constant) throw new EraError(`Cannot modify constant: ${name}`);
    if ((typeof value === "string") !== variable.string) throw new EraError(`Assignment type mismatch: ${name}`);
    const rank = variable.dimensions.length;
    // Native VARSETEX names use data coordinates, with character zero rather than implicit TARGET.
    const zero: Expr = { kind: "literal", value: 0n };
    const full = variable.character ? [zero, ...indices.slice(0, rank - 1)] : rank === 1 ? [zero] : [...indices];
    while (full.length < rank) full.push(zero);
    const address = this.address(name, full, context);
    const width = variable.dimensions.at(-1)!;
    const column = rank === 1 ? 0 : address % width;
    const firstColumn = rank === 1 ? from : from < BigInt(column) ? BigInt(column) : from;
    const lastColumn = to ?? BigInt(width);
    if (firstColumn >= lastColumn) return;
    if (firstColumn < 0n || lastColumn > BigInt(width)) throw new EraError(`VARSETEX range out of bounds for ${name}`);
    const start = Number(firstColumn), end = Number(lastColumn);
    const rowStart = address - address % width;
    const allRows = all && rank > 1 && !variable.string && !variable.character;
    const first = allRows ? 0 : rowStart;
    const limit = allRows ? variable.dimensions.reduce((a, b) => a * b, 1) : rowStart + width;
    for (let base = first; base < limit; base += width) {
      for (let i = start; i < end; i++) {
        if (value === (variable.string ? "" : 0n)) variable.values.delete(base + i);
        else variable.values.set(base + i, value);
      }
    }
  }
  /** ARRAYCOPY: copies the overlapping region of two same-typed, same-rank, non-character arrays. */
  copyArray(fromName: string, toName: string, context: EvaluationContext): void {
    const from = this.resolve(key(fromName), context), to = this.resolve(key(toName), context);
    if (from.character || to.character) throw new EraError("ARRAYCOPY does not support character variables");
    if (from.string !== to.string || from.dimensions.length !== to.dimensions.length) throw new EraError(`ARRAYCOPY: ${fromName} and ${toName} differ in type or dimensions`);
    if (to.constant) throw new EraError(`Cannot modify constant: ${toName}`);
    const limits = from.dimensions.map((n, i) => Math.min(n, to.dimensions[i]!));
    const inside = (coordinates: number[]) => coordinates.every((n, i) => n < limits[i]!);
    for (const index of [...to.values.keys()]) if (inside(decode(to, index))) to.values.delete(index);
    const target = strides(to);
    for (const [index, value] of from.values) {
      const coordinates = decode(from, index);
      if (inside(coordinates)) to.values.set(coordinates.reduce((sum, n, i) => sum + n * target[i]!, 0), value);
    }
  }
  /** Reorders the first dimension so new index i holds old index order[i]; later indices are untouched. */
  permute(name: string, order: number[], context: EvaluationContext): boolean {
    const variable = this.resolve(key(name), context);
    if (variable.character) throw new EraError(`Cannot reorder character variable: ${name}`);
    if (variable.dimensions[0]! < order.length) return false;
    const inverse = new Map(order.map((old, i) => [old, i]));
    const stride = strides(variable)[0]!;
    const values = new Map<number, Value>();
    for (const [index, value] of variable.values) {
      const first = Math.floor(index / stride);
      if (first >= order.length) { values.set(index, value); continue; }
      const moved = inverse.get(first);
      if (moved !== undefined) values.set(moved * stride + index - first * stride, value);
    }
    variable.values = values;
    return true;
  }
  remove(name: string, indices: Expr[], start: number, count: number, context: EvaluationContext): void {
    const first = this.address(name, [...indices, { kind: "literal", value: BigInt(start) }], context);
    const variable = this.addressed;
    if (variable.constant) throw new EraError(`Cannot modify constant: ${name}`);
    const size = variable.dimensions.at(-1)!;
    if (!Number.isSafeInteger(count) || count < 0 || start + count > size) throw new EraError("Invalid ARRAYREMOVE range");
    const base = first - start;
    const moved = new Map<number, Value>();
    for (const [address, value] of variable.values) {
      if (address < base || address >= base + size) continue;
      const index = address - base;
      if (index < start) continue;
      variable.values.delete(address);
      if (index >= start + count) moved.set(base + index - count, value);
    }
    for (const [address, value] of moved) variable.values.set(address, value);
  }
  private globalNames(): string[] {
    return ["GLOBAL", "GLOBALS", ...[...this.declarations].filter(([, line]) => /^#DIMS?\s+(?:\w+\s+)*GLOBAL\b/i.test(line.text))
      .map(([name]) => name)];
  }
  /** Records every variable's values; the function returned puts them all back, undoing whatever ran in between. */
  checkpoint(): () => void {
    const saved = [...this.values.values()].map((variable) => ({ variable, values: new Map(variable.values), dimensions: [...variable.dimensions] }));
    return () => {
      for (const { variable, values, dimensions } of saved) {
        // In place, since compiled code may hold on to the map.
        variable.values.clear();
        for (const [index, value] of values) variable.values.set(index, value);
        variable.dimensions.splice(0, variable.dimensions.length, ...dimensions);
      }
    };
  }
  exportGlobals(context: EvaluationContext): GlobalData {
    const result: GlobalData = {};
    for (const name of this.globalNames()) {
      if (!this.has(name)) continue;
      const variable = this.resolve(key(name), context);
      result[name] = Object.fromEntries([...variable.values].map(([index, value]) => [addressText(variable, index), String(value)]));
    }
    return result;
  }
  importGlobals(data: GlobalData, context: EvaluationContext): void {
    const updates: { variable: Variable; values: Map<number, Value> }[] = [];
    for (const name of this.globalNames()) {
      if (!this.has(name)) continue;
      const variable = this.resolve(key(name), context);
      const values = new Map<number, Value>();
      const saved = data[name];
      if (saved) for (const [address, raw] of Object.entries(saved)) {
        const indices = address.split(":").map((n) => {
          if (!/^\d+$/.test(n)) throw new EraError(`Invalid saved global index: ${name}:${address}`);
          return { kind: "literal", value: BigInt(n) } satisfies Expr;
        });
        const index = this.address(name, indices, context);
        if (!variable.string && !/^-?\d+$/.test(raw)) throw new EraError(`Invalid saved integer: ${name}:${address}`);
        const value = variable.string ? raw : BigInt(raw);
        if (typeof value === "bigint" && BigInt.asIntN(64, value) !== value) throw new EraError(`Saved integer out of range: ${name}`);
        values.set(index, value);
      }
      // Missing variables retain their declared initial values.
      if (saved) updates.push({ variable, values });
    }
    for (const update of updates) update.variable.values = update.values;
  }
  /** Variables written by SAVEDATA: built-ins other than the unsaved ones, plus non-global `#DIM SAVEDATA` declarations. */
  private savedNames(context: EvaluationContext): string[] {
    const names = [...this.values.keys()].filter((name) => !this.declarations.has(name) && !UNSAVED.has(name)
      && !name.startsWith("GAMEBASE_") && !this.values.get(name)!.constant);
    for (const [name, line] of this.declarations) {
      if (!/^#DIMS?\s+(?:\w+\s+)*SAVEDATA\b/i.test(line.text) || /^#DIMS?\s+(?:\w+\s+)*GLOBAL\b/i.test(line.text)) continue;
      this.resolve(name, context);
      names.push(name);
    }
    return names;
  }
  exportSave(context: EvaluationContext): SaveData {
    const variables: GlobalData = {};
    for (const name of this.savedNames(context)) {
      const variable = this.values.get(name)!;
      if (variable.values.size) variables[name] = Object.fromEntries([...variable.values].map(([index, value]) => [addressText(variable, index), String(value)]));
    }
    return { characters: this.characterCount(), variables };
  }
  saveLayout(context: EvaluationContext, global = false): SaveLayout[] {
    return (global ? this.globalNames() : this.savedNames(context)).filter((name) => this.has(name)).map((name) => {
      const variable = this.resolve(name, context);
      return { name, string: variable.string, character: !!variable.character,
        dimensions: [...(variable.character ? variable.dimensions.slice(1) : variable.dimensions)] };
    });
  }
  /** Replaces the saved variables; call resetData() first so unsaved variables return to their defaults. */
  importSave(data: SaveData, context: EvaluationContext): void {
    if (!Number.isSafeInteger(data.characters) || data.characters < 0) throw new EraError("Invalid saved character count");
    for (const variable of this.values.values()) if (variable.character) variable.dimensions[0] = data.characters;
    const names = new Set(this.savedNames(context));
    for (const [name, values] of Object.entries(data.variables)) {
      if (!names.has(name)) continue;
      const variable = this.values.get(name)!;
      variable.values = new Map();
      for (const [address, raw] of Object.entries(values)) {
        const value = this.parseSaved(variable, name, address, raw);
        // Elements outside the current VariableSize shape are unreachable, so they are dropped.
        const index = parseAddress(variable, address);
        if (index !== undefined) variable.values.set(index, value);
      }
    }
  }
  /** Character variables of the given characters, each as variable name → address within the character → value. */
  exportCharacters(indices: number[], context: EvaluationContext): GlobalData[] {
    const result: GlobalData[] = indices.map(() => ({}));
    const position = new Map(indices.map((index, i) => [index, i]));
    for (const name of this.savedNames(context)) {
      const variable = this.values.get(name)!;
      if (!variable.character) continue;
      const stride = strides(variable)[0]!;
      for (const [index, value] of variable.values) {
        const i = position.get(Math.floor(index / stride));
        if (i === undefined) continue;
        (result[i]![name] ??= {})[decode(variable, index).slice(1).join(":")] = String(value);
      }
    }
    return result;
  }
  appendCharacters(characters: GlobalData[], context: EvaluationContext): void {
    const names = new Set(this.savedNames(context));
    for (const character of characters) {
      const index = this.addCharacter();
      for (const [name, values] of Object.entries(character)) {
        if (!names.has(name)) continue;
        const variable = this.values.get(name)!;
        if (!variable.character) continue;
        for (const [rest, raw] of Object.entries(values)) {
          const address = rest ? `${index}:${rest}` : String(index);
          const value = this.parseSaved(variable, name, address, raw);
          const linear = parseAddress(variable, address);
          if (linear !== undefined) variable.values.set(linear, value);
        }
      }
    }
  }
  private parseSaved(variable: Variable, name: string, address: string, raw: unknown): Value {
    if (typeof raw !== "string" || !/^\d+(?::\d+)*$/.test(address)) throw new EraError(`Invalid saved value: ${name}:${address}`);
    if (variable.string) return raw;
    if (!/^-?\d+$/.test(raw)) throw new EraError(`Invalid saved integer: ${name}:${address}`);
    return BigInt.asIntN(64, BigInt(raw));
  }
  // Internal lookups expect names already normalized with key().
  private resolve(name: string, context: EvaluationContext): Variable {
    if (name === "GAMEBASE_GAMECODE") name = "GAMEBASE_CODE";
    const existing = this.values.get(name);
    if (existing) return existing;
    const line = this.declarations.get(name);
    if (!line) {
      if (this.parent) return this.parent.resolve(name, context);
      throw new EraError(`Unknown variable: ${name}`);
    }
    if (this.initializing.has(name)) throw new EraError(`Circular initializer: ${name}`, line);
    this.initializing.add(name);
    try {
      const match = /^#DIM(S)?\s+((?:(?:CONST|DYNAMIC|GLOBAL|SAVEDATA|REF|CHARADATA)\s+)*)([^\s,=]+)(.*)$/i.exec(line.text)!;
      const modifiers = match[2]!.toUpperCase().trim().split(/\s+/);
      if (modifiers.includes("REF")) throw new EraError(`REF variable ${name} does not refer to anything`, line);
      const rest = match[4]!.trim();
      const equal = rest.indexOf("=");
      const sizes = (equal < 0 ? rest : rest.slice(0, equal)).trim().replace(/^,/, "");
      const initialText = equal < 0 ? "" : rest.slice(equal + 1).trim().replace(/,$/, "");
      const initial = equal < 0 ? [] : splitArguments(initialText).map((x) => evaluate(parseExpression(x), context));
      const dimensions = sizes ? splitArguments(sizes).map((x) => Number(integer(evaluate(parseExpression(x), context)))) : [Math.max(1, initial.length)];
      if (dimensions.length > 3 || dimensions.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 1_000_000))
        throw new EraError(`Invalid dimensions for ${name}`, line);
      if (initial.length && (dimensions.length > 1 || initial.length > dimensions[0]!)) throw new EraError(`Invalid initializer for ${name}`, line);
      if (modifiers.includes("CONST") && (!initial.length || initial.length !== dimensions[0]!))
        throw new EraError(`Constant dimensions must match initial values: ${name}`, line);
      const character = modifiers.includes("CHARADATA");
      if (character && dimensions.length > 2) throw new EraError(`CHARADATA variables can have at most 2 dimensions: ${name}`, line);
      if (character && initial.length) throw new EraError(`CHARADATA initializers are not yet supported: ${name}`, line);
      const variable: Variable = {
        string: !!match[1], constant: modifiers.includes("CONST"),
        dimensions: character ? [Number(integer(context.get("CHARANUM", []))), ...dimensions] : dimensions,
        values: new Map(), character,
      };
      initial.forEach((value, i) => {
        if ((typeof value === "string") !== variable.string) throw new EraError(`Initializer type mismatch: ${name}`, line);
        variable.values.set(i, value);
      });
      this.values.set(name, variable);
      return variable;
    } finally { this.initializing.delete(name); }
  }
  /** Resolves a name as written to its variable, CSV symbol table and key; throws for unknown names. */
  slot(written: string, context: EvaluationContext): Resolved { return this.lookup(written, context); }
  private lookup(written: string, context: EvaluationContext): Resolved {
    if (this.cacheGeneration !== GENERATION.value) { this.resolved.clear(); this.known.clear(); this.cacheGeneration = GENERATION.value; }
    let entry = this.resolved.get(written);
    if (!entry) {
      const name = key(written);
      const variable = this.resolve(name, context);
      // Resolving may lazily create a declared variable, which bumps the generation; cache under the new one.
      if (this.cacheGeneration !== GENERATION.value) { this.resolved.clear(); this.known.clear(); this.cacheGeneration = GENERATION.value; }
      entry = {
        name, variable, symbols: this.game.names.get(symbolTable(name)),
        dimensionSymbols: variable.dimensions.map((_, i) => this.game.names.get(name === "CDFLAG" && i > 0 ? `CDFLAG${i}` : `${name}@${i + 1}`)),
      };
      this.resolved.set(written, entry);
    }
    return entry;
  }
  /** The variable resolved by the latest `address` call; avoids allocating a result object per access. */
  private addressed!: Variable;
  private address(written: string, indices: Expr[], context: EvaluationContext): number {
    const slot = this.lookup(written, context);
    const { name, variable } = slot;
    const count = indices.length;
    const dimensions = variable.dimensions;
    const rank = dimensions.length;
    if (variable.character && rank === 3 && count !== rank)
      throw new EraError(`Expected ${rank} indices for ${name}; cannot omit character-array arguments`);
    const stride = variable.strides ?? strides(variable);
    if (!count) {
      let index = 0;
      if (variable.character) {
        const target = Number(integer(context.get("TARGET", [])));
        if (target < 0 || target >= dimensions[0]!) throw new EraError(`Index ${target} out of range for ${name} dimension 1`);
        for (let d = 1; d < rank; d++) if (dimensions[d]! <= 0) throw new EraError(`Index 0 out of range for ${name} dimension ${d + 1}`);
        index = target * stride[0]!;
      } else {
        if (rank !== 1) throw new EraError(`Expected ${rank} indices for ${name}, received 1`);
        if (dimensions[0]! <= 0) throw new EraError(`Index 0 out of range for ${name} dimension 1`);
      }
      this.addressed = variable;
      return index;
    }
    // Character data indexed without its character dimension implicitly uses TARGET.
    const offset = variable.character && count === rank - 1 ? 1 : 0;
    let index = 0, bad = -1, badValue = 0;
    for (let i = 0; i < count; i++) {
      const expr = indices[i]!;
      const table = indexSymbols(slot, i, count);
      let n: number;
      if (expr.kind === "literal" && typeof expr.value === "bigint") {
        n = Number(expr.value);
        if (!Number.isSafeInteger(n)) throw new EraError(`Invalid array index: ${expr.value}`);
      } else if (expr.kind === "variable" && !expr.indices.length && table?.has(expr.name) && !this.has(expr.name)) {
        n = table.get(expr.name)!;
      } else {
        const value = evaluate(expr, context);
        if (typeof value === "string") {
          const symbol = table?.get(key(value));
          if (symbol === undefined) throw new EraError(`Unknown ${name} CSV index: ${value}`);
          n = symbol;
        } else {
          n = Number(integer(value));
          if (!Number.isSafeInteger(n)) throw new EraError(`Invalid array index: ${value}`);
        }
      }
      const d = i + offset;
      if (d >= rank) continue;
      if (n < 0 || n >= dimensions[d]!) { if (bad < 0) { bad = d; badValue = n; } }
      else index += n * stride[d]!;
    }
    if (offset) {
      const target = Number(integer(context.get("TARGET", [])));
      if (target < 0 || target >= dimensions[0]!) throw new EraError(`Index ${target} out of range for ${name} dimension 1`);
      index += target * stride[0]!;
    }
    if (count + offset !== rank) throw new EraError(`Expected ${rank} indices for ${name}, received ${count + offset}`);
    if (bad >= 0) throw new EraError(`Index ${badValue} out of range for ${name} dimension ${bad + 1}`);
    this.addressed = variable;
    return index;
  }
  get(name: string, indices: Expr[], context: EvaluationContext): Value {
    const index = this.address(name, indices, context);
    const variable = this.addressed;
    return variable.values.get(index) ?? (variable.string ? "" : 0n);
  }
  isString(name: string, context: EvaluationContext): boolean { return this.lookup(name, context).variable.string; }
  isConstant(name: string, context: EvaluationContext): boolean { return !!this.lookup(name, context).variable.constant; }
  set(name: string, indices: Expr[], value: Value, context: EvaluationContext): void {
    this.setMany(name, indices, [value], context);
  }
  setMany(name: string, indices: Expr[], values: Value[], context: EvaluationContext): void {
    name = key(name);
    const index = this.address(name, indices, context);
    const variable = this.addressed;
    if (variable.constant) throw new EraError(`Cannot assign constant: ${name}`);
    for (const value of values) if ((typeof value === "string") !== variable.string) throw new EraError(`Assignment type mismatch: ${name}`);
    const last = variable.dimensions.length - 1;
    // The last dimension has stride 1, so consecutive values fill consecutive elements of that row.
    const start = last ? index % variable.dimensions[last]! : index;
    if (start + values.length > variable.dimensions[last]!) throw new EraError(`Batch assignment out of range for ${name} dimension ${last + 1}`);
    for (let i = 0; i < values.length; i++) variable.values.set(index + i, values[i]!);
  }
  seed(name: string, index: number, value: Value): void {
    const variable = this.values.get(key(name));
    if (!variable) throw new EraError(`Cannot seed unknown variable: ${name}`);
    variable.values.set(index, value);
  }
}

export function indexSymbols(slot: Resolved, index: number, count: number): Map<string, number> | undefined {
  const offset = slot.variable.character && count === slot.variable.dimensions.length - 1 ? 1 : 0;
  return slot.dimensionSymbols[index + offset] ?? slot.symbols;
}
/** Converts indices as `address` does, including dimension-specific ERD names. */
export function indexNumber(slot: Resolved, value: Value, index: number, count: number): number {
  if (typeof value === "string") {
    const symbol = indexSymbols(slot, index, count)?.get(key(value));
    if (symbol === undefined) throw new EraError(`Unknown ${slot.name} CSV index: ${value}`);
    return symbol;
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new EraError(`Invalid array index: ${value}`);
  return n;
}
/** `Variables.address` for up to three already-converted indices: implicit TARGET, rank and range checks in its order. */
export function locate(slot: Resolved, context: EvaluationContext, count: number, n0: number, n1: number, n2: number): number {
  const { name, variable } = slot;
  const dimensions = variable.dimensions;
  const rank = dimensions.length;
  if (variable.character && rank === 3 && count !== rank)
    throw new EraError(`Expected ${rank} indices for ${name}; cannot omit character-array arguments`);
  const stride = variable.strides ?? strides(variable);
  if (!count) {
    if (variable.character) {
      const target = Number(integer(context.get("TARGET", [])));
      if (target < 0 || target >= dimensions[0]!) throw new EraError(`Index ${target} out of range for ${name} dimension 1`);
      for (let d = 1; d < rank; d++) if (dimensions[d]! <= 0) throw new EraError(`Index 0 out of range for ${name} dimension ${d + 1}`);
      return target * stride[0]!;
    }
    if (rank !== 1) throw new EraError(`Expected ${rank} indices for ${name}, received 1`);
    if (dimensions[0]! <= 0) throw new EraError(`Index 0 out of range for ${name} dimension 1`);
    return 0;
  }
  const offset = variable.character && count === rank - 1 ? 1 : 0;
  let index = 0, bad = -1, badValue = 0;
  for (let i = 0; i < count; i++) {
    const n = i === 0 ? n0 : i === 1 ? n1 : n2;
    const d = i + offset;
    if (d >= rank) continue;
    if (n < 0 || n >= dimensions[d]!) { if (bad < 0) { bad = d; badValue = n; } }
    else index += n * stride[d]!;
  }
  if (offset) {
    const target = Number(integer(context.get("TARGET", [])));
    if (target < 0 || target >= dimensions[0]!) throw new EraError(`Index ${target} out of range for ${name} dimension 1`);
    index += target * stride[0]!;
  }
  if (count + offset !== rank) throw new EraError(`Expected ${rank} indices for ${name}, received ${count + offset}`);
  if (bad >= 0) throw new EraError(`Index ${badValue} out of range for ${name} dimension ${bad + 1}`);
  return index;
}
export function readElement(slot: Resolved, index: number): Value {
  const variable = slot.variable;
  return variable.values.get(index) ?? (variable.string ? "" : 0n);
}
/** A single-value `setMany`: constant and type checks, then the store. */
export function writeElement(slot: Resolved, index: number, value: Value): void {
  const variable = slot.variable;
  if (variable.constant) throw new EraError(`Cannot assign constant: ${slot.name}`);
  if ((typeof value === "string") !== variable.string) throw new EraError(`Assignment type mismatch: ${slot.name}`);
  variable.values.set(index, value);
}
export function slotIsString(slot: Resolved): boolean { return slot.variable.string; }
