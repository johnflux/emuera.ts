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

function fixture(enabled = true) {
  const game = emptyGame();
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
  test(`all pending time-resume aftereffects are logged in English (JIT ${jit})`, () => {
    for (const [strength, virginity, expected] of [
      [31, 1, ["intense wave of unexplained pleasure", "sudden pain between her legs"]],
      [1, 2, ["sudden feeling of unexplained pleasure", "sudden pain between her legs"]],
    ] as const) {
      const game = fixture(), stub = emptyGame(), saves = new MemorySaveStore();
      indexScript(stub, `@COM400
EX:2:50 = ${strength}
EX:2:70 = ${virginity}
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
    const file = `era-history-event-${event.id}.json`;
    const legacy = JSON.parse(String(saves.read(file)));
    legacy.event.action = { id: "time-resumed", label: "Time resumes" };
    legacy.event.lines[0].text = "Bob's underwear is missing when time resumes.";
    saves.write(file, JSON.stringify(legacy));
    assert.deepEqual(history(runtime.input("2")).entries, result.entries, "legacy entries are sanitized on read");
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
PRINTL Source processing is not dialogue.
CALL KOJO_MESSAGE_SEND("COMMAND", 300, TARGET)
CALL COM_KOJO_CALL(TARGET, 300)
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
    assert.doesNotMatch(captured, /processing|status|Menu/);
    assert.ok(event.lines.every((line) => line.character === event.target));
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
  const app = createApp([{ id: "tw", title: "Test", game: fixture(), saves: new MemorySaveStore() }]);
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
    const module = await fetch(`${base}/interaction-history.js`);
    assert.equal(module.status, 200);
    assert.match(await module.text(), /export function renderCharacterHistory/);
  } finally { app.closeAllConnections(); await new Promise<void>((resolve) => app.close(() => resolve())); }
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
