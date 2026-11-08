import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { emptyGame, indexScript } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";
import { createApp } from "../src/server.js";
import { FileSaveStore, latestGameSave, MemorySaveStore, MIDDAY_FILE } from "../src/storage.js";

class TimedSaves extends MemorySaveStore {
  readonly times = new Map<string, number>();
  override modified(name: string): number | null {
    return this.read(name) === null ? null : this.times.get(name) ?? 0;
  }
}

function fixture() {
  const game = emptyGame();
  game.names.set("CFLAG", new Map([["現在位置", 0], ["好感度", 2], ["信頼度", 4]]));
  indexScript(game, `@SYSTEM_TITLE
HTML_PRINT "<div class='era-launch-actions'><button value='2' class='era-launch-continue' aria-disabled='true'>Continue</button><button value='0'>New game</button></div>"
INPUT
@NATIVE
DAY = 3
TIME = 600
SAVEDATA 2, "earlier slot"
DAY = 5
TIME = 900
SAVEDATA 99, "later autosave"
QUIT
@PLAY
ADDVOIDCHARA
CALLNAME:0 = Player
DAY = 8
TIME = 1200
BEGIN TRAIN
@EVENTTRAIN
TFLAG:1 = 42
@SHOW_STATUS
PRINTFORML midday {DAY} {TIME} {TFLAG:1}
@SHOW_USERCOM
@USERCOM
TIME += 10
@EVENTLOAD
FLAG:99 += 1
@SHOW_SHOP
PRINTFORML native {DAY} {TIME} hooks {FLAG:99}
@USERSHOP
@HOTPATCH_TARGET_DATAGROUP
@KOJO_MESSAGE_SEND
@TRAINNAME_TR
#FUNCTIONS
RETURNF ""`, "continue.ERB");
  return game;
}

test("Continue selects the newest native save, uses a strictly newer midday save, and ignores non-game files", () => {
  const saves = new TimedSaves();
  assert.equal(latestGameSave(saves, true), null);
  for (const name of ["global.sav", "chara_1.dat", "unrelated.sav", "history.json"]) {
    saves.write(name, "");
    saves.times.set(name, 100);
  }
  assert.equal(latestGameSave(saves, true), null);
  saves.write("save00.sav", "");
  saves.write("SAVE99.SAV", "");
  saves.times.set("save00.sav", 10);
  saves.times.set("SAVE99.SAV", 20);
  assert.deepEqual(latestGameSave(saves, true), { name: "SAVE99.SAV", kind: "native", modified: 20 });
  saves.write(MIDDAY_FILE, Buffer.from(""));
  saves.times.set(MIDDAY_FILE, 19);
  assert.equal(latestGameSave(saves, true)?.kind, "native");
  saves.times.set(MIDDAY_FILE, 20);
  assert.equal(latestGameSave(saves, true)?.kind, "native", "equal timestamps prefer native");
  saves.times.set(MIDDAY_FILE, 21);
  assert.equal(latestGameSave(saves, true)?.kind, "midday");
  assert.equal(latestGameSave(saves, false)?.kind, "native", "other games cannot load TW midday state");
  saves.remove("save00.sav");
  saves.remove("SAVE99.SAV");
  assert.equal(latestGameSave(saves, true)?.kind, "midday");
  assert.equal(latestGameSave(saves, false), null);
});

test("file modification timestamps survive store recreation and case-insensitive lookup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "era-continue-"));
  try {
    const saves = new FileSaveStore(directory);
    assert.equal(saves.modified("missing.sav"), null);
    saves.write("SAVE01.SAV", Buffer.from("native"));
    saves.write(MIDDAY_FILE, Buffer.from("midday"));
    await utimes(path.join(directory, "SAVE01.SAV"), 100, 100);
    await utimes(path.join(directory, MIDDAY_FILE), 101, 101);
    const restored = new FileSaveStore(directory);
    assert.equal(restored.modified("save01.sav"), 100_000);
    assert.equal(latestGameSave(restored, true)?.kind, "midday");
    await utimes(path.join(directory, "SAVE01.SAV"), 102, 102);
    assert.equal(latestGameSave(restored, true)?.kind, "native");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Continue API disables empty titles, loads the newest native slot, and chooses midday only when newer", async (t) => {
  t.mock.method(Date, "now", () => 1000);
  const saves = new TimedSaves();
  const game = fixture();
  const app = createApp([{ id: "tw", title: "TW", game, saves }]);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  const post = (route: string, data: unknown) => fetch(`http://127.0.0.1:${address.port}${route}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  const start = async () => {
    const title = await (await post("/api/start", { mode: "game", game: "tw" })).json();
    assert.equal(title.status, "waiting", JSON.stringify(title.error));
    return title;
  };
  const continueTitle = (title: { session: string; step: number }) => post("/api/continue", { session: title.session, step: title.step });
  try {
    const empty = await start();
    assert.equal(empty.continueAvailable, false);
    assert.equal((await continueTitle(empty)).status, 404);
    const nativeRuntime = new Runtime(game, 50_000, { saves });
    assert.equal(nativeRuntime.start("NATIVE").error, null);
    saves.times.set("save02.sav", 10);
    saves.times.set("save99.sav", 20);
    const title = await start();
    assert.equal(title.continueAvailable, true);
    assert.equal((await post("/api/continue", { session: title.session, step: 0 })).status, 409);
    const continued = await (await continueTitle(title)).json();
    assert.equal(continued.status, "waiting", JSON.stringify(continued.error));
    assert.match(JSON.stringify(continued.output), /native 5 900 hooks 1/);
    const view = await (await post("/api/resume", { session: continued.session })).json();
    assert.deepEqual(view.history[0].snapshot.output, continued.output);
    assert.equal((await post("/api/continue", { session: continued.session, step: continued.step })).status, 400);
    const playTitle = await start();
    // The midday route retains the same loaded game, while the fixture starts TRAIN directly.
    const play = new Runtime(game, 50_000, { saves });
    const middayState = play.start("PLAY");
    assert.equal(middayState.midday?.available, true);
    const { writeSuspend } = await import("../src/suspend-format.js");
    saves.write(MIDDAY_FILE, writeSuspend({ game: "tw", debug: false, runtime: play.exportMidday() }));
    saves.times.set(MIDDAY_FILE, 19);
    const olderMidday = await (await continueTitle(playTitle)).json();
    assert.match(JSON.stringify(olderMidday.output), /native 5 900 hooks 1/);
    saves.times.set(MIDDAY_FILE, 20);
    const tied = await (await continueTitle(await start())).json();
    assert.match(JSON.stringify(tied.output), /native 5 900 hooks 1/);
    saves.times.set(MIDDAY_FILE, 21);
    const newer = await (await continueTitle(await start())).json();
    const midday = await (await post("/api/resume", { session: newer.session })).json();
    assert.match(JSON.stringify(midday.history), /midday 8 1200 42/);
    assert.doesNotMatch(JSON.stringify(midday.history), /native/);
    saves.remove("save02.sav");
    saves.remove("save99.sav");
    const middayOnly = await start();
    assert.equal(middayOnly.continueAvailable, true);
    assert.equal((await continueTitle(middayOnly)).status, 200);
    saves.write(MIDDAY_FILE, Buffer.from("broken"));
    const corruptTitle = await start();
    assert.equal((await continueTitle(corruptTitle)).status, 400, "bad newest saves report an error instead of silent fallback");
    const stillTitle = await (await post("/api/resume", { session: corruptTitle.session })).json();
    assert.equal(stillTitle.history.at(-1).snapshot.continueAvailable, true, "a failed load leaves the title available");
    saves.remove(MIDDAY_FILE);
    saves.write("save00.sav", Buffer.from("broken native"));
    const badNative = await start();
    assert.equal((await continueTitle(badNative)).status, 400);
    assert.equal((await post("/api/resume", { session: badNative.session })).status, 200);
  } finally {
    app.closeAllConnections();
    await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
  }
});
