import { setImmediate } from "node:timers/promises";
import { classify, compile, inlineDeclaration, isSupported, printVariant } from "./compiler.js";
import { expandArgumentMacros, parseExpression, useMacros, type Expr } from "./expression.js";
import { parseFormat } from "./format.js";
import type { Game } from "./loader.js";
import { allowsFullWidthSpace, EraError, key, splitArguments, type Diagnostic, type Line, type Source } from "./model.js";
import { BUILTIN_FUNCTIONS, Runtime } from "./runtime.js";
import { symbolTable, Variables } from "./variables.js";
import { formNameEnd, parseAssignment, parseCallTarget, parseCaseTests, statementExpression } from "./statement-parser.js";

const RAW = new Set([
  "DATA", "PRINTPLAIN", "CUSTOMDRAWLINE", "STRLEN", "STRLENU", "DEBUGPRINT", "DEBUGPRINTL",
  "BEGIN", "FORCE_BEGIN", "CALLEVENT", "GOTO", "TRYGOTO", "TRYCGOTO",
  "ALIGNMENT", "SETCOLORBYNAME", "SETBGCOLORBYNAME",
]);
const FORM = new Set([
  "DATAFORM", "PRINTPLAINFORM", "PUTFORM", "RETURNFORM", "DRAWLINEFORM",
  "STRLENFORM", "STRLENFORMU", "DEBUGPRINTFORM", "DEBUGPRINTFORML",
  "GOTOFORM", "TRYGOTOFORM", "TRYCGOTOFORM", "REUSELASTLINE", "THROW",
  "INPUTS", "ONEINPUTS",
  "ENCODETOUNI",
]);
const SINGLE_EXPRESSION = new Set([
  "IF", "ELSEIF", "SIF", "SELECTCASE", "WHILE", "LOOP", "REPEAT",
]);
const CALL = /^(?:(?:TRY|TRYC)?(?:CALL|JUMP)(?:FORM)?F?|FUNC)$/;
const BUILTIN_STRINGS = [
  "LOCALS", "ARGS", "NAME", "CALLNAME", "NICKNAME", "MASTERNAME", "CSTR", "TSTR",
  "STR", "SAVESTR", "GLOBALS", "RESULTS", "SAVEDATA_TEXT", "WINDOW_TITLE",
  "GAMEBASE_TITLE", "GAMEBASE_INFO", "GAMEBASE_YEAR", "GAMEBASE_AUTHOR", "CDFLAGNAME1", "CDFLAGNAME2",
];
const DECLARATION = /^#DIM(S)?\s+((?:(?:CONST|DYNAMIC|GLOBAL|SAVEDATA|REF|CHARADATA)\s+)*)([^\s,=]+)(.*)$/i;
// Runtime.context supplies most of these; MONEYLABEL is also a native system variable.
const SYSTEM_VARIABLES = new Set([
  "RAND", "LINECOUNT", "LASTLOAD_VERSION", "LASTLOAD_NO", "LASTLOAD_TEXT",
  "__INT_MAX__", "__INT_MIN__", "__FILE__", "__FUNCTION__", "__LINE__", "DRAWLINESTR", "MONEYLABEL",
]);

export interface SyntaxReport {
  scriptFiles: number;
  routines: number;
  lines: number;
  skippedLines: number;
  diagnostics: Diagnostic[];
  references: Diagnostic[];
}

type Parser = typeof parseExpression;

function argumentsFor(source: string, game: Game): string[] {
  const parts = splitArguments(expandArgumentMacros(source, game.macros));
  if (parts.length > 1 && parts.at(-1) === "") parts.pop();
  return parts;
}

function expressions(source: string, game: Game, parse: Parser = parseExpression): void {
  for (const part of argumentsFor(source, game)) if (part) parse(part);
}

function variable(source: string, parse: Parser = parseExpression): void {
  if (parse(source).kind !== "variable") throw new EraError("Expected a variable reference");
}

function declaration(line: Line, parse: Parser = parseExpression): void {
  const match = DECLARATION.exec(line.text);
  if (!match) throw new EraError(`Unsupported declaration: ${line.text}`);
  variable(match[3]!);
  const rest = match[4]!.trim(), equal = rest.indexOf("=");
  const sizes = (equal < 0 ? rest : rest.slice(0, equal)).trim().replace(/^,/, "");
  const initial = equal < 0 ? "" : rest.slice(equal + 1).trim().replace(/,$/, "");
  for (const source of [sizes, initial]) if (source)
    for (const part of splitArguments(source)) {
      if (!part && /\bREF\b/i.test(match[2]!)) continue;
      parse(part);
    }
}

function types(lines: readonly Line[], target: Map<string, boolean>): void {
  for (const line of lines) {
    const match = DECLARATION.exec(line.text);
    if (match) target.set(key(match[3]!), !!match[1]);
  }
}

function inspectReferences(expr: Expr, game: Game, scope: Variables, report: (message: string) => void): void {
  const walk = (value: Expr): void => {
    switch (value.kind) {
      case "variable": {
        if (!scope.has(value.name) && !SYSTEM_VARIABLES.has(value.name)) report(`Unknown variable: ${value.name}`);
        const table = symbolTable(value.name);
        const tables = [table, `${table}NAME`, `${value.name}@1`, `${value.name}@2`, `${value.name}@3`];
        if (value.name === "CDFLAG") tables.push("CDFLAG1", "CDFLAG2");
        for (const index of value.indices) {
          if (index.kind === "variable" && !index.indices.length && !scope.has(index.name)
            && tables.some((name) => game.names.get(name)?.has(index.name))) continue;
          walk(index);
        }
        break;
      }
      case "call":
        if (!game.routines.has(value.name) && !BUILTIN_FUNCTIONS.has(value.name))
          report(`Unknown function: ${value.name}`);
        value.args.forEach((arg, i) => {
          if (value.name === "DT_COLUMN_OPTIONS" && !game.routines.has(value.name)
            && i >= 2 && i % 2 === 0 && arg.kind === "variable" && !arg.indices.length) return;
          walk(arg);
        });
        break;
      case "format": value.parts.forEach(walk); break;
      case "interpolation": walk(value.expression); if (value.width) walk(value.width); break;
      case "unary": walk(value.operand); break;
      case "binary": walk(value.left); walk(value.right); break;
      case "conditional": walk(value.condition); walk(value.yes); walk(value.no); break;
      case "increment": walk(value.target); break;
    }
  };
  walk(expr);
}

function checkLine(line: Line, game: Game, strings: Map<string, boolean>, inspect: (expr: Expr) => void, missingCall: (name: string) => void): boolean {
  const parse = (source: string): Expr => { const expr = parseExpression(source); inspect(expr); return expr; };
  const form = (source: string): Expr => { const expr = parseFormat(source); inspect(expr); return expr; };
  const { op, args } = classify(line);
  if (op === "LABEL") return true;
  const print = printVariant(op);
  if (print) {
    if (print.argument === "FORM") form(args);
    else if (print.argument === "V") {
      const template = /^'(?:([^']*)')?\(,(.*),'\)$/.exec(args.trim());
      if (template) parse(template[2]!);
      else expressions(args, game, parse);
    } else if (print.argument) parse(args);
    return true;
  }
  if (RAW.has(op)) return true;
  if (FORM.has(op)) { form(args); return true; }
  if (op === "ASSIGN") {
    const assignment = parseAssignment(args, allowsFullWidthSpace(game.config), parse);
    const { reference, operator, value, expressionValue } = assignment;
    if (operator === "++" || operator === "--") {
      if (expressionValue) throw new EraError("Unexpected text after increment/decrement");
    } else if (operator === "=" && strings.get(reference.name.split("@")[0]!)) form(value);
    else {
      const parts = argumentsFor(expressionValue, game);
      if (operator === "=" || operator === "'=") {
        if (parts.at(-1) === "") parts.pop();
        if (!parts.length) throw new EraError("Assignment requires a value");
        for (const part of parts) parse(part);
      } else parse(expressionValue);
    }
    return true;
  }
  if (op === "VARI" || op === "VARS") {
    const inline = inlineDeclaration(line)!;
    variable(inline.name);
    if (inline.initializer) parse(inline.initializer);
    return true;
  }
  if (SINGLE_EXPRESSION.has(op) || op === "RETURNF" && args) {
    parse(statementExpression(args, game.macros));
    return true;
  }
  if (op === "ASSERT") { parse(args); return true; }
  if (op === "CASE") {
    for (const test of parseCaseTests(argumentsFor(args, game))) {
      if (test.kind === "range") { parse(test.from); parse(test.to); }
      else parse(test.kind === "compare" ? test.operand : test.source);
    }
    return true;
  }
  if (CALL.test(op)) {
    let parameters: string;
    let target: string | undefined;
    if (op.includes("FORM")) {
      const end = formNameEnd(args);
      const name = form(args.slice(0, end));
      if (name.kind === "format" && name.parts.every((part) => part.kind === "literal"))
        target = key(name.parts.map((part) => part.kind === "literal" ? String(part.value) : "").join("").trim());
      parameters = args.slice(end).trim();
      if (parameters.startsWith("(") && parameters.endsWith(")")) parameters = parameters.slice(1, -1);
      else parameters = parameters.replace(/^,/, "");
    } else {
      const call = parseCallTarget(args);
      if (!call) throw new EraError(`Missing ${op} target`);
      target = call.name;
      parameters = call.parameters;
    }
    if (target && !game.routines.has(target) && !(op === "CALLF" && BUILTIN_FUNCTIONS.has(target))) {
      if (op.startsWith("TRY") || op === "FUNC") { expressions(parameters, game); return true; }
      missingCall(target);
    }
    expressions(parameters, game, parse);
    return true;
  }
  if (op === "TIMES") {
    const parts = argumentsFor(args, game);
    variable(parts[0] ?? "", parse);
    if (parts.length !== 2 || !/^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(parts[1]!))
      throw new EraError("TIMES expects integer variable and decimal literal");
    return true;
  }
  if (op === "FOR") {
    const parts = argumentsFor(args, game);
    if (parts.length < 3 || parts.length > 4) throw new EraError("FOR expects variable, start, end[, step]");
    variable(parts[0]!, parse);
    if (parts[1]) parse(parts[1]);
    parse(parts[2]!);
    if (parts[3]) parse(parts[3]);
    return true;
  }
  if (op === "ONEBINPUTS") {
    const parts = argumentsFor(args, game);
    if (parts[0]) form(parts[0]);
    for (const part of parts.slice(1)) if (part) parse(part);
    return true;
  }
  if (op === "SORTCHARA" || op === "ARRAYSORT") {
    const parts = argumentsFor(args, game);
    if (parts[0] && !(op === "SORTCHARA" && /^(FORWARD|BACK)$/i.test(parts[0]))) parse(parts[0]);
    for (const part of parts.slice(2)) if (part) parse(part);
    return true;
  }
  if (op === "DT_COLUMN_OPTIONS") { parse(`${op}(${args})`); return true; }
  if (op === "CALLSHARP") {
    const call = parseExpression(args);
    if (call.kind === "call") call.args.forEach(inspect);
    return true;
  }
  if (!isSupported(op) && !BUILTIN_FUNCTIONS.has(op)) return false;
  if (BUILTIN_FUNCTIONS.has(op) && !isSupported(op) && !game.routines.has(op))
    parse(`${op}(${args})`);
  else expressions(args, game, parse);
  return true;
}

/** Parses every loaded, active script line without evaluating expressions or running game code. */
export async function checkSyntax(game: Game): Promise<SyntaxReport> {
  const report: SyntaxReport = {
    scriptFiles: game.scriptFiles, routines: 0, lines: 0, skippedLines: 0, diagnostics: [...game.diagnostics], references: [],
  };
  const referenceIds = new Set<string>();
  const reference = (source: Source, message: string): void => {
    const id = `${source.file}:${source.line}:${message}`;
    if (referenceIds.has(id)) return;
    referenceIds.add(id);
    report.references.push({ file: source.file, line: source.line, message });
  };
  const seen = new Set(report.diagnostics.map((d) => `${d.file}:${d.line}:${d.message}`));
  const attempt = (source: Source, check: () => void): void => {
    try { check(); }
    catch (error) {
      if (!(error instanceof EraError)) throw error;
      const location = error.source ?? source;
      const diagnostic = { file: location.file, line: location.line, message: error.message };
      const id = `${diagnostic.file}:${diagnostic.line}:${diagnostic.message}`;
      if (!seen.has(id)) { seen.add(id); report.diagnostics.push(diagnostic); }
    }
  };
  const globals = new Map(BUILTIN_STRINGS.map((name) => [name, true]));
  for (const name of game.tables.keys()) globals.set(`${name}NAME`, true);
  types(game.headers, globals);
  let previous = useMacros(game.macros);
  let globalVariables: Variables;
  try {
    globalVariables = Runtime.createGlobals({ ...game, headers: [] });
    for (const line of game.headers)
      if (DECLARATION.test(line.text)) attempt(line, () => globalVariables.declare(line));
    for (const line of game.headers) {
      report.lines++;
      if (/^#DIMS?(?:\s|$)/i.test(line.text)) attempt(line, () => declaration(line, (source) => {
        const expr = parseExpression(source);
        inspectReferences(expr, game, globalVariables, (message) => reference(line, message));
        return expr;
      }));
    }
  } finally { useMacros(previous); }
  let batch = 0;
  for (const routines of game.routines.values()) for (const routine of routines) {
    previous = useMacros(game.macros);
    try {
      report.routines++;
      attempt(routine, () => { compile(routine); });
      const strings = new Map(globals);
      types(routine.directives, strings);
      const scope = new Variables(game, globalVariables);
      for (const name of ["LOCAL", "LOCALS", "ARG", "ARGS"]) scope.define(name);
      for (const line of routine.directives)
        if (DECLARATION.test(line.text)) attempt(line, () => scope.declare(line));
      for (const line of routine.lines) attempt(line, () => {
        const inline = inlineDeclaration(line);
        if (inline) {
          strings.set(inline.name, inline.string);
          if (!scope.owns(inline.name)) scope.define(inline.name, inline.string);
        }
      });
      const parse = (line: Source, source: string): Expr => {
        const expr = parseExpression(source);
        inspectReferences(expr, game, scope, (message) => reference(line, message));
        return expr;
      };
      for (const parameter of routine.parameters) attempt(routine, () => {
        const equal = parameter.indexOf("=");
        variable(equal < 0 ? parameter : parameter.slice(0, equal).trim(), (source) => parse(routine, source));
        if (equal >= 0) parse(routine, parameter.slice(equal + 1));
      });
      for (const line of routine.directives) {
        report.lines++;
        if (/^#DIMS?(?:\s|$)/i.test(line.text)) attempt(line, () => declaration(line, (source) => parse(line, source)));
      }
      for (const line of routine.lines) {
        report.lines++;
        attempt(line, () => {
          if (!checkLine(line, game, strings,
            (expr) => inspectReferences(expr, game, scope, (message) => reference(line, message)),
            (name) => reference(line, `Unknown routine: ${name}`))) report.skippedLines++;
        });
      }
    } finally { useMacros(previous); }
    batch += routine.lines.length;
    if (batch >= 5000) { await setImmediate(); batch = 0; }
  }
  return report;
}
