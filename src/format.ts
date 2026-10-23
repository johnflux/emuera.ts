import { parseExpression, type Expr } from "./expression.js";
import { EraError, splitArguments } from "./model.js";
import { conditionalQuestion } from "./strings.js";

interface Segment { expression: Expr; end: number }

function expressionEnd(source: string, start: number, delimiter: string): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i]!;
    if (source.startsWith('@"', i)) { i = readFormattedLiteral(source, i).end - 1; continue; }
    if (source.startsWith("\\@", i)) { i = readConditional(source, i).end - 1; continue; }
    if (c === '"') {
      for (i++; i < source.length; i++) {
        if (source[i] === "\\") { i++; continue; }
        if (source[i] === '"') break;
      }
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (depth === 0 && c === delimiter) return i;
  }
  throw new EraError(`Unclosed formatted expression (expected ${delimiter})`);
}
function readTemplate(source: string, start: number, stop = ""): Segment {
  const parts: Expr[] = [];
  let plain = "";
  const flush = (): void => {
    if (plain) { parts.push({ kind: "literal", value: plain }); plain = ""; }
  };
  let i = start;
  for (; i < source.length;) {
    if (stop && source.startsWith(stop, i) && !(stop === "\\@" && conditionalQuestion(source, i + 2) >= 0)) break;
    if (source.startsWith("\\@", i)) {
      flush();
      const conditional = readConditional(source, i);
      parts.push(conditional.expression);
      i = conditional.end;
    } else if (source[i] === "{" || source[i] === "%") {
      flush();
      const delimiter = source[i] === "{" ? "}" : "%";
      const end = expressionEnd(source, i + 1, delimiter);
      const fields = splitArguments(source.slice(i + 1, end).trim());
      if (fields.length > 3 || fields[2] && !/^(LEFT|RIGHT)$/i.test(fields[2])) throw new EraError("Invalid FORM padding");
      const interpolation: Expr = { kind: "interpolation", string: delimiter === "%", expression: parseExpression(fields[0]!), left: fields[2]?.toUpperCase() === "LEFT" };
      if (fields[1]) interpolation.width = parseExpression(fields[1]);
      parts.push(interpolation);
      i = end + 1;
    } else if (source[i] === "\\") {
      const next = source[i + 1];
      if (next === undefined) throw new EraError("Unterminated format escape");
      plain += next === "n" ? "\n" : next === "t" ? "\t" : next;
      i += 2;
    } else { plain += source[i]; i++; }
  }
  if (stop && !source.startsWith(stop, i)) throw new EraError(`Unclosed formatted string (expected ${stop})`);
  flush();
  // Conditional FORM arms ignore separator padding.
  if (stop === "#" || stop === "\\@") {
    const first = parts[0], last = parts.at(-1);
    if (first?.kind === "literal" && typeof first.value === "string") first.value = first.value.trimStart();
    if (last?.kind === "literal" && typeof last.value === "string") last.value = last.value.trimEnd();
  }
  return { expression: { kind: "format", parts }, end: i };
}
export function readConditional(source: string, start: number): Segment {
  const question = conditionalQuestion(source, start + 2);
  if (question < 0) throw new EraError("FORM conditional requires a condition and '?'");
  const condition = parseExpression(source.slice(start + 2, question).trim());
  const yes = readTemplate(source, question + 1, "#");
  const no = readTemplate(source, yes.end + 1, "\\@");
  return { expression: { kind: "conditional", condition, yes: yes.expression, no: no.expression }, end: no.end + 2 };
}
export function parseFormat(source: string): Expr { return readTemplate(source, 0).expression; }
export function readFormattedLiteral(source: string, start: number): Segment {
  const result = readTemplate(source, start + 2, '"');
  return { expression: result.expression, end: result.end + 1 };
}
