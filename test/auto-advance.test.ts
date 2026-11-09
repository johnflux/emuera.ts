import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { once } from "node:events";
import { createApp } from "../src/server.js";
import { emptyGame, indexScript } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";

const source = readFileSync(new URL("../web/auto-advance.js", import.meta.url), "utf8").replace(/^export /gm, "");

test("server serves shared control and auto-advance modules", async () => {
  const app = createApp([]);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  try {
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    for (const asset of ["controls.js", "auto-advance.js"]) {
      const response = await fetch(`http://127.0.0.1:${address.port}/${asset}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /javascript/);
      assert.equal(await response.text(), readFileSync(new URL(`../web/${asset}`, import.meta.url), "utf8"));
    }
  } finally {
    await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
  }
});

function harness() {
  let now = 0;
  let id = 0;
  let current: object | null = {};
  let advances = 0;
  const timers = new Map<number, { deadline: number; callback: () => void }>();
  const create = runInNewContext(`${source}\ncreateAutoAdvance`, {
    setTimeout(callback: () => void, delay: number) {
      timers.set(++id, { deadline: now + delay, callback });
      return id;
    },
    clearTimeout(handle: number) { timers.delete(handle); },
  });
  const controller = create(() => current, () => { advances++; });
  return {
    controller,
    set current(value: object | null) { current = value; },
    get current() { return current; },
    get advances() { return advances; },
    tick(milliseconds: number) {
      now += milliseconds;
      for (const [handle, timer] of [...timers]) {
        if (timer.deadline > now) continue;
        timers.delete(handle);
        timer.callback();
      }
    },
  };
}

test("auto-continue waits exactly 500 ms and does not reset during control refreshes", () => {
  const h = harness();
  h.controller.update();
  h.tick(499);
  h.controller.update();
  assert.equal(h.advances, 0);
  h.tick(1);
  assert.equal(h.advances, 1);
  h.controller.update();
  h.tick(5000);
  assert.equal(h.advances, 1, "a rejected Continue is not retried");
});

test("manual continuation or replacement cancels a stale timer and gives each wait 500 ms", () => {
  const h = harness();
  h.controller.update();
  h.tick(250);
  h.current = {};
  h.controller.update();
  h.tick(250);
  assert.equal(h.advances, 0);
  h.tick(250);
  assert.equal(h.advances, 1);
  h.current = null;
  h.controller.update();
  h.tick(500);
  assert.equal(h.advances, 1);
});

test("pausing, disabling and busy states cancel and resume with a fresh delay", () => {
  const h = harness();
  const wait = h.current;
  h.controller.update();
  h.tick(400);
  h.current = null;
  h.controller.update();
  h.tick(500);
  assert.equal(h.advances, 0);
  h.current = wait;
  h.controller.update();
  h.tick(499);
  assert.equal(h.advances, 0);
  h.tick(1);
  assert.equal(h.advances, 1);
});

test("timer rechecks eligibility even before an observer can cancel it", () => {
  const h = harness();
  h.controller.update();
  h.current = null;
  h.tick(500);
  assert.equal(h.advances, 0);
});

test("page lifecycle cleanup cancels the timer and permits a fresh delay on return", () => {
  const h = harness();
  h.controller.update();
  h.tick(400);
  h.controller.clear();
  h.tick(500);
  assert.equal(h.advances, 0);
  h.controller.update();
  h.tick(499);
  assert.equal(h.advances, 0);
  h.tick(1);
  assert.equal(h.advances, 1);
});

test("an automatic Continue that clears output pauses at the newly shown GUI wait", () => {
  for (const count of [1, 100, Number.MAX_SAFE_INTEGER]) {
    const h = harness();
    h.controller.update();
    h.tick(500);
    assert.equal(h.advances, 1);
    h.current = {};
    h.controller.observeResult({ output: [{ type: "clear", count }, { type: "html", text: "<div>GUI</div>" }] }, true);
    assert.equal(h.controller.isPaused(), true);
    h.controller.update();
    h.tick(5000);
    assert.equal(h.advances, 1, `clear ${count} must require manual continuation`);
    h.current = null;
    h.controller.update();
    h.current = {};
    h.controller.update();
    h.tick(5000);
    assert.equal(h.advances, 1, "settings, visibility and snapshot refreshes do not dismiss the pause");
    h.controller.observeResult({ output: [] }, false);
    assert.equal(h.controller.isPaused(), false);
    h.current = {};
    h.controller.update();
    h.tick(499);
    assert.equal(h.advances, 1);
    h.tick(1);
    assert.equal(h.advances, 2, "manual continuation resumes normal playback");
  }
});

test("normal dialogue and deliberate manual screen clears continue automatically", () => {
  for (const [output, automatic] of [
    [[], true],
    [[{ type: "text", text: "More dialogue" }], true],
    [[{ type: "clear", count: 0 }], true],
    [[{ type: "clear", count: 100 }], false],
  ] as const) {
    const h = harness();
    h.controller.observeResult({ output }, automatic);
    h.controller.update();
    h.tick(500);
    assert.equal(h.advances, 1);
  }
});

test("a failed manual input cannot dismiss a clear-screen pause, but a new run can", () => {
  const h = harness();
  h.controller.observeResult({ output: [{ type: "clear", count: 1 }] }, true);
  h.controller.observeResult({ output: [], error: { message: "Rejected" } }, false);
  h.controller.update();
  h.tick(500);
  assert.equal(h.advances, 0);
  h.controller.reset();
  assert.equal(h.controller.isPaused(), false);
  h.controller.update();
  h.tick(500);
  assert.equal(h.advances, 1);
});

test("screen-clear pause cancels an already scheduled timer", () => {
  const h = harness();
  h.controller.update();
  h.tick(250);
  h.controller.observeResult({ output: [{ type: "clear", count: 1 }] }, true);
  h.tick(250);
  assert.equal(h.advances, 0);
});

test("continue hint appears only at an idle manually paused wait", () => {
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const assignment = app.match(/document\.querySelector\("#continue-hint"\)\.hidden = [^;]+;/)![0];
  for (const overrides of [
    {}, { paused: false }, { busy: true }, { input: null },
    { input: { kind: "integer" } }, { input: { kind: "wait", blocking: true } },
    { input: { kind: "wait", timeout: 500 } },
  ]) {
    const state = { paused: true, busy: false, input: { kind: "wait" }, ...overrides };
    const hint = { hidden: true };
    runInNewContext(assignment, {
      document: { querySelector: () => hint }, busy: state.busy, input: state.input,
      autoAdvance: { isPaused: () => state.paused },
    });
    assert.equal(hint.hidden, Object.keys(overrides).length > 0);
  }
  assert.match(app, /querySelector\("#continue-hint"\)\.addEventListener\("click", \(\) => clickToContinue\(\)\)/);
});

test("runtime CLEARLINE followed by a GUI wait pauses even with prefetched execution", () => {
  for (const prefetch of [false, true]) {
    const game = emptyGame();
    indexScript(game, `@SYSTEM_TITLE
PRINTL Narration
WAIT
CLEARLINE 100
HTML_PRINT "<div class='era-dialog'><h2>New screen</h2></div>"
WAIT
PRINTL More narration
WAIT
INPUT
RETURN`, "auto-advance.ERB");
    const run = new Runtime(game);
    const first = run.start();
    assert.equal(first.input?.kind, "wait");
    const h = harness();
    h.current = first.input!;
    h.controller.update();
    h.tick(500);
    if (prefetch) assert.equal(run.prefetch(), true);
    const gui = run.input("");
    assert.equal(gui.input?.kind, "wait", JSON.stringify(gui.error));
    assert.ok(gui.output.some(output => output.type === "clear" && output.count === 100));
    h.current = gui.input!;
    h.controller.observeResult(gui, true);
    h.controller.update();
    h.tick(2000);
    assert.equal(h.advances, 1, "the GUI wait requires a manual Continue");
    const next = run.input("");
    assert.equal(next.input?.kind, "wait");
    h.current = next.input!;
    h.controller.observeResult(next, false);
    h.controller.update();
    h.tick(500);
    assert.equal(h.advances, 2);
  }
});

test("auto-continue settings persist and only permit ordinary waits", () => {
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const start = app.indexOf("const autoAdvance = createAutoAdvance(");
  const end = app.indexOf("autoAdvanceToggle.addEventListener", start);
  for (const overrides of [
    {}, { busy: true }, { input: { kind: "integer" } }, { input: { kind: "string" } },
    { input: { kind: "mousekey" } }, { input: { kind: "wait", blocking: true } },
    { input: { kind: "wait", timeout: 1000 } }, { hidden: true }, { modal: true },
    { home: true }, { enabled: false }, { session: null },
  ]) {
    const state = { busy: false, input: { kind: "wait" }, hidden: false, modal: false,
      home: false, enabled: true, session: "test", ...overrides };
    let eligible: (() => unknown) | undefined;
    runInNewContext(app.slice(start, end), {
      createAutoAdvance: (current: () => unknown) => { eligible = current; return {}; },
      autoAdvanceToggle: { checked: state.enabled }, session: state.session, busy: state.busy, input: state.input,
      document: {
        hidden: state.hidden, body: { classList: { contains: () => state.home } },
        querySelector: () => state.modal,
      },
    });
    assert.equal(eligible?.() === state.input, Object.keys(overrides).length === 0, JSON.stringify(overrides));
  }
  const initialization = app.match(/autoAdvanceToggle\.checked = [^;]+;/)?.[0];
  assert.ok(initialization);
  for (const componentSample of [null, "main"]) {
    for (const saved of [null, "0", "1"]) {
      const autoAdvanceToggle = { checked: true };
      runInNewContext(initialization, {
        autoAdvanceToggle, componentSample, AUTO_ADVANCE_KEY: "test",
        localStorage: { getItem: () => saved },
      });
      assert.equal(autoAdvanceToggle.checked, !componentSample && saved === "1",
        "previews do not auto-advance; ordinary gameplay retains its saved preference");
    }
  }
  assert.match(app, /localStorage\.setItem\(AUTO_ADVANCE_KEY, autoAdvanceToggle\.checked \? "1" : "0"\)/);
  assert.match(app, /submit\("", null, true\)/);
  assert.match(app, /autoAdvance\.observeResult\(snapshot, automatic\);[\s\S]*await render\(snapshot, waiting/);
  assert.match(app, /function resetRun\(\) \{[^}]*autoAdvance\.reset\(\)/);
});

test("active game dialogs cancel auto-advance and closing them resumes text with a fresh delay", () => {
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const start = app.indexOf("const autoAdvance = createAutoAdvance(");
  const end = app.indexOf("autoAdvanceToggle.addEventListener", start);
  const h = harness();
  const input = { kind: "wait" };
  let activeDialog = false;
  let eligible: (() => unknown) | undefined;
  runInNewContext(app.slice(start, end), {
    createAutoAdvance: (current: () => unknown) => { eligible = current; return {}; },
    autoAdvanceToggle: { checked: true }, session: "test", busy: false, input,
    document: {
      hidden: false, body: { classList: { contains: () => false } },
      querySelector: (selector: string) => {
        assert.equal(selector, "dialog[open], #menu-panel:not([hidden]), .screen.is-active .era-dialog:popover-open");
        return activeDialog ? {} : null;
      },
    },
  });
  function refresh() {
    h.current = eligible?.() === input ? input : null;
    h.controller.update();
  }
  refresh();
  h.tick(250);
  activeDialog = true;
  refresh();
  h.tick(5000);
  assert.equal(h.advances, 0, "opening a game dialog cancels a pending Continue");
  refresh();
  h.tick(5000);
  assert.equal(h.advances, 0, "a game dialog stays open indefinitely");
  activeDialog = false;
  refresh();
  h.tick(499);
  assert.equal(h.advances, 0);
  h.tick(1);
  assert.equal(h.advances, 1, "text resumes automatically after the dialog closes");
  const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  assert.match(html, /id="auto-advance-toggle"[^>]*><span>Auto-advance text<\/span>/);
});

test("screen transitions preserve narration before clears and ignore ordinary text updates", () => {
  const transition = runInNewContext(`${source}\nscreenTransitionIndex`);
  const screen = { type: "html", text: "<era-open class='era-layout era-main'>" };
  const isScreen = (entry: object) => entry === screen;
  const text = { type: "text", text: "The radio broadcast ends." };
  const clear = { type: "clear", count: 100 };
  assert.equal(transition([clear, screen], true, isScreen), 0);
  assert.equal(transition([text, clear, screen], false, isScreen), 1);
  assert.equal(transition([text, screen], false, isScreen), 1);
  assert.equal(transition([text, { type: "clear", count: 1 }, text, clear, screen], false, isScreen), 3,
    "earlier animation clears must not hide the final narration");
  assert.equal(transition([clear, screen], false, isScreen), -1, "initial menus need no extra Continue");
  assert.equal(transition([text], true, isScreen), -1);
  assert.equal(transition([{ type: "clear", count: 0 }, text], true, isScreen), -1);
  const htmlText = { type: "html", text: "<p>Narration</p>" };
  assert.equal(transition([htmlText, clear, screen], false, isScreen, (entry: object) => entry === htmlText), 1);
});

test("automatic and timer-driven transitions buffer the next GUI until a local manual Continue", async () => {
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const routines = app.slice(app.indexOf("let pendingScreen = null;"), app.indexOf("/** Renders steps in order"));
  for (const [timerDriven, finalText] of [[false, false], [false, true], [true, false], [true, true]]) {
    const game = emptyGame();
    indexScript(game, `@SYSTEM_TITLE
PRINTL Radio narration
${timerDriven ? "TWAIT 1, 1" : "WAIT"}
${finalText ? "PRINTL The broadcast ends." : ""}
CLEARLINE 100
HTML_PRINT "<era-open class='era-layout era-main'>"
PRINTL Commands
INPUT
RETURN`, "transition.ERB");
    const runtime = new Runtime(game);
    const first = runtime.start();
    const next = timerDriven ? runtime.timeout() : runtime.input("");
    assert.equal(next.input?.kind, "integer", JSON.stringify(next.error));
    const h = harness();
    const renders: { snapshot: typeof next; advanceScreen: unknown }[] = [];
    let timedClears = 0;
    const context = {
      snapshot: next, first,
      autoAdvance: h.controller, autoAdvanceToggle: { checked: true },
      screenTransitionIndex: runInNewContext(`${source}\nscreenTransitionIndex`),
      terminal: { querySelectorAll: () => [{ closest: () => null, textContent: "Radio narration" }] },
      DOMParser: class {
        parseFromString(text: string) {
          return { body: { querySelector: () => text.includes("era-layout"), textContent: "" } };
        }
      },
      clearTimedWait: () => { timedClears++; },
      continueQueued: true, skipRequested: true, queuedSubmit: {},
      input: first.input, step: first.step, busy: false,
      render: async (snapshot: typeof next, advanceScreen: unknown) => { renders.push({ snapshot, advanceScreen }); },
      updateControls: () => {},
      keyboardNavigation: { focusInput: () => {} },
      runQueuedContinue: () => {}, reactToEncounters: () => {},
      staleTab: () => false, message: () => assert.fail("unexpected error"),
    };
    await runInNewContext(`${routines}
      (async () => {
        if (!await deferScreen(snapshot, "continue", true)) throw new Error("Transition not deferred");
        if (!pendingScreen || input.kind !== "wait" || step !== snapshot.step) throw new Error("Missing local wait");
        if (continueQueued || skipRequested || queuedSubmit) throw new Error("Queued input bypasses pause");
        autoAdvance.update();
        await revealPendingScreen();
        if (pendingScreen) throw new Error("Screen not consumed");
      })()`, context);
    assert.equal(timedClears, 1);
    assert.equal(renders.length, finalText ? 2 : 1);
    if (finalText) {
      assert.ok(renders[0]!.snapshot.output.some(entry => entry.type === "text" && entry.text.includes("broadcast ends")));
      assert.ok(!renders[0]!.snapshot.output.some(entry => entry.type === "clear" || entry.type === "html"));
      assert.equal(renders[0]!.snapshot.input?.kind, "wait");
    }
    const revealed = renders.at(-1)!;
    assert.equal(revealed.snapshot.output[0]?.type, "clear");
    assert.equal(revealed.snapshot.input?.kind, "integer");
    assert.equal(revealed.advanceScreen, finalText ? false : "continue");
    assert.equal(h.controller.isPaused(), false, "manual Continue resumes playback");
    assert.equal(runtime.input("0").status, "halted", "the runtime is still waiting at the buffered command input");
  }
  assert.match(app, /if \(pendingScreen\) \{\s*if \(!automatic\) await revealPendingScreen\(\);\s*return;/);
  assert.match(app, /current === generation && !await deferScreen\(snapshot, false, true\)/);
});

test("manual transitions, disabled playback and errors never buffer a screen", async () => {
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const routines = app.slice(app.indexOf("let pendingScreen = null;"), app.indexOf("/** Renders steps in order"));
  for (const state of [
    { automatic: false, enabled: true, error: null },
    { automatic: true, enabled: false, error: null },
    { automatic: true, enabled: true, error: { message: "Stopped" } },
  ]) {
    assert.equal(await runInNewContext(`${routines}\ndeferScreen(snapshot, false, automatic)`, {
      automatic: state.automatic, autoAdvanceToggle: { checked: state.enabled },
      snapshot: { error: state.error },
    }), false);
  }
});
