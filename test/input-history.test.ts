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

function choice(value: string, textContent: string, controlText?: string) {
  return {
    dataset: { value },
    textContent,
    closest: () => controlText === undefined ? null : { textContent: controlText },
    matches: () => false,
  };
}

async function inputHarness() {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const handlers = new Map<string, (event: InputEvent) => void>();
  const sent: string[] = [];
  const hint = { textContent: "" };
  const hintPrefix = { textContent: "", style: { marginLeft: "" } };
  const choices: ReturnType<typeof choice>[] = [];
  const command = {
    value: "",
    scrollLeft: 0,
    selectionStart: 0,
    selectionEnd: 0,
    addEventListener(type: string, handler: (event: InputEvent) => void) { handlers.set(type, handler); },
    setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; },
  };
  const state = {
    touch: false,
    handheld: false,
    busy: false, expiring: false,
    input: { kind: "string", singleCharacter: false, blocking: false },
    queuedSubmit: null as { value: string; choice?: string } | null,
  };
  const start = source.indexOf("const commandHistory =");
  const end = source.indexOf("const menuToggle =", start);
  const submitStart = source.indexOf("async function submit(");
  const submitEnd = source.indexOf('  const chat = terminal.querySelector', submitStart);
  assert.ok(start >= 0 && end > start && submitStart >= 0 && submitEnd > submitStart);
  const submit = runInNewContext([
    source.slice(submitStart, submitEnd), "sent.push(value);\n}",
    source.slice(start, end), "\nsubmit;",
  ].join("\n"), {
    touchInput: () => state.touch,
    command,
    sent,
    terminal: { querySelectorAll: () => choices },
    get busy() { return state.busy; },
    get expiring() { return state.expiring; },
    get input() { return state.input; },
    set queuedSubmit(value: typeof state.queuedSubmit) { state.queuedSubmit = value; },
    pendingScreen: false,
    settling: () => false,
    Element: class {},
    document: {
      body: { classList: { contains: (name: string) => name === "is-handheld" && state.handheld } },
      querySelector: (selector: string) => selector === "#command-hint" ? hint : selector === "#command-hint-prefix" ? hintPrefix
        : { addEventListener(type: string, handler: (event: InputEvent) => void) { handlers.set(`form:${type}`, handler); } },
      addEventListener(type: string, handler: (event: InputEvent) => void) { handlers.set(`document:${type}`, handler); },
    },
  }) as (value: string, choice?: ReturnType<typeof choice>) => Promise<void>;
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
  return { command, state, sent, dispatch, send, key, submit, hint, hintPrefix, choices };
}

test("recalled commands show a non-editable label that disappears on edits and submission", async () => {
  const { command, hint, hintPrefix, submit, key, dispatch, sent } = await inputHarness();
  await submit("400", choice("400", " Move[400] "));
  command.value = "draft";
  key("ArrowUp");
  assert.equal(command.value, "400");
  assert.equal(hintPrefix.textContent, "400");
  assert.equal(hint.textContent, " [Move]");
  command.scrollLeft = 5;
  dispatch("scroll");
  assert.equal(hintPrefix.style.marginLeft, "-5px");
  command.value = "4001";
  dispatch("input", { isComposing: true });
  assert.equal(hint.textContent, "");
  key("ArrowUp");
  assert.equal(hint.textContent, " [Move]");
  key("ArrowDown");
  assert.equal(command.value, "4001");
  assert.equal(hint.textContent, "");
  key("ArrowUp");
  dispatch("form:submit");
  assert.equal(hint.textContent, "");
  assert.deepEqual(sent, ["400", "400"]);
});

test("touchscreen input does not recall command history", async () => {
  const { state, command, send, key } = await inputHarness();
  send("400");
  state.touch = true;
  command.value = "draft";
  assert.equal(key("ArrowUp").defaultPrevented, false);
  assert.equal(command.value, "draft");
  state.touch = false;
  key("ArrowUp");
  assert.equal(command.value, "400");
});
test("handheld input does not recall command history without touch support", async () => {
  const { state, command, send, key } = await inputHarness();
  send("400");
  state.handheld = true;
  command.value = "draft";
  for (const arrow of ["ArrowUp", "ArrowDown"]) {
    assert.equal(key(arrow).defaultPrevented, false);
    assert.equal(command.value, "draft");
  }
  state.handheld = false;
  key("ArrowUp");
  assert.equal(command.value, "400");
});
test("typed commands capture matching button labels without adding labels to the submitted value", async () => {
  const { command, choices, hint, send, key } = await inputHarness();
  choices.push(choice("400", "[Move]"));
  send("400");
  send("unlabeled");
  key("ArrowUp");
  assert.equal(hint.textContent, "");
  key("ArrowUp");
  assert.equal(command.value, "400");
  assert.equal(hint.textContent, " [Move]");
});

test("GUI command history captures labels beside number-only buttons for clicks and typed commands", async () => {
  const { command, choices, hint, submit, send, key, sent } = await inputHarness();
  const conversation = choice("300", "[300]", " Conversation [300] ");
  const rest = choice("403", "[403]", "Rest [403]");
  choices.push(conversation, rest);
  await submit("300", conversation);
  send("403");
  choices.length = 0;
  key("ArrowUp");
  assert.equal(command.value, "403");
  assert.equal(hint.textContent, " [Rest]");
  key("ArrowUp");
  assert.equal(command.value, "300");
  assert.equal(hint.textContent, " [Conversation]");
  assert.deepEqual(sent, ["300", "403"]);
});

test("clicked commands enter the same history as typed inputs using their command value", async () => {
  const { command, sent, send, key, submit } = await inputHarness();
  send("10");
  await submit("400", choice("400", "Move"));
  key("ArrowUp");
  assert.equal(command.value, "400");
  key("ArrowUp");
  assert.equal(command.value, "10");
  key("ArrowDown");
  assert.equal(command.value, "400");
  assert.deepEqual(sent, ["10", "400"]);
});

test("queued clicked commands are recorded only once when submitted after rendering", async () => {
  const { command, state, sent, key, submit } = await inputHarness();
  state.expiring = true;
  await submit("400", choice("400", "Move"));
  assert.equal(state.queuedSubmit?.value, "400");
  assert.equal(state.queuedSubmit?.choice, "400");
  assert.equal(key("ArrowUp").defaultPrevented, false);
  state.expiring = false;
  await submit("400", choice("400", "Move"));
  key("ArrowUp");
  assert.equal(command.value, "400");
  key("ArrowDown");
  assert.equal(command.value, "");
  assert.deepEqual(sent, ["400"]);
});

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
