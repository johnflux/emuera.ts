import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { compatibility } from "../src/compatibility.js";
import { loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type Snapshot } from "../src/runtime.js";
import { readNativeSave } from "../src/save-format.js";
import { MemorySaveStore } from "../src/storage.js";

const root = path.resolve("GAMES/eraAS");
const text = (snapshot: Snapshot) => snapshot.output.filter((item) => "text" in item).map((item) => item.text).join("\n");

test("eraAS has no reported gaps, starts a new game, autosaves and saves from its menu", {
  skip: !existsSync(root),
}, async () => {
  const game = await loadGame(root);
  const report = compatibility(game);
  assert.deepEqual(report.gaps, []);
  assert.equal(report.diagnosticCount, 0);
  for (const jit of [false, true]) {
    const saves = new MemorySaveStore();
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit, saves });
    let snapshot = runtime.start();
    const waiting = () => assert.equal(snapshot.status, "waiting", JSON.stringify(snapshot.error));
    const choose = (choice: string) => {
      waiting();
      snapshot = runtime.input(choice);
      let waits = 0;
      while (snapshot.status === "waiting" && snapshot.input?.kind === "wait" && waits++ < 100)
        snapshot = snapshot.input.blocking ? runtime.timeout() : runtime.input("");
      waiting();
      assert.equal(snapshot.input?.kind, "integer", "Introductory waits must finish");
    };
    waiting();
    assert.match(text(snapshot), /New Game/);
    choose("0");
    assert.match(text(snapshot), /Leave it as is/);
    choose("1");
    assert.match(text(snapshot), /\[800\].*Save/);
    const checkSave = (file: string) => {
      const saved = saves.read(file);
      assert.ok(Buffer.isBuffer(saved), file);
      const record = readNativeSave(saved);
      assert.match(record.text, /Day\s+1.*Morning.*Leader:\s+Player.*Ver0\.068/);
      assert.equal(record.data.variables.SAVEDATA_TEXT, undefined);
      assert.ok(record.data.characters > 0);
    };
    checkSave("save99.sav");
    choose("800");
    assert.match(text(snapshot), /Save Menu/);
    assert.match(text(snapshot), /\[\s*19\] ----/);
    choose("0");
    checkSave("save00.sav");
    assert.match(text(snapshot), /\[800\].*Save/);
  }
});
