import { DOMParser, XMLSerializer, type Document, type Node } from "@xmldom/xmldom";
import * as xpath from "xpath";
import { EraError } from "./model.js";

/** Parses an XML string, failing with an EraError instead of recovering from malformed markup. */
export function parseXml(source: string): Document {
  let failure: string | undefined;
  const parser = new DOMParser({ onError: (level, message) => { if (level !== "warning") failure ??= message; } });
  let document: Document;
  try { document = parser.parseFromString(source.replace(/^\uFEFF/, ""), "text/xml"); }
  catch (error) { throw new EraError(`Invalid XML: ${error instanceof Error ? error.message : String(error)}`); }
  if (failure || !document.documentElement) throw new EraError(`Invalid XML: ${failure ?? "no root element"}`);
  return document;
}

/** Serializes like .NET's XmlDocument.OuterXml, which writes empty elements as `<name />`. */
export function serializeXml(node: Node): string {
  return new XMLSerializer().serializeToString(node).replace(/<([^\s<>/!?]+)((?:\s+[^\s=<>]+="[^"]*")*)\/>/g, "<$1$2 />");
}

export function selectNodes(document: Document | Node, path: string): Node[] {
  let result: unknown;
  try { result = xpath.select(path, document as unknown as globalThis.Node); }
  catch (error) { throw new EraError(`Invalid XPath ${path}: ${error instanceof Error ? error.message : String(error)}`); }
  if (!Array.isArray(result)) throw new EraError(`XPath does not select nodes: ${path}`);
  return result as unknown as Node[];
}

/** XML_GET output types: 1 InnerText, 2 InnerXml, 3 OuterXml, 4 Name, otherwise Value. */
export function nodeOutput(node: Node, type: number): string {
  switch (type) {
    case 1: return node.textContent ?? "";
    case 2: return [...(node.childNodes as unknown as Iterable<Node>)].map(serializeXml).join("");
    case 3: return serializeXml(node);
    case 4: return node.nodeName;
    default: return node.nodeType === 1 || node.nodeType === 9 ? "" : node.nodeValue ?? "";
  }
}

/** XML_ADDNODE: appends as last child (0), or inserts before (1) / after (2) the selected non-root element. */
export function addNode(document: Document, path: string, nodeXml: string, method: number, all: boolean): number {
  const targets = selectNodes(document, path).filter((node) => node.nodeType === 1);
  if (!targets.length || (!all && targets.length > 1)) return 0;
  const fragment = parseXml(`<_era_>${nodeXml}</_era_>`).documentElement!;
  for (const target of targets) {
    if (method !== 0 && target === document.documentElement) return 0;
    for (const child of [...(fragment.childNodes as unknown as Iterable<Node>)]) {
      const copy = document.importNode(child, true);
      if (method === 0) target.appendChild(copy);
      else if (method === 1) target.parentNode!.insertBefore(copy, target);
      else target.parentNode!.insertBefore(copy, target.nextSibling);
    }
  }
  return targets.length;
}

/** XML_REMOVENODE: removes the selected non-root elements. */
export function removeNode(document: Document, path: string, all: boolean): number {
  const targets = selectNodes(document, path).filter((node) => node.nodeType === 1 && node !== document.documentElement);
  if (!targets.length || (!all && targets.length > 1)) return 0;
  for (const target of targets) target.parentNode!.removeChild(target);
  return targets.length;
}
