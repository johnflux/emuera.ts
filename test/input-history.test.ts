import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

type InputEvent = {
  key: string;
  target: unknown;
  defaultPrevented: boolean;
  preventDefault(): void;
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

async function inputHarness() {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const handlers = new Map<string, (event: InputEvent) => void>();
  const sent: string[] = [];
  const command = {
    value: "",
    selectionStart: 0,
    selectionEnd: 0,
    addEventListener(type: string, handler: (event: InputEvent) => void) { handlers.set(type, handler); },
    setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; },
  };
  const state = { busy: false, expiring: false, input: { kind: "string", singleCharacter: false, blocking: false } };
  const start = source.indexOf("const commandHistory =");
  const end = source.indexOf("const menuToggle =", start);
  assert.ok(start >= 0 && end > start);
  runInNewContext(source.slice(start, end), {
    command,
    get busy() { return state.busy; },
    get expiring() { return state.expiring; },
    get input() { return state.input; },
    submit(value: string) { sent.push(value); },
    settling: () => false,
    Element: class {},
    document: {
      body: { classList: { contains: () => false } },
      querySelector: () => ({ addEventListener(type: string, handler: (event: InputEvent) => void) { handlers.set(`form:${type}`, handler); } }),
      addEventListener(type: string, handler: (event: InputEvent) => void) { handlers.set(`document:${type}`, handler); },
    },
  });
  function dispatch(type: string, extra: Partial<InputEvent> = {}) {
    const event = {
      key: "", target: command, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...extra,
    };
    handlers.get(type)!(event);
    return event;
  }
  function send(value: string) {
    command.value = value;
    dispatch("form:submit");
    command.value = "";
  }
  const key = (key: string, extra: Partial<InputEvent> = {}) => dispatch("keydown", { key, ...extra });
  return { command, state, sent, dispatch, send, key };
}

test("input history navigates both directions, clamps at the ends and restores the draft", async () => {
  const { command, sent, send, key } = await inputHarness();
  command.value = "draft";
  assert.equal(key("ArrowUp").defaultPrevented, false);
  send("10");
  send("hello");
  command.value = "unfinished";
  assert.equal(key("ArrowUp").defaultPrevented, true);
  assert.equal(command.value, "hello");
  assert.equal(command.selectionStart, 5);
  assert.equal(command.selectionEnd, 5);
  key("ArrowUp");
  assert.equal(command.value, "10");
  key("ArrowUp");
  assert.equal(command.value, "10");
  key("ArrowDown");
  assert.equal(command.value, "hello");
  key("ArrowDown");
  assert.equal(command.value, "unfinished");
  key("ArrowDown");
  assert.equal(command.value, "unfinished");
  assert.deepEqual(sent, ["10", "hello"]);
});

test("editing or submitting a recalled input resets history navigation", async () => {
  const { command, send, key, dispatch } = await inputHarness();
  send("first");
  send("second");
  key("ArrowUp");
  command.value = "edited";
  dispatch("input");
  key("ArrowUp");
  assert.equal(command.value, "second");
  key("ArrowDown");
  assert.equal(command.value, "edited");
  dispatch("form:submit");
  command.value = "";
  key("ArrowUp");
  assert.equal(command.value, "edited");
  key("ArrowDown");
  assert.equal(command.value, "");
});

test("history ignores empty, wait, mouse and blocked submissions", async () => {
  const { command, state, send, key } = await inputHarness();
  send("");
  state.input.kind = "wait";
  send("wait");
  state.input.kind = "mousekey";
  send("mouse");
  state.input.kind = "string";
  state.busy = true;
  send("busy");
  state.busy = false;
  state.input.blocking = true;
  send("blocked");
  state.input.blocking = false;
  command.value = "draft";
  assert.equal(key("ArrowUp").defaultPrevented, false);
  assert.equal(command.value, "draft");
});

test("history preserves composition and modified arrow keys", async () => {
  const { command, send, key } = await inputHarness();
  send("previous");
  command.value = "draft";
  for (const modifier of ["isComposing", "ctrlKey", "metaKey", "altKey", "shiftKey", "defaultPrevented"]) {
    key("ArrowUp", { [modifier]: true });
    assert.equal(command.value, "draft");
  }
  assert.equal(key("ArrowLeft").defaultPrevented, false);
});

test("global Enter and single-character submissions enter history without submitting recalled values", async () => {
  const { command, state, sent, dispatch, key } = await inputHarness();
  command.value = "global";
  dispatch("document:keydown", { key: "Enter", target: null });
  state.input.singleCharacter = true;
  state.input.kind = "integer";
  command.value = "7";
  dispatch("input");
  command.value = "";
  key("ArrowUp");
  assert.equal(command.value, "7");
  key("ArrowUp");
  assert.equal(command.value, "global");
  assert.deepEqual(sent, ["global", "7"]);
  command.value = "x";
  dispatch("input");
  assert.deepEqual(sent, ["global", "7"]);
});
