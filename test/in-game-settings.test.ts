import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { applyHotpatches, GAME_ROOT, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type Snapshot } from "../src/runtime.js";

function markup(snapshot: Snapshot): string {
  assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
  assert.equal(snapshot.status, "waiting");
  return snapshot.output.flatMap((item) => "text" in item ? [item.text] : []).join("\n");
}

test("in-game settings reuse setup controls and retain native actions", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  indexScript(game, `@TEST_SETTINGS_INIT
CALL MAKE_TALENT_MAP
CALL Name_Array_Set
CALL ADDCHARA_INIT(0)
CALL MAKE_ALL_CLASS_LIST
CALL ADD_ALL_CHARACTERS
CALL DEFAULT_OPTION
FOR LOCAL, 1, CHARANUM
	CALL KOJO_COUNT_CHECK(LOCAL)
NEXT
MAIN_MAP = 0
DAY = 1
DAY:2 = 1
DAY:3 = 1
CALL ROOMSETTING_0
CALL DEFAULT_OWNER_0
RECOLOREDMAPS = 1
ANIMATERECOLOREDMAPS = 0
@TEST_WORLD_SETTINGS
CALL TEST_SETTINGS_INIT
FLAG:1000 = 0
RESULT = 1701
CALL USERSHOP
PRINTFORML world={FLAG:甲斐性無},{FLAG:LUSTMODE},{FLAG:STABLEBYPASS},{FLAG:1000}
INPUT
QUIT
@TEST_YANDERE_SETTINGS
CALL TEST_SETTINGS_INIT
CALL CUSTOM_OPTION_RESULT_4
PRINTFORML yandere={FLAG:YANDERE_EVOLVE_CHANCE},{FLAG:YANDERE_EVENT_FREQUENCY},{YANDERE_CHANCE:0}
INPUT
QUIT
@TEST_DIALOGUE_SETTINGS
CALL TEST_SETTINGS_INIT
RESULT = 1702
CALL USERSHOP
PRINTL finished
INPUT
QUIT
@TEST_MOVE_HOME
CALL TEST_SETTINGS_INIT
CALL SET_MAINHOME
PRINTFORML home={MAIN_MAP},{引っ越し}
INPUT
QUIT`, "<settings-test>");

  const world = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  assert.match(markup(world.start("TEST_WORLD_SETTINGS")), /Romance Mode[\s\S]*Pregnancy Restrictions/);
  markup(world.input("4132"));
  markup(world.input("4142"));
  markup(world.input("4110"));
  assert.match(markup(world.input("999")), /world=2,1,1,0/);

  const yandere = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  assert.match(markup(yandere.start("TEST_YANDERE_SETTINGS")), /Yandere Settings[\s\S]*Triggers[\s\S]*Event Frequency/);
  assert.match(markup(yandere.input("4160037")), /Subtype change chance value'>37<\/button>/);
  markup(yandere.input("4410"));
  markup(yandere.input("4190042"));
  assert.match(markup(yandere.input("999")), /yandere=37,10,42/);
  const yanderePrompt = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  markup(yanderePrompt.start("TEST_YANDERE_SETTINGS"));
  assert.match(markup(yanderePrompt.input("9900")), /whole number/);
  assert.match(markup(yanderePrompt.input("23")), /Subtype change chance value'>23<\/button>/);
  markup(yanderePrompt.input("4211"));
  assert.match(markup(yanderePrompt.input("999")), /yandere=5,0,0/);

  const dialogue = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  const screen = markup(dialogue.start("TEST_DIALOGUE_SETTINGS"));
  assert.match(screen, /Dialogue Settings/);
  assert.match(screen, /era-setup-choice/);
  const option = /value='(2\d{4})' class='era-setup-choice'/.exec(screen)?.[1];
  assert.ok(option, "an alternative dialogue is available");
  let dialogueResult = markup(dialogue.input(option));
  if (dialogueResult.includes("resets the character's relationships")) {
    dialogueResult = markup(dialogue.input("0"));
    assert.match(dialogueResult, new RegExp(`value='${option}' class='era-setup-choice'`));
  } else {
    assert.match(dialogueResult, /dialogue/);
    dialogueResult = markup(dialogue.input(""));
    assert.match(dialogueResult, new RegExp(`value='${option}' class='era-setup-choice era-current'`));
  }
  assert.match(markup(dialogue.input("999")), /finished/);

  const home = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  const homeScreen = markup(home.start("TEST_MOVE_HOME"));
  assert.match(homeScreen, /era-setup-choice/);
  assert.match(homeScreen, /value='2000' class='era-setup-choice era-current'/);
  assert.match(markup(home.input("2001")), /value='2001' class='era-setup-choice era-current'/);
  assert.match(markup(home.input("1998")), /home=0,0/);
  const move = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  markup(move.start("TEST_MOVE_HOME"));
  markup(move.input("2001"));
  let result = move.input("1999");
  while (result.input?.kind === "wait") result = move.input("");
  assert.match(markup(result), /room choice/);
  result = move.input("0");
  while (result.input?.kind === "wait") result = move.input("");
  assert.match(markup(result), /home=1,0/);
});

test("dialogue changes confirm destructive resets and honor compatibility", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  game.routines.delete("HOTPATCH_SETUP_DIALOGUE_INFO");
  game.routines.delete("CHARACTER_GET_NEW_DIALOGUE");
  indexScript(game, `@HOTPATCH_SETUP_DIALOGUE_INFO(nIndex, nChoice)
#DIM DYNAMIC nIndex
#DIM DYNAMIC nChoice
RESULTS:1 = Test
RESULTS:2 = Test
RESULT:1 = FLAG:9000
RETURN 1
@CHARACTER_GET_NEW_DIALOGUE(nIndex, nChoice, nNeedsReset)
#DIM DYNAMIC nIndex
#DIM DYNAMIC nChoice
#DIM DYNAMIC nNeedsReset
FLAG:9001 = nNeedsReset + 1
CFLAG:nIndex:口上セレクタ = nChoice
PRINTFORMW Applied
@TEST_DIALOGUE_CHANGE
CALL MAKE_TALENT_MAP
CALL Name_Array_Set
CALL ADDCHARA_INIT(0)
CALL MAKE_ALL_CLASS_LIST
CALL ADD_ALL_CHARACTERS
CFLAG:1:口上実装状況 = 2
INPUT
FLAG:9000 = RESULT
CALL HOTPATCH_DIALOGUE_SETTINGS
PRINTFORML selected={CFLAG:1:口上セレクタ},called={FLAG:9001}
INPUT
QUIT`, "<dialogue-settings-test>");
  function open(compatible: boolean): Runtime {
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
    markup(runtime.start("TEST_DIALOGUE_CHANGE"));
    markup(runtime.input(compatible ? "1" : "0"));
    return runtime;
  }
  const canceled = open(false);
  assert.match(markup(canceled.input("20005")), /resets the character's relationships/);
  markup(canceled.input("0"));
  assert.match(markup(canceled.input("999")), /selected=0,called=0/);

  const reset = open(false);
  markup(reset.input("20005"));
  assert.match(markup(reset.input("1")), /Applied/);
  markup(reset.input(""));
  assert.match(markup(reset.input("999")), /selected=1,called=2/);

  const compatible = open(true);
  assert.match(markup(compatible.input("20005")), /Applied/);
  markup(compatible.input(""));
  assert.match(markup(compatible.input("999")), /selected=1,called=1/);
});

test("move-home hotpatch preserves the native flow apart from the region selector", { skip: !existsSync(GAME_ROOT) }, () => {
  const original = readFileSync(new URL("../GAMES/anon-tw-anon-tw_eng-modding/ERB/MOVEMENTS/物件関連/MAP_MANAGE.ERB", import.meta.url), "utf8");
  const native = original.slice(original.indexOf("@SET_MAINHOME\n"), original.indexOf("@HAS_DUPLICATE_KEY, ARG"));
  const patch = readFileSync(new URL("../hotpatch/MOVE_HOME.ERB", import.meta.url), "utf8");
  const start = native.indexOf("LOCAL:1 = 0\nFOR LOCAL, 0, 11\n");
  const end = native.indexOf(";-----------\nPRINT [1999]", start);
  const expected = native.slice(0, start).replace("@SET_MAINHOME\n", "@HOTPATCH_MOVE_HOME\n")
    + `HTML_PRINT "<era-open class='era-setup era-setup-editor'>"
HTML_PRINT "<era-open class='era-setup-card'>"
CALL HOTPATCH_SETUP_HOME_CHOICES
HTML_PRINT "<era-close>"
HTML_PRINT "<era-close>"
` + native.slice(end);
  assert.equal(patch.slice(patch.indexOf("@HOTPATCH_MOVE_HOME\n")).trimEnd(), expected.trimEnd());
});
