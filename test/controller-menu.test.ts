import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { once } from "node:events";
import { createApp } from "../src/server.js";

const source = readFileSync(new URL("../web/controller-menu.js", import.meta.url), "utf8").replace(/^export /gm, "");

function harness(canExit = true) {
  type Key = {
    key: string; repeat?: boolean; ctrlKey?: boolean; defaultPrevented: boolean; stopped: boolean;
    preventDefault(): void; stopImmediatePropagation(): void;
  };
  const handlers = new Map<string, () => void>();
  let keyHandler = (_event: Key) => {};
  let focused: ReturnType<typeof control> | null = null;
  let nested = false;
  let hidden = false;
  let nextId = 0;
  const frames = new Map<number, () => void>();
  const calls = [0, 0, 0, 0];
  const errors: Error[] = [];
  const events: string[] = [];
  function control(index: number) {
    let click = async () => {};
    return {
      disabled: false, title: "", isConnected: true,
      focus() { focused = this; },
      closest: () => dialog.open ? dialog : null,
      matches: () => !actions[index]?.disabled,
      click: () => click(),
      dispatchEvent: (event: { key: string }) => { events.push(event.key); },
      addEventListener: (_type: string, listener: () => Promise<void>) => { click = listener; },
    };
  }
  const actions = [0, 1, 2, 3].map(control);
  let closeListener = () => {};
  const dialog = {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; closeListener(); },
    querySelectorAll: () => actions,
    contains: (item: unknown) => actions.some((action) => action === item),
    addEventListener: (_type: string, listener: () => void) => { closeListener = listener; },
  };
  let closeClick = () => {};
  let pads: ({ index: number; connected: boolean; mapping: string; buttons: { pressed: boolean }[] } | null)[] = [];
  const setup = runInNewContext(`${source}\nsetupControllerMenu`, {
    document: {
      get hidden() { return hidden; },
      get activeElement() { return focused; },
      querySelector(selector: string) {
        if (selector === "#controller-menu") return dialog;
        if (selector === "#controller-menu-close") return { addEventListener: (_type: string, listener: () => void) => { closeClick = listener; } };
        if (selector === "dialog[open]") return nested || dialog.open ? dialog : null;
        throw new Error(`Unexpected selector: ${selector}`);
      },
      addEventListener(type: string, listener: (() => void) | ((event: Key) => void)) {
        if (type === "keydown") keyHandler = listener as typeof keyHandler;
        else handlers.set(type, listener as () => void);
      },
    },
    navigator: { getGamepads: () => pads },
    window: { addEventListener: (type: string, listener: () => void) => handlers.set(type, listener) },
    requestAnimationFrame: (callback: () => void) => { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    KeyboardEvent: class { constructor(public keyType: string, public options: { key: string }) {} get key() { return this.options.key; } },
  });
  let restartable = true;
  let failExit = false;
  setup({
    restart: () => { calls[0]!++; },
    library: () => { calls[1]!++; },
    settings: () => { calls[2]!++; nested = true; },
    exit: () => { calls[3]!++; if (failExit) throw new Error("Quit IPC failed"); },
    canRestart: () => restartable,
    canExit,
    onError: (error: Error) => errors.push(error),
  });
  function key(repeat = false, ctrlKey = false) {
    const event: Key = {
      key: "F10", repeat, ctrlKey, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; },
    };
    keyHandler(event);
    return event;
  }
  function poll(buttons: number[], mapping = "standard", index = 0) {
    pads = [{ index, connected: true, mapping, buttons: Array.from({ length: 17 }, (_, button) => ({ pressed: buttons.includes(button) })) }];
    if (!frames.size) handlers.get("gamepadconnected")!();
    const [id, callback] = frames.entries().next().value!;
    frames.delete(id);
    callback();
  }
  return {
    dialog, actions, calls, errors, events, frames, handlers, key, poll,
    close: () => closeClick(),
    focus: (index: number) => actions[index]!.focus(),
    get focused() { return focused; },
    set nested(value: boolean) { nested = value; },
    set hidden(value: boolean) { hidden = value; },
    set restartable(value: boolean) { restartable = value; },
    set failExit(value: boolean) { failExit = value; },
    disconnect() {
      pads = [];
      const [id, callback] = frames.entries().next().value!;
      frames.delete(id);
      callback();
    },
  };
}

test("F10 toggles the centered menu, ignores repeats/modifiers, and does not cover another modal", () => {
  const h = harness();
  assert.equal(h.key().defaultPrevented, true);
  assert.equal(h.dialog.open, true);
  assert.equal(h.focused, h.actions[0]);
  h.key(true);
  assert.equal(h.dialog.open, true);
  h.key();
  assert.equal(h.dialog.open, false);
  h.nested = true;
  h.key();
  assert.equal(h.dialog.open, false);
  assert.equal(h.key(false, true).defaultPrevented, false);
});

test("standard Menu/Start is edge-triggered with release required and nonstandard pads ignored", () => {
  const h = harness();
  h.poll([9], "");
  assert.equal(h.dialog.open, false);
  h.poll([9]);
  assert.equal(h.dialog.open, true);
  h.poll([9]);
  assert.equal(h.dialog.open, true);
  h.poll([]);
  h.poll([9]);
  assert.equal(h.dialog.open, false);
});

test("D-pad and Back navigate modals and A runs their focused action only once", async () => {
  const h = harness();
  h.poll([9]);
  h.poll([13]);
  h.poll([13]);
  h.poll([1]);
  assert.deepEqual(h.events, ["ArrowDown", "Escape"]);
  h.focus(1);
  h.poll([0]);
  await Promise.resolve();
  assert.equal(h.dialog.open, false);
  assert.equal(h.calls[1], 1);
  h.poll([0]);
  assert.equal(h.calls[1], 1);
  h.poll([12]);
  assert.deepEqual(h.events, ["ArrowDown", "Escape"]);
});

test("menu actions close before running, disable unavailable actions, and report failures", async () => {
  const h = harness(false);
  h.restartable = false;
  h.key();
  assert.equal(h.actions[0]!.disabled, true);
  assert.equal(h.actions[3]!.disabled, true);
  assert.match(h.actions[3]!.title, /desktop app/);
  assert.equal(h.focused, h.actions[1]);
  await h.actions[2]!.click();
  assert.equal(h.dialog.open, false);
  assert.equal(h.calls[2], 1);
  const desktop = harness();
  desktop.failExit = true;
  desktop.key();
  await desktop.actions[3]!.click();
  assert.equal(desktop.errors[0]!.message, "Quit IPC failed");
});

test("controller polling stops when hidden or disconnected and resumes on connection", () => {
  const h = harness();
  h.poll([9]);
  assert.equal(h.frames.size, 1);
  h.hidden = true;
  h.handlers.get("visibilitychange")!();
  assert.equal(h.frames.size, 0);
  h.hidden = false;
  h.handlers.get("visibilitychange")!();
  assert.equal(h.frames.size, 1);
  h.disconnect();
  assert.equal(h.frames.size, 0);
  h.poll([]);
  assert.equal(h.frames.size, 1);
  h.handlers.get("pagehide")!();
  assert.equal(h.frames.size, 0);
});

test("controller menu module is served as JavaScript", async () => {
  const app = createApp([]);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  try {
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/controller-menu.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /javascript/);
  } finally {
    await new Promise<void>((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});

test("app menu reuses Restart and Library actions and confirms Exit before quitting", async () => {
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const start = app.indexOf("setupControllerMenu({");
  const end = app.indexOf("\n});", start);
  assert.ok(start >= 0 && end > start);
  let options: {
    restart(): void; library(): void; settings(): void; exit(): Promise<void>;
    canRestart(): boolean; canExit: boolean;
  } | undefined;
  let active: string | null = "session";
  let busy = false;
  let confirmed = false;
  let restarts = 0, libraries = 0, settings = 0, quits = 0, confirmations = 0;
  runInNewContext(app.slice(start, end + 4), {
    setupControllerMenu: (config: typeof options) => { options = config; },
    get session() { return active; },
    get busy() { return busy; },
    runMode: "game", runGame: "tw",
    chooseRun: (mode: string, game: string) => {
      assert.equal(mode, "game"); assert.equal(game, "tw"); restarts++;
    },
    document: { querySelector: (selector: string) => {
      assert.equal(selector, "#library-toggle");
      return { click: () => { libraries++; } };
    } },
    settingsPanel: { showModal: () => { settings++; } },
    eraDesktop: { quit: async () => { quits++; } },
    confirmAction: async (title: string, text: string, action: string) => {
      assert.equal(title, "Exit Era?");
      assert.match(text, /not been saved/);
      assert.equal(action, "Exit");
      confirmations++;
      return confirmed;
    },
  });
  assert.equal(options!.canExit, true);
  assert.equal(options!.canRestart(), true);
  busy = true;
  assert.equal(options!.canRestart(), false);
  busy = false;
  options!.restart();
  options!.library();
  options!.settings();
  assert.deepEqual([restarts, libraries, settings], [1, 1, 1]);
  await options!.exit();
  assert.equal(quits, 0);
  confirmed = true;
  await options!.exit();
  assert.equal(quits, 1);
  assert.equal(confirmations, 2);
  active = null;
  await options!.exit();
  assert.equal(quits, 2);
  assert.equal(confirmations, 2);
});
