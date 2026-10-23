import { parseExpression, type Expr } from "./expression.js";
import { EraError } from "./model.js";
import { quotedEnd } from "./strings.js";

interface Segment { expression: Expr; end: number }

function conditionalQuestion(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '"' || source.startsWith('@"', i)) { i = quotedEnd(source, i) - 1; continue; }
    if (source[i] === "(") depth++;
    if (source[i] === ")") depth--;
    if (depth === 0 && source[i] === "?") return i;
    if (depth === 0 && (source.startsWith("\\@", i) || source[i] === "#")) return -1;
  }
  return -1;
}
function expressionEnd(source: string, start: number, delimiter: string): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i]!;
    if (source.startsWith('@"', i)) { i = readFormattedLiteral(source, i).end - 1; continue; }
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
      const question = conditionalQuestion(source, i + 2);
      if (question < 0) throw new EraError("FORM conditional requires a condition and '?'");
      const condition = parseExpression(source.slice(i + 2, question).trim());
      const yes = readTemplate(source, question + 1, "#");
      const no = readTemplate(source, yes.end + 1, "\\@");
      parts.push({ kind: "conditional", condition, yes: yes.expression, no: no.expression });
      i = no.end + 2;
    } else if (source[i] === "{" || source[i] === "%") {
      flush();
      const delimiter = source[i] === "{" ? "}" : "%";
      const end = expressionEnd(source, i + 1, delimiter);
      parts.push({ kind: "interpolation", string: delimiter === "%", expression: parseExpression(source.slice(i + 1, end).trim()) });
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
export function parseFormat(source: string): Expr { return readTemplate(source, 0).expression; }
export function readFormattedLiteral(source: string, start: number): Segment {
  const result = readTemplate(source, start + 2, '"');
  return { expression: result.expression, end: result.end + 1 };
}
