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
        if (source[i] === '"' || source.startsWith('@"', i)) { i = quotedEnd(source, i) - 1; continue; }
        if (source[i] === "(") depth++;
        if (source[i] === ")") depth--;
        if (depth === 0 && source[i] === close) break;
      }
    }
  }
  return source.length + 1;
}
