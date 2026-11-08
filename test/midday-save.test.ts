import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyHotpatches, emptyGame, GAME_ROOT, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type Snapshot } from "../src/runtime.js";
import { FileSaveStore, MemorySaveStore } from "../src/storage.js";
import { readNativeSave } from "../src/save-format.js";
import { createApp } from "../src/server.js";
import { readSuspend, writeSuspend } from "../src/suspend-format.js";
import { EraError } from "../src/model.js";
import { DataTables } from "../src/data-tables.js";

function fixture() {
  const game = emptyGame();
  game.variableSizes.set("CFLAG", [10000]);
  game.names.set("CFLAG", new Map([["現在位置", 0], ["好感度", 2], ["信頼度", 4]]));
  game.containers.SAVE.MAPS.add("m");
  game.containers.SAVE.XMLS.add("doc");
  game.containers.SAVE.DTS.add("db");
  indexScript(game, "#DIM TEMP\n#DIMS LABEL", "midday.ERH", true);
  indexScript(game, `@SYSTEM_TITLE
ADDVOIDCHARA
CALLNAME:0 = Player
TEMP = 42
LABEL = unchanged
MAP_CREATE "m"
MAP_SET "m", "key", "value"
XML_DOCUMENT "doc", "<r><item>kept</item></r>"
DT_CREATE "db"
DT_ROW_ADD "db"
GCREATE 5, 12, 7
BEGIN TRAIN
@EVENTTRAIN
DAY += 1
TIME = 720
TFLAG:1 = 77
FLAG:70 = 1
TCVAR:0:1 = 23
TEQUIP:0:1 = 24
PALAM:0:1 = 25
@SHOW_STATUS
FLAG:1 += 1
CALL COUNTER
PRINTFORML main {DAY} {TIME} {TFLAG:1} {FLAG:1}
@SHOW_USERCOM
PRINTL commands
@USERCOM
LOCAL = RESULT
PRINTFORML restored {DAY} {TIME} {TFLAG:1} {TCVAR:0:1} {TEQUIP:0:1} {PALAM:0:1} {TEMP} %LABEL% %MAP_GET("m", "key")% %XML_TOSTR("doc")% {DT_ROW_LENGTH("db")}
CALL COUNTER
TEMP += 1
TIME += 5
SAVEDATA 0, "native unaffected"
SIF LOCAL == 999
  WAIT
@COUNTER
#DIM nCalls
nCalls += 1
PRINTFORML static {nCalls}
@EVENTLOAD
FLAG:99 += 1
@SHOW_SHOP
PRINTL unexpected morning shop
INPUT
@HOTPATCH_TARGET_DATAGROUP
@KOJO_MESSAGE_SEND
@TRAINNAME_TR
#FUNCTIONS
RETURNF ""`, "midday.ERB");
  return game;
}

function healthy(snapshot: Snapshot): Snapshot {
  assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
  assert.equal(snapshot.status, "waiting");
  return snapshot;
}
function settle(runtime: Runtime, snapshot: Snapshot): Snapshot {
  for (let i = 0; snapshot.input?.kind === "wait"; i++) {
    assert.ok(i < 100, "returns to a command screen");
    snapshot = healthy(runtime.input(""));
  }
  return healthy(snapshot);
}

test("TW midday loads game data and temporary stats, runs load hooks and rebuilds the screen without starting a day", () => {
  const game = fixture();
  const saves = new MemorySaveStore();
  const original = new Runtime(game, 50_000, { saves });
  const first = healthy(original.start());
  assert.equal(first.midday?.available, true);
  const bytes = original.exportMidday();
  const restored = new Runtime(game, 50_000, { saves });
  const prompt = healthy(restored.restoreMidday(bytes));
  assert.match(JSON.stringify(prompt.output), /main 1 720 77 2/, "status display reruns");
  assert.doesNotMatch(JSON.stringify(prompt.output), /morning shop/);
  assert.equal(prompt.midday?.available, true);
  assert.equal(prompt.timeStopped, true);
  assert.equal(restored.captureMidday().data.variables.FLAG["99"], "1", "EVENTLOAD runs");
  assert.equal(restored.captureMidday().data.variables.TEMP, undefined, "unsaved declarations are not frozen");
  assert.equal("statics" in restored.captureMidday(), false);
  assert.equal("fields" in restored.captureMidday(), false);
  const actual = healthy(restored.input("900"));
  assert.match(JSON.stringify(actual.output), /restored 1 720 77 23 24 25 0  value <r><item>kept<\/item><\/r> 1/);
  assert.match(JSON.stringify(actual.output), /static 2/);
  const native = saves.read("save00.sav");
  assert.ok(Buffer.isBuffer(native));
  assert.equal(readNativeSave(native).text, "native unaffected");
  assert.throws(() => restored.restoreMidday(bytes), /new runtime/);
});

test("midday saves reject other games, ongoing events and incompatible or damaged state", () => {
  const other = new Runtime(emptyGame());
  assert.equal(other.middaySupported, false);
  assert.throws(() => other.exportMidday(), /main command screen/);
  const game = fixture();
  const original = new Runtime(game);
  original.start();
  const bytes = original.exportMidday();
  const damaged = Buffer.from(bytes);
  damaged[damaged.length - 1] ^= 1;
  assert.throws(() => new Runtime(game).restoreMidday(damaged), /damaged/);
  assert.throws(() => new Runtime(game).restoreMidday(Buffer.from("not a save")), /Unsupported/);
  const state = original.captureMidday();
  assert.throws(() => new Runtime(game).restoreMidday(writeSuspend({ ...state, code: "12345" })), /Midday save:/);
  assert.throws(() => new Runtime(game).restoreMidday(writeSuspend({ ...state, data: { ...state.data, characters: -1 } })), /character count/);
  indexScript(game, "@WAITING\nWAIT\nINPUT", "wait.ERB");
  const waiting = new Runtime(game);
  healthy(waiting.start("WAITING"));
  assert.equal(waiting.canSaveMidday, false);
  waiting.prefetch();
  assert.equal(waiting.canSaveMidday, false);
  const eventGame = fixture();
  const event = new Runtime(eventGame);
  healthy(event.start());
  assert.equal(healthy(event.input("999")).input?.kind, "wait");
  assert.equal(event.canSaveMidday, false, "a wait inside USERCOM is not a safe continuation point");
  assert.throws(() => event.exportMidday(), /main command screen/);
});

test("midday saves tolerate script, CSV, display and debug changes and use current variable layouts", () => {
  const game = fixture();
  indexScript(game, "#DIM SAVEDATA KEPT, 3\n#DIM SAVEDATA REMOVED", "saved.ERH", true);
  const original = new Runtime(game);
  healthy(original.start());
  const state = original.captureMidday();
  state.data.variables.KEPT = { "0": "42", "2": "99" };
  state.data.variables.REMOVED = { "0": "8" };
  const changed = fixture();
  changed.config.set("FontSize", "24");
  changed.debug = true;
  changed.tables.set("STR", new Map([[0, ["new CSV text"]]]));
  const temp = changed.headers.find(line => line.text === "#DIM TEMP");
  assert.ok(temp);
  temp.text = "#DIM TEMP = 9";
  indexScript(changed, "#DIM SAVEDATA KEPT, 2\n#DIM SAVEDATA ADDED = 7", "saved.ERH", true);
  changed.routines.delete("SHOW_STATUS");
  indexScript(changed, `@SHOW_STATUS
PRINTFORML edited screen {DAY} {TIME} {TFLAG:1} {KEPT:0} {TEMP} {ADDED} %STR:0%
@NEW_ROUTINE
PRINTL new dialogue`, "edited.ERB");
  const restored = new Runtime(changed);
  const prompt = healthy(restored.restoreMidday(writeSuspend(state)));
  assert.match(JSON.stringify(prompt.output), /edited screen 1 720 77 42 9 7 new CSV text/);
  assert.equal(restored.captureMidday().data.variables.KEPT["2"], undefined, "out-of-shape values use native load rules");
  assert.equal(restored.captureMidday().data.variables.REMOVED, undefined);
});

test("old frozen midday saves recover game data even when their script fingerprint differs", () => {
  const game = fixture();
  const original = new Runtime(game);
  healthy(original.start());
  const saved = original.captureMidday();
  const globals = Runtime.createGlobals(game);
  globals.addCharacter();
  globals.seed("DAY", 0, 4n);
  globals.seed("TIME", 0, 1000n);
  globals.seed("TFLAG", 1, 77n);
  globals.seed("NEXTCOM", 0, -1n);
  const legacy = writeSuspend({ game: "obsolete fingerprint", globals: globals.suspendState(),
    dataTables: new DataTables().suspendState(), xmls: [],
    history: saved.history, fields: { maps: new Map() } });
  Buffer.from("ERA-TW-SUSPEND-1\n").copy(legacy);
  const restored = new Runtime(fixture());
  const prompt = healthy(restored.restoreMidday(legacy));
  assert.match(JSON.stringify(prompt.output), /main 4 1000 77 1/);
  assert.equal(restored.canSaveMidday, true);
});

test("restored TRAIN menus recompute changed commands and keep unavailable entries in their mapping", () => {
  const game = fixture();
  game.tables.set("TRAIN", new Map([[2, ["Unavailable"]], [45, ["Mapped command"]]]));
  indexScript(game, `@COM_ABLE2
RETURN 0
@COM_ABLE45
RETURN 1
@COM45
PRINTL ran mapped command 45
RETURN 0`, "commands.ERB");
  const original = new Runtime(game);
  healthy(original.start());
  const bytes = original.exportMidday();
  game.tables.get("TRAIN")!.set(6, ["New command"]);
  indexScript(game, `@COM_ABLE6
RETURN 1
@COM6
PRINTL ran new command 6
RETURN 0`, "new-command.ERB");
  const restored = new Runtime(game);
  const prompt = healthy(restored.restoreMidday(bytes));
  assert.match(JSON.stringify(prompt.output), /New command/);
  const expected = healthy(original.input("1"));
  const actual = healthy(restored.input("1"));
  assert.match(JSON.stringify(expected.output), /ran mapped command 45/);
  assert.match(JSON.stringify(actual.output), /ran new command 6/);
});

test("midday API persists through server restart, rebuilds the view, and rejects stale requests", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "era-midday-"));
  const saves = new FileSaveStore(directory);
  const serve = async () => {
    const app = createApp([{ id: "tw", title: "TW fixture", game: fixture(), saves }]);
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    const post = (route: string, data: unknown) => fetch(`http://127.0.0.1:${address.port}${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    const close = async () => {
      app.closeAllConnections();
      await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
    };
    return { post, close };
  };
  let server = await serve();
  try {
    const start = await (await server.post("/api/start", { mode: "game", game: "tw" })).json();
    assert.equal(start.midday.available, true);
    const request = { session: start.session, step: start.step };
    assert.equal((await server.post("/api/midday/load", request)).status, 404);
    assert.equal((await server.post("/api/midday/save", { ...request, step: 0 })).status, 409);
    assert.equal((await server.post("/api/midday/save", request)).status, 200);
    assert.ok(Buffer.isBuffer(saves.read("midday.erasuspend")));
    const expected = await (await server.post("/api/input", { ...request, value: "900" })).json();
    assert.equal(expected.status, "waiting", JSON.stringify(expected.error));
    await server.close();
    server = await serve();
    const fresh = await (await server.post("/api/start", { mode: "game", game: "tw" })).json();
    const loaded = await (await server.post("/api/midday/load", { session: fresh.session, step: fresh.step })).json();
    assert.equal(typeof loaded.session, "string");
    const view = await (await server.post("/api/resume", { session: loaded.session })).json();
    assert.match(JSON.stringify(view.history[0].snapshot.output), /main 1 720 77 2/);
    const next = await (await server.post("/api/input", { session: loaded.session, step: view.step, value: "900" })).json();
    assert.equal(next.status, "waiting", JSON.stringify(next.error));
    assert.match(JSON.stringify(next.output), /restored 1 720 77 23 24 25/);
    assert.equal((await server.post("/api/input", { session: fresh.session, value: "900" })).status, 404);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("installed TW rebuilds a real midday prompt without advancing day or time", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const saves = new MemorySaveStore();
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { saves });
  healthy(runtime.start());
  healthy(runtime.input("0"));
  settle(runtime, runtime.input("100"));
  settle(runtime, runtime.input("100"));
  assert.equal(runtime.canSaveMidday, true);
  const bytes = runtime.exportMidday();
  const reloadedGame = await loadGame();
  await applyHotpatches(reloadedGame);
  indexScript(reloadedGame, "@MIDDAY_EDIT_TEST\nPRINTL updated dialogue", "development-edit.ERB");
  const restored = new Runtime(reloadedGame, GAME_INSTRUCTION_LIMIT, { saves });
  settle(restored, restored.restoreMidday(bytes));
  assert.equal(restored.canSaveMidday, true);
  assert.deepEqual(restored.captureMidday().data.variables.DAY, runtime.captureMidday().data.variables.DAY);
  assert.deepEqual(restored.captureMidday().data.variables.TIME, runtime.captureMidday().data.variables.TIME);
  const expected = settle(runtime, runtime.input("3001"));
  const actual = settle(restored, restored.input("3001"));
  assert.equal(actual.midday?.available, true);
  assert.equal(expected.midday?.available, true);
});

test("automatic quicksave checks the exact four-minute deadline on entering a safe prompt and counts all saves", async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const logs = t.mock.method(console, "log", () => {});
  const saves = new MemorySaveStore();
  const app = createApp([{ id: "tw", title: "TW", game: fixture(), saves }]);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  const post = async (route: string, data: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    let snapshot = await post("/api/start", { mode: "game", game: "tw" });
    const refresh = async () => snapshot = await post("/api/refresh", { session: snapshot.session, step: snapshot.step });
    const savedStatus = async () => {
      assert.equal(snapshot.quicksavePending, true, "prompt is delivered without waiting for the worker");
      assert.deepEqual(await post("/api/quicksave/status", { session: snapshot.session }), { error: null });
    };
    assert.equal(saves.read("midday.erasuspend"), null, "no save on first entry");
    now += 239_999;
    await refresh();
    assert.equal(saves.read("midday.erasuspend"), null, "four minutes minus one millisecond is not due");
    now += 1;
    await refresh();
    await savedStatus();
    assert.equal(logs.mock.callCount(), 2);
    assert.equal(logs.mock.calls[0].arguments[0], "[era quicksave] started");
    const [message, timing] = logs.mock.calls[1].arguments;
    assert.equal(message, "[era quicksave] completed");
    assert.equal(timing.game, "tw");
    assert.equal(timing.step, snapshot.step);
    assert.equal(timing.trigger, "automatic");
    for (const key of ["captureMs", "encodeMs", "writeMs", "totalMs"])
      assert.ok(Number.isFinite(timing[key]) && timing[key] >= 0, key);
    assert.ok(Buffer.isBuffer(saves.read("midday.erasuspend")));
    assert.equal(timing.bytes, (saves.read("midday.erasuspend") as Buffer).length);
    assert.equal(saves.modified("midday.erasuspend"), now);
    const saved = readSuspend<{ runtime: Buffer; view?: unknown }>(saves.read("midday.erasuspend") as Buffer);
    assert.equal(saved.view, undefined, "automatic save does not freeze the renderer");
    const captured = readSuspend<ReturnType<Runtime["captureMidday"]>>(saved.runtime);
    assert.equal(captured.data.variables.TFLAG["1"], "77");
    now += 239_999;
    await refresh();
    assert.equal(saves.modified("midday.erasuspend"), now - 239_999);
    await post("/api/midday/save", { session: snapshot.session, step: snapshot.step });
    assert.equal(logs.mock.calls.at(-1)!.arguments[1].trigger, "manual");
    const manualTime = now;
    now += 1;
    await refresh();
    assert.equal(saves.modified("midday.erasuspend"), manualTime, "manual quicksave resets the deadline");
    now += 239_998;
    saves.write("save12.sav", Buffer.from("native timestamp fixture"));
    const nativeTime = now;
    now += 1;
    await refresh();
    assert.equal(saves.modified("midday.erasuspend"), manualTime, "native saving also resets the deadline");
    now = nativeTime + 240_000;
    await refresh();
    await savedStatus();
    assert.equal(saves.modified("midday.erasuspend"), now);
    const beforeIdle = saves.modified("midday.erasuspend");
    now += 240_000;
    await post("/api/resume", { session: snapshot.session });
    assert.equal(saves.modified("midday.erasuspend"), beforeIdle, "view replay does not trigger a save");
    await refresh();
    await savedStatus();
    assert.equal(saves.modified("midday.erasuspend"), now);
  } finally {
    app.closeAllConnections();
    await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
  }
});

test("automatic quicksave waits through events and reports write failures without resetting its deadline", async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const errors = t.mock.method(console, "error", () => {});
  const logs = t.mock.method(console, "log", () => {});
  class FailingSaves extends MemorySaveStore {
    failing = true;
    override write(name: string, data: string | Buffer): void {
      if (name === "midday.erasuspend" && this.failing) throw new EraError("Disk full");
      super.write(name, data);
    }
  }
  const saves = new FailingSaves();
  const game = fixture();
  indexScript(game, "@WAIT_TITLE\nADDVOIDCHARA\nCALLNAME:0 = Player\nWAIT\nBEGIN TRAIN", "wait-title.ERB");
  // A real title wait is needed to verify that a passed deadline alone cannot save an event stack.
  game.routines.set("SYSTEM_TITLE", game.routines.get("WAIT_TITLE")!);
  const app = createApp([{ id: "tw", title: "TW", game, saves }]);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  const post = async (route: string, data: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    let snapshot = await post("/api/start", { mode: "game", game: "tw" });
    now += 240_000;
    await post("/api/resume", { session: snapshot.session });
    assert.equal(saves.read("midday.erasuspend"), null, "cannot save an event wait");
    snapshot = await post("/api/input", { session: snapshot.session, step: snapshot.step, value: "" });
    assert.equal(snapshot.quicksavePending, true);
    assert.deepEqual(await post("/api/quicksave/status", { session: snapshot.session }), { error: "Disk full" });
    assert.equal(snapshot.status, "waiting", "save failure does not end the game");
    assert.equal(errors.mock.callCount(), 1);
    assert.equal(logs.mock.callCount(), 1, "failed save has no completion log");
    assert.equal(logs.mock.calls[0].arguments[0], "[era quicksave] started");
    saves.failing = false;
    snapshot = await post("/api/refresh", { session: snapshot.session, step: snapshot.step });
    assert.deepEqual(await post("/api/quicksave/status", { session: snapshot.session }), { error: null });
    assert.equal(snapshot.quicksaveError, undefined);
    assert.ok(Buffer.isBuffer(saves.read("midday.erasuspend")), "next safe entry retries at the original deadline");
    assert.equal(logs.mock.calls.at(-1)!.arguments[0], "[era quicksave] completed");
  } finally {
    app.closeAllConnections();
    await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
  }
});

test("automatic disk quicksave discards its temporary file when a native save wins the race", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const directory = await mkdtemp(path.join(tmpdir(), "era-quicksave-race-"));
  const saves = new FileSaveStore(directory);
  const messages: string[] = [];
  t.mock.method(console, "log", (message: string) => {
    messages.push(message);
    if (message === "[era quicksave] started") saves.write("save00.sav", Buffer.from("new native save"));
  });
  const app = createApp([{ id: "tw", title: "TW", game: fixture(), saves }]);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  const post = async (route: string, data: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const start = await post("/api/start", { mode: "game", game: "tw" });
    now += 240_000;
    const prompt = await post("/api/refresh", { session: start.session, step: start.step });
    assert.equal(prompt.quicksavePending, true);
    assert.deepEqual(await post("/api/quicksave/status", { session: start.session }), { error: null });
    assert.equal(saves.read("save00.sav")!.toString(), "new native save");
    assert.equal(saves.read("midday.erasuspend"), null);
    assert.deepEqual(await readdir(directory), ["save00.sav"], "superseded temporary file is removed");
    assert.ok(messages.includes("[era quicksave] skipped (newer save)"));
    assert.ok(!messages.includes("[era quicksave] completed"));
  } finally {
    app.closeAllConnections();
    await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("same-timestamp writes invalidate a captured automatic save but history writes do not", (t) => {
  t.mock.method(Date, "now", () => 1_000_000);
  const saves = new MemorySaveStore();
  saves.write("save00.sav", Buffer.from("old"));
  const revision = saves.revision;
  saves.write("save00.sav", Buffer.from("new"));
  assert.equal(saves.revision, revision + 1);
  saves.write("history.json", "{}");
  assert.equal(saves.revision, revision + 1, "unrelated history writes cannot starve autosave");
});

test("manual quicksave waits for automatic completion and keeps the latest prompt state", async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const logs = t.mock.method(console, "log", () => {});
  const saves = new MemorySaveStore();
  const game = fixture();
  indexScript(game, "@WORKER_USERCOM\nTIME += 5", "no-native-save.ERB");
  game.routines.set("USERCOM", game.routines.get("WORKER_USERCOM")!);
  const app = createApp([{ id: "tw", title: "TW", game, saves }]);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  const post = async (route: string, data: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    let prompt = await post("/api/start", { mode: "game", game: "tw" });
    now += 240_000;
    prompt = await post("/api/refresh", { session: prompt.session, step: prompt.step });
    assert.equal(prompt.quicksavePending, true);
    prompt = await post("/api/input", { session: prompt.session, step: prompt.step, value: "900" });
    await post("/api/midday/save", { session: prompt.session, step: prompt.step });
    const completions = logs.mock.calls.filter(call => call.arguments[0] === "[era quicksave] completed");
    assert.deepEqual(completions.map(call => call.arguments[1].trigger), ["automatic", "manual"]);
    const saved = readSuspend<{ runtime: Buffer }>(saves.read("midday.erasuspend") as Buffer);
    assert.equal(readSuspend<ReturnType<Runtime["captureMidday"]>>(saved.runtime).data.variables.TIME["0"], "725");
  } finally {
    app.closeAllConnections();
    await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
  }
});
