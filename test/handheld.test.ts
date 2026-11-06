import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { once } from "node:events";
import { createApp } from "../src/server.js";

const source = readFileSync(new URL("../web/handheld.js", import.meta.url), "utf8").replace(/^export /gm, "");

test("server serves handheld module and stylesheet with their correct content types", async () => {
  const app = createApp([]);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  try {
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    for (const [asset, contentType] of [["handheld.js", "javascript"], ["handheld.css", "text/css"]]) {
      const response = await fetch(`http://127.0.0.1:${address.port}/${asset}`);
      assert.equal(response.status, 200);
      assert.ok(response.headers.get("content-type")?.includes(contentType!));
      assert.equal(await response.text(), readFileSync(new URL(`../web/${asset}`, import.meta.url), "utf8"));
    }
  } finally {
    await new Promise<void>((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});

test("handheld layout defaults on for Deck and preserves explicit preferences elsewhere", () => {
  for (const { deck, saved, expected } of [
    { deck: false, saved: null, expected: false },
    { deck: true, saved: null, expected: true },
    { deck: true, saved: "0", expected: false },
    { deck: false, saved: "1", expected: true },
  ]) {
    let click = () => {};
    let stored = saved;
    let applied = false;
    let pressed = "";
    let changes = 0;
    const setup = runInNewContext(`${source}\nsetupHandheld`, {
      eraDesktop: { handheld: deck },
      localStorage: {
        getItem: () => stored,
        setItem(key: string, value: string) {
          assert.equal(key, "era-typescript.handheld");
          stored = value;
        },
      },
      document: {
        body: { classList: { toggle: (_name: string, value: boolean) => { applied = value; } } },
        querySelector: () => ({
          setAttribute: (_name: string, value: string) => { pressed = value; },
          addEventListener: (_name: string, handler: () => void) => { click = handler; },
        }),
      },
    });
    const layout = setup(() => { changes++; });
    assert.equal(layout.enabled(), expected);
    assert.equal(applied, expected);
    assert.equal(pressed, String(expected));
    click();
    assert.equal(layout.enabled(), !expected);
    assert.equal(applied, !expected);
    assert.equal(stored, expected ? "0" : "1");
    assert.equal(changes, 1);
  }
});

test("directional navigation follows rows and columns and stops at the edge", () => {
  const next = runInNewContext(`${source}\ndirectionalTarget`);
  const grid = [{ left: 0, top: 0 }, { left: 80, top: 0 }, { left: 0, top: 60 }, { left: 80, top: 60 }]
    .map((rect) => ({ ...rect, width: 40, height: 40 }));
  assert.equal(next(grid, 0, "ArrowRight"), 1);
  assert.equal(next(grid, 0, "ArrowDown"), 2);
  assert.equal(next(grid, 3, "ArrowUp"), 1);
  assert.equal(next(grid, 3, "ArrowLeft"), 2);
  assert.equal(next(grid, 0, "ArrowLeft"), -1);
  assert.equal(next(grid, -1, "ArrowDown"), 0);
  assert.equal(next(grid, -1, "ArrowUp"), 3);
});

test("unequal-width demo choices follow their visual row instead of diagonal centers", () => {
  const next = runInNewContext(`${source}\ndirectionalTarget`);
  const rects = [
    { left: 12, top: 279, width: 240 }, { left: 252, top: 279, width: 160 },
    { left: 412, top: 279, width: 390 }, { left: 802, top: 279, width: 220 },
    { left: 12, top: 315, width: 250 }, { left: 262, top: 315, width: 340 },
    { left: 602, top: 315, width: 270 }, { left: 872, top: 315, width: 270 },
    { left: 12, top: 351, width: 80 },
  ].map((rect) => ({ ...rect, height: 36 }));
  for (const row of [[0, 1, 2, 3], [4, 5, 6, 7]]) {
    for (let index = 0; index < row.length; index++) {
      assert.equal(next(rects, row[index], "ArrowLeft"), row[index - 1] ?? -1);
      assert.equal(next(rects, row[index], "ArrowRight"), row[index + 1] ?? -1);
    }
  }
  assert.equal(next(rects, 0, "ArrowDown"), 4);
  assert.equal(next(rects, 1, "ArrowDown"), 5);
  assert.equal(next(rects, 2, "ArrowDown"), 5);
  assert.equal(next(rects, 3, "ArrowDown"), 6);
  assert.equal(next(rects, 4, "ArrowUp"), 0);
  assert.equal(next(rects, 6, "ArrowDown"), 8);
  assert.equal(next(rects, 8, "ArrowRight"), 5);
});

test("vertical navigation stays in its column before considering another panel", () => {
  const next = runInNewContext(`${source}\ndirectionalTarget`);
  const rects = [
    { left: 0, top: 0, width: 60, height: 36 },
    { left: 200, top: 40, width: 100, height: 36 },
    { left: 0, top: 100, width: 60, height: 36 },
  ];
  assert.equal(next(rects, 0, "ArrowDown"), 2);
  assert.equal(next(rects, 2, "ArrowUp"), 0);
  assert.equal(next(rects, 1, "ArrowDown"), 2);
});

test("Achievements moves down to Music Collection instead of Automatic Item Use", () => {
  const next = runInNewContext(`${source}\ndirectionalTarget`);
  const rects = [
    { left: 52, top: 228, width: 310, height: 42 },
    { left: 1196, top: 279, width: 406, height: 43 },
    { left: 52, top: 319, width: 373, height: 42 },
    { left: 438, top: 319, width: 356, height: 42 },
    { left: 52, top: 371, width: 373, height: 42 },
  ];
  assert.equal(next(rects, 0, "ArrowDown"), 2);
  assert.equal(next(rects, 2, "ArrowUp"), 0);
  assert.equal(next(rects, 2, "ArrowDown"), 4);
  assert.equal(next(rects, 2, "ArrowRight"), 3);
});

test("left-biased vertical navigation selects Save below Locations Table", () => {
  const next = runInNewContext(`${source}\ndirectionalTarget`);
  const rects = [
    { left: 1440, top: 359, width: 280, height: 34 },
    { left: 1440, top: 431, width: 140, height: 34 },
    { left: 1592, top: 431, width: 142, height: 34 },
    { left: 1744, top: 431, width: 168, height: 34 },
    { left: 12, top: 710, width: 1850, height: 36 },
  ];
  assert.equal(next(rects, 0, "ArrowDown"), 1);
  assert.equal(next(rects, 3, "ArrowDown"), 4);
});

test("Items can move right into the sidebar and Rest moves down within Activities", () => {
  const next = runInNewContext(`${source}\ndirectionalTarget`);
  const rects = [
    { left: 16, top: 450, width: 95, height: 30 },
    { left: 682, top: 450, width: 103, height: 30 },
    { left: 16, top: 487, width: 184, height: 30 },
    { left: 210, top: 487, width: 213, height: 30 },
    { left: 971, top: 482, width: 267, height: 34 },
    { left: 971, top: 524, width: 130, height: 34 },
  ];
  assert.equal(next(rects, 0, "ArrowDown"), 2);
  assert.equal(next(rects, 1, "ArrowRight"), 4);
  assert.equal(next(rects, 4, "ArrowLeft"), 3);
});

test("number decoration preserves numeric-only controls and wraps only the button's command value", () => {
  for (const [text, value, expected] of [
    ["Locations Table [412]", "412", "[412]"],
    ["[150]", "150", null],
    ["Music [2] Collection [106]", "106", "[106]"],
    ["Room [12]", "13", null],
    ["Text choice", "hello", null],
  ]) {
    const node = { textContent: text };
    let wrapped: string | null = null;
    let start = 0, end = 0;
    const decorate = runInNewContext(`${source}\ndecorateCommandNumbers`, {
      NodeFilter: { SHOW_TEXT: 4 },
      document: {
        createTreeWalker: () => ({
          currentNode: node,
          nextNode: (() => { let visited = false; return () => { if (visited) return false; visited = true; return true; }; })(),
        }),
        createElement: () => ({
          className: "",
          append: (text: string) => { wrapped = text; },
        }),
        createRange: () => ({
          setStart: (_node: unknown, offset: number) => { start = offset; },
          setEnd: (_node: unknown, offset: number) => { end = offset; },
          extractContents: () => text!.slice(start, end),
          insertNode: () => {},
        }),
      },
    });
    const element = {
      matches: () => true,
      closest: () => null,
      querySelector: () => null,
      textContent: text,
      dataset: { value },
    };
    decorate(element);
    assert.equal(wrapped, expected);
    assert.equal(element.textContent, text);
    assert.equal(element.dataset.value, value);
  }
});

test("navigation measures the labeled tile rather than its right-aligned numeric button", () => {
  const measure = runInNewContext(`${source}\nnavigationRect`);
  const tile = { left: 32, top: 222, width: 190, height: 60 };
  const result = measure({
    closest: () => ({ getBoundingClientRect: () => tile }),
    getBoundingClientRect: () => ({ left: 132, top: 238, width: 72, height: 32 }),
  });
  assert.equal(JSON.stringify(result), JSON.stringify(tile));
  const next = runInNewContext(`${source}\ndirectionalTarget`);
  assert.equal(next([
    result,
    { left: 32, top: 297, width: 366, height: 60 },
    { left: 12, top: 740, width: 1800, height: 36 },
  ], 0, "ArrowDown"), 1);
});

test("compact command numbers are hidden at the exact width threshold or with touch input", () => {
  const css = readFileSync(new URL("../web/handheld.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 1280px\), \(any-pointer: coarse\) \{\s*\.command-number \{ display: none; \}/);
});

function navigationHarness() {
  type Control = {
    tabIndex: number; hidden: boolean; editable: boolean; visible: boolean; scrolled: boolean;
    closest(selector: string): unknown;
    focus(): void;
    scrollIntoView(): void;
    getClientRects(): number[];
    getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  };
  const handlers = new Map<string, (event: ReturnType<typeof event>) => void>();
  const state = { activeElement: null as Control | null, allowed: true, home: false, modal: false, closed: false, touch: false,
    nestedClosed: false };
  function control(left: number, top: number, editable = false): Control {
    return {
      tabIndex: 0, hidden: false, editable, visible: true, scrolled: false,
      closest(selector) {
        if (selector.includes("input")) return this.editable ? this : null;
        if (selector.includes("[hidden]")) return this.hidden ? this : null;
        return null;
      },
      focus() { state.activeElement = this; },
      scrollIntoView() { this.scrolled = true; },
      getClientRects() { return this.visible ? [1] : []; },
      getBoundingClientRect() { return { left, top, width: 40, height: 40 }; },
    };
  }
  const items = [control(0, 0), control(60, 0), control(0, 60), control(60, 60)];
  const root = { querySelectorAll: () => items, closest: () => state.home ? null : root };
  const command = control(0, 180, true);
  const terminal = {
    querySelector: (selector: string) => selector === ".screen.is-active" ? root : null,
    focus: () => { state.activeElement = null; },
  };
  const menu = { hidden: true };
  const document = {
    get activeElement() { return state.activeElement; },
    body: { classList: { contains: () => state.home } },
    querySelector(selector: string) {
      if (selector === "dialog[open]") return state.modal ? {
        ...root, close: () => { state.closed = true; state.modal = false; },
      } : null;
      if (selector === "#menu-panel") return menu;
      if (selector === "#library") return root;
      return null;
    },
    addEventListener(name: string, handler: (event: ReturnType<typeof event>) => void) { handlers.set(name, handler); },
  };
  const setup = runInNewContext(`${source}\nsetupKeyboardNavigation`, {
    matchMedia: () => ({ matches: state.touch }),
    document, getComputedStyle: () => ({ visibility: "visible", display: "block" }),
  });
  const navigation = setup({ terminal, command, canNavigate: () => state.allowed });
  function event(key: string, target = state.activeElement ?? items[0]!) {
    return {
      key, target, defaultPrevented: false, isComposing: false, ctrlKey: false,
      metaKey: false, altKey: false, shiftKey: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
  }
  function key(name: string, target?: Control) {
    const input = event(name, target);
    handlers.get("keydown")!(input);
    return input;
  }
  return { state, items, command, navigation, key, handlers, event };
}

test("arrows focus visible choices, preserve keyboard mode after a command, and reach the input below them", () => {
  const { state, items, command, navigation, key } = navigationHarness();
  assert.equal(key("ArrowRight").defaultPrevented, true);
  assert.equal(state.activeElement, items[0]);
  key("ArrowRight");
  assert.equal(state.activeElement, items[1]);
  assert.equal(items[1]!.scrolled, true);
  items[0]!.hidden = true;
  items[2]!.visible = false;
  navigation.focusInput();
  assert.equal(state.activeElement, items[1]);
  key("ArrowDown");
  assert.equal(state.activeElement, items[3]);
  key("ArrowDown");
  assert.equal(state.activeElement, command);
});

test("touch command input uses Up for focus navigation rather than history, while Left stays native", () => {
  const { state, command, items, key } = navigationHarness();
  state.touch = true;
  command.focus();
  assert.equal(key("ArrowUp", command).defaultPrevented, true);
  assert.equal(state.activeElement, items[2]);
  command.focus();
  assert.equal(key("ArrowLeft", command).defaultPrevented, false);
});

test("editable arrows and Enter keep native handling; Escape exits game input", () => {
  const { state, items, command, key } = navigationHarness();
  command.focus();
  for (const arrow of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
    assert.equal(key(arrow, command).defaultPrevented, false);
  }
  assert.equal(key("Enter", items[0]).defaultPrevented, false);
  assert.equal(key("Escape", command).defaultPrevented, true);
  assert.equal(state.activeElement, null);
  key("ArrowDown");
  assert.equal(state.activeElement, items[0]);
});

test("game navigation does not intercept busy/raw-input keys but library navigation remains available", () => {
  const { state, items, key } = navigationHarness();
  state.allowed = false;
  assert.equal(key("ArrowDown").defaultPrevented, false);
  state.home = true;
  assert.equal(key("ArrowDown").defaultPrevented, true);
  assert.equal(state.activeElement, items[0]);
});

test("Escape cancels native dialogs without submitting a game command", () => {
  const { state, command, key } = navigationHarness();
  state.modal = true;
  const result = key("Escape", command);
  assert.equal(result.defaultPrevented, true);
  assert.equal(result.stopped, true);
  assert.equal(state.closed, true);
});

test("nested configuration dialogs receive Escape before the underlying Settings dialog", () => {
  const { state, command, key } = navigationHarness();
  state.modal = true;
  command.focus();
  const originalClosest = command.closest;
  command.closest = (selector) => selector === "dialog[open]"
    ? { close: () => { state.nestedClosed = true; } } : originalClosest.call(command, selector);
  const result = key("Escape", command);
  assert.equal(result.defaultPrevented, true);
  assert.equal(state.nestedClosed, true);
  assert.equal(state.closed, false);
});

test("render completion does not steal focus from an open controller or settings dialog", () => {
  const { state, command, navigation, items } = navigationHarness();
  items[2]!.focus();
  state.modal = true;
  navigation.focusInput();
  assert.equal(state.activeElement, items[2]);
  state.modal = false;
  navigation.focusInput();
  assert.equal(state.activeElement, command);
});

test("composition and modified arrows are not intercepted", () => {
  const { handlers, event } = navigationHarness();
  for (const modifier of ["isComposing", "ctrlKey", "metaKey", "altKey", "shiftKey"] as const) {
    const input = event("ArrowDown");
    input[modifier] = true;
    handlers.get("keydown")!(input);
    assert.equal(input.defaultPrevented, false);
  }
});
