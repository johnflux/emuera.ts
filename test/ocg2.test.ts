import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { compatibility } from "../src/compatibility.js";
import { emptyGame, GAMES_DIR, indexScript, loadGame, type Game } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type Snapshot } from "../src/runtime.js";
import { MemoryGlobalStore, MemorySaveStore } from "../src/storage.js";

function game(source: string, configure?: (game: Game) => void): Game {
  const game = emptyGame();
  configure?.(game);
  indexScript(game, source, "ocg2.ERB");
  return game;
}
function text(snapshot: Snapshot): string {
  assert.notEqual(snapshot.status, "error", JSON.stringify(snapshot.error));
  return snapshot.output.filter((item) => item.type === "text").map((item) => item.text).join("\n");
}
function characters(game: Game): void {
  game.characters.set(0, { file: "Chara0.csv", rows: [["名前", "Player"], ["能力", "2", "7"]] });
  game.characters.set(5, { file: "Chara5.csv", rows: [["名前", "Companion"], ["基礎", "0", "120"]] });
}

test("ADDDEFCHARA adds template zero and the optional GameBase character, preserving CSV defaults", () => {
  for (const jit of [false, true]) {
    for (const initial of [0, 5]) {
      const result = new Runtime(game(`@SYSTEM_TITLE
RESETDATA
FOR LOCAL, 0, 4
  DELALLCHARA
  ADDDEFCHARA
NEXT
PRINTFORML {CHARANUM} {NO:0} %NAME:0% {ABL:0:2}
SIF CHARANUM > 1
  PRINTFORML {NO:1} %NAME:1% {BASE:1:0}`, (game) => {
        characters(game);
        game.tables.set("GAMEBASE", new Map([[0, ["最初からいるキャラ", String(initial)]]]));
      }), 50_000, { jit }).start();
      assert.equal(result.status, "halted", JSON.stringify(result.error));
      assert.equal(text(result), initial ? "2 0 Player 7\n5 Companion 120" : "1 0 Player 7");
    }
  }
  for (const [source, expected] of [
    ["@SYSTEM_TITLE\nADDDEFCHARA 1", /takes no arguments/],
    ["@SYSTEM_TITLE\nCALL OTHER\n@OTHER\nADDDEFCHARA", /only be used in @SYSTEM_TITLE/],
    ["@SYSTEM_TITLE\nADDDEFCHARA", /Unknown character template: 0/],
  ] as const) {
    const result = new Runtime(game(source)).start();
    assert.equal(result.status, "error");
    assert.match(result.error!.message, expected);
  }
});

test("PRINT_MARK prints named nonzero levels in index order and ends the line", () => {
  for (const jit of [false, true]) {
    const result = new Runtime(game(`@SYSTEM_TITLE
ADDCHARA 0
MARK:0:0 = 3
MARK:0:1 = 0
MARK:0:2 = -1
MARK:0:3 = 9
FOR LOCAL, 0, 4
  CALL SHOW
NEXT
VARSET MARK
PRINT_MARK 0
PRINTL after
RETURN
@SHOW
PRINT prefix:
PRINT_MARK 0`, (game) => {
      characters(game);
      game.tables.set("MARK", new Map([[0, ["First"]], [1, ["Zero"]], [2, ["Last"]], [3, [""]]]));
    }), 50_000, { jit }).start();
    assert.equal(result.status, "halted", JSON.stringify(result.error));
    assert.equal(text(result), Array(4).fill("prefix:\nFirstLV3 LastLV-1 ").join("\n") + "\n\nafter");
    assert.ok(result.output.filter((item) => item.type === "text" && item.text.startsWith("First")).every((item) => item.newline));
  }
  const invalid = new Runtime(game("@SYSTEM_TITLE\nPRINT_MARK 0")).start();
  assert.equal(invalid.status, "error");
});

test("SKIPLOG skips message waits without hiding output or changing RESULT and stops at FORCEWAIT and value input", () => {
  for (const jit of [false, true]) {
    const runtime = new Runtime(game(`@SYSTEM_TITLE
RESULT = 42
SKIPLOG 1
FOR LOCAL, 0, 4
  CALL MESSAGE
NEXT
TWAIT 100, 1
PRINTFORML {RESULT} {MESSKIP()} {ISSKIP()}
FORCEWAIT
SKIPLOG 1
INPUT
PRINTFORML {RESULT} {MESSKIP()}
SKIPLOG 1
SKIPLOG 0
PRINTW restored
RETURN
@MESSAGE
PRINTW visible
WAIT
WAITANYKEY`), 50_000, { jit });
    const forced = runtime.start();
    assert.equal(forced.input?.stopSkipping, true, JSON.stringify(forced.error));
    assert.equal(text(forced), "visible\nvisible\nvisible\nvisible\n42 1 0");
    const input = runtime.input("");
    assert.equal(input.input?.kind, "integer", JSON.stringify(input.error));
    const restored = runtime.input("7");
    assert.equal(restored.input?.kind, "wait", JSON.stringify(restored.error));
    assert.equal(text(restored), "7 0\nrestored");
    assert.equal(runtime.input("").status, "halted");
  }
  const invalid = new Runtime(game("@SYSTEM_TITLE\nSKIPLOG")).start();
  assert.equal(invalid.status, "error");
});

test("restart instructions unwind callers, reset runtime data and UI, and preserve persisted saves", () => {
  for (const jit of [false, true]) for (const op of ["QUIT_AND_RESTART", "FORCE_QUIT_AND_RESTART"]) {
    const saves = new MemorySaveStore(), store = new MemoryGlobalStore();
    const runtime = new Runtime(game(`@SYSTEM_TITLE
#DIM COUNTER
COUNTER++
PRINTFORML {COUNTER} {GLOBAL} {CHARANUM} {GCREATED(1)} {GETCOLOR()}
INPUT
GLOBAL = 8
SAVEGLOBAL
SAVEDATA 2, "kept"
ADDDEFCHARA
GCREATE 1, 10, 10
SETCOLOR 0xFF0000
FOR LOCAL, 0, 4
  CALL WARM
NEXT
CALL REBOOT
THROW caller survived restart
RETURN
@WARM
LOCAL++
RETURN
@REBOOT
SKIPDISP 1
SKIPLOG 1
${op}
THROW callee survived restart`, characters), 50_000, { jit, saves, store });
    const first = runtime.start();
    assert.equal(first.status, "waiting", JSON.stringify(first.error));
    for (let restart = 0; restart < 3; restart++) {
      const next = runtime.input("0");
      assert.equal(next.status, "waiting", JSON.stringify(next.error));
      assert.equal(text(next), text(first));
      assert.ok(next.output.some((item) => item.type === "clear"));
      assert.ok(saves.read("save02.sav"));
      assert.notEqual(store.load(), null);
    }
    const invalid = new Runtime(game(`@SYSTEM_TITLE\n${op} 1`), 50_000, { jit }).start();
    assert.equal(invalid.status, "error");
    assert.match(invalid.error!.message, /takes no arguments/);
    const infinite = new Runtime(game(`@SYSTEM_TITLE\n${op}`), 100, { jit }).start();
    assert.equal(infinite.status, "error");
    assert.match(infinite.error!.message, /Instruction limit/);
  }
});

test("prefetching across restart instructions stages writes until the player continues", () => {
  for (const op of ["QUIT_AND_RESTART", "FORCE_QUIT_AND_RESTART"]) {
    const saves = new MemorySaveStore(), store = new MemoryGlobalStore();
    const runtime = new Runtime(game(`@SYSTEM_TITLE
PRINTW title
GLOBAL = 8
SAVEGLOBAL
SAVEDATA 2, "kept"
${op}`), 50_000, { saves, store });
    const title = runtime.start();
    assert.equal(title.status, "waiting");
    assert.equal(runtime.prefetch(), true);
    assert.equal(store.load(), null);
    assert.deepEqual(saves.list(), []);
    const restarted = runtime.input("");
    assert.equal(restarted.status, "waiting", JSON.stringify(restarted.error));
    assert.equal(text(restarted), text(title));
    assert.notEqual(store.load(), null);
    assert.ok(saves.read("save02.sav"));
  }
});

const root = path.join(GAMES_DIR, "eraocg2");
test("eraOCG2 has no compatibility gaps and starts a story-mode character beyond TITLE.ERB:85", {
  skip: !existsSync(root),
}, async () => {
  const game = await loadGame(root);
  const report = compatibility(game);
  assert.deepEqual(report.gaps, []);
  assert.equal(report.recognizedInstructions, report.instructions);
  assert.equal(report.diagnosticCount, 0);
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  let snapshot = runtime.start();
  for (let waits = 0; snapshot.input?.kind === "wait" && waits < 100; waits++) {
    snapshot = snapshot.input.timeout ? runtime.timeout() : runtime.input("");
  }
  assert.equal(snapshot.input?.kind, "integer", JSON.stringify(snapshot.error));
  assert.match(text(snapshot), /开始游戏/);
  snapshot = runtime.input("0");
  assert.match(text(snapshot), /从最初开始/);
  snapshot = runtime.input("0");
  assert.match(text(snapshot), /选择模式/);
  snapshot = runtime.input("0");
  assert.equal(snapshot.input?.kind, "string", JSON.stringify(snapshot.error));
  assert.match(text(snapshot), /请输入角色的名字/);
});
