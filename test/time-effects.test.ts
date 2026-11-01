import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { emptyGame, indexScript } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";

test("only the hotpatched eraTW freeze skips the interpreter's fallback command wait", () => {
  for (const jit of [false, true]) {
    for (const [adapter, patch, command, skipsWait] of [
      [false, false, 355, false],
      [true, false, 355, false],
      [true, true, 355, true],
      [true, true, 300, false],
    ] as const) {
      const game = emptyGame();
      game.names.set("CFLAG", new Map([["現在位置", 0]]));
      game.tables.set("TRAIN", new Map([[300, ["Talk"]], [355, ["Time Stop"]]]));
      indexScript(game, `@SYSTEM_TITLE
ADDVOIDCHARA
MASTER = 0
TARGET = 0
BEGIN TRAIN
@SHOW_STATUS
PRINTL Menu
@COM_ABLE300
RETURN 1
@COM_ABLE355
RETURN 1
@COM300
RETURN 1
@COM355
FLAG:70 = 1
RETURN 1
@SOURCE_CHECK
PREVCOM = SELECTCOM
DRAWLINE
@SHOW_USERCOM
STR:0 = Recorded command
TFLAG:150 = 1
${adapter ? `@HOTPATCH_TARGET_DATAGROUP
@KOJO_MESSAGE_SEND
@TRAINNAME_TR(ARG)
#FUNCTIONS
RETURNF ""` : ""}
${patch ? "@HOTPATCH_ORIGINAL_LS_RESTRICTION\n#FUNCTION\nRETURNF 0" : ""}`, "<command-wait>");
      const runtime = new Runtime(game, undefined, { jit });
      assert.equal(runtime.start().error, null);
      const snapshot = runtime.input(command === 355 ? "1" : "0");
      assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
      assert.equal(snapshot.input?.kind, skipsWait ? "integer" : "wait",
        `adapter=${adapter}, patch=${patch}, command=${command}, jit=${jit}`);
      assert.equal(snapshot.output.some((item) => item.type === "text" && /^-{3,}$/.test(item.text)), !skipsWait,
        "only animated freeze omits the source separator");
      const prompt = skipsWait ? snapshot : runtime.input("");
      assert.equal(prompt.error, null, JSON.stringify(prompt.error));
      assert.equal(prompt.lastCommand, adapter
        ? command < 300 ? "Last Training Command: Recorded command(助手)" : "Last Command: Recorded command"
        : undefined, "prompt metadata preserves the formatted name and assistant suffix");
    }
  }
});

test("frozen-time snapshots follow flags, automatic resumption, and native save loading", () => {
  for (const jit of [false, true]) {
    const game = emptyGame();
    game.names.set("CFLAG", new Map([["現在位置", 0]]));
    indexScript(game, `@SYSTEM_TITLE
ADDVOIDCHARA
FLAG:70 = 0
WAIT
FLAG:70 = 1
SAVEDATA 0, "frozen"
WAIT
WAIT
FLAG:70 = 0
WAIT
LOADDATA 0
WAIT
QUIT
@HOTPATCH_TARGET_DATAGROUP
@KOJO_MESSAGE_SEND
@TRAINNAME_TR
#FUNCTIONS
RETURNF ""
@EVENTLOAD
WAIT`, "<time-effects>");
    const runtime = new Runtime(game, undefined, { jit });
    const start = runtime.start();
    assert.equal(start.error, null);
    assert.equal(start.timeStopped, false);
    assert.equal(runtime.input("").timeStopped, true);
    assert.equal(runtime.input("").timeStopped, true, "ordinary frozen steps keep the state");
    assert.equal(runtime.input("").timeStopped, false, "no resume-button assumption");
    const loaded = runtime.input("");
    assert.equal(loaded.error, null);
    assert.equal(loaded.timeStopped, true, "native saves restore the state");
  }
  const game = emptyGame();
  indexScript(game, "@SYSTEM_TITLE\nFLAG:70 = 1\nWAIT", "<other-game>");
  assert.equal(new Runtime(game).start().timeStopped, undefined, "other games do not opt in");
});

test("time effects only burst on live transitions, clean up, and restore without replay", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const effects = source.slice(source.indexOf("const timeEffect ="), source.indexOf("const status ="));
  class Element {
    hidden = true;
    textContent = "";
    offsetWidth = 1;
    classes = new Set<string>();
    properties = new Map<string, string>();
    style = { setProperty: (name: string, value: string) => this.properties.set(name, value) };
    classList = {
      add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
      remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
      toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name),
    };
  }
  const elements = new Map<string, Element>();
  const get = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector)!;
  };
  const body = new Element();
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const context = {
    terminal: get("#terminal"),
    document: { querySelector: get, body },
    clearTimeout: (id: number) => timers.delete(id),
    setTimeout: (callback: () => void, delay: number) => {
      assert.equal(delay, 1800);
      timers.set(++timerId, callback);
      return timerId;
    },
  };
  const show = runInNewContext(`${effects}\nshowTimeState;`, context) as (stopped?: boolean, fresh?: boolean) => void;
  show(false, true);
  assert.equal(get("#time-effect").hidden, true);
  show(true);
  assert.equal(get("#terminal").properties.get("--era-freeze"), "1");
  assert.equal(get("#terminal").classes.has("is-time-restoring"), false);
  assert.equal(get("#time-effect").hidden, false);
  assert.equal(get("#time-effect-title").textContent, "TIME FROZEN");
  assert.equal(get("#time-state").hidden, false);
  assert.ok(body.classes.has("is-time-frozen"));
  show(true);
  assert.equal(timerId, 1, "no burst for repeated frozen snapshots");
  show(false);
  assert.equal(get("#terminal").properties.get("--era-freeze"), "0");
  assert.equal(get("#time-effect-title").textContent, "TIME RESUMED");
  assert.deepEqual([...get("#time-effect").classes], ["is-resuming"]);
  assert.equal(timers.size, 1, "rapid transitions cancel old cleanup");
  assert.equal(get("#time-state").hidden, true);
  timers.get(timerId)!();
  assert.equal(get("#time-effect").hidden, true);
  show(true, true);
  assert.ok(get("#terminal").classes.has("is-time-restoring"));
  assert.equal(get("#time-effect").hidden, true, "replayed history does not animate");
  assert.equal(get("#time-state").hidden, false);
  show(undefined);
  assert.equal(get("#time-state").hidden, true);
  assert.equal(body.classes.has("is-time-frozen"), false);
  show(true);
  assert.equal(get("#time-effect").hidden, true, "first state after reset does not animate");
  assert.equal(timers.size, 0);
});

test("time effects are nonblocking and respect reduced motion", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.time-effect \{[^}]*pointer-events: none;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.time-effect[^}]*animation: none;/);
  assert.match(css, /\.time-shockwave \{ display: none; \}/);
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  assert.match(source, /showTimeState\(steps\.at\(-1\)\?\.snapshot\.timeStopped, fresh\)/);
});
