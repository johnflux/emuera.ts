let doubleByte: Set<string> | undefined;
/** Characters CP932 encodes in two bytes, from the platform's Shift_JIS (Windows-31J) decoder. */
function cp932DoubleByte(): Set<string> {
  if (doubleByte) return doubleByte;
  const decoder = new TextDecoder("shift_jis");
  doubleByte = new Set();
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    if (lead >= 0xa0 && lead < 0xe0) continue;
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      const c = decoder.decode(new Uint8Array([lead, trail]));
      if (c !== "\uFFFD" && [...c].length === 1) doubleByte.add(c);
    }
  }
  return doubleByte;
}
/**
 * Emuera's STRLENS and print alignment use the Shift-JIS byte count: two for JIS characters (×, °, ─, 全角),
 * one for ASCII and half-width kana, and one for anything CP932 can't encode (▄, ♥, é), which becomes "?".
 */
export function stringWidth(value: string): number {
  const wide = cp932DoubleByte();
  let width = 0;
  for (const c of value) width += wide.has(c) ? 2 : c.length;
  return width;
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
  // Emuera's AnalyseYenAt: the branches are FORM text (quotes are literal) and the next \@ always closes; there is no nesting.
  for (let i = question + 1; i < source.length; i++) {
    if (source.startsWith("\\@", i)) return i + 2;
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === "%" || source[i] === "{") i = expressionEnd(source, i);
  }
  return source.length + 1;
}
/** Index of the % or } closing a FORM expression that opens at start. */
function expressionEnd(source: string, start: number): number {
  const close = source[start] === "%" ? "%" : "}";
  let depth = 0;
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '"' || source.startsWith('@"', i)) { i = quotedEnd(source, i) - 1; continue; }
    if (source[i] === "(") depth++;
    if (source[i] === ")") depth--;
    if (depth === 0 && source[i] === close) return i;
  }
  return source.length;
}

// Lexical scanning is shared by comments and argument lists, without evaluating FORM syntax.
export function quotedEnd(source: string, start: number): number {
  const formatted = source.startsWith('@"', start);
  let i = start + (formatted ? 2 : 1);
  for (; i < source.length; i++) {
    const c = source[i];
    if (formatted && source.startsWith("\\@", i)) { i = conditionalEnd(source, i) - 1; continue; }
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

const HALF_KANA = /[\uFF61-\uFF9F][\uFF9E\uFF9F]?/g;
let fullKana: Map<string, string> | undefined;
const fullMark = (c: string): string => c === "\uFF9E" ? "\u309B" : c === "\uFF9F" ? "\u309C" : c.normalize("NFKC");

/** Converts half-width ASCII, spaces and katakana to full width (VB StrConv Wide). */
export function toFullWidth(value: string): string {
  return value
    .replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))
    .replace(/ /g, "\u3000")
    .replace(HALF_KANA, (kana) => {
      const full = kana.normalize("NFKC");
      return kana.length > 1 && full.length === 1 ? full : Array.from(kana, fullMark).join("");
    });
}

/** Converts full-width characters that have half-width forms; other characters are unchanged. */
export function toHalfWidth(value: string): string {
  if (!fullKana) {
    fullKana = new Map([["\u309B", "\uFF9E"], ["\u309C", "\uFF9F"]]);
    for (let code = 0xff61; code <= 0xff9f; code++) {
      const half = String.fromCharCode(code);
      for (const kana of [half, half + "\uFF9E", half + "\uFF9F"]) {
        const full = kana.normalize("NFKC");
        if (full.length === 1 && !fullKana.has(full)) fullKana.set(full, kana);
      }
    }
  }
  const kana = fullKana;
  return Array.from(value, (c) => {
    const code = c.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
    if (c === "\u3000") return " ";
    return kana.get(c) ?? c;
  }).join("");
}
/** Formats integers with standard D/X/N/F/G formats or 0/#/,/. patterns with literal currency affixes. */
export function formatInteger(value: bigint, format: string): string | undefined {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+$)/g, ",");
  const standard = /^([DdXxNnFfGg])(\d{0,2})$/.exec(format);
  if (standard) {
    const precision = standard[2] ? Number(standard[2]) : undefined;
    switch (standard[1]!.toUpperCase()) {
      case "D": return (negative ? "-" : "") + magnitude.toString().padStart(precision ?? 0, "0");
      case "X": {
        const digits = BigInt.asUintN(64, value).toString(16).padStart(precision ?? 0, "0");
        return standard[1] === "X" ? digits.toUpperCase() : digits;
      }
      case "N": case "F": {
        const decimals = precision ?? 2;
        const whole = standard[1]!.toUpperCase() === "N" ? group(magnitude.toString()) : magnitude.toString();
        return (negative ? "-" : "") + whole + (decimals ? "." + "0".repeat(decimals) : "");
      }
      default: return value.toString();
    }
  }
  const custom = /^([\p{Sc} +()-]*)([0#,.]+)([\p{Sc} +()-]*)$/u.exec(format);
  if (!custom) return undefined;
  const prefix = custom[1]!, suffix = custom[3]!;
  format = custom[2]!;
  const point = format.indexOf(".");
  let whole = point < 0 ? format : format.slice(0, point);
  const fraction = point < 0 ? "" : format.slice(point + 1).replace(/[.,]/g, "");
  // Commas directly before the decimal point divide by 1000 each.
  let scale = 0;
  while (whole.endsWith(",")) { whole = whole.slice(0, -1); scale++; }
  const grouping = whole.includes(",");
  const minimumWhole = (whole.match(/0/g) ?? []).length;
  const minimumFraction = (fraction.match(/0/g) ?? []).length;
  const maximumFraction = fraction.length;
  const divisor = 1000n ** BigInt(scale);
  const unit = 10n ** BigInt(maximumFraction);
  // Round half away from zero at the last fraction digit.
  const scaled = (magnitude * unit * 2n + divisor) / (divisor * 2n);
  let wholeDigits = (scaled / unit).toString();
  let fractionDigits = maximumFraction ? (scaled % unit).toString().padStart(maximumFraction, "0") : "";
  while (fractionDigits.length > minimumFraction && fractionDigits.endsWith("0")) fractionDigits = fractionDigits.slice(0, -1);
  wholeDigits = wholeDigits === "0" && minimumWhole === 0 ? "" : wholeDigits.padStart(minimumWhole, "0");
  if (grouping) wholeDigits = group(wholeDigits);
  const result = wholeDigits + (fractionDigits ? "." + fractionDigits : "");
  return (negative && /[1-9]/.test(result) ? "-" : "") + prefix + result + suffix;
}
