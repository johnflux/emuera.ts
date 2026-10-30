import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

test("character history renders literal text and local controls without game input handlers", async () => {
  const source = await readFile(new URL("../web/interaction-history.js", import.meta.url), "utf8");
  class Element {
    children: Element[] = [];
    textContent = "";
    className = "";
    hidden = false;
    parentElement: Element | null = null;
    isConnected = true;
    focused = false;
    scrollTop = 0;
    scrollHeight = 500;
    style: { color?: string } = {};
    attributes = new Map<string, string>();
    open = false;
    listeners = new Map<string, (event: { stopPropagation(): void; preventDefault(): void }) => unknown>();
    constructor(public tag: string) {}
    append(element: Element) { this.children.push(element); element.parentElement = this; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    replaceChildren() { this.children = []; }
    addEventListener(type: string, handler: (event: { stopPropagation(): void; preventDefault(): void }) => unknown) {
      const previous = this.listeners.get(type);
      this.listeners.set(type, (event) => { previous?.(event); return handler(event); });
    }
    closest(selector: string): Element | null {
      return this.className.split(" ").includes(selector.slice(1)) ? this : this.parentElement?.closest(selector) ?? null;
    }
    querySelector(selector: string): Element | null {
      for (const child of this.children) {
        if (child.className.split(" ").includes(selector.slice(1))) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    }
    replaceWith(element: Element) {
      const siblings = this.parentElement!.children;
      siblings.splice(siblings.indexOf(this), 1, element);
      element.parentElement = this.parentElement;
    }
    after(element: Element) {
      const siblings = this.parentElement!.children;
      siblings.splice(siblings.indexOf(this) + 1, 0, element);
      element.parentElement = this.parentElement;
    }
    remove() {
      const siblings = this.parentElement!.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.isConnected = false;
    }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.get("close")?.({ stopPropagation() {}, preventDefault() {} }); }
    focus() { this.focused = true; }
    set innerHTML(_value: string) { throw new Error("History must be rendered as text, not HTML"); }
  }
  const { render, setup } = runInNewContext(`${source.replaceAll("export function ", "function ")}\n({render: renderCharacterHistory, setup: setupCharacterHistory})`, {
    document: { createElement: (tag: string) => new Element(tag) },
    requestAnimationFrame: (callback: () => void) => callback(),
  });
  const context = { day: "5", time: ["600"], location: "9", locationName: "Living room", affection: "1", trust: "2" };
  const history = {
    character: { id: "alice", name: "Alice", number: "1" }, limit: 20, notice: "Earlier interactions are unavailable.",
    entries: [{
      action: { label: "Talk" }, target: "alice", before: context, after: { ...context, affection: "3" },
      participants: [{ id: "alice", name: "Alice" }],
      lines: [{ character: "alice", text: '<img src=x onerror="bad()">Hello.' }, { character: null, text: "Narration." }],
      choices: ["A choice"], truncated: true,
    }],
  };
  const parent = new Element("div");
  render(parent, history);
  const nodes = (root: Element): Element[] => [root, ...root.children.flatMap(nodes)];
  const all = nodes(parent);
  assert.equal(parent.scrollTop, parent.scrollHeight, "new history scrolls to the bottom");
  assert.ok(all.every((element) => !["button", "img", "script"].includes(element.tag)));
  const text = all.map((element) => element.textContent).join("\n");
  assert.match(text, /Alice's interaction history \(1\)/);
  assert.match(text, /Talk · Day 5, 10:00/);
  assert.ok(text.includes(history.entries[0]!.lines[0]!.text));
  const metadata = all.find((node) => node.tag === "p" && node.className === "era-history-note")!;
  assert.equal(metadata.children.map((node) => node.textContent).join(""), "Living room · Alice");
  assert.equal(metadata.children[1]!.attributes.get("translate"), "no");
  assert.equal(metadata.children[1]!.className, "notranslate");
  assert.doesNotMatch(text, /Alice's scene|may include narration|Script \/ narration/);
  assert.match(text, /Favor\+2/);
  assert.doesNotMatch(text, /affection:|→ 3/);
  assert.equal((text.match(/Day 5, 10:00/g) ?? []).length, 1, "timestamp appears only in the entry heading");
  assert.match(text, /truncated/);
  assert.doesNotMatch(text, /Earlier interactions are unavailable|Scripted interactions|no AI requests/);
  for (const type of ["click", "pointerdown", "keydown", "contextmenu"]) {
    let stopped = false;
    parent.listeners.get(type)!({ stopPropagation() { stopped = true; }, preventDefault() {} });
    assert.equal(stopped, true, `${type} cannot reach the game's input handlers`);
  }
  const panel = parent.children[0]!;
  panel.open = false;
  panel.listeners.get("toggle")!({ stopPropagation() {}, preventDefault() {} });
  const empty = new Element("div");
  render(empty, { ...history, entries: [] });
  assert.equal(empty.children[0]!.open, false, "collapse preference survives main-screen redraws");
  const emptyBody = empty.children[0]!.children[1]!;
  assert.equal(emptyBody.children.length, 1);
  assert.equal(emptyBody.children[0]!.tag, "em");
  assert.equal(emptyBody.children[0]!.textContent, "No interaction yet");
  const colored = new Element("div");
  render(colored, { ...history, entries: [{ ...history.entries[0], lines: [{
    character: "alice", text: "Red green unsafe",
    runs: [
      { text: "<red>", color: "#ff0000" },
      { text: " green ", color: "green" },
      { text: "unsafe", color: "url(https://example.com)" },
    ],
  }] }] });
  const spans = nodes(colored).filter((node) => node.className === "era-history-text").flatMap((node) => node.children);
  assert.equal(spans[0]!.textContent, "<red>");
  assert.equal(spans[0]!.style.color, "#ff0000");
  assert.equal(spans[1]!.style.color, "green");
  assert.equal(spans[2]!.style.color, undefined);
  const padded = new Element("div");
  render(padded, { ...history, entries: [{ ...history.entries[0], lines: [{
    character: "alice", text: "\n\n  \nKana is here.\nYou realize you haven't greeted her today.\n \n",
    runs: [
      { text: "\n\n", color: "white" },
      { text: "  \nKana is here.\n", color: "#c0c0c0" },
      { text: "You realize you haven't greeted her today.\n ", color: "green" },
      { text: "\n", color: "white" },
    ],
  }] }] });
  const trimmedSpans = nodes(padded).filter((node) => node.className === "era-history-text").flatMap((node) => node.children);
  assert.equal(trimmedSpans.length, 2);
  assert.equal(trimmedSpans[0]!.textContent, "Kana is here.\n");
  assert.equal(trimmedSpans[0]!.style.color, "#c0c0c0");
  assert.equal(trimmedSpans[1]!.textContent, "You realize you haven't greeted her today.");
  assert.equal(trimmedSpans[1]!.style.color, "green");
  const whitespace = new Element("div");
  render(whitespace, { ...history, entries: [{ ...history.entries[0], lines: [{
    character: "alice", text: " \n ", runs: [{ text: " \n ", color: "white" }],
  }] }] });
  assert.equal(nodes(whitespace).filter((node) => node.className === "era-history-text").flatMap((node) => node.children).length, 0);
  const ordered = new Element("div");
  render(ordered, { ...history, entries: [
    { ...history.entries[0], action: { label: "Newest" }, after: { ...context, affection: "4", trust: "1" } },
    { ...history.entries[0], action: { label: "Oldest" }, after: context },
  ] });
  const entries = nodes(ordered).filter((node) => node.className === "era-history-entry");
  assert.match(entries[0]!.children[0]!.textContent, /^Oldest/);
  assert.equal(entries[0]!.open, false);
  assert.match(entries[1]!.children[0]!.textContent, /^Newest/);
  assert.equal(entries[1]!.open, true);
  assert.ok(nodes(entries[1]!).some((node) => node.textContent === "Favor+3 · Trust-1"));
  assert.ok(!nodes(entries[0]!).some((node) => /Favor|Trust/.test(node.textContent)), "omit unchanged stats");
  assert.equal(history.entries[0]!.action.label, "Talk", "rendering does not reorder the source history");
  for (const colored of [false, true]) {
    const compact = new Element("div");
    const content = "\n--------------------\nYou and the Robot Maid talk...\n\n \n「Nice weather.」\n---\n\n";
    render(compact, { ...history, entries: [{ ...history.entries[0], lines: [{
      character: "alice", text: content,
      ...(colored ? { runs: [
        { text: content.slice(0, 10), color: "red" },
        { text: content.slice(10), color: "green" },
      ] } : {}),
    }] }] });
    const paragraphs = nodes(compact).filter((node) => node.className === "era-history-text");
    const dialogue = paragraphs[0]!.children.map((node) => node.textContent).join("");
    assert.equal(dialogue, "You and the Robot Maid talk...\n「Nice weather.」");
    if (colored) assert.ok(paragraphs[0]!.children.every((node) => node.style.color === "green"));
    const note = nodes(compact).find((node) => node.tag === "p" && node.className === "era-history-note");
    assert.equal(note!.children.map((node) => node.textContent).join(""), "Living room · Alice");
    assert.ok(!nodes(compact).some((node) => node.textContent === "Alice's scene"));
  }
  for (const colored of [false, true]) {
    const intro = new Element("div");
    const content = "Alice was in the Living room.\nYou serve some tea to Alice...\n「You serve some tea to Alice...」\nAlice enjoys the tea.\n";
    render(intro, { ...history, entries: [{ ...history.entries[0], action: { id: 301, label: "Serve tea" }, lines: [{
      character: "alice", text: content,
      ...(colored ? { runs: [{ text: content, color: "green" }] } : {}),
    }] }] });
    const dialogue = nodes(intro).filter((node) => node.className === "era-history-text")[0]!;
    assert.equal(dialogue.children.map((node) => node.textContent).join(""), "「You serve some tea to Alice...」\nAlice enjoys the tea.");
    if (colored) assert.equal(dialogue.children[0]!.style.color, "green");
  }
  const card = new Element("div");
  card.className = "era-character-info";
  const tabs = new Element("div");
  tabs.className = "era-info-tabs";
  const title = new Element("div");
  title.className = "era-info-title";
  tabs.append(title);
  const info = new Element("div");
  info.className = "era-info-body";
  const historyPanel = new Element("div");
  card.append(tabs);
  card.append(info);
  card.append(historyPanel);
  let requests = 0;
  const olderPreview = `${"Older padding.\n".repeat(10)}Oldest line.\nOlder interaction.`;
  setup(historyPanel, { ...history, entries: [{ ...history.entries[0], lines: [{
    character: "alice", text: "Earlier line.\nRecent line.\nLatest line.",
    runs: [{ text: "Earlier line.\n", color: "red" }, { text: "Recent line.\nLatest line.", color: "green" }],
  }] }, { ...history.entries[0], lines: [{ character: "alice", text: "\n---\n" }] },
  { ...history.entries[0], lines: [{
    character: "alice", text: olderPreview, runs: [{ text: olderPreview, color: "blue" }],
  }] }] }, async () => { requests++; return history; });
  assert.equal(historyPanel.hidden, true);
  assert.equal(info.hidden, false);
  const localEvent = { stopPropagation() {}, preventDefault() {} };
  const preview = info.querySelector(".era-history-preview")!;
  const previewText = preview.querySelector(".era-history-preview-content")!;
  assert.equal(previewText.children.map((node) => node.textContent).join(""), `${"Older padding.\n".repeat(5)}Oldest line.\nOlder interaction.\nEarlier line.\nRecent line.\nLatest line.`);
  assert.equal(previewText.children[0]!.style.color, "blue");
  assert.equal(previewText.children[2]!.style.color, "red");
  assert.equal(previewText.children[3]!.style.color, "green");
  assert.ok(info.className.includes("era-info-with-preview"));
  preview.listeners.get("click")!(localEvent);
  assert.equal(historyPanel.hidden, false);
  assert.equal(historyPanel.scrollTop, historyPanel.scrollHeight, "opening the history tab shows the newest text");
  assert.equal(tabs.children[1]!.focused, true);
  tabs.children[1]!.listeners.get("click")!(localEvent);
  assert.equal(historyPanel.hidden, false);
  assert.equal(info.hidden, true);
  assert.equal(tabs.children[1]!.attributes.get("aria-pressed"), "true");
  const expand = nodes(historyPanel).find((node) => node.tag === "button")!;
  assert.equal(expand.textContent, "more...");
  assert.ok(!nodes(historyPanel).some((node) => /Latest \d+ interactions/.test(node.textContent)));
  await expand.listeners.get("click")!(localEvent);
  assert.equal(requests, 1, "all history is loaded only when expanded");
  const dialog = nodes(historyPanel).find((node) => node.tag === "dialog")!;
  assert.equal(dialog.open, true);
  assert.ok(nodes(dialog).filter((node) => node.className === "era-history-entry").every((node) => node.open));
  dialog.listeners.get("cancel")!(localEvent);
  assert.equal(dialog.isConnected, false);
  assert.equal(expand.focused, true);
  tabs.children[0]!.listeners.get("click")!(localEvent);
  assert.equal(info.hidden, false);
  assert.equal(historyPanel.hidden, true);
  const failure = new Element("div");
  render(failure, history, { loadAll: async () => { throw new Error("Session expired"); } });
  await nodes(failure).find((node) => node.tag === "button")!.listeners.get("click")!(localEvent);
  assert.ok(nodes(failure).some((node) => node.textContent === "Could not load interaction history: Session expired"));
});

test("crash reports render as text and copy with explicit clipboard error feedback", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("  if (snapshot.error) {");
  const end = source.indexOf('  } else message(snapshot.status', start);
  assert.ok(start >= 0 && end > start);
  for (const context of [undefined, {
    game: "fixture", gameVersion: "7", debug: true, jit: false,
    action: "input (string)", instruction: 'THROW <img src=x onerror="bad()">',
    instructions: 10, instructionLimit: 1000, outputCharacters: 123, outputLimit: 2_000_000,
    outputEvents: 2, deferredEvents: 1, lastLoadedSlot: "-1",
    routines: ["@INNER (test.ERB:5)"],
    server: { game: "registered", session: "session-id", step: 4, action: "input" },
  }]) {
    const lines: { textContent: string; classList: { add(value: string): void }; append(value: unknown): void }[] = [];
    const messages: string[] = [];
    let copied = "";
    let fail = false;
    let handler: (event: { stopPropagation(): void }) => Promise<void>;
    const button = {
      type: "", textContent: "",
      addEventListener(_type: string, callback: typeof handler) { handler = callback; },
    };
    const scope = {
      snapshot: { error: { file: "test.ERB", line: 8, message: "fixture crash", trace: ["caller.ERB:2"], context } },
      currentLine: null as typeof lines[number] | null,
      message: (value: string) => messages.push(value),
      document: { createElement: () => button },
      navigator: { clipboard: { async writeText(value: string) { if (fail) throw new Error("Permission denied"); copied = value; } } },
      line() {
        if (!scope.currentLine) {
          scope.currentLine = { textContent: "", classList: { add() {} }, append() {} };
          lines.push(scope.currentLine);
        }
        return scope.currentLine;
      },
    };
    runInNewContext(`${source.slice(start, end)}\n}`, scope);
    assert.equal(button.type, "button");
    assert.match(lines[0]!.textContent, /ERROR test.ERB:8 - fixture crash\n  called from caller.ERB:2/);
    if (context) {
      assert.ok(lines[0]!.textContent.includes(context.instruction));
      assert.match(lines[0]!.textContent, /Session: session-id \| Step: 4/);
      assert.match(lines[0]!.textContent, /Output: 123 \/ 2000000 serialized characters/);
      assert.match(lines[0]!.textContent, /active @INNER/);
    }
    let stopped = 0;
    await handler!({ stopPropagation() { stopped++; } });
    assert.equal(copied, lines[0]!.textContent);
    assert.equal(messages.at(-1), "Debug report copied.");
    fail = true;
    await handler!({ stopPropagation() { stopped++; } });
    assert.equal(messages.at(-1), "Could not copy debug report: Permission denied");
    assert.equal(stopped, 2);
  }
});

test("unmarked map rows protect scenery and separate labels from both translation methods", async () => {
  const source = await readFile(new URL("../web/translate.js", import.meta.url), "utf8");
  const start = source.indexOf("export function protectMapTranslation(");
  const end = source.indexOf("export function createTranslation(", start);
  const protect = runInNewContext(`${source.slice(start, end).replace("export ", "")}\nprotectMapTranslation`);
  const row = (textContent: string, marked = false) => ({
    textContent, attributes: new Map<string, string>(), classes: new Set<string>(),
    matches: () => marked,
    setAttribute(name: string, value: string) { this.attributes.set(name, value); },
    get classList() { return { add: (value: string) => this.classes.add(value) }; },
  });
  const maps = [
    row("■林　　　■14│　　│ 08 　　 07 　■"),
    row("森林林木林林林林林林林林林林林林"),
    row("　森森　　　　　　　森森"),
    row("　　　┃┃┃22→"),
    row("霊夢の部屋", true),
  ];
  const prose = [row("■博麗神社"), row("施設：【風呂】【台所】"), row("森へ移動しますか？"), row("│ 霊夢と話す │")];
  const root = { querySelectorAll: () => [...maps, ...prose] };
  protect(root);
  protect(root);
  for (const element of maps) {
    assert.equal(element.attributes.get("translate"), "no");
    assert.ok(element.classes.has("notranslate"));
  }
  for (const element of prose) assert.equal(element.attributes.has("translate"), false);
});

test("timed mouse frames are capped at 60 FPS without changing longer waits or other input timers", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("const FRAME_INTERVAL =");
  const end = source.indexOf("async function expire(", start);
  const delays: number[] = [];
  const cleared: number[] = [];
  const input = { kind: "mousekey", timeout: 5 };
  const schedule = runInNewContext(`let timedWait;\n${source.slice(start, end)}\nscheduleTimedWait`, {
    input, performance: { now: () => 0 },
    setTimeout: (_: () => void, delay: number) => { delays.push(delay); return delays.length; },
    clearTimeout: (handle: number) => cleared.push(handle), clearInterval() {},
  });
  schedule();
  assert.equal(delays[0], 1000 / 60);
  input.timeout = 100;
  schedule();
  assert.equal(delays[1], 100);
  input.kind = "wait";
  input.timeout = 5;
  schedule();
  assert.equal(delays[2], 5);
  input.kind = "integer";
  schedule();
  assert.equal(delays[3], 5);
  assert.deepEqual(cleared, [1, 2, 3]);
});

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
  const handlers = new Map<string, (event: object) => void>();
  const document = {
    hidden: false, hasFocus: () => true, querySelectorAll: () => [canvas],
    addEventListener: (name: string, handler: (event: object) => void) => handlers.set(name, handler),
  };
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
  assert.equal(JSON.stringify(browser.clientState()), JSON.stringify({ width: 600, height: 400, active: true, mouseX: 0, mouseY: 0 }));
  browser.placeBackground();
  assert.equal(canvas.style.width, "1200px");
  assert.equal(canvas.style.height, "800px");
  assert.equal(canvas.style.left, "20px");
  assert.equal(canvas.style.bottom, "40px");
  assert.equal(JSON.stringify(browser.clientPoint({ clientX: 212, clientY: 623 })), "[100,-100]");
  handlers.get("pointermove")!({ clientX: 212, clientY: 623 });
  assert.equal(browser.clientState().mouseX, 100);
  assert.equal(browser.clientState().mouseY, -100);
  lineHeight = 19;
  assert.equal(browser.clientState().width, 1200);
  assert.equal(browser.clientState().mouseX, 200);
  assert.equal(browser.clientState().mouseY, -200);
  handlers.get("pointerdown")!({ clientX: -8, clientY: 833 });
  assert.equal(browser.clientState().mouseX, -20);
  assert.equal(browser.clientState().mouseY, 10);
  handlers.get("wheel")!({ clientX: 12, clientY: 823 });
  assert.equal(browser.clientState().mouseX, 0);
  assert.equal(browser.clientState().mouseY, 0);
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
