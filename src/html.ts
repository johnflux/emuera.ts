import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

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
