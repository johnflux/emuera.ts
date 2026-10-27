import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

class Element {
  nodeType = 1;
  children: Element[] = [];
  parent?: Element;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  classes = new Set<string>();
  classList = { add: (name: string) => this.classes.add(name) };
  constructor(public tagName: string, private attrs = new Map<string, string>(), public textContent = "") {}
  get childNodes() { return this.children; }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string) { return this.attrs.has(name); }
  append(child: Element) { child.parent = this; this.children.push(child); }
  matches() { return false; }
  closest(): Element { return this.parent ? this.parent.closest() : this; }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap((child) => [
      ...(selector === ".html-positioned" && child.classes.has("html-positioned") ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  get width(): number {
    return Number.parseFloat(this.style.width ?? "") || this.children.reduce((sum, child) =>
      sum + child.width + Number.parseFloat(child.style.marginLeft ?? "0"), 0);
  }
  getBoundingClientRect(): { left: number } {
    if (!this.parent) return { left: 40 };
    const siblings = this.parent.children.slice(0, this.parent.children.indexOf(this));
    return { left: this.parent.getBoundingClientRect().left
      + siblings.reduce((sum, child) => sum + child.width + Number.parseFloat(child.style.marginLeft ?? "0"), 0)
      + Number.parseFloat(this.style.marginLeft ?? "0") };
  }
}
function parsed(node: DefaultTreeAdapterMap["node"]): Element {
  const result = new Element(node.nodeName.toUpperCase(),
    new Map("attrs" in node ? node.attrs.map(({ name, value }) => [name, value]) : []));
  if ("value" in node) { result.nodeType = 3; result.textContent = node.value; result.style.width = `${node.value.length * 10}px`; }
  if ("childNodes" in node) node.childNodes.forEach((child) => result.append(parsed(child)));
  return result;
}

test("HTML pos stacks unequal image layers, resets the cursor and remains stable across renders", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const functionSource = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const terminal = new Element("DIV");
  const { renderHtml, layoutHtmlPositions } = runInNewContext([
    functionSource("function sizeAttribute(", "async function loadImage("),
    functionSource("function layoutHtmlPositions(", "/**"),
    functionSource("async function renderHtml(", "// A browser's page translator"),
    "({ renderHtml, layoutHtmlPositions })",
  ].join("\n"), {
    terminal, Element, Node: { TEXT_NODE: 3 }, generation: 0,
    metrics: { fontSize: 20 }, imageScale: () => 1.5,
    DOMParser: class { parseFromString(markup: string) { return { head: { children: [] }, body: parsed(parseFragment(markup)) }; } },
    document: { createElement: (tag: string) => new Element(tag), createTextNode: (text: string) => parsed({ nodeName: "#text", value: text, parentNode: null }) },
    allowedTags: new Set(["NOBR", "NONBUTTON", "SPAN"]),
    image: async (node: Element) => {
      const image = new Element("SPAN");
      image.style.width = `${Number(node.getAttribute("width"))}px`;
      return image;
    },
    applyClasses() {}, decorateLabel() {}, choice: () => new Element("BUTTON"),
  });
  await renderHtml("<nobr>prefix<nonbutton pos='100'><img width='90'></nonbutton><nonbutton pos='100'><img width='60'></nonbutton><button pos='100' value='7'><img width='120'></button>tail", terminal);
  const positioned = terminal.querySelectorAll(".html-positioned");
  assert.equal(positioned.length, 3);
  assert.deepEqual(positioned.map((element) => element.dataset.htmlPosition), ["30", "30", "30"]);
  const check = () => {
    layoutHtmlPositions();
    assert.deepEqual(positioned.map((element) => element.getBoundingClientRect().left), [70, 70, 70]);
    assert.equal(terminal.children[0]!.children.at(-1)!.getBoundingClientRect().left, 190);
  };
  check();
  check();
  positioned[0]!.children[0]!.style.width = "180px";
  check();
  await renderHtml("<nobr><nonbutton pos='0'><img width='10'></nonbutton><nonbutton pos='400'><img width='20'></nonbutton><nonbutton pos='-100'><img width='30'></nonbutton>", terminal);
  layoutHtmlPositions();
  assert.deepEqual(terminal.querySelectorAll(".html-positioned").slice(-3).map((element) => element.getBoundingClientRect().left),
    [40, 160, 10]);
  await assert.rejects(renderHtml("<nonbutton pos='bad'>x</nonbutton>", terminal), /Unsupported HTML position/);
});
