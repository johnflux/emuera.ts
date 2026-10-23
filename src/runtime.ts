import { compile, type Compiled, type Instruction } from "./compiler.js";
import { evaluate, parseExpression, type EvaluationContext, type Expr } from "./expression.js";
import type { Game } from "./loader.js";
import { EraError, integer, key, splitArguments, text, type Diagnostic, type Routine, type Source, type Value } from "./model.js";
import { Variables } from "./variables.js";

export interface Style { color: string; background: string; alignment: "left" | "center" | "right" }
export type Output =
  | { type: "text" | "html"; text: string; newline: boolean; style: Style }
  | { type: "button"; text: string; value: string; style: Style }
  | { type: "clear"; count: number };
export interface InputRequest { kind: "integer" | "string" | "wait" }
type Yield = { output: Output } | { input: InputRequest };
export interface Snapshot {
  status: "waiting" | "halted" | "error";
  output: Output[];
  input: InputRequest | null;
  error: Diagnostic | null;
}
interface Frame { variables: Variables; compiled: Compiled; context: EvaluationContext }
interface LoopState { variable: Expr; end: bigint; step: bigint }
const literal = (value: Value): Expr => ({ kind: "literal", value });

export class Runtime {
  private globals: Variables;
  private statics = new Map<Routine, Variables>();
  private activeRoutines = new Set<string>();
  private compiled = new Map<Routine, Compiled>();
  private iterator: Generator<Yield, void, string> | undefined;
  private pending: InputRequest | null = null;
  private steps = 0;
  private depth = 0;
  private lineCount = 0;
  private style: Style = { color: "#ffffff", background: "#000000", alignment: "left" };
  private finished = false;
  private expressionCache = new Map<string, Expr>();
  private currentSource: Source | undefined;
  constructor(public game: Game, private maxSteps = 50_000) {
    this.globals = new Variables(game);
    const numeric = ["RESULT", "FLAG", "TFLAG", "GLOBAL", "DAY", "TIME", "MONEY", "ITEM", "TARGET", "MASTER", "PLAYER", "ASSI", "COUNT", ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ")];
    numeric.forEach((name) => this.globals.define(name, false, [name === "FLAG" ? 10000 : 1000]));
    ["STR", "SAVESTR", "GLOBALS", "RESULTS", "WINDOW_TITLE", "GAMEBASE_TITLE", "GAMEBASE_INFO", "GAMEBASE_YEAR"].forEach((name) => this.globals.define(name, true));
    for (const name of ["GAMEBASE_VERSION", "GAMEBASE_CODE", "CHARANUM"]) this.globals.define(name);
    const base = new Map([...(game.tables.get("GAMEBASE")?.values() ?? [])].map((row) => [row[0], row[1] ?? ""]));
    for (const [variable, csv] of [["GAMEBASE_TITLE", "タイトル"], ["GAMEBASE_INFO", "追加情報"], ["GAMEBASE_YEAR", "製作年"]])
      this.globals.seed(variable!, 0, base.get(csv!) ?? "");
    for (const [variable, csv] of [["GAMEBASE_CODE", "コード"], ["GAMEBASE_VERSION", "バージョン"]]) {
      const value = base.get(csv!);
      if (value && /^-?\d+$/.test(value)) this.globals.seed(variable!, 0, BigInt(value));
      // Non-numeric game versions are reported as unsupported when accessed.
    }
    for (const [name, table] of game.tables) {
      if (name.includes("/") || name === "GAMEBASE" || !table.size) continue;
      const size = Math.max(...table.keys()) + 1;
      if (size > 1_000_000) continue;
      this.globals.define(`${name}NAME`, true, [size]);
      for (const [index, row] of table) this.globals.seed(`${name}NAME`, index, row[0] ?? "");
    }
    for (const line of game.headers) {
      if (/^#DIMS?\s/i.test(line.text)) this.globals.declare(line);
      // Other header directives are diagnosed by the compatibility report.
    }
  }
  start(entry = "SYSTEM_TITLE"): Snapshot {
    if (this.iterator) throw new EraError("Runtime has already started");
    this.iterator = this.execute(key(entry), []);
    return this.advance();
  }
  input(value: string): Snapshot {
    if (!this.pending) throw new EraError("Runtime is not waiting for input");
    if (this.pending.kind === "integer" && !/^-?\d+$/.test(value.trim())) throw new EraError("Enter a whole number");
    if (this.pending.kind === "integer") {
      const n = BigInt(value.trim());
      if (n < -(1n << 63n) || n >= (1n << 63n)) throw new EraError("Input is outside signed 64-bit range");
    }
    this.pending = null;
    return this.advance(value);
  }
  private advance(input = ""): Snapshot {
    if (!this.iterator || this.finished) throw new EraError("Runtime is not running");
    this.steps = 0;
    const output: Output[] = [];
    let bytes = 0;
    try {
      while (true) {
        const next = this.iterator.next(input);
        input = "";
        if (next.done) {
          this.finished = true;
          return { status: "halted", output, input: null, error: null };
        }
        if ("input" in next.value) {
          this.pending = next.value.input;
          return { status: "waiting", output, input: this.pending, error: null };
        }
        bytes += JSON.stringify(next.value.output).length;
        if (bytes > 2_000_000) throw new EraError("Output limit exceeded between inputs", this.currentSource);
        output.push(next.value.output);
      }
    } catch (error) {
      if (!(error instanceof EraError)) throw error;
      this.finished = true;
      this.iterator.return();
      return { status: "error", output, input: null, error: error.diagnostic() };
    }
  }
  private parse(source: string): Expr {
    let expr = this.expressionCache.get(source);
    if (!expr) { expr = parseExpression(source); this.expressionCache.set(source, expr); }
    return expr;
  }
  private context(variables: Variables): EvaluationContext {
    const context: EvaluationContext = {
      get: (name, indices) => {
        if (name === "LINECOUNT") return BigInt(this.lineCount);
        if (name === "GAMEBASE_VERSION") {
          const version = [...(this.game.tables.get("GAMEBASE")?.values() ?? [])].find((row) => row[0] === "バージョン")?.[1];
          if (version && !/^-?\d+$/.test(version)) throw new EraError(`Non-numeric GameBase version is not yet supported: ${version}`);
        }
        if (name === "RAND") throw new EraError("RAND is not yet supported");
        return variables.get(name, indices, context);
      },
      call: (name, args) => {
        const arities: Record<string, [number, number]> = {
          ABS: [1, 1], MIN: [1, 1000], MAX: [1, 1000], LIMIT: [3, 3],
          TOSTR: [1, 2], TOINT: [1, 1], STRLENU: [1, 1], MAXWIDTH: [0, 0],
        };
        const arity = arities[name];
        if (arity && (args.length < arity[0] || args.length > arity[1]))
          throw new EraError(`Invalid number of arguments for ${name}`);
        const n = (i: number): bigint => integer(args[i] ?? (() => { throw new EraError(`Missing argument for ${name}`); })());
        const s = (i: number): string => text(args[i] ?? (() => { throw new EraError(`Missing argument for ${name}`); })());
        switch (name) {
          case "ABS": return BigInt.asIntN(64, n(0) < 0n ? -n(0) : n(0));
          case "MIN": case "MAX":
            if (!args.length) throw new EraError(`${name} requires arguments`);
            return args.map(integer).reduce((a, b) => name === "MIN" ? (a < b ? a : b) : (a > b ? a : b));
          case "LIMIT":
            if (n(1) > n(2)) throw new EraError("LIMIT minimum exceeds maximum");
            return n(0) < n(1) ? n(1) : n(0) > n(2) ? n(2) : n(0);
          case "TOSTR": {
            const value = n(0).toString();
            if (args.length < 2) return value;
            const format = s(1);
            if (!/^0{1,100}$/.test(format)) throw new EraError(`Unsupported TOSTR format: ${format}`);
            return n(0) < 0n ? "-" + value.slice(1).padStart(format.length, "0") : value.padStart(format.length, "0");
          }
          case "TOINT": {
            if (!/^-?\d+$/.test(s(0))) throw new EraError("TOINT requires an integer string");
            return BigInt.asIntN(64, BigInt(s(0)));
          }
          case "STRLENU": return BigInt([...s(0)].length);
          case "MAXWIDTH": return 120n;
          default: throw new EraError(`Unsupported expression function: ${name}`);
        }
      },
    };
    return context;
  }
  private assign(frame: Frame, reference: Expr, value: Value): void {
    if (reference.kind !== "variable") throw new EraError("Assignment target must be a variable");
    frame.variables.set(reference.name, reference.indices, value, frame.context);
  }
  private formatted(source: string, frame: Frame): string {
    let result = "";
    for (let i = 0; i < source.length;) {
      const c = source[i]!;
      if (c === "\\" && ["{", "}", "%", "\\"].includes(source[i + 1] ?? "")) { result += source[i + 1]; i += 2; continue; }
      if (c !== "{" && c !== "%") { result += c; i++; continue; }
      const close = c === "{" ? "}" : "%";
      let end = i + 1, quoted = false, escaped = false;
      for (; end < source.length; end++) {
        const ch = source[end]!;
        if (escaped) { escaped = false; continue; }
        if (ch === "\\" && quoted) { escaped = true; continue; }
        if (ch === '"') quoted = !quoted;
        if (ch === close && !quoted) break;
      }
      if (end === source.length) throw new EraError(`Unclosed ${c} interpolation`);
      const value = evaluate(this.parse(source.slice(i + 1, end)), frame.context);
      result += c === "{" ? integer(value).toString() : text(value);
      i = end + 1;
    }
    return result;
  }
  private emit(type: "text" | "html", value: string, newline: boolean): Yield {
    if (value.length > 1_000_000) throw new EraError("Output string exceeds limit");
    this.lineCount += (value.match(/\n/g)?.length ?? 0) + (newline ? 1 : 0);
    return { output: { type, text: value, newline, style: { ...this.style } } };
  }
  private *execute(name: string, args: Value[]): Generator<Yield, void, string> {
    if (++this.depth > 128) throw new EraError("Call depth limit exceeded", this.currentSource);
    if (this.activeRoutines.has(name)) throw new EraError(`Recursive calls are not yet supported: ${name}`, this.currentSource);
    this.activeRoutines.add(name);
    try {
      const routines = this.game.routines.get(name);
      if (!routines?.length) throw new EraError(`Undefined function: ${name}`, this.currentSource);
      if (routines.length !== 1) throw new EraError(`Multiple definitions/event dispatch not yet supported: ${name}`, this.currentSource);
      const routine = routines[0]!;
      let compiled = this.compiled.get(routine);
      if (!compiled) { compiled = compile(routine); this.compiled.set(routine, compiled); }
      let variables = this.statics.get(routine);
      if (!variables) {
        variables = new Variables(this.game, this.globals);
        for (const variable of ["LOCAL", "ARG"]) variables.define(variable);
        for (const variable of ["LOCALS", "ARGS"]) variables.define(variable, true);
        for (const directive of routine.directives) {
          if (!/^#DIMS?\s/i.test(directive.text)) throw new EraError(`Unsupported function directive: ${directive.text}`, directive);
          if (/\bDYNAMIC\b/i.test(directive.text)) throw new EraError("DYNAMIC private variables are not yet supported", directive);
          variables.declare(directive);
        }
        this.statics.set(routine, variables);
      }
      const context = this.context(variables);
      const frame: Frame = { variables, compiled, context };
      if (args.length > routine.parameters.length) throw new EraError(`Too many arguments for ${name}`, routine);
      for (let i = 0; i < routine.parameters.length; i++) {
        const parameter = routine.parameters[i]!;
        const equal = parameter.indexOf("=");
        const reference = this.parse(equal < 0 ? parameter : parameter.slice(0, equal).trim());
        if (reference.kind !== "variable") throw new EraError("Parameter target must be a variable", routine);
        const value = args[i] ?? (equal >= 0 ? evaluate(this.parse(parameter.slice(equal + 1)), context)
          : variables.isString(reference.name, context) ? "" : 0n);
        this.assign(frame, reference, value);
      }
      yield* this.runFrame(frame);
    } finally { this.depth--; this.activeRoutines.delete(name); }
  }
  private *runFrame(frame: Frame): Generator<Yield, void, string> {
    const { code, labels, loops } = frame.compiled;
    const ev = (source: string): Value => evaluate(this.parse(source), frame.context);
    const num = (source: string): bigint => integer(ev(source));
    const loopStates = new Map<number, LoopState>();
    for (let pc = 0; pc < code.length && !this.finished;) {
      const line = code[pc]!;
      this.currentSource = line;
      if (++this.steps > this.maxSteps) throw new EraError("Instruction limit exceeded between inputs", line);
      let next = pc + 1;
      try {
        const { op, args, target } = line;
        if (op.startsWith("PRINT") && !["PRINTBUTTON", "PRINTBUTTONC"].includes(op)) {
          const variant = op.slice(5);
          if (!["", "L", "W", "FORM", "FORML", "FORMW", "V", "VL", "VW", "S", "SL", "SW"].includes(variant)) throw new EraError(`Unsupported instruction: ${op}`);
          const value = variant.startsWith("FORM") ? this.formatted(args, frame) : /^[VS]/.test(variant) ? String(ev(args)) : args;
          yield this.emit("text", value, /[LW]$/.test(op));
          if (op.endsWith("W")) yield { input: { kind: "wait" } };
        } else switch (op) {
          case "LABEL": case "ENDIF": case "ENDSELECT": break;
          case "ASSIGN": {
            const match = /^(.*?)\s*(\+\+|--|'=|[+\-*/%&|^]?=)\s*(.*)$/.exec(args);
            if (!match) throw new EraError("Invalid assignment");
            const reference = this.parse(match[1]!.trim());
            const operator = match[2]!;
            if (reference.kind !== "variable") throw new EraError("Invalid assignment target");
            const string = frame.variables.isString(reference.name, frame.context);
            if (operator === "'=" || (operator === "=" && !string)) {
              const values = splitArguments(match[3]!).map(ev);
              frame.variables.setMany(reference.name, reference.indices, values, frame.context);
              break;
            }
            const rhs = operator === "++" || operator === "--" ? 1n : operator === "=" && string
              ? this.formatted(match[3]!, frame) : ev(match[3]!);
            if ((operator === "++" || operator === "--") && match[3]) throw new EraError("Unexpected text after increment/decrement");
            const value = operator === "=" || operator === "'=" ? rhs : evaluate({
              kind: "binary", op: operator === "++" ? "+" : operator === "--" ? "-" : operator[0]!,
              left: literal(evaluate(reference, frame.context)), right: literal(rhs),
            }, frame.context);
            this.assign(frame, reference, value);
            break;
          }
          case "HTML_PRINT": yield this.emit("html", text(ev(args)), true); break;
          case "PRINTBUTTON": case "PRINTBUTTONC": {
            const parts = splitArguments(args);
            if (parts.length !== 2) throw new EraError(`${op} expects label and value`);
            yield { output: { type: "button", text: text(ev(parts[0]!)), value: String(ev(parts[1]!)), style: { ...this.style } } };
            break;
          }
          case "DRAWLINE": yield this.emit("text", "-".repeat(80), true); break;
          case "CUSTOMDRAWLINE": yield this.emit("text", args.repeat(Math.ceil(80 / Math.max(1, args.length))).slice(0, 80), true); break;
          case "CLEARLINE": {
            const count = Number(num(args));
            if (count < 0 || !Number.isSafeInteger(count)) throw new EraError("Invalid CLEARLINE count");
            this.lineCount = Math.max(0, this.lineCount - count);
            yield { output: { type: "clear", count } };
            break;
          }
          case "IF": {
            let branch = pc;
            while (["IF", "ELSEIF"].includes(code[branch]!.op) && num(code[branch]!.args) === 0n)
              branch = code[branch]!.target;
            next = branch + 1;
            break;
          }
          case "ELSE": case "ELSEIF": next = this.blockEnd(code, pc) + 1; break;
          case "SIF": if (num(args) === 0n) next++; break;
          case "SELECTCASE": {
            const value = ev(args);
            let branch = target;
            while (code[branch]!.op !== "ENDSELECT") {
              const candidate = code[branch]!;
              if (candidate.op === "CASEELSE" || splitArguments(candidate.args).some((part) => this.matchesCase(value, part, ev))) break;
              branch = candidate.target;
            }
            next = branch + 1;
            break;
          }
          case "CASE": case "CASEELSE": next = this.blockEnd(code, pc) + 1; break;
          case "FOR": case "REPEAT": {
            const parts = op === "FOR" ? splitArguments(args) : ["COUNT", "0", args];
            if (parts.length < 3 || parts.length > 4) throw new EraError("FOR expects variable, start, end[, step]");
            let state = loopStates.get(pc);
            if (!state) {
              state = { variable: this.parse(parts[0]!), end: num(parts[2]!), step: parts[3] ? num(parts[3]) : 1n };
              if (state.step === 0n) throw new EraError("FOR step cannot be zero");
              loopStates.set(pc, state);
              this.assign(frame, state.variable, num(parts[1]!));
            }
            const value = integer(evaluate(state.variable, frame.context));
            if (state.step > 0n ? value >= state.end : value <= state.end) { loopStates.delete(pc); next = target + 1; }
            break;
          }
          case "NEXT": case "REND": {
            const state = loopStates.get(target);
            if (!state) throw new EraError("Loop state missing");
            this.assign(frame, state.variable, BigInt.asIntN(64, integer(evaluate(state.variable, frame.context)) + state.step));
            next = target; break;
          }
          case "WHILE": if (num(args) === 0n) next = target + 1; break;
          case "WEND": next = target; break;
          case "DO": break;
          case "LOOP": if (num(args) !== 0n) next = target; break;
          case "BREAK": case "CONTINUE": {
            const loop = loops.filter((loop) => loop.start < pc && loop.end > pc).sort((a, b) => b.start - a.start)[0];
            if (!loop) throw new EraError(`${op} outside a loop`);
            if (op === "BREAK") { next = loop.end + 1; loopStates.delete(loop.start); }
            else next = loop.end;
            break;
          }
          case "GOTO": {
            const destination = labels.get(key(args));
            if (destination === undefined) throw new EraError(`Unknown label: ${args}`);
            if (loops.some((loop) => destination > loop.start && destination <= loop.end && !(pc > loop.start && pc <= loop.end)))
              throw new EraError("GOTO into a loop is not supported");
            for (const start of loopStates.keys()) {
              const loop = loops.find((l) => l.start === start)!;
              if (destination < start || destination > loop.end) loopStates.delete(start);
            }
            next = destination; break;
          }
          case "CALL": case "JUMP": {
            const match = /^([^\s,(]+)\s*(.*)$/.exec(args);
            if (!match) throw new EraError("Missing CALL target");
            let rest = match[2]!.trim();
            if (rest.startsWith("(") && rest.endsWith(")")) rest = rest.slice(1, -1);
            else rest = rest.replace(/^,/, "");
            const values = rest.trim() ? splitArguments(rest).map(ev) : [];
            yield* this.execute(key(match[1]!), values);
            if (op === "JUMP") return;
            break;
          }
          case "RETURN":
            if (args) splitArguments(args).map(ev).forEach((value, i) => this.globals.set("RESULT", [literal(BigInt(i))], value, frame.context));
            return;
          case "QUIT": this.finished = true; return;
          case "INPUT": case "INPUTS": {
            if (args) throw new EraError(`Arguments for ${op} are not yet supported`);
            const value = yield { input: { kind: op === "INPUT" ? "integer" : "string" } };
            this.globals.set(op === "INPUT" ? "RESULT" : "RESULTS", [], op === "INPUT" ? BigInt(value.trim()) : value, frame.context);
            break;
          }
          case "WAIT": case "FORCEWAIT": yield { input: { kind: "wait" } }; break;
          case "SETCOLOR": case "SETBGCOLOR": {
            const channels = splitArguments(args).map(num);
            if (channels.length !== 1 && channels.length !== 3) throw new EraError(`${op} expects RGB integer or three channels`);
            if (channels.some((c) => c < 0n || c > (channels.length === 1 ? 0xffffffn : 255n))) throw new EraError("Color out of range");
            const color = channels.length === 1 ? channels[0]! : (channels[0]! << 16n) | (channels[1]! << 8n) | channels[2]!;
            this.style[op === "SETCOLOR" ? "color" : "background"] = "#" + color.toString(16).padStart(6, "0"); break;
          }
          case "RESETCOLOR": this.style.color = "#ffffff"; break;
          case "RESETBGCOLOR": this.style.background = "#000000"; break;
          case "ALIGNMENT": {
            const alignment = args.toLowerCase();
            if (alignment !== "left" && alignment !== "center" && alignment !== "right") throw new EraError(`Invalid alignment: ${args}`);
            this.style.alignment = alignment; break;
          }
          case "THROW": throw new EraError(this.formatted(args, frame));
          default: throw new EraError(`Unsupported instruction: ${op}`);
        }
      } catch (error) {
        if (error instanceof EraError) { error.source ??= line; throw error; }
        throw error;
      }
      pc = next;
    }
  }
  private blockEnd(code: Instruction[], start: number): number {
    let current = start;
    while (!["ENDIF", "ENDSELECT"].includes(code[current]!.op)) current = code[current]!.target;
    return current;
  }
  private matchesCase(value: Value, source: string, ev: (source: string) => Value): boolean {
    const range = /^(.*?)\s+TO\s+(.*)$/i.exec(source);
    if (range) return integer(value) >= integer(ev(range[1]!)) && integer(value) <= integer(ev(range[2]!));
    const comparison = /^IS\s+(==|!=|<=|>=|<|>)\s*(.*)$/i.exec(source);
    if (comparison) return integer(evaluate({ kind: "binary", op: comparison[1]!, left: literal(value), right: literal(ev(comparison[2]!)) }, { get() { throw new EraError("Unexpected variable"); }, call() { throw new EraError("Unexpected call"); } })) !== 0n;
    return value === ev(source);
  }
}
