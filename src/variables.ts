import { evaluate, parseExpression, type EvaluationContext, type Expr } from "./expression.js";
import type { Game } from "./loader.js";
import { EraError, integer, key, splitArguments, type Line, type Value } from "./model.js";

interface Variable {
  string: boolean;
  constant: boolean;
  dimensions: number[];
  values: Map<string, Value>;
  character?: boolean;
}
// EM ConstantData.GetKeywordDictionary: variables that index by another CSV's names.
const SYMBOL_ALIASES: Record<string, string> = {
  MAXBASE: "BASE", DOWNBASE: "BASE", LOSEBASE: "BASE", JUEL: "PALAM", GOTJUEL: "PALAM", UP: "PALAM", DOWN: "PALAM",
  CUP: "PALAM", CDOWN: "PALAM", NOWEX: "EX", ITEMSALES: "ITEM", ITEMPRICE: "ITEM", STR: "STRNAME",
};
const symbolTables = new Map<string, string>();
function symbolTable(name: string): string {
  let table = symbolTables.get(name);
  if (table === undefined) {
    const normalized = name === "STRNAME" ? name : name.replace(/NAME$/, "");
    table = SYMBOL_ALIASES[normalized] ?? normalized;
    symbolTables.set(name, table);
  }
  return table;
}
export type GlobalData = Record<string, Record<string, string>>;
export interface SaveData { characters: number; variables: GlobalData }
// Built-ins that Emuera does not write to save files (STR comes from Str.csv; CHARANUM is derived).
const UNSAVED = new Set(["STR", "RESULTS", "GLOBAL", "GLOBALS", "WINDOW_TITLE", "CHARANUM", "LOCAL", "LOCALS", "ARG", "ARGS"]);
export class Variables {
  private values = new Map<string, Variable>();
  private declarations = new Map<string, Line>();
  private initializing = new Set<string>();
  constructor(private game: Game, public parent?: Variables) {}
  define(name: string, string = false, dimensions = [1000], constant = false): void {
    this.values.set(key(name), { string, dimensions, constant, values: new Map() });
  }
  defineCharacter(name: string, string = false, dimensions: number[] = []): void {
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
      const byCharacter = new Map<number, [string, Value][]>();
      for (const [address, value] of variable.values) {
        const separator = address.indexOf(":");
        const character = Number(separator < 0 ? address : address.slice(0, separator));
        let list = byCharacter.get(character);
        if (!list) byCharacter.set(character, list = []);
        list.push([separator < 0 ? "" : address.slice(separator), value]);
      }
      variable.values = new Map();
      for (let i = 0; i < count; i++)
        for (const [rest, value] of byCharacter.get(source(i)) ?? []) variable.values.set(`${i}${rest}`, value);
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
      if (this.declarations.has(name)) this.values.delete(name);
      else variable.values.clear();
      if (variable.character) variable.dimensions[0] = 0;
    }
  }
  declare(line: Line): void {
    const match = /^#DIM(S)?\s+((?:(?:CONST|DYNAMIC|GLOBAL|SAVEDATA|REF|CHARADATA)\s+)*)([^\s,=]+)(.*)$/i.exec(line.text);
    if (!match) throw new EraError(`Unsupported declaration: ${line.text}`, line);
    const name = key(match[3]!);
    if (this.values.has(name) || this.declarations.has(name)) throw new EraError(`Duplicate variable: ${name}`, line);
    this.declarations.set(name, line);
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
  }
  has(name: string): boolean {
    return this.hasKey(key(name));
  }
  private hasKey(name: string): boolean {
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
    let prefix = "";
    let dimensions = variable.dimensions;
    if (variable.character) {
      const character = indices.length
        ? Number(this.address(name, indices, context).address.split(":")[0])
        : Number(integer(context.get("TARGET", [])));
      if (!Number.isSafeInteger(character) || character < 0 || character >= dimensions[0]!) throw new EraError(`Character index ${character} out of range for ${name}`);
      prefix = `${character}:`;
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
    if (isDefault && !prefix && start === 0 && end === dimensions[0]) { variable.values.clear(); return; }
    const write = (address: string): void => {
      if (isDefault) variable.values.delete(address);
      else variable.values.set(address, fill);
    };
    if (dimensions.length === 1) {
      for (let i = start; i < end; i++) write(prefix + i);
      return;
    }
    const visit = (address: string, dimension: number): void => {
      for (let i = 0; i < dimensions[dimension]!; i++) {
        const next = address + (dimension ? ":" : "") + i;
        if (dimension === dimensions.length - 1) write(next);
        else visit(next, dimension + 1);
      }
    };
    visit(prefix, 0);
  }
  /** Elements along the last dimension selected by `indices` (trailing index ignored; implicit TARGET for character data). */
  row(name: string, indices: Expr[], context: EvaluationContext): { size: number; string: boolean; get(i: number): Value; set(i: number, value: Value): void } {
    name = key(name);
    const variable = this.resolve(name, context);
    const full = variable.dimensions.length;
    const base = indices.length === full || (variable.character && indices.length === full - 1) ? indices.slice(0, -1) : indices;
    const { address } = this.address(name, [...base, { kind: "literal", value: 0n }], context);
    const prefix = address.slice(0, address.lastIndexOf(":") + 1);
    const size = variable.dimensions.at(-1)!;
    const empty: Value = variable.string ? "" : 0n;
    return {
      size, string: variable.string,
      get: (i) => variable.values.get(prefix + i) ?? empty,
      set: (i, value) => {
        if (variable.constant) throw new EraError(`Cannot modify constant: ${name}`);
        if ((typeof value === "string") !== variable.string) throw new EraError(`Assignment type mismatch: ${name}`);
        variable.values.set(prefix + i, value);
      },
    };
  }
  /** ARRAYCOPY: copies the overlapping region of two same-typed, same-rank, non-character arrays. */
  copyArray(fromName: string, toName: string, context: EvaluationContext): void {
    const from = this.resolve(key(fromName), context), to = this.resolve(key(toName), context);
    if (from.character || to.character) throw new EraError("ARRAYCOPY does not support character variables");
    if (from.string !== to.string || from.dimensions.length !== to.dimensions.length) throw new EraError(`ARRAYCOPY: ${fromName} and ${toName} differ in type or dimensions`);
    if (to.constant) throw new EraError(`Cannot modify constant: ${toName}`);
    const limits = from.dimensions.map((n, i) => Math.min(n, to.dimensions[i]!));
    const inside = (address: string) => address.split(":").every((part, i) => Number(part) < limits[i]!);
    for (const address of [...to.values.keys()]) if (inside(address)) to.values.delete(address);
    for (const [address, value] of from.values) if (inside(address)) to.values.set(address, value);
  }
  /** Reorders the first dimension so new index i holds old index order[i]; later indices are untouched. */
  permute(name: string, order: number[], context: EvaluationContext): boolean {
    const variable = this.resolve(key(name), context);
    if (variable.character) throw new EraError(`Cannot reorder character variable: ${name}`);
    if (variable.dimensions[0]! < order.length) return false;
    const inverse = new Map(order.map((old, i) => [old, i]));
    const values = new Map<string, Value>();
    for (const [address, value] of variable.values) {
      const separator = address.indexOf(":");
      const first = Number(separator < 0 ? address : address.slice(0, separator));
      if (first >= order.length) { values.set(address, value); continue; }
      const moved = inverse.get(first);
      if (moved !== undefined) values.set(`${moved}${separator < 0 ? "" : address.slice(separator)}`, value);
    }
    variable.values = values;
    return true;
  }
  remove(name: string, indices: Expr[], start: number, count: number, context: EvaluationContext): void {
    const { variable, address } = this.address(key(name), [...indices, { kind: "literal", value: BigInt(start) }], context);
    if (variable.constant) throw new EraError(`Cannot modify constant: ${name}`);
    const size = variable.dimensions.at(-1)!;
    if (!Number.isSafeInteger(count) || count < 0 || start + count > size) throw new EraError("Invalid ARRAYREMOVE range");
    const prefix = address.slice(0, address.lastIndexOf(":") + 1);
    const moved = new Map<string, Value>();
    for (const [address, value] of variable.values) {
      if (!address.startsWith(prefix)) continue;
      const index = Number(address.slice(prefix.length));
      if (index < start) continue;
      variable.values.delete(address);
      if (index >= start + count) moved.set(prefix + (index - count), value);
    }
    for (const [address, value] of moved) variable.values.set(address, value);
  }
  private globalNames(): string[] {
    return ["GLOBAL", "GLOBALS", ...[...this.declarations].filter(([, line]) => /^#DIMS?\s+(?:\w+\s+)*GLOBAL\b/i.test(line.text))
      .map(([name]) => name)];
  }
  exportGlobals(context: EvaluationContext): GlobalData {
    const result: GlobalData = {};
    for (const name of this.globalNames()) {
      if (!this.has(name)) continue;
      result[name] = Object.fromEntries([...this.resolve(key(name), context).values].map(([address, value]) => [address, String(value)]));
    }
    return result;
  }
  importGlobals(data: GlobalData, context: EvaluationContext): void {
    const updates: { variable: Variable; values: Map<string, Value> }[] = [];
    for (const name of this.globalNames()) {
      if (!this.has(name)) continue;
      const variable = this.resolve(key(name), context);
      const values = new Map<string, Value>();
      const saved = data[name];
      if (saved) for (const [address, raw] of Object.entries(saved)) {
        const indices = address.split(":").map((n) => {
          if (!/^\d+$/.test(n)) throw new EraError(`Invalid saved global index: ${name}:${address}`);
          return { kind: "literal", value: BigInt(n) } satisfies Expr;
        });
        this.address(key(name), indices, context);
        if (!variable.string && !/^-?\d+$/.test(raw)) throw new EraError(`Invalid saved integer: ${name}:${address}`);
        const value = variable.string ? raw : BigInt(raw);
        if (typeof value === "bigint" && BigInt.asIntN(64, value) !== value) throw new EraError(`Saved integer out of range: ${name}`);
        values.set(address, value);
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
      if (variable.values.size) variables[name] = Object.fromEntries([...variable.values].map(([address, value]) => [address, String(value)]));
    }
    return { characters: this.characterCount(), variables };
  }
  /** Replaces the saved variables; call resetData() first so unsaved variables return to their defaults. */
  importSave(data: SaveData, context: EvaluationContext): void {
    if (!Number.isSafeInteger(data.characters) || data.characters < 0) throw new EraError("Invalid saved character count");
    for (const variable of this.values.values()) if (variable.character) variable.dimensions[0] = data.characters;
    const names = new Set(this.savedNames(context));
    for (const [name, values] of Object.entries(data.variables)) {
      if (!names.has(name)) continue;
      const variable = this.values.get(name)!;
      variable.values = new Map(Object.entries(values).map(([address, raw]) => [address, this.parseSaved(variable, name, address, raw)]));
    }
  }
  /** Character variables of the given characters, each as variable name → address within the character → value. */
  exportCharacters(indices: number[], context: EvaluationContext): GlobalData[] {
    const result: GlobalData[] = indices.map(() => ({}));
    const position = new Map(indices.map((index, i) => [index, i]));
    for (const name of this.savedNames(context)) {
      const variable = this.values.get(name)!;
      if (!variable.character) continue;
      for (const [address, value] of variable.values) {
        const separator = address.indexOf(":");
        const i = position.get(Number(separator < 0 ? address : address.slice(0, separator)));
        if (i === undefined) continue;
        (result[i]![name] ??= {})[separator < 0 ? "" : address.slice(separator + 1)] = String(value);
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
          variable.values.set(address, this.parseSaved(variable, name, address, raw));
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
        variable.values.set(String(i), value);
      });
      this.values.set(name, variable);
      return variable;
    } finally { this.initializing.delete(name); }
  }
  private address(name: string, indices: Expr[], context: EvaluationContext): { variable: Variable; address: string } {
    const variable = this.resolve(name, context);
    const symbols = indices.length ? this.game.names.get(symbolTable(name)) : undefined;
    const values = indices.map((expr) => {
      if (expr.kind === "variable" && !expr.indices.length && symbols?.has(expr.name) && !this.has(expr.name))
        return symbols.get(expr.name)!;
      const value = evaluate(expr, context);
      if (typeof value === "string") {
        const index = symbols?.get(key(value));
        if (index === undefined) throw new EraError(`Unknown ${name} CSV index: ${value}`);
        return index;
      }
      const n = Number(integer(value));
      if (!Number.isSafeInteger(n)) throw new EraError(`Invalid array index: ${value}`);
      return n;
    });
    if (variable.character && values.length === variable.dimensions.length - 1)
      values.unshift(Number(integer(context.get("TARGET", []))));
    else if (variable.character && !values.length)
      values.push(Number(integer(context.get("TARGET", []))), ...variable.dimensions.slice(1).map(() => 0));
    if (!values.length) values.push(0);
    if (values.length !== variable.dimensions.length) throw new EraError(`Expected ${variable.dimensions.length} indices for ${name}, received ${values.length}`);
    values.forEach((n, i) => {
      if (n < 0 || n >= variable.dimensions[i]!) throw new EraError(`Index ${n} out of range for ${name} dimension ${i + 1}`);
    });
    return { variable, address: values.join(":") };
  }
  get(name: string, indices: Expr[], context: EvaluationContext): Value {
    const { variable, address } = this.address(key(name), indices, context);
    return variable.values.get(address) ?? (variable.string ? "" : 0n);
  }
  isString(name: string, context: EvaluationContext): boolean { return this.resolve(key(name), context).string; }
  isConstant(name: string, context: EvaluationContext): boolean { return !!this.resolve(key(name), context).constant; }
  set(name: string, indices: Expr[], value: Value, context: EvaluationContext): void {
    this.setMany(name, indices, [value], context);
  }
  setMany(name: string, indices: Expr[], values: Value[], context: EvaluationContext): void {
    name = key(name);
    const { variable, address } = this.address(name, indices, context);
    if (variable.constant) throw new EraError(`Cannot assign constant: ${name}`);
    if (values.some((value) => (typeof value === "string") !== variable.string)) throw new EraError(`Assignment type mismatch: ${name}`);
    const coordinates = address.split(":");
    const last = coordinates.length - 1;
    const start = Number(coordinates[last]);
    if (start + values.length > variable.dimensions[last]!) throw new EraError(`Batch assignment out of range for ${name} dimension ${last + 1}`);
    values.forEach((value, i) => {
      coordinates[last] = String(start + i);
      variable.values.set(coordinates.join(":"), value);
    });
  }
  seed(name: string, index: number, value: Value): void {
    const variable = this.values.get(key(name));
    if (!variable) throw new EraError(`Cannot seed unknown variable: ${name}`);
    variable.values.set(String(index), value);
  }
}
