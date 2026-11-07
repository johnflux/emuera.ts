import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { applyHotpatches, GAME_ROOT, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type Snapshot } from "../src/runtime.js";

function markup(snapshot: Snapshot): string {
  assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
  assert.equal(snapshot.status, "waiting");
  return snapshot.output.flatMap((item) => "text" in item ? [item.text] : []).join("\n");
}

test("sleep farm settings reuse setup and preserve contract state", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  indexScript(game, `@TEST_FARM_SETTINGS
CALL MAKE_TALENT_MAP
CALL Name_Array_Set
CALL ADDCHARA_INIT(0)
CALL MAKE_ALL_CLASS_LIST
CALL ADD_ALL_CHARACTERS
MAIN_MAP = 0
INPUT
IF RESULT == 1 || RESULT == 2
	FLAG:地主 = 1
	FLAG:農民難易度 = 2
	FLAG:畑拡張 = 7
	FLAG:地主貸付金 = 12345
	FLAG:年始貸付金 = 45678
	FLAG:畑仕事の成果 = 73
	FLAG:返済延滞回数 = 4
	FLAG:収穫納入回数 = 5
	FLAG:累積収穫評価 = 6
	FLAG:前回収穫評価 = 7
	SIF RESULT == 2
		FLAG:地主貸付金 = 0
ENDIF
SIF RESULT == 3
	FLAG:気絶中断 = 1
RESULT = 151
CALL USERSHOP
PRINTFORML state={FLAG:地主},{FLAG:農民難易度},{FLAG:畑拡張},{FLAG:地主貸付金},{FLAG:年始貸付金},{FLAG:畑仕事の成果},{FLAG:返済延滞回数},{FLAG:収穫納入回数},{FLAG:累積収穫評価},{FLAG:前回収穫評価}
INPUT
QUIT`, "<farm-settings-test>");
  function open(scenario: number): { runtime: Runtime; screen: string } {
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
    markup(runtime.start("TEST_FARM_SETTINGS"));
    return { runtime, screen: markup(runtime.input(String(scenario))) };
  }
  const free = open(0);
  assert.match(free.screen, /Farm Settings[\s\S]*Contract Terms[\s\S]*Farming Contract/);
  const landlordAction = /value='(3\d{4})' class='era-setup-choice/.exec(free.screen)?.[1];
  assert.ok(landlordAction);
  assert.match(markup(free.runtime.input(landlordAction)), /Debt:/);
  markup(free.runtime.input("3103"));
  assert.match(markup(free.runtime.input("999")), /state=0,0,0,0,0,0,0,0,0,0/);

  const starting = open(0);
  markup(starting.runtime.input(landlordAction));
  markup(starting.runtime.input("3102"));
  const started = markup(starting.runtime.input("100"));
  const newState = /state=(\d+),2,2,(\d+),(\d+),0,0,0,0,0/.exec(started);
  assert.ok(newState, started);
  assert.equal(newState[2], newState[3]);
  assert.ok(Number(newState[2]) > 0);

  const existing = open(1);
  assert.match(existing.screen, /Cannot quit while in debt/);
  assert.match(existing.screen, /value='3000'[^>]*aria-disabled='true'/);
  markup(existing.runtime.input("3103"));
  assert.match(markup(existing.runtime.input("999")), /state=1,2,7,12345,45678,73,4,5,6,7/);

  const same = open(1);
  markup(same.runtime.input("3103"));
  assert.match(markup(same.runtime.input("100")), /state=1,3,3,12345,45678,73,4,5,6,7/);

  const switched = open(1);
  const actions = [...switched.screen.matchAll(/value='(3\d{4})' class='era-setup-choice/g)].map((match) => match[1]!);
  const other = actions.find((value) => value !== "30001");
  assert.ok(other);
  const preview = markup(switched.runtime.input(other));
  assert.match(preview, /existing debt will transfer/);
  const changed = markup(switched.runtime.input("100"));
  const transferred = /state=(\d+),1,1,(\d+),(\d+),0,0,0,0,0/.exec(changed);
  assert.ok(transferred, changed);
  assert.equal(Number(transferred[1]), Number(other) - 30000);
  assert.equal(Number(transferred[2]), Number(transferred[3]) + 12345);

  const unchanged = open(1);
  markup(unchanged.runtime.input(other));
  markup(unchanged.runtime.input("30001"));
  assert.match(markup(unchanged.runtime.input("100")), /state=1,2,7,12345,45678,73,4,5,6,7/);

  const paid = open(2);
  assert.match(paid.screen, /value='3000'[^>]*aria-disabled='false'/);
  markup(paid.runtime.input("3000"));
  assert.match(markup(paid.runtime.input("100")), /state=0,0,0,0,0,0,0,0,0,0/);

  const fainted = open(3);
  assert.doesNotMatch(fainted.screen, /Farm Settings/);
  assert.match(fainted.screen, /state=0,0,0,0,0,0,0,0,0,0/);
});
