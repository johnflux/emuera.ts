import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { stringWidth } from "./strings.js";

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
export function plainHtml(value: string): string {
  function visit(node: DefaultTreeAdapterMap["node"]): string {
    if ("value" in node) return node.value;
    if (node.nodeName === "br") return "\n";
    if ("childNodes" in node) return node.childNodes.map(visit).join("");
    return "";
  }
  return visit(parseFragment(value));
}

export interface ColoredText { text: string; color: string }
export function coloredHtml(value: string, defaultColor: string): ColoredText[] {
  const runs: ColoredText[] = [];
  function append(text: string, color: string): void {
    if (!text) return;
    const last = runs.at(-1);
    if (last?.color === color) last.text += text;
    else runs.push({ text, color });
  }
  function visit(node: DefaultTreeAdapterMap["node"], inherited: string): void {
    const attribute = "attrs" in node ? node.attrs.find((item) => item.name === "color")?.value : undefined;
    const candidate = attribute?.replace(/^#0x([0-9a-f]{6})$/i, "#$1");
    const color = candidate && /^(?:#[0-9a-f]{3}(?:[0-9a-f]{3})?|[a-z]{1,30})$/i.test(candidate) ? candidate : inherited;
    if ("value" in node) append(node.value, color);
    else if (node.nodeName === "br") append("\n", color);
    else if ("childNodes" in node) node.childNodes.forEach((child) => visit(child, color));
  }
  visit(parseFragment(value), defaultColor);
  return runs;
}

/** Values exposed by HTML buttons, with entities decoded as they are in the browser. */
export function htmlButtons(value: string): string[] {
  if (!/<button\b/i.test(value)) return [];
  const values: string[] = [];
  function visit(node: DefaultTreeAdapterMap["node"]): void {
    if (node.nodeName === "button" && "attrs" in node) {
      const value = node.attrs.find((attribute) => attribute.name === "value")?.value;
      if (value !== undefined) values.push(value);
      return;
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  }
  visit(parseFragment(value));
  return values;
}

export function htmlSpriteNames(value: string): string[] {
  if (!/<img\b/i.test(value)) return [];
  const names: string[] = [];
  function visit(node: DefaultTreeAdapterMap["node"]): void {
    if (node.nodeName === "img" && "attrs" in node)
      names.push(...node.attrs.filter((attribute) => attribute.name === "src" || attribute.name === "srcb").map((attribute) => attribute.value));
    if ("childNodes" in node) node.childNodes.forEach(visit);
  }
  visit(parseFragment(value));
  return names;
}

/** Fixed-cell line measurement, using the same sprite/shape units as HTML_STRINGLEN. */
export function htmlLineCount(value: string, width: number, fontSize: number, spriteSize: (name: string) => { width: number; height: number } | undefined): number {
  let lines = 0, used = 0;
  const add = (cells: number): void => {
    if (used && used + cells > width) { lines++; used = 0; }
    used += cells;
    while (used > width) { lines++; used -= width; }
  };
  const newline = (): void => { lines++; used = 0; };
  function visit(node: DefaultTreeAdapterMap["node"]): void {
    if ("value" in node && node.nodeName === "#text") {
      for (const c of node.value) if (c === "\n") newline(); else add(stringWidth(c));
      return;
    }
    if (node.nodeName === "br") { newline(); return; }
    if ((node.nodeName === "img" || node.nodeName === "shape" || node.nodeName === "space") && "attrs" in node) {
      const html = `<${node.nodeName}${node.attrs.map((attribute) => ` ${attribute.name}="${escapeHtml(attribute.value)}"`).join("")}>`;
      add(htmlWidth(html, fontSize, spriteSize).pixels / (fontSize / 2));
      if (node.nodeName === "img") return;
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  }
  visit(parseFragment(value));
  return lines + (used > 0 ? 1 : 0);
}

/**
 * HTML_STRINGLEN's measurement: the first displayed line's width in pixels, with half-width
 * characters at fontSize/2 and <img>/<shape> sizes as font-size percentages or "px" values.
 */
export function htmlWidth(value: string, fontSize: number, spriteSize: (name: string) => { width: number; height: number } | undefined): { pixels: number; nobr: boolean } {
  let pixels = 0, done = false, nobr = false;
  const size = (attribute: string | undefined, fallback: number): number => {
    const match = /^\s*(-?\d+)\s*(px)?\s*$/i.exec(attribute ?? "");
    if (!match) return fallback;
    return Math.abs(match[2] ? Number(match[1]) : Number(match[1]) * fontSize / 100);
  };
  function visit(node: DefaultTreeAdapterMap["node"]): void {
    if (done) return;
    if ("value" in node && node.nodeName === "#text") {
      const [first, ...rest] = node.value.split("\n");
      pixels += stringWidth(first!) * fontSize / 2;
      if (rest.length) done = true;
      return;
    }
    const attrs = new Map("attrs" in node ? node.attrs.map((a) => [a.name, a.value] as const) : []);
    switch (node.nodeName) {
      case "br": done = true; return;
      case "nobr": nobr = true; break;
      case "img": {
        const height = size(attrs.get("height"), fontSize), width = size(attrs.get("width"), 0);
        const sprite = spriteSize(attrs.get("src") ?? "");
        pixels += width || (sprite && sprite.height ? sprite.width * height / sprite.height : 0);
        return;
      }
      case "shape": case "space": {
        const params = (attrs.get("param") ?? "").split(",");
        const param = params.length === 4 ? params[2] : params[0];
        // <space> may move the cursor back with a negative width.
        pixels += size(param, 0) * (node.nodeName === "space" && /^\s*-/.test(param ?? "") ? -1 : 1);
        break;
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  }
  visit(parseFragment(value));
  return { pixels: Math.max(0, pixels), nobr };
}

/** HtmlManager.HtmlTagSplit: alternating text and "<...>" pieces; null if a tag is never closed. */
export function htmlTagSplit(value: string): string[] | null {
  const pieces: string[] = [];
  let position = 0;
  while (position < value.length) {
    const open = value.indexOf("<", position);
    if (open < 0) { pieces.push(value.slice(position)); break; }
    if (open > position) pieces.push(value.slice(position, open));
    const close = value.indexOf(">", open);
    if (close < 0) return null;
    pieces.push(value.slice(open, close + 1));
    position = close + 1;
  }
  return pieces;
}
