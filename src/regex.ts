let characterClasses: Record<string, string> | undefined;
const groupOrders = new WeakMap<RegExp, readonly number[]>();

/** .NET's predefined classes use Unicode categories, not JavaScript's ASCII \w and \d. */
export function regexCharacterClasses(pattern: string): string {
  if (!/\\[wWdDbBsS]/.test(pattern)) return pattern;
  if (!characterClasses) {
    const word = /[\p{L}\p{Mn}\p{Nd}\p{Pc}]/u, digit = /\p{Nd}/u, space = /[\u0009-\u000d\u0085\p{Z}]/u;
    const ranges = (predicate: (c: string) => boolean): string => {
      let body = "", start = -1;
      const escape = (code: number): string => `\\u${code.toString(16).padStart(4, "0")}`;
      for (let code = 0; code <= 0x10000; code++) {
        if (code < 0x10000 && predicate(String.fromCharCode(code))) { if (start < 0) start = code; }
        else if (start >= 0) {
          body += escape(start) + (code - 1 === start ? "" : `-${escape(code - 1)}`);
          start = -1;
        }
      }
      return body;
    };
    characterClasses = {};
    for (const [name, regex] of [["w", word], ["d", digit], ["s", space]] as const) {
      characterClasses[name] = ranges((c) => regex.test(c));
      characterClasses[name.toUpperCase()] = ranges((c) => !regex.test(c));
    }
  }
  const classes = characterClasses, boundaryWord = `[${classes.w}\\u200c\\u200d]`;
  let result = "", inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "\\") {
      const next = pattern[++i];
      if (next === undefined) { result += "\\"; break; }
      if (next in classes) result += inClass ? classes[next] : `[${classes[next]}]`;
      else if (!inClass && (next === "b" || next === "B")) {
        result += next === "b"
          ? `(?:(?<!${boundaryWord})(?=${boundaryWord})|(?<=${boundaryWord})(?!${boundaryWord}))`
          : `(?:(?<!${boundaryWord})(?!${boundaryWord})|(?<=${boundaryWord})(?=${boundaryWord}))`;
      } else result += "\\" + next;
    } else {
      if (c === "[") inClass = true;
      if (c === "]") inClass = false;
      result += c;
    }
  }
  return result;
}

/** .NET numbers unnamed captures first, followed by named captures in declaration order. */
export function regexGroupOrder(regex: RegExp): readonly number[] {
  const cached = groupOrders.get(regex);
  if (cached) return cached;
  const pattern = regex.source;
  const unnamed = [0], named: number[] = [];
  let index = 0, inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") { i++; continue; }
    if (c === "[") { inClass = true; continue; }
    if (c === "]") { inClass = false; continue; }
    if (c !== "(" || inClass) continue;
    if (pattern[i + 1] !== "?") unnamed.push(++index);
    else if (pattern[i + 2] === "<" && !["=", "!"].includes(pattern[i + 3] ?? "")) named.push(++index);
  }
  const order = [...unnamed, ...named];
  groupOrders.set(regex, order);
  return order;
}

export function replaceRegex(source: string, regex: RegExp, replacement: string): string {
  const order = regexGroupOrder(regex);
  let result = "", end = 0;
  for (const match of source.matchAll(regex)) {
    const at = match.index;
    const group = (name: string): string | undefined => {
      if (match.groups && Object.hasOwn(match.groups, name)) return match.groups[name] ?? "";
      if (!/^\d+$/.test(name)) return undefined;
      const index = order[Number(name)];
      return index === undefined ? undefined : match[index] ?? "";
    };
    const value = replacement.replace(/\$(?:\{([^}]+)\}|(\d+)|([$&`'+_]))/g, (token: string, name: string | undefined, number: string | undefined, special: string | undefined) => {
      if (name !== undefined || number !== undefined) return group(name ?? number!) ?? token;
      switch (special) {
        case "$": return "$";
        case "&": return match[0];
        case "`": return source.slice(0, at);
        case "'": return source.slice(at + match[0].length);
        case "_": return source;
        case "+": return match[order.at(-1)!] ?? "";
        default: return token;
      }
    });
    result += source.slice(end, at) + value;
    end = at + match[0].length;
  }
  return result + source.slice(end);
}
