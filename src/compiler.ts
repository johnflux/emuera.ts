import { EraError, key, type Line, type Routine } from "./model.js";

export const SUPPORTED = new Set([
  "PRINT", "PRINTL", "PRINTW", "PRINTFORM", "PRINTFORML", "PRINTFORMW",
  "PRINTV", "PRINTVL", "PRINTVW", "PRINTS", "PRINTSL", "PRINTSW", "HTML_PRINT",
  "PRINTBUTTON", "PRINTBUTTONC", "DRAWLINE", "CUSTOMDRAWLINE", "CLEARLINE",
  "IF", "ELSEIF", "ELSE", "ENDIF", "SIF", "SELECTCASE", "CASE", "CASEELSE", "ENDSELECT",
  "FOR", "NEXT", "WHILE", "WEND", "DO", "LOOP", "REPEAT", "REND", "BREAK", "CONTINUE",
  "CALL", "JUMP", "RETURN", "GOTO", "INPUT", "INPUTS", "ONEINPUT", "ONEINPUTS", "WAIT", "FORCEWAIT",
  "SETCOLOR", "RESETCOLOR", "SETBGCOLOR", "RESETBGCOLOR", "ALIGNMENT", "QUIT", "THROW",
  "LOADGLOBAL", "SAVEGLOBAL", "CLEARMEMORY", "RETURNF", "FONTSTYLE", "REDRAW",
  "MAP_RELEASE", "MAP_CREATE", "MAP_SET", "PRINTDATA", "PRINTDATAL", "PRINTDATAW", "DATA", "DATAFORM", "ENDDATA",
  "DEBUGPRINT", "DEBUGPRINTL", "DEBUGPRINTFORM", "DEBUGPRINTFORML",
  "SPLIT", "VARSET",
]);
export interface Instruction extends Line { op: string; args: string; target: number }
export interface Compiled {
  code: Instruction[];
  labels: Map<string, number>;
  loops: { start: number; end: number }[];
}
export function classify(line: Line): { op: string; args: string } {
  if (line.text.startsWith("$")) return { op: "LABEL", args: line.text.slice(1).trim() };
  const command = /^(\S+)\s*(.*)$/.exec(line.text)!;
  const op = key(command[1]!);
  if (SUPPORTED.has(op) || /^(?:DEBUG)?PRINT/.test(op)) return { op, args: command[2]! };
  if (/^[^\s=]+(?::.*?)?\s*(?:\+\+|--|(?:'|[+\-*/%&|^])?=)(?!=)/u.test(line.text))
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
    else if (["PRINTDATA", "PRINTDATAL", "PRINTDATAW"].includes(line.op))
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
