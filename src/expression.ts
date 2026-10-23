import { EraError, integer, integerLiteral, INTEGER_LITERAL, key, text, type Value } from "./model.js";
import { readConditional, readFormattedLiteral } from "./format.js";
import { stringWidth } from "./strings.js";

export type Expr =
  | { kind: "literal"; value: Value }
  | { kind: "variable"; name: string; indices: Expr[] }
  | { kind: "call"; name: string; args: Expr[] }
  | { kind: "format"; parts: Expr[] }
  | { kind: "interpolation"; string: boolean; expression: Expr; width?: Expr; left?: boolean }
  | { kind: "omitted" }
  | { kind: "unary"; op: string; operand: Expr }
  | { kind: "binary"; op: string; left: Expr; right: Expr }
  | { kind: "conditional"; condition: Expr; yes: Expr; no: Expr };
interface Token { value: string; type: "name" | "number" | "string" | "format" | "op" | "end"; expression?: Expr }
const precedence: Record<string, number> = {
  "||": 1, "&&": 1, "^^": 1, "!&": 1, "!|": 1,
  "|": 2, "&": 2, "^": 2, "==": 3, "!=": 3,
  "<": 4, ">": 4, "<=": 4, ">=": 4, "<<": 5, ">>": 5,
  "+": 6, "-": 6, "*": 7, "/": 7, "%": 7,
};
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const space = /^\s+/.exec(rest);
    if (space) { i += space[0].length; continue; }
    if (rest.startsWith("\\@")) {
      const result = readConditional(source, i);
      tokens.push({ type: "format", value: "", expression: result.expression });
      i = result.end;
      continue;
    }
    if (rest.startsWith('@"')) {
      const result = readFormattedLiteral(source, i);
      tokens.push({ type: "format", value: "", expression: result.expression });
      i = result.end;
      continue;
    }
    if (rest[0] === '"') {
      let value = "", closed = false;
      i++;
      while (i < source.length) {
        const c = source[i++]!;
        if (c === '"') { closed = true; break; }
        if (c === "\\") {
          const next = source[i++];
          if (next === undefined) throw new EraError("Unterminated string escape");
          const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };
          value += next in escapes ? escapes[next] : "\\" + next;
        } else value += c;
      }
      if (!closed) throw new EraError("Unterminated string");
      tokens.push({ type: "string", value });
      continue;
    }
    const number = INTEGER_LITERAL.exec(rest);
    if (number) { tokens.push({ type: "number", value: number[0] }); i += number[0].length; continue; }
    const name = /^[\p{L}\p{N}\p{Sc}_\p{M}\u30FB]+/u.exec(rest);
    if (name) { tokens.push({ type: "name", value: key(name[0]) }); i += name[0].length; continue; }
    const op = /^(?:==|!=|<=|>=|<<|>>|&&|\|\||\^\^|!&|!\||[+\-*/%<>&|^!~():,?#])/.exec(rest);
    if (!op) throw new EraError(`Unsupported expression syntax near: ${rest.slice(0, 35)}`);
    tokens.push({ type: "op", value: op[0] });
    i += op[0].length;
  }
  tokens.push({ type: "end", value: "" });
  return tokens;
}
export function parseExpression(source: string): Expr {
  const tokens = tokenize(source);
  let cursor = 0;
  const peek = (): Token => tokens[cursor]!;
  const take = (): Token => tokens[cursor++]!;
  const expect = (value: string): void => {
    if (take().value !== value) throw new EraError(`Expected '${value}' in expression: ${source}`);
  };
  function primary(): Expr {
    const token = take();
    if (token.type === "number") return { kind: "literal", value: BigInt.asIntN(64, integerLiteral(token.value)) };
    if (token.type === "string") return { kind: "literal", value: token.value };
    if (token.type === "format") return token.expression!;
    if (["!", "~", "+", "-"].includes(token.value)) return { kind: "unary", op: token.value, operand: primary() };
    if (token.value === "(") { const result = expression(0); expect(")"); return result; }
    if (token.type !== "name") throw new EraError(`Expected value in expression: ${source}`);
    if (peek().value === "(") {
      take();
      const args: Expr[] = [];
      if (peek().value !== ")") {
        do {
          args.push(peek().value === "," || peek().value === ")" ? { kind: "omitted" } : expression(0));
          if (peek().value !== ",") break;
          take();
        } while (true);
      }
      expect(")");
      return { kind: "call", name: token.value, args };
    }
    const indices: Expr[] = [];
    while (peek().value === ":") {
      take();
      // Bare indices bind tightly; computed indices must be parenthesized.
      const index = peek();
      if (index.type === "name" && tokens[cursor + 1]?.value !== "(") {
        take();
        indices.push({ kind: "variable", name: index.value, indices: [] });
      } else indices.push(primary());
    }
    return { kind: "variable", name: token.value, indices };
  }
  function expression(minimum: number): Expr {
    let left = primary();
    while ((precedence[peek().value] ?? -1) >= minimum) {
      const op = take().value;
      left = { kind: "binary", op, left, right: expression(precedence[op]! + 1) };
    }
    if (minimum === 0 && peek().value === "?") {
      take();
      const yes = expression(0);
      expect("#");
      left = { kind: "conditional", condition: left, yes, no: expression(0) };
    }
    return left;
  }
  const result = expression(0);
  if (peek().type !== "end") throw new EraError(`Unexpected '${peek().value}' in expression: ${source}`);
  return result;
}
export interface EvaluationContext {
  get(name: string, indices: Expr[]): Value;
  call(name: string, args: (Value | undefined)[]): Value;
  referenceCall?(name: string, args: Expr[]): Value | undefined;
}
export function evaluate(expr: Expr, context: EvaluationContext): Value {
  const ev = (node: Expr): Value => evaluate(node, context);
  switch (expr.kind) {
    case "literal": return expr.value;
    case "variable": return context.get(expr.name, expr.indices);
    case "call": return context.referenceCall?.(expr.name, expr.args) ?? context.call(expr.name, expr.args.map((arg) => arg.kind === "omitted" ? undefined : ev(arg)));
    case "omitted": throw new EraError("Omitted argument outside a function call");
    case "format": {
      let value = "";
      for (const part of expr.parts) {
        value += text(ev(part));
        if (value.length > 1_000_000) throw new EraError("Formatted string exceeds limit");
      }
      return value;
    }
    case "interpolation": {
      const value = ev(expr.expression);
      const result = expr.string ? text(value) : integer(value).toString();
      if (!expr.width) return result;
      const width = integer(ev(expr.width));
      if (width < 0n || width > 1_000_000n) throw new EraError("FORM width out of range");
      const measured = stringWidth(result);
      const padding = " ".repeat(Math.max(0, Number(width) - measured));
      return expr.left ? result + padding : padding + result;
    }
    case "conditional": return ev(integer(ev(expr.condition)) !== 0n ? expr.yes : expr.no);
    case "unary": {
      const value = integer(ev(expr.operand));
      switch (expr.op) {
        case "!": return value === 0n ? 1n : 0n;
        case "~": return BigInt.asIntN(64, ~value);
        case "-": return BigInt.asIntN(64, -value);
        default: return value;
      }
    }
    case "binary": {
      const a = ev(expr.left);
      if (expr.op === "&&" && integer(a) === 0n) return 0n;
      if (expr.op === "||" && integer(a) !== 0n) return 1n;
      const b = ev(expr.right);
      if (expr.op === "+" && typeof a === "string") return a + text(b);
      if (expr.op === "*" && typeof a === "string") {
        const count = integer(b);
        if (count < 0n || count * BigInt(a.length) > 1_000_000n) throw new EraError("String repetition exceeds limit");
        return a.repeat(Number(count));
      }
      if (["==", "!=", "<", ">", "<=", ">="].includes(expr.op)) {
        if (typeof a !== typeof b) throw new EraError("Cannot compare strings and integers");
        const yes = expr.op === "==" ? a === b : expr.op === "!=" ? a !== b : expr.op === "<" ? a < b
          : expr.op === ">" ? a > b : expr.op === "<=" ? a <= b : a >= b;
        return yes ? 1n : 0n;
      }
      const x = integer(a), y = integer(b);
      let result: bigint;
      switch (expr.op) {
        case "+": result = x + y; break;
        case "-": result = x - y; break;
        case "*": result = x * y; break;
        case "/": case "%":
          if (y === 0n) throw new EraError("Division by zero");
          result = expr.op === "/" ? x / y : x % y; break;
        case "<<": case ">>":
          if (y < 0n || y > 63n) throw new EraError("Shift count must be between 0 and 63");
          result = expr.op === "<<" ? x << y : x >> y; break;
        case "&": result = x & y; break;
        case "|": result = x | y; break;
        case "^": result = x ^ y; break;
        case "&&": result = x !== 0n && y !== 0n ? 1n : 0n; break;
        case "||": result = x !== 0n || y !== 0n ? 1n : 0n; break;
        case "^^": result = (x !== 0n) !== (y !== 0n) ? 1n : 0n; break;
        case "!&": result = !(x !== 0n && y !== 0n) ? 1n : 0n; break;
        case "!|": result = !(x !== 0n || y !== 0n) ? 1n : 0n; break;
        default: throw new EraError(`Unsupported operator: ${expr.op}`);
      }
      return BigInt.asIntN(64, result);
    }
  }
}
