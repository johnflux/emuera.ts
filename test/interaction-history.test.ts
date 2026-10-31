import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { applyHotpatches, emptyGame, GAME_ROOT, indexScript, loadGame } from "../src/loader.js";
import { Runtime, GAME_INSTRUCTION_LIMIT, type Snapshot } from "../src/runtime.js";
import { FileSaveStore, MemorySaveStore } from "../src/storage.js";
import { readNativeSave } from "../src/save-format.js";
import { createApp } from "../src/server.js";
import { coloredHtml, plainHtml } from "../src/html.js";
import { demoGame } from "../src/demo.js";
import { proxyLlm } from "../src/llm.js";
import { FileVoiceStore, type EditableVoice } from "../src/character-voice.js";

function fixture(enabled = true) {
  const game = emptyGame();
  game.variableSizes.set("CFLAG", [10000]);
  game.names.set("CFLAG", new Map([["現在位置", 0], ["好感度", 2], ["信頼度", 4]]));
  indexScript(game, `@SYSTEM_TITLE
ADDVOIDCHARA
ADDVOIDCHARA
ADDVOIDCHARA
MASTER = 0
TARGET = 1
CALLNAME:0 = Player
CALLNAME:1 = Alice
CALLNAME:2 = Bob
NO:1 = 7
NO:2 = 7
DAY = 5
TIME = 600
CFLAG:0:現在位置 = 9
STR:8009 = Living room
JUMP LOOP
@LOOP
$AGAIN
CALL SHOW_STATUS
INPUT
SELECTCASE RESULT
CASE 300, 301, 303, 400
  CALLFORM COM{RESULT}
  CFLAG:TARGET:信頼度 += 1
CASE 0
  SAVEDATA 0, "checkpoint"
CASE 1
  LOADDATA 0
CASE 2
  TARGET = 2
CASE 3
  TARGET = 1
CASE 4
  SWAPCHARA 1, 2
  TARGET = 2
CASE 5
  DELCHARA 1
  TARGET = 1
CASE 6
  ADDCOPYCHARA 1
  TARGET = CHARANUM - 1
CASE 7
  COPYCHARA 1, 2
  TARGET = 2
CASE 8
  RESETDATA
  JUMP SYSTEM_TITLE
CASE 9
  SAVEDATA 1, "other checkpoint"
CASE 10
  DELDATA 0
CASE 11
  SORTCHARA CALLNAME, BACK
CASE 12
  CALL AFFAIR_DISCLOSURE(2, 0)
CASE 13
  CALL FirstMeetToday(2)
CASE 14
  CALL KOJO_MESSAGE_SEND("ENCOUNTER", 0, 2)
CASE 15
  CFLAG:2:291 = 1
  CFLAG:2:295 = 2
  CFLAG:2:現在位置 = 12
  STR:8012 = Garden
  CALL TIMESTOP_RESET(2)
  CALL TIMESTOP_RESET(2)
CASE 16
  CFLAG:2:291 = 0
  CFLAG:2:295 = 2
  CALL TIMESTOP_RESET(2)
ENDSELECT
GOTO AGAIN
@EVENTLOAD
@SHOW_SHOP
JUMP LOOP
@SHOW_STATUS
HTML_PRINT "<div class='era-interaction-history'></div>"
PRINTL Menu and status are not memories.
@COM300
PRINT A con
PRINTL versation begins.
CALL COM_KOJO_CALL(TARGET, 300)
TIME += 5
CFLAG:TARGET:好感度 += 2
RETURN 1
@COM301
PRINTL Tea is served.
CALL KOJO_MESSAGE_SEND("COMMAND", 301, TARGET)
RETURN 1
@COM303
PRINTW An apology begins.
PRINTL The apology ends.
RETURN 1
@COM400
PRINTL An untracked action.
@TIMESTOP_RESET(ARG)
CFLAG:ARG:295 = 0
FOR LOCAL, 286, 291
  CFLAG:ARG:LOCAL = 0
NEXT
FOR LOCAL, 50, 55
  EX:ARG:LOCAL = 0
NEXT
EX:ARG:70 = 0
@COM_KOJO_CALL(ARG, ARG:1)
PRINTL Hello.
CALL KOJO_MESSAGE_SEND("COMMAND", ARG:1, 2)
@KOJO_MESSAGE_SEND(ARGS, ARG:1, ARG:2)
HTML_PRINT "<b>Thank you.</b>"
@TRAINNAME_TR(ARG)
#FUNCTIONS
RETURNF ARG == 300 ? "Talk" # ARG == 301 ? "Serve tea" # "Apologize"
${enabled ? "@HOTPATCH_TARGET_DATAGROUP\nRETURN" : ""}`, "history.ERB");
  indexScript(game, `@AFFAIR_DISCLOSURE(ARG, NOZOKI)
#DIM NOZOKI
PRINTFORML %CALLNAME:ARG% was in the Living room.
PRINTL You haven't greeted this character today.
CALL SYOTAIMEN(ARG)
CALL FirstMeetToday(ARG)
@SYOTAIMEN(ARG)
SIF CFLAG:ARG:10
  RETURN
PRINTW First meeting begins.
CALL KOJO_MESSAGE_SEND("ENCOUNTER", 0, ARG)
CFLAG:ARG:10 = 1
@FirstMeetToday(ARG)
SIF TCVAR:ARG:10
  RETURN
PRINTL Daily greeting.
TCVAR:ARG:10 = 1`, "meeting.ERB");
  return game;
}

function check(snapshot: Snapshot): Snapshot {
  assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
  return snapshot;
}
function history(snapshot: Snapshot) {
  return check(snapshot).characterHistory!;
}

test("HTML history colors inherit and restore across nested tags without retaining markup", () => {
  const html = "base<font color='#ff0000'>red<font color='blue'>blue<br>line</font>red</font>base &amp; text";
  const runs = coloredHtml(html, "#cccccc");
  assert.deepEqual(runs, [
    { text: "base", color: "#cccccc" }, { text: "red", color: "#ff0000" },
    { text: "blue\nline", color: "blue" }, { text: "red", color: "#ff0000" },
    { text: "base & text", color: "#cccccc" },
  ]);
  assert.equal(runs.map((run) => run.text).join(""), plainHtml(html));
  assert.deepEqual(coloredHtml("<font color='#0xA0FF00'>green</font><font color='url(bad)'>base</font>", "#cccccc"), [
    { text: "green", color: "#A0FF00" }, { text: "base", color: "#cccccc" },
  ]);
});

for (const jit of [false, true]) {
  test(`penetration flags survive native saves and are consumed once (JIT ${jit})`, () => {
    const game = fixture(), stub = emptyGame(), saves = new MemorySaveStore();
    indexScript(game, `#DIM CONST ADD_MAXTOUCH = 6
#DIM ADD_TEMPTOUCHMODE
#DIM ADD_TOUCH_ACTIVE, 6
#DIM ADD_TOUCH_HISTORY, 6
#DIM ADD_TOUCH_ACTOR, 6
#DIM ADD_TOUCH_TARGET, 6
#DIM ADD_TOUCH_ACTOR_PART, 6
#DIM ADD_TOUCH_TARGET_PART, 6`, "touch-state.ERH", true);
    indexScript(stub, `@COM400
FLAG:70 = 1
; V and M use the forward map; A uses the reverse map. Actor zero is valid.
ADD_TOUCH_ACTIVE = 1, 1, 1, 1, 1
ADD_TOUCH_HISTORY = 0, 0, 0, 1, 0
ADD_TOUCH_ACTOR = 0, 2, 0, 0, 0
ADD_TOUCH_TARGET = 2, 0, 2, 1, 1
ADD_TOUCH_ACTOR_PART = 1, 7, 1, 1, 3
ADD_TOUCH_TARGET_PART = 6, 1, 4, 6, 6
CALL SOURCE_EXP(1)
CALL SOURCE_EXP(2)
@SOURCE_EXP(ARG)
RETURN
@COM301
CALL TIMESTOP_RESET(2)
CALL TIMESTOP_RESET(2)
@COM303
FLAG:70 = 0
CALL TIMESTOP_RESET(2)
CALL TIMESTOP_RESET(2)`, "penetration.ERB");
    for (const [name, routines] of stub.routines) game.routines.set(name, routines);
    const runtime = new Runtime(game, undefined, { saves, jit });
    check(runtime.start());
    check(runtime.input("400"));
    check(runtime.input("0"));
    const bytes = saves.read("save00.sav");
    assert.ok(Buffer.isBuffer(bytes));
    const native = readNativeSave(bytes);
    for (const flag of ["7395", "7396", "7397"]) {
      assert.equal(native.characters[2]!.CFLAG?.[flag], "1");
      assert.equal(native.characters[1]!.CFLAG?.[flag], undefined, "historical contacts and fingers do not set flags");
    }
    assert.equal(native.characters[2]!.CFLAG?.["287"], undefined, "penetration does not invent ejaculation");
    assert.equal(native.characters[2]!.EX?.["71"], undefined, "no new first-time-loss marker");
    for (const command of ["301", "303"]) {
      // Only the native save is carried over: pending state must not need history JSON.
      const restored = new MemorySaveStore();
      restored.write("save00.sav", bytes);
      const loaded = new Runtime(game, undefined, { saves: restored, jit });
      check(loaded.start());
      check(loaded.input("1"));
      check(loaded.input(command));
      const result = history(loaded.input("2"));
      assert.equal(result.entries.length, 1, "manual/depletion cleanup emits one reaction, even with repeated resets");
      const text = result.entries[0]!.lines[0]!.text;
      assert.match(text, /discomfort inside her vagina/);
      assert.match(text, /discomfort inside her bottom/);
      assert.match(text, /soreness inside her mouth/);
      assert.doesNotMatch(text, /semen|virgin|time.stop/i);
      check(loaded.input("9"));
      const cleaned = restored.read("save01.sav");
      assert.ok(Buffer.isBuffer(cleaned));
      for (const flag of ["7395", "7396", "7397"])
        assert.equal(readNativeSave(cleaned).characters[2]!.CFLAG?.[flag], undefined, "cleanup clears saved pending flags");
    }
  });

  test(`penetration tracking excludes normal time, previews and cancelled actions (JIT ${jit})`, () => {
    for (const [frozen, temporary, cancelled] of [[0, 0, 0], [1, 1, 0], [1, 0, 1]]) {
      const game = fixture(), stub = emptyGame(), saves = new MemorySaveStore();
      indexScript(game, `#DIM CONST ADD_MAXTOUCH = 1
#DIM ADD_TEMPTOUCHMODE
#DIM ADD_TOUCH_ACTIVE, 1
#DIM ADD_TOUCH_HISTORY, 1
#DIM ADD_TOUCH_ACTOR, 1
#DIM ADD_TOUCH_TARGET, 1
#DIM ADD_TOUCH_ACTOR_PART, 1
#DIM ADD_TOUCH_TARGET_PART, 1`, "excluded-touch-state.ERH", true);
      indexScript(stub, `@COM400
FLAG:70 = ${frozen}
ADD_TEMPTOUCHMODE = ${temporary}
ADD_TOUCH_ACTIVE = 1
ADD_TOUCH_TARGET = 2
ADD_TOUCH_ACTOR_PART = 1
ADD_TOUCH_TARGET_PART = 7
; SOURCE_CHECK returns before SOURCE_EXP for cancelled actions.
SIF !${cancelled}
  CALL SOURCE_EXP(2)
@SOURCE_EXP(ARG)
RETURN`, "excluded-penetration.ERB");
      for (const [name, routines] of stub.routines) game.routines.set(name, routines);
      const runtime = new Runtime(game, undefined, { saves, jit });
      check(runtime.start());
      check(runtime.input("400"));
      check(runtime.input("0"));
      const bytes = saves.read("save00.sav");
      assert.ok(Buffer.isBuffer(bytes));
      assert.equal(readNativeSave(bytes).characters[2]!.CFLAG?.["7396"], undefined);
    }
  });

  test(`penetration and ejaculation share V/A notices but keep oral symptoms distinct (JIT ${jit})`, () => {
    const game = fixture(), stub = emptyGame();
    indexScript(stub, `@COM400
CFLAG:2:7395 = 1
CFLAG:2:7396 = 1
CFLAG:2:7397 = 1
CFLAG:2:286 = 2
CFLAG:2:287 = 2
CFLAG:2:288 = 2
EXP:2:1 = 1
EXP:2:2 = 1
EXP:2:25 = 1
CALL TIMESTOP_RESET(2)`, "combined-aftereffects.ERB");
    game.routines.set("COM400", stub.routines.get("COM400")!);
    const runtime = new Runtime(game, undefined, { saves: new MemorySaveStore(), jit });
    check(runtime.start());
    check(runtime.input("400"));
    const text = history(runtime.input("2")).entries[0]!.lines[0]!.text;
    assert.equal(text.match(/discomfort inside her vagina/g)?.length, 1);
    assert.equal(text.match(/discomfort in her bottom/g)?.length, 1);
    assert.match(text, /aftermath of oral sex/);
    assert.match(text, /taste of semen/);
  });

  test(`reaction recognition follows character knowledge and experience (JIT ${jit})`, () => {
    for (const [ignorant, experience, oral, recognizes, oralRecognizes] of [
      [1, 0, 0, false, false],
      [1, 99, 0, false, false],
      [1, 100, 0, true, true],
      [0, 0, 0, true, true],
      [1, 0, 1, false, true],
    ] as const) {
      const game = fixture(), stub = emptyGame();
      indexScript(stub, `@COM400
TALENT:2:27 = ${ignorant}
EXP:2:14 = ${experience}
EXP:2:25 = ${oral}
FOR LOCAL, 288, 291
  CFLAG:2:LOCAL = 2
NEXT
CALL TIMESTOP_RESET(2)`, "recognition.ERB");
      game.routines.set("COM400", stub.routines.get("COM400")!);
      const runtime = new Runtime(game, undefined, { saves: new MemorySaveStore(), jit });
      runtime.start();
      runtime.input("400");
      const event = history(runtime.input("2")).entries[0]!;
      const text = event.lines[0]!.text;
      assert.equal(text.includes("notices the sudden unexpected taste of semen in her mouth."), oralRecognizes);
      assert.equal(text.includes("notices the sudden unexplained presence of semen on her face."), recognizes);
      assert.equal(text.includes("notices the sudden unexplained presence of semen on her hand."), recognizes);
      assert.doesNotMatch(JSON.stringify(event), /time.stop|time.resum/i);
      runtime.input("0");
      assert.equal(history(runtime.input("1")).entries[0]!.lines[0]!.text, text, "recognition is recorded at event time");
    }
  });

  test(`internal reactions use explicit knowledge and virginity branches (JIT ${jit})`, () => {
    for (const [ignorant, aware, unaware, general, virginity, talent, expected] of [
      [0, 0, 0, 0, 0, 0, "feels sudden discomfort inside her vagina, unable to tell what is wrong."],
      [1, 0, 10, 100, 0, 0, "again feels a sudden discomfort inside her vagina."],
      [1, 0, 1, 0, 0, -1, "again feels a sudden discomfort inside her vagina."],
      [1, 0, 1, 0, 1, -1, "feels sudden pain and discomfort inside her vagina, unsure what has happened."],
      [1, 1, 10, 0, 0, 0, "feels sudden discomfort inside her vagina, similar to having sexual intercourse."],
      [1, 1, 0, 0, 0, 0, "feels sudden discomfort inside her vagina, similar to having sexual intercourse."],
      [0, 1, 0, 0, 1, 0, "feels sudden pain and discomfort inside her vagina, unsure what has happened."],
      [0, 1, 0, 0, 0, -1, "feels sudden discomfort inside her vagina, unable to tell what is wrong."],
      [0, 1, 0, 0, 2, 0, "feels sudden discomfort inside her vagina, similar to having sexual intercourse."],
    ] as const) {
      const game = fixture(), stub = emptyGame();
      indexScript(stub, `@COM400
TALENT:2:27 = ${ignorant}
TALENT:2:0 = ${talent}
EXP:2:1 = ${aware}
EXP:2:61 = ${unaware}
EXP:2:14 = ${general}
EX:2:70 = ${virginity}
CFLAG:2:286 = 2
CFLAG:2:287 = 2
CALL TIMESTOP_RESET(2)`, "internal-reactions.ERB");
      game.routines.set("COM400", stub.routines.get("COM400")!);
      const runtime = new Runtime(game, undefined, { saves: new MemorySaveStore(), jit });
      runtime.start();
      runtime.input("400");
      const text = history(runtime.input("2")).entries[0]!.lines[0]!.text;
      assert.ok(text.includes(expected));
      assert.equal(text.includes("again feels"), expected.startsWith("again feels"));
      assert.ok(text.includes("feels sudden discomfort inside her bottom, unsure what is causing it."));
      assert.doesNotMatch(text, /pending|time.stop|time.resum/i);
    }
  });

  test(`anal recognition requires aware anal experience (JIT ${jit})`, () => {
    for (const [aware, unaware, general, expected] of [
      [0, 0, 100, false],
      [0, 1, 0, false],
      [0, 10, 100, false],
      [1, 0, 0, true],
      [1, 10, 0, true],
    ] as const) {
      const game = fixture(), stub = emptyGame();
      indexScript(stub, `@COM400
EXP:2:2 = ${aware}
EXP:2:62 = ${unaware}
EXP:2:14 = ${general}
CFLAG:2:287 = 2
CALL TIMESTOP_RESET(2)`, "anal-recognition.ERB");
      game.routines.set("COM400", stub.routines.get("COM400")!);
      const runtime = new Runtime(game, undefined, { saves: new MemorySaveStore(), jit });
      runtime.start();
      runtime.input("400");
      const text = history(runtime.input("2")).entries[0]!.lines[0]!.text;
      assert.equal(text.includes("feels the sudden unexpected discomfort in her bottom similar to having anal intercourse."), expected);
      assert.equal(text.includes("unsure what is causing it"), aware === 0 && unaware === 0);
      assert.equal(text.includes("again feels a sudden discomfort inside her bottom"), aware === 0 && unaware > 0);
      assert.doesNotMatch(text, /pending|time.stop|time.resum/i);
    }
  });

  test(`all pending time-resume aftereffects are logged in English (JIT ${jit})`, () => {
    for (const [strength, virginity, expected] of [
      [31, 1, ["intense wave of unexplained sexual pleasure", "sudden pain between her legs"]],
      [1, 2, ["sudden feeling of unexplained sexual pleasure", "sudden pain between her legs"]],
    ] as const) {
      const game = fixture(), stub = emptyGame(), saves = new MemorySaveStore();
      indexScript(stub, `@COM400
EX:2:50 = ${strength}
EX:2:70 = ${virginity}
TALENT:2:27 = 1
FOR LOCAL, 286, 291
  CFLAG:2:LOCAL = 2
NEXT
CALL TIMESTOP_RESET(2)
CALL TIMESTOP_RESET(2)`, "aftereffects.ERB");
      game.routines.set("COM400", stub.routines.get("COM400")!);
      const runtime = new Runtime(game, undefined, { saves, jit });
      runtime.start();
      assert.equal(history(runtime.input("400")).entries.length, 0);
      const result = history(runtime.input("2"));
      assert.equal(result.entries.length, 1, "all aftereffects form one event and cleanup is not duplicated");
      const event = result.entries[0]!;
      assert.equal(event.source, "state");
      const text = event.lines.map((line) => line.text).join("\n");
      for (const phrase of [...expected, "discomfort inside her vagina", "discomfort inside her bottom", "unexpected in her mouth", "unexpected on her face", "unexpected on her hand"])
        assert.ok(text.includes(phrase), phrase);
      assert.doesNotMatch(text, /[\u3040-\u30ff\u4e00-\u9fff]/);
      assert.doesNotMatch(JSON.stringify(event), /time.stop|time.resum|virginity|ejaculation/i);
      runtime.input("0");
      assert.deepEqual(history(runtime.input("1")).entries, result.entries);
    }
  });

  test(`time-resume state is logged for the affected character in another room (JIT ${jit})`, () => {
    const saves = new MemorySaveStore();
    const runtime = new Runtime(fixture(), undefined, { saves, jit });
    runtime.start();
    assert.equal(history(runtime.input("15")).entries.length, 0, "the selected character is not the affected one");
    const result = history(runtime.input("2"));
    assert.equal(result.entries.length, 1, "repeated cleanup does not duplicate the reaction");
    const event = result.entries[0]!;
    assert.equal(event.source, "state", "state summaries are distinguished from captured script dialogue");
    assert.deepEqual(event.action, { id: "reaction", label: "Reaction" });
    assert.equal(event.target, result.character.id);
    assert.equal(event.before.locationName, "Garden", "use the affected character's room, not the player's");
    assert.equal(event.after.locationName, "Garden");
    assert.equal(event.lines[0]!.text, "Bob notices that her underwear is suddenly missing.");
    runtime.input("0");
    assert.deepEqual(history(runtime.input("1")).entries, result.entries);
    assert.equal(history(runtime.input("16")).entries.length, 1, "no missing-underwear event if underwear is not missing");
  });

  test(`playing a game logs the completed scene and participants, not cancelled setup (JIT ${jit})`, () => {
    const game = fixture(), stub = emptyGame(), saves = new MemorySaveStore();
    indexScript(stub, `@LOOP
$AGAIN
CALL SHOW_STATUS
INPUT
SIF RESULT == 1
  LOADDATA 0
CALL ADD_CUSTOM_COM0
CALL EVENTCOMEND
CALL SHOW_STATUS
SAVEDATA 0, "game history"
GOTO AGAIN
@ADD_CUSTOM_COM0
PRINTL Which game should you play?
INPUT
SIF RESULT == -1
  RETURN -1
ADD_GAME_PARTICIPANT_COUNT = 3
ADD_GAME_PARTICIPANTS:0 = MASTER
ADD_GAME_PARTICIPANTS:1 = TARGET
ADD_GAME_PARTICIPANTS:2 = 2
CALL ADD_GAME1
CALL ADD_GAME_BET_NONE
WAIT
TIME += 30
@ADD_GAME1
PRINTL The three of you play cards.
PRINTL Bob wins.
@ADD_GAME_BET_NONE
PRINTL No wager.
@EVENTCOMEND
CFLAG:TARGET:好感度 += 3`, "play-game-history.ERB");
    indexScript(game, `#DIM ADD_GAME_PARTICIPANT_COUNT
#DIM ADD_GAME_PARTICIPANTS, 10`, "play-game-vars.ERH", true);
    for (const [name, routine] of stub.routines) game.routines.set(name, routine);
    const runtime = new Runtime(game, undefined, { saves, jit });
    runtime.start();
    runtime.input("0");
    assert.equal(history(runtime.input("-1")).entries.length, 0);
    runtime.input("0");
    let snapshot = check(runtime.input("0"));
    assert.equal(snapshot.input?.kind, "wait");
    snapshot = check(runtime.input(""));
    const result = history(snapshot);
    assert.equal(result.entries.length, 1);
    const event = result.entries[0]!;
    assert.deepEqual(event.action, { id: "play-game", label: "Play a game" });
    assert.deepEqual(event.participants.map((person) => person.name), ["Player", "Alice", "Bob"]);
    assert.equal(event.lines.map((line) => line.text).join(""), "The three of you play cards.\nBob wins.\nNo wager.\n");
    assert.equal(event.after.affection, "6");
    assert.deepEqual(history(runtime.input("1")).entries, result.entries, "custom game events survive save/load");
  });

  test(`captures dialogue dispatched after COM300 returns (JIT ${jit})`, () => {
    const game = fixture(), stub = emptyGame();
    indexScript(stub, `@LOOP
$AGAIN
CALL SHOW_STATUS
INPUT
CALL COM300
CALL SOURCE_CHECK
PRINTL Post-command status is not dialogue.
GOTO AGAIN
@COM300
CFLAG:TARGET:好感度 += 3
RETURN 1
@SOURCE_CHECK
PRINTL Alice seems rather upset.
CALL KOJO_MESSAGE_SEND("COMMAND", 300, TARGET)
CALL COM_KOJO_CALL(TARGET, 300)
PRINTL ------------
PRINTL Alice
PRINTL Fear         0          + 30         =   30
PRINTL Joy          0          + 0          =   0
PRINT Hostility    50         - 5          =   45
PRINTL
PRINT ENE-20 
PRINTL (Alice)
@KOJO_MESSAGE_SEND(ARGS, ARG:1, ARG:2)
PRINTL You have a normal conversation...
@COM_KOJO_CALL(ARG, ARG:1)
PRINTW The weather is nice today.
PRINTL It's perfect for doing the laundry.`, "late-dialogue.ERB");
    for (const [name, routine] of stub.routines) game.routines.set(name, routine);
    const runtime = new Runtime(game, undefined, { saves: new MemorySaveStore(), jit });
    runtime.start();
    let snapshot = check(runtime.input("300"));
    assert.equal(snapshot.input?.kind, "wait");
    snapshot = check(runtime.input(""));
    const event = history(snapshot).entries[0]!;
    const captured = event.lines.map((line) => line.text).join("");
    assert.match(captured, /normal conversation/);
    assert.match(captured, /weather is nice/);
    assert.match(captured, /perfect for doing the laundry/);
    assert.doesNotMatch(captured, /status|Menu/);
    // SOURCE_CHECK's own remarks are kept and its parameter table is condensed; separators and stamina are dropped.
    assert.equal(event.lines.filter((line) => line.character === null).map((line) => line.text).join(""),
      "Alice seems rather upset.\nAlice: Fear +30, Hostility -5\n");
    assert.ok(event.lines.every((line) => line.character === null || line.character === event.target));
    assert.equal(event.after.affection, "3");
  });

  test(`text and inline HTML colors survive capture and save/load (JIT ${jit})`, () => {
    const game = fixture(), stub = emptyGame(), saves = new MemorySaveStore();
    indexScript(stub, `@COM300
SETCOLOR 0xFF0000
PRINT red
SETCOLOR 0x00FF00
PRINTL green
HTML_PRINT "<font color='#0000ff'>blue<font color='#ffffff'>white</font>blue</font>"
RETURN 1`, "colors.ERB");
    game.routines.set("COM300", stub.routines.get("COM300")!);
    const runtime = new Runtime(game, undefined, { saves, jit });
    runtime.start();
    const result = history(runtime.input("300"));
    const line = result.entries[0]!.lines[0]!;
    assert.equal(line.text, "redgreen\nbluewhiteblue\n");
    assert.deepEqual(line.runs, [
      { text: "red", color: "#ff0000" }, { text: "green\n", color: "#00ff00" },
      { text: "blue", color: "#0000ff" }, { text: "white", color: "#ffffff" },
      { text: "blue", color: "#0000ff" }, { text: "\n", color: "#00ff00" },
    ]);
    runtime.input("0");
    assert.deepEqual(history(runtime.input("1")).entries, result.entries);
    const eventFile = saves.list().find((name) => name.startsWith("era-history-event-"))!;
    const legacy = JSON.parse(String(saves.read(eventFile)));
    for (const line of legacy.event.lines) delete line.runs;
    saves.write(eventFile, JSON.stringify(legacy));
    const old = history(runtime.input("1"));
    assert.equal(old.entries[0]!.lines[0]!.text, line.text, "older plain-text history still loads");
    assert.equal(old.entries[0]!.lines[0]!.runs, undefined);
  });

  test(`first encounters capture the full nested scene for the actual character (JIT ${jit})`, () => {
    const saves = new MemorySaveStore();
    const runtime = new Runtime(fixture(), undefined, { saves, jit });
    runtime.start();
    const waiting = check(runtime.input("12"));
    assert.equal(waiting.input?.kind, "wait");
    assert.deepEqual(saves.list(), [], "an incomplete encounter is not persisted");
    const current = history(runtime.input(""));
    assert.equal(current.character.name, "Alice");
    assert.equal(current.entries.length, 0, "the selected character did not participate");
    const bob = history(runtime.input("2"));
    assert.equal(bob.entries.length, 1, "nested first-meeting and daily-greeting calls are one interaction");
    const event = bob.entries[0]!;
    assert.deepEqual(event.action, { id: "encounter", label: "First meeting" });
    assert.equal(event.target, bob.character.id);
    assert.deepEqual(event.participants.map((person) => person.name), ["Player", "Bob"]);
    assert.equal(event.lines.map((line) => line.text).join(""),
      "Bob was in the Living room.\nYou haven't greeted this character today.\nFirst meeting begins.\nThank you.\nDaily greeting.\n");
    assert.ok(event.lines.every((line) => line.character === bob.character.id));
    check(runtime.input("0"));
    check(runtime.input("14"));
    const restored = history(runtime.input("1"));
    assert.deepEqual(restored.entries, [event], "loading excludes future encounters and accepts saved encounter events");
  });

  test(`greeting and encounter fallbacks persist independently and skip silent checks (JIT ${jit})`, () => {
    const runtime = new Runtime(fixture(), undefined, { jit });
    runtime.start();
    check(runtime.input("13"));
    let result = history(runtime.input("2"));
    assert.equal(result.entries.length, 1);
    assert.deepEqual(result.entries[0]!.action, { id: "greeting", label: "Daily greeting" });
    result = history(runtime.input("13"));
    assert.equal(result.entries.length, 1, "already greeted checks produce no empty events");
    result = history(runtime.input("14"));
    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0]!.action.id, "encounter");
    assert.equal(result.entries[0]!.lines[0]!.text, "Thank you.\n");
  });

  test(`captures structured eraTW interactions, not menus or other commands (JIT ${jit})`, () => {
    const saves = new MemorySaveStore();
    const runtime = new Runtime(fixture(), undefined, { saves, jit });
    assert.equal(history(runtime.start()).entries.length, 0);
    for (let i = 0; i < 3; i++) check(runtime.input("300"));
    const result = history(runtime.input("301"));
    assert.equal(result.entries.length, 4);
    const talk = result.entries[1]!;
    assert.deepEqual(talk.action, { id: 300, label: "Talk" });
    assert.equal(talk.source, "script");
    assert.deepEqual(talk.participants.map((p) => p.name), ["Player", "Alice", "Bob"]);
    assert.equal(talk.lines[0]!.text, "A conversation begins.\n");
    assert.equal(talk.lines[0]!.character, null);
    assert.equal(talk.lines[1]!.character, talk.participants[1]!.id);
    assert.equal(talk.lines[2]!.character, talk.participants[2]!.id);
    assert.equal(talk.lines[2]!.text, "Thank you.\n");
    assert.equal(talk.before.day, "5");
    assert.equal(talk.before.locationName, "Living room");
    assert.equal(talk.before.trust, "2");
    assert.equal(talk.after.trust, "3", "captures post-command processing, not just the printed dialogue");
    assert.equal(talk.after.affection, "6");
    const untracked = history(runtime.input("400"));
    assert.equal(untracked.entries.length, 4);
    assert.ok(untracked.entries.every((entry) => !JSON.stringify(entry).includes("Menu and status")));
    assert.equal(saves.list().filter((file) => file.startsWith("era-history-event-")).length, 4);
  });

  test(`native saves checkpoint history; reloading branches without future memories (JIT ${jit})`, () => {
    const saves = new MemorySaveStore();
    const game = fixture();
    const runtime = new Runtime(game, undefined, { saves, jit });
    runtime.start();
    const original = history(runtime.input("300")).entries[0]!;
    check(runtime.input("0"));
    check(runtime.input("301"));
    assert.equal(history(runtime.input("1")).entries.length, 1);
    const branched = history(runtime.input("300"));
    assert.equal(branched.entries.length, 2);
    assert.equal(branched.entries[0]!.parent, original.id);
    assert.ok(branched.entries.every((entry) => entry.action.id === 300));
    check(runtime.input("9"));
    const restarted = new Runtime(game, undefined, { saves, jit });
    restarted.start();
    assert.deepEqual(history(restarted.input("1")).entries, [original]);
    assert.equal(history(restarted.input("1")).character.id, original.participants[1]!.id);
    assert.equal(readNativeSave(saves.read("save00.sav") as Buffer).type, 0);
    check(restarted.input("10"));
    assert.equal(saves.read("era-history-save00.sav.json"), null);
    assert.ok(saves.read("era-history-save01.sav.json"), "deleting one slot does not delete another checkpoint");
  });
}

test("per-instance identities survive reordering and deletion, but are not shared by duplicates or copies", () => {
  const runtime = new Runtime(fixture());
  runtime.start();
  const first = history(runtime.input("300"));
  const id = first.character.id;
  assert.equal(history(runtime.input("2")).entries.length, 1, "Bob participated despite not being TARGET");
  check(runtime.input("300"));
  const swapped = history(runtime.input("4"));
  assert.equal(swapped.character.name, "Alice");
  assert.equal(swapped.character.id, id);
  const deleted = history(runtime.input("5"));
  assert.equal(deleted.character.id, id);
  assert.equal(deleted.entries.length, 1, "Alice did not participate in the later Bob-only interaction");
  const copy = history(runtime.input("6"));
  assert.notEqual(copy.character.id, id);
  assert.equal(copy.entries.length, 0, "a cloned character has no inherited memories");
  const overwritten = history(runtime.input("7"));
  assert.notEqual(overwritten.character.id, id);
  assert.equal(overwritten.entries.length, 0);
  assert.equal(history(runtime.input("8")).entries.length, 0, "a new game has no previous history");
});

test("sorting characters follows the same instance rather than its old index", () => {
  const runtime = new Runtime(fixture());
  runtime.start();
  const original = history(runtime.input("300"));
  const sorted = history(runtime.input("11"));
  assert.equal(sorted.character.id, original.character.id);
  assert.deepEqual(sorted.entries, original.entries);
});

test("silent character hooks do not make unrelated characters participants", () => {
  const game = fixture(), stub = emptyGame();
  indexScript(stub, "@KOJO_MESSAGE_SEND(ARGS, ARG:1, ARG:2)\nRETURN", "silent-scene.ERB");
  game.routines.set("KOJO_MESSAGE_SEND", stub.routines.get("KOJO_MESSAGE_SEND")!);
  const runtime = new Runtime(game);
  runtime.start();
  const result = history(runtime.input("300"));
  assert.deepEqual(result.entries[0]!.participants.map((person) => person.name), ["Player", "Alice"]);
  assert.equal(history(runtime.input("2")).entries.length, 0);
});

test("prefetch stages interactions and checkpoints until the player continues", () => {
  const saves = new MemorySaveStore();
  const game = fixture();
  const runtime = new Runtime(game, undefined, { saves });
  runtime.start();
  const waiting = check(runtime.input("303"));
  assert.equal(waiting.input?.kind, "wait");
  assert.equal(saves.list().length, 0);
  assert.equal(runtime.prefetch(), true);
  assert.equal(saves.list().length, 0, "the speculative event has not been persisted");
  const result = history(runtime.input(""));
  assert.equal(result.entries.length, 1);
  assert.match(result.entries[0]!.lines[0]!.text, /An apology begins\.\nThe apology ends\./);
  assert.equal(saves.list().length, 1);
  const abandonedSaves = new MemorySaveStore();
  const abandoned = new Runtime(game, undefined, { saves: abandonedSaves });
  abandoned.start();
  abandoned.input("303");
  abandoned.prefetch();
  assert.deepEqual(abandonedSaves.list(), [], "an abandoned prefetched event never persists");
});

test("prefetched meetings persist only after continuation and are discarded if abandoned", () => {
  for (const commit of [false, true]) {
    const saves = new MemorySaveStore();
    const runtime = new Runtime(fixture(), undefined, { saves });
    runtime.start();
    check(runtime.input("12"));
    assert.equal(runtime.prefetch(), true);
    assert.deepEqual(saves.list(), []);
    if (commit) {
      check(runtime.input(""));
      assert.equal(saves.list().length, 1);
      assert.equal(history(runtime.input("2")).entries[0]!.action.id, "encounter");
    }
  }
});

test("old and externally replaced saves never attach mismatched history", () => {
  const saves = new MemorySaveStore();
  const runtime = new Runtime(fixture(), undefined, { saves });
  runtime.start();
  runtime.input("300");
  runtime.input("0");
  saves.remove("era-history-save00.sav.json");
  const old = history(runtime.input("1"));
  assert.equal(old.entries.length, 0);
  assert.match(old.notice, /predates/);
  runtime.input("300");
  runtime.input("0");
  const checkpoint = JSON.parse(String(saves.read("era-history-save00.sav.json")));
  checkpoint.digest = "replaced";
  saves.write("era-history-save00.sav.json", JSON.stringify(checkpoint));
  const replaced = history(runtime.input("1"));
  assert.equal(replaced.entries.length, 0);
  assert.match(replaced.notice, /replaced outside/);
});

test("unrelated games retain their existing snapshots and save files", () => {
  const saves = new MemorySaveStore();
  const runtime = new Runtime(fixture(false), undefined, { saves });
  assert.equal(runtime.start().characterHistory, undefined);
  assert.equal(runtime.input("300").characterHistory, undefined);
  check(runtime.input("0"));
  assert.deepEqual(saves.list(), ["save00.sav"]);
});

test("enabling history does not change script output or native save contents", () => {
  const runs = [false, true].map((enabled) => {
    const saves = new MemorySaveStore();
    const runtime = new Runtime(fixture(enabled), undefined, { saves });
    const snapshots = [runtime.start(), runtime.input("300"), runtime.input("301"), runtime.input("0")];
    return { output: snapshots.map((snapshot) => snapshot.output), bytes: saves.read("save00.sav") };
  });
  assert.deepEqual(runs[0], runs[1]);
});

test("history and instance identities survive reopening the file store", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "era-history-"));
  try {
    const saves = new FileSaveStore(dir);
    const runtime = new Runtime(fixture(), undefined, { saves });
    runtime.start();
    const original = history(runtime.input("300"));
    runtime.input("0");
    const restarted = new Runtime(fixture(), undefined, { saves: new FileSaveStore(dir) });
    restarted.start();
    assert.deepEqual(history(restarted.input("1")), original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("recent history is bounded while original events remain available", () => {
  const saves = new MemorySaveStore();
  const runtime = new Runtime(fixture(), undefined, { saves });
  runtime.start();
  for (let i = 0; i < 25; i++) check(runtime.input("300"));
  const result = history(runtime.input("0"));
  assert.equal(result.entries.length, 20);
  const all = runtime.fullCharacterHistory(result);
  assert.equal(all.entries.length, 25);
  assert.deepEqual(all.entries.slice(0, 20), result.entries);
  assert.equal(saves.list().filter((file) => file.startsWith("era-history-event-")).length, 25);
  runtime.input("300");
  assert.equal(runtime.fullCharacterHistory(result).entries.length, 25, "full history is anchored to the displayed timeline");
});

test("oversized interaction text is explicitly marked and failed commands do not persist events", () => {
  const game = fixture();
  const stub = emptyGame();
  indexScript(stub, `@COM300
PRINTS "x" * 17000
RETURN 1
@COM301
PRINTL A scene starts.
THROW fixture failure`, "history-limits.ERB");
  for (const name of ["COM300", "COM301"]) game.routines.set(name, stub.routines.get(name)!);
  const saves = new MemorySaveStore();
  const runtime = new Runtime(game, undefined, { saves });
  runtime.start();
  const event = history(runtime.input("300")).entries[0]!;
  assert.equal(event.truncated, true);
  assert.equal(event.lines.reduce((length, line) => length + line.text.length, 0), 16_000);
  const failure = runtime.input("301");
  assert.match(failure.error!.message, /fixture failure/);
  assert.equal(saves.list().length, 1, "no complete event for a command that crashed");
});

test("corrupt history checkpoints are reported rather than silently treated as empty", () => {
  const saves = new MemorySaveStore();
  const runtime = new Runtime(fixture(), undefined, { saves });
  runtime.start();
  runtime.input("0");
  saves.write("era-history-save00.sav.json", "{broken");
  const result = runtime.input("1");
  assert.match(result.error!.message, /Invalid interaction history JSON/);
});

test("HTTP delivery and resume expose the selected character history and serve the panel module", async () => {
  const savedVoices: [number, EditableVoice | null][] = [];
  const voices = { load: () => null, save: (no: number, voice: EditableVoice | null) => { savedVoices.push([no, voice]); } };
  const app = createApp([{ id: "tw", title: "Test", game: fixture(), saves: new MemorySaveStore(), voices }]);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const post = async (route: string, data: object) => {
    const response = await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const started = await post("/api/start", { mode: "game" });
    const result = await post("/api/input", { session: started.session, step: started.step, value: "300" });
    assert.equal(result.characterHistory.entries[0].action.label, "Talk");
    const resumed = await post("/api/resume", { session: started.session });
    assert.deepEqual(resumed.history.at(-1).snapshot.characterHistory, result.characterHistory);
    for (let i = 0; i < 24; i++) await post("/api/input", { session: started.session, value: "300" });
    const current = await post("/api/resume", { session: started.session });
    const recent = current.history.at(-1).snapshot.characterHistory;
    assert.equal(recent.entries.length, 20);
    const full = await post("/api/character-history", {
      session: started.session, step: current.step, character: recent.character.id,
    });
    assert.equal(full.entries.length, 25);
    const unchanged = await post("/api/resume", { session: started.session });
    assert.equal(unchanged.step, current.step, "reading all history does not advance the game");
    const stale = await fetch(`${base}/api/character-history`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: started.session, step: current.step - 1, character: recent.character.id }),
    });
    assert.equal(stale.status, 409);
    const raw = (route: string, data: object) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const call = { session: started.session, step: current.step, character: recent.character.id, name: "change_feelings" };
    const outside = await raw("/api/character-tool", { ...call, arguments: { favor: 99 } });
    assert.equal(outside.status, 409, "tools only run at a command screen");
    assert.match((await outside.json()).error, /waiting for a command/);
    assert.equal((await raw("/api/character-tool", { ...call, arguments: [] })).status, 400);
    assert.equal((await raw("/api/character-tool", { ...call, session: "missing" })).status, 404);
    assert.equal((await raw("/api/character-tool", { ...call, step: current.step - 1 })).status, 409);
    assert.equal((await raw("/api/character-tool", { ...call, character: "someone-else" })).status, 409);
    // The character's voice: generated only at a command screen, while an edited one can be saved (or reverted) any time.
    const voiceCall = { session: started.session, character: recent.character.id };
    const generating = await raw("/api/character-voice", { ...voiceCall, step: current.step });
    assert.equal(generating.status, 409);
    assert.match((await generating.json()).error, /waiting for a command/);
    assert.equal((await raw("/api/character-voice", voiceCall)).status, 400);
    const edited = { description: " A test. ", examples: [" Hello. ", ""], intimateExamples: [] };
    assert.equal((await raw("/api/character-voice/save", { ...voiceCall, voice: { ...edited, examples: "Hello." } })).status, 400);
    assert.equal((await raw("/api/character-voice/save", { ...voiceCall, character: "someone-else", voice: edited })).status, 409);
    await post("/api/character-voice/save", { ...voiceCall, voice: edited });
    await post("/api/character-voice/save", { ...voiceCall, voice: null });
    assert.deepEqual(savedVoices.map(([, voice]) => voice), [{ description: "A test.", examples: ["Hello."], intimateExamples: [] }, null]);
    assert.equal((await post("/api/resume", { session: started.session })).step, current.step, "voices do not advance the game");
    assert.equal((await raw("/api/refresh", { session: started.session })).status, 400);
    assert.equal((await raw("/api/refresh", { session: started.session, step: current.step })).status, 409, "a plain INPUT is not a command screen");
    const module = await fetch(`${base}/interaction-history.js`);
    assert.equal(module.status, 200);
    assert.match(await module.text(), /export function renderCharacterHistory/);
  } finally { app.closeAllConnections(); await new Promise<void>((resolve) => app.close(() => resolve())); }
});

test("character tools query and change real eraTW state, and their room actions run when the screen is redrawn", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  check(runtime.start());
  check(runtime.input("8"));
  let snapshot = check(runtime.input("2"));
  for (let i = 0; snapshot.input?.kind === "wait" && i < 40; i++) snapshot = check(runtime.input(""));
  const reimu = history(snapshot).character;
  assert.equal(reimu.name, "Reimu");
  const tool = (name: string, args: Record<string, unknown> = {}) => runtime.characterTool(reimu.id, name, args);
  const text = (result: Snapshot) => result.output.filter((item) => item.type === "text").map((item) => item.text).join("\n");

  const self = tool("get_character_info").result as Record<string, any>;
  assert.equal(self.fullName, "Hakurei Reimu");
  assert.equal(self.sex, "female");
  assert.equal(self.race, "Human, Shrine Maiden");
  assert.ok(self.traits.includes("Cheerful") && !self.traits.includes("Virgin♂"), "traits are one list without the other sex's virginity");
  assert.equal(self.location, "Player's Back Room");
  assert.equal(self.home, "Reimu's Boudoir (Hakurei Shrine area)");
  assert.equal(self.romanticMood, "0/1500");
  const player = tool("get_character_info", { character: "player" }).result as Record<string, any>;
  assert.equal(player.isPlayer, true);
  assert.equal(player.sex, "male");
  assert.ok(!player.traits.includes("Male") && player.romanticMood === undefined && player.feelingsTowardPlayer === undefined);
  const marisa = tool("get_character_info", { character: "Marisa" }).result as Record<string, any>;
  assert.deepEqual([marisa.location, marisa.myAffinityForThem, marisa.theirAffinityForMe], ["away (not on this map)", 200, 200]);
  assert.match((tool("get_character_info", { character: "nobody at all" }).result as { error: string }).error, /No character is called/);
  const fairies = tool("find_characters", { query: "FAIRY| fairies " }).result as { found: number; characters: string[] };
  assert.equal(fairies.found, 9);
  assert.ok(fairies.characters.includes("Cirno (Fairy, Ice Fairy, female): lives at Ice Igloos (Scarlet Devil Mansion area); now Ice Igloos"));
  assert.deepEqual(tool("find_characters", { query: "nothing-like-this" }).result, { found: 0 });
  assert.match((tool("find_characters", { query: " | " }).result as { error: string }).error, /query is required/);

  // Consent follows the game's own checks: REJECT_CHECK for a kiss, the push-down threshold for sex.
  // The margin is the consent value (-50 here) less what the activity needs: 200 + 50 for an unkissed, reserved Reimu.
  assert.deepEqual(tool("check_consent", { activity: "kiss" }).result, { activity: "kiss", decision: "NO: you absolutely refuse the kiss. Your words and actions must refuse it; it does not happen.", willing: false, answer: "firmly refuses", margin: -300,
    why: "Reimu's feelings, less what it takes: −50 (trust) − 200 (base) − 30 (reserved) − 20 (never kissed) = −300",
    otherActivities: { sex: "firmly refuses", become_lovers: "firmly refuses" } });
  const sex = tool("check_consent", { activity: "sex" }).result as { margin: number; why: string };
  assert.match(sex.why, /^Reimu's feelings, less what it takes: −50 \(trust\) − 350 \(base\) − 50 \(reserved\) \+ 50 \(chastity\) .*\+ \d+ \(pent-up frustration\) = −\d+$/);
  assert.ok(sex.why.endsWith(`= −${-sex.margin}`));
  // 抱き寄せ必要値: 350 + talents, less pent-up frustration (which grows with game time).
  assert.ok(sex.margin < -400 && sex.margin >= -470, String(sex.margin));
  assert.deepEqual(sex, { activity: "sex", decision: "NO: you absolutely refuse sex. Your words and actions must refuse it; it does not happen.", willing: false, answer: "firmly refuses", margin: sex.margin, why: sex.why,
    otherActivities: { kiss: "firmly refuses", become_lovers: "firmly refuses" } });
  assert.match((tool("check_consent", { activity: "hug" }).result as { error: string }).error, /activity must be one of/);
  assert.deepEqual(tool("change_feelings", { favor: 500, trust: -3, reason: "test" }),
    { result: { toward: "Player", favor: { before: 0, after: 50 }, trust: { before: 0, after: 0 } }, changed: true });
  assert.deepEqual(tool("change_feelings", { toward: "Marisa", affinity: -40 }).result.affinity, { before: 200, after: 190 });
  assert.deepEqual(tool("change_mark", { mark: "hate", change: 1 }).result, { mark: "hate", before: 0, after: 1, max: 3 });
  assert.match((tool("change_mark", { mark: "hate", change: -1 }).result as { error: string }).error, /only the player's apology/);
  assert.equal(tool("change_mark", { mark: "love", change: 1 }).changed, false);
  assert.deepEqual(tool("change_mood", { anger: 900, romantic_mood: 20 }).result, { romanticMood: { before: 0, after: 20 }, anger: { before: 0, after: 300 } });
  tool("change_mood", { romantic_mood: 280 });
  assert.deepEqual(tool("check_consent", { activity: "become_lovers" }).result, { activity: "become_lovers", decision: "NO: you absolutely refuse becoming lovers. Your words and actions must refuse it; it does not happen.", willing: false, answer: "firmly refuses", margin: -518,
    why: "Reimu's feelings, less what it takes: −50 (trust) + 12 (romantic mood) − 30 (hate mark) − 350 (base) − 100 (reserved) = −518",
    otherActivities: { kiss: "firmly refuses", sex: "firmly refuses" } },
    "a romantic mood of 300 raised this turn adds 300/25 to the consent value, and the hate mark gained above takes 30 (game patch 4)");
  const scene = tool("describe_scene").result as Record<string, any>;
  assert.equal(scene.time, "07:00, Mon, 1st of Spring, Year 1");
  assert.equal(scene.me.name, "Reimu");
  assert.deepEqual(scene.me.feelingsTowardPlayer, { favor: 50, trust: 0, marks: { hate: 1 } });
  assert.equal(scene.player.isPlayer, true);
  assert.equal(scene.othersHere, "nobody else");
  assert.ok(scene.placesOnThisMap.includes("Kitchen") && new Set(scene.placesOnThisMap).size === scene.placesOnThisMap.length);
  assert.equal((tool("move_to", { destination: "Atlantis" }).result as { error: string }).error.startsWith("Unknown destination"), true);

  assert.equal(tool("act", { text: "Reimu points at the door." }).changed, true);
  assert.equal(tool("say", { text: "Out of my storeroom!" }).changed, true);
  assert.deepEqual(tool("move_to", { destination: "kitchen" }).result.to, "Kitchen");
  assert.equal(tool("say", { text: "Nobody hears this" }).result.heard, false, "after moving away the player cannot hear");
  assert.match((tool("push_down_player").result as { error: string }).error, /not in the same room/);
  assert.throws(() => runtime.input("x"), /whole number/, "players cannot send the refresh sentinel");
  snapshot = check(runtime.refresh());
  assert.match(text(snapshot), /Reimu points at the door\.\n「Out of my storeroom!」\nReimu moves from【Player's Back Room】to the【Kitchen】/);
  assert.doesNotMatch(text(snapshot), /Nobody hears this/);
  for (let i = 0; snapshot.input?.kind === "wait" && i < 10; i++) snapshot = check(runtime.input(""));
  assert.equal(snapshot.input?.kind, "integer");
  assert.equal(check(runtime.refresh()).input?.kind, "integer", "redrawing with nothing queued is harmless");
});

test("the scene describes the other people in the room from the character's point of view", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  check(runtime.start());
  check(runtime.input("8"));
  let snapshot = check(runtime.input("3"));
  for (let i = 0; snapshot.input?.kind === "wait" && i < 40; i++) snapshot = check(runtime.input(""));
  const scene = runtime.characterTool(history(snapshot).character.id, "describe_scene", {}).result as Record<string, any>;
  assert.equal(scene.me.name, "Reimu");
  assert.deepEqual(scene.othersHere, ["Kirisame Marisa (Human, Magician, female, my feelings for them: close (affinity 200%), theirs for me: close (200%))"]);
});

test("what a character says and does in company goes into the others' histories too, under her name", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  check(runtime.start());
  check(runtime.input("8"));
  let snapshot = check(runtime.input("3"));
  for (let i = 0; snapshot.input?.kind === "wait" && i < 40; i++) snapshot = check(runtime.input(""));
  const reimu = history(snapshot).character;
  const records = (runtime as unknown as { interactionHistory: { ids: string[]; person(index: number): { id: string; name: string } | undefined } }).interactionHistory;
  const marisa = records.ids.map((_, i) => records.person(i)).find((person) => person && /Marisa/.test(person.name))!;
  assert.ok(marisa, "Marisa is in the game");
  const text = (line: { runs?: { text: string }[]; text: string }) => line.runs ? line.runs.map((run) => run.text).join("") : line.text;
  const newest = (who: typeof reimu) => runtime.encounterHistory(who).entries[0]!;
  runtime.chatMessage(reimu.id, "Hello");
  runtime.characterTool(reimu.id, "say", { text: "Marisa, behave." });
  runtime.characterTool(reimu.id, "act", { text: "Reimu glares at Marisa." });
  runtime.characterTool(reimu.id, "change_feelings", { favor: 5 });
  runtime.characterTool(marisa.id, "say", { text: "「Who, me?」" });
  assert.deepEqual(newest(reimu).lines.map(text).slice(0, 3), ['"Hello"', "「Marisa, behave.」", "Reimu glares at Marisa."]);
  assert.equal(newest(reimu).lines.map(text)[4], "Marisa: 「Who, me?」", "Reimu hears Marisa");
  assert.deepEqual(newest(marisa).lines.map(text), ["Reimu: 「Marisa, behave.」", "Reimu glares at Marisa.", "「Who, me?」"],
    "Marisa hears and sees Reimu, but not the player's line to her or Reimu's feelings");
  assert.equal(newest(marisa).target, marisa.id);
  // Taking Reimu's lines back takes back what Marisa heard of them.
  runtime.unchat(reimu.id, 3);
  assert.deepEqual(newest(marisa).lines.map(text), ["Reimu: 「Marisa, behave.」", "「Who, me?」"]);
});

test("characters who meet away from the player may pass on news about the player, into both their histories", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  check(runtime.start());
  check(runtime.input("8"));
  let snapshot = check(runtime.input("3"));
  const settle = (next: Snapshot) => {
    for (let i = 0; next.input?.kind === "wait" && i < 80; i++) next = check(runtime.input(""));
    return next;
  };
  snapshot = settle(snapshot);
  const reimu = history(snapshot).character;
  const records = (runtime as unknown as { interactionHistory: { ids: string[]; person(index: number): { id: string; name: string } | undefined } }).interactionHistory;
  const marisa = records.ids.map((_, i) => records.person(i)).find((person) => person && /Marisa/.test(person.name))!;
  const text = (line: { runs?: { text: string }[]; text: string }) => line.runs ? line.runs.map((run) => run.text).join("") : line.text;
  runtime.chatMessage(reimu.id, "*steals Reimu's offering box money*");
  runtime.characterTool(reimu.id, "say", { text: "Hey! Give that back!" });
  assert.equal(check(runtime.refresh()).gossip, undefined, "together with the player is not gossip");
  // Both walk off to the same place, away from the player.
  const scene = runtime.characterTool(reimu.id, "describe_scene", {}).result as { me: { location: string }; placesOnThisMap: string[] };
  const elsewhere = scene.placesOnThisMap.find((place) => place !== scene.me.location)!;
  runtime.characterTool(reimu.id, "move_to", { destination: elsewhere });
  runtime.characterTool(marisa.id, "move_to", { destination: elsewhere });
  snapshot = settle(check(runtime.refresh()));
  const pair = snapshot.gossip?.find((item) => item.teller.id === reimu.id);
  assert.ok(pair, JSON.stringify(snapshot.gossip));
  assert.equal(pair!.listener.id, marisa.id);
  assert.equal(typeof pair!.place, "string");
  assert.match(String(runtime.characterTool(reimu.id, "say", { text: "Hi" }, true).result.error), /not available/, "only tell is speech when aside");
  assert.match(String(runtime.characterTool(reimu.id, "tell", { person: "Marisa", text: "x" }).result.error), /not available/, "tell is only for asides");
  assert.deepEqual(runtime.characterTool(reimu.id, "tell", { person: "Marisa", text: "「The player stole my offerings!」" }, true).result, { told: "Marisa" });
  runtime.characterTool(marisa.id, "change_feelings", { favor: -5, reason: "stealing from Reimu" }, true);
  runtime.characterTool(marisa.id, "tell", { person: "Reimu", text: "No way, ze!" }, true);
  const shared = runtime.encounterHistory(marisa).entries[0]!;
  assert.equal(shared.action.id, "gossip");
  assert.match(shared.action.label, /talked about the player \(the player was not there\)/);
  assert.deepEqual(shared.lines.map(text).map((line) => line.replace(/^(\S+: )change_feelings.*/, "$1change_feelings")),
    ["Reimu: 「The player stole my offerings!」", "Marisa: change_feelings", "Marisa: 「No way, ze!」"]);
  assert.equal(runtime.encounterHistory(reimu).entries[0]!.id, shared.id, "the same event is in Reimu's history");
  assert.equal(check(runtime.refresh()).gossip, undefined, "staying together is not a new meeting");
});

test("a character's memory goes with her history and the save, and is due again once the history moves on and a day passes", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  check(runtime.start());
  check(runtime.input("8"));
  let snapshot = check(runtime.input("2"));
  for (let i = 0; snapshot.input?.kind === "wait" && i < 40; i++) snapshot = check(runtime.input(""));
  const reimu = history(snapshot).character;
  const internals = runtime as unknown as { globals: { get(n: string, i: unknown[], c: unknown): unknown; set(n: string, i: unknown[], v: unknown, c: unknown): void };
    context(g: unknown): unknown; interactionHistory: { checkpoint(save: string, bytes: Buffer): void; restore(save: string, bytes: Buffer): void } };
  const nextDay = () => {
    const context = internals.context(internals.globals);
    internals.globals.set("DAY", [], (internals.globals.get("DAY", [], context) as bigint) + 1n, context);
    let next = check(runtime.refresh());
    for (let i = 0; next.input?.kind === "wait" && i < 40; i++) next = check(runtime.input(""));
    return next;
  };
  runtime.chatMessage(reimu.id, "Hello");
  runtime.characterTool(reimu.id, "say", { text: "Hi." });
  assert.equal(check(runtime.refresh()).memoriesDue, undefined, "only a new day brings memories up to date");
  snapshot = nextDay();
  assert.ok(snapshot.memoriesDue?.some((person) => person.id === reimu.id), JSON.stringify(snapshot.memoriesDue));
  const head = runtime.encounterHistory(reimu).entries[0]!;
  const memory = runtime.rememberCharacter(reimu.id, "The player greeted me politely.", head.id)!;
  assert.equal(memory.day, head.after.day);
  assert.equal(runtime.encounterHistory(reimu).memory?.text, "The player greeted me politely.");
  assert.ok(!nextDay().memoriesDue?.some((person) => person.id === reimu.id), "nothing new since her memory");
  assert.throws(() => runtime.rememberCharacter(reimu.id, "x", "00000000-0000-4000-8000-000000000000"), /not in this character's history/);
  // The memory is kept with the save, like the rest of the history.
  internals.interactionHistory.checkpoint("test", Buffer.from("save"));
  runtime.rememberCharacter(reimu.id, "", null);
  assert.equal(runtime.encounterHistory(reimu).memory, undefined);
  internals.interactionHistory.restore("test", Buffer.from("save"));
  assert.equal(runtime.encounterHistory(reimu).memory?.text, "The player greeted me politely.");
});

test("memory and gossip prompts ask only for what happened, in the character's own words", async () => {
  const { gossipPrompt, memoryMessages, GOSSIP_TOOLS, LISTENER_TOOLS } = await import("../web/llm.js");
  const { historyContext, sinceMemory } = await import("../web/interaction-history.js");
  const reimu = { id: "a", name: "Reimu", number: "1" }, marisa = { id: "b", name: "Marisa", number: "2" };
  const names = (list: { function: { name: string } }[]) => list.map((tool) => tool.function.name);
  assert.deepEqual(names(GOSSIP_TOOLS), ["get_character_info", "find_characters", "tell"]);
  assert.deepEqual(names(LISTENER_TOOLS), ["change_feelings", "change_mark", "tell"]);
  const teller = gossipPrompt({ character: reimu, other: marisa, place: "the Shrine", gameTitle: "eraTW" });
  assert.match(teller, /The player is not there/);
  assert.match(teller, /never anything that is not in the history/);
  const listener = gossipPrompt({ character: marisa, other: reimu, place: "the Shrine", gameTitle: "eraTW", told: "He stole!" });
  assert.match(listener, /Reimu just told Marisa this about the player: 「He stole!」/);
  assert.match(listener, /hearsay counts for less/);
  const [system, user] = memoryMessages({ character: reimu, gameTitle: "eraTW", previous: "Old note.", since: "New stuff." });
  assert.match(system!.content, /first person/);
  assert.match(system!.content, /Never invent events/);
  assert.match(user!.content, /previous memory:\nOld note\.[\s\S]*New stuff\./);
  const entry = (id: string) => ({ id, action: { id: "chat", label: "Conversation" }, participants: [reimu], lines: [], choices: [],
    before: { day: "1", time: ["0", "0", "0", "0", "0"], location: "1", locationName: "Shrine", affection: "0", trust: "0" },
    after: { day: "1", time: ["0", "0", "0", "0", "0"], location: "1", locationName: "Shrine", affection: "0", trust: "0" } });
  const full = { character: reimu, entries: [entry("new"), entry("old")], notice: "", limit: 2,
    memory: { text: "I remember.", covers: "old", day: "1", time: ["600", "0", "0", "0", "0"] } };
  assert.deepEqual(sinceMemory(full).entries.map((item: { id: string }) => item.id), ["new"]);
  assert.match(historyContext(full, 10000), /Reimu's own memory of the player .*as of Day 1, 10:00.*\nI remember\./);
});

test("pushing the player down uses eraTW's forced pushdown when the room is redrawn", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  check(runtime.start());
  assert.throws(() => runtime.refresh(), /command/, "only the command prompt can be redrawn");
  check(runtime.input("8"));
  let snapshot = check(runtime.input("2"));
  for (let i = 0; snapshot.input?.kind === "wait" && i < 40; i++) snapshot = check(runtime.input(""));
  assert.deepEqual(runtime.characterTool(history(snapshot).character.id, "push_down_player", {}).changed, true);
  snapshot = check(runtime.refresh());
  assert.match(snapshot.output.map((item) => item.text ?? "").join("\n"), /You are pushed down!/);
});

test("a player's attempt runs the game's own command, with its rejection and penalties, when the room is redrawn", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  check(runtime.start());
  check(runtime.input("8"));
  let snapshot = check(runtime.input("2"));
  for (let i = 0; snapshot.input?.kind === "wait" && i < 40; i++) snapshot = check(runtime.input(""));
  const id = history(snapshot).character.id;
  const tool = (name: string, args: Record<string, unknown> = {}) => runtime.characterTool(id, name, args);
  // The hotpatched Kiss needs no closeness from earlier small talk: it is offered (behind the Petting filter) at once.
  check(runtime.input("837"));
  snapshot = check(runtime.refresh());
  assert.match(snapshot.output.map((item) => item.text ?? "").join("\n"), /Kiss\[312\][\s\S]*Push Down\[350\][\s\S]*Confess\[352\]/);
  assert.match((tool("player_attempts", { activity: "apologize" }).result as { error: string }).error, /Reimu is not furious with the player/);
  assert.deepEqual(tool("player_attempts", { activity: "kiss" }),
    { result: { note: "The player tries it now; the game decides how you react. The conversation ends here." }, changed: true });
  assert.match((tool("player_attempts", { activity: "sex" }).result as { error: string }).error, /already trying/);
  assert.match((tool("player_attempts", { activity: "hug" }).result as { error: string }).error, /activity must be one of/);
  snapshot = check(runtime.refresh());
  assert.match(snapshot.output.map((item) => item.text ?? "").join("\n"), /You try to kiss Reimu, but[\s\S]*so you give up/);
  for (let i = 0; snapshot.input?.kind === "wait" && i < 20; i++) snapshot = check(runtime.input(""));
  assert.equal(snapshot.input?.kind, "integer");
  const feelings = (tool("get_character_info").result as Record<string, any>).feelingsTowardPlayer;
  assert.deepEqual(feelings.marks, { hate: 1 }, "the unwelcome kiss's antipathy leaves a hate mark");
  const kiss = history(snapshot).entries[0]!;
  assert.equal(kiss.action.label, "Kiss");
  const recorded = kiss.lines.map((line) => line.text).join("");
  assert.match(recorded, /You try to kiss Reimu, but[\s\S]*Reimu: Fear \+\d+, Hostility \+\d+\n[\s\S]*Reimu is angry\.\.\./);
  assert.deepEqual([kiss.before.marks?.hate, kiss.after.marks?.hate], ["0", "1"]);

  // Now she is angry, an apology is the game's Apologize: it may calm her, but without a gift the hate mark stays.
  assert.equal(tool("player_attempts", { activity: "apologize" }).changed, true);
  snapshot = check(runtime.refresh());
  for (let i = 0; snapshot.input?.kind === "wait" && i < 20; i++) snapshot = check(runtime.input(""));
  assert.equal(history(snapshot).entries[0]!.action.label, "Apologize");
  assert.deepEqual((tool("get_character_info").result as Record<string, any>).feelingsTowardPlayer.marks, { hate: 1 });
});

test("a character sulking after a refused push-down stays furious, so she can be apologised to (game patch 5)", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  check(runtime.start());
  check(runtime.input("8"));
  let snapshot = check(runtime.input("2"));
  for (let i = 0; snapshot.input?.kind === "wait" && i < 40; i++) snapshot = check(runtime.input(""));
  const id = history(snapshot).character.id;
  const tool = (name: string, args: Record<string, unknown> = {}) => runtime.characterTool(id, name, args);
  assert.equal(tool("player_attempts", { activity: "sex" }).changed, true);
  snapshot = check(runtime.refresh());
  for (let i = 0; snapshot.input?.kind === "wait" && i < 40; i++) snapshot = check(runtime.input(""));
  assert.equal(history(snapshot).entries[0]!.action.label, "Push Down");
  assert.ok((tool("get_character_info").result as Record<string, any>).feelingsTowardPlayer.marks.hate >= 1);
  // Unpatched, the time that passes after the scene clears her fury (anger was still 0) before the sulk refills it.
  assert.equal(tool("player_attempts", { activity: "apologize" }).changed, true);
});

test("pushing someone down in company gets their own refusal before the group's objection", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  check(runtime.start());
  check(runtime.input("8"));
  let snapshot = check(runtime.input("3"));
  for (let i = 0; snapshot.input?.kind === "wait" && i < 40; i++) snapshot = check(runtime.input(""));
  const id = history(snapshot).character.id;
  runtime.characterTool(id, "change_mark", { mark: "hate", change: 1 });
  const output: string[] = [];
  snapshot = check(runtime.input("350"));
  output.push(...snapshot.output.map((item) => item.text ?? ""));
  for (let i = 0; snapshot.input?.kind === "wait" && i < 20; i++) {
    snapshot = check(runtime.input(""));
    output.push(...snapshot.output.map((item) => item.text ?? ""));
  }
  const text = output.join("\n");
  assert.match(text, /embrace Reimu and the others[\s\S]*Reimu immediately takes a step back[\s\S]*Reimu is angry/);
  assert.doesNotMatch(text, /oppose the idea of having an orgy/);
  const feelings = (runtime.characterTool(id, "get_character_info", {}).result as Record<string, any>).feelingsTowardPlayer;
  assert.deepEqual(feelings.marks, { hate: 3 });
});

test("in an intimate scene the character sees its live state and can run or end scene commands", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  check(runtime.start());
  check(runtime.input("8"));
  let snapshot = check(runtime.input("2"));
  for (let i = 0; snapshot.input?.kind === "wait" && i < 40; i++) snapshot = check(runtime.input(""));
  const id = history(snapshot).character.id;
  const play = (first: ReturnType<Runtime["refresh"]>) => {
    let current = check(first);
    const text = current.output.map((item) => item.text ?? "");
    for (let i = 0; current.input?.kind === "wait" && i < 30; i++) {
      current = check(runtime.input(""));
      text.push(...current.output.map((item) => item.text ?? ""));
    }
    return text.join("\n");
  };
  const scene = () => (runtime.characterTool(id, "describe_scene", {}).result as Record<string, any>).intimateScene;
  assert.equal(scene(), undefined);
  assert.match(String(runtime.characterTool(id, "scene_action", { command: "Kiss" }).result.error), /not in an intimate scene/);
  // Win Reimu over completely, then push her down.
  const runner = runtime as any;
  const context = runner.context(runner.globals);
  const literal = (value: unknown) => ({ kind: "literal", value });
  const target = runner.globals.get("TARGET", [literal(0n)], context);
  for (const [name, key, value] of [["CFLAG", "好感度", 50001n], ["CFLAG", "信頼度", 1001n], ["TALENT", "恋慕", 1n], ["ABL", "親密", 10n]] as const) {
    runner.globals.set(name, [literal(target), literal(key)], value, context);
  }
  // Push Down reads the consent cached by CHARA_ATTITUDE, which check_consent recalculates.
  assert.equal(runtime.characterTool(id, "check_consent", { activity: "sex" }).result.answer, "eager");
  assert.match(play(runtime.input("350")), /take care of me/);
  let state = scene();
  assert.match(state.me.stamina, /^\d+\/\d+$/);
  assert.ok(state.player.vigor && state.player.erection && state.limits);
  assert.equal(state.touching, "nothing right now");
  assert.ok(state.availableCommands.includes("Breast Caress") && state.availableCommands.includes("Kiss"));
  assert.match(String(runtime.characterTool(id, "scene_action", { command: "Fly" }).result.error), /not available now; choose one of: .*Breast Caress/);
  assert.equal(runtime.characterTool(id, "scene_action", { command: "breast caress" }).result.command, "Breast Caress");
  assert.match(play(runtime.refresh()), /caress her breasts/);
  state = scene();
  assert.equal(state.lastCommand, "Breast Caress");
  assert.deepEqual(state.touching, ["the player's fingers on your breasts"]);
  assert.ok(state.me.arousalLevels.breasts >= 1);
  runtime.characterTool(id, "end_scene", {});
  assert.match(play(runtime.refresh()), /it's already over/);
  assert.equal(scene(), undefined);
});

test("the chat window's conversation goes straight into the interaction history and ends at the next command", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  check(runtime.start());
  check(runtime.input("8"));
  let snapshot = check(runtime.input("2"));
  for (let i = 0; snapshot.input?.kind === "wait" && i < 40; i++) snapshot = check(runtime.input(""));
  let shown = history(snapshot);
  const id = shown.character.id;
  const newest = () => runtime.fullCharacterHistory(shown).entries[0];
  const text = (line: { runs?: { text: string }[]; text?: string }) => line.runs ? line.runs.map((run) => run.text).join("") : line.text;
  const before = newest()?.id;
  runtime.chatMessage(id, "Hi *waves* “How are you?”");
  runtime.characterTool(id, "describe_scene", {});
  runtime.characterTool(id, "say", { text: "Fine, thanks." });
  runtime.characterTool(id, "act", { text: "Reimu smiles." });
  runtime.characterTool(id, "change_feelings", { favor: 10, reason: "greeting" });
  runtime.characterTool(id, "move_to", { destination: "the Moon" });
  runtime.characterTool(id, "check_consent", { activity: "kiss" });
  let entry = newest()!;
  assert.equal(entry.action.id, "chat");
  assert.equal(entry.action.label, "Conversation");
  const lines = entry.lines.map(text);
  assert.equal(lines.length, 6, "describe_scene is not recorded");
  // A consent check reads as its answer, coloured by willingness, and the reasons rather than raw JSON.
  assert.match(lines[5]!, /^check_consent\(kiss\) → −50 \(trust\) − 200 \(base\) .* = −\d+ \(Reimu firmly refuses\)\. Will also firmly refuse: sex or becoming lovers$/);
  assert.deepEqual((entry.lines[5] as { runs: { color: string }[] }).runs.map((run) => run.color), ["#6f6f6f", "#a8a8a8", "#e07a7a", "#a8a8a8", "#a8a8a8"]);
  assert.equal(lines[0], '"Hi" *waves* "How are you?"');
  assert.equal(lines[1], "「Fine, thanks.」");
  assert.equal(lines[2], "Reimu smiles.");
  assert.match(lines[3]!, /^change_feelings\(favor \+10\) \(greeting\) → favor \d+ → \d+$/);
  assert.match(lines[4]!, /^move_to\(the Moon\) → failed: /);
  const colors = entry.lines.flatMap((line) => (line as { runs?: { color: string }[] }).runs ?? []).map((run) => run.color);
  for (const color of colors) assert.match(color, /^(?:#[0-9a-f]{3}(?:[0-9a-f]{3})?|[a-z]{1,30})$/i);
  assert.notEqual(colors[1], colors[0], "speech is in the character's dialogue colour");
  assert.equal(colors[3], "#6f6f6f");
  // Undo takes lines back from the end; emptying the conversation removes it.
  runtime.unchat(id, 3);
  assert.equal(newest()!.lines.length, 3);
  runtime.unchat(id, 3);
  assert.equal(newest()?.id, before);
  // The say still plays in the room, and the next command is a separate event.
  runtime.chatMessage(id, "Bye");
  runtime.characterTool(id, "say", { text: "See you." });
  snapshot = check(runtime.refresh());
  assert.match(snapshot.output.map((item) => item.text ?? "").join("\n"), /「See you\.」/);
  shown = history(snapshot);
  entry = newest()!;
  assert.equal(entry.action.id, "chat");
  assert.deepEqual(entry.lines.map(text), ['"Bye"', "「See you.」"]);
  runtime.chatMessage(id, "Again");
  assert.notEqual(newest()!.id, entry.id, "a conversation after the room is redrawn is a new event");
});

test("real eraTW contacts set separate saved penetration flags for group recipients", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  assert.deepEqual(game.variableSizes.get("CFLAG"), [10000]);
  const stub = emptyGame();
  indexScript(stub, `@SYSTEM_TITLE
ADDCHARA 0
ADDCHARA 1
ADDCHARA 2
MASTER = 0
TARGET = 2
FLAG:70 = 1
CALL ADD_TOUCH_SET(0, 1, 1, 6, 0)
CALL ADD_TOUCH_SET(0, 2, 1, 7, 0)
CALL ADD_TOUCH_SET(2, 0, 4, 1, 0)
CALL SOURCE_EXP(1)
CALL SOURCE_EXP(2)
SAVEDATA 0, "pending"
CALL TIMESTOP_RESET(1)
CALL TIMESTOP_RESET(2)
CALL TIMESTOP_RESET(1)
CALL TIMESTOP_RESET(2)
SAVEDATA 1, "consumed"
HTML_PRINT "<div class='era-interaction-history'></div>"
INPUT`, "real-penetration-state.ERB");
  game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
  for (const jit of [false, true]) {
    const saves = new MemorySaveStore();
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { saves, jit });
    const snapshot = check(runtime.start());
    const pending = saves.read("save00.sav"), cleaned = saves.read("save01.sav");
    assert.ok(Buffer.isBuffer(pending) && Buffer.isBuffer(cleaned));
    const before = readNativeSave(pending), after = readNativeSave(cleaned);
    assert.equal(before.characters[1]!.CFLAG?.["7395"], "1");
    assert.equal(before.characters[1]!.CFLAG?.["7396"], undefined);
    assert.equal(before.characters[2]!.CFLAG?.["7395"], undefined);
    assert.equal(before.characters[2]!.CFLAG?.["7396"], "1");
    assert.equal(before.characters[2]!.CFLAG?.["7397"], "1");
    for (const person of [1, 2])
      for (const flag of ["7395", "7396", "7397"])
        assert.equal(after.characters[person]!.CFLAG?.[flag], undefined);
    const result = history(snapshot);
    assert.equal(result.entries.length, 1);
    assert.match(result.entries[0]!.lines[0]!.text, /discomfort inside her bottom/);
    assert.match(result.entries[0]!.lines[0]!.text, /soreness inside her mouth/);
    assert.doesNotMatch(result.entries[0]!.lines[0]!.text, /vagina|semen|time.stop/i);
    assert.equal(saves.list().filter((file) => file.startsWith("era-history-event-")).length, 2);
  }
});

test("Ruukoto's actual first-meeting dialogue is retained without choosing a conversation command", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const stub = emptyGame();
  indexScript(stub, `@SYSTEM_TITLE
CALL MAKE_TALENT_MAP
ADDCHARA 0
ADDCHARA 1
ADDCHARA 2
MASTER = 0
TARGET = 1
FLAG:口上テキスト設定 = 1
CFLAG:2:面識 = 0
CFLAG:MASTER:現在位置 = 9
CFLAG:MASTER:前ターン位置 = 8
CFLAG:2:現在位置 = 9
CFLAG:2:前ターン位置 = 9
CALL AFFAIR_DISCLOSURE(2, 0)
TARGET = 2
HTML_PRINT "<div class='era-interaction-history'></div>"
INPUT`, "ruukoto-history.ERB");
  game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
  const saves = new MemorySaveStore();
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { saves });
  let snapshot = check(runtime.start());
  const displayed: string[] = [];
  for (let i = 0; i < 50; i++) {
    displayed.push(...snapshot.output.flatMap((item) => item.type === "text" ? [item.text + (item.newline ? "\n" : "")] : []));
    if (snapshot.input?.kind !== "wait") break;
    snapshot = check(runtime.input(""));
  }
  assert.equal(snapshot.input?.kind, "integer");
  const result = history(snapshot);
  assert.equal(result.character.number, "2");
  assert.equal(result.entries.length, 1);
  const event = result.entries[0]!;
  assert.deepEqual(event.action, { id: "encounter", label: "First meeting" });
  const captured = event.lines.map((line) => line.text).join("");
  assert.equal(captured, displayed.join(""), "preserve all printed narration and dialogue through the real encounter hooks");
  assert.match(captured, /maid|メイド/);
  assert.ok(captured.length > 200, "capture the actual introduction, not only the first-meeting notification");
  assert.ok(event.lines.every((line) => line.character === result.character.id));
});

test("real eraTW main screen exposes a history placeholder without writing to the installed saves", {
  skip: !existsSync(path.join(GAME_ROOT, "sav", "save00.sav")),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const saves = new MemorySaveStore();
  saves.write("save00.sav", readFileSync(path.join(GAME_ROOT, "sav", "save00.sav")));
  game.routines.set("TEST_ORIGINAL_TARGET_UPDATE", game.routines.get("INFO_RENEW_TARGET")!);
  const stub = emptyGame();
  indexScript(stub, `@INFO_RENEW_TARGET
CALL TEST_ORIGINAL_TARGET_UPDATE
TARGET = 1
TARGET:1 = 1
TFLAG:100 = 1
CFLAG:1:現在位置 = CFLAG:MASTER:現在位置
CFLAG:1:同行 = 1
CFLAG:1:睡眠 = 0`, "history-test-setup.ERB");
  game.routines.set("INFO_RENEW_TARGET", stub.routines.get("INFO_RENEW_TARGET")!);
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { saves });
  let snapshot = check(runtime.start());
  snapshot = check(runtime.input("1"));
  snapshot = check(runtime.input("0"));
  while (snapshot.input?.kind === "wait") snapshot = check(runtime.input(""));
  snapshot = check(runtime.input("100"));
  for (let i = 0; i < 30 && !snapshot.output.some((item) => item.type === "html" && item.text.includes("era-interaction-history")); i++) {
    assert.equal(snapshot.input?.kind, "wait", "only acknowledge intro dialogue, never choose a command");
    snapshot = check(runtime.input(""));
  }
  assert.ok(snapshot.output.some((item) => item.type === "html" && item.text.includes("era-interaction-history")));
  assert.ok(snapshot.characterHistory);
  assert.match(snapshot.characterHistory.notice, /predates/);
  assert.equal(saves.list().filter((file) => file.startsWith("era-history-event-")).length, 0);
  while (snapshot.input?.kind === "wait") snapshot = check(runtime.input(""));
  snapshot = check(runtime.input("300"));
  for (let i = 0; i < 50 && snapshot.input?.kind === "wait"; i++) snapshot = check(runtime.input(""));
  assert.equal(snapshot.input?.kind, "integer");
  const events = saves.list().filter((file) => file.startsWith("era-history-event-"));
  assert.equal(events.length, 1, "actual eraTW command dispatch persists the conversation");
  assert.equal(JSON.parse(String(saves.read(events[0]!))).event.action.id, 300);
  const event = JSON.parse(String(saves.read(events[0]!))).event;
  assert.ok(event.lines.some((line: { text: string }) => line.text.trim()), "actual eraTW post-command dialogue is captured");
});

/** The conformance demo's YuugenMagan scenario: her first-meeting event with the given route, then the main screen. */
async function meetYuugenMagan(route: string) {
  const game = await loadGame();
  await applyHotpatches(game);
  const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  const output: string[] = [];
  const step = (value: string) => {
    let snapshot = check(runtime.input(value));
    output.push(...snapshot.output.map((item) => item.text ?? ""));
    for (let i = 0; snapshot.input?.kind === "wait" && i < 80; i++) {
      snapshot = check(runtime.input(""));
      output.push(...snapshot.output.map((item) => item.text ?? ""));
    }
    return snapshot;
  };
  check(runtime.start());
  check(runtime.input("8"));
  step("12");
  step(route);
  // Her kojo then asks how to build her body; the defaults are fine.
  const snapshot = step("999");
  return { runtime, snapshot, text: output.join("\n") };
}

test("the demo's YuugenMagan scenario plays her first meeting, and her kojo gives the LLM her voice", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const { runtime, snapshot, text } = await meetYuugenMagan("1");
  assert.match(text, /YuugenMagan meets you for the first time[\s\S]*「A meeting is nice\.」/);
  const { character, entries } = history(snapshot);
  assert.equal(character.name, "YuugenMagan");
  assert.equal(entries[0]!.action.label, "First meeting");
  assert.match(entries[0]!.lines.map((line) => line.text).join("\n"), /But you may call Us YuugenMagan/);
  const voice = (runtime.characterTool(character.id, "describe_scene", {}).result as { voice: { description: string; examples: string[] } }).voice;
  assert.match(voice.description, /A mysterious creature from another dimension/);
  assert.doesNotMatch(voice.description, /Dialogue v\d/);
  assert.equal(voice.examples.length, 12);
  assert.ok(voice.examples.filter((line) => /\b(?:We|Us|Our)\b/.test(line)).length >= 4, voice.examples.join("\n"));
  // Lines about sex wait for an intimate scene, and she is not lying about her nature on this route (route 1).
  assert.ok(voice.examples.every((line) => !/\b(?:seed|womb|erect\w*)\b/i.test(line)), voice.examples.join("\n"));
  assert.ok(!voice.examples.some((line) => line.includes("But something tells you")), "the route 0 description line is for route 0");
  assert.deepEqual((runtime.characterTool(character.id, "describe_scene", {}).result as { voice: unknown }).voice, voice, "the same lines each time");
  // The player can edit her voice; the edited one is sent instead until reverted.
  const settings = runtime.characterVoiceSettings(character.id);
  assert.deepEqual(settings.generated.examples, voice.examples);
  assert.equal(settings.generated.description, voice.description);
  assert.equal(settings.generated.intimateExamples.length, 12);
  assert.equal(settings.saved, null);
  runtime.saveCharacterVoice(character.id, { description: "", examples: ["We are pleased."], intimateExamples: ["We are ready."] });
  assert.deepEqual((runtime.characterTool(character.id, "describe_scene", {}).result as { voice: unknown }).voice, { examples: ["We are pleased."] });
  assert.deepEqual(runtime.characterVoiceSettings(character.id).saved, { description: "", examples: ["We are pleased."], intimateExamples: ["We are ready."] });
  runtime.saveCharacterVoice(character.id, null);
  assert.deepEqual((runtime.characterTool(character.id, "describe_scene", {}).result as { voice: unknown }).voice, voice);
});

/** A character steps out of the player's room and back in, so the player runs into her again. */
function stepsOutAndBack(runtime: Runtime, id: string) {
  const settle = (snapshot: Snapshot) => {
    for (let i = 0; snapshot.input?.kind === "wait" && i < 80; i++) snapshot = check(runtime.input(""));
    return snapshot;
  };
  const scene = runtime.characterTool(id, "describe_scene", {}).result as { me: { location: string }; placesOnThisMap: string[] };
  const room = scene.me.location;
  runtime.characterTool(id, "move_to", { destination: scene.placesOnThisMap.find((place) => place !== room) });
  const away = settle(check(runtime.refresh()));
  runtime.characterTool(id, "move_to", { destination: room });
  return { away, back: settle(check(runtime.refresh())), room };
}

test("running into a character is reported with the game's own intro, and the scene gives the day, weather and clothes", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const { runtime, snapshot } = await meetYuugenMagan("1");
  const { character } = history(snapshot);
  assert.equal(snapshot.encounters, undefined, "meeting her at the start is the baseline, not an encounter");
  const scene = runtime.characterTool(character.id, "describe_scene", {}).result as Record<string, any>;
  assert.match(scene.time, /^\d\d:\d\d, [A-Z][a-z]{2}, 1st of Spring, Year 1$/);
  assert.equal(scene.specialDay, "New Year's Day");
  assert.equal(typeof scene.weather, "string");
  assert.ok(scene.me.wearing.includes("Kimono: Kimono"), scene.me.wearing);
  assert.ok(scene.player.wearing.includes("Outer Garment: Jacket"), scene.player.wearing);
  assert.ok(scene.player.wearing.every((item: string) => !/^Underwear/.test(item)), "covered underwear is not visible");
  const { away, back } = stepsOutAndBack(runtime, character.id);
  assert.equal(away.encounters, undefined, "leaving is not an encounter");
  assert.equal(back.encounters?.length, 1);
  const [encounter] = back.encounters!;
  assert.equal(encounter!.character.id, character.id);
  assert.equal(encounter!.arrived, "character");
  assert.match(encounter!.intro ?? "", /happy New Year/, "her scripted New Year greeting is the intro");
  // While the encounter is current her history and tools are open to the LLM, though she is not the selected character.
  assert.equal(runtime.encounterHistory(encounter!.character).character.id, character.id);
  assert.equal(check(runtime.refresh()).encounters, undefined, "redrawing the room is not another encounter");
});

test("an encounter prompts the character to react, or not, with only the tools that fit a chance meeting", async () => {
  const { ENCOUNTER_TOOLS, encounterMessage, systemPrompt } = await import("../web/llm.js");
  const character = { id: "x", name: "Reimu", number: "1" };
  const scene = { me: { location: "Shrine Grounds" } };
  const system = systemPrompt({ character, gameTitle: "eraTW", tools: true, scene, encounter: { character, arrived: "player" } });
  assert.match(system, /has just run into people/);
  assert.match(system, /may speak to anyone here, not only the player/);
  assert.match(system, /feels about the player and anyone else here/);
  assert.match(system, /Saying nothing is often right/);
  assert.match(system, /naked or in underwear/);
  assert.doesNotMatch(system, /player_attempts/);
  assert.deepEqual(ENCOUNTER_TOOLS.map((tool: { function: { name: string } }) => tool.function.name),
    ["get_character_info", "find_characters", "change_feelings", "change_mark", "change_mood", "say", "act", "move_to"]);
  assert.match(encounterMessage({ character, encounter: { character, arrived: "player" }, scene }),
    /^The player has just walked into Shrine Grounds, where Reimu is\.\nThe game showed nothing more\./);
  assert.match(encounterMessage({ character, encounter: { character, arrived: "character", intro: "「Oh, you.」" }, scene }),
    /^Reimu has just walked into Shrine Grounds, where the player is\.\nThe game just showed this .*\n「Oh, you\.」/);
});

test("a character's quoted speech loses the quotes around it, as the game adds its own 「」", async () => {
  const { unquoteSpeech } = await import("../src/character-tools.js");
  assert.equal(unquoteSpeech("「Thank you, and Happy New Year!」"), "Thank you, and Happy New Year!");
  assert.equal(unquoteSpeech("「「Doubled.」」"), "Doubled.");
  assert.equal(unquoteSpeech(" \"Hello.\" "), "Hello.");
  assert.equal(unquoteSpeech("“Hi there.”"), "Hi there.");
  assert.equal(unquoteSpeech("『We see.』"), "We see.");
  // Quotes that are part of the line stay.
  assert.equal(unquoteSpeech("「Hi.」 she says, 「Bye.」"), "「Hi.」 she says, 「Bye.」");
  assert.equal(unquoteSpeech("\"Yes,\" she said, \"no.\""), "\"Yes,\" she said, \"no.\"");
  assert.equal(unquoteSpeech("They call it \"Gensokyo\""), "They call it \"Gensokyo\"");
  assert.equal(unquoteSpeech("「Nested 『quote』 inside.」"), "Nested 『quote』 inside.");
  assert.equal(unquoteSpeech("'Tis the season'"), "'Tis the season'");
});

test("edited character voices are kept in a JSON file by character number", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "era-voices-"));
  try {
    const file = path.join(directory, "sav", "llm-voices.json");
    const store = new FileVoiceStore(file);
    assert.equal(store.load(151), null);
    const voice = { description: "From below.", examples: ["We think not."], intimateExamples: [] };
    store.save(151, voice);
    store.save(1, { ...voice, examples: ["Donations, please."] });
    assert.deepEqual(new FileVoiceStore(file).load(151), voice);
    store.save(1, null);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8"))), ["151"]);
    assert.equal(store.location, file);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const OLLAMA = "http://127.0.0.1:11434";
const OLLAMA_MODEL = "qwen-rp:latest";
const ollama = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(1000) })
  .then(async (response) => ((await response.json()) as { models?: { name: string }[] }).models?.some((model) => model.name === OLLAMA_MODEL) ?? false, () => false);

test("live: running into YuugenMagan lets her react through the LLM (Ollama qwen-rp)", {
  skip: !existsSync(GAME_ROOT) ? "no game" : !ollama ? `Ollama with ${OLLAMA_MODEL} is not running on ${OLLAMA}` : false,
  timeout: 300_000,
}, async (t) => {
  const { runtime, snapshot } = await meetYuugenMagan("1");
  const { character } = history(snapshot);
  const { back } = stepsOutAndBack(runtime, character.id);
  const storage = new Map([["era-typescript.llm", JSON.stringify({ provider: "local", temperature: 0.8, providers: {
    local: { endpoint: `${OLLAMA}/v1`, apiKey: "", model: OLLAMA_MODEL, tools: true } } })]]);
  const realFetch = globalThis.fetch;
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem() {} } });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => url === "/api/llm"
    ? new Response(JSON.stringify(await proxyLlm(JSON.parse(String(init!.body))))) : realFetch(url, init)) as typeof fetch;
  try {
    const { runEncounters, encountersEnabled } = await import("../web/encounters.js");
    const { debugLog } = await import("../web/llm.js");
    assert.ok(encountersEnabled());
    const statuses: string[] = [];
    await runEncounters({
      encounters: back.encounters!, gameId: "test", gameTitle: "eraTW", signal: new AbortController().signal,
      onStatus: (text: string) => statuses.push(text),
      game: {
        history: async () => runtime.encounterHistory(back.encounters![0]!.character),
        runTool: async (id: string, name: string, args: Record<string, unknown>) => runtime.characterTool(id, name, args),
      },
    });
    assert.deepEqual(statuses, ["YuugenMagan noticed you…"]);
    const log = debugLog(`test:${character.id}`);
    assert.ok(log.length >= 1);
    const sent = JSON.stringify(log[0].sent);
    assert.match(sent, /YuugenMagan has just walked into/);
    assert.match(sent, /New Year's Day/);
    assert.match(sent, /happy New Year/);
    t.diagnostic(log.map((entry: { received?: unknown }) => JSON.stringify(entry.received)).join("\n").slice(0, 3000));
  } finally {
    globalThis.fetch = realFetch;
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("live: running into Reimu with Marisa there, she may talk to Marisa too (Ollama qwen-rp)", {
  skip: !existsSync(GAME_ROOT) ? "no game" : !ollama ? `Ollama with ${OLLAMA_MODEL} is not running on ${OLLAMA}` : false,
  timeout: 300_000,
}, async (t) => {
  const game = await loadGame();
  await applyHotpatches(game);
  const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  check(runtime.start());
  check(runtime.input("8"));
  let snapshot = check(runtime.input("3"));
  for (let i = 0; snapshot.input?.kind === "wait" && i < 40; i++) snapshot = check(runtime.input(""));
  const { character } = history(snapshot);
  const { back } = stepsOutAndBack(runtime, character.id);
  assert.equal(back.encounters?.[0]?.character.name, "Reimu");
  const storage = new Map([["era-typescript.llm", JSON.stringify({ provider: "local", temperature: 0.8, providers: {
    local: { endpoint: `${OLLAMA}/v1`, apiKey: "", model: OLLAMA_MODEL, tools: true } } })]]);
  const realFetch = globalThis.fetch;
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem() {} } });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => url === "/api/llm"
    ? new Response(JSON.stringify(await proxyLlm(JSON.parse(String(init!.body))))) : realFetch(url, init)) as typeof fetch;
  try {
    const { runEncounters } = await import("../web/encounters.js");
    const { debugLog } = await import("../web/llm.js");
    await runEncounters({
      encounters: back.encounters!, gameId: "test-marisa", gameTitle: "eraTW", signal: new AbortController().signal,
      game: {
        history: async () => runtime.encounterHistory(back.encounters![0]!.character),
        runTool: async (id: string, name: string, args: Record<string, unknown>) => runtime.characterTool(id, name, args),
      },
    });
    const log = debugLog(`test-marisa:${character.id}`);
    const sent = JSON.stringify(log[0].sent);
    assert.match(sent, /Also here: Kirisame Marisa/);
    assert.match(sent, /may speak to anyone here, not only the player/);
    assert.match(sent, /my feelings for them: close/);
    t.diagnostic(log.map((entry: { received?: any }) => JSON.stringify(entry.received?.choices?.[0]?.message)).join("\n"));
  } finally {
    globalThis.fetch = realFetch;
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("live: the LLM speaks as YuugenMagan does, with her royal We (Ollama qwen-rp)", {
  skip: !existsSync(GAME_ROOT) ? "no game" : !ollama ? `Ollama with ${OLLAMA_MODEL} is not running on ${OLLAMA}` : false,
  timeout: 300_000,
}, async (t) => {
  const { runtime, snapshot } = await meetYuugenMagan("1");
  const { character } = history(snapshot);
  const { buildMessages, converse, systemPrompt, toolsFor } = await import("../web/llm.js");
  const { historyContext } = await import("../web/interaction-history.js");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => url === "/api/llm"
    ? new Response(JSON.stringify(await proxyLlm(JSON.parse(String(init!.body))))) : realFetch(url, init)) as typeof fetch;
  try {
    const said: string[] = [];
    for (const message of ["Hello again! Tell me about yourself. Where do you come from?", "What do you think of Gensokyo?"]) {
      const runTool = async (name: string, args: Record<string, unknown>) => runtime.characterTool(character.id, name, args).result;
      const scene = await runTool("describe_scene", {});
      const { tools } = await converse({
        llm: { provider: "local", endpoint: `${OLLAMA}/v1`, apiKey: "", model: OLLAMA_MODEL, tools: true },
        messages: buildMessages({
          system: systemPrompt({ character, gameTitle: "eraTW", tools: true, scene }),
          context: historyContext(runtime.fullCharacterHistory(history(snapshot)), 24000), scene, message,
        }),
        temperature: 0.8, log: [], runTool, toolset: toolsFor(scene),
      });
      said.push(...tools.filter((tool: { name: string }) => tool.name === "say").map((tool: { arguments: { text: string } }) => tool.arguments.text));
    }
    const speech = said.join("\n");
    t.diagnostic(speech);
    assert.match(speech, /\b(?:We|Us|Our)\b/, speech);
    assert.doesNotMatch(speech, /\b(?:I|I'm|I've|I'd|me|my|mine|myself)\b/, speech);
  } finally { globalThis.fetch = realFetch; }
});

