import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { applyHotpatches, emptyGame, GAME_ROOT, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type Snapshot } from "../src/runtime.js";
import { readNativeSave } from "../src/save-format.js";
import { MemorySaveStore } from "../src/storage.js";
import { demoGame } from "../src/demo.js";

const gameReady = (async () => {
  if (!existsSync(GAME_ROOT)) return undefined;
  const game = await loadGame();
  await applyHotpatches(game);
  const stub = emptyGame();
  indexScript(stub, `@HOTPATCH_TEST_INIT
ADDVOIDCHARA
ADDVOIDCHARA
ADDVOIDCHARA
MASTER = 0
TARGET = 1
NO:0 = 99
NO:1 = 42
NO:2 = 43
CALLNAME:1 = Test Partner
TFLAG:100 = 1
TFLAG:102 = 1
TIME = 100
BASE:MASTER:気力 = 100
MAXBASE:TARGET:酒気 = 100
CFLAG:TARGET:好感度 = 500
CFLAG:TARGET:信頼度 = 10
TALENT:TARGET:思慕 = 1
TALENT:TARGET:225 = 2
@GET_TARGETNUM()
#FUNCTION
RETURNF 1
@CHARA_ATTITUDE
@SYSTEM_LOADEND
@EVENTLOAD
CALL HOTPATCH_TEST_DUMP
PRINTFORML Loaded friendship: {CFLAG:TARGET:7399}
QUIT
@GLOBAL_COMABLE2(ARG)
#FUNCTION
RETURNF 0
@KOJO_CHECK(ARG, ARGS, ARGS:1, ARG:1)
RETURN 0
@HOTPATCH_FACE(ARG, ARG:1)
RESULTS = <img src='test-portrait.png' alt='Test Partner'>
@KOJO_MESSAGE_SEND(ARGS, ARG, ARG:1, ARG:2, ARG:3, ARGS:1)
PRINTFORML Native hook: %ARGS% / %ARGS:1%
RETURN 0
@SF_REASON_MOD(ARGS, ARG)
@SF_DESIRE_MOD(ARGS, ARG)
@ASK_DIARY(ARGS)
@HOTPATCH_ORIGINAL_TURN_RESET
IF SELECTCOM == 352 && TFLAG:193
	TALENT:MASTER:恋人 = NO:TARGET
	TALENT:TARGET:恋人 = 1
	TALENT:TARGET:セフレ = 0
ENDIF
TFLAG:193 = 0
@HOTPATCH_TEST_DUMP
PRINTFORML State: time={TIME}, lover={TALENT:TARGET:恋人}, player={TALENT:MASTER:恋人}, commitment={CFLAG:TARGET:7398}, love={TALENT:TARGET:恋慕}, yearning={TALENT:TARGET:思慕}, casual={TALENT:TARGET:セフレ}, favor={CFLAG:TARGET:好感度}, trust={CFLAG:TARGET:信頼度}, brewing={TALENT:TARGET:225}
@HOTPATCH_TEST_DIALOG
CALL HOTPATCH_TEST_INIT
CFLAG:TARGET:好感度 = 300
CALL HOTPATCH_RELATIONSHIP_DIALOG
PRINTFORML Selected: {RESULT}
CALL HOTPATCH_TEST_DUMP
QUIT
@HOTPATCH_TEST_DIALOG_STATES
CALL HOTPATCH_TEST_INIT
CFLAG:TARGET:好感度 = 300
INPUT
TALENT:TARGET:恋人 = INRANGE(RESULT, 1, 3)
TALENT:TARGET:セフレ = GROUPMATCH(RESULT, 3, 4)
TALENT:TARGET:恋慕 = RESULT == 5
CFLAG:TARGET:7398 = RESULT == 1 ? 1 # RESULT == 2 ? 2 # 0
CALL HOTPATCH_RELATIONSHIP_DIALOG
QUIT
@HOTPATCH_TEST_CONFESSION
CALL HOTPATCH_TEST_INIT
INPUT
CFLAG:TARGET:合意判定 = RESULT
INPUT
TFLAG:192 = RESULT
CALL HOTPATCH_RELATIONSHIP_CONFIRM(1)
CALL COM352
PRINTFORML Result: {RESULT}, success={TFLAG:193}, daily={GETBIT(TFLAG:一日一回, 12)}
CALL HOTPATCH_TEST_DUMP
QUIT
@HOTPATCH_TEST_TRANSITIONS
CALL HOTPATCH_TEST_INIT
TALENT:TARGET:恋人 = 1
TALENT:TARGET:恋慕 = 1
TALENT:TARGET:セフレ = 1
TALENT:MASTER:恋人 = NO:TARGET
TALENT:2:恋人 = 1
SETBIT CFLAG:TARGET:既成事実, 2
SETBIT CFLAG:MASTER:既成事実, 2
EXP:TARGET:愛情経験 = 250
CALL HOTPATCH_RELATIONSHIP_CHANGE(3)
CALL HOTPATCH_TEST_DUMP
EXP:TARGET:愛情経験 = 251
CALL HOTPATCH_RELATIONSHIP_CHANGE(3)
CALL HOTPATCH_TEST_DUMP
CALL HOTPATCH_RELATIONSHIP_CHANGE(5)
CALL HOTPATCH_TEST_DUMP
CALL HOTPATCH_RELATIONSHIP_CHANGE(3)
CALL HOTPATCH_RELATIONSHIP_CHANGE(4)
CALL HOTPATCH_TEST_DUMP
CALL HOTPATCH_RELATIONSHIP_CHANGE(6)
CALL HOTPATCH_TEST_DUMP
CALL HOTPATCH_RELATIONSHIP_CHANGE(7)
CALL HOTPATCH_TEST_DUMP
QUIT
@HOTPATCH_TEST_REASONS
CALL HOTPATCH_TEST_INIT
FLAG:70 = 1
PRINTFORML Reason: %HOTPATCH_RELATIONSHIP_REASON(1, TARGET)%
CALL COM352
FLAG:70 = 0
SETBIT TFLAG:一日一回, 12
PRINTFORML Reason: %HOTPATCH_RELATIONSHIP_REASON(1, TARGET)%
CLEARBIT TFLAG:一日一回, 12
TALENT:2:恋人 = 1
PRINTFORML Reason: %HOTPATCH_RELATIONSHIP_REASON(1, TARGET)%
TALENT:2:恋人 = 0
TALENT:TARGET:恋人 = 1
TALENT:TARGET:一線越えない = 1
EXP:TARGET:愛情経験 = 350
CALL HOTPATCH_RELATIONSHIP_CHANGE(3)
EXP:TARGET:愛情経験 = 351
MARK:TARGET:反発刻印 = 1
CALL HOTPATCH_RELATIONSHIP_CHANGE(3)
MARK:TARGET:反発刻印 = 0
CALL HOTPATCH_RELATIONSHIP_CHANGE(3)
TALENT:TARGET:恋人 = 0
PRINTFORML Active commitment after native breakup: {HOTPATCH_RELATIONSHIP_STATE(TARGET)}
CALL HOTPATCH_TEST_DUMP
QUIT
@HOTPATCH_TEST_CASUAL
CALL HOTPATCH_TEST_INIT
ABL:TARGET:欲望 = 10
ABL:TARGET:従順 = 10
EXP:TARGET:絶頂経験 = 5000
TALENT:MASTER:容姿 = 1
CFLAG:TARGET:既成事実 = 2
CALL HOTPATCH_RELATIONSHIP_CONFIRM(1)
CALL COM357
PRINTFORML Result: {RESULT}
CALL HOTPATCH_TEST_DUMP
QUIT
@HOTPATCH_TEST_CASUAL_REASON
CALL HOTPATCH_TEST_INIT
INPUT
CFLAG:TARGET:好感度 = RESULT
INPUT
TALENT:TARGET:恋人 = RESULT & 1
TALENT:TARGET:恋慕 = RESULT & 2
TALENT:TARGET:愛欲 = RESULT & 4
TALENT:TARGET:セフレ = RESULT & 8
PRINTFORML Reason: [%HOTPATCH_RELATIONSHIP_REASON(2, TARGET)%]
QUIT
@HOTPATCH_TEST_SAVE
CALL HOTPATCH_TEST_INIT
TALENT:TARGET:恋人 = 1
EXP:TARGET:愛情経験 = 251
CALL HOTPATCH_RELATIONSHIP_CHANGE(3)
CALL HOTPATCH_RELATIONSHIP_CHANGE(4)
SAVEDATA 0, "Relationship test"
CFLAG:TARGET:7398 = 0
TALENT:TARGET:225 = 0
LOADDATA 0
CALL HOTPATCH_TEST_DUMP
QUIT
@HOTPATCH_TEST_CONFESSION_RESET
CALL HOTPATCH_TEST_INIT
TALENT:TARGET:セフレ = 1
CFLAG:TARGET:7398 = 2
SELECTCOM = 352
TFLAG:193 = 1
CALL TURN_RESET
CALL HOTPATCH_TEST_DUMP
QUIT`, "<relationship-tests>");
  for (const [name, routines] of stub.routines) game.routines.set(name, routines);
  return game;
})();

function check(snapshot: Snapshot): Snapshot {
  assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
  return snapshot;
}
const text = (snapshot: Snapshot) => snapshot.output.map((item) => item.text ?? "").join("\n");
function settle(runtime: Runtime, snapshot: Snapshot) {
  for (let i = 0; snapshot.input?.kind === "wait"; i++) {
    assert.ok(i < 30, "bounded native dialogue waits");
    snapshot = check(runtime.input(""));
  }
  return snapshot;
}

test("relationship dialog has direct heading actions, unavailable reasons and free cancellation", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = (await gameReady)!;
  for (const jit of [false, true]) {
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit });
    let snapshot = check(runtime.start("HOTPATCH_TEST_DIALOG"));
    assert.match(text(snapshot), /era-dialog era-relationship/);
    assert.match(text(snapshot), /Intimacy <b>0<\/b>/);
    assert.match(text(snapshot), /test-portrait.png/);
    assert.match(text(snapshot), /class='era-relationship-timeline' data-favor='300' data-intimacy='0' data-lover='0' data-in-love='0' data-casual='0' data-commitment='0'/);
    assert.match(text(snapshot), /need to be lovers first/);
    assert.doesNotMatch(text(snapshot), /End the engagement|End the romantic relationship|End FWB|Get married/);
    assert.doesNotMatch(text(snapshot), /Commitment is a choice|era-relationship-status/);
    assert.doesNotMatch(text(snapshot), /era-relationship-icon-none/);
    assert.match(text(snapshot), /Ask to be friends/);
    assert.doesNotMatch(text(snapshot), /required: 200|Current answer|Discuss|No changes until|Ask to become lovers/);
    assert.match(text(snapshot), /<h3[^>]*><button value='1'[^>]*>Confess<\/button><\/h3>/);
    snapshot = check(runtime.input("3"));
    assert.match(text(snapshot), /need to be lovers first/);
    assert.match(text(snapshot), /era-relationship-options/);
    snapshot = check(runtime.input("12345"));
    assert.match(text(snapshot), /Choose a relationship conversation/);
    snapshot = check(runtime.input("999"));
    assert.match(text(snapshot), /Selected: 0/);
    assert.match(text(snapshot), /time=100, lover=0, player=0, commitment=0/);
    assert.match(text(snapshot), /yearning=1, casual=0, favor=300, trust=10, brewing=2/);
    const confirmed = new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit });
    check(confirmed.start("HOTPATCH_TEST_DIALOG"));
    assert.match(text(check(confirmed.input("1"))), /Selected: 1[\s\S]*time=100/);
  }
});

test("demo previews every relationship state and supports proposals without changing the base game", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = (await gameReady)!;
  for (const jit of [false, true]) {
    const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT, { jit });
    assert.match(text(check(runtime.start())), /Relationship dialog states/);
    let snapshot = check(runtime.input("9"));
    assert.equal(snapshot.input?.kind, "integer");
    assert.deepEqual([...text(snapshot).matchAll(/class='era-chip-button era-relationship-demo-state'[^>]*>([^<]+)<\/button>/g)].map((match) => match[1]),
      ["None", "Acquaintance", "Friendship", "Close Friend", "Best Friend", "Almost Family", "In love", "FWB", "Lovers", "Engaged", "Married", "Divorced", "In love + FWB", "In love + Divorced", "Lovers (proposal fails)"]);
    assert.doesNotMatch(text(snapshot), /Preview only|Use the states below|action buttons do not change/);
    assert.doesNotMatch(text(snapshot), /class='era-relationship-icon /);
    for (const [state, icon] of [[103, "love"], [104, "casual"], [105, "love"], [106, "engaged"], [107, "married"], [108, "divorced"], [101, null]] as const) {
      snapshot = check(runtime.input(String(state)));
      const printed = text(snapshot);
      assert.match(printed, new RegExp(`value='${state}'[^>]*aria-pressed='true'`));
      assert.match(printed, new RegExp(`Favor <b>${state === 101 ? 20 : 1000}</b>`));
      if (icon) assert.match(printed, new RegExp(`era-relationship-icon-${icon}`));
      else assert.doesNotMatch(printed, /class='era-relationship-icon /);
      assert.equal(printed.includes("Get married"), state === 106);
      assert.equal(printed.includes("Ask for a divorce"), state === 107);
      assert.equal(printed.includes("End FWB"), state === 104);
      assert.ok(snapshot.output.some((item) => item.type === "clear"), "switching replaces rather than appends the preview");
    }
    snapshot = check(runtime.input("8"));
    assert.match(text(snapshot), /Favor <b>20<\/b>/);
    assert.doesNotMatch(text(snapshot), /now friends|Favor \+100/);
    for (const [state, casual, commitment, label] of [[114, 1, 0, "FWB"], [115, 0, -2, "Divorced"]] as const) {
      snapshot = check(runtime.input(String(state)));
      const printed = text(snapshot);
      assert.match(printed, new RegExp(`value='${state}'[^>]*aria-pressed='true'`));
      assert.match(printed, /Favor <b>1000<\/b>/);
      assert.match(printed, new RegExp(`data-in-love='1' data-casual='${casual}' data-commitment='${commitment}'`));
      assert.match(printed, /class='era-relationship-flag era-relationship-flag-love'>In love</);
      assert.match(printed, new RegExp(`class='era-relationship-flag era-relationship-flag-[a-z]+'>${label}<`));
    }
    snapshot = check(runtime.input("107"));
    for (const [button, favor, label] of [[109, 100, "Acquaintance"], [110, 500, "Friendship"], [111, 1000, "Close Friend"], [112, 10000, "Best Friend"], [113, 30000, "Almost Family"]] as const) {
      snapshot = check(runtime.input(String(button)));
      assert.match(text(snapshot), new RegExp(`Favor <b>${favor}</b>`));
      assert.match(text(snapshot), new RegExp(`value='${button}'[^>]*aria-pressed='true'>${label}</button>`));
      assert.doesNotMatch(text(snapshot), /Ask for a divorce|End FWB/);
      if (favor >= 500) assert.match(text(snapshot), /era-relationship-icon-friends/);
      else assert.doesNotMatch(text(snapshot), /class='era-relationship-icon /);
      assert.equal((text(snapshot).match(/aria-pressed='true'/g) ?? []).length, 1);
    }
    snapshot = check(runtime.input("107"));
    assert.match(text(snapshot), /Favor <b>1000<\/b>/);
    assert.match(text(snapshot), /era-relationship-icon-married/);
    check(runtime.input("105"));
    snapshot = check(runtime.input("3"));
    assert.match(text(snapshot), /Proposing to/);
    snapshot = settle(runtime, check(runtime.input("1")));
    assert.match(text(snapshot), /era-proposal-accepted/);
    snapshot = check(runtime.input("999"));
    assert.match(text(snapshot), /value='106'[^>]*aria-pressed='true'/);
    assert.match(text(snapshot), /data-commitment='1'/);
    assert.doesNotMatch(text(snapshot), />Propose</);
    assert.match(text(check(runtime.input("999"))), /Relationship dialog states/);
  }
  assert.equal(game.routines.has("DEMO_RELATIONSHIP_CONTROLS"), false, "preview controls remain demo-only");
});

async function friendshipRuntime(source: string, jit = true, saves?: MemorySaveStore) {
  const original = (await gameReady)!;
  const game = { ...original, routines: new Map(original.routines) };
  const stub = emptyGame();
  indexScript(stub, `@HOTPATCH_TEST_FRIENDSHIP
CALL HOTPATCH_TEST_INIT
CFLAG:TARGET:好感度 = 0
CFLAG:TARGET:信頼度 = 0
${source}
PRINTFORML Friendship: marker={CFLAG:TARGET:7399}, favor={CFLAG:TARGET:好感度}, active={HOTPATCH_FRIENDSHIP_ACTIVE(TARGET)}, time={TIME}
QUIT`, "<friendship-test>");
  for (const [name, routines] of stub.routines) game.routines.set(name, routines);
  return new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit, ...(saves ? { saves } : {}) });
}

test("one-time friendship bonus adds up to two intimacy toward five only when awarding favor", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const [marker, intimacy, expected] of [[0, 0, 2], [0, 2, 4], [0, 4, 5], [0, 5, 5], [0, 8, 8], [1, 1, 1], [-1, 0, 0]]) {
    const runtime = await friendshipRuntime(`CFLAG:TARGET:7399 = ${marker}
CFLAG:TARGET:好感度 = 500
ABL:TARGET:親密 = ${intimacy}
CALL HOTPATCH_FRIENDSHIP_ACCEPT(TARGET)
PRINTFORML First intimacy: {ABL:TARGET:親密}
ABL:TARGET:親密 = 1
CALL HOTPATCH_FRIENDSHIP_ACCEPT(TARGET)
PRINTFORML Second intimacy: {ABL:TARGET:親密}`);
    const printed = text(check(runtime.start("HOTPATCH_TEST_FRIENDSHIP")));
    assert.ok(printed.includes(`First intimacy: ${expected}`));
    assert.match(printed, /Second intimacy: 1/);
    assert.ok(printed.includes(`favor=${marker === 0 ? 600 : 500},`));
  }
});

test("friendship uses exact favor/trust boundaries and trait modifiers with transparent refusals", { skip: !existsSync(GAME_ROOT) }, async () => {
  const cases: [string, string][] = [
    ["", "know you a bit better"],
    ["TALENT:TARGET:陽気／陰気 = 1\nTALENT:MASTER:魅力 = 1", "accepts your friendship introduction"],
    ["CFLAG:TARGET:好感度 = 199", "know you a bit better"],
    ["CFLAG:TARGET:好感度 = 200", "accepts your friendship introduction"],
    ["CFLAG:TARGET:好感度 = 200\nTALENT:TARGET:一線越えない = 1", "know you a bit better"],
    ["CFLAG:TARGET:好感度 = 300\nTALENT:TARGET:一線越えない = 1", "accepts your friendship introduction"],
    ["CFLAG:TARGET:好感度 = 200\nTALENT:TARGET:性別嗜好 = 3", "know you a bit better"],
    ["CFLAG:TARGET:好感度 = 300\nTALENT:TARGET:性別嗜好 = 3", "accepts your friendship introduction"],
    ["CFLAG:TARGET:好感度 = -50", "do not really know you yet"],
    ["CFLAG:TARGET:好感度 = -51", "do not like you"],
    ["CFLAG:TARGET:信頼度 = -50", "do not really know you yet"],
    ["CFLAG:TARGET:信頼度 = -51", "do not like you"],
    ["CFLAG:TARGET:好感度 = 300\nCFLAG:TARGET:信頼度 = -1", "do not really know you yet"],
    ["CFLAG:TARGET:好感度 = 300\nBASE:TARGET:怒り = 1", "do not like you"],
    ["CFLAG:TARGET:好感度 = 300\nMARK:TARGET:反発刻印 = 1", "do not like you"],
    ["CFLAG:TARGET:好感度 = 300\nRELATION:TARGET:(NO:MASTER) = 59", "do not like you"],
    ["CFLAG:TARGET:好感度 = 300\nRELATION:TARGET:(NO:MASTER) = 60", "accepts your friendship introduction"],
    ["CFLAG:TARGET:好感度 = 400\nTALENT:TARGET:一線越えない = 1\nTALENT:TARGET:性別嗜好 = 3", "accepts your friendship introduction"],
  ];
  for (const jit of [false, true]) for (const [setup, answer] of cases) {
    const runtime = await friendshipRuntime(`${setup}\nCALL HOTPATCH_RELATIONSHIP_CHANGE(8)`, jit);
    const printed = text(check(runtime.start("HOTPATCH_TEST_FRIENDSHIP")));
    assert.match(printed, new RegExp(answer), setup);
    assert.match(printed, /Friendship check: Favor .* \+ trust .* = .*; required: 200/);
    assert.match(printed, /time=110/);
    assert.match(printed, new RegExp(`marker=${answer === "accepts your friendship introduction" ? 1 : 0}`));
  }
});

test("friendship requests are independent of native romantic encounter and story gates", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    const game = { ...(await gameReady)!, routines: new Map((await gameReady)!.routines) };
    indexScript(game, `@HOTPATCH_TEST_FRIENDSHIP_GATES
CALL HOTPATCH_TEST_INIT
CFLAG:TARGET:好感度 = 200
TALENT:TARGET:行きずり = 1
CALL HOTPATCH_RELATIONSHIP_REQUEST(8)
RESULT = 352
CALL USERCOM
PRINTFORML Friend gate: marker={CFLAG:TARGET:7399}, favor={CFLAG:TARGET:好感度}, time={TIME}
QUIT
@GLOBAL_COMABLE2(ARG)
#FUNCTION
RETURNF 1
@KOJO_CHECK(ARG, ARGS, ARGS:1, ARG:1)
RETURN 1`, "<friendship-gates>");
    const printed = text(check(new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit }).start("HOTPATCH_TEST_FRIENDSHIP_GATES")));
    assert.match(printed, /Friend gate: marker=1, favor=300, time=110/);
  }
});

test("friendship follows favor only while bonus history survives falling favor, hate and legacy markers", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    const runtime = await friendshipRuntime(`CFLAG:TARGET:好感度 = 500
CFLAG:2:好感度 = 500
CALL HOTPATCH_FRIENDSHIP_SYNC
CALL HOTPATCH_FRIENDSHIP_SYNC
PRINTFORML Automatic: first={CFLAG:TARGET:好感度}, second={CFLAG:2:好感度}, self={CFLAG:MASTER:7399}
MARK:TARGET:反発刻印 = 1
CALL HOTPATCH_FRIENDSHIP_SYNC
PRINTFORML Hate: {CFLAG:TARGET:7399}, {HOTPATCH_FRIENDSHIP_ACTIVE(TARGET)}
MARK:TARGET:反発刻印 = 0
CFLAG:TARGET:好感度 = 499
CALL HOTPATCH_FRIENDSHIP_SYNC
PRINTFORML Below threshold: {CFLAG:TARGET:7399}, {HOTPATCH_FRIENDSHIP_ACTIVE(TARGET)}
CALL HOTPATCH_RELATIONSHIP_CHANGE(8)
CFLAG:TARGET:好感度 = 500
CFLAG:TARGET:7399 = -1
CALL HOTPATCH_FRIENDSHIP_SYNC`, jit);
    const printed = text(check(runtime.start("HOTPATCH_TEST_FRIENDSHIP")));
    assert.match(printed, /Automatic: first=600, second=600, self=0/);
    assert.match(printed, /Hate: 1, 1/);
    assert.match(printed, /Below threshold: 1, 0/);
    assert.match(printed, /bonus has already been received/);
    assert.match(printed, /marker=-1, favor=500, active=1/);
  }
});

test("friendship status never depends on introduction history or grants a bonus while being read", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    for (const marker of [0, 1, -1]) {
      for (const favor of [100, 499, 500, 1000]) {
        const runtime = await friendshipRuntime(`CFLAG:TARGET:7399 = ${marker}
CFLAG:TARGET:好感度 = ${favor}
PRINTFORML Bonus received: {HOTPATCH_FRIENDSHIP_BONUS_RECEIVED(TARGET)}`, jit);
        const printed = text(check(runtime.start("HOTPATCH_TEST_FRIENDSHIP")));
        assert.match(printed, new RegExp(`Bonus received: ${marker !== 0 ? 1 : 0}`));
        assert.match(printed, new RegExp(`marker=${marker}, favor=${favor}, active=${favor >= 500 ? 1 : 0}`));
      }
    }
  }
});

test("automatic introductions start at favor 400 or intimacy five without prompts or repeated bonuses", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    for (const [favor, intimacy, expected] of [[399, 4, 399], [400, 0, 500], [499, 0, 599], [500, 0, 600], [0, 5, 100], [399, 5, 499]] as const) {
      const runtime = await friendshipRuntime(`CFLAG:TARGET:好感度 = ${favor}
CALL HOTPATCH_FRIENDSHIP_SYNC
ABL:TARGET:親密 = ${intimacy}
PRINTFORML Eligible: [%HOTPATCH_FRIENDSHIP_REASON(TARGET)%]
CALL HOTPATCH_FRIENDSHIP_OFFER
CALL HOTPATCH_FRIENDSHIP_OFFER`, jit);
      const snapshot = check(runtime.start("HOTPATCH_TEST_FRIENDSHIP"));
      assert.doesNotMatch(text(snapshot), /Would you like to be friends|You decline/);
      if (intimacy >= 5 && favor < 500) assert.match(text(snapshot), /Eligible: \[\]/);
      assert.equal(snapshot.input, null);
      assert.match(text(snapshot), new RegExp(`favor=${expected},`));
      assert.match(text(snapshot), /time=100/);
    }
  }
});

test("friendship marker is saved natively and preview exposes the whole formula", { skip: !existsSync(GAME_ROOT) }, async () => {
  const saves = new MemorySaveStore();
  const runtime = await friendshipRuntime(`TALENT:TARGET:陽気／陰気 = 1
TALENT:MASTER:魅力 = 1
TALENT:TARGET:一線越えない = 1
TALENT:TARGET:性別嗜好 = 3
CALL HOTPATCH_FRIENDSHIP_PREVIEW(TARGET)
CFLAG:TARGET:好感度 = 500
CALL HOTPATCH_FRIENDSHIP_SYNC
SAVEDATA 0, "Friendship"
CFLAG:TARGET:7399 = 0
LOADDATA 0`, true, saves);
  const printed = text(check(runtime.start("HOTPATCH_TEST_FRIENDSHIP")));
  assert.match(printed, /100 \(Cheerful\).*100 \(your Charming\).*100 \(Reserved\).*100 \(Misanthrope \/ distrustful\).* = 0; required: 200/);
  assert.match(printed, /At 400 favor/);
  assert.match(printed, /favor being at least 500/);
  const saved = readNativeSave(saves.read("save00.sav")!);
  assert.equal(saved.data.variables.CFLAG?.["1:7399"], "1");
  assert.equal(saved.data.variables.CFLAG?.["1:2"], "600");
  assert.equal(saved.data.variables.TALENT?.["1:225"], "2");
  assert.match(printed, /Loaded friendship: 1/);
  assert.ok(![...(await gameReady)!.names.get("CFLAG")!.values()].includes(7399));
});

test("relationship options and shared icons follow actual commitment rather than encounter availability", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = (await gameReady)!;
  for (const [state, icon] of [[0, "none"], [1, "engaged"], [2, "married"], [3, "love"], [4, "casual"], [5, "love"]] as const) {
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
    check(runtime.start("HOTPATCH_TEST_DIALOG_STATES"));
    const printed = text(check(runtime.input(String(state))));
    if (icon === "none") assert.doesNotMatch(printed, /class='era-relationship-icon /);
    else assert.match(printed, new RegExp(`era-relationship-icon-${icon}`));
    if (state === 1) {
      assert.match(printed, /Get married/);
      assert.match(printed, /End the engagement/);
    } else assert.doesNotMatch(printed, /Get married|End the engagement/);
    if (state === 2) assert.match(printed, /Ask for a divorce/);
    if (state === 3 || state === 4) assert.match(printed, /End FWB/);
    else assert.doesNotMatch(printed, /End FWB/);
    if (state === 0 || state >= 4) assert.doesNotMatch(printed, /End the romantic relationship|Ask for a divorce/);
    if (state === 5) assert.match(printed, /title='In love'/);
    if (state >= 1 && state <= 3) {
      assert.match(printed, /Reaffirm your love/);
      assert.doesNotMatch(printed, />Confess</);
    } else assert.doesNotMatch(printed, /Reaffirm your love/);
    if (state === 1 || state === 2) assert.doesNotMatch(printed, />FWB<|>Propose</);
    const flags = [...printed.matchAll(/class='era-relationship-flag era-relationship-flag-[a-z]+'>([^<]+)<\/span>/g)].map((match) => match[1]);
    assert.deepEqual(flags, state === 1 ? ["Lovers", "Engaged"] : state === 2 ? ["Lovers", "Married"]
      : state === 3 ? ["Lovers", "FWB"] : state === 4 ? ["FWB"] : state === 5 ? ["In love"] : []);
    check(runtime.input("999"));
  }
});

test("relationship summary exposes feelings and agreements independently", { skip: !existsSync(GAME_ROOT) }, async () => {
  const runtime = await friendshipRuntime(`TALENT:TARGET:恋慕 = 1
TALENT:TARGET:恋人 = 1
TALENT:TARGET:セフレ = 1
CFLAG:TARGET:7398 = 2
PRINTFORML %HOTPATCH_RELATIONSHIP_FLAGS(TARGET)%`);
  assert.match(text(check(runtime.start("HOTPATCH_TEST_FRIENDSHIP"))),
    /era-relationship-flag-love'>In love[^]*era-relationship-flag-lovers'>Lovers[^]*era-relationship-flag-fwb'>FWB[^]*era-relationship-flag-married'>Married/);
});

test("native confession keeps strict thresholds and story overrides, with ten-minute attempts", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = (await gameReady)!;
  for (const jit of [false, true]) {
    for (const [agreement, forced, success] of [[350, 0, 0], [351, 0, 1], [0, 1, 1], [999, -1, 0], [999, -2, 0]]) {
      const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit });
      check(runtime.start("HOTPATCH_TEST_CONFESSION"));
      check(runtime.input(String(agreement)));
      const result = check(runtime.input(String(forced)));
      assert.match(text(result), new RegExp(`success=${success}, daily=1`));
      assert.match(text(result), /time=110/);
      assert.doesNotMatch(text(result), /era-dialog/);
      if (!success) assert.match(text(result), /Confession declined:/);
    }
  }
});

test("interactive confession preserves native dialogue, captures the actual check and waits for the Lovers transition", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    for (const [agreement, reserved, override, accepted] of [
      [350, 0, 0, 0], [351, 0, 0, 1], [450, 1, 0, 0], [451, 1, 0, 1],
      [0, 0, 1, 1], [999, 0, -1, 0], [999, 0, -2, 0],
    ]) {
      const runtime = await friendshipRuntime(`TALENT:TARGET:セフレ = 1
TALENT:TARGET:恋慕 = 0
CALL HOTPATCH_RELATIONSHIP_REQUEST(1)
RESULT = 352
CALL USERCOM
CALL HOTPATCH_TEST_DUMP
PRINTFORML Attempt: daily={GETBIT(TFLAG:一日一回, 12)}
@HOTPATCH_ORIGINAL_USERCOM
SELECTCOM = RESULT
CALL KOJO_MESSAGE_SEND("SUCCESS", -1, TARGET, -1, -1)
CALL COM352
LOCAL = RESULT
IF LOCAL > 0
  CALL KOJO_MESSAGE_SEND("COMMAND", -1, TARGET, -1, -1)
ENDIF
CALL TURN_RESET
RETURN LOCAL
@KOJO_MESSAGE_SEND(ARGS, ARG, ARG:1, ARG:2, ARG:3, ARGS:1)
IF ARGS == "SUCCESS"
  CFLAG:TARGET:合意判定 = ${agreement}
  TALENT:TARGET:一線越えない = ${reserved}
  TFLAG:192 = ${override}
ELSEIF ARGS == "COMMAND"
  PRINTFORMW Native character confession dialogue.
  CFLAG:TARGET:合意判定 = 9999
  TALENT:TARGET:一線越えない = 0
ENDIF
RETURN 0`, jit);
      let snapshot = check(runtime.start("HOTPATCH_TEST_FRIENDSHIP"));
      assert.match(text(snapshot), /Confess your feelings to Test Partner/);
      assert.doesNotMatch(text(snapshot), /era-confession|Native character confession/);
      snapshot = check(runtime.input("1"));
      if (override !== -2) {
        assert.match(text(snapshot), /Native character confession dialogue/);
        assert.doesNotMatch(text(snapshot), /era-confession/);
        snapshot = check(runtime.input(""));
      }
      const popup = text(snapshot);
      assert.match(popup, /era-confession/);
      assert.ok(popup.includes(accepted ? "era-proposal-accepted" : "era-proposal-declined"));
      assert.ok(popup.includes(`${agreement - 100 * reserved} &gt; 350`));
      assert.ok(popup.includes(`Agreement (${agreement})`));
      assert.ok(popup.includes(override === 1 ? "Acceptance" : override === -1 ? "Refusal" : override === -2 ? "Interrupted" : "Standard rules"));
      assert.equal(popup.includes("Reserved ("), !!reserved);
      assert.doesNotMatch(popup, /Agreement \(9999\)|You are now engaged|Love experience/);
      snapshot = check(runtime.input("1"));
      assert.ok(snapshot.input, "unrelated input does not run the confession again");
      snapshot = check(runtime.input("999"));
      assert.equal(snapshot.input, null);
      assert.match(text(snapshot), new RegExp(`time=110, lover=${accepted}, player=${accepted ? 42 : 0}, commitment=0, love=0, yearning=1, casual=1`));
      assert.match(text(snapshot), /Attempt: daily=1/);
      assert.doesNotMatch(text(snapshot), /era-confession/);
      if (accepted) assert.match(text(snapshot), /are now lovers/);
    }
  }
});

test("confession popup survives deferred native USERCOM training dispatch and follows post-roll story overrides", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    for (const accepted of [0, 1]) {
      const original = (await gameReady)!;
      const game = { ...original, routines: new Map(original.routines), tables: new Map(original.tables) };
      game.tables.set("TRAIN", new Map([[352, ["Confess"]]]));
      const stub = emptyGame();
      indexScript(stub, `@HOTPATCH_TEST_TRAIN
BEGIN TRAIN
@EVENTTRAIN
CALL HOTPATCH_TEST_INIT
CFLAG:TARGET:合意判定 = ${accepted ? 0 : 999}
@SHOW_STATUS
@SHOW_USERCOM
CALL HOTPATCH_RELATIONSHIP_REQUEST(1)
RESULT = 352
CALL USERCOM
@CAN_COM352(ARG = 0)
RETURN 1
@EVENTCOM
@COM999
RETURN 1
@SOURCE_CHECK
SELECTCOM = TFLAG:3
CALL COM352
PRINTFORMW Native post-roll story.
TFLAG:193 = ${accepted}
@EVENTCOMEND
CALL TURN_RESET
CALL HOTPATCH_TEST_DUMP
QUIT`, "<confession-training-test>");
      for (const [name, routines] of stub.routines) game.routines.set(name, routines);
      const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit });
      assert.match(text(check(runtime.start("HOTPATCH_TEST_TRAIN"))), /Confess your feelings/);
      assert.match(text(check(runtime.input("1"))), /Native post-roll story/);
      const popup = check(runtime.input(""));
      assert.match(text(popup), /era-confession/);
      assert.ok(text(popup).includes(accepted ? "era-proposal-accepted" : "era-proposal-declined"));
      assert.ok(text(popup).includes(accepted ? ">Acceptance</strong>" : ">Refusal</strong>"));
      assert.match(text(popup), />OVERRIDE<\/b>/);
      const result = check(runtime.input("999"));
      assert.equal(result.input, null);
      assert.match(text(result), new RegExp(`time=110, lover=${accepted}`));
    }
  }
});

test("confession cancellation and blocked encounters never run the native command or spend an attempt", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    for (const blocked of [false, true]) {
      const runtime = await friendshipRuntime(`CALL HOTPATCH_RELATIONSHIP_REQUEST(1)
RESULT = 352
CALL USERCOM
CALL HOTPATCH_TEST_DUMP
PRINTFORML Attempt: daily={GETBIT(TFLAG:一日一回, 12)}
@HOTPATCH_ORIGINAL_USERCOM
THROW Native command must not run
@GLOBAL_COMABLE2(ARG)
#FUNCTION
RETURNF ${blocked ? 1 : 0}`, jit);
      let snapshot = check(runtime.start("HOTPATCH_TEST_FRIENDSHIP"));
      if (!blocked) snapshot = check(runtime.input("0"));
      assert.equal(snapshot.input, null);
      assert.match(text(snapshot), /time=100, lover=0, player=0, commitment=0/);
      assert.match(text(snapshot), /Attempt: daily=0/);
      assert.doesNotMatch(text(snapshot), /era-confession/);
      if (blocked) assert.match(text(snapshot), /blocked by the current encounter rules/);
    }
  }
});

test("demo confession cancellation is free and the result updates the existing independent flags", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    const game = { ...(await gameReady)!, routines: new Map((await gameReady)!.routines) };
    const stub = emptyGame();
    indexScript(stub, `@CHARA_ATTITUDE
CFLAG:TARGET:合意判定 = 451`, "<demo-confession-score>");
    for (const [name, routines] of stub.routines) game.routines.set(name, routines);
    const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT, { jit });
    check(runtime.start());
    check(runtime.input("9"));
    check(runtime.input("114"));
    check(runtime.input("1"));
    assert.match(text(check(runtime.input("0"))), /value='114'[^>]*aria-pressed='true'/);
    check(runtime.input("1"));
    const popup = check(runtime.input("1"));
    assert.match(text(popup), /era-confession era-proposal-accepted/);
    const updated = check(runtime.input("999"));
    assert.match(text(updated), /value='105'[^>]*aria-pressed='true'/);
    assert.match(text(updated), /data-in-love='1' data-casual='1'/);
    assert.match(text(updated), /era-relationship-flag-lovers'>Lovers/);
    assert.doesNotMatch(text(updated), />Confess<\/button>/);
  }
});

test("commitment transitions preserve feelings, profession and other lovers while maintaining reciprocal state", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = (await gameReady)!;
  for (const jit of [false, true]) {
    const result = check(new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit }).start("HOTPATCH_TEST_TRANSITIONS"));
    const printed = text(result);
    assert.match(printed, /Proposal declined:[\s\S]*time=110, lover=1, player=42, commitment=0/);
    assert.match(printed, /time=120, lover=1, player=42, commitment=1/);
    assert.match(printed, /time=130, lover=1, player=42, commitment=-1/);
    assert.match(printed, /time=150, lover=1, player=42, commitment=2/);
    assert.match(printed, /time=160, lover=0, player=43, commitment=-2/);
    assert.match(printed, /time=170, lover=0, player=43, commitment=-2/);
    for (const state of printed.split("\n").filter((line) => line.startsWith("State:"))) {
      assert.match(state, /love=1, yearning=1, casual=[01], favor=500, trust=10, brewing=2/);
    }
  }
});

test("proposal popup shows exact checks and resolves once through the real action route", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    for (const [love, reserved, anger, mood, hate, accepted] of [
      [250, 0, 0, 0, 0, 0], [251, 0, 0, 0, 0, 1],
      [350, 1, 0, 0, 0, 0], [351, 1, 0, 0, 0, 1],
      [400, 0, 1, 0, 0, 0], [400, 0, 0, 1, 0, 0],
      [400, 0, 0, 0, 1, 0],
    ]) {
      const runtime = await friendshipRuntime(`TALENT:TARGET:恋人 = 1
TALENT:TARGET:恋慕 = 1
EXP:TARGET:愛情経験 = ${love}
TALENT:TARGET:一線越えない = ${reserved}
BASE:TARGET:怒り = ${anger}
CFLAG:TARGET:不機嫌 = ${mood}
MARK:TARGET:反発刻印 = ${hate}
CALL HOTPATCH_RELATIONSHIP_REQUEST(3)
RESULT = 352
CALL USERCOM
CALL HOTPATCH_TEST_DUMP`, jit);
      let snapshot = check(runtime.start("HOTPATCH_TEST_FRIENDSHIP"));
      assert.match(text(snapshot), /Proposing to Test Partner/);
      assert.match(text(snapshot), /Confirm\?/);
      assert.doesNotMatch(text(snapshot), /era-proposal/);
      snapshot = check(runtime.input("1"));
      assert.match(text(snapshot), /Will you marry me\?/);
      assert.doesNotMatch(text(snapshot), /era-proposal/);
      snapshot = settle(runtime, snapshot);
      const popup = text(snapshot);
      assert.ok(snapshot.input, "popup waits for dismissal");
      assert.ok(popup.includes(`era-proposal-${accepted ? "accepted" : "declined"}`));
      assert.ok(popup.includes(`${love - reserved * 100} &gt; 250`));
      assert.ok(popup.includes(accepted ? "You are now engaged" : "You remain lovers"));
      assert.match(popup, /Time passed: 10 minutes/);
      assert.match(popup, /Love experience/);
      assert.ok(popup.includes(`Love experience (${love})</span>`));
      assert.match(popup, /No unresolved anger or resentment/);
      assert.ok(popup.indexOf("No unresolved anger or resentment") < popup.indexOf("Love experience"));
      assert.match(popup, /era-proposal-love-exp' title='Accumulated love experience between Test Partner and /);
      if (reserved) {
        assert.ok(popup.includes("title='Test Partner has a reserved, deliberate personality.'"));
        assert.ok(popup.includes(`Love experience (${love})</span> - 100`));
        assert.ok(popup.includes(`Reserved (${reserved})</span> = ${love - reserved * 100}`));
      } else {
        assert.doesNotMatch(popup, /Reserved|era-proposal-trait| - 100/);
        assert.ok(popup.includes(`Love experience (${love})</span> = ${love}`));
      }
      assert.doesNotMatch(popup, /The value must be strictly greater|Both checks must pass/);
      snapshot = check(runtime.input("3"));
      assert.ok(snapshot.input, "unrelated input cannot dismiss the proposal");
      assert.doesNotMatch(text(snapshot), /era-proposal|Proposal declined:|You ask Test Partner/);
      snapshot = check(runtime.input("999"));
      const transcript = text(snapshot);
      assert.equal(snapshot.input, null);
      assert.doesNotMatch(transcript, /era-proposal/);
      assert.match(transcript, new RegExp(`time=110, lover=1, player=0, commitment=${accepted}, love=1`));
      assert.equal((transcript.match(/Proposal declined:|You ask Test Partner to marry you/g) ?? []).length, 1);
    }
  }
});

test("demo failed-proposal preset shows a real refusal and normal Lovers restores acceptance", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    const runtime = new Runtime(demoGame((await gameReady)!), GAME_INSTRUCTION_LIMIT, { jit });
    check(runtime.start());
    check(runtime.input("9"));
    const preset = check(runtime.input("116"));
    assert.match(text(preset), /value='116'[^>]*aria-pressed='true'/);
    check(runtime.input("3"));
    const failed = settle(runtime, check(runtime.input("1")));
    assert.match(text(failed), /era-proposal-declined/);
    assert.match(text(failed), /250 &gt; 250/);
    assert.match(text(failed), /You remain lovers/);
    const unchanged = check(runtime.input("999"));
    assert.match(text(unchanged), /value='116'[^>]*aria-pressed='true'/);
    check(runtime.input("105"));
    check(runtime.input("3"));
    assert.match(text(settle(runtime, check(runtime.input("1")))), /era-proposal-accepted/);
  }
});

test("declining the plain-text proposal confirmation is free and does not show a result popup", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    const runtime = await friendshipRuntime(`TALENT:TARGET:恋人 = 1
EXP:TARGET:愛情経験 = 400
CALL HOTPATCH_RELATIONSHIP_REQUEST(3)
RESULT = 352
CALL USERCOM
CALL HOTPATCH_TEST_DUMP`, jit);
    const confirmation = check(runtime.start("HOTPATCH_TEST_FRIENDSHIP"));
    assert.match(text(confirmation), /Proposing to Test Partner/);
    const result = check(runtime.input("0"));
    assert.equal(result.input, null);
    assert.match(text(result), /time=100, lover=1, player=0, commitment=0/);
    assert.doesNotMatch(text(result), /era-proposal|now engaged/);

    const demo = new Runtime(demoGame((await gameReady)!), GAME_INSTRUCTION_LIMIT, { jit });
    check(demo.start());
    check(demo.input("9"));
    check(demo.input("105"));
    check(demo.input("3"));
    const cancelled = check(demo.input("0"));
    assert.match(text(cancelled), /value='105'[^>]*aria-pressed='true'/);
    assert.match(text(cancelled), /data-commitment='0'/);
    assert.doesNotMatch(text(cancelled), /era-proposal-accepted/);
  }
});

test("wedding runs a confirmed text ceremony then celebrates once without a second love check", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    const runtime = await friendshipRuntime(`TALENT:TARGET:恋人 = 1
TALENT:TARGET:恋慕 = 1
CFLAG:TARGET:7398 = 1
EXP:TARGET:愛情経験 = 0
CALL HOTPATCH_RELATIONSHIP_REQUEST(4)
RESULT = 352
CALL USERCOM
CALL HOTPATCH_TEST_DUMP`, jit);
    let snapshot = check(runtime.start("HOTPATCH_TEST_FRIENDSHIP"));
    assert.match(text(snapshot), /Hold your wedding now\?/);
    snapshot = check(runtime.input("1"));
    assert.match(text(snapshot), /make your wedding vows/);
    assert.doesNotMatch(text(snapshot), /era-wedding|now married/);
    snapshot = check(runtime.input(""));
    assert.match(text(snapshot), /beginning of your married life/);
    snapshot = check(runtime.input(""));
    assert.match(text(snapshot), /era-proposal-accepted era-wedding/);
    assert.match(text(snapshot), /Wedding with Test Partner/);
    assert.match(text(snapshot), /You are now married/);
    assert.match(text(snapshot), /Time passed: 10 minutes/);
    assert.doesNotMatch(text(snapshot), /era-proposal-check|PASS|FAIL|Love experience/);
    snapshot = check(runtime.input("4"));
    assert.ok(snapshot.input, "unrelated input cannot repeat or dismiss the wedding");
    snapshot = check(runtime.input("999"));
    assert.equal(snapshot.input, null);
    assert.match(text(snapshot), /time=110, lover=1, player=0, commitment=2, love=1, yearning=1, casual=0, favor=0, trust=0, brewing=2/);
    assert.equal((text(snapshot).match(/You are now married/g) ?? []).length, 1);
  }
});

test("wedding cancellation is free and unresolved resentment preserves engagement", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    for (const safeguard of ["", "BASE:TARGET:怒り = 1", "CFLAG:TARGET:不機嫌 = 1", "MARK:TARGET:反発刻印 = 1"]) {
      const runtime = await friendshipRuntime(`TALENT:TARGET:恋人 = 1
CFLAG:TARGET:7398 = 1
${safeguard}
CALL HOTPATCH_RELATIONSHIP_REQUEST(4)
RESULT = 352
CALL USERCOM
CALL HOTPATCH_TEST_DUMP`, jit);
      let snapshot = check(runtime.start("HOTPATCH_TEST_FRIENDSHIP"));
      if (!safeguard) snapshot = check(runtime.input("0"));
      else assert.match(text(snapshot), /resolve their anger and resentment/);
      assert.equal(snapshot.input, null);
      assert.match(text(snapshot), new RegExp(`time=${safeguard ? 110 : 100}, lover=1, player=0, commitment=1`));
      assert.doesNotMatch(text(snapshot), /era-wedding|now married|make your wedding vows/);
    }
  }
});

test("demo wedding cancellation stays engaged and completion selects Married", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    const runtime = new Runtime(demoGame((await gameReady)!), GAME_INSTRUCTION_LIMIT, { jit });
    check(runtime.start());
    check(runtime.input("9"));
    check(runtime.input("106"));
    check(runtime.input("4"));
    assert.match(text(check(runtime.input("0"))), /value='106'[^>]*aria-pressed='true'/);
    check(runtime.input("4"));
    check(runtime.input("1"));
    check(runtime.input(""));
    assert.match(text(check(runtime.input(""))), /era-wedding/);
    const married = check(runtime.input("999"));
    assert.match(text(married), /value='107'[^>]*aria-pressed='true'/);
    assert.match(text(married), /data-commitment='2'/);
    assert.doesNotMatch(text(married), /Get married/);
  }
});

test("relationship endings confirm freely and resolve once while preserving independent agreements", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    for (const [action, commitment, title] of [
      [5, 1, "Engagement ended"], [6, 0, "Romantic relationship ended"],
      [6, 1, "Romantic relationship ended"], [6, 2, "You are now divorced"],
      [7, 0, "FWB agreement ended"], [7, 2, "FWB agreement ended"],
    ] as const) {
      for (const accept of [false, true]) {
        const runtime = await friendshipRuntime(`TALENT:TARGET:恋人 = 1
TALENT:MASTER:恋人 = NO:TARGET
TALENT:2:恋人 = 1
TALENT:TARGET:恋慕 = 1
TALENT:TARGET:思慕 = 0
TALENT:TARGET:セフレ = 2
CFLAG:TARGET:契約セフレ = 1
CFLAG:TARGET:好感度 = 500
CFLAG:TARGET:信頼度 = 10
CFLAG:TARGET:7398 = ${commitment}
SETBIT CFLAG:TARGET:既成事実, 2
SETBIT CFLAG:MASTER:既成事実, 2
CALL HOTPATCH_RELATIONSHIP_REQUEST(${action})
RESULT = 352
CALL USERCOM
CALL HOTPATCH_TEST_DUMP
PRINTFORML Extras: contract={CFLAG:TARGET:契約セフレ}, targetbit={GETBIT(CFLAG:TARGET:既成事実, 2)}, playerbit={GETBIT(CFLAG:MASTER:既成事実, 2)}, otherlover={TALENT:2:恋人}`, jit);
        const prompt = check(runtime.start("HOTPATCH_TEST_FRIENDSHIP"));
        assert.ok(prompt.input);
        assert.match(text(prompt), /(?:with|to) Test Partner\?/);
        assert.match(text(prompt), /preserved|unchanged/);
        assert.doesNotMatch(text(prompt), /era-relationship-ending/);
        let snapshot = check(runtime.input(accept ? "1" : "0"));
        if (accept) {
          snapshot = settle(runtime, snapshot);
          assert.match(text(snapshot), /era-proposal-declined era-relationship-ending/);
          assert.ok(text(snapshot).includes(title));
          assert.match(text(snapshot), /Time passed: 10 minutes/);
          assert.doesNotMatch(text(snapshot), /era-proposal-accepted|era-proposal-check|PASS|FAIL/);
          snapshot = check(runtime.input(String(action)));
          assert.ok(snapshot.input, "unrelated input does not dismiss or repeat the action");
          snapshot = check(runtime.input("999"));
        }
        assert.equal(snapshot.input, null);
        const lover = accept && action === 6 ? 0 : 1;
        const expectedCommitment = !accept || action === 7 ? commitment
          : action === 5 || commitment === 1 ? -1 : commitment === 2 ? -2 : 0;
        const printed = text(snapshot);
        assert.match(printed, new RegExp(`time=${accept ? 110 : 100}, lover=${lover}, player=${lover ? 42 : 43}, commitment=${expectedCommitment}, love=1, yearning=${accept && action === 7 ? 1 : 0}, casual=${accept && action === 7 ? 0 : 2}, favor=500, trust=10, brewing=2`));
        assert.match(printed, new RegExp(`Extras: contract=${accept && action === 7 ? 0 : 1}, targetbit=${lover}, playerbit=1, otherlover=1`));
        assert.doesNotMatch(printed, /era-relationship-ending/);
      }
    }
  }
});

test("ending the only romantic agreement clears the player's reciprocal lover state", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    const runtime = await friendshipRuntime(`TALENT:TARGET:恋人 = 1
TALENT:MASTER:恋人 = NO:TARGET
SETBIT CFLAG:MASTER:既成事実, 2
CALL HOTPATCH_RELATIONSHIP_CHANGE(6, 1)
PRINTFORML Reciprocal: lover={TALENT:MASTER:恋人}, bit={GETBIT(CFLAG:MASTER:既成事実, 2)}`, jit);
    check(runtime.start("HOTPATCH_TEST_FRIENDSHIP"));
    settle(runtime, check(runtime.input("1")));
    assert.match(text(check(runtime.input("999"))), /Reciprocal: lover=0, bit=0/);
  }
});

test("demo ending actions preserve cancellation, updated flags and former engagement history", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    for (const [state, action, nextState, commitment] of [
      [106, 5, 105, -1], [106, 6, 111, -1], [107, 6, 108, -2],
      [105, 6, 111, 0], [104, 7, 111, 0], [114, 7, 103, 0],
    ]) {
      const runtime = new Runtime(demoGame((await gameReady)!), GAME_INSTRUCTION_LIMIT, { jit });
      check(runtime.start());
      check(runtime.input("9"));
      check(runtime.input(String(state)));
      check(runtime.input(String(action)));
      const cancelled = check(runtime.input("0"));
      assert.match(text(cancelled), new RegExp(`value='${state}'[^>]*aria-pressed='true'`));
      check(runtime.input(String(action)));
      const result = settle(runtime, check(runtime.input("1")));
      assert.match(text(result), /era-relationship-ending/);
      const updated = check(runtime.input("999"));
      assert.match(text(updated), new RegExp(`value='${nextState}'[^>]*aria-pressed='true'`));
      if (commitment) assert.match(text(updated), new RegExp(`data-commitment='${commitment}'`));
      if (action === 7) assert.doesNotMatch(text(updated), /era-relationship-flag-fwb|>End FWB</);
      if (action === 5) assert.match(text(updated), /era-relationship-flag-lovers'>Lovers/);
    }
  }
});

test("confession preserves a casual agreement even after native turn reset clears the success flag", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = (await gameReady)!;
  for (const jit of [false, true]) {
    const printed = text(check(new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit }).start("HOTPATCH_TEST_CONFESSION_RESET")));
    assert.match(printed, /lover=1, player=42, commitment=0/);
    assert.match(printed, /yearning=1, casual=1, favor=500, trust=10, brewing=2/);
  }
});

test("relationship failures are explicit and reserved proposal boundaries respect anger and native breakup", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = (await gameReady)!;
  const printed = text(check(new Runtime(game, GAME_INSTRUCTION_LIMIT).start("HOTPATCH_TEST_REASONS")));
  assert.match(printed, /Resume time/);
  assert.match(printed, /already confessed today/);
  assert.match(printed, /lover limit/);
  assert.match(printed, /love experience \(350\) must be above 350/);
  assert.match(printed, /resolve their anger and resentment/);
  assert.match(printed, /now engaged/);
  assert.match(printed, /Active commitment after native breakup: 0/);
  assert.match(printed, /time=130/);
});

test("casual proposition requires friendship but does not block existing romantic feelings", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = (await gameReady)!;
  for (const [favor, flags, reason] of [
    [499, 0, "You need to be friends first."],
    [500, 0, ""], [500, 1, ""], [500, 2, ""], [500, 4, ""], [500, 7, ""],
    [500, 8, "You already have a friends-with-benefits agreement."],
  ] as const) {
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
    check(runtime.start("HOTPATCH_TEST_CASUAL_REASON"));
    check(runtime.input(String(favor)));
    const result = check(runtime.input(String(flags)));
    assert.ok(text(result).includes(`Reason: [${reason}]`), `favor=${favor}, flags=${flags}: ${text(result)}`);
  }
});

test("native casual agreement retains its character hooks, ten-minute cost and yearning", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = (await gameReady)!;
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  let result = check(runtime.start("HOTPATCH_TEST_CASUAL"));
  const transcript = [text(result)];
  for (let i = 0; result.input?.kind === "wait"; i++) {
    assert.ok(i < 30);
    result = check(runtime.input(""));
    transcript.push(text(result));
  }
  assert.match(text(result), /Result: 1/);
  assert.match(text(result), /time=110/);
  assert.match(text(result), /yearning=1, casual=1/);
  assert.match(transcript.join("\n"), /Native hook: SEX_FRIEND \/ 成功/);
  assert.match(transcript.join("\n"), /being around you makes it awfully hard to behave/);
  assert.match(transcript.join("\n"), /let's enjoy this, you and me/);
});

test("relationship header shows each nonzero Hate Marks level and omits the badge at zero", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    for (const hate of [0, 1, 2, 3]) {
      const runtime = await friendshipRuntime(`MARK:TARGET:反発刻印 = ${hate}
CALL HOTPATCH_RELATIONSHIP_DIALOG`, jit);
      const result = check(runtime.start("HOTPATCH_TEST_FRIENDSHIP"));
      if (hate) {
        assert.match(text(result), new RegExp(`era-relationship-heading'>Test Partner</h2><span class='era-relationship-hate'[^>]*>Hate Marks ${hate}</span>`));
      } else assert.doesNotMatch(text(result), /era-relationship-hate|Hate Marks/);
    }
  }
});

test("FWB refusal has a gentle text response and cancellation never starts the scene", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    for (const accept of [false, true]) {
      const runtime = await friendshipRuntime(`CFLAG:TARGET:好感度 = 500
CALL COM357
CALL HOTPATCH_TEST_DUMP`, jit);
      check(runtime.start("HOTPATCH_TEST_FRIENDSHIP"));
      let snapshot = check(runtime.input(accept ? "1" : "0"));
      const transcript = [text(snapshot)];
      for (let i = 0; snapshot.input?.kind === "wait"; i++) {
        assert.ok(i < 30);
        snapshot = check(runtime.input(""));
        transcript.push(text(snapshot));
      }
      const printed = transcript.join("\n");
      assert.match(text(snapshot), new RegExp(`time=${accept ? 110 : 100}, lover=0, player=0, commitment=0`));
      assert.match(text(snapshot), /casual=0/);
      if (accept) assert.match(printed, /That's okay. I'm still glad I get to spend time with you/);
      else assert.doesNotMatch(printed, /hopeful|That's okay|behave/);
    }
  }
});

test("engagement blocks new FWB propositions even through direct requests", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const commitment of [1, 2]) {
    const runtime = await friendshipRuntime(`TALENT:TARGET:恋人 = 1
CFLAG:TARGET:好感度 = 500
CFLAG:TARGET:7398 = ${commitment}
PRINTFORML FWB reason: %HOTPATCH_RELATIONSHIP_REASON(2, TARGET)%`);
    assert.match(text(check(runtime.start("HOTPATCH_TEST_FRIENDSHIP"))), /End the engagement or marriage before suggesting FWB/);
  }
});

test("reaffirm routes to the native hug command without confession confirmation or commitment changes", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    for (const allowed of [0, 1]) {
      const original = (await gameReady)!;
      const game = { ...original, routines: new Map(original.routines) };
      const stub = emptyGame();
      indexScript(stub, `@HOTPATCH_TEST_REAFFIRM
CALL HOTPATCH_TEST_INIT
TALENT:TARGET:恋人 = 1
CFLAG:TARGET:7398 = 2
CALL HOTPATCH_RELATIONSHIP_REQUEST(9)
RESULT = 352
CALL USERCOM
CALL HOTPATCH_TEST_DUMP
QUIT
@COM_ABLE311
RETURN ${allowed}
@HOTPATCH_ORIGINAL_USERCOM
PRINTFORML Native command: {RESULT}, confirmation={HOTPATCH_RELATIONSHIP_CONFIRM()}
RETURN 0`, "<reaffirm-test>");
      for (const [name, routines] of stub.routines) game.routines.set(name, routines);
      const result = check(new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit }).start("HOTPATCH_TEST_REAFFIRM"));
      if (allowed) {
        assert.match(text(result), /remind Test Partner that you love them/);
        assert.match(text(result), /Native command: 311, confirmation=0/);
      } else {
        assert.match(text(result), /cannot share a hug right now/);
        assert.doesNotMatch(text(result), /Native command:/);
      }
      assert.match(text(result), /commitment=2/);
    }
  }
});

test("casual agreement calculations match TW outside confirmation text and preserved yearning", { skip: !existsSync(GAME_ROOT) }, async () => {
  const original = readFileSync(`${GAME_ROOT}/ERB/コマンド関連/COMF/日常系/COMF357 セフレ契約.ERB`, "utf8");
  const patch = readFileSync(new URL("../hotpatch/RELATIONSHIPS.ERB", import.meta.url), "utf8");
  const normalize = (source: string) => source.split("\n").map((line) => line.replace(/;.*$/, "").replace(/\s+/g, ""))
    .filter((line) => line && !line.startsWith("#DIM"));
  const nativeBody = original.slice(original.indexOf('CALL KOJO_MESSAGE_SEND("SEX_FRIEND"'), original.indexOf(";-------------------------------------------------", original.indexOf("TIME +=10")));
  const patchedBody = patch.slice(patch.indexOf('CALL KOJO_MESSAGE_SEND("SEX_FRIEND"', patch.indexOf("@HOTPATCH_RELATIONSHIP_CASUAL")),
    patch.indexOf("@TURN_RESET"));
  assert.deepEqual(normalize(patchedBody), normalize(nativeBody).filter((line) => line !== "SIF!FLAG:陥落路線変化" && line !== "TALENT:TARGET:思慕=0"));
});

test("commitment round-trips in native saves without repurposing brewing or changing CFLAG size", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = (await gameReady)!;
  assert.deepEqual(game.variableSizes.get("CFLAG"), [10000]);
  assert.ok(![...game.names.get("CFLAG")!.values()].includes(7398), "slot is not assigned a CSV name");
  for (const jit of [false, true]) {
    const saves = new MemorySaveStore();
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { saves, jit });
    const result = check(runtime.start("HOTPATCH_TEST_SAVE"));
    assert.match(text(result), /commitment=2/);
    assert.match(text(result), /brewing=2/);
    const saved = readNativeSave(saves.read("save00.sav")!);
    assert.equal(saved.data.variables.CFLAG?.["1:7398"], "2");
    assert.equal(saved.data.variables.TALENT?.["1:225"], "2");
  }
});
