import { EraError } from "./model.js";

/** A cell value as seen by DataColumn expressions; undefined is DBNull. */
export type Cell = bigint | string | boolean | undefined;
export type RowReader = (column: string) => Cell;
type Node = (row: RowReader) => Cell;

interface Token { kind: "number" | "string" | "name" | "op" | "end"; text: string }

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") {
      let value = "";
      i++;
      while (true) {
        if (i >= source.length) throw new EraError(`Unterminated string in data-table expression: ${source}`);
        if (source[i] === "'") {
          if (source[i + 1] === "'") { value += "'"; i += 2; continue; }
          i++;
          break;
        }
        value += source[i++];
      }
      tokens.push({ kind: "string", text: value });
      continue;
    }
    if (c === "[") {
      const end = source.indexOf("]", i);
      if (end < 0) throw new EraError(`Unterminated column name in data-table expression: ${source}`);
      tokens.push({ kind: "name", text: source.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const number = /^\d+(?:\.\d+)?/.exec(source.slice(i));
    if (number) { tokens.push({ kind: "number", text: number[0] }); i += number[0].length; continue; }
    const op = /^(<>|<=|>=|!=|==|[=<>+\-*/%(),])/.exec(source.slice(i));
    if (op) { tokens.push({ kind: "op", text: op[0] }); i += op[0].length; continue; }
    const name = /^[^\s'[\]=<>!+\-*/%(),]+/u.exec(source.slice(i));
    if (!name) throw new EraError(`Unexpected character in data-table expression: ${source}`);
    tokens.push({ kind: "name", text: name[0] });
    i += name[0].length;
  }
  tokens.push({ kind: "end", text: "" });
  return tokens;
}

/** Orders two non-null cells, converting a string to an integer when compared with an integer column. */
function compare(a: Cell, b: Cell, caseSensitive: boolean): number {
  if (typeof a === "boolean") a = a ? 1n : 0n;
  if (typeof b === "boolean") b = b ? 1n : 0n;
  if (typeof a === "bigint" && typeof b === "string" && /^\s*[+-]?\d+\s*$/.test(b)) b = BigInt(b.trim());
  if (typeof b === "bigint" && typeof a === "string" && /^\s*[+-]?\d+\s*$/.test(a)) a = BigInt(a.trim());
  if (typeof a === "bigint" && typeof b === "bigint") return a < b ? -1 : a > b ? 1 : 0;
  let x = String(a), y = String(b);
  if (!caseSensitive) { x = x.toLowerCase(); y = y.toLowerCase(); }
  return x < y ? -1 : x > y ? 1 : 0;
}

function truthy(value: Cell): boolean {
  return value === true || (typeof value === "bigint" && value !== 0n) || (typeof value === "string" && value.toLowerCase() === "true");
}

function likePattern(pattern: string, caseSensitive: boolean): RegExp {
  let regex = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*" || c === "%") regex += ".*";
    else if (c === "[") {
      const end = pattern.indexOf("]", i);
      if (end < 0) throw new EraError(`Invalid LIKE pattern: ${pattern}`);
      regex += pattern.slice(i + 1, end).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i = end;
    } else regex += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${regex}$`, caseSensitive ? "su" : "isu");
}

/** Compiles a .NET DataColumn.Expression filter (comparisons, LIKE, IN, IS NULL, AND/OR/NOT, arithmetic, LEN/ISNULL/TRIM). */
export function compileFilter(source: string, caseSensitive: boolean): (row: RowReader) => boolean {
  const tokens = tokenize(source);
  let position = 0;
  const peek = (): Token => tokens[position]!;
  const keyword = (word: string): boolean => {
    const token = peek();
    if (token.kind === "name" && token.text.toUpperCase() === word) { position++; return true; }
    return false;
  };
  const operator = (text: string): boolean => {
    if (peek().kind === "op" && peek().text === text) { position++; return true; }
    return false;
  };
  const expect = (text: string): void => {
    if (!operator(text)) throw new EraError(`Expected '${text}' in data-table expression: ${source}`);
  };
  const or = (): Node => {
    let left = and();
    while (keyword("OR")) {
      const a = left, b = and();
      left = (row) => truthy(a(row)) || truthy(b(row));
    }
    return left;
  };
  const and = (): Node => {
    let left = not();
    while (keyword("AND")) {
      const a = left, b = not();
      left = (row) => truthy(a(row)) && truthy(b(row));
    }
    return left;
  };
  const not = (): Node => {
    if (keyword("NOT")) {
      const inner = not();
      return (row) => { const value = inner(row); return value === undefined ? undefined : !truthy(value); };
    }
    return comparison();
  };
  const comparison = (): Node => {
    const left = additive();
    const token = peek();
    if (token.kind === "op" && ["=", "==", "<>", "!=", "<", ">", "<=", ">="].includes(token.text)) {
      position++;
      const right = additive();
      const test = { "=": (n: number) => n === 0, "==": (n: number) => n === 0, "<>": (n: number) => n !== 0, "!=": (n: number) => n !== 0,
        "<": (n: number) => n < 0, ">": (n: number) => n > 0, "<=": (n: number) => n <= 0, ">=": (n: number) => n >= 0 }[token.text]!;
      return (row) => {
        const a = left(row), b = right(row);
        return a === undefined || b === undefined ? undefined : test(compare(a, b, caseSensitive));
      };
    }
    if (keyword("IS")) {
      const negate = keyword("NOT");
      if (!keyword("NULL")) throw new EraError(`Expected NULL after IS in data-table expression: ${source}`);
      return (row) => (left(row) === undefined) !== negate;
    }
    const negate = keyword("NOT");
    if (keyword("LIKE")) {
      const pattern = additive();
      const cache = new Map<string, RegExp>();
      const like: Node = (row) => {
        const value = left(row), text = pattern(row);
        if (value === undefined || text === undefined) return undefined;
        let regex = cache.get(String(text));
        if (!regex) { regex = likePattern(String(text), caseSensitive); cache.set(String(text), regex); }
        return regex.test(String(value));
      };
      return negate ? (row) => { const value = like(row); return value === undefined ? undefined : !value; } : like;
    }
    if (keyword("IN")) {
      expect("(");
      const items: Node[] = [];
      do items.push(additive()); while (operator(","));
      expect(")");
      const inside: Node = (row) => {
        const value = left(row);
        if (value === undefined) return undefined;
        return items.some((item) => { const candidate = item(row); return candidate !== undefined && compare(value, candidate, caseSensitive) === 0; });
      };
      return negate ? (row) => { const value = inside(row); return value === undefined ? undefined : !value; } : inside;
    }
    if (negate) throw new EraError(`Expected LIKE or IN after NOT in data-table expression: ${source}`);
    return left;
  };
  const arithmetic = (a: Cell, b: Cell, op: string): Cell => {
    if (a === undefined || b === undefined) return undefined;
    if (op === "+" && (typeof a === "string" || typeof b === "string")) return String(a) + String(b);
    const x = typeof a === "bigint" ? a : BigInt(String(a === true ? 1 : a === false ? 0 : a).trim());
    const y = typeof b === "bigint" ? b : BigInt(String(b === true ? 1 : b === false ? 0 : b).trim());
    if ((op === "/" || op === "%") && y === 0n) throw new EraError("Division by zero in data-table expression");
    return op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : op === "/" ? x / y : x % y;
  };
  const additive = (): Node => {
    let left = multiplicative();
    while (peek().kind === "op" && (peek().text === "+" || peek().text === "-")) {
      const op = tokens[position++]!.text, a = left, b = multiplicative();
      left = (row) => arithmetic(a(row), b(row), op);
    }
    return left;
  };
  const multiplicative = (): Node => {
    let left = unary();
    while (peek().kind === "op" && ["*", "/", "%"].includes(peek().text)) {
      const op = tokens[position++]!.text, a = left, b = unary();
      left = (row) => arithmetic(a(row), b(row), op);
    }
    return left;
  };
  const unary = (): Node => {
    if (operator("-")) { const inner = unary(); return (row) => arithmetic(0n, inner(row), "-"); }
    if (operator("+")) return unary();
    return primary();
  };
  const primary = (): Node => {
    const token = tokens[position++]!;
    if (token.kind === "number") {
      if (token.text.includes(".")) throw new EraError(`Non-integer literals are not supported in data-table expressions: ${source}`);
      const value = BigInt(token.text);
      return () => value;
    }
    if (token.kind === "string") return () => token.text;
    if (token.kind === "op" && token.text === "(") {
      const inner = or();
      expect(")");
      return inner;
    }
    if (token.kind === "name") {
      const upper = token.text.toUpperCase();
      if (upper === "TRUE") return () => true;
      if (upper === "FALSE") return () => false;
      if (upper === "NULL") return () => undefined;
      if (peek().kind === "op" && peek().text === "(" && ["LEN", "ISNULL", "TRIM"].includes(upper)) {
        position++;
        const args: Node[] = [];
        if (!operator(")")) { do args.push(or()); while (operator(",")); expect(")"); }
        if (upper === "LEN" && args.length === 1) return (row) => { const value = args[0]!(row); return value === undefined ? undefined : BigInt(String(value).length); };
        if (upper === "TRIM" && args.length === 1) return (row) => { const value = args[0]!(row); return value === undefined ? undefined : String(value).trim(); };
        if (upper === "ISNULL" && args.length === 2) return (row) => args[0]!(row) ?? args[1]!(row);
        throw new EraError(`Invalid arguments for ${upper} in data-table expression: ${source}`);
      }
      const column = token.text;
      return (row) => row(column);
    }
    throw new EraError(`Unexpected '${token.text}' in data-table expression: ${source}`);
  };
  const root = or();
  if (peek().kind !== "end") throw new EraError(`Unexpected '${peek().text}' in data-table expression: ${source}`);
  return (row) => truthy(root(row));
}

/** Parses a DataTable.Select sort rule such as "age ASC, height DESC". */
export function parseSort(source: string): { column: string; descending: boolean }[] {
  return source.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = /^(\[[^\]]+\]|\S+)(?:\s+(ASC|DESC))?$/i.exec(part);
    if (!match) throw new EraError(`Invalid data-table sort rule: ${source}`);
    return { column: match[1]!.replace(/^\[(.*)\]$/, "$1"), descending: match[2]?.toUpperCase() === "DESC" };
  });
}

export function compareCells(a: Cell, b: Cell, caseSensitive: boolean): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1;
  return compare(a, b, caseSensitive);
}
