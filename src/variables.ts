import { evaluate, parseExpression, type EvaluationContext, type Expr } from "./expression.js";
import type { Game } from "./loader.js";
import { EraError, integer, key, splitArguments, type Line, type Value } from "./model.js";

interface Variable {
  string: boolean;
  constant: boolean;
  dimensions: number[];
  values: Map<string, Value>;
}
export class Variables {
  private values = new Map<string, Variable>();
  private declarations = new Map<string, Line>();
  private initializing = new Set<string>();
  constructor(private game: Game, public parent?: Variables) {}
  define(name: string, string = false, dimensions = [1000], constant = false): void {
    this.values.set(key(name), { string, dimensions, constant, values: new Map() });
  }
  declare(line: Line): void {
    const match = /^#DIM(S)?\s+((?:(?:CONST|DYNAMIC|GLOBAL|SAVEDATA|REF|CHARADATA)\s+)*)([^\s,=]+)(.*)$/i.exec(line.text);
    if (!match) throw new EraError(`Unsupported declaration: ${line.text}`, line);
    const name = key(match[3]!);
    if (this.values.has(name) || this.declarations.has(name)) throw new EraError(`Duplicate variable: ${name}`, line);
    this.declarations.set(name, line);
  }
  has(name: string): boolean {
    return this.values.has(key(name)) || this.declarations.has(key(name)) || !!this.parent?.has(name);
  }
  private resolve(name: string, context: EvaluationContext): Variable {
    name = key(name);
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
      if (modifiers.includes("REF") || modifiers.includes("CHARADATA")) throw new EraError(`Unsupported declaration modifier for ${name}`, line);
      const rest = match[4]!.trim();
      const equal = rest.indexOf("=");
      const sizes = (equal < 0 ? rest : rest.slice(0, equal)).trim().replace(/^,/, "");
      const initial = equal < 0 ? [] : splitArguments(rest.slice(equal + 1)).map((x) => evaluate(parseExpression(x), context));
      const dimensions = sizes ? splitArguments(sizes).map((x) => Number(integer(evaluate(parseExpression(x), context)))) : [Math.max(1, initial.length)];
      if (dimensions.length > 3 || dimensions.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 1_000_000))
        throw new EraError(`Invalid dimensions for ${name}`, line);
      if (initial.length && (dimensions.length > 1 || initial.length > dimensions[0]!)) throw new EraError(`Invalid initializer for ${name}`, line);
      if (modifiers.includes("CONST") && (!initial.length || initial.length !== dimensions[0]!))
        throw new EraError(`Constant dimensions must match initial values: ${name}`, line);
      const variable: Variable = { string: !!match[1], constant: modifiers.includes("CONST"), dimensions, values: new Map() };
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
    const values = indices.map((expr) => {
      const symbols = this.game.names.get(key(name).replace(/NAME$/, ""));
      if (expr.kind === "variable" && !expr.indices.length && !this.has(expr.name) && symbols?.has(expr.name))
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
    if (!values.length) values.push(0);
    if (values.length !== variable.dimensions.length) throw new EraError(`Expected ${variable.dimensions.length} indices for ${name}, received ${values.length}`);
    values.forEach((n, i) => {
      if (n < 0 || n >= variable.dimensions[i]!) throw new EraError(`Index ${n} out of range for ${name} dimension ${i + 1}`);
    });
    return { variable, address: values.join(":") };
  }
  get(name: string, indices: Expr[], context: EvaluationContext): Value {
    const { variable, address } = this.address(name, indices, context);
    return variable.values.get(address) ?? (variable.string ? "" : 0n);
  }
  isString(name: string, context: EvaluationContext): boolean { return this.resolve(name, context).string; }
  set(name: string, indices: Expr[], value: Value, context: EvaluationContext): void {
    this.setMany(name, indices, [value], context);
  }
  setMany(name: string, indices: Expr[], values: Value[], context: EvaluationContext): void {
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
