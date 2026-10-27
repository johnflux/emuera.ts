import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

test("mouse and keyboard events reach the input queue while a timed frame is rendering", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const terminalHandlers = new Map<string, { capture: boolean; handler: (event: object) => void }[]>();
  const documentHandlers: ((event: object) => void)[] = [];
  const sent: { result: number[] }[] = [];
  const state = { busy: true, expiring: true, settling: false, hit: -1 };
  const terminal = {
    addEventListener(name: string, handler: (event: object) => void, options?: boolean) {
      const handlers = terminalHandlers.get(name) ?? [];
      handlers.push({ capture: options === true, handler });
      terminalHandlers.set(name, handlers);
    },
  };
  const start = source.indexOf("function clickToContinue(");
  const end = source.indexOf("// On the map screens", start);
  const keysStart = source.indexOf('document.addEventListener("keydown", (event) => {\n  if (document.body.classList.contains("is-home"))');
  const keysEnd = source.indexOf('  if ((busy && !expiring) || !input || event.defaultPrevented', keysStart);
  runInNewContext([
    'const input = {kind:"mousekey"}, session = "test", MOUSE_BUTTONS = [0x100000, 0x400000, 0x200000];',
    "function submitMouseKey(result) { sent.push({result}); }",
    source.slice(start, end),
    source.slice(keysStart, keysEnd), "});",
  ].join("\n"), {
    terminal, state, sent,
    get busy() { return state.busy; }, get expiring() { return state.expiring; },
    document: { body: { classList: { contains: () => false } }, addEventListener: (_: string, handler: (event: object) => void) => documentHandlers.push(handler) },
    Element: class {}, settling: () => state.settling, clientPoint: () => [10, -20],
    backgroundHit: () => state.hit, selectBackground() {}, getSelection: () => null,
  });
  const event = { button: 0, target: null, preventDefault() {}, stopImmediatePropagation() {} };
  const dispatch = (name: string, capture = false, extra = {}) => {
    for (const { handler, capture: registered } of terminalHandlers.get(name) ?? [])
      if (registered === capture) handler({ ...event, ...extra });
  };
  const exercise = () => {
    state.hit = -1;
    dispatch("click");
    state.hit = 7;
    dispatch("click", true);
    dispatch("contextmenu");
    dispatch("auxclick", false, { button: 1 });
    dispatch("wheel", false, { deltaY: -120 });
    documentHandlers[0]!({ ...event, key: "Escape", keyCode: 27 });
  };
  exercise();
  assert.deepEqual(sent.map(({ result }) => result[0]), [1, 1, 1, 1, 2, 3]);
  assert.deepEqual(sent.map(({ result }) => result[1]), [0x100000, 0x100000, 0x200000, 0x400000, 120, 27]);
  assert.equal(sent[1]!.result[4], 7);
  state.expiring = false;
  exercise();
  assert.equal(sent.length, 6);
  state.expiring = true;
  state.settling = true;
  exercise();
  assert.equal(sent.length, 6);
});

test("client dimensions, background scaling and mouse coordinates share game-pixel units", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const terminal = {
    clientWidth: 1200, clientHeight: 800, clientLeft: 2, clientTop: 3, offsetLeft: 10, offsetTop: 20,
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  };
  const document = { hidden: false, hasFocus: () => true, querySelectorAll: () => [canvas] };
  const canvas = { dataset: { x: 10, y: -20, width: 600, height: 400 }, style: {} as Record<string, string> };
  const layers = { back: { style: {} }, front: { style: {} } };
  let lineHeight = 38;
  const snippet = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const browser = runInNewContext([
    snippet("function imageScale(", "/** CSS pixels per Emuera pixel across"),
    snippet("function placeBackground(", "/** Shows the CBG layers"),
    snippet("function clientPoint(", "function submitMouseKey("),
    "({ clientState, placeBackground, clientPoint })",
  ].join("\n"), {
    terminal, document, backgroundLayers: layers, metrics: { lineHeight: 19 },
    getComputedStyle: () => ({ lineHeight: String(lineHeight) }),
  });
  assert.equal(JSON.stringify(browser.clientState()), JSON.stringify({ width: 600, height: 400, active: true }));
  browser.placeBackground();
  assert.equal(canvas.style.width, "1200px");
  assert.equal(canvas.style.height, "800px");
  assert.equal(canvas.style.left, "20px");
  assert.equal(canvas.style.bottom, "40px");
  assert.equal(JSON.stringify(browser.clientPoint({ clientX: 212, clientY: 623 })), "[100,-100]");
  lineHeight = 19;
  assert.equal(browser.clientState().width, 1200);
  browser.placeBackground();
  assert.equal(canvas.style.width, "600px");
  document.hidden = true;
  assert.equal(browser.clientState().active, false);
  document.hidden = false;
  document.hasFocus = () => false;
  assert.equal(browser.clientState().active, false);
});

test("graphics replay appends persistent rotations in world coordinates", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("async function paintOps(");
  const end = source.indexOf("/**", start);
  let matrix = [1, 0, 0, 1, 0, 0];
  const saved: number[][] = [];
  const painted: number[][] = [];
  const context = {
    save: () => saved.push(matrix.slice()),
    restore: () => { matrix = saved.pop()!; },
    getTransform: () => Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((key, i) => [key, matrix[i]])),
    setTransform: (...values: number[]) => { matrix = values; },
    transform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      const [ma, mb, mc, md, me, mf] = matrix as [number, number, number, number, number, number];
      matrix = [ma * a + mc * b, mb * a + md * b, ma * c + mc * d, mb * c + md * d, ma * e + mc * f + me, mb * e + md * f + mf];
    },
    translate: (x: number, y: number) => context.transform(1, 0, 0, 1, x, y),
    rotate: (a: number) => context.transform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0),
    fillRect: (x: number, y: number) => painted.push([
      matrix[0]! * x + matrix[2]! * y + matrix[4]!, matrix[1]! * x + matrix[3]! * y + matrix[5]!,
    ].map((value) => Math.round(value))),
  };
  const paint = runInNewContext(`${source.slice(start, end)}\npaintOps`, {
    newCanvas: () => ({ getContext: () => context }),
  });
  await paint({ width: 20, height: 20, ops: [
    { op: "rotate", angle: 90, x: 5, y: 5 },
    { op: "fill", color: "red", rect: [1, 2, 1, 1] },
    { op: "fill", color: "black", rect: [1, 2, 1, 1], absolute: true },
    { op: "rotate", angle: 90, x: 0, y: 0 },
    { op: "fill", color: "blue", rect: [1, 2, 1, 1] },
    { op: "rotate", angle: -90, x: 0, y: 0 },
    { op: "fill", color: "green", rect: [1, 2, 1, 1] },
  ] });
  assert.deepEqual(painted, [[8, 1], [1, 2], [-1, 8], [8, 1]]);
});

test("browser audio applies live volumes, repeat counts, stop/reset and autoplay retries", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("let backgroundAudio =");
  const end = source.indexOf("/** advanceScreen:", start);
  const instances: AudioMock[] = [];
  const messages: string[] = [];
  class AudioMock {
    volume = 1;
    loop = false;
    currentTime = 0;
    plays = 0;
    stops = 0;
    blocked = false;
    listeners = new Map<string, () => void>();
    constructor(public url: string) { instances.push(this); }
    play() {
      this.plays++;
      return this.blocked ? Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" })) : Promise.resolve();
    }
    pause() { this.stops++; }
    load() {}
    removeAttribute() {}
    addEventListener(name: string, handler: () => void) { this.listeners.set(name, handler); }
  }
  const browser = runInNewContext(`${source.slice(start, end)}\n({ useAudioSettings, resetAudio, retryAudio, playAudio })`, {
    Audio: AudioMock, document: { addEventListener() {} }, message: (value: string) => messages.push(value),
  });
  const settings = { soundVolume: 20, bgmVolume: 40, bgm: { id: "bg", url: "/sound/bg.ogg" }, sounds: [{ id: "s", url: "/sound/se.wav", repeat: 2 }], stopSounds: false };
  browser.useAudioSettings(settings);
  const [bgm, sound] = instances as [AudioMock, AudioMock];
  assert.equal(bgm.loop, true);
  assert.equal(bgm.volume, 0.4);
  assert.equal(sound.volume, 0.2);
  browser.useAudioSettings({ ...settings, bgmVolume: 10, soundVolume: 30, sounds: [] });
  assert.equal(instances.length, 2);
  assert.equal(bgm.volume, 0.1);
  assert.equal(sound.volume, 0.3);
  sound.listeners.get("ended")!();
  assert.equal(sound.plays, 2);
  sound.listeners.get("ended")!();
  assert.equal(sound.stops, 1);
  bgm.blocked = true;
  browser.playAudio(bgm);
  await Promise.resolve();
  assert.match(messages[0]!, /blocked.*Click/);
  bgm.blocked = false;
  browser.retryAudio();
  await Promise.resolve();
  assert.equal(bgm.plays, 3);
  browser.useAudioSettings({ ...settings, bgm: null, sounds: [], stopSounds: true });
  assert.equal(bgm.stops, 1);
  browser.useAudioSettings(settings);
  browser.resetAudio();
  assert.ok(instances.slice(2).every((audio) => audio.stops === 1));
});

test("tooltip alignment follows TOOLTIP_FORMAT and resets with custom styling", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("function useTooltipSettings(");
  const end = source.indexOf("/**", start);
  const tooltip = { style: {} as Record<string, string> };
  const useSettings = runInNewContext(`let tooltipSettings;\n${source.slice(start, end)}\nuseTooltipSettings`, { tooltip });
  for (const [format, expected] of [[0, "left"], [1, "center"], [2, "right"]] as const) {
    useSettings({ custom: true, font: "monospace", fontSize: 10, color: "#fff", background: "#000", format });
    assert.equal(tooltip.style.textAlign, expected);
    assert.equal(tooltip.style.fontSize, "10px");
  }
  useSettings({ custom: false, format: 2 });
  assert.equal(tooltip.style.textAlign, "");
  useSettings(null);
  assert.equal(tooltip.style.fontSize, "");
});

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
    MutationObserver: class { observe() {} },
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

test("translated menu labels re-align locked borders after text and wrapper mutations", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("function layoutHtmlPositions(");
  const end = source.indexOf("/**", start);
  const terminal = new Element("DIV");
  const line = new Element("DIV");
  terminal.append(line);
  const label = new Element("SPAN");
  label.style.width = "80px";
  line.append(label);
  const border = new Element("SPAN");
  border.classes.add("html-positioned");
  border.dataset.htmlPosition = "200";
  border.style.width = "10px";
  line.append(border);
  let changed: (() => void) | undefined;
  let observed: unknown;
  const frames: (() => void)[] = [];
  const layout = runInNewContext(`${source.slice(start, end)}\nlayoutHtmlPositions`, {
    terminal,
    requestAnimationFrame: (callback: () => void) => { frames.push(callback); return frames.length; },
    MutationObserver: class {
      constructor(callback: () => void) { changed = callback; }
      observe(target: unknown, options: unknown) { assert.equal(target, terminal); observed = options; }
    },
  });
  assert.equal(JSON.stringify(observed), JSON.stringify({ childList: true, characterData: true, subtree: true }));
  layout();
  assert.equal(border.getBoundingClientRect().left, 240);
  // Translators expand text and may insert wrappers after the initial render.
  label.style.width = "150px";
  assert.equal(border.getBoundingClientRect().left, 310);
  changed!();
  changed!();
  assert.equal(frames.length, 1);
  frames.shift()!();
  assert.equal(border.getBoundingClientRect().left, 240);
  label.style.width = "35px";
  changed!();
  frames.shift()!();
  assert.equal(border.getBoundingClientRect().left, 240);
  layout();
  assert.equal(border.getBoundingClientRect().left, 240);
});
