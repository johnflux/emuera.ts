import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

class Element {
  className = "";
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  hidden = false;
  children: Element[] = [];
  parentElement: Element | null = null;
  private text = "";
  constructor(readonly tag = "div") {}
  classList = {
    contains: (name: string) => this.className.split(/\s+/).includes(name),
    add: (...names: string[]) => {
      for (const name of names) if (!this.classList.contains(name)) this.className += ` ${name}`;
    },
    remove: (name: string) => { this.className = this.className.split(/\s+/).filter((part) => part !== name).join(" "); },
    replace: (before: string, after: string) => {
      if (this.classList.contains(before)) {
        this.classList.remove(before);
        this.classList.add(after);
      }
    },
  };
  get childNodes() { return this.children; }
  get childElementCount() { return this.children.length; }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value: string) { this.replaceChildren(); this.text = value; }
  append(...children: Element[]) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children: Element[]) {
    for (const child of [...this.children]) child.remove();
    this.text = "";
    this.append(...children);
  }
  remove() {
    if (this.parentElement) {
      const siblings = this.parentElement.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentElement = null;
    }
  }
  matches(selector: string): boolean {
    return selector.split(",").some((part) => {
      const openOnly = part.includes(":not([data-closed])");
      const name = part.trim().replace(":not([data-closed])", "");
      const [tag, ...classes] = name.split(".");
      return (!openOnly || this.dataset.closed === undefined)
        && (!tag || this.tag === tag) && classes.every((token) => this.classList.contains(token));
    });
  }
  closest(selector: string): Element | null {
    return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null;
  }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string): Element | null { return this.querySelectorAll(selector)[0] ?? null; }
}

function element(className: string, text = "", tag = "div") {
  const node = new Element(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

async function fixture() {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const root = element("");
  const helpers = source.slice(source.indexOf("const SCROLLBACK_LINES ="), source.indexOf("// Once a revived screen"));
  const removeLine = source.slice(source.indexOf("function removeLine("), source.indexOf("const colorContext ="));
  const revive = source.slice(source.indexOf("function reviveScreen("), source.indexOf("const SCROLLBACK_LINES ="));
  const clear = source.slice(source.indexOf('    if (output.type === "clear")'), source.indexOf('    if (output.type === "title-image")'));
  const api = runInNewContext(`
    let currentScreen = null, currentLine = null;
    ${helpers}
    ${removeLine}
    ${revive}
    function clear(count) { for (const output of [{ type: "clear", count }]) { ${clear} } }
    ({ trimScrollback, restoreHistoryScreen, clear });
  `, {
    outputRoot: root, document: { createElement: (tag: string) => new Element(tag) },
    ruleTail: /([-─━═=＝～~_])\1{9,}$/u,
  }) as { trimScrollback(): void; restoreHistoryScreen(group: Element): void; clear(count: number): void };
  return { root, ...api };
}

async function screenFixture() {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const root = element("");
  const screen = source.slice(source.indexOf("function screen()"), source.indexOf("function lastOutputLine()"));
  const lineStart = source.indexOf("function line()");
  const line = source.slice(lineStart, source.indexOf("/**", lineStart));
  const retire = source.slice(source.indexOf("function retireScreen("), source.indexOf("// Undo retireScreen"));
  const boxes = source.slice(source.indexOf("function container()"), source.indexOf("/** Removes a line"));
  const render = source.slice(source.indexOf("  const previousScreen = currentScreen;"),
    source.indexOf('  outputRoot.querySelectorAll("button.choice").forEach(decorateCommandNumbers);'));
  const api = runInNewContext(`
    let currentScreen = null, currentLine = null, continuedScreens = [];
    ${screen}
    ${boxes}
    ${line}
    ${retire}
    async function render(snapshot, advanceScreen = false) { ${render} }
    ({ render, openBox, closeBox });
  `, {
    outputRoot: root,
    document: { createElement: (tag: string) => new Element(tag) },
    disposeCharacterChats: () => {},
    hideTooltip: () => {},
    applyLineStyle: () => {},
    applyStyle: () => {},
    ruleTail: /([-─━═=＝～~_])\1{9,}$/u,
  }) as {
    render(snapshot: {
      status: string;
      input?: { kind: string };
      output: { type: string; text: string; newline?: boolean; plain?: boolean }[];
    }, advanceScreen?: boolean | "continue"): Promise<void>;
    openBox(classes: string): void;
    closeBox(): void;
  };
  return { root, ...api };
}

for (const kind of ["integer", "string"]) {
  test(`continued dialogue stays bright at a ${kind} prompt until input is submitted`, async () => {
    const { root, render } = await screenFixture();
    const text = (text: string) => ({ type: "text", text, newline: true, plain: true });
    await render({ status: "waiting", input: { kind: "wait" }, output: [text("First page")] });
    await render({ status: "waiting", input: { kind: "wait" }, output: [text("Second page")] }, "continue");
    await render({ status: "waiting", input: { kind }, output: [text("Choose")] }, "continue");
    assert.equal(root.querySelectorAll(".is-history").length, 0);
    assert.equal(root.querySelectorAll(".is-active").length, 3);
    await render({ status: "waiting", input: { kind }, output: [] });
    assert.equal(root.querySelectorAll(".is-history").length, 0, "a refresh without input keeps dialogue bright");
    await render({ status: "waiting", input: { kind: "wait" },
      output: [{ type: "input", text: "1", newline: true }, text("Result")] }, true);
    assert.equal(root.querySelectorAll(".is-history").length, 3);
    assert.equal(root.querySelectorAll(".is-active").length, 1);
    assert.equal(root.children[2]!.textContent, "Choose1", "input echo stays with the retired prompt");
    assert.equal(root.lastElementChild!.textContent, "Result");
  });
}

test("continuing an unfinished line or reaching the end does not retire dialogue", async () => {
  const { root, render } = await screenFixture();
  await render({ status: "waiting", input: { kind: "wait" },
    output: [{ type: "text", text: "First", plain: true }] });
  await render({ status: "waiting", input: { kind: "wait" },
    output: [{ type: "text", text: " second", newline: true, plain: true }] }, "continue");
  assert.equal(root.querySelectorAll(".line").length, 1);
  assert.equal(root.textContent, "First second");
  await render({ status: "done", output: [{ type: "text", text: "End", newline: true, plain: true }] }, "continue");
  assert.equal(root.querySelectorAll(".is-history").length, 0);
  assert.equal(root.querySelectorAll(".is-active").length, 2);
});

test("main layout survives embrace-event waits after the header until its closing marker", async () => {
  const { root, render, openBox, closeBox } = await screenFixture();
  const text = (text: string) => ({ type: "text", text, newline: true, plain: true });
  openBox("era-layout era-main");
  openBox("era-main-header");
  await render({ status: "waiting", output: [text("Clock and date")] });
  closeBox();
  await render({ status: "waiting", input: { kind: "wait" }, output: [text("You are embraced by Mima!")] });
  await render({ status: "waiting", input: { kind: "wait" }, output: [text("Mima holds you close.")] }, "continue");
  assert.equal(root.children.length, 1, "continuing an event must not split an unfinished main layout");
  for (const panel of ["era-main-left", "era-main-center", "era-main-right"]) {
    openBox(panel);
    await render({ status: "waiting", output: [text(panel)] });
    closeBox();
  }
  await render({ status: "waiting", input: { kind: "integer" }, output: [text("Commands")] }, true);
  assert.equal(root.children.length, 1, "integer inputs also retain an unfinished layout");
  const main = root.querySelector(".era-main")!;
  assert.equal(main.querySelector(".era-main-header")!.parentElement, main);
  for (const panel of ["era-main-left", "era-main-center", "era-main-right"])
    assert.equal(main.querySelector(`.${panel}`)!.parentElement, main);
  closeBox();
  await render({ status: "waiting", input: { kind: "wait" }, output: [text("Next command result")] }, true);
  assert.equal(root.children.length, 2, "a completed layout must still retire on the next command");
  assert.ok(root.children[0]!.classList.contains("is-history"));
  assert.equal(root.lastElementChild!.textContent, "Next command result");
});

test("retired GUI is detached while narrative and echoed input become plain text", async () => {
  const { root, trimScrollback, restoreHistoryScreen } = await fixture();
  const group = element("screen is-history");
  const dialogue = element("line", "A short conversation.");
  const panel = element("era-box era-main");
  const menu = element("line", "Status and menu");
  menu.append(element("choice", "Move", "button"));
  panel.append(element("line era-marker"), menu, element("line era-marker era-close-line"));
  const choice = element("line");
  choice.append(element("choice", "Save", "button"));
  const echo = element("line");
  echo.append(element("scrollback-input", "400", "span"));
  const artwork = element("line");
  artwork.append(element("", "", "canvas"));
  const rule = element("line", "----------");
  group.append(dialogue, panel, choice, echo, artwork, rule);
  root.append(group);
  trimScrollback();
  assert.equal(root.querySelector("button"), null);
  assert.equal(root.querySelector("canvas"), null);
  assert.equal(root.querySelector(".era-box"), null);
  assert.deepEqual(group.children.filter((row) => !row.hidden).map((row) => row.textContent),
    ["A short conversation.", "400"]);
  const compact = [...group.children];
  trimScrollback();
  assert.deepEqual(group.children, compact, "compaction is idempotent");
  restoreHistoryScreen(group);
  assert.equal(group.children[0], dialogue);
  assert.equal(group.children[1], panel);
  assert.equal(group.querySelector("button")?.textContent, "Move");
  assert.equal(group.children.at(-1), rule);
  restoreHistoryScreen(group);
  assert.equal(group.children[1], panel, "restoring twice leaves the restored menu intact");
});

test("scrollback keeps exactly the newest 500 lines and does not trim active output", async () => {
  const { root, trimScrollback, restoreHistoryScreen } = await fixture();
  const oldest = element("screen is-history");
  oldest.append(element("line", "Discard this screen"));
  const history = element("screen is-history");
  history.append(...Array.from({ length: 600 }, (_, i) => element("line", String(i))));
  const active = element("screen is-active");
  active.append(...Array.from({ length: 700 }, () => element("line", "Active dialogue")));
  const button = element("choice", "Continue", "button");
  active.children[0]!.append(button);
  root.append(oldest, history, active);
  trimScrollback();
  assert.equal(oldest.parentElement, null);
  assert.equal(history.children.length, 500);
  assert.equal(history.children[0]!.textContent, "100");
  assert.equal(history.children.at(-1)!.textContent, "599");
  assert.equal(active.children.length, 700);
  assert.equal(active.querySelector("button"), button);
  restoreHistoryScreen(history);
  assert.equal(history.children.length, 500, "restoration cannot resurrect trimmed lines");
  assert.equal(history.children[0]!.textContent, "100");
});

test("hidden GUI, zero-line markers and multi-line images cannot bypass the cap", async () => {
  const { root, trimScrollback, restoreHistoryScreen } = await fixture();
  const group = element("screen is-history");
  const panel = element("era-box");
  panel.append(...Array.from({ length: 600 }, () => {
    const marker = element("line era-marker");
    marker.dataset.logicalLines = "0";
    return marker;
  }));
  const image = element("line");
  image.dataset.logicalLines = "20";
  image.append(element("", "", "canvas"));
  group.append(panel, image);
  root.append(group);
  trimScrollback();
  assert.equal(group.children.length, 481);
  assert.ok(group.children.every((row) => row.hidden));
  restoreHistoryScreen(group);
  assert.equal(group.querySelectorAll(".line").length, 481);
  assert.equal(image.dataset.logicalLines, "20");
});

test("CLEARLINE restores original logical counts and revives the previous menu", async () => {
  const { root, trimScrollback, clear } = await fixture();
  const history = element("screen is-history");
  const panel = element("era-box");
  const menu = element("line");
  const choice = element("choice", "Move", "button");
  menu.append(choice);
  panel.append(menu);
  const image = element("line");
  image.dataset.logicalLines = "20";
  image.dataset.lineHeight = "19";
  image.append(element("", "", "canvas"));
  history.append(panel, image);
  const active = element("screen is-active");
  active.append(element("line", "A temporary response"));
  root.append(history, active);
  trimScrollback();
  assert.equal(history.querySelector("button"), null);
  clear(2);
  assert.equal(active.parentElement, null);
  assert.ok(history.classList.contains("is-active"));
  assert.equal(history.querySelector("button"), choice);
  assert.ok(choice.classList.contains("is-revived"));
  assert.equal(image.dataset.logicalLines, "19");
  assert.equal(image.style.height, "361px");
  clear(19);
  assert.equal(image.parentElement, null);
  assert.equal(history.querySelector("button"), choice);
});
