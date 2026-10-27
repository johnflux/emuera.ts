import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { compatibility } from "../src/compatibility.js";
import { loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type Snapshot } from "../src/runtime.js";
import { MemoryGlobalStore, MemorySaveStore } from "../src/storage.js";
import { readNativeSave } from "../src/save-format.js";

const root = path.resolve("GAMES/eratohoreverse");
const text = (snapshot: Snapshot) => snapshot.output.filter((item) => "text" in item).map((item) => item.text).join("\n");

test("Reverse boots, saves its character template and game, selects a trainer and runs several training turns", {
  skip: !existsSync(root),
}, async () => {
  const game = await loadGame(root);
  assert.deepEqual(compatibility(game).gaps, []);
  const saves = new MemorySaveStore();
  const store = new MemoryGlobalStore();
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { saves, store });
  let snapshot = runtime.start();
  const waiting = () => assert.equal(snapshot.status, "waiting", JSON.stringify(snapshot.error));
  const choose = (choice: string) => {
    waiting();
    snapshot = runtime.input(choice);
    let waits = 0;
    while (snapshot.status === "waiting" && snapshot.input?.kind === "wait" && waits++ < 400)
      snapshot = snapshot.input.blocking ? runtime.timeout() : runtime.input("");
    waiting();
    assert.notEqual(snapshot.input?.kind, "wait", "Introductory animation must finish");
  };
  waiting();
  assert.match(text(snapshot), /eratohoЯeverse/);
  assert.match(text(snapshot), /value='0'/);
  assert.equal(snapshot.output.filter((item) => item.type === "html" && /rev000\d{2}/.test(item.text)).length, 41);
  choose("0");
  assert.match(text(snapshot), /Select The Game Mode/);
  choose("0");
  assert.match(text(snapshot), /Male/);
  choose("0");
  choose("0");
  choose("0");
  assert.equal(snapshot.input?.kind, "string");
  choose("Tester");
  choose("0");
  choose("0");
  for (let i = 0; i < 10; i++) choose("0");
  assert.match(text(snapshot), /save this character/);
  choose("0");
  assert.match(text(snapshot), /ＥＭＰＴＹ/);
  choose("0");
  assert.match(store.load()!.GLOBALS!["0"]!, /Tester/);
  choose("99");
  choose("0");
  assert.equal(snapshot.input?.kind, "string");
  choose("1");
  assert.match(text(snapshot), /Are you sure/);
  choose("1");
  assert.match(text(snapshot), /Apply configuration/);
  choose("1");
  assert.match(text(snapshot), /value='100'/);
  assert.match(text(snapshot), /value='200'/);
  choose("200");
  choose("0");
  const saved = saves.read("save00.sav");
  assert.ok(Buffer.isBuffer(saved));
  assert.ok(Object.values(readNativeSave(saved).data.variables.NAME ?? {}).includes("Tester"));
  assert.match(text(snapshot), /value='100'/);
  choose("100");
  assert.match(text(snapshot), /\[88\] Apply/);
  choose("88");
  assert.match(text(snapshot), /Training Log\[800\]/);
  choose("0");
  assert.match(text(snapshot), /Training Log\[800\]/);
  for (let turn = 0; turn < 5; turn++) {
    choose("0");
    assert.match(text(snapshot), /Training Log\[800\]/);
  }
});
