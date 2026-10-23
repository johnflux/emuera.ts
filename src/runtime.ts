import { compile, type Compiled, type Instruction } from "./compiler.js";
import { evaluate, parseExpression, type EvaluationContext, type Expr } from "./expression.js";
import type { Game } from "./loader.js";
import { EraError, integer, integerLiteral, INTEGER_LITERAL, key, splitArguments, text, type Diagnostic, type Routine, type Source, type Value } from "./model.js";
import { Variables } from "./variables.js";
import { parseFormat } from "./format.js";
import { MemoryGlobalStore, type GlobalStore } from "./storage.js";
import { randomInt } from "node:crypto";
import { escapeHtml, plainHtml } from "./html.js";
import { stringWidth } from "./strings.js";
import { DataTables, TABLE_OPERATIONS } from "./data-tables.js";

export interface Style { color: string; background: string; alignment: "left" | "center" | "right"; fontStyle: number }
export type Output =
  | { type: "text" | "html" | "input"; text: string; newline: boolean; style: Style; plain?: boolean }
  | { type: "button"; text: string; value: string; style: Style }
  | { type: "clear"; count: number };
export interface InputRequest {
  kind: "integer" | "string" | "wait";
  singleCharacter?: boolean;
  defaultValue?: string;
}
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
interface ReferenceArgument { variables: Variables; name: string; indices: Expr[]; context: EvaluationContext }
type Argument = Value | undefined | ReferenceArgument;
class BeginTransition {
  constructor(public state: string) {}
}
const literal = (value: Value): Expr => ({ kind: "literal", value });
export interface RuntimeOptions { store?: GlobalStore; columns?: number }
export const GAME_INSTRUCTION_LIMIT = 1_000_000;

export class Runtime {
  private dataTables = new DataTables();
  private globals: Variables;
  private statics = new Map<Routine, Variables>();
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
  private redraw = 1n;
  constructor(public game: Game, private maxSteps = 50_000, options: RuntimeOptions = {}) {
    this.store = options.store ?? new MemoryGlobalStore();
    this.columns = 120;
    this.setColumns(options.columns ?? 120);
    this.globals = new Variables(game);
    const numeric = ["RESULT", "FLAG", "TFLAG", "GLOBAL", "DAY", "TIME", "MONEY", "ITEM", "TARGET", "MASTER", "PLAYER", "ASSI", "COUNT", ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ")];
    numeric.forEach((name) => this.globals.define(name, false, game.variableSizes.get(name) ?? [name === "FLAG" ? 10000 : 1000]));
    for (const name of ["ITEMSALES", "NOITEM", "BOUGHT", "PBAND", "ASSIPLAY", "UP", "DOWN", "LOSEBASE", "PALAMLV", "EXPLV", "EJAC", "PREVCOM", "SELECTCOM", "NEXTCOM"])
      this.globals.define(name, false, game.variableSizes.get(name) ?? [1000]);
    for (const name of ["BASE", "MAXBASE", "ABL", "TALENT", "EXP", "MARK", "PALAM", "SOURCE", "EX", "CFLAG", "JUEL", "RELATION", "EQUIP", "TEQUIP", "STAIN", "GOTJUEL", "NOWEX", "TCVAR"])
      this.globals.defineCharacter(name, false, game.variableSizes.get(name) ?? [1000]);
    for (const name of ["NO", "ISASSI"]) this.globals.defineCharacter(name);
    for (const name of ["NAME", "CALLNAME", "NICKNAME", "MASTERNAME"]) this.globals.defineCharacter(name, true);
    this.globals.defineCharacter("CSTR", true, game.variableSizes.get("CSTR") ?? [100]);
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
      this.globals.define(`${name}NAME`, true, [size], true);
      for (const [index, row] of table) this.globals.seed(`${name}NAME`, index, row[0] ?? "");
    }
    for (const line of game.headers) {
      if (/^#DIMS?\s/i.test(line.text)) this.globals.declare(line);
      // Other header directives are diagnosed by the compatibility report.
    }
  }
  setColumns(columns: number): void {
    if (!Number.isSafeInteger(columns) || columns < 1 || columns > 1000) throw new EraError("Terminal columns must be between 1 and 1000");
    this.columns = columns;
  }
  start(entry = "SYSTEM_TITLE"): Snapshot {
    if (this.iterator) throw new EraError("Runtime has already started");
    this.iterator = this.run(entry);
    return this.advance();
  }
  private *run(entry: string): Generator<Yield, Value | undefined, string> {
    let state = key(entry);
    while (true) {
      try {
        if (state === "FIRST") {
          const events = [...(this.game.routines.get("EVENTFIRST") ?? [])].sort((a, b) => {
            const priority = (r: Routine): number => r.directives.some((d) => d.text === "#PRI") ? -1 : r.directives.some((d) => d.text === "#LATER") ? 1 : 0;
            return priority(a) - priority(b);
          });
          for (const routine of events) {
            yield* this.execute("EVENTFIRST", [], false, routine);
            if (routine.directives.some((d) => d.text === "#SINGLE")) break;
          }
        } else yield* this.execute(state, []);
        return;
      } catch (error) {
        if (!(error instanceof BeginTransition)) throw error;
        if (error.state !== "FIRST") throw new EraError(`BEGIN ${error.state} is not yet supported`, this.currentSource);
        state = error.state;
      }
    }
  }
  input(value: string): Snapshot {
    if (!this.pending) throw new EraError("Runtime is not waiting for input");
    if (this.pending.singleCharacter) {
      value = Array.from(value)[0] ?? this.pending.defaultValue ?? "";
    }
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
  private addCharacter(number: number, context: EvaluationContext): void {
    const template = this.game.characters.get(number);
    if (!template) throw new EraError(`Unknown character template: ${number}`);
    const index = this.globals.addCharacter();
    this.globals.set("CHARANUM", [], BigInt(index + 1), context);
    this.globals.set("NO", [literal(BigInt(index))], BigInt(number), context);
    const fields: Record<string, string> = {
      名前: "NAME", 呼び名: "CALLNAME", あだ名: "NICKNAME", 主人の呼び方: "MASTERNAME",
      基礎: "MAXBASE", 能力: "ABL", 素質: "TALENT", 経験: "EXP", フラグ: "CFLAG",
      相性: "RELATION", 刻印: "MARK", 装着物: "EQUIP", CSTR: "CSTR",
    };
    for (const row of template.rows) {
      if (row[0] === "番号") continue;
      const name = fields[row[0]!];
      if (!name) throw new EraError(`Unsupported character CSV field: ${row[0]}`, { file: template.file, line: 0 });
      const scalar = ["NAME", "CALLNAME", "NICKNAME", "MASTERNAME"].includes(name);
      const value = row[scalar ? 1 : 2] ?? "";
      const indices = [literal(BigInt(index))];
      if (!scalar) indices.push(literal(/^\d+$/.test(row[1] ?? "") ? BigInt(row[1]!) : row[1] ?? ""));
      if (scalar || name === "CSTR") this.globals.set(name, indices, value, context);
      else {
        const numeric = this.characterNumber(value, template.file);
        this.globals.set(name, indices, numeric, context);
        if (name === "MAXBASE") this.globals.set("BASE", indices, numeric, context);
      }
    }
  }
  private characterNumber(source: string, file: string): bigint {
    // Emuera reads a leading integer from character CSV values; a missing value
    // means 1 for every numeric field, not just TALENT. Trailing notes are allowed.
    const negative = source.startsWith("-");
    const match = INTEGER_LITERAL.exec(/^[+-]/.test(source) ? source.slice(1) : source);
    if (!match) {
      if (source && !this.game.diagnostics.some((d) => d.file === file && d.message === `Invalid character CSV integer defaults to 1: ${source}`))
        this.game.diagnostics.push({ file, line: 0, message: `Invalid character CSV integer defaults to 1: ${source}` });
      return 1n;
    }
    let value: bigint;
    try { value = integerLiteral(match[0]); }
    catch (error) {
      if (!(error instanceof EraError)) throw error;
      throw new EraError(error.message, { file, line: 0 });
    }
    if (negative) value = -value;
    if (BigInt.asIntN(64, value) !== value) throw new EraError(`Character CSV integer out of range: ${source}`, { file, line: 0 });
    return value;
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
        if (name === "DRAWLINESTR") return "-".repeat(this.columns);
        if (name === "GAMEBASE_VERSION") {
          const version = [...(this.game.tables.get("GAMEBASE")?.values() ?? [])].find((row) => row[0] === "バージョン")?.[1];
          if (version && version !== "proto" && !/^-?\d+$/.test(version)) throw new EraError(`Non-numeric GameBase version is not yet supported: ${version}`);
        }
        if (name === "RAND") {
          if (indices.length !== 1) throw new EraError("RAND expects one positive bound");
          const bound = Number(integer(evaluate(indices[0]!, context)));
          if (!Number.isSafeInteger(bound) || bound <= 0 || bound >= 2 ** 48) throw new EraError("RAND bound must be a positive integer below 2^48");
          return BigInt(randomInt(bound));
        }
        return variables.get(name, indices, context);
      },
      referenceCall: (name, args) => {
        if (name === "SUMARRAY") {
          const [reference, start, end] = args;
          if (!reference || reference.kind !== "variable" || args.length > 3) throw new EraError("SUMARRAY expects array[, start, end]");
          const dimensions = variables.dimensions(reference.name, context);
          if (reference.indices.length || dimensions.length !== 1) throw new EraError("SUMARRAY currently supports bare one-dimensional arrays only");
          const from = start && start.kind !== "omitted" ? integer(evaluate(start, context)) : 0n;
          const to = end && end.kind !== "omitted" ? integer(evaluate(end, context)) : BigInt(dimensions[0]!);
          if (from < 0n || to < from || to > BigInt(dimensions[0]!)) throw new EraError("Invalid SUMARRAY range");
          let sum = 0n;
          for (let i = from; i < to; i++) sum += integer(variables.get(reference.name, [literal(i)], context));
          return BigInt.asIntN(64, sum);
        }
        if (name === "FINDELEMENT") {
          const [reference, pattern, start, end, exact] = args;
          if (!reference || reference.kind !== "variable" || !pattern || args.length > 5) throw new EraError("FINDELEMENT expects array, value[, start, end, exact]");
          const dimensions = variables.dimensions(reference.name, context);
          const from = start && start.kind !== "omitted" ? Number(integer(evaluate(start, context))) : 0;
          const to = end && end.kind !== "omitted" ? Number(integer(evaluate(end, context))) : dimensions.at(-1)!;
          if (from < 0 || to < from || to > dimensions.at(-1)!) throw new EraError("Invalid FINDELEMENT range");
          const sought = evaluate(pattern, context);
          const full = exact && exact.kind !== "omitted" && integer(evaluate(exact, context)) !== 0n;
          const regex = typeof sought === "string" ? this.regex(full ? `^(?:${sought})$` : sought) : null;
          for (let i = from; i < to; i++) {
            const value = variables.get(reference.name, [...reference.indices, literal(BigInt(i))], context);
            if (regex) regex.lastIndex = 0;
            if (regex && typeof value === "string" ? regex.test(value) : value === sought) return BigInt(i);
          }
          return -1n;
        }
        if (name !== "GETNUM") return undefined;
        if (args.length !== 2) throw new EraError("GETNUM expects a CSV variable and a name");
        const reference = args[0]!;
        if (reference.kind !== "variable" || reference.indices.length) throw new EraError("GETNUM expects a bare CSV variable");
        const symbols = this.game.names.get(reference.name);
        if (!symbols) throw new EraError(`No CSV name table for ${reference.name}`);
        return BigInt(symbols.get(key(text(evaluate(args[1]!, context)))) ?? -1);
      },
      call: (name, args) => {
        if (TABLE_OPERATIONS.has(name)) return this.tableOperation(name, args, context);
        const arities: Record<string, [number, number]> = {
          ABS: [1, 1], MIN: [1, 1000], MAX: [1, 1000], LIMIT: [3, 3],
          TOSTR: [1, 2], MONEYSTR: [1, 2], TOINT: [1, 1], STRLENU: [1, 1], MAXWIDTH: [0, 0],
          GETCOLOR: [0, 0], GETSTYLE: [0, 0], EXISTVAR: [1, 1], GETVARS: [1, 1], VARSIZE: [1, 2],
          MAP_EXIST: [1, 1], MAP_SIZE: [1, 1], MAP_HAS: [2, 2], MAP_GET: [2, 2],
          HTML_POPPRINTINGSTR: [0, 0], HTML_TOPLAINTEXT: [1, 1], STRLENS: [1, 1],
          STRCOUNT: [2, 2], REPLACE: [3, 3], SUBSTRING: [2, 3],
          EXISTCSV: [1, 1], CSVCSTR: [2, 2], CSVNAME: [1, 1], CSVCALLNAME: [1, 1],
          INRANGE: [3, 3], ESCAPE: [1, 1],
          ISNUMERIC: [1, 1],
          GROUPMATCH: [2, 1000], GETBIT: [2, 2],
          UNICODE: [1, 1],
          TOLOWER: [1, 1], TOUPPER: [1, 1], STRLENSU: [1, 1], HTML_ESCAPE: [1, 1],
          CURRENTREDRAW: [0, 0],
          CSVABL: [2, 2], CSVTALENT: [2, 2], CSVBASE: [2, 2], CSVEXP: [2, 2], CSVRELATION: [2, 2], CSVFLAG: [2, 2],
        };
        const arity = arities[name];
        if (arity && (args.length < arity[0] || args.length > arity[1]))
          throw new EraError(`Invalid number of arguments for ${name}`);
        const n = (i: number): bigint => integer(args[i] ?? (() => { throw new EraError(`Missing argument for ${name}`); })());
        const s = (i: number): string => text(args[i] ?? (() => { throw new EraError(`Missing argument for ${name}`); })());
        switch (name) {
          case "EXISTCSV": return this.game.characters.has(Number(n(0))) ? 1n : 0n;
          case "CSVCSTR": case "CSVNAME": case "CSVCALLNAME": {
            const template = this.game.characters.get(Number(n(0)));
            if (!template) throw new EraError(`Unknown character template: ${n(0)}`);
            return template.rows.find((r) => name === "CSVCSTR" ? r[0] === "CSTR" && r[1] === n(1).toString() : r[0] === (name === "CSVNAME" ? "名前" : "呼び名"))?.[name === "CSVCSTR" ? 2 : 1] ?? "";
          }
          case "INRANGE": return n(0) >= n(1) && n(0) <= n(2) ? 1n : 0n;
          case "ESCAPE": return s(0).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          case "ISNUMERIC": return /^[+-]?\d+$/.test(s(0)) ? 1n : 0n;
          case "GROUPMATCH": return BigInt(args.slice(1).filter((value) => value === args[0]).length);
          case "TOLOWER": return s(0).toLowerCase();
          case "TOUPPER": return s(0).toUpperCase();
          case "UNICODE": {
            const code = Number(n(0));
            if (code < 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) throw new EraError("Invalid Unicode code point");
            return String.fromCodePoint(code);
          }
          case "GETBIT":
            if (n(1) < 0n || n(1) > 63n) throw new EraError("Bit index must be between 0 and 63");
            return (n(0) >> n(1)) & 1n;
          case "CSVABL": case "CSVTALENT": case "CSVBASE": case "CSVEXP": case "CSVRELATION": case "CSVFLAG": {
            const template = this.game.characters.get(Number(n(0)));
            if (!template) throw new EraError(`Unknown character template: ${n(0)}`);
            const field = ({ CSVABL: "能力", CSVTALENT: "素質", CSVBASE: "基礎", CSVEXP: "経験", CSVRELATION: "相性", CSVFLAG: "フラグ" } as Record<string, string>)[name]!;
            const table = name.slice(3) === "FLAG" ? "CFLAG" : name.slice(3);
            const row = template.rows.find((r) => r[0] === field && (/^\d+$/.test(r[1] ?? "") ? Number(r[1]) : this.game.names.get(table)?.get(key(r[1] ?? ""))) === Number(n(1)));
            return row ? this.characterNumber(row[2] ?? "", template.file) : 0n;
          }
          case "ABS": return BigInt.asIntN(64, n(0) < 0n ? -n(0) : n(0));
          case "MIN": case "MAX":
            if (!args.length) throw new EraError(`${name} requires arguments`);
            return args.map((_, i) => n(i)).reduce((a, b) => name === "MIN" ? (a < b ? a : b) : (a > b ? a : b));
          case "LIMIT":
            if (n(1) > n(2)) throw new EraError("LIMIT minimum exceeds maximum");
            return n(0) < n(1) ? n(1) : n(0) > n(2) ? n(2) : n(0);
          case "MONEYSTR": {
            const value = n(0);
            let formatted = value.toString();
            if (args[1] !== undefined) {
              const format = s(1);
              if (format === "#,##0") formatted = formatted.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
              else if (/^0{1,100}$/.test(format))
                formatted = (value < 0n ? "-" : "") + (value < 0n ? -value : value).toString().padStart(format.length, "0");
              else throw new EraError(`Unsupported MONEYSTR format: ${format}`);
            }
            return this.game.money.first ? this.game.money.label + formatted : formatted + this.game.money.label;
          }
          case "TOSTR": {
            const value = n(0).toString();
            if (args.length < 2) return value;
            const format = s(1);
            const hexadecimal = /^([xX])(\d{0,3})$/.exec(format);
            if (hexadecimal) {
              const digits = hexadecimal[2] ? Number(hexadecimal[2]) : 0;
              const result = BigInt.asUintN(64, n(0)).toString(16).padStart(digits, "0");
              return hexadecimal[1] === "X" ? result.toUpperCase() : result;
            }
            if (!/^0{1,100}$/.test(format)) throw new EraError(`Unsupported TOSTR format: ${format}`);
            return n(0) < 0n ? "-" + value.slice(1).padStart(format.length, "0") : value.padStart(format.length, "0");
          }
          case "TOINT": {
            if (!/^-?\d+$/.test(s(0))) throw new EraError("TOINT requires an integer string");
            return BigInt.asIntN(64, BigInt(s(0)));
          }
          case "STRLENU": return BigInt([...s(0)].length);
          case "STRLENSU": return BigInt(s(0).length);
          case "MAXWIDTH": return BigInt(this.columns);
          case "CURRENTREDRAW": return this.redraw;
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
          case "MAP_HAS": return this.maps.get(s(0))?.has(s(1)) ? 1n : 0n;
          case "MAP_GET": return this.map(s(0)).get(s(1)) ?? "";
          case "HTML_POPPRINTINGSTR": {
            const html = this.printingHtml;
            if (html) this.deferred.push({ type: "clear", count: 1 });
            this.printingHtml = "";
            return html;
          }
          case "HTML_TOPLAINTEXT": return plainHtml(s(0));
          case "HTML_ESCAPE": return escapeHtml(s(0));
          case "STRLENS": return BigInt(stringWidth(s(0)));
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
              const width = stringWidth(c);
              if (offset >= start && (length === -1 || offset + width <= start + length)) result += c;
              offset += width;
            }
            return result;
          }
          default: {
            if (!this.game.routines.has(name)) throw new EraError(`Unsupported expression function: ${name}`);
            return this.expressionFunction(name, args);
          }
        }
      },
    };
    return context;
  }
  private expressionFunction(name: string, args: Argument[]): Value {
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
  private tableOperation(name: string, args: (Value | undefined)[], context: EvaluationContext): Value {
    const result = this.dataTables.execute(name, args);
    if (result.selected) {
      const capacity = this.globals.dimensions("RESULT", context)[0]! - 1;
      if (capacity > 0 && result.selected.length)
        this.globals.setMany("RESULT", [literal(1n)], result.selected.slice(0, capacity), context);
      this.globals.set("RESULT", [], result.value, context);
    }
    return result.value;
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
  private assign(frame: Frame, reference: Expr, value: Value): void {
    if (reference.kind !== "variable") throw new EraError("Assignment target must be a variable");
    frame.variables.set(reference.name, reference.indices, value, frame.context);
  }
  private formatted(source: string, frame: Frame): string {
    return text(evaluate(parseFormat(source), frame.context));
  }
  private emit(type: "text" | "html" | "input", value: string, newline: boolean, plain = false): Yield {
    if (value.length > 1_000_000) throw new EraError("Output string exceeds limit");
    this.lineCount += (value.match(/\n/g)?.length ?? 0) + (newline ? 1 : 0);
    this.printingHtml += type === "html" ? value : escapeHtml(value);
    if (newline) this.printingHtml = "";
    else if (value.includes("\n")) this.printingHtml = escapeHtml(value.slice(value.lastIndexOf("\n") + 1));
    return { output: { type, text: value, newline, style: { ...this.style }, ...(plain ? { plain: true } : {}) } };
  }
  private callArguments(name: string, sources: string[], frame: Frame): Argument[] {
    const routine = this.game.routines.get(name)?.[0];
    return sources.map((source, i) => {
      if (!source) return undefined;
      const parameter = routine?.parameters[i]?.split("=")[0]?.trim().split(":")[0];
      const ref = routine?.directives.some((d) => key(/^#DIMS?\s+REF\s+([^\s,=]+)/i.exec(d.text)?.[1] ?? "") === key(parameter ?? ""));
      if (!ref) return evaluate(this.parse(source), frame.context);
      const reference = this.parse(source);
      if (reference.kind !== "variable") throw new EraError("REF arguments must be variable references");
      return { variables: frame.variables, name: reference.name, indices: reference.indices, context: frame.context };
    });
  }
  private *execute(name: string, args: Argument[], expression = false, selected?: Routine): Generator<Yield, Value | undefined, string> {
    if (++this.depth > 128) throw new EraError("Call depth limit exceeded", this.currentSource);
    try {
      const routines = this.game.routines.get(name);
      if (!routines?.length) throw new EraError(`Undefined function: ${name}`, this.currentSource);
      if (!selected && routines.length !== 1) throw new EraError(`Multiple definitions/event dispatch not yet supported: ${name}`, this.currentSource);
      const routine = selected ?? routines[0]!;
      const functionType = routine.directives.find((line) => /^#FUNCTIONS?$/i.test(line.text));
      if (expression && !functionType) throw new EraError(`${name} is not declared #FUNCTION or #FUNCTIONS`, routine);
      let compiled = this.compiled.get(routine);
      if (!compiled) { compiled = compile(routine); this.compiled.set(routine, compiled); }
      let variables = this.statics.get(routine);
      if (!variables) {
        variables = new Variables(this.game, this.globals);
        for (const variable of ["LOCAL", "ARG", "LOCALS", "ARGS"]) {
          const size = routine.directives.find((d) => d.text.startsWith(`#${variable}SIZE `));
          const dimensions = size ? [Number(integer(evaluate(this.parse(size.text.slice(size.text.indexOf(" ") + 1)), this.context(this.globals))))] : this.game.variableSizes.get(variable) ?? [1000];
          if (dimensions.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 1_000_000)) throw new EraError(`Invalid ${variable} size`, size);
          variables.define(variable, variable.endsWith("S"), dimensions);
        }
        for (const directive of routine.directives) {
          if (/^#FUNCTIONS?$/i.test(directive.text)) continue;
          if (/^#(?:LOCAL|LOCALS|ARG|ARGS)SIZE\s/i.test(directive.text)) continue;
          if (selected && /^#(?:PRI|LATER|SINGLE)$/i.test(directive.text)) continue;
          if (!/^#DIMS?\s/i.test(directive.text)) throw new EraError(`Unsupported function directive: ${directive.text}`, directive);
          if (/\b(?:DYNAMIC|REF)\b/i.test(directive.text)) continue;
          variables.declare(directive);
        }
        this.statics.set(routine, variables);
      }
      const dynamic = routine.directives.filter((line) => /^#DIMS?\s/i.test(line.text) && /\b(?:DYNAMIC|REF)\b/i.test(line.text));
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
        const argument = args[i];
        if (typeof argument === "object") {
          variables.bindReference(reference.name, argument.variables, argument.name, argument.indices, argument.context);
          continue;
        }
        const value = argument ?? (equal >= 0 ? evaluate(this.parse(parameter.slice(equal + 1)), context)
          : variables.isString(reference.name, context) ? "" : 0n);
        this.assign(frame, reference, value);
      }
      const result = yield* this.runFrame(frame);
      if (functionType && result === undefined) return frame.returnType === "string" ? "" : 0n;
      return result;
    } finally { this.depth--; }
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
        } else if (op === "PRINTPLAIN" || op === "PRINTPLAINFORM") {
          yield this.emit("text", op === "PRINTPLAINFORM" ? this.formatted(args, frame) : args, false, true);
        } else if (op.startsWith("PRINT") && !["PRINTBUTTON", "PRINTBUTTONC", "PRINTDATA", "PRINTDATAL", "PRINTDATAW"].includes(op)) {
          const variant = op.slice(5);
          if (!["", "L", "W", "FORM", "FORML", "FORMW", "V", "VL", "VW", "S", "SL", "SW"].includes(variant)) throw new EraError(`Unsupported instruction: ${op}`);
          const value = variant.startsWith("FORM") ? this.formatted(args, frame) : /^[VS]/.test(variant) ? String(ev(args)) : args;
          yield this.emit("text", value, /[LW]$/.test(op));
          if (op.endsWith("W")) yield { input: { kind: "wait" } };
        } else if (TABLE_OPERATIONS.has(op)) {
          const parts = splitArguments(args);
          if (parts.at(-1) === "" && op === "DT_ROW_ADD") parts.pop();
          const value = this.tableOperation(op, parts.map((part) => part ? ev(part) : undefined), frame.context);
          this.globals.set(typeof value === "string" ? "RESULTS" : "RESULT", [], value, frame.context);
        } else switch (op) {
          case "ARRAYREMOVE": {
            const parts = splitArguments(args);
            const reference = this.parse(parts[0] ?? "");
            if (parts.length !== 3 || reference.kind !== "variable") throw new EraError("ARRAYREMOVE expects array, start, count");
            frame.variables.remove(reference.name, reference.indices, Number(num(parts[1]!)), Number(num(parts[2]!)), frame.context);
            break;
          }
          case "SETBIT": case "CLEARBIT": case "INVERTBIT": {
            const parts = splitArguments(args);
            const reference = this.parse(parts.shift() ?? "");
            if (reference.kind !== "variable" || !parts.length) throw new EraError(`${op} expects variable and bit indices`);
            let value = integer(evaluate(reference, frame.context));
            for (const part of parts) {
              const bit = num(part);
              if (bit < 0n || bit > 63n) throw new EraError("Bit index must be between 0 and 63");
              const mask = 1n << bit;
              value = op === "SETBIT" ? value | mask : op === "CLEARBIT" ? value & ~mask : value ^ mask;
            }
            this.assign(frame, reference, BigInt.asIntN(64, value));
            break;
          }
          case "RESETDATA":
            if (args) throw new EraError("RESETDATA takes no arguments");
            this.globals.resetData();
            for (const variables of this.statics.values()) variables.resetData();
            break;
          case "ADDCHARA":
            for (const part of splitArguments(args)) this.addCharacter(Number(num(part)), frame.context);
            break;
          case "BEGIN": throw new BeginTransition(key(args));
          case "CALLF": {
            const expr = this.parse(args.includes("(") ? args : `${args}()`);
            if (expr.kind !== "call") throw new EraError("CALLF expects a function call");
            const result = evaluate(expr, frame.context);
            this.globals.set(typeof result === "string" ? "RESULTS" : "RESULT", [], result, frame.context);
            break;
          }
          case "CALLFORM": case "CALLFORMF": case "TRYCALLFORM": case "TRYCCALLFORM": {
            const formatted = this.formatted(args, frame);
            const match = /^([^\s(,]+)\s*(.*)$/.exec(formatted);
            if (!match) throw new EraError(`Invalid ${op} target`);
            const name = key(match[1]!);
            if (!this.game.routines.has(name)) {
              if (op === "CALLFORM" || op === "CALLFORMF") throw new EraError(`Undefined function: ${name}`);
              if (op === "TRYCCALLFORM") next = target + 1;
              break;
            }
            let parameters = match[2]!.trim();
            if (parameters.startsWith("(") && parameters.endsWith(")")) parameters = parameters.slice(1, -1);
            else if (parameters.startsWith(",")) parameters = parameters.slice(1);
            const values = this.callArguments(name, parameters ? splitArguments(parameters) : [], frame);
            const result = op === "CALLFORMF" ? this.expressionFunction(name, values) : yield* this.execute(name, values);
            this.globals.set(typeof result === "string" ? "RESULTS" : "RESULT", [], result ?? 0n, frame.context);
            break;
          }
          case "CATCH": next = target + 1; break;
          case "ENDCATCH": break;
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
            this.redraw = mode;
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
              const parts = splitArguments(match[3]!);
              if (parts.at(-1) === "") parts.pop();
              if (!parts.length) throw new EraError("Assignment requires a value");
              const values = parts.map(ev);
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
          case "DRAWLINE": yield this.emit("text", "-".repeat(this.columns), true); break;
          case "CUSTOMDRAWLINE": yield this.emit("text", args.repeat(Math.floor(this.columns / Math.max(1, stringWidth(args)))), true); break;
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
              if (candidate.op === "CASEELSE" || splitArguments(candidate.args).filter((part) => part !== "").some((part) => this.matchesCase(value, part, ev))) break;
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
            const name = key(match[1]!);
            yield* this.execute(name, this.callArguments(name, rest.trim() ? splitArguments(rest) : [], frame));
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
          case "INPUT": case "INPUTS": case "ONEINPUT": case "ONEINPUTS": {
            const singleCharacter = op.startsWith("ONE");
            const numeric = !op.endsWith("S");
            const request: InputRequest = { kind: numeric ? "integer" : "string" };
            if (singleCharacter) {
              request.singleCharacter = true;
              if (args) {
                const fallback = numeric ? integer(ev(args)) : text(ev(args));
                if (typeof fallback === "string" || fallback >= 0n) {
                  const first = Array.from(fallback.toString())[0];
                  if (first !== undefined) request.defaultValue = first;
                }
              }
            } else if (args) throw new EraError(`Arguments for ${op} are not yet supported`);
            const value = yield { input: request };
            yield this.emit("input", value, true);
            this.globals.set(numeric ? "RESULT" : "RESULTS", [], numeric ? BigInt(value.trim()) : value, frame.context);
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
