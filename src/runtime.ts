import { compile, type Compiled, type Instruction } from "./compiler.js";
import { evaluate, parseExpression, type EvaluationContext, type Expr } from "./expression.js";
import type { Game } from "./loader.js";
import { EraError, integer, key, splitArguments, text, type Diagnostic, type Routine, type Source, type Value } from "./model.js";
import { Variables } from "./variables.js";
import { parseFormat } from "./format.js";
import { MemoryGlobalStore, type GlobalStore } from "./storage.js";
import { randomInt } from "node:crypto";
import { escapeHtml, plainHtml } from "./html.js";

export interface Style { color: string; background: string; alignment: "left" | "center" | "right"; fontStyle: number }
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
  title: string;
}
interface Frame { variables: Variables; compiled: Compiled; context: EvaluationContext; returnType?: "integer" | "string" }
interface LoopState { variable: Expr; end: bigint; step: bigint }
const literal = (value: Value): Expr => ({ kind: "literal", value });
export interface RuntimeOptions { store?: GlobalStore; columns?: number }

export class Runtime {
  private globals: Variables;
  private statics = new Map<Routine, Variables>();
  private activeRoutines = new Set<string>();
  private compiled = new Map<Routine, Compiled>();
  private iterator: Generator<Yield, Value | undefined, string> | undefined;
  private pending: InputRequest | null = null;
  private steps = 0;
  private depth = 0;
  private lineCount = 0;
  private style: Style = { color: "#ffffff", background: "#000000", alignment: "left", fontStyle: 0 };
  private finished = false;
  private expressionCache = new Map<string, Expr>();
  private currentSource: Source | undefined;
  private maps = new Map<string, Map<string, string>>();
  private store: GlobalStore;
  private columns: number;
  private printingHtml = "";
  private deferred: Output[] = [];
  constructor(public game: Game, private maxSteps = 50_000, options: RuntimeOptions = {}) {
    this.store = options.store ?? new MemoryGlobalStore();
    this.columns = options.columns ?? 120;
    if (!Number.isSafeInteger(this.columns) || this.columns < 1 || this.columns > 1000) throw new EraError("Terminal columns must be between 1 and 1000");
    this.globals = new Variables(game);
    const numeric = ["RESULT", "FLAG", "TFLAG", "GLOBAL", "DAY", "TIME", "MONEY", "ITEM", "TARGET", "MASTER", "PLAYER", "ASSI", "COUNT", ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ")];
    numeric.forEach((name) => this.globals.define(name, false, game.variableSizes.get(name) ?? [name === "FLAG" ? 10000 : 1000]));
    ["STR", "SAVESTR", "GLOBALS", "RESULTS", "WINDOW_TITLE", "GAMEBASE_TITLE", "GAMEBASE_INFO", "GAMEBASE_YEAR"].forEach((name) => this.globals.define(name, true, game.variableSizes.get(name) ?? [1000]));
    for (const name of ["GAMEBASE_VERSION", "GAMEBASE_CODE", "CHARANUM"]) this.globals.define(name);
    const base = new Map([...(game.tables.get("GAMEBASE")?.values() ?? [])].map((row) => [row[0], row[1] ?? ""]));
    for (const [variable, csv] of [["GAMEBASE_TITLE", "タイトル"], ["GAMEBASE_INFO", "追加情報"], ["GAMEBASE_YEAR", "製作年"]])
      this.globals.seed(variable!, 0, base.get(csv!) ?? "");
    for (const [variable, csv] of [["GAMEBASE_CODE", "コード"], ["GAMEBASE_VERSION", "バージョン"]]) {
      const value = base.get(csv!);
      if (value && /^-?\d+$/.test(value)) this.globals.seed(variable!, 0, BigInt(value));
      else if (variable === "GAMEBASE_VERSION" && value === "proto") this.globals.seed(variable, 0, 0n);
    }
    for (const [name, table] of game.tables) {
      if (name.includes("/") || name === "GAMEBASE" || !table.size) continue;
      const size = Math.max(game.variableSizes.get(name)?.at(-1) ?? 1000, Math.max(...table.keys()) + 1);
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
        output.push(...this.deferred);
        this.deferred = [];
        if (next.done) {
          this.finished = true;
          return { status: "halted", output, input: null, error: null, title: this.windowTitle() };
        }
        if ("input" in next.value) {
          this.pending = next.value.input;
          return { status: "waiting", output, input: this.pending, error: null, title: this.windowTitle() };
        }
        bytes += JSON.stringify(next.value.output).length;
        if (bytes > 2_000_000) throw new EraError("Output limit exceeded between inputs", this.currentSource);
        output.push(next.value.output);
      }
    } catch (error) {
      if (!(error instanceof EraError)) throw error;
      this.finished = true;
      this.iterator.return(undefined);
      return { status: "error", output, input: null, error: error.diagnostic(), title: this.windowTitle() };
    }
  }
  private windowTitle(): string {
    return text(this.globals.get("WINDOW_TITLE", [], this.context(this.globals)));
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
          if (version && version !== "proto" && !/^-?\d+$/.test(version)) throw new EraError(`Non-numeric GameBase version is not yet supported: ${version}`);
        }
        if (name === "RAND") throw new EraError("RAND is not yet supported");
        return variables.get(name, indices, context);
      },
      referenceCall: (name, args) => {
        if (name !== "GETNUM") return undefined;
        if (args.length !== 2) throw new EraError("GETNUM expects a CSV variable and a name");
        const reference = args[0]!;
        if (reference.kind !== "variable" || reference.indices.length) throw new EraError("GETNUM expects a bare CSV variable");
        const symbols = this.game.names.get(reference.name);
        if (!symbols) throw new EraError(`No CSV name table for ${reference.name}`);
        return BigInt(symbols.get(key(text(evaluate(args[1]!, context)))) ?? -1);
      },
      call: (name, args) => {
        const arities: Record<string, [number, number]> = {
          ABS: [1, 1], MIN: [1, 1000], MAX: [1, 1000], LIMIT: [3, 3],
          TOSTR: [1, 2], TOINT: [1, 1], STRLENU: [1, 1], MAXWIDTH: [0, 0],
          GETCOLOR: [0, 0], GETSTYLE: [0, 0], EXISTVAR: [1, 1], GETVARS: [1, 1], VARSIZE: [1, 2],
          MAP_EXIST: [1, 1], MAP_SIZE: [1, 1], MAP_HAS: [2, 2], MAP_GET: [2, 2],
          HTML_POPPRINTINGSTR: [0, 0], HTML_TOPLAINTEXT: [1, 1], STRLENS: [1, 1],
          STRCOUNT: [2, 2], REPLACE: [3, 3], SUBSTRING: [2, 3],
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
            return args.map((_, i) => n(i)).reduce((a, b) => name === "MIN" ? (a < b ? a : b) : (a > b ? a : b));
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
          case "MAXWIDTH": return BigInt(this.columns);
          case "GETCOLOR": return BigInt("0x" + this.style.color.slice(1));
          case "GETSTYLE": return BigInt(this.style.fontStyle);
          case "EXISTVAR": return variables.has(s(0)) ? 1n : 0n;
          case "GETVARS": {
            const reference = this.parse(s(0));
            if (reference.kind !== "variable") throw new EraError("GETVARS requires a variable reference string");
            return text(evaluate(reference, context));
          }
          case "VARSIZE": {
            const variable = key(s(0));
            const dimensions = variables.has(variable) ? variables.dimensions(variable, context) : this.game.variableSizes.get(variable);
            if (!dimensions) throw new EraError(`Unknown variable for VARSIZE: ${variable}`);
            const dimension = args.length === 2 ? Number(n(1)) : 0;
            const size = dimensions[dimension];
            if (size === undefined) throw new EraError(`Invalid VARSIZE dimension: ${dimension}`);
            return BigInt(size);
          }
          case "MAP_EXIST": return this.maps.has(s(0)) ? 1n : 0n;
          case "MAP_SIZE": return BigInt(this.map(s(0)).size);
          case "MAP_HAS": return this.map(s(0)).has(s(1)) ? 1n : 0n;
          case "MAP_GET": return this.map(s(0)).get(s(1)) ?? "";
          case "HTML_POPPRINTINGSTR": {
            const html = this.printingHtml;
            if (html) this.deferred.push({ type: "clear", count: 1 });
            this.printingHtml = "";
            return html;
          }
          case "HTML_TOPLAINTEXT": return plainHtml(s(0));
          case "STRLENS": return BigInt(this.stringWidth(s(0)));
          case "STRCOUNT": {
            const matches = this.regex(s(1));
            return BigInt([...s(0).matchAll(matches)].length);
          }
          case "REPLACE": return s(0).replace(this.regex(s(1)), s(2));
          case "SUBSTRING": {
            const start = Number(n(1));
            const length = args[2] === undefined ? -1 : Number(n(2));
            if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length < -1)
              throw new EraError("Invalid SUBSTRING range");
            let offset = 0, result = "";
            for (const c of s(0)) {
              const width = this.stringWidth(c);
              if (offset >= start && (length === -1 || offset + width <= start + length)) result += c;
              offset += width;
            }
            return result;
          }
          default: {
            if (!this.game.routines.has(name)) throw new EraError(`Unsupported expression function: ${name}`);
            const source = this.currentSource;
            const generator = this.execute(name, args, true);
            try {
              const result = generator.next();
              if (!result.done) throw new EraError(`Expression function ${name} attempted output or input`, this.currentSource);
              if (result.value === undefined) throw new EraError(`Expression function ${name} did not return a value`);
              return result.value;
            } finally {
              generator.return(undefined);
              this.currentSource = source;
            }
          }
        }
      },
    };
    return context;
  }
  private map(name: string): Map<string, string> {
    const map = this.maps.get(name);
    if (!map) throw new EraError(`Map does not exist: ${name}`);
    return map;
  }
  private regex(pattern: string): RegExp {
    try { return new RegExp(pattern, "gu"); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new EraError(`Invalid regular expression: ${error.message}`);
    }
  }
  private stringWidth(value: string): number {
    return [...value].reduce((width, c) => width + (c.codePointAt(0)! <= 0xff || /[\uFF61-\uFF9F]/u.test(c) ? 1 : 2), 0);
  }
  private assign(frame: Frame, reference: Expr, value: Value): void {
    if (reference.kind !== "variable") throw new EraError("Assignment target must be a variable");
    frame.variables.set(reference.name, reference.indices, value, frame.context);
  }
  private formatted(source: string, frame: Frame): string {
    return text(evaluate(parseFormat(source), frame.context));
  }
  private emit(type: "text" | "html", value: string, newline: boolean): Yield {
    if (value.length > 1_000_000) throw new EraError("Output string exceeds limit");
    this.lineCount += (value.match(/\n/g)?.length ?? 0) + (newline ? 1 : 0);
    this.printingHtml += type === "html" ? value : escapeHtml(value);
    if (newline) this.printingHtml = "";
    else if (value.includes("\n")) this.printingHtml = escapeHtml(value.slice(value.lastIndexOf("\n") + 1));
    return { output: { type, text: value, newline, style: { ...this.style } } };
  }
  private *execute(name: string, args: (Value | undefined)[], expression = false): Generator<Yield, Value | undefined, string> {
    if (++this.depth > 128) throw new EraError("Call depth limit exceeded", this.currentSource);
    if (this.activeRoutines.has(name)) throw new EraError(`Recursive calls are not yet supported: ${name}`, this.currentSource);
    this.activeRoutines.add(name);
    try {
      const routines = this.game.routines.get(name);
      if (!routines?.length) throw new EraError(`Undefined function: ${name}`, this.currentSource);
      if (routines.length !== 1) throw new EraError(`Multiple definitions/event dispatch not yet supported: ${name}`, this.currentSource);
      const routine = routines[0]!;
      const functionType = routine.directives.find((line) => /^#FUNCTIONS?$/i.test(line.text));
      if (expression && !functionType) throw new EraError(`${name} is not declared #FUNCTION or #FUNCTIONS`, routine);
      let compiled = this.compiled.get(routine);
      if (!compiled) { compiled = compile(routine); this.compiled.set(routine, compiled); }
      let variables = this.statics.get(routine);
      if (!variables) {
        variables = new Variables(this.game, this.globals);
        for (const variable of ["LOCAL", "ARG"]) variables.define(variable, false, this.game.variableSizes.get(variable) ?? [1000]);
        for (const variable of ["LOCALS", "ARGS"]) variables.define(variable, true, this.game.variableSizes.get(variable) ?? [1000]);
        for (const directive of routine.directives) {
          if (/^#FUNCTIONS?$/i.test(directive.text)) continue;
          if (!/^#DIMS?\s/i.test(directive.text)) throw new EraError(`Unsupported function directive: ${directive.text}`, directive);
          if (/\bDYNAMIC\b/i.test(directive.text)) continue;
          variables.declare(directive);
        }
        this.statics.set(routine, variables);
      }
      const dynamic = routine.directives.filter((line) => /^#DIMS?\s/i.test(line.text) && /\bDYNAMIC\b/i.test(line.text));
      if (dynamic.length) {
        variables = new Variables(this.game, variables);
        for (const declaration of dynamic) variables.declare(declaration);
      }
      const context = this.context(variables);
      const frame: Frame = { variables, compiled, context };
      if (functionType) frame.returnType = key(functionType.text) === "#FUNCTIONS" ? "string" : "integer";
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
      const result = yield* this.runFrame(frame);
      if (functionType && result === undefined) return frame.returnType === "string" ? "" : 0n;
      return result;
    } finally { this.depth--; this.activeRoutines.delete(name); }
  }
  private *runFrame(frame: Frame): Generator<Yield, Value | undefined, string> {
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
        if (op.startsWith("DEBUGPRINT")) {
          // The loader runs release mode; debug output is not evaluated.
        } else if (op.startsWith("PRINT") && !["PRINTBUTTON", "PRINTBUTTONC", "PRINTDATA", "PRINTDATAL", "PRINTDATAW"].includes(op)) {
          const variant = op.slice(5);
          if (!["", "L", "W", "FORM", "FORML", "FORMW", "V", "VL", "VW", "S", "SL", "SW"].includes(variant)) throw new EraError(`Unsupported instruction: ${op}`);
          const value = variant.startsWith("FORM") ? this.formatted(args, frame) : /^[VS]/.test(variant) ? String(ev(args)) : args;
          yield this.emit("text", value, /[LW]$/.test(op));
          if (op.endsWith("W")) yield { input: { kind: "wait" } };
        } else switch (op) {
          case "LOADGLOBAL": {
            if (args) throw new EraError("LOADGLOBAL takes no arguments");
            const saved = this.store.load();
            if (saved) this.globals.importGlobals(saved, frame.context);
            this.globals.set("RESULT", [], saved ? 1n : 0n, frame.context);
            break;
          }
          case "SAVEGLOBAL":
            if (args) throw new EraError("SAVEGLOBAL takes no arguments");
            this.store.save(this.globals.exportGlobals(frame.context));
            this.globals.set("RESULT", [], 1n, frame.context);
            break;
          case "CLEARMEMORY": {
            if (args) throw new EraError("CLEARMEMORY takes no arguments");
            const before = process.memoryUsage().heapUsed;
            this.expressionCache.clear();
            this.compiled.clear();
            if (global.gc) global.gc();
            const freed = Math.max(0, before - process.memoryUsage().heapUsed);
            this.globals.set("RESULT", [], BigInt(freed), frame.context);
            break;
          }
          case "MAP_RELEASE": this.maps.delete(text(ev(args))); break;
          case "MAP_CREATE": {
            const name = text(ev(args));
            if (this.maps.has(name)) throw new EraError(`Map already exists: ${name}`);
            this.maps.set(name, new Map());
            break;
          }
          case "MAP_SET": {
            const parts = splitArguments(args);
            if (parts.length !== 3) throw new EraError("MAP_SET expects map, key and value");
            this.map(text(ev(parts[0]!))).set(text(ev(parts[1]!)), text(ev(parts[2]!)));
            break;
          }
          case "REDRAW": {
            const mode = num(args);
            if (mode !== 0n && mode !== 1n) throw new EraError("REDRAW expects 0 or 1");
            // Output is already buffered in snapshots until INPUT/WAIT.
            break;
          }
          case "FONTSTYLE": {
            const style = num(args);
            if (style < 0n || style > 7n) throw new EraError("FONTSTYLE expects a value from 0 to 7");
            this.style.fontStyle = Number(style);
            break;
          }
          case "PRINTDATA": case "PRINTDATAL": case "PRINTDATAW": {
            if (args) throw new EraError("PRINTDATA arguments are not yet supported");
            const rows = code.slice(pc + 1, target);
            if (!rows.length || rows.some((row) => row.op !== "DATA" && row.op !== "DATAFORM"))
              throw new EraError("PRINTDATA currently requires DATA/DATAFORM entries");
            const selected = rows[randomInt(rows.length)]!;
            yield this.emit("text", selected.op === "DATAFORM" ? this.formatted(selected.args, frame) : selected.args, op !== "PRINTDATA");
            if (op === "PRINTDATAW") yield { input: { kind: "wait" } };
            next = target + 1;
            break;
          }
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
            if (count) this.printingHtml = "";
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
          case "VARSET": {
            const reference = this.parse(args);
            if (reference.kind !== "variable" || reference.indices.length) throw new EraError("VARSET currently requires a bare variable");
            frame.variables.reset(reference.name, frame.context);
            break;
          }
          case "SPLIT": {
            const parts = splitArguments(args);
            if (parts.length !== 3) throw new EraError("SPLIT expects source, separator, destination");
            const separator = text(ev(parts[1]!));
            if (!separator) throw new EraError("SPLIT separator must not be empty");
            const values = text(ev(parts[0]!)).split(separator);
            const reference = this.parse(parts[2]!);
            if (reference.kind !== "variable") throw new EraError("SPLIT destination must be a string array");
            frame.variables.setMany(reference.name, reference.indices, values, frame.context);
            this.globals.set("RESULT", [], BigInt(values.length), frame.context);
            break;
          }
          case "RETURNF": {
            if (!frame.returnType) throw new EraError("RETURNF outside an expression function");
            const value = args ? ev(args) : frame.returnType === "string" ? "" : 0n;
            return frame.returnType === "string" ? text(value) : integer(value);
          }
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
