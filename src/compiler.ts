import { EraError, key, LITERAL_TEXT_INSTRUCTION, type Line, type Routine } from "./model.js";
import { TABLE_OPERATIONS } from "./data-tables.js";
import type { Expr } from "./expression.js";

const TRY_CATCH = new Set(["TRYCCALL", "TRYCJUMP", "TRYCCALLFORM", "TRYCJUMPFORM"]);
export const SUPPORTED = new Set([
  ...TABLE_OPERATIONS,
  "PRINT", "PRINTL", "PRINTW", "PRINTFORM", "PRINTFORML", "PRINTFORMW",
  "PRINTPLAIN", "PRINTPLAINFORM",
  "SAVEDATA", "LOADDATA", "DELDATA", "CHKDATA", "SAVECHARA", "LOADCHARA", "PUTFORM", "SAVENOS", "DOTRAIN", "RESET_STAIN", "UPCHECK", "OUTPUTLOG",
  "STRLEN", "STRLENU", "STRLENS", "STRLENSU", "STRLENFORM", "STRLENFORMU", "SUBSTRING", "SUBSTRINGU", "STRFIND", "STRFINDU", "STRCOUNT",
  "PRINTV", "PRINTVL", "PRINTVW", "PRINTS", "PRINTSL", "PRINTSW", "HTML_PRINT",
  "PRINTBUTTON", "PRINTBUTTONC", "PRINTBUTTONLC", "FORCEKANA", "DRAWLINE", "CUSTOMDRAWLINE", "DRAWLINEFORM", "CLEARLINE",
  "IF", "ELSEIF", "ELSE", "ENDIF", "SIF", "SELECTCASE", "CASE", "CASEELSE", "ENDSELECT",
  "FOR", "NEXT", "WHILE", "WEND", "DO", "LOOP", "REPEAT", "REND", "BREAK", "CONTINUE",
  "CALL", "JUMP", "RETURN", "RETURNFORM", "GOTO", "GOTOFORM", "TRYGOTO", "TRYGOTOFORM", "RESTART", "INPUT", "INPUTS", "ONEINPUT", "ONEINPUTS", "WAIT", "FORCEWAIT", "TWAIT",
  "TINPUT", "TINPUTS", "TONEINPUT", "TONEINPUTS",
  "BINPUT", "BINPUTS", "INPUTANY",
  "SETCOLOR", "RESETCOLOR", "SETBGCOLOR", "RESETBGCOLOR", "ALIGNMENT", "QUIT", "QUIT_AND_RESTART", "FORCE_QUIT_AND_RESTART", "UPDATECHECK", "THROW",
  "LOADGLOBAL", "SAVEGLOBAL", "CLEARMEMORY", "RETURNF", "FONTSTYLE", "FONTBOLD", "FONTITALIC", "FONTREGULAR", "REDRAW",
  "MAP_RELEASE", "MAP_CREATE", "MAP_SET", "STRDATA", "DATA", "DATAFORM", "DATALIST", "ENDLIST", "ENDDATA",
  "DEBUGPRINT", "DEBUGPRINTL", "DEBUGPRINTFORM", "DEBUGPRINTFORML", "DEBUGCLEAR", "ASSERT",
  "SPLIT", "VARI", "VARS", "VARSIZE", "VARSET", "ARRAYREMOVE", "SETBIT", "CLEARBIT", "INVERTBIT",
  "BITMAP_CACHE_ENABLE", "SETFONT", "RESETDATA", "ADDCHARA", "ADDDEFCHARA", "ADDVOIDCHARA", "DELCHARA", "DELALLCHARA", "COPYCHARA", "ADDCOPYCHARA", "SWAPCHARA", "PICKUPCHARA", "SORTCHARA", "BEGIN", "CALLF", "TRYCALLF", "CALLFORM", "CALLFORMF", "TRYCALLFORM", "TRYCALLFORMF", "TRYCCALLFORM", "TRYCALL", "TRYJUMP", "TRYCCALL", "TRYCJUMP", "JUMPFORM", "TRYJUMPFORM", "TRYCJUMPFORM", "CATCH", "ENDCATCH",
  "FORCE_BEGIN", "TIMES", "BAR", "BARL", "BARSTR", "SKIPDISP", "SKIPLOG", "PRINT_MARK", "NOSKIP", "ENDNOSKIP", "ISSKIP", "MOUSESKIP", "REUSELASTLINE", "CVARSET",
  "ARRAYSHIFT", "ARRAYSORT", "ARRAYCOPY", "SWAP", "POWER", "HTML_TAGSPLIT", "EXISTFUNCTION", "CLIENTWIDTH", "CLIENTHEIGHT", "FIND_CHARADATA", "EXISTFILE",
  "SIGN", "ALLSAMES", "NOSAMES", "COLOR_FROMNAME", "COLOR_FROMRGB", "CHKFONT", "LINEISEMPTY", "HTML_GETPRINTEDSTR", "GETDOINGFUNCTION",
  "MESSKIP", "ISACTIVE", "MOUSEX", "MOUSEY", "GETKEY", "GETKEYTRIGGERED", "GETTEXTBOX", "REGEXPMATCH", "STRJOIN", "INRANGEARRAY", "INRANGECARRAY", "ENCODETOUNI", "CLEARMEMORY", "GETMEMORYUSAGE", "PRINT_RECT", "PRINT_SPACE", "CALLTRAIN", "STOPCALLTRAIN", "SETVAR", "VARSETEX", "SETCOLORBYNAME", "SETBGCOLORBYNAME",
  "GETTIME", "GETMILLISECOND", "GETSECOND", "RANDOMIZE", "DUMPRAND", "INITRAND", "WAITANYKEY",
  "AWAIT", "PLAYSOUND", "STOPSOUND", "PLAYBGM", "STOPBGM", "SETBGMVOLUME", "SETSOUNDVOLUME", "INPUTMOUSEKEY", "CBGCLEAR", "CBGREMOVERANGE", "CBGSETG", "CBGSETSPRITE", "SETANIMETIMER", "TOOLTIP_SETDELAY", "TOOLTIP_SETDURATION", "TOOLTIP_SETCOLOR",
  "PRINT_IMG", "CBGSETBUTTONSPRITE", "CBGSETBMAPG", "CBGREMOVEBMAP", "CBGCLEARBUTTON",
  "TOOLTIP_CUSTOM", "TOOLTIP_SETFONTSIZE", "TOOLTIP_SETFONT", "TOOLTIP_FORMAT",
]);
export interface PrintVariant {
  argument: "" | "V" | "S" | "FORM" | "FORMS";
  single: boolean;
  align: "" | "C" | "LC";
  mode: "" | "K" | "D";
  end: "" | "L" | "W";
}
const PRINT_PATTERN = /^PRINT(SINGLE)?(V|S|FORMS|FORM)?(C|LC)?([KD])?([LW])?$/;
export const PRINTDATA_PATTERN = /^PRINTDATA([KD])?([LW])?$/;
// PRINT(SINGLE)(|V|S|FORM|FORMS)(|C|LC)(|K|D)(|L|W), with Emuera's combination rules.
const printVariants = new Map<string, PrintVariant | undefined>();
// Memoized because the runtime classifies every executed instruction.
export function printVariant(op: string): PrintVariant | undefined {
  if (printVariants.has(op)) return printVariants.get(op);
  const match = PRINT_PATTERN.exec(op);
  let variant: PrintVariant | undefined;
  if (match) {
    const [, single, argument = "", align = "", mode = "", end = ""] = match;
    if (!(single && (align || end)) && !(align && argument !== "" && argument !== "FORM"))
      variant = { argument, single: !!single, align, mode, end } as PrintVariant;
  }
  printVariants.set(op, variant);
  return variant;
}
const printData = new Map<string, boolean>();
export function isPrintData(op: string): boolean {
  let result = printData.get(op);
  if (result === undefined) printData.set(op, result = PRINTDATA_PATTERN.test(op));
  return result;
}
export function isSupported(op: string): boolean {
  return SUPPORTED.has(op) || !!printVariant(op) || PRINTDATA_PATTERN.test(op);
}
export interface Instruction extends Line {
  op: string; args: string; target: number;
  /** Runtime parse caches; parsing is deterministic, so they live as long as the compiled routine. */
  parsed?: Expr; assignment?: unknown; values?: Expr[]; cases?: unknown[];
}
export interface InlineDeclaration {
  name: string;
  string: boolean;
  dimensions: number[];
  initializer: string | undefined;
  line: Line;
}
export function inlineDeclaration(line: Line): InlineDeclaration | undefined {
  const match = /^(VARI|VARS)\s+([^,\s=]+)\s*([^=]*)(?:=(.*))?$/i.exec(line.text);
  if (!match) {
    if (/^VAR[IS](?:\s|$)/i.test(line.text)) throw new EraError("VARI/VARS expects name[, dimensions][ = initializer]", line);
    return undefined;
  }
  const suffix = match[3]!.trim();
  if (suffix && !suffix.startsWith(",")) throw new EraError("VARI/VARS dimensions must follow a comma", line);
  const dimensions = suffix ? suffix.slice(1).split(",").map((size) => /^\s*\d+\s*$/.test(size) ? Number(size) : NaN) : [1];
  if (dimensions.length > 3 || dimensions.some((size) => !Number.isSafeInteger(size) || size < 1 || size > 1_000_000))
    throw new EraError(`Invalid dimensions for ${match[2]}`, line);
  return { name: key(match[2]!), string: key(match[1]!) === "VARS", dimensions, initializer: match[4]?.trim(), line };
}
export interface Compiled {
  code: Instruction[];
  labels: Map<string, number>;
  loops: { start: number; end: number }[];
  /** JIT state (see jit.ts): calls so far, then the compiled routine or null when it cannot be compiled. */
  calls?: number; jit?: import("./jit.js").JitEntry | null;
}
export function classify(line: Line): { op: string; args: string } {
  if (line.text.startsWith("$")) return { op: "LABEL", args: line.text.slice(1).trim() };
  // Literal PRINT arguments start after one separator; further spaces are output.
  const print = /^(\S+?)(?:[ \t](.*))?$/.exec(line.text);
  if (print && LITERAL_TEXT_INSTRUCTION.test(print[1]!)) return { op: key(print[1]!), args: print[2] ?? "" };
  const command = /^(\S+)\s*(.*)$/.exec(line.text)!;
  const op = key(command[1]!);
  // Instructions match whole identifiers: "printNum ++" assigns a variable, it is not a PRINT variant.
  if (isSupported(op) || op.startsWith("DEBUGPRINT")) return { op, args: command[2]! };
  // `VALUE ,= ,` is still an assignment line in Emuera (rejected for the extra left-hand comma).
  if (/^(?:\+\+|--)\s*\S/u.test(line.text) || /^[^\s=,]+(?:\s*:.*?)?(?:\s*,[\s\w]*)?\s*(?:==|\+\+|--|(?:'|<<|>>|[+\-*/%&|^])?=)(?!=)/u.test(line.text))
    return { op: "ASSIGN", args: line.text };
  return { op, args: command[2]! };
}
export function compile(routine: Routine): Compiled {
  const code = routine.lines.map((line) => ({ ...line, ...classify(line), target: -1 }));
  const labels = new Map<string, number>();
  const stack: { op: string; start: number; branches: number[] }[] = [];
  const loops: Compiled["loops"] = [];
  const closes: Record<string, string> = { ENDIF: "IF", ENDSELECT: "SELECTCASE", NEXT: "FOR", WEND: "WHILE", LOOP: "DO", REND: "REPEAT" };
  code.forEach((line, i) => {
    if (line.op === "LABEL") {
      const name = key(line.args);
      if (labels.has(name)) throw new EraError(`Duplicate label: ${name}`, line);
      labels.set(name, i);
    }
    if (["IF", "SELECTCASE", "FOR", "WHILE", "DO", "REPEAT"].includes(line.op))
      stack.push({ op: line.op, start: i, branches: [i] });
    else if (TRY_CATCH.has(line.op)) stack.push({ op: line.op, start: i, branches: [i] });
    else if (line.op === "CATCH") {
      const frame = stack.at(-1);
      if (!frame || !TRY_CATCH.has(frame.op) || frame.branches.length !== 1) throw new EraError("Unmatched CATCH", line);
      frame.branches.push(i);
      code[frame.start]!.target = i;
    } else if (line.op === "ENDCATCH") {
      const frame = stack.pop();
      if (!frame || !TRY_CATCH.has(frame.op) || frame.branches.length !== 2) throw new EraError("Unmatched ENDCATCH", line);
      code[frame.branches[1]!]!.target = i;
    }
    else if (PRINTDATA_PATTERN.test(line.op) || line.op === "STRDATA")
      stack.push({ op: "PRINTDATA", start: i, branches: [i] });
    else if (line.op === "ENDDATA") {
      const frame = stack.pop();
      if (!frame || frame.op !== "PRINTDATA") throw new EraError("Unmatched ENDDATA", line);
      code[frame.start]!.target = i;
    }
    else if (["ELSEIF", "ELSE", "CASE", "CASEELSE"].includes(line.op)) {
      const frame = stack.at(-1);
      const expected = line.op.startsWith("CASE") ? "SELECTCASE" : "IF";
      if (!frame || frame.op !== expected) throw new EraError(`Unmatched ${line.op}`, line);
      if (frame.branches.some((j) => ["ELSE", "CASEELSE"].includes(code[j]!.op))) throw new EraError(`Branch after default branch`, line);
      frame.branches.push(i);
    } else if (closes[line.op]) {
      const frame = stack.pop();
      if (!frame || frame.op !== closes[line.op]) throw new EraError(`Unmatched ${line.op}`, line);
      for (let j = 0; j < frame.branches.length; j++) code[frame.branches[j]!]!.target = frame.branches[j + 1] ?? i;
      line.target = frame.start;
      if (["FOR", "WHILE", "DO", "REPEAT"].includes(frame.op)) loops.push({ start: frame.start, end: i });
    }
    if (line.op === "SIF" && (!code[i + 1] || ["IF", "SELECTCASE", "FOR", "WHILE", "DO", "REPEAT", "SIF"].includes(code[i + 1]!.op)))
      throw new EraError("SIF must precede one non-block instruction", line);
  });
  if (stack.length) throw new EraError(`Unclosed ${stack.at(-1)!.op}`, code[stack.at(-1)!.start]);
  return { code, labels, loops };
}
