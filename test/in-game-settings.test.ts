import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { applyHotpatches, GAME_ROOT, gameDirectory, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type Snapshot } from "../src/runtime.js";
import { readNativeSave } from "../src/save-format.js";
import { MemorySaveStore } from "../src/storage.js";

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
@TEST_CONFIG
CALL TEST_SETTINGS_INIT
FLAG:妊娠スイッチ = 0
CALL OPTION(1)
PRINTFORML config={FLAG:妊娠スイッチ},{FLAG:子供の性別},{nGoOutEventLimit}
INPUT
QUIT
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
QUIT
@TEST_SLEEP_COLORS
CALL TEST_SETTINGS_INIT
TIME:3 = 420
SETCOLOR C_YELLOW
CALL SHOW_SHOP
PRINTFORML color={GETCOLOR()},{GETDEFCOLOR()}
INPUT
CALL SHOW_SHOP
PRINTFORML color={GETCOLOR()},{GETDEFCOLOR()}
INPUT
CALL OPTION
PRINTL finished
INPUT
QUIT`, "<settings-test>");

  const config = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  const configSnapshot = config.start("TEST_CONFIG");
  const configScreen = markup(configSnapshot);
  assert.match(configScreen, /era-config[\s\S]*Select An Option/);
  assert.match(configScreen, /Rerun the New Game setup[\s\S]*Caution - You may lose progress/);
  assert.equal((configScreen.match(/value='1467' class='era-config-stars'/g) ?? []).length, 2);
  for (const value of [8, 9, 10, 13, 14, 20, 29, 30, 33, 93]) {
    assert.doesNotMatch(configScreen, new RegExp(`value='${value}'`));
    assert.ok(!configSnapshot.input?.buttonValues?.includes(String(value)));
  }
  assert.match(configScreen, /value='1' class='era-button era-button-list era-config-hidden'[^>]* aria-disabled='true'/,
    "pregnancy-dependent settings reserve invisible space");
  assert.doesNotMatch(configScreen, /title='[^']+'/);
  assert.match(markup(config.input("1")), /value='1' class='era-button era-button-list era-config-hidden'/,
    "hidden settings cannot be activated");
  const enabledScreen = markup(config.input("0"));
  assert.match(enabledScreen, /value='1' class='era-button era-button-list '[^>]* aria-disabled='false'/,
    "dependent settings appear after toggling pregnancy");
  assert.equal((configScreen.match(/era-config-label/g) ?? []).length, (enabledScreen.match(/era-config-label/g) ?? []).length,
    "toggling keeps the same rows");
  markup(config.input("1"));
  const moddedScreen = markup(config.input("100"));
  assert.match(moddedScreen, /Major features[\s\S]*Minor features[\s\S]*Sex and character-related/);
  assert.doesNotMatch(moddedScreen, /title='[^']+'/);
  assert.doesNotMatch(moddedScreen, /UI elements|value='3\d\d'/);
  assert.match(moddedScreen, /era-config-label[^]*Yandere options/);
  assert.match(moddedScreen, /This can also be set for individual characters/);
  assert.match(moddedScreen, /This only applies while time is not actively stopped/);
  assert.match(moddedScreen, /value='1' class='era-button era-button-list '[^>]* aria-disabled='true'/);
  const initialModState = /value='102'[^]*?<span class='era-config-state'>(.*?)<\/span>/.exec(moddedScreen)?.[1];
  const changedModState = /value='102'[^]*?<span class='era-config-state'>(.*?)<\/span>/.exec(markup(config.input("102")))?.[1];
  assert.ok(initialModState);
  assert.ok(changedModState);
  assert.notEqual(changedModState, initialModState);
  assert.match(markup(config.input("4")), /Yandere Settings/);
  assert.match(markup(config.input("999")), /Modded/);
  assert.match(markup(config.input("999")), /Select An Option/);
  const cheatSnapshot = config.input("1467");
  assert.match(markup(cheatSnapshot), /era-setup-editor[\s\S]*Cheat menu/);
  assert.equal(cheatSnapshot.input?.buttonValues, undefined, "native cheat editors retain numeric input");
  assert.match(markup(config.input("0")), /enter your desired money level/);
  assert.match(markup(config.input("123")), /Cheat menu/);
  assert.match(markup(config.input("99")), /Select An Option/);
  assert.match(markup(config.input("999")), /config=1,1,1/);

  for (const [value, heading] of [
    ["91", /None/],
    ["92", /filters/i],
    ["94", /Characters that are disabled/],
    ["95", /Save Filter Set/],
    ["101", /Characters with disabled dialogue/],
    ["102", /CONTROVERSIAL CONTENT TOGGLES/],
  ] as const) {
    const submenu = new Runtime(game, GAME_INSTRUCTION_LIMIT);
    markup(submenu.start("TEST_CONFIG"));
    const screen = markup(submenu.input(value));
    assert.match(screen, /era-config era-setup-editor/);
    assert.match(screen, heading, `Config submenu ${value} retains its native choices`);
  }

  const configButtons = readFileSync(new URL("../hotpatch/MAIN_SCREEN_COMMANDS.ERB", import.meta.url), "utf8");
  assert.match(configButtons, /HOTPATCH_BUTTON\("Config", 809, "", "block"\)/);
  assert.match(configButtons, /HTML_PRINT HOTPATCH_BUTTON\("Config", 809\)/);
  assert.doesNotMatch(configButtons, /PRINTBUTTON_EX\([^,\n]*Config/);

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
  assert.match(screen, /era-radio/);
  const option = /value='(2\d{4})' class='era-radio'/.exec(screen)?.[1];
  assert.ok(option, "an alternative dialogue is available");
  let dialogueResult = markup(dialogue.input(option));
  if (dialogueResult.includes("resets the character's relationships")) {
    dialogueResult = markup(dialogue.input("0"));
    assert.match(dialogueResult, new RegExp(`value='${option}' class='era-radio'`));
  } else {
    assert.match(dialogueResult, /dialogue/);
    dialogueResult = markup(dialogue.input(""));
    assert.match(dialogueResult, new RegExp(`value='${option}' class='era-radio era-current'`));
  }
  assert.match(markup(dialogue.input("999")), /finished/);

  const home = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  const homeScreen = markup(home.start("TEST_MOVE_HOME"));
  assert.match(homeScreen, /era-radio/);
  assert.match(homeScreen, /value='2000' class='era-radio era-current'/);
  assert.match(markup(home.input("2001")), /value='2001' class='era-radio era-current'/);
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

  const sleep = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  for (const snapshot of [sleep.start("TEST_SLEEP_COLORS"), sleep.input("0")]) {
    const text = markup(snapshot);
    assert.match(text, /color=(\d+),\1/);
    const tip = snapshot.output.find((item) => item.type === "text" && item.text.includes("TIPS:"));
    assert.ok(tip && tip.type === "text");
    const options = snapshot.output.find((item) => item.type === "text" && item.text.includes("Options[400]"));
    assert.ok(options && options.type === "text");
    assert.notEqual(tip.style.color, options.style.color, "tips are yellow without coloring wake-up options");
  }
  const sleepConfig = sleep.input("0");
  assert.match(markup(sleepConfig), /Rerun the New Game setup/);
  const configRow = sleepConfig.output.find((item) => item.type === "html" && item.text.includes("Rerun the New Game setup"));
  assert.ok(configRow && configRow.type === "html");
  assert.doesNotMatch(configRow.text, /<span color='#FFFF00'>/);
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
CALLNAME:1 '= "Test's hero"
INPUT
FLAG:9000 = RESULT
CALL HOTPATCH_DIALOGUE_SETTINGS
PRINTFORML selected={CFLAG:1:口上セレクタ},called={FLAG:9001}
INPUT
QUIT`, "<dialogue-settings-test>");
  indexScript(game, `@TEST_SETUP_DIALOGUE_CHANGE
CALL MAKE_TALENT_MAP
CALL Name_Array_Set
CALL ADDCHARA_INIT(0)
CALL MAKE_ALL_CLASS_LIST
CALL ADD_ALL_CHARACTERS
CFLAG:1:口上実装状況 = 2
FLAG:9000 = 0
CALL OPTION
PRINTFORML selected={CFLAG:1:口上セレクタ},called={FLAG:9001}
INPUT
QUIT`, "<setup-dialogue-test>");
  function open(compatible: boolean): Runtime {
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
    markup(runtime.start("TEST_DIALOGUE_CHANGE"));
    assert.match(markup(runtime.input(compatible ? "1" : "0")), /aria-label='Test&#39;s hero dialogue'/);
    return runtime;
  }
  const canceled = open(false);
  const resetPrompt = markup(canceled.input("20005"));
  assert.match(resetPrompt, /resets the character's relationships/);
  assert.match(resetPrompt, /class='era-actions-group'><button value='1' class='era-button era-button-primary '[^>]*>Reset and change dialogue<\/button><button value='0' class='era-button '[^>]*>Cancel<\/button><\/div>/);
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

  const setup = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  markup(setup.start("TEST_SETUP_DIALOGUE_CHANGE"));
  markup(setup.input("103"));
  markup(setup.input("702"));
  assert.match(markup(setup.input("20005")), /resets the character's relationships/);
  assert.match(markup(setup.input("0")), /value='20005' class='era-radio/);
  assert.match(markup(setup.input("20005")), /resets the character's relationships/);
  assert.match(markup(setup.input("1")), /Applied/);
  assert.match(markup(setup.input("")), /value='20005' class='era-radio era-current/);
  markup(setup.input("999"));
  assert.match(markup(setup.input("999")), /selected=1,called=2/);
});

test("config setup preserves an existing game and uses in-game settings", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  indexScript(game, `@TEST_EXISTING_SETUP
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
DAY = 42
DAY:2 = 1
DAY:3 = 1
CALL ROOMSETTING_0
CALL DEFAULT_OWNER_0
RECOLOREDMAPS = 1
ANIMATERECOLOREDMAPS = 0
MONEY = 123456
ITEM:安物食材 = 77
FLAG:1000 = 0
FLAG:地主 = 1
FLAG:農民難易度 = 2
FLAG:地主貸付金 = 12345
FLAG:畑仕事の成果 = 73
CFLAG:MASTER:基本服装セット = 8
MAXBASE:MASTER:体力 = 4000
BASE:MASTER:体力 = 321
MAXBASE:MASTER:気力 = 3500
BASE:MASTER:気力 = 123
EXP:MASTER:Ａ経験 = 123
ABL:MASTER:Ａ感覚 = 8
FLAG:YANDERE_DEFAULTS_APPLIED = 0
FLAG:YANDERE_EVOLVE_CHANCE = 37
CALL OPTION
PRINTFORML state={DAY},{MONEY},{ITEM:安物食材},{FLAG:1000},{FLAG:地主},{FLAG:農民難易度},{FLAG:地主貸付金},{FLAG:畑仕事の成果},{CFLAG:MASTER:基本服装セット},{FLAG:甲斐性無},{FLAG:LUSTMODE},{FLAG:STABLEBYPASS},{FLAG:YANDERE_EVOLVE_CHANCE}
PRINTFORML player={MAXBASE:MASTER:体力},{BASE:MASTER:体力},{MAXBASE:MASTER:気力},{BASE:MASTER:気力},{EXP:MASTER:Ａ経験},{ABL:MASTER:Ａ感覚},{FLAG:YANDERE_DEFAULTS_APPLIED}
PRINTFORML combat={ABL:MASTER:戦闘能力},butt={TALENT:1:ヒップサイズ}
PRINTFORML race={TALENT:MASTER:人間},{TALENT:MASTER:妖怪},name=%NAME:MASTER%,home={MAIN_MAP}
INPUT
QUIT
@TEST_SETUP_FARM_RESTRICTIONS
CALL MAKE_TALENT_MAP
CALL Name_Array_Set
CALL ADDCHARA_INIT(0)
CALL MAKE_ALL_CLASS_LIST
CALL ADD_ALL_CHARACTERS
CALL DEFAULT_OPTION
INPUT
FLAG:気絶中断 = RESULT == 2
CALL HOTPATCH_SETUP_DIALOG(1, RESULT == 1)
PRINTL finished
INPUT
QUIT`, "<existing-setup-test>");

  const unchanged = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  assert.match(markup(unchanged.start("TEST_EXISTING_SETUP")), /More settings[\s\S]*Rerun the New Game setup/);
  const screen = markup(unchanged.input("103"));
  assert.match(screen, /New game setup/);
  for (const [value, label] of [[700, "Player"], [706, "Characters"], [703, "Bonuses"]] as const) {
    assert.match(screen, new RegExp(`value='${value}'[^>]*>${label}`));
  }
  assert.doesNotMatch(screen, /Start game|Choose a predefined character/);
  assert.match(screen, /value='130191'[^>]*aria-disabled='false'/, "race can be edited in an existing first playthrough");
  const selectedBody = /value='(1\d{5})' class='era-radio era-current'/.exec(screen)?.[1];
  assert.ok(selectedBody);
  markup(unchanged.input(selectedBody));
  markup(unchanged.input("710"));
  markup(unchanged.input("1108"));
  markup(unchanged.input("711"));
  markup(unchanged.input("712"));
  markup(unchanged.input("713"));
  markup(unchanged.input("706"));
  markup(unchanged.input("703"));
  const world = unchanged.input("701");
  assert.match(markup(world), /Romance Mode[\s\S]*Pregnancy Restrictions/);
  const worldOutput = world.output.flatMap(item => item.type === "html" ? [item.text] : []);
  const worldStart = worldOutput.indexOf("<era-open class='era-setup-world'>");
  assert.ok(worldStart >= 0);
  assert.deepEqual(worldOutput.slice(worldStart + 1, worldStart + 3), [
    "<era-open class='era-setup-card'>",
    "<span class='era-launch-eyebrow'>Home</span>",
  ], "the Home card opens with a standalone layout marker");
  assert.match(worldOutput[worldStart + 3]!, /era-setup-name/);
  assert.match(worldOutput[worldStart + 4]!, /Change home/);
  assert.equal(worldOutput[worldStart + 5], "<era-close>");
  assert.equal(worldOutput[worldStart + 6], "<era-open class='era-setup-card'>", "Romance Mode opens a separate card");
  markup(unchanged.input("702"));
  markup(unchanged.input("704"));
  markup(unchanged.input("705"));
  markup(unchanged.input("999"));
  const unchangedResult = markup(unchanged.input("999"));
  assert.match(unchangedResult, /state=42,123456,77,0,1,2,12345,73,8,0,0,0,37/);
  assert.match(unchangedResult, /player=4000,321,3500,123,123,8,0/);

  const changed = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  markup(changed.start("TEST_EXISTING_SETUP"));
  markup(changed.input("103"));
  assert.match(markup(changed.input("701")), /Romance Mode[\s\S]*Pregnancy Restrictions/);
  markup(changed.input("4132"));
  markup(changed.input("4142"));
  markup(changed.input("4110"));
  assert.match(markup(changed.input("704")), /Farm Settings/);
  assert.match(markup(changed.input("800")), /Cannot quit while in debt/);
  markup(changed.input("3103"));
  markup(changed.input("999"));
  assert.match(markup(changed.input("705")), /Yandere Settings/);
  assert.match(markup(changed.input("4160037")), /Subtype change chance value'>37<\/button>/);
  markup(changed.input("999"));
  assert.match(markup(changed.input("999")), /state=42,123456,77,0,1,2,12345,73,8,2,1,1,37/);

  const farm = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  markup(farm.start("TEST_EXISTING_SETUP"));
  markup(farm.input("103"));
  markup(farm.input("704"));
  markup(farm.input("800"));
  markup(farm.input("3103"));
  markup(farm.input("100"));
  markup(farm.input("999"));
  assert.match(markup(farm.input("999")), /state=42,123456,77,4,1,3,12345,73,8,/);

  for (const [scenario, reason] of [["1", "Unavailable during training"], ["2", "Unavailable while fainted"]] as const) {
    const restricted = new Runtime(game, GAME_INSTRUCTION_LIMIT);
    markup(restricted.start("TEST_SETUP_FARM_RESTRICTIONS"));
    markup(restricted.input(scenario));
    const world = markup(restricted.input("701"));
    assert.match(world, /value='801'[^>]*aria-disabled='true'/);
    const farming = markup(restricted.input("704"));
    assert.match(farming, new RegExp(reason));
    assert.match(farming, /value='800'[^>]*aria-disabled='true'/);
    assert.match(markup(restricted.input("999")), /finished/);
  }

  const player = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  markup(player.start("TEST_EXISTING_SETUP"));
  markup(player.input("103"));
  markup(player.input("5100"));
  markup(player.input("5103"));
  markup(player.input("712"));
  markup(player.input("7004"));
  markup(player.input("713"));
  markup(player.input("8004"));
  markup(player.input("710"));
  markup(player.input("1103"));
  markup(player.input("999"));
  const playerResult = markup(player.input("999"));
  assert.match(playerResult, /player=3900,321,3600,123,122,7,0/);
  assert.match(playerResult, /state=42,123456,77,0,1,2,12345,73,3,/);

  const direct = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  markup(direct.start("TEST_EXISTING_SETUP"));
  markup(direct.input("103"));
  markup(direct.input("713"));
  assert.match(markup(direct.input("9702")), /whole number \(0-9999\)/);
  markup(direct.input("543"));
  markup(direct.input("712"));
  assert.match(markup(direct.input("9602")), /whole number \(0-99\)/);
  markup(direct.input("10"));
  markup(direct.input("999"));
  assert.match(markup(direct.input("999")), /player=4000,321,3500,123,543,10,0/);

  const identity = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  markup(identity.start("TEST_EXISTING_SETUP"));
  markup(identity.input("103"));
  assert.match(markup(identity.input("130191")), /value='130191' class='era-radio era-current/);
  assert.match(markup(identity.input("5000")), /enter a new name/i);
  assert.match(markup(identity.input("New name")), /Accepted/);
  markup(identity.input(""));
  markup(identity.input("999"));
  assert.match(markup(identity.input("999")), /race=0,1,name=New name,home=0/);

  const home = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  markup(home.start("TEST_EXISTING_SETUP"));
  markup(home.input("103"));
  markup(home.input("701"));
  assert.match(markup(home.input("801")), /value='2000' class='era-radio era-current'/);
  markup(home.input("2001"));
  assert.match(markup(home.input("1998")), /New game setup/);
  markup(home.input("999"));
  assert.match(markup(home.input("999")), /home=0/);

  const body = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  markup(body.start("TEST_EXISTING_SETUP"));
  markup(body.input("103"));
  markup(body.input("706"));
  const bodyPrompt = markup(body.input("45015"));
  assert.match(bodyPrompt, /This changes characters/);
  assert.match(bodyPrompt, /class='era-actions-group'><button value='1' class='era-button era-button-primary '[^>]*>Apply<\/button><button value='0' class='era-button '[^>]*>Cancel<\/button><\/div>/);
  assert.match(markup(body.input("0")), /Character Bodies/);
  assert.match(markup(body.input("45015")), /This changes characters/);
  assert.match(markup(body.input("1")), /Applied: Everyone Has a Mystifying Butt/);
  markup(body.input("999"));
  assert.match(markup(body.input("999")), /state=42,123456,77[\s\S]*butt=4/);

  const bonus = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  markup(bonus.start("TEST_EXISTING_SETUP"));
  markup(bonus.input("103"));
  markup(bonus.input("703"));
  markup(bonus.input("1008"));
  markup(bonus.input("999"));
  assert.match(markup(bonus.input("999")), /state=42,123456,77[\s\S]*combat=0/, "selecting a bonus without applying it does not grant it");

  const applied = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  markup(applied.start("TEST_EXISTING_SETUP"));
  markup(applied.input("103"));
  markup(applied.input("703"));
  markup(applied.input("1008"));
  assert.match(markup(applied.input("802")), /value='802'[^>]*aria-disabled='true'[^>]*>Apply bonus/);
  markup(applied.input("999"));
  assert.match(markup(applied.input("999")), /state=42,123456,77[\s\S]*combat=2/);
});

test("in-game setup edits survive native save and load", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  game.routines.delete("SHOW_SHOP");
  game.routines.delete("EVENTLOAD");
  game.routines.delete("SYSTEM_LOADEND");
  indexScript(game, `@TEST_SETUP_SAVE
CALL MAKE_TALENT_MAP
CALL Name_Array_Set
CALL ADDCHARA_INIT(0)
CALL MAKE_ALL_CLASS_LIST
CALL ADD_ALL_CHARACTERS
CALL DEFAULT_OPTION
FOR LOCAL, 1, CHARANUM
	CALL KOJO_COUNT_CHECK(LOCAL)
NEXT
DAY = 42
MONEY = 123456
EXP:MASTER:Ａ経験 = 123
SAVEDATA 0, "existing game"
EXP:MASTER:Ａ経験 = 1
LOADDATA 0
@SHOW_SHOP
IF FLAG:9000
	PRINTFORML state={DAY},{MONEY},{EXP:MASTER:Ａ経験},{FLAG:甲斐性無},{FLAG:LUSTMODE}
	INPUT
	QUIT
ENDIF
CALL OPTION
FLAG:9000 = 1
SAVEDATA 1, "edited game"
PRINTL saved
INPUT
QUIT
@TEST_SETUP_RESTORE
LOADDATA 1
QUIT`, "<setup-save-test>");
  const saves = new MemorySaveStore();
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { saves });
  markup(runtime.start("TEST_SETUP_SAVE"));
  markup(runtime.input("103"));
  markup(runtime.input("713"));
  markup(runtime.input("8005"));
  markup(runtime.input("701"));
  markup(runtime.input("4132"));
  markup(runtime.input("999"));
  assert.match(markup(runtime.input("999")), /saved/);
  const original = saves.read("save00.sav");
  const edited = saves.read("save01.sav");
  assert.ok(Buffer.isBuffer(original));
  assert.ok(Buffer.isBuffer(edited));
  assert.equal(readNativeSave(original).text, "existing game");
  assert.equal(readNativeSave(edited).text, "edited game");
  const restored = new Runtime(game, GAME_INSTRUCTION_LIMIT, { saves });
  assert.match(markup(restored.start("TEST_SETUP_RESTORE")), /state=42,123456,124,1,1/);
});

test("move-home hotpatch preserves the native flow apart from the region selector", { skip: !existsSync(GAME_ROOT) }, () => {
  const original = readFileSync(path.join(gameDirectory(GAME_ROOT, "ERB"), "MOVEMENTS", "物件関連", "MAP_MANAGE.ERB"), "utf8");
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
