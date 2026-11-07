import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { once } from "node:events";
import { createApp } from "../src/server.js";

const source = readFileSync(new URL("../web/controller-menu.js", import.meta.url), "utf8").replace(/^export /gm, "");

function harness(canExit = true, savedHints = "auto", legacyForce = "0", deck = false) {
  type Key = {
    key: string; repeat?: boolean; ctrlKey?: boolean; defaultPrevented: boolean; stopped: boolean;
    preventDefault(): void; stopImmediatePropagation(): void;
  };
  const handlers = new Map<string, () => void>();
  let keyHandler = (_event: Key) => {};
  let focused: ReturnType<typeof control> | null = null;
  let nested = false;
  let popover = false;
  let hidden = false;
  let nextId = 0;
  const frames = new Map<number, () => void>();
  const calls = [0, 0, 0, 0];
  const errors: Error[] = [];
  const events: string[] = [];
  const pages = [0, 0];
  let mapVisible = false, mapIndex = 1;
  const mapClicks: number[] = [];
  let mapBackClicks = 0;
  const mapTabs = [0, 1, 2].map((index) => ({
    disabled: false, classList: { contains: () => index === mapIndex },
    closest: () => null, getClientRects: () => [1], focus() {},
    click: () => { mapClicks.push(index); mapIndex = index; },
  }));
  let hasController = false;
  let yActions = 0;
  let hintsClick = () => {};
  const hintsToggle = {
    textContent: "",
    addEventListener: (_type: string, listener: () => void) => { hintsClick = listener; },
  };
  const storage = new Map([["era-typescript.controller-hints", savedHints], ["era-typescript.force-controller", legacyForce]]);
  if (!savedHints) storage.delete("era-typescript.controller-hints");
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
    querySelector: (selector: string) => {
      const index = selector === ".era-page-prev:enabled" ? 0 : 1;
      return {
        closest: () => null,
        getClientRects: () => [1],
        focus: () => {},
        click: () => { pages[index]!++; },
      };
    },
    contains: (item: unknown) => actions.some((action) => action === item),
    addEventListener: (_type: string, listener: () => void) => { closeListener = listener; },
  };
  let closeClick = () => {};
  let pads: ({ index: number; connected: boolean; mapping: string; buttons: { pressed: boolean }[] } | null)[] = [];
  const setup = runInNewContext(`${source}\nsetupControllerMenu`, {
    eraDesktop: { handheld: deck },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    document: {
      body: { classList: { toggle: (name: string, value: boolean) => {
        assert.equal(name, "has-controller");
        hasController = value;
      } } },
      get hidden() { return hidden; },
      get activeElement() { return focused; },
      querySelector(selector: string) {
        if (selector === "#controller-hints-toggle") return hintsToggle;
        if (selector === "#controller-menu") return dialog;
        if (selector === "#controller-menu-close") return { addEventListener: (_type: string, listener: () => void) => { closeClick = listener; } };
        if (selector === "dialog[open]") return nested || dialog.open ? dialog : null;
        if (selector === ".screen.is-active .era-dialog:popover-open") return popover ? dialog : null;
        if (selector.startsWith("dialog[open],")) return nested || dialog.open || popover ? dialog : null;
        if (selector === ".screen.is-active .era-move-tabs") return mapVisible ? {
          closest: () => null, getClientRects: () => [1], querySelectorAll: () => mapTabs,
        } : null;
        if (selector === ".screen.is-active button.era-move-back:enabled:not(.is-stale)") return mapVisible ? {
          closest: () => null, getClientRects: () => [1], click: () => { mapBackClicks++; },
        } : null;
        throw new Error(`Unexpected selector: ${selector}`);
      },
      addEventListener(type: string, listener: (() => void) | ((event: Key) => void)) {
        if (type === "keydown") keyHandler = listener as typeof keyHandler;
        else handlers.set(type, listener as () => void);
      },
    },
    navigator: { getGamepads: () => pads },
    getComputedStyle: () => ({ visibility: "visible", display: "block" }),
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
    onY: () => { yActions++; },
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
    dialog, actions, calls, errors, events, frames, handlers, key, poll, pages,
    close: () => closeClick(),
    focus: (index: number) => actions[index]!.focus(),
    get focused() { return focused; },
    get hasController() { return hasController; },
    get yActions() { return yActions; },
    cycleHints: () => hintsClick(),
    get hintsLabel() { return hintsToggle.textContent; },
    storage,
    set nested(value: boolean) { nested = value; },
    set popover(value: boolean) { popover = value; },
    set hidden(value: boolean) { hidden = value; },
    set restartable(value: boolean) { restartable = value; },
    set failExit(value: boolean) { failExit = value; },
    set mapVisible(value: boolean) { mapVisible = value; },
    mapClicks,
    get mapBackClicks() { return mapBackClicks; },
    disconnect() {
      pads = [];
      const [id, callback] = frames.entries().next().value!;
      frames.delete(id);
      callback();
    },
  };
}

test("map bumpers select adjacent tabs without wrapping or acting through overlays", () => {
  let overlay = false, hidden = false;
  const clicks: number[] = [], focused: number[] = [];
  let current = 1;
  const tabs = [0, 1, 2].map((index) => ({
    disabled: false,
    classList: { contains: () => index === current },
    closest: () => null, getClientRects: () => [1],
    focus: () => { focused.push(index); },
    click: () => { clicks.push(index); current = index; },
  }));
  const activate = runInNewContext(`${source}\nactivateMapTab`, {
    document: { querySelector: (selector: string) => {
      if (selector.startsWith("dialog[open]")) return overlay ? {} : null;
      assert.equal(selector, ".screen.is-active .era-move-tabs");
      return { closest: () => null, getClientRects: () => hidden ? [] : [1], querySelectorAll: () => tabs };
    } },
  });
  activate(1);
  activate(1);
  assert.deepEqual(clicks, [2], "R1 stops at the last tab");
  activate(-1);
  activate(-1);
  activate(-1);
  assert.deepEqual(clicks, [2, 1, 0], "L1 stops at the first tab");
  overlay = true;
  activate(1);
  overlay = false;
  hidden = true;
  activate(1);
  hidden = false;
  tabs[1]!.disabled = true;
  activate(1);
  assert.deepEqual(clicks, [2, 1, 0]);
  assert.deepEqual(focused, clicks);
  const css = readFileSync(new URL("../web/handheld.css", import.meta.url), "utf8");
  assert.match(css, /\.has-controller \.era-move-tabs::before \{ content: "L1"; \}/);
  assert.match(css, /\.has-controller \.era-move-tabs::after \{ content: "R1"; \}/);
});

test("controller polling routes L1 and R1 to map tabs once per press without changing dialog paging", () => {
  const h = harness();
  h.mapVisible = true;
  h.poll([5]);
  h.poll([5]);
  assert.deepEqual(h.mapClicks, [2]);
  h.poll([]);
  h.poll([4]);
  assert.deepEqual(h.mapClicks, [2, 1]);
  h.poll([]);
  h.popover = true;
  h.poll([5]);
  assert.deepEqual(h.mapClicks, [2, 1]);
  assert.deepEqual(h.pages, [0, 1]);
});

test("B activates map Back once per press and stays with dialogs when a modal is open", () => {
  const h = harness();
  h.mapVisible = true;
  h.poll([1]);
  h.poll([1]);
  assert.equal(h.mapBackClicks, 1);
  h.poll([]);
  h.popover = true;
  h.focus(0);
  h.poll([1]);
  assert.equal(h.mapBackClicks, 1);
  assert.deepEqual(h.events, ["Escape"]);
  const css = readFileSync(new URL("../web/handheld.css", import.meta.url), "utf8");
  assert.match(css, /\.has-controller \.screen\.is-active button\.era-move-back:enabled:not\(\.is-stale\)::after \{ content: "B";/);
});

test("L1 and R1 page dialogs once per press and do nothing without a dialog or map", () => {
  const h = harness();
  h.poll([4, 5]);
  assert.deepEqual(h.pages, [0, 0]);
  h.popover = true;
  h.poll([]);
  h.poll([4]);
  h.poll([4]);
  assert.deepEqual(h.pages, [1, 0]);
  h.poll([5]);
  assert.deepEqual(h.pages, [1, 1]);
});

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

test("Y triggers once per press only outside modals and supported controllers control the hint", () => {
  const h = harness();
  h.poll([3], "");
  assert.equal(h.yActions, 0);
  assert.equal(h.hasController, false);
  h.poll([3]);
  assert.equal(h.hasController, true);
  assert.equal(h.yActions, 1);
  h.poll([3]);
  assert.equal(h.yActions, 1);
  h.poll([]);
  h.poll([3]);
  assert.equal(h.yActions, 2);
  h.key();
  h.poll([]);
  h.poll([3]);
  assert.equal(h.yActions, 2);
  h.disconnect();
  assert.equal(h.hasController, false);
});

test("controller hints cycle Auto/On/Off, persist, and follow detection only in Auto", () => {
  const h = harness();
  assert.equal(h.hasController, false);
  assert.equal(h.hintsLabel, "Controller hints: Auto (Off)");
  h.poll([]);
  assert.equal(h.hasController, true);
  assert.equal(h.hintsLabel, "Controller hints: Auto (On)");
  h.disconnect();
  h.cycleHints();
  assert.equal(h.hasController, true);
  assert.equal(h.hintsLabel, "Controller hints: On");
  assert.equal(h.storage.get("era-typescript.controller-hints"), "on");
  h.poll([], "");
  assert.equal(h.hasController, true);
  h.poll([]);
  h.disconnect();
  assert.equal(h.hasController, true);
  h.cycleHints();
  assert.equal(h.hasController, false);
  assert.equal(h.hintsLabel, "Controller hints: Off");
  assert.equal(h.storage.get("era-typescript.controller-hints"), "off");
  h.poll([]);
  assert.equal(h.hasController, false);
  h.cycleHints();
  assert.equal(h.hasController, true);
  assert.equal(h.storage.get("era-typescript.controller-hints"), "auto");
  h.disconnect();
  assert.equal(h.hasController, false);
  assert.equal(harness(true, "on").hasController, true);
  const restoredOff = harness(true, "off");
  restoredOff.poll([]);
  assert.equal(restoredOff.hasController, false);
  assert.equal(harness(true, "", "1").hasController, true);
  assert.equal(harness(true, "", "0").hintsLabel, "Controller hints: Auto (Off)");
});

test("Auto controller hints stay on for Steam Deck without a gamepad but explicit Off wins", () => {
  const h = harness(true, "auto", "0", true);
  assert.equal(h.hasController, true);
  assert.equal(h.hintsLabel, "Controller hints: Auto (On)");
  h.poll([]);
  h.disconnect();
  assert.equal(h.hasController, true);
  const off = harness(true, "off", "0", true);
  assert.equal(off.hasController, false);
  off.poll([]);
  assert.equal(off.hasController, false);
  off.cycleHints();
  assert.equal(off.hasController, true);
  assert.equal(off.hintsLabel, "Controller hints: Auto (On)");
});

test("Y selects the active visible Wake Up or Time Stop/Resume button, not historical or unavailable actions", () => {
  for (const name of ["Wake Up", "Time Stop", "Resume"]) {
    let clicks = 0;
    let home = false, overlay = false, unavailable = false, hidden = false, inert = false;
    const activate = runInNewContext(`${source}\nactivateControllerAction`, {
      document: {
        body: { classList: { contains: () => home } },
        querySelector(selector: string) {
          if (selector.startsWith("dialog[open]")) return overlay ? {} : null;
          assert.equal(selector, ".screen.is-active button.era-timestop-button:enabled:not(.is-stale)");
          return unavailable ? null : {
            textContent: name,
            closest: () => inert ? {} : null,
            getClientRects: () => hidden ? [] : [1],
            click: () => { clicks++; },
          };
        },
      },
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
    });
    activate();
    assert.equal(clicks, 1, name);
    for (const state of ["home", "overlay", "unavailable", "hidden", "inert"]) {
      home = state === "home";
      overlay = state === "overlay";
      unavailable = state === "unavailable";
      hidden = state === "hidden";
      inert = state === "inert";
      activate();
      assert.equal(clicks, 1, `${name}: ${state}`);
    }
  }
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

test("game popovers receive D-pad, A and B instead of the background Y action", async () => {
  const h = harness();
  h.popover = true;
  h.focus(1);
  h.poll([13, 1, 3]);
  assert.deepEqual(h.events, ["ArrowDown", "Escape"]);
  assert.equal(h.yActions, 0);
  h.poll([0]);
  await Promise.resolve();
  assert.equal(h.calls[1], 1);
});

test("app Close and Cancel buttons carry Back hints without changing their form values", () => {
  const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  for (const id of ["controller-menu-close", "settings-close", "art-demo-close"]) {
    const tag = html.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(tag, id);
    assert.match(tag, /data-controller-hint="B"/);
  }
  const cancels = [...html.matchAll(/<button\b[^>]*value="cancel"[^>]*>/g)];
  assert.equal(cancels.length, 3);
  for (const [tag] of cancels) assert.match(tag, /data-controller-hint="B"/);
  const css = readFileSync(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.has-controller :is\(dialog\[open\], \.screen\.is-active \.era-dialog:popover-open\).*:focus:not\(\[data-controller-hint\]\):not\(\.era-dialog-close\)::after/);
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
    canRestart(): boolean; canExit: boolean; onY(): void;
  } | undefined;
  let active: string | null = "session";
  let busy = false;
  let confirmed = false;
  let restarts = 0, libraries = 0, settings = 0, quits = 0, confirmations = 0;
  let yActions = 0;
  let input: { blocking: boolean } | null = { blocking: false };
  runInNewContext(app.slice(start, end + 4), {
    setupControllerMenu: (config: typeof options) => { options = config; },
    get session() { return active; },
    get busy() { return busy; },
    get input() { return input; },
    activateControllerAction: () => { yActions++; },
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
  options!.onY();
  assert.equal(yActions, 1);
  busy = true;
  options!.onY();
  assert.equal(yActions, 1);
  assert.equal(options!.canRestart(), false);
  busy = false;
  input = { blocking: true };
  options!.onY();
  input = null;
  options!.onY();
  assert.equal(yActions, 1);
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
