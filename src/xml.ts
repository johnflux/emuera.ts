import { DOMParser, XMLSerializer, type Attr, type Document, type Element, type Node } from "@xmldom/xmldom";
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

/** XML_SET reports the selection count even when multiple matches require the all flag. */
export function setNodes(document: Document, path: string, value: string, all: boolean, style: number): number {
  const targets = selectNodes(document, path);
  if (!all && targets.length !== 1) return targets.length;
  const fragment = style === 2 ? parseXml(`<_era_>${value}</_era_>`).documentElement! : undefined;
  for (const target of targets) {
    if (target.nodeType === 2) {
      target.textContent = fragment ? fragment.textContent ?? "" : value;
    } else if (style === 1 || style === 2) {
      if (target.nodeType === 1) {
        while (target.firstChild) target.removeChild(target.firstChild);
        if (fragment) {
          for (const child of Array.from(fragment.childNodes)) target.appendChild(document.importNode(child, true));
        } else target.appendChild(document.createTextNode(value));
      } else target.textContent = value;
    } else {
      if (target.nodeType === 1 || target.nodeType === 9)
        throw new EraError("XML_SET: this node has no Value; use style 1 (text) or 2 (XML)");
      target.textContent = value;
    }
  }
  return targets.length;
}

export function replaceNodes(document: Document, path: string, replacement: Document, all: boolean): number {
  const targets = selectNodes(document, path);
  if (!all && targets.length !== 1) return targets.length;
  for (const target of targets) {
    if (!target.parentNode) return 0;
    target.parentNode.replaceChild(document.importNode(replacement.documentElement!, true), target);
  }
  return targets.length;
}

/** XML_ADDATTRIBUTE can append to elements or insert before/after selected attributes. */
export function addAttribute(document: Document, path: string, name: string, value: string, method: number, all: boolean): number {
  const targets = selectNodes(document, path);
  if (!targets.length || (!all && targets.length !== 1)) return targets.length;
  if (!/^[\p{L}_:][\p{L}\p{N}_.:\-\u00b7]*$/u.test(name)) throw new EraError(`Invalid XML attribute name: ${name}`);
  if (method < 0 || method > 2) method = 0;
  for (const target of targets) {
    if ((method === 0 && target.nodeType !== 1) || (method !== 0 && target.nodeType !== 2)) return 0;
    const element = method === 0 ? target as Element : (target as Attr).ownerElement!;
    if (method === 0) element.setAttribute(name, value);
    else {
      const attributes = Array.from(element.attributes);
      const index = attributes.indexOf(target as Attr) + (method === 2 ? 1 : 0);
      const attribute = document.createAttribute(name);
      attribute.value = value;
      attributes.splice(index, 0, attribute);
      for (const attr of Array.from(element.attributes)) element.removeAttributeNode(attr);
      for (const attr of attributes) element.setAttributeNode(attr);
    }
  }
  return targets.length;
}

export function removeAttributes(document: Document, path: string, all: boolean): number {
  const targets = selectNodes(document, path);
  if (!all && targets.length !== 1) return targets.length;
  for (const target of targets) {
    if (target.nodeType !== 2) return 0;
    const attribute = target as Attr;
    attribute.ownerElement?.removeAttributeNode(attribute);
  }
  return targets.length;
}
