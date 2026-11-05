import { setImmediate } from "node:timers/promises";
import { classify, compile, inlineDeclaration, isSupported, printVariant } from "./compiler.js";
import { expandArgumentMacros, parseExpression, useMacros } from "./expression.js";
import { parseFormat } from "./format.js";
import type { Game } from "./loader.js";
import { allowsFullWidthSpace, EraError, key, splitArguments, type Diagnostic, type Line, type Source } from "./model.js";
import { BUILTIN_FUNCTIONS } from "./runtime.js";
import { formNameEnd, parseAssignment, parseCallTarget, parseCaseTests } from "./statement-parser.js";

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
]);
const SINGLE_EXPRESSION = new Set([
  "IF", "ELSEIF", "SIF", "SELECTCASE", "WHILE", "LOOP", "REPEAT", "ASSERT",
]);
const CALL = /^(?:(?:TRY|TRYC)?(?:CALL|JUMP)(?:FORM)?F?|FUNC)$/;
const BUILTIN_STRINGS = [
  "LOCALS", "ARGS", "NAME", "CALLNAME", "NICKNAME", "MASTERNAME", "CSTR", "TSTR",
  "STR", "SAVESTR", "GLOBALS", "RESULTS", "SAVEDATA_TEXT", "WINDOW_TITLE",
  "GAMEBASE_TITLE", "GAMEBASE_INFO", "GAMEBASE_YEAR", "GAMEBASE_AUTHOR", "CDFLAGNAME1", "CDFLAGNAME2",
];
const DECLARATION = /^#DIM(S)?\s+((?:(?:CONST|DYNAMIC|GLOBAL|SAVEDATA|REF|CHARADATA)\s+)*)([^\s,=]+)(.*)$/i;

export interface SyntaxReport {
  scriptFiles: number;
  routines: number;
  lines: number;
  skippedLines: number;
  diagnostics: Diagnostic[];
}

function argumentsFor(source: string, game: Game): string[] {
  const parts = splitArguments(expandArgumentMacros(source, game.macros));
  if (parts.length > 1 && parts.at(-1) === "") parts.pop();
  return parts;
}

function expressions(source: string, game: Game): void {
  for (const part of argumentsFor(source, game)) if (part) parseExpression(part);
}

function variable(source: string): void {
  if (parseExpression(source).kind !== "variable") throw new EraError("Expected a variable reference");
}

function declaration(line: Line): void {
  const match = DECLARATION.exec(line.text);
  if (!match) throw new EraError(`Unsupported declaration: ${line.text}`);
  variable(match[3]!);
  const rest = match[4]!.trim(), equal = rest.indexOf("=");
  const sizes = (equal < 0 ? rest : rest.slice(0, equal)).trim().replace(/^,/, "");
  const initial = equal < 0 ? "" : rest.slice(equal + 1).trim().replace(/,$/, "");
  for (const source of [sizes, initial]) if (source)
    for (const part of splitArguments(source)) {
      if (!part && /\bREF\b/i.test(match[2]!)) continue;
      parseExpression(part);
    }
}

function types(lines: readonly Line[], target: Map<string, boolean>): void {
  for (const line of lines) {
    const match = DECLARATION.exec(line.text);
    if (match) target.set(key(match[3]!), !!match[1]);
  }
}

function checkLine(line: Line, game: Game, strings: Map<string, boolean>): boolean {
  const { op, args } = classify(line);
  if (op === "LABEL") return true;
  const print = printVariant(op);
  if (print) {
    if (print.argument === "FORM") parseFormat(args);
    else if (print.argument === "V") {
      const template = /^'(?:([^']*)')?\(,(.*),'\)$/.exec(args.trim());
      if (template) parseExpression(template[2]!);
      else expressions(args, game);
    } else if (print.argument) parseExpression(args);
    return true;
  }
  if (RAW.has(op)) return true;
  if (FORM.has(op)) { parseFormat(args); return true; }
  if (op === "ASSIGN") {
    const assignment = parseAssignment(args, allowsFullWidthSpace(game.config));
    const { reference, operator, value, expressionValue } = assignment;
    if (operator === "++" || operator === "--") {
      if (expressionValue) throw new EraError("Unexpected text after increment/decrement");
    } else if (operator === "=" && strings.get(reference.name.split("@")[0]!)) parseFormat(value);
    else {
      const parts = argumentsFor(expressionValue, game);
      if (operator === "=" || operator === "'=") {
        if (parts.at(-1) === "") parts.pop();
        if (!parts.length) throw new EraError("Assignment requires a value");
        for (const part of parts) parseExpression(part);
      } else parseExpression(expressionValue);
    }
    return true;
  }
  if (op === "VARI" || op === "VARS") {
    const inline = inlineDeclaration(line)!;
    variable(inline.name);
    if (inline.initializer) parseExpression(inline.initializer);
    return true;
  }
  if (SINGLE_EXPRESSION.has(op)) { parseExpression(args); return true; }
  if (op === "CASE") {
    for (const test of parseCaseTests(argumentsFor(args, game))) {
      if (test.kind === "range") { parseExpression(test.from); parseExpression(test.to); }
      else parseExpression(test.kind === "compare" ? test.operand : test.source);
    }
    return true;
  }
  if (CALL.test(op)) {
    let parameters: string;
    if (op.includes("FORM")) {
      const end = formNameEnd(args);
      parseFormat(args.slice(0, end));
      parameters = args.slice(end).trim();
      if (parameters.startsWith("(") && parameters.endsWith(")")) parameters = parameters.slice(1, -1);
      else parameters = parameters.replace(/^,/, "");
    } else {
      const call = parseCallTarget(args);
      if (!call) throw new EraError(`Missing ${op} target`);
      parameters = call.parameters;
    }
    expressions(parameters, game);
    return true;
  }
  if (op === "TIMES") {
    const parts = argumentsFor(args, game);
    variable(parts[0] ?? "");
    if (parts.length !== 2 || !/^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(parts[1]!))
      throw new EraError("TIMES expects integer variable and decimal literal");
    return true;
  }
  if (op === "FOR") {
    const parts = argumentsFor(args, game);
    if (parts.length < 3 || parts.length > 4) throw new EraError("FOR expects variable, start, end[, step]");
    variable(parts[0]!);
    parseExpression(parts[1]!);
    parseExpression(parts[2]!);
    if (parts[3]) parseExpression(parts[3]);
    return true;
  }
  if (op === "ONEBINPUTS") {
    const parts = argumentsFor(args, game);
    if (parts[0]) parseFormat(parts[0]);
    for (const part of parts.slice(1)) if (part) parseExpression(part);
    return true;
  }
  if (op === "CALLSHARP") { parseExpression(args); return true; }
  if (!isSupported(op) && !BUILTIN_FUNCTIONS.has(op)) return false;
  if (BUILTIN_FUNCTIONS.has(op) && !isSupported(op) && !game.routines.has(op))
    parseExpression(`${op}(${args})`);
  else expressions(args, game);
  return true;
}

/** Parses every loaded, active script line without evaluating expressions or running game code. */
export async function checkSyntax(game: Game): Promise<SyntaxReport> {
  const report: SyntaxReport = {
    scriptFiles: game.scriptFiles, routines: 0, lines: 0, skippedLines: 0, diagnostics: [...game.diagnostics],
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
  try {
    for (const line of game.headers) {
      report.lines++;
      if (/^#DIMS?(?:\s|$)/i.test(line.text)) attempt(line, () => declaration(line));
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
      for (const line of routine.lines) attempt(line, () => {
        const inline = inlineDeclaration(line);
        if (inline) strings.set(inline.name, inline.string);
      });
      for (const parameter of routine.parameters) attempt(routine, () => {
        const equal = parameter.indexOf("=");
        variable(equal < 0 ? parameter : parameter.slice(0, equal).trim());
        if (equal >= 0) parseExpression(parameter.slice(equal + 1));
      });
      for (const line of routine.directives) {
        report.lines++;
        if (/^#DIMS?(?:\s|$)/i.test(line.text)) attempt(line, () => declaration(line));
      }
      for (const line of routine.lines) {
        report.lines++;
        attempt(line, () => {
          if (!checkLine(line, game, strings)) report.skippedLines++;
        });
      }
    } finally { useMacros(previous); }
    batch += routine.lines.length;
    if (batch >= 5000) { await setImmediate(); batch = 0; }
  }
  return report;
}
