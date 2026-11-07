import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { once } from "node:events";
import { createApp } from "../src/server.js";

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
  assert.match(app, /autoAdvanceToggle\.checked = localStorage\.getItem\(AUTO_ADVANCE_KEY\) !== "0"/);
  assert.match(app, /localStorage\.setItem\(AUTO_ADVANCE_KEY, autoAdvanceToggle\.checked \? "1" : "0"\)/);
});
