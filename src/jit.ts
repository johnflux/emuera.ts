/**
 * Compiles hot routines to JavaScript. A compiled routine is one `switch (pc)` over the routine's instructions with
 * the interpreter's pc model, so jumps, step counting, error attribution and loop state behave exactly as in
 * `runFrame`. Control flow, assignments and expressions run natively; any other instruction is single-stepped
 * through the interpreter, which makes the routine a generator. Anything the compiler cannot mirror exactly makes it
 * leave the routine (or that instruction) to the interpreter.
 */
import { isPrintData, printVariant, type Compiled, type Instruction } from "./compiler.js";
import { evaluate, repeatString, type EvaluationContext, type Expr } from "./expression.js";
import { parseFormat } from "./format.js";
import { EraError, integer, key, text, type Routine, type Value } from "./model.js";
import { stringWidth } from "./strings.js";
import { GENERATION, indexNumber, indexSymbols, locate, readElement, writeElement, type Resolved, type Variables } from "./variables.js";

type VariableExpr = Extract<Expr, { kind: "variable" }>;
type CaseTest = { kind: "range"; from: string; to: string } | { kind: "compare"; op: string; operand: string } | { kind: "value"; source: string };
export interface JitHost {
  parse(source: string): Expr;
  arguments(source: string): readonly string[];
  assignment(source: string): { reference: VariableExpr; operator: string; value: string };
  caseTests(source: string): CaseTest[];
  callTarget(source: string): { name: string; parameters: string } | null;
  /** Which parameters of a routine are REF parameters. */
  references(name: string): boolean[] | undefined;
  routine(name: string): boolean;
  /** TRYCALLF's test: a routine or built-in function of that name exists. */
  callable(name: string): boolean;
  formNameEnd(source: string): number;
  /** The routines a call by this name runs. */
  targets(name: string): readonly Routine[];
  names(): Iterable<string>;
  /** Analysis results, shared by every runtime of the game. */
  readonly analysis: CallAnalysis;
  /** Debug mode runs DEBUG_FUNC instructions (interpreted); otherwise they compile to nothing. */
  readonly debug?: boolean;
}
export interface CallAnalysis {
  suspends: Map<Routine, boolean>;
  /** Call instruction (op and arguments) to the routines it may run; null when that cannot be determined. */
  targets: Map<string, readonly Routine[] | null>;
  /** Routine names in code unit order, for prefix searches. */
  names?: string[];
}
/** Returned by Runtime.callCompiled when the callee must run as a generator. */
export const ASYNC = Symbol("async");
export interface JitEntry { run: (runtime: unknown, frame: unknown) => unknown; generator: boolean }
interface Site { name: string; bare: (string | undefined)[] }
/**
 * A resolved access site. Bindings live on the routine's static scope; a name owned by a transient per-call scope
 * (DYNAMIC or REF) re-resolves its variable on every access.
 */
interface Binding { g: number; st: number; h: Variables; own: boolean; s: Resolved; c: (number | undefined)[] }

// Names the evaluation context answers before consulting variables.
const SPECIAL = new Set(["LINECOUNT", "__INT_MAX__", "__INT_MIN__", "__FILE__", "__FUNCTION__", "__LINE__", "DRAWLINESTR", "GAMEBASE_VERSION", "RAND"]);
const THRESHOLD = 2;
const LOOP_STATE_OPS = new Set(["FOR", "REPEAT", "NEXT", "REND", "BREAK", "CONTINUE", "RESTART", "GOTO", "GOTOFORM", "TRYGOTO", "TRYGOTOFORM"]);
const LITERALS: Expr[] = [];
const indexLiteral = (i: number): Expr => LITERALS[i] ??= { kind: "literal", value: BigInt(i) };

class Unsupported extends Error {}

const CALL_OPS = new Set([
  "CALL", "JUMP", "TRYCALL", "TRYJUMP", "TRYCCALL", "TRYCJUMP",
  "CALLFORM", "JUMPFORM", "TRYCALLFORM", "TRYJUMPFORM", "TRYCCALLFORM", "TRYCJUMPFORM",
]);
// Every instruction whose interpreter implementation (runFrame) can yield an input request, calls aside. Any other
// instruction runs to completion when single-stepped (output is deferred as `advance` would have collected it).
const INPUT_OPS = new Set([
  "INPUT", "INPUTS", "ONEINPUT", "ONEINPUTS", "TINPUT", "TINPUTS", "TONEINPUT", "TONEINPUTS",
  "BINPUT", "BINPUTS", "INPUTANY",
  "WAIT", "FORCEWAIT", "TWAIT", "WAITANYKEY", "STOPCALLTRAIN", "INPUTMOUSEKEY",
]);
/** Whether running this (non-call) instruction may wait for input. */
function waits(op: string): boolean {
  if (INPUT_OPS.has(op)) return true;
  return op.startsWith("PRINT") && op.endsWith("W") && (!!printVariant(op) || isPrintData(op));
}

// Runtime helpers referenced by generated code; each mirrors `evaluate` or the interpreter exactly.
const H = {
  EraError,
  ASYNC,
  NONE: [] as Expr[],
  key,
  int: integer,
  txt: text,
  ev: evaluate,
  /** Runs one instruction that cannot wait for input through the interpreter. */
  step(R: { drive(generator: unknown): Value | undefined; runFrame(frame: unknown, start: number, single: { next: number }): unknown }, F: unknown, k: number, ST: { next: number }): Value | undefined {
    return R.drive(R.runFrame(F, k, ST));
  },
  tick(R: { currentSource: unknown; steps: number; maxSteps: number }, line: Instruction): void {
    R.currentSource = line;
    if (++R.steps > R.maxSteps) throw new EraError("Instruction limit exceeded between inputs", line);
  },
  scope(scopes: WeakMap<Variables, (Binding | undefined)[]>, V: Variables): (Binding | undefined)[] {
    const home = V.transient ? V.parent! : V;
    let bindings = scopes.get(home);
    if (!bindings) scopes.set(home, bindings = []);
    return bindings;
  },
  b(B: (Binding | undefined)[], j: number, V: Variables, C: EvaluationContext, S: Site[]): Binding {
    let b = B[j];
    if (b === undefined || b.g !== GENERATION.value || b.st !== b.h.stamp) {
      const site = S[j]!;
      const slot = V.slot(site.name, C);
      const home = V.transient ? V.parent! : V;
      const c = site.bare.map((name, i) => name !== undefined && !V.has(name) ? indexSymbols(slot, i, site.bare.length)?.get(name) : undefined);
      return B[j] = { g: GENERATION.value, st: home.stamp, h: home, own: V.transient && V.owns(site.name), s: slot, c };
    }
    if (b.own) b.s = V.slot(S[j]!.name, C);
    return b;
  },
  /** Whether the site's variable is a string, or undefined when resolving it fails (the interpreter then reports it). */
  str(B: (Binding | undefined)[], j: number, V: Variables, C: EvaluationContext, S: Site[]): boolean | undefined {
    try { return H.b(B, j, V, C, S).s.variable.string; } catch { return undefined; }
  },
  ix: (b: Binding, value: Value, index: number, count: number): number => indexNumber(b.s, value, index, count),
  loc: (b: Binding, C: EvaluationContext, count: number, n0: number, n1: number, n2: number): number => locate(b.s, C, count, n0, n1, n2),
  rd: (b: Binding, C: EvaluationContext, count: number, n0: number, n1: number, n2: number): Value => readElement(b.s, locate(b.s, C, count, n0, n1, n2)),
  get: (b: Binding, index: number): Value => readElement(b.s, index),
  wr: (b: Binding, index: number, value: Value): void => writeElement(b.s, index, value),
  rand(R: { random(bound: bigint): bigint }, value: Value): bigint {
    const bound = integer(value);
    if (bound <= 0n) throw new EraError("RAND bound must be a positive integer");
    return R.random(bound);
  },
  fc(R: { expressionFunction(name: string, args: unknown[]): Value }, C: EvaluationContext, name: string, user: boolean, args: (Value | undefined)[]): Value {
    return user ? R.expressionFunction(name, args) : C.call(name, args);
  },
  ret(R: { globals: Variables }, C: EvaluationContext, values: Value[]): void {
    for (let i = 0; i < values.length; i++) R.globals.set("RESULT", [indexLiteral(i)], values[i]!, C);
  },
  omitted(): never { throw new EraError("Omitted argument outside a function call"); },
  cat(acc: string, value: Value): string {
    const result = acc + text(value);
    if (result.length > 1_000_000) throw new EraError("Formatted string exceeds limit");
    return result;
  },
  ip: (value: Value, string: boolean): string => string ? text(value) : integer(value).toString(),
  pad(result: string, widthValue: Value, left: boolean): string {
    const width = integer(widthValue);
    if (width < 0n || width > 1_000_000n) throw new EraError("FORM width out of range");
    const padding = " ".repeat(Math.max(0, Number(width) - stringWidth(result)));
    return left ? result + padding : padding + result;
  },
  truth: (value: Value): bigint => integer(value) !== 0n ? 1n : 0n,
  not: (value: Value): bigint => integer(value) === 0n ? 1n : 0n,
  inv: (value: Value): bigint => BigInt.asIntN(64, ~integer(value)),
  neg: (value: Value): bigint => BigInt.asIntN(64, -integer(value)),
  add(a: Value, b: Value): Value {
    if (typeof a === "string") return a + text(b);
    return BigInt.asIntN(64, a + integer(b));
  },
  sub: (a: Value, b: Value): bigint => BigInt.asIntN(64, integer(a) - integer(b)),
  mul(a: Value, b: Value): Value {
    if (typeof a === "string") return repeatString(a, integer(b));
    if (typeof b === "string") return repeatString(b, a);
    return BigInt.asIntN(64, a * integer(b));
  },
  div(a: Value, b: Value): bigint {
    const x = integer(a), y = integer(b);
    if (y === 0n) throw new EraError("Division by zero");
    return BigInt.asIntN(64, x / y);
  },
  mod(a: Value, b: Value): bigint {
    const x = integer(a), y = integer(b);
    if (y === 0n) throw new EraError("Division by zero");
    return BigInt.asIntN(64, x % y);
  },
  shl(a: Value, b: Value): bigint {
    const x = integer(a), y = integer(b);
    if (y < 0n || y > 63n) throw new EraError("Shift count must be between 0 and 63");
    return BigInt.asIntN(64, x << y);
  },
  shr(a: Value, b: Value): bigint {
    const x = integer(a), y = integer(b);
    if (y < 0n || y > 63n) throw new EraError("Shift count must be between 0 and 63");
    return BigInt.asIntN(64, x >> y);
  },
  and: (a: Value, b: Value): bigint => BigInt.asIntN(64, integer(a) & integer(b)),
  or: (a: Value, b: Value): bigint => BigInt.asIntN(64, integer(a) | integer(b)),
  xor: (a: Value, b: Value): bigint => BigInt.asIntN(64, integer(a) ^ integer(b)),
  lxor: (a: Value, b: Value): bigint => (integer(a) !== 0n) !== (integer(b) !== 0n) ? 1n : 0n,
  nand: (a: Value, b: Value): bigint => { const x = integer(a), y = integer(b); return !(x !== 0n && y !== 0n) ? 1n : 0n; },
  nor: (a: Value, b: Value): bigint => { const x = integer(a), y = integer(b); return !(x !== 0n || y !== 0n) ? 1n : 0n; },
  eq(a: Value, b: Value): bigint { if (typeof a !== typeof b) throw new EraError("Cannot compare strings and integers"); return a === b ? 1n : 0n; },
  ne(a: Value, b: Value): bigint { if (typeof a !== typeof b) throw new EraError("Cannot compare strings and integers"); return a !== b ? 1n : 0n; },
  lt(a: Value, b: Value): bigint { if (typeof a !== typeof b) throw new EraError("Cannot compare strings and integers"); return a < b ? 1n : 0n; },
  gt(a: Value, b: Value): bigint { if (typeof a !== typeof b) throw new EraError("Cannot compare strings and integers"); return a > b ? 1n : 0n; },
  le(a: Value, b: Value): bigint { if (typeof a !== typeof b) throw new EraError("Cannot compare strings and integers"); return a <= b ? 1n : 0n; },
  ge(a: Value, b: Value): bigint { if (typeof a !== typeof b) throw new EraError("Cannot compare strings and integers"); return a >= b ? 1n : 0n; },
  /** A binary operator over two evaluated operands, as `evaluate` computes it (CASE IS tests). */
  bin(op: string, a: Value, b: Value): Value {
    if (op === "&&") return integer(a) === 0n ? 0n : H.and2(a, b);
    if (op === "||") return integer(a) !== 0n ? 1n : H.or2(a, b);
    const helper = BINARY[op];
    if (!helper) throw new EraError(`Unsupported operator: ${op}`);
    return (H[helper] as (a: Value, b: Value) => Value)(a, b);
  },
  and2: (a: Value, b: Value): bigint => { const x = integer(a), y = integer(b); return x !== 0n && y !== 0n ? 1n : 0n; },
  or2: (a: Value, b: Value): bigint => { const x = integer(a), y = integer(b); return x !== 0n || y !== 0n ? 1n : 0n; },
};
const BINARY: Record<string, keyof typeof H> = {
  "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod", "<<": "shl", ">>": "shr", "&": "and", "|": "or", "^": "xor",
  "^^": "lxor", "!&": "nand", "!|": "nor", "==": "eq", "!=": "ne", "<": "lt", ">": "gt", "<=": "le", ">=": "ge",
};

class Generator {
  readonly K: unknown[] = [];
  readonly S: Site[] = [];
  private temps = 0;
  private maxTemps = 0;
  fallback = false;
  stepped = false;
  constructor(private host: JitHost, private compiled: Compiled, private jit: Jit) {}
  /** Temps live only within one instruction, so each instruction reuses them; fewer registers make generators cheaper. */
  temp(): string { this.maxTemps = Math.max(this.maxTemps, this.temps + 1); return `t${this.temps++}`; }
  declarations(): string {
    const names = [...Array(this.maxTemps).keys()].map((i) => `t${i}`);
    return names.length ? `let ${names.join(", ")};` : "";
  }
  constant(value: unknown): string { return `K[${this.K.push(value) - 1}]`; }
  parse(source: string): Expr {
    try { return this.host.parse(source); } catch { throw new Unsupported(); }
  }
  /** Argument splitting; malformed lists are left to the interpreter, which reports them when reached. */
  arguments(source: string): readonly string[] {
    try { return this.host.arguments(source); } catch { throw new Unsupported(); }
  }
  expr(e: Expr): string {
    switch (e.kind) {
      case "literal": return typeof e.value === "bigint" ? `(${e.value}n)` : JSON.stringify(e.value);
      case "variable": return this.read(e);
      case "call": {
        const user = this.temp(), result = this.temp();
        const args = e.args.map((arg) => arg.kind === "omitted" ? "undefined" : this.expr(arg)).join(", ");
        const name = JSON.stringify(e.name);
        // referenceCall decides by name and evaluates arguments itself; otherwise arguments are evaluated here.
        return `((${user} = R.userFunctions.has(${name})) || (${result} = C.referenceCall(${name}, ${this.constant(e.args)})) === undefined ? H.fc(R, C, ${name}, ${user}, [${args}]) : ${result})`;
      }
      case "omitted": return "H.omitted()";
      case "format": return e.parts.reduce((acc, part) => `H.cat(${acc}, ${this.expr(part)})`, `""`);
      case "interpolation": {
        const value = `H.ip(${this.expr(e.expression)}, ${e.string})`;
        return e.width ? `H.pad(${value}, ${this.expr(e.width)}, ${!!e.left})` : value;
      }
      case "conditional": return `(H.int(${this.expr(e.condition)}) !== 0n ? ${this.expr(e.yes)} : ${this.expr(e.no)})`;
      case "increment": return `H.ev(${this.constant(e)}, C)`;
      case "unary": {
        const operand = this.expr(e.operand);
        return e.op === "!" ? `H.not(${operand})` : e.op === "~" ? `H.inv(${operand})` : e.op === "-" ? `H.neg(${operand})` : `H.int(${operand})`;
      }
      case "binary": {
        const a = this.expr(e.left), b = this.expr(e.right);
        if (e.op === "&&") return `(H.int(${a}) === 0n ? 0n : H.truth(${b}))`;
        if (e.op === "||") return `(H.int(${a}) !== 0n ? 1n : H.truth(${b}))`;
        const helper = BINARY[e.op];
        return helper ? `H.${helper}(${a}, ${b})` : `H.bin(${JSON.stringify(e.op)}, ${a}, ${b})`;
      }
    }
  }
  /** A site for a variable access, or undefined when the access needs the generic path. */
  private site(e: VariableExpr): number | undefined {
    if (e.indices.length > 3) return undefined;
    for (const index of e.indices) if (index.kind === "literal" && typeof index.value === "bigint" && !Number.isSafeInteger(Number(index.value))) return undefined;
    const bare = e.indices.map((index) => index.kind === "variable" && !index.indices.length ? index.name : undefined);
    return this.S.push({ name: e.name, bare }) - 1;
  }
  /** Index codes in order; `settled` supplies temps for computed indices already evaluated. */
  private indices(e: VariableExpr, b: string, settled?: (string | undefined)[]): string {
    const codes = e.indices.map((index, i) => {
      if (index.kind === "literal") return typeof index.value === "bigint" ? `${Number(index.value)}` : `H.ix(${b}, ${JSON.stringify(index.value)}, ${i}, ${e.indices.length})`;
      if (index.kind === "variable" && !index.indices.length) return `(${b}.c[${i}] ?? H.ix(${b}, ${this.read(index)}, ${i}, ${e.indices.length}))`;
      return `H.ix(${b}, ${settled?.[i] ?? this.expr(index)}, ${i}, ${e.indices.length})`;
    });
    while (codes.length < 3) codes.push("0");
    return `${e.indices.length}, ${codes.join(", ")}`;
  }
  read(e: VariableExpr): string {
    if (e.name === "RAND" && e.indices.length === 1) return `H.rand(R, ${this.expr(e.indices[0]!)})`;
    const j = SPECIAL.has(e.name) ? undefined : this.site(e);
    if (j === undefined) return `C.get(${JSON.stringify(e.name)}, ${this.constant(e.indices)})`;
    const b = this.temp();
    return `(${b} = H.b(B, ${j}, V, C, S), H.rd(${b}, C, ${this.indices(e, b)}))`;
  }
  /** `this.assign(frame, reference, value)`: the value first, then the address with computed indices evaluated. */
  write(e: VariableExpr, value: string): string {
    const j = this.site(e);
    if (j === undefined) throw new Unsupported();
    const b = this.temp(), v = this.temp();
    return `${v} = ${value}; ${b} = H.b(B, ${j}, V, C, S); H.wr(${b}, H.loc(${b}, C, ${this.indices(e, b)}), ${v});`;
  }
  prologue(k: number): string { return `if (R.finished) return undefined; H.tick(R, L[${k}]);`; }
  single(k: number): string {
    this.stepped = true;
    const line = this.compiled.code[k]!;
    const sync = CALL_OPS.has(line.op) ? !this.jit.callWaits(line) : !waits(line.op);
    if (!sync) this.fallback = true;
    const v = this.temp();
    return `{ ${v} = ${sync ? "H.step(R, F, " + k + ", ST)" : "yield* R.runFrame(F, " + k + ", ST)"}; if (ST.next < 0) return ${v}; if (ST.next !== ${k + 1}) { pc = ST.next; continue; } }`;
  }
  condition(line: Instruction): string { return `H.int(${this.expr(this.parse(line.args))})`; }
  instruction(k: number): string {
    const { code, labels, loops } = this.compiled;
    const line = code[k]!;
    const { op, args, target } = line;
    const jump = (to: number): string => `pc = ${to}; continue;`;
    const blockEnd = (start: number): number => {
      let current = start;
      while (code[current]!.op !== "ENDIF" && code[current]!.op !== "ENDSELECT") current = code[current]!.target;
      return current;
    };
    const state = (start: number): string => `f${start}`;
    const p = this.prologue(k);
    switch (op) {
      case "LABEL": case "ENDIF": case "ENDSELECT": case "DO": case "ENDCATCH": return p;
      case "ASSIGN": return this.assign(k, line);
      case "IF": {
        let code_ = `${p} `;
        let branch = k, first = true;
        while (code[branch]!.op === "IF" || code[branch]!.op === "ELSEIF") {
          const test = `${this.condition(code[branch]!)} !== 0n`;
          code_ += first ? `if (${test}) {} ` : `else if (${test}) { ${jump(branch + 1)} } `;
          first = false;
          branch = code[branch]!.target;
        }
        return `${code_}else { ${jump(branch + 1)} }`;
      }
      case "ELSE": case "ELSEIF": case "CASE": case "CASEELSE": return `${p} ${jump(blockEnd(k) + 1)}`;
      case "SIF": return `${p} if (${this.condition(line)} === 0n) { ${jump(k + 2)} }`;
      case "SELECTCASE": {
        const value = this.temp();
        let body = `${p} ${value} = ${this.expr(this.parse(args))};`;
        let branch = target;
        while (code[branch]!.op !== "ENDSELECT") {
          const candidate = code[branch]!;
          if (candidate.op === "CASEELSE") return `${body} ${jump(branch + 1)}`;
          let tests: CaseTest[];
          try { tests = (candidate.cases ??= this.host.caseTests(candidate.args)) as CaseTest[]; } catch { throw new Unsupported(); }
          const conditions = tests.map((test) => test.kind === "range"
            ? `(H.int(${value}) >= H.int(${this.expr(this.parse(test.from))}) && H.int(${value}) <= H.int(${this.expr(this.parse(test.to))}))`
            : test.kind === "compare" ? `(H.int(H.bin(${JSON.stringify(test.op)}, ${value}, ${this.expr(this.parse(test.operand))})) !== 0n)`
            : `(${value} === ${this.expr(this.parse(test.source))})`);
          if (conditions.length) body += ` if (${conditions.join(" || ")}) { ${jump(branch + 1)} }`;
          branch = candidate.target;
        }
        return `${body} ${jump(branch + 1)}`;
      }
      case "FOR": case "REPEAT": {
        const parts = op === "FOR" ? this.arguments(args) : ["COUNT", "0", args];
        if (parts.length < 3 || parts.length > 4) throw new Unsupported();
        const variable = this.parse(parts[0]!);
        if (variable.kind !== "variable") throw new Unsupported();
        const f = state(k), end = `e${k}`, step = `s${k}`, value = this.temp();
        const stepCode = parts[3] ? `H.int(${this.expr(this.parse(parts[3]))})` : "1n";
        return `${p} if (!${f}) { ${end} = H.int(${this.expr(this.parse(parts[2]!))}); ${step} = ${stepCode}; ` +
          `if (${step} === 0n) throw new H.EraError("FOR step cannot be zero"); ${f} = true; ${this.write(variable, `H.int(${this.expr(this.parse(parts[1]!))})`)} } ` +
          `${value} = H.int(${this.read(variable)}); if (${step} > 0n ? ${value} >= ${end} : ${value} <= ${end}) { ${f} = false; ${jump(target + 1)} }`;
      }
      case "NEXT": case "REND": {
        const opener = code[target]!;
        const parts = opener.op === "FOR" ? this.arguments(opener.args) : ["COUNT"];
        const variable = this.parse(parts[0]!);
        if (variable.kind !== "variable") throw new Unsupported();
        return `${p} if (!${state(target)}) throw new H.EraError("Loop state missing"); ` +
          `${this.write(variable, `BigInt.asIntN(64, H.int(${this.read(variable)}) + s${target})`)} ${jump(target)}`;
      }
      case "WHILE": return `${p} if (${this.condition(line)} === 0n) { ${jump(target + 1)} }`;
      case "WEND": return `${p} ${jump(target)}`;
      case "LOOP": return `${p} if (${this.condition(line)} !== 0n) { ${jump(target)} }`;
      case "BREAK": case "CONTINUE": {
        const loop = loops.filter((l) => l.start < k && l.end > k).sort((a, b) => b.start - a.start)[0];
        if (!loop) throw new Unsupported();
        if (op === "CONTINUE") return `${p} ${jump(loop.end)}`;
        return `${p} ${this.loopState(loop.start) ? `${state(loop.start)} = false; ` : ""}${jump(loop.end + 1)}`;
      }
      case "RESTART": {
        if (args) throw new Unsupported();
        return `${p} ${loops.filter((l) => this.loopState(l.start)).map((l) => `${state(l.start)} = false; `).join("")}${jump(0)}`;
      }
      case "GOTO": {
        const destination = labels.get(key(args));
        if (destination === undefined) throw new Unsupported();
        if (loops.some((l) => destination > l.start && destination <= l.end && !(k > l.start && k <= l.end))) throw new Unsupported();
        const cleared = loops.filter((l) => this.loopState(l.start) && (destination < l.start || destination > l.end));
        return `${p} ${cleared.map((l) => `${state(l.start)} = false; `).join("")}${jump(destination)}`;
      }
      // Computed or optional labels: the interpreter runs the routine (see LOOP_STATE_OPS).
      case "GOTOFORM": case "TRYGOTO": case "TRYGOTOFORM": throw new Unsupported();
      case "RETURN": {
        if (!args) return `${p} return undefined;`;
        let values: string[];
        try { values = this.arguments(args).map((part) => this.expr(this.parse(part))); } catch { return this.single(k); }
        return `${p} H.ret(R, C, [${values.join(", ")}]); return undefined;`;
      }
      case "RETURNF": {
        let value = "";
        if (args) { try { value = this.expr(this.parse(args)); } catch { return this.single(k); } }
        const v = this.temp();
        return `${p} if (!F.returnType) throw new H.EraError("RETURNF outside an expression function"); ` +
          `${v} = ${value || `F.returnType === "string" ? "" : 0n`}; return F.returnType === "string" ? H.txt(${v}) : H.int(${v});`;
      }
      case "CATCH": return `${p} ${jump(target + 1)}`;
      case "DEBUGPRINT": case "DEBUGPRINTL": case "DEBUGPRINTFORM": case "DEBUGPRINTFORML": case "DEBUGCLEAR": case "ASSERT": return this.host.debug ? this.single(k) : p;
      case "CALLF": case "TRYCALLF": {
        let expr: Expr;
        try {
          const call = this.host.callTarget(args);
          if (!call) return this.single(k);
          expr = this.host.parse(`${call.name}(${call.parameters})`);
        } catch { return this.single(k); }
        if (expr.kind !== "call") return this.single(k);
        if (op === "TRYCALLF" && !this.host.callable(expr.name)) return p;
        return `${p} ${this.expr(expr)};`;
      }
      case "CALL": case "JUMP": case "TRYCALL": case "TRYJUMP": case "TRYCCALL": case "TRYCJUMP":
      case "CALLFORM": case "JUMPFORM": case "TRYCALLFORM": case "TRYJUMPFORM": case "TRYCCALLFORM": case "TRYCJUMPFORM":
      case "CALLFORMF": case "TRYCALLFORMF": return this.call(k, line, p);
      default: return this.single(k);
    }
  }
  /** The CALL family as runFrame runs it; plain-function callees are called without generators. */
  private call(k: number, line: Instruction, p: string): string {
    const { op, args, target } = line;
    const missing = /^TRYC(?:CALL|JUMP)/.test(op) ? `pc = ${target + 1}; continue;` : `pc = ${k + 1}; continue;`;
    const name = this.temp(), values = this.temp(), result = this.temp();
    let head: string, parameters: string;
    if (op.includes("FORM")) {
      const split = this.host.formNameEnd(args);
      let format: Expr;
      try { format = parseFormat(args.slice(0, split)); } catch { return this.single(k); }
      parameters = args.slice(split).trim();
      if (parameters.startsWith("(") && parameters.endsWith(")")) parameters = parameters.slice(1, -1);
      else parameters = parameters.replace(/^,/, "");
      parameters = parameters.trim();
      const sources = this.constant(parameters ? this.arguments(parameters) : []);
      head = `${name} = H.key(H.txt(${this.expr(format)}).trim()); if (!${name}) { ${op.startsWith("TRY") ? missing : `throw new H.EraError(${JSON.stringify(`Missing ${op} target`)});`} } ` +
        `if (!R.game.routines.has(${name})) { ${op.startsWith("TRY") ? missing : `throw new H.EraError("Undefined function: " + ${name});`} } ` +
        `${values} = R.callArguments(${name}, ${sources}, F);`;
    } else {
      let call: ReturnType<JitHost["callTarget"]>;
      try { call = this.host.callTarget(args); } catch { return this.single(k); }
      if (!call) return this.single(k);
      if (!this.host.routine(call.name)) return op.startsWith("TRY") ? `${p} ${missing}` : this.single(k);
      let references: boolean[] | undefined;
      try { references = this.host.references(call.name); } catch { return this.single(k); }
      const sources = call.parameters ? this.arguments(call.parameters) : [];
      const codes: string[] = [];
      for (let i = 0; i < sources.length; i++) {
        const source = sources[i]!;
        if (!source) { codes.push("undefined"); continue; }
        const expr = this.parse(source);
        if (!references?.[i]) { codes.push(this.expr(expr)); continue; }
        if (expr.kind !== "variable") return this.single(k);
        codes.push(`{ variables: V, name: ${JSON.stringify(expr.name)}, indices: ${this.constant(expr.indices)}, context: C }`);
      }
      head = `${name} = ${JSON.stringify(call.name)}; ${values} = [${codes.join(", ")}];`;
    }
    if (op.endsWith("F")) return `${p} ${head} R.expressionFunction(${name}, ${values});`;
    const call = this.jit.callWaits(line)
      ? (this.fallback = true, `${result} = R.callCompiled(${name}, ${values}); if (${result} === H.ASYNC) ${result} = yield* R.execute(${name}, ${values});`)
      : `${result} = R.callSync(${name}, ${values});`;
    return `${p} ${head} ${call} ` +
      `if (${result} !== undefined) R.globals.set(typeof ${result} === "string" ? "RESULTS" : "RESULT", H.NONE, ${result}, C);` +
      (op.includes("JUMP") ? ` return ${result};` : "");
  }
  loopState(start: number): boolean { const op = this.compiled.code[start]!.op; return op === "FOR" || op === "REPEAT"; }
  /** ASSIGN as the interpreter runs it: settle computed indices, resolve, the right side, then address and store. */
  private assign(k: number, line: Instruction): string {
    let assignment: ReturnType<JitHost["assignment"]>;
    try { assignment = (line.assignment ??= this.host.assignment(line.args)) as typeof assignment; } catch { return this.single(k); }
    const { reference, operator, value: source } = assignment;
    if (SPECIAL.has(reference.name)) return this.single(k);
    const j = this.site(reference);
    if (j === undefined) return this.single(k);
    const b = this.temp();
    const settled = reference.indices.map((index) => index.kind === "literal" || index.kind === "variable" && !index.indices.length ? undefined : this.temp());
    let settle: string;
    try { settle = reference.indices.map((index, i) => settled[i] ? `${settled[i]} = ${this.expr(index)}; ` : "").join(""); }
    catch (error) { if (error instanceof Unsupported) return this.single(k); throw error; }
    const resolve = `${b} = H.b(B, ${j}, V, C, S);`;
    const branch = (string: boolean): string | undefined => {
      try {
        const at = `H.loc(${b}, C, ${this.indices(reference, b, settled)})`;
        if (operator === "'=" || operator === "=") {
          let rhs: string;
          if (operator === "=" && string) {
            let format: Expr;
            try { format = parseFormat(source); } catch { return undefined; }
            rhs = `H.txt(${this.expr(format)})`;
          } else {
            const parts = this.arguments(source).slice();
            if (parts.at(-1) === "") parts.pop();
            if (parts.length !== 1) return undefined;
            rhs = this.expr(this.parse(parts[0]!));
          }
          const v = this.temp();
          return `${v} = ${rhs}; ${resolve} H.wr(${b}, ${at}, ${v});`;
        }
        if ((operator === "++" || operator === "--") && source) return undefined;
        const helper = BINARY[operator === "++" ? "+" : operator === "--" ? "-" : operator.slice(0, -1)];
        if (!helper) return undefined;
        const rhs = operator === "++" || operator === "--" ? "1n" : this.expr(this.parse(source));
        const v = this.temp(), index = this.temp();
        return `${v} = ${rhs}; ${resolve} ${index} = ${at}; H.wr(${b}, ${index}, H.${helper}(H.get(${b}, ${index}), ${v}));`;
      } catch (error) {
        if (error instanceof Unsupported) return undefined;
        throw error;
      }
    };
    const p = this.prologue(k);
    const forString = branch(true), forInteger = branch(false);
    if (forString !== undefined && forInteger !== undefined)
      return `${p} ${settle}${resolve} if (${b}.s.variable.string) { ${forString} } else { ${forInteger} }`;
    if (forString === undefined && forInteger === undefined) return this.single(k);
    // One form cannot be compiled: test the type first and single-step the other form.
    return `if (H.str(B, ${j}, V, C, S) === ${forString !== undefined}) { ${p} ${settle}${resolve} ${forString ?? forInteger} } else ${this.single(k)}`;
  }
  build(): JitEntry {
    const { code } = this.compiled;
    const cases = code.map((line, k) => {
      this.temps = 0;
      let body: string;
      try { body = this.instruction(k); }
      catch (error) {
        // Instructions that own loop state cannot be single-stepped; the interpreter then runs the whole routine.
        if (!(error instanceof Unsupported) || LOOP_STATE_OPS.has(line.op)) throw error;
        this.temps = 0;
        body = this.single(k);
      }
      return `case ${k}: pc = ${k}; ${body}`;
    });
    const loopStates = code.flatMap((line, k) => line.op === "FOR" || line.op === "REPEAT" ? [`f${k} = false`, `e${k} = 0n`, `s${k} = 0n`] : []);
    const generator = this.fallback;
    const body = [
      `return function${generator ? "*" : ""} compiled(R, F) {`,
      `const C = F.context, V = F.variables, B = H.scope(SCOPES, V);`,
      this.stepped ? `const ST = { next: 0 };` : "",
      `let pc = 0; ${this.declarations()}`,
      loopStates.length ? `let ${loopStates.join(", ")};` : "",
      `try { for (;;) switch (pc) {`,
      ...cases,
      `case ${code.length}: return undefined;`,
      `default: throw new Error("Invalid compiled pc " + pc);`,
      `} } catch (e) {`,
      `if (e instanceof H.EraError) { const line = L[pc]; if (!e.source) e.source = line; else if (e.source !== line && e.trace.length < 30) e.trace.push(line); }`,
      `throw e; }`,
      `};`,
      `//# sourceURL=jit/${encodeURIComponent(code[0] ? `${code[0].file}:${code[0].line}` : "empty")}`,
    ].join("\n");
    const factory = new Function("H", "K", "S", "L", "SCOPES", body) as (...args: unknown[]) => JitEntry["run"];
    return { run: factory(H, this.K, this.S, code, new WeakMap()), generator };
  }
}

export class Jit {
  compiledCount = 0;
  rejected = 0;
  compileMs = 0;
  readonly errors: unknown[] = [];
  constructor(private host: JitHost) {}
  /** The compiled form of a routine once it is hot; null after a failed attempt. */
  entry(compiled: Compiled): JitEntry | undefined {
    const existing = compiled.jit;
    if (existing !== undefined) return existing ?? undefined;
    if ((compiled.calls = (compiled.calls ?? 0) + 1) < THRESHOLD) return undefined;
    const started = performance.now();
    try { compiled.jit = new Generator(this.host, compiled, this).build(); this.compiledCount++; }
    catch (error) {
      // Unsupported constructs are expected; anything else is a compiler bug, and the interpreter still runs the routine.
      if (!(error instanceof Unsupported)) this.errors.push(error);
      compiled.jit = null;
      this.rejected++;
    }
    this.compileMs += performance.now() - started;
    return compiled.jit ?? undefined;
  }
  /** The routines a call instruction may run; null when that cannot be determined. */
  private targets(op: string, args: string): readonly Routine[] | null {
    const id = `${op} ${args}`;
    const { targets } = this.host.analysis;
    let result = targets.get(id);
    if (result === undefined) targets.set(id, result = this.findTargets(op, args));
    return result;
  }
  private findTargets(op: string, args: string): readonly Routine[] | null {
    if (!op.includes("FORM")) {
      let call: ReturnType<JitHost["callTarget"]>;
      try { call = this.host.callTarget(args); } catch { return null; }
      // A missing target is an error or, for TRY calls, skipped; neither runs anything.
      return call ? this.host.targets(call.name) : null;
    }
    // A formatted name may be any routine matching its literal parts.
    let parts: string[] | null;
    try { parts = formGlob(args.slice(0, this.host.formNameEnd(args)).trim()); } catch { return null; }
    if (!parts) return null;
    const glob = `FORM ${parts.join("\u0000")}`;
    let result = this.host.analysis.targets.get(glob);
    if (result === undefined) {
      const routines: Routine[] = [];
      const names = this.host.analysis.names ??= [...this.host.names()].sort();
      const prefix = parts[0]!;
      let low = 0, high = names.length;
      while (low < high) { const mid = (low + high) >> 1; if (names[mid]! < prefix) low = mid + 1; else high = mid; }
      for (let i = low; i < names.length && names[i]!.startsWith(prefix); i++)
        if (globMatches(parts, names[i]!)) routines.push(...this.host.targets(names[i]!));
      this.host.analysis.targets.set(glob, result = routines);
    }
    return result;
  }
  /** Whether a call instruction may wait for input. */
  callWaits(line: Instruction): boolean {
    const targets = this.targets(line.op, line.args);
    return targets === null || targets.some((target) => this.suspends(target));
  }
  /** Whether running a routine may wait for input: directly, or through the routines it calls. */
  suspends(root: Routine): boolean {
    const known = this.host.analysis.suspends;
    const cached = known.get(root);
    if (cached !== undefined) return cached;
    // Explore the unresolved call graph, then mark routines that wait directly and everything that reaches them.
    const callers = new Map<Routine, Routine[]>();
    const seen = new Set<Routine>([root]);
    const waiting: Routine[] = [];
    const stack = [root];
    while (stack.length) {
      const routine = stack.pop()!;
      let direct = false;
      for (const { text } of routine.lines) {
        // The instruction is the first token, as compile() classifies it.
        const match = /^(\S+)\s*(.*)$/.exec(text);
        if (!match) continue;
        const op = key(match[1]!);
        if (!CALL_OPS.has(op)) { if (waits(op)) { direct = true; break; } continue; }
        const targets = this.targets(op, match[2]!);
        if (!targets) { direct = true; break; }
        for (const target of targets) {
          const state = known.get(target);
          if (state) { direct = true; break; }
          if (state === false) continue;
          let list = callers.get(target);
          if (!list) callers.set(target, list = []);
          list.push(routine);
          if (!seen.has(target)) { seen.add(target); stack.push(target); }
        }
        if (direct) break;
      }
      if (direct) waiting.push(routine);
    }
    for (const routine of waiting) known.set(routine, true);
    while (waiting.length) {
      for (const caller of callers.get(waiting.pop()!) ?? []) if (!known.get(caller)) { known.set(caller, true); waiting.push(caller); }
    }
    for (const routine of seen) if (!known.has(routine)) known.set(routine, false);
    return known.get(root)!;
  }
}
/**
 * The literal parts of a formatted call name, split where values are interpolated: the name may be any routine whose
 * name starts with the first part, ends with the last and contains the rest in order. Null for names it cannot bound.
 */
function formGlob(source: string): string[] | null {
  const parts: string[] = [];
  let literal = "";
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (char === "\\") return null;
    if (char === "{" || char === "%") {
      let depth = 0, end = i;
      for (; end < source.length; end++) {
        if (char === "{" && source[end] === "{") depth++;
        else if (source[end] === (char === "{" ? "}" : "%") && (char === "%" ? end > i : --depth === 0)) break;
      }
      if (end >= source.length) return null;
      parts.push(key(literal));
      literal = "";
      i = end;
      continue;
    }
    literal += char;
  }
  parts.push(key(literal));
  // A name with no literal text could be any routine.
  return parts.join("") ? parts : null;
}
function globMatches(parts: readonly string[], name: string): boolean {
  if (parts.length === 1) return name === parts[0];
  const first = parts[0]!, last = parts.at(-1)!;
  if (!name.startsWith(first) || name.length < first.length + last.length || !name.endsWith(last)) return false;
  let at = first.length;
  const end = name.length - last.length;
  for (let i = 1; i < parts.length - 1; i++) {
    const found = name.indexOf(parts[i]!, at);
    if (found < 0 || found + parts[i]!.length > end) return false;
    at = found + parts[i]!.length;
  }
  return true;
}
