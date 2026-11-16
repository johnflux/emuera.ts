import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate, setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { debugCommand } from "../src/debugger.js";
import { applyHotpatches, loadGame } from "../src/loader.js";
import { QaDriver } from "../src/qa-driver.js";
import { Runtime } from "../src/runtime.js";
import { ScriptReload } from "../src/script-reload.js";
import { createApp } from "../src/server.js";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "era-reload-"));
  await Promise.all(["ERB", "CSV", "hotpatch"].map(name => mkdir(path.join(root, name))));
  const file = path.join(root, "ERB", "main.erb");
  const hotpatch = path.join(root, "hotpatch");
  const source = (value: number) => `@SYSTEM_TITLE
PRINTL old active frame
INPUT
CALL SHOW
INPUT
QUIT
@SHOW
PRINTFORML new call {VALUE()}
@VALUE
#FUNCTION
RETURNF ${value}
@MACRO_USER
#FUNCTION
RETURNF BONUS`;
  await writeFile(file, source(1));
  await writeFile(path.join(root, "ERB", "macros.erh"), "#DEFINE BONUS 10");
  return { root, file, hotpatch, source };
}
const runCommand = (runtime: Runtime, data: unknown) => runtime.debugCommand(debugCommand.parse(data));
const screenSource = (label: string) => `@SYSTEM_TITLE
MONEY = 99
TIME = 600
DAY = 5
BEGIN TRAIN
@SHOW_STATUS
PRINTL main ${label}
@SHOW_USERCOM
@USERCOM
IF RESULT == 10000
BEGIN SHOP
ELSE
PRINTL other dialog
INPUT
ENDIF
@SHOW_SHOP
PRINTL wakeup ${label}
@USERSHOP
MONEY += 1
BEGIN TRAIN`;

test("script watcher reloads atomic saves, macros and hotpatches; retains state/active frames and recovers after compilation failure", async () => {
  const f = await fixture();
  const game = await loadGame(f.root);
  const runtime = new Runtime(game);
  runtime.start();
  runCommand(runtime, { action: "write", target: "MONEY", value: { type: "integer", value: "99" } });
  for (let i = 0; i < 4; i++) runCommand(runtime, { action: "call", name: "VALUE" });
  assert.equal((runCommand(runtime, { action: "evaluate", expression: "BONUS + VALUE()" }) as { value: string }).value, "11");
  const watcher = new ScriptReload(game, f.hotpatch, () => {
    assert.equal(watcher.status(0).reloading, true, "reload activity must cover loading and checking");
    return [game];
  }, (_previous, next) => runtime.reloadScripts(next));
  try {
    await watcher.ready;
    assert.equal(watcher.status(0).reloading, false);
    await writeFile(f.file + ".tmp", f.source(2).replace("old active frame", "replacement entry"));
    await rename(f.file + ".tmp", f.file);
    const deadline = Date.now() + 10_000;
    while (!watcher.status(0).revision && Date.now() < deadline) await setTimeout(50);
    const first = watcher.status(0);
    assert.equal(first.last?.status, "reloaded", JSON.stringify(first));
    assert.ok(first.last.files.includes(f.file));
    assert.ok(first.last.routines.includes("VALUE"));
    assert.ok(first.last.durationMs >= 0);
    assert.equal(first.reloading, false);
    assert.equal((runCommand(runtime, { action: "call", name: "VALUE" }) as { value: string }).value, "2");
    const advanced = runtime.input("7");
    assert.match(JSON.stringify(advanced.output), /new call 2/);
    assert.doesNotMatch(JSON.stringify(advanced.output), /replacement entry/);
    assert.equal((runCommand(runtime, { action: "read", expressions: ["MONEY"] }) as { value: string }[])[0]!.value, "99");
    await writeFile(f.file, f.source(3) + "\n@BAD\nIF 1\nPRINTL broken");
    await watcher.scan();
    const failed = watcher.status(first.revision);
    assert.equal(failed.last?.status, "error");
    assert.equal(failed.reloading, false, "failed reloads must clear activity");
    assert.ok(failed.last.errors.length);
    assert.equal((runCommand(runtime, { action: "call", name: "VALUE" }) as { value: string }).value, "2");
    await writeFile(f.file, f.source(4));
    await writeFile(path.join(f.root, "ERB", "macros.erh"), "#DEFINE BONUS 20");
    await writeFile(path.join(f.hotpatch, "value.erb"), "@VALUE\n#FUNCTION\nRETURNF 8");
    await watcher.scan();
    const fixed = watcher.status(failed.revision);
    assert.equal(fixed.last?.status, "reloaded", JSON.stringify(fixed));
    assert.equal((runCommand(runtime, { action: "evaluate", expression: "BONUS + VALUE()" }) as { value: string }).value, "28");
    assert.deepEqual(watcher.status(fixed.revision).events, []);
    await writeFile(path.join(f.root, "ERB", "macros.erh"), "#DEFINE BONUS (1 +)");
    await watcher.scan();
    assert.equal(watcher.status(0).last?.status, "error", "macro changes must validate otherwise-unchanged routines");
    assert.equal((runCommand(runtime, { action: "call", name: "MACRO_USER" }) as { value: string }).value, "20");
    await writeFile(path.join(f.root, "ERB", "macros.erh"), "#DEFINE BONUS 20");
    await watcher.scan();
    assert.equal(watcher.status(0).last?.status, "reloaded");
    await rm(path.join(f.hotpatch, "value.erb"));
    await watcher.scan();
    assert.equal((runCommand(runtime, { action: "call", name: "VALUE" }) as { value: string }).value, "4");
    const step = runtime.input("1");
    assert.equal(step.status, "halted");
  } finally { watcher.close(); await rm(f.root, { recursive: true }); }
});

test("qa_reload manually scans and consumes feedback per driver without changing game state", async () => {
  const f = await fixture();
  const game = await loadGame(f.root);
  await applyHotpatches(game, f.hotpatch);
  const token = "a".repeat(64);
  const server = createApp([{ id: "fixture", title: "Reload fixture", game, hotpatch: f.hotpatch }], false, undefined, [], { token });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const driver = new QaDriver(`http://127.0.0.1:${address.port}`, token);
  try {
    await driver.start({ game: "fixture", graphical: false, headed: false, viewport: { width: 900, height: 700 } });
    const initial = await driver.reload(false) as { revision: number; events: unknown[] };
    assert.equal(initial.revision, 0);
    const browserReload = async () => {
      const runtime = await (await fetch(`http://127.0.0.1:${address.port}/api/runtime`)).json();
      return runtime.games.find((entry: { id: string }) => entry.id === "fixture").reload;
    };
    assert.equal(await browserReload(), null);
    await writeFile(f.file, f.source(6));
    const status = await driver.reload(true) as { revision: number; events: { status: string }[] };
    assert.ok(status.events.some(event => event.status === "reloaded"), JSON.stringify(status));
    assert.equal((await browserReload()).revision, status.revision);
    assert.equal((await browserReload()).status, "reloaded");
    assert.deepEqual((await driver.reload(false) as { events: unknown[] }).events, []);
    const result = await driver.debug(debugCommand.parse({ action: "call", name: "VALUE" }));
    assert.match(JSON.stringify(result), /"value":"6"/);
    await writeFile(f.file, f.source(6).replace("RETURNF 6", "RETURNF 1 +"));
    const failure = await driver.reload(true) as { events: { status: string; errors: unknown[] }[] };
    assert.ok(failure.events.some(event => event.status === "error" && event.errors.length), JSON.stringify(failure));
    assert.equal((await browserReload()).status, "error");
    assert.match(JSON.stringify(await driver.debug(debugCommand.parse({ action: "call", name: "VALUE" }))), /"value":"6"/);
    await writeFile(f.file, f.source(7));
    assert.ok(JSON.stringify(await driver.reload(true)).includes("reloaded"));
    await driver.input("1", false);
    assert.match(JSON.stringify(await driver.observe()), /new call 7/);
    assert.equal(await readFile(f.file, "utf8"), f.source(7));
  } finally {
    await driver.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(f.root, { recursive: true });
  }
});

test("reloaded main and wakeup screens redraw without running commands; other dialogs do not", async () => {
  const f = await fixture();
  await writeFile(f.file, screenSource("old"));
  const game = await loadGame(f.root);
  const runtime = new Runtime(game);
  const watcher = new ScriptReload(game, f.hotpatch, () => [game], (_previous, next) => runtime.reloadScripts(next));
  const output = (snapshot: ReturnType<Runtime["start"]>) => snapshot.output.map(item => item.text ?? "").join("\n");
  const state = () => runCommand(runtime, { action: "read", expressions: ["MONEY", "TIME", "DAY"] });
  try {
    await watcher.ready;
    assert.equal(runtime.start().refreshable, true);
    const original = state();
    await writeFile(f.file, screenSource("new"));
    await watcher.scan();
    const main = runtime.refresh();
    assert.equal(main.error, null);
    assert.match(output(main), /main new/);
    assert.equal(main.refreshable, true);
    assert.deepEqual(state(), original);
    assert.equal(runtime.input("10000").refreshable, true);
    await writeFile(f.file, screenSource("newest"));
    await watcher.scan();
    const wakeup = runtime.refresh();
    assert.equal(wakeup.error, null);
    assert.match(output(wakeup), /wakeup newest/);
    assert.equal(wakeup.refreshable, true);
    assert.deepEqual(state(), original, "redrawing must not buy an item, run USERSHOP, advance time or wake the player");
    const returned = runtime.input("10000");
    assert.equal(returned.error, null);
    assert.match(output(returned), /main newest/);
    assert.match(JSON.stringify(state()), /"value":"100"/, "normal shop input still runs USERSHOP exactly once");
    const dialog = runtime.input("10001");
    assert.equal(dialog.error, null);
    assert.equal(dialog.refreshable, false);
    assert.match(output(dialog), /other dialog/);
    assert.throws(() => runtime.refresh(), /cannot redraw/);
  } finally { watcher.close(); await rm(f.root, { recursive: true }); }
});

test("graphical hot reload automatically re-shows main and wakeup screens", async () => {
  const f = await fixture();
  await writeFile(f.file, screenSource("old"));
  const token = "b".repeat(64);
  const server = createApp([{ id: "fixture", title: "Refresh fixture", game: await loadGame(f.root), hotpatch: f.hotpatch }],
    false, undefined, [], { token });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const driver = new QaDriver(`http://127.0.0.1:${address.port}`, token);
  const waitForText = async (text: string) => {
    const deadline = Date.now() + 10_000;
    let view;
    do {
      view = await driver.observe();
      if (JSON.stringify(view).includes(text)) return view;
      await setTimeout(50);
    } while (Date.now() < deadline);
    assert.fail(`Missing ${text}: ${JSON.stringify(view)}`);
  };
  try {
    await driver.start({ game: "fixture", graphical: true, headed: false, viewport: { width: 900, height: 700 } });
    await writeFile(f.file, screenSource("new"));
    await driver.reload(true);
    await waitForText("main new");
    await driver.input("10000", false);
    await waitForText("wakeup new");
    await writeFile(f.file, screenSource("newest"));
    await driver.reload(true);
    await waitForText("wakeup newest");
    const state = await driver.debug(debugCommand.parse({ action: "read", expressions: ["MONEY", "TIME", "DAY"] })) as { result: { value: string }[] };
    assert.deepEqual(state.result.map(item => item.value), ["99", "600", "5"]);
    await writeFile(f.file, screenSource("broken").replace("PRINTL wakeup broken", "PRINTFORML {1 / 0}"));
    await driver.reload(true);
    const failed = await waitForText("Division by zero") as { view: { uiError: string | null } };
    assert.match(failed.view.uiError ?? "", /Division by zero/, "a redraw error must not be overwritten by reload completion");
  } finally {
    await driver.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(f.root, { recursive: true });
  }
});

test("top status reports each active-game reload once and allows normal messages to replace it", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("async function watchDevelopment()");
  const end = source.indexOf("async function api(", start);
  assert.ok(start >= 0 && end > start);
  const timers: (() => void)[] = [];
  let reload = { revision: 3, status: "reloaded", errors: [] as { message: string }[] };
  let reloading = false;
  let connectionError = false;
  let refreshes = 0;
  let refreshResult = true;
  const bodyClasses = new Set(["is-busy-visible"]);
  let errorStyle = false;
  const status = {
    textContent: "Waiting for input.",
    classList: { toggle: (name: string, value: boolean) => { assert.equal(name, "error"); errorStyle = value; } },
  };
  const context = {
    session: "active", runMode: "game", runGame: "fixture", status,
    busy: false, input: { kind: "integer" }, pendingScreen: null, qaSnapshot: { refreshable: false },
    refreshScreen: async () => {
      refreshes++;
      if (!refreshResult) status.textContent = "Redraw failed.";
      return refreshResult;
    },
    document: { body: { classList: {
      toggle: (name: string, value: boolean) => { if (value) bodyClasses.add(name); else bodyClasses.delete(name); },
      remove: (name: string) => { bodyClasses.delete(name); },
    } } },
    sessionStorage: { getItem: () => null },
    api: async () => {
      if (connectionError) throw new Error("Offline");
      return { instance: "server", development: false, games: [{ id: "fixture", reload, reloading }] };
    },
    setTimeout: (callback: () => void) => { timers.push(callback); },
  };
  const { watchDevelopment, message } = runInNewContext(
    source.slice(start, end).replace("\nvoid watchDevelopment();", "") + "\n({ watchDevelopment, message })", context,
  );
  const poll = async () => {
    const callback = timers.shift();
    assert.ok(callback);
    callback();
    await setImmediate();
  };
  await watchDevelopment();
  assert.equal(status.textContent, "Waiting for input.", "old reloads must not be announced on page load");
  assert.equal(bodyClasses.has("is-reloading"), false);
  reloading = true;
  await poll();
  assert.equal(bodyClasses.has("is-reloading"), true);
  assert.equal(bodyClasses.has("is-busy-visible"), true, "reload animation must not take over ordinary activity");
  reloading = false;
  reload = { ...reload, revision: 4 };
  await poll();
  assert.equal(bodyClasses.has("is-reloading"), false);
  assert.equal(bodyClasses.has("is-busy-visible"), true);
  assert.equal(status.textContent, "Hot reload complete.");
  assert.equal(errorStyle, false);
  message("Quicksaved.");
  await poll();
  assert.equal(status.textContent, "Quicksaved.", "polling must not restore a replaced notice");
  context.runGame = "other";
  reloading = true;
  reload = { ...reload, revision: 5 };
  await poll();
  assert.equal(bodyClasses.has("is-reloading"), false, "other games must not trigger the animation");
  assert.equal(status.textContent, "Quicksaved.", "reloads of other games must not overwrite the status");
  context.runGame = "fixture";
  reloading = false;
  reload = { revision: 6, status: "error", errors: [{ message: "Unclosed IF" }] };
  await poll();
  assert.equal(status.textContent, "Hot reload failed: Unclosed IF");
  assert.equal(errorStyle, true);
  reload = { revision: 7, status: "reloaded", errors: [] };
  await poll();
  assert.equal(status.textContent, "Hot reload complete.");
  assert.equal(errorStyle, false);
  assert.equal(refreshes, 0, "arbitrary dialogs must not be refreshed");
  context.qaSnapshot.refreshable = true;
  reload = { ...reload, revision: 8 };
  await poll();
  assert.equal(refreshes, 1, "idle command/shop prompts should redraw after successful reload");
  await poll();
  assert.equal(refreshes, 1, "each reload should redraw only once");
  context.busy = true;
  reload = { ...reload, revision: 9 };
  await poll();
  assert.equal(refreshes, 1, "a reload must not interrupt a submitted input or render");
  context.busy = false;
  refreshResult = false;
  reload = { ...reload, revision: 10 };
  await poll();
  assert.equal(status.textContent, "Redraw failed.", "completion must not overwrite a refresh error");
  reloading = true;
  await poll();
  assert.equal(bodyClasses.has("is-reloading"), true);
  connectionError = true;
  await poll();
  assert.equal(bodyClasses.has("is-reloading"), false, "disconnect must not leave the animation running");
});
