import { parseExpression, type Expr } from "./expression.js";
import { EraError, key, splitArguments, stripComment } from "./model.js";
import { conditionalEnd, quotedEnd } from "./strings.js";

export interface Assignment { reference: Extract<Expr, { kind: "variable" }>; operator: string; value: string; expressionValue: string }
export interface CallTarget { name: string; parameters: string }
export type CaseTest =
  | { kind: "range"; from: string; to: string }
  | { kind: "compare"; op: string; operand: string }
  | { kind: "value"; source: string };

export function parseAssignment(source: string, fullWidthSpace: boolean, parse = parseExpression): Assignment {
  const prefix = /^(\+\+|--)\s*(.+)$/.exec(source);
  if (prefix) {
    const reference = parse(prefix[2]!);
    if (reference.kind !== "variable") throw new EraError("Invalid assignment target");
    return { reference, operator: prefix[1]!, value: "", expressionValue: "" };
  }
  // The operator is the first one outside parentheses/strings, so `A:(N++) = X` targets A.
  let depth = 0, quoted = false, match: RegExpExecArray | null = null, at = 0;
  for (; at < source.length; at++) {
    const c = source[at]!;
    if (quoted) { if (c === "\\") at++; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && (match = (fullWidthSpace ? /^(\+\+|--|'=|==|<<=|>>=|[+\-*/%&|^]?=)\s*/ : /^(\+\+|--|'=|==|<<=|>>=|[+\-*/%&|^]?=)[ \t]*/).exec(source.slice(at)))) break;
  }
  if (!match) throw new EraError("Invalid assignment");
  const operator = match[1]!;
  let target = source.slice(0, at).trim();
  if (/^(?:<<|>>|[+\-*/%&|^])=$/.test(operator)) target = target.replace(/,$/, "").trimEnd();
  if (splitArguments(target).length > 1) throw new EraError("Left side of assignment has an extra ','");
  const reference = parse(target);
  if (reference.kind !== "variable") throw new EraError("Invalid assignment target");
  const value = source.slice(at + match[0].length);
  return { reference, operator: operator === "==" ? "=" : operator, value, expressionValue: stripComment(value, fullWidthSpace) };
}

export function parseCallTarget(source: string): CallTarget | null {
  const match = /^([^\s,(]+)\s*(.*)$/.exec(source);
  if (!match) return null;
  let parameters = match[2]!.trim();
  if (parameters.startsWith("(") && parameters.endsWith(")")) parameters = parameters.slice(1, -1);
  else parameters = parameters.replace(/^,/, "");
  return { name: key(match[1]!), parameters: parameters.trim() };
}

/** End of a CALLFORM-style function name: the first top-level "(" or "," outside %...% and {...}. */
export function formNameEnd(source: string): number {
  let braces = 0, percent = false, quote = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quote) { if (c === "\\") i++; else if (c === '"') quote = false; continue; }
    if (c === '"' && (braces || percent)) quote = true;
    else if (c === "{") braces++;
    else if (c === "}") braces--;
    else if (c === "%" && !braces) percent = !percent;
    else if (!braces && !percent && (c === "(" || c === ",")) return i;
  }
  return source.length;
}

export function parseCaseTests(parts: readonly string[]): CaseTest[] {
  return parts.filter((part) => part !== "").map((part): CaseTest => {
    let depth = 0;
    for (let i = 0; i < part.length; i++) {
      if (part.startsWith("\\@", i)) { i = conditionalEnd(part, i) - 1; continue; }
      if (part[i] === '"' || part.startsWith('@"', i)) { i = quotedEnd(part, i) - 1; continue; }
      if (part[i] === "(") depth++;
      if (part[i] === ")") depth--;
      const range = depth === 0 && /^\s+TO\s+/i.exec(part.slice(i));
      if (range) return { kind: "range", from: part.slice(0, i), to: part.slice(i + range[0].length) };
    }
    // Emuera accepts any binary operator after IS.
    const comparison = /^IS\s*(==|!=|<=|>=|<<|>>|&&|\|\||\^\^|!&|!\||<|>|&|\||\^|\+|-|\*|\/|%)\s*(.*)$/i.exec(part);
    if (comparison) return { kind: "compare", op: comparison[1]!, operand: comparison[2]! };
    return { kind: "value", source: part };
  });
}
