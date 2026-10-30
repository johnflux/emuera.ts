import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { applyHotpatches, GAME_ROOT, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type Snapshot } from "../src/runtime.js";
import { MemorySaveStore } from "../src/storage.js";
import { patchTitleImage } from "../src/render-patches.js";

function markup(snapshot: Snapshot): string {
  assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
  assert.equal(snapshot.status, "waiting");
  return snapshot.output.flatMap((item) => "text" in item ? [item.text] : []).join("\n");
}

function settle(runtime: Runtime, snapshot: Snapshot): Snapshot {
  for (let step = 0; snapshot.input?.kind === "wait"; step++) {
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    assert.ok(step < 100, "flow reaches an interactive screen");
    snapshot = runtime.input("");
  }
  return snapshot;
}

test("eraTW launch dialogs accept defaults, configure optionally and cancel safely", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const saves = new MemorySaveStore();
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { columns: 180, saves });
  const title = runtime.start();
  assert.match(markup(title), /era-launch-version/);
  assert.doesNotMatch(markup(title), /era-launch-title|eraThe World AnonTW/);
  assert.match(markup(title), /era-launch-art/);
  assert.equal(patchTitleImage(game, title).output.filter((item) => item.type === "title-image").length, 1,
    "the launch screen retains the complete original TW artwork as one cropped image");
  assert.match(markup(runtime.input("1")), /era-dialog era-load/);
  assert.match(markup(runtime.input("1002")), /Page 2 \/ 10/);
  assert.match(markup(runtime.input("1000")), /Page 1 \/ 10/);
  assert.match(markup(runtime.input("0")), /era-save-empty/);
  assert.match(markup(runtime.input("999")), /era-launch-version/);
  assert.match(markup(runtime.input("0")), /era-dialog era-setup/);
  assert.match(markup(runtime.input("701")), /Choose residence/);
  assert.match(markup(runtime.input("23")), /Animation: On/);
  assert.match(markup(runtime.input("23")), /Animation: Off/);
  assert.match(markup(runtime.input("702")), /Configure dialogue/);
  assert.match(markup(runtime.input("30")), /Some characters have alternative dialogue options/);
  assert.match(markup(runtime.input("0")), /Configure dialogue/);
  assert.match(markup(runtime.input("700")), /Customize character/);
  assert.match(markup(runtime.input("10")), /\[9999\] Finished/);
  assert.match(markup(runtime.input("9999")), /Completely finished/);
  assert.match(markup(runtime.input("0")), /Customize character/);
  assert.match(markup(runtime.input("999")), /era-launch-version/);
  assert.deepEqual(saves.list(), [], "canceling setup must not create an autosave");
  assert.match(markup(runtime.input("0")), /Start game/);
  const snapshot = settle(runtime, runtime.input("100"));
  const started = markup(snapshot);
  assert.match(started, /era-layout era-shop/, "defaults reach the normal wake-up screen");
  assert.match(started, /50,000/, "starting bonus is applied exactly once");
  assert.doesNotMatch(started, /Select Mode|Select a place to stay|Some characters have alternative dialogue options|Here some various settings/);
  assert.match(markup(settle(runtime, runtime.input("100"))), /era-room-stage/, "Wake Up reaches the main screen");

  const saved = saves.read("save99.sav");
  assert.ok(Buffer.isBuffer(saved), "new game produces a native autosave");
  saves.write("save00.sav", saved);
  const resumed = new Runtime(game, GAME_INSTRUCTION_LIMIT, { columns: 180, saves });
  resumed.start();
  const picker = markup(resumed.input("1"));
  assert.match(picker, /value='0' class='era-save-slot'/);
  assert.doesNotMatch(picker, /Select slot to save|Overwrite/);
  const loaded = settle(resumed, resumed.input("0"));
  assert.equal(loaded.error, null, JSON.stringify(loaded.error));
  assert.doesNotMatch(markup(loaded), /era-dialog era-load/, "selecting a native save leaves the picker");

  const configured = new Runtime(game, GAME_INSTRUCTION_LIMIT, { columns: 180 });
  configured.start();
  configured.input("0");
  assert.match(markup(configured.input("11")), /Select a character to play as/);
  assert.match(markup(settle(configured, configured.input("26"))), /Raise it to 2000/);
  assert.match(markup(configured.input("0")), /Be a virgin/);
  assert.match(markup(settle(configured, configured.input("0"))), /era-setup-name'>Yukari/);
  const home = markup(configured.input("701"));
  assert.doesNotMatch(home, /Hakurei Shrine/, "predefined characters retain their own home");
  assert.match(markup(configured.input("999")), /era-launch-version/);
});
