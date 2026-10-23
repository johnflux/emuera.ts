export function stringWidth(value: string): number {
  return [...value].reduce((width, c) => width + (c.codePointAt(0)! <= 0xff || /[\uFF61-\uFF9F]/u.test(c) ? 1 : 2), 0);
}

export function conditionalQuestion(source: string, start: number): number {
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
export function conditionalEnd(source: string, start: number): number {
  const question = conditionalQuestion(source, start + 2);
  if (question < 0) return source.length + 1;
  for (let i = question + 1; i < source.length; i++) {
    if (source[i] === '"' || source.startsWith('@"', i)) { i = quotedEnd(source, i) - 1; continue; }
    if (source.startsWith("\\@", i)) {
      if (conditionalQuestion(source, i + 2) < 0) return i + 2;
      i = conditionalEnd(source, i) - 1;
    }
  }
  return source.length + 1;
}

// Lexical scanning is shared by comments and argument lists, without evaluating FORM syntax.
export function quotedEnd(source: string, start: number): number {
  const formatted = source.startsWith('@"', start);
  let i = start + (formatted ? 2 : 1);
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") { i++; continue; }
    if (c === '"') return i + 1;
    if (formatted && (c === "%" || c === "{")) {
      const close = c === "%" ? "%" : "}";
      let depth = 0;
      for (i++; i < source.length; i++) {
        if (source.startsWith("\\@", i)) { i = conditionalEnd(source, i) - 1; continue; }
        if (source[i] === '"' || source.startsWith('@"', i)) { i = quotedEnd(source, i) - 1; continue; }
        if (source[i] === "(") depth++;
        if (source[i] === ")") depth--;
        if (depth === 0 && source[i] === close) break;
      }
    }
  }
  return source.length + 1;
}
