import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { applyHotpatches, emptyGame, GAME_ROOT, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type Snapshot } from "../src/runtime.js";
import { readNativeSave } from "../src/save-format.js";
import { MemorySaveStore } from "../src/storage.js";

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
CALL HOTPATCH_RELATIONSHIP_DIALOG
PRINTFORML Selected: {RESULT}
CALL HOTPATCH_TEST_DUMP
QUIT
@HOTPATCH_TEST_DIALOG_STATES
CALL HOTPATCH_TEST_INIT
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

test("relationship dialog shows portrait, accurate reasons and a free confirmation/cancellation flow", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = (await gameReady)!;
  for (const jit of [false, true]) {
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit });
    let snapshot = check(runtime.start("HOTPATCH_TEST_DIALOG"));
    assert.match(text(snapshot), /era-dialog era-relationship/);
    assert.match(text(snapshot), /test-portrait.png/);
    assert.match(text(snapshot), /need to be lovers first/);
    assert.doesNotMatch(text(snapshot), /End the engagement|End the romantic relationship|End friends with benefits|Get married/);
    assert.doesNotMatch(text(snapshot), /Commitment is a choice|era-relationship-status/);
    assert.match(text(snapshot), /era-relationship-icon-none/);
    assert.equal((text(snapshot).match(/class='era-relationship-option-action'/g) ?? []).length, 4);
    assert.match(text(snapshot), /Ask to be friends/);
    assert.match(text(snapshot), /Favor 500 \+ trust 10 = 510; required: 200/);
    snapshot = check(runtime.input("1"));
    assert.match(text(snapshot), /Confirm: Confess your love/);
    snapshot = check(runtime.input("0"));
    assert.match(text(snapshot), /era-relationship-options/);
    snapshot = check(runtime.input("12345"));
    assert.match(text(snapshot), /Choose a relationship conversation/);
    snapshot = check(runtime.input("999"));
    assert.match(text(snapshot), /Selected: 0/);
    assert.match(text(snapshot), /time=100, lover=0, player=0, commitment=0/);
    assert.match(text(snapshot), /yearning=1, casual=0, favor=500, trust=10, brewing=2/);
    const confirmed = new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit });
    check(confirmed.start("HOTPATCH_TEST_DIALOG"));
    check(confirmed.input("1"));
    assert.match(text(check(confirmed.input("100"))), /Selected: 1[\s\S]*time=100/);
  }
});

async function friendshipRuntime(source: string, jit = true, saves?: MemorySaveStore) {
  const original = (await gameReady)!;
  const game = { ...original, routines: new Map(original.routines) };
  indexScript(game, `@HOTPATCH_TEST_FRIENDSHIP
CALL HOTPATCH_TEST_INIT
CFLAG:TARGET:好感度 = 0
CFLAG:TARGET:信頼度 = 0
${source}
PRINTFORML Friendship: marker={CFLAG:TARGET:7399}, favor={CFLAG:TARGET:好感度}, active={HOTPATCH_FRIENDSHIP_ACTIVE(TARGET)}, time={TIME}
QUIT`, "<friendship-test>");
  return new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit, ...(saves ? { saves } : {}) });
}

test("friendship uses exact favor/trust boundaries and trait modifiers with transparent refusals", { skip: !existsSync(GAME_ROOT) }, async () => {
  const cases: [string, string][] = [
    ["", "know you a bit better"],
    ["TALENT:TARGET:陽気／陰気 = 1\nTALENT:MASTER:魅力 = 1", "now friends"],
    ["CFLAG:TARGET:好感度 = 199", "know you a bit better"],
    ["CFLAG:TARGET:好感度 = 200", "now friends"],
    ["CFLAG:TARGET:好感度 = 200\nTALENT:TARGET:一線越えない = 1", "know you a bit better"],
    ["CFLAG:TARGET:好感度 = 300\nTALENT:TARGET:一線越えない = 1", "now friends"],
    ["CFLAG:TARGET:好感度 = 200\nTALENT:TARGET:性別嗜好 = 3", "know you a bit better"],
    ["CFLAG:TARGET:好感度 = 300\nTALENT:TARGET:性別嗜好 = 3", "now friends"],
    ["CFLAG:TARGET:好感度 = -50", "do not really know you yet"],
    ["CFLAG:TARGET:好感度 = -51", "do not like you"],
    ["CFLAG:TARGET:信頼度 = -50", "do not really know you yet"],
    ["CFLAG:TARGET:信頼度 = -51", "do not like you"],
    ["CFLAG:TARGET:好感度 = 300\nCFLAG:TARGET:信頼度 = -1", "do not really know you yet"],
    ["CFLAG:TARGET:好感度 = 300\nBASE:TARGET:怒り = 1", "do not like you"],
    ["CFLAG:TARGET:好感度 = 300\nMARK:TARGET:反発刻印 = 1", "do not like you"],
    ["CFLAG:TARGET:好感度 = 300\nRELATION:TARGET:(NO:MASTER) = 59", "do not like you"],
    ["CFLAG:TARGET:好感度 = 300\nRELATION:TARGET:(NO:MASTER) = 60", "now friends"],
    ["CFLAG:TARGET:好感度 = 400\nTALENT:TARGET:一線越えない = 1\nTALENT:TARGET:性別嗜好 = 3", "now friends"],
  ];
  for (const jit of [false, true]) for (const [setup, answer] of cases) {
    const runtime = await friendshipRuntime(`${setup}\nCALL HOTPATCH_RELATIONSHIP_CHANGE(8)`, jit);
    const printed = text(check(runtime.start("HOTPATCH_TEST_FRIENDSHIP")));
    assert.match(printed, new RegExp(answer), setup);
    assert.match(printed, /Friendship check: Favor .* \+ trust .* = .*; required: 200/);
    assert.match(printed, /time=110/);
    assert.match(printed, new RegExp(`marker=${answer === "now friends" ? 1 : 0}`));
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

test("friendship automatic recognition is per-character, once only, and hate revokes without resetting the bonus", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    const runtime = await friendshipRuntime(`CFLAG:TARGET:好感度 = 500
CFLAG:2:好感度 = 500
CALL HOTPATCH_FRIENDSHIP_SYNC
CALL HOTPATCH_FRIENDSHIP_SYNC
PRINTFORML Automatic: first={CFLAG:TARGET:好感度}, second={CFLAG:2:好感度}, self={CFLAG:MASTER:7399}
MARK:TARGET:反発刻印 = 1
CALL HOTPATCH_FRIENDSHIP_SYNC
PRINTFORML Revoked: {CFLAG:TARGET:7399}, {HOTPATCH_FRIENDSHIP_ACTIVE(TARGET)}
MARK:TARGET:反発刻印 = 0
CALL HOTPATCH_FRIENDSHIP_SYNC
PRINTFORML Still lapsed: {CFLAG:TARGET:7399}
CALL HOTPATCH_RELATIONSHIP_CHANGE(8)`, jit);
    const printed = text(check(runtime.start("HOTPATCH_TEST_FRIENDSHIP")));
    assert.match(printed, /Automatic: first=600, second=600, self=0/);
    assert.match(printed, /Revoked: -1, 0/);
    assert.match(printed, /Still lapsed: -1/);
    assert.match(printed, /bonus has already been received/);
    assert.match(printed, /marker=1, favor=600, active=1/);
  }
});

test("friendship offers start at 400, declining sets 399 and stops repetition, accepting awards exactly 100", { skip: !existsSync(GAME_ROOT) }, async () => {
  for (const jit of [false, true]) {
    for (const [favor, choice, expected] of [[399, null, 399], [400, "1", 399], [499, "1", 399], [400, "0", 500], [500, null, 600]] as const) {
      const runtime = await friendshipRuntime(`CFLAG:TARGET:好感度 = ${favor}
CALL HOTPATCH_FRIENDSHIP_SYNC
CALL HOTPATCH_FRIENDSHIP_OFFER
CALL HOTPATCH_FRIENDSHIP_OFFER`, jit);
      let snapshot = check(runtime.start("HOTPATCH_TEST_FRIENDSHIP"));
      if (choice !== null) {
        assert.match(text(snapshot), /asks: "Would you like to be friends/);
        assert.equal(snapshot.input?.kind, "integer");
        snapshot = check(runtime.input(choice));
      }
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
  assert.match(printed, /At 500 favor/);
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
    assert.match(printed, new RegExp(`era-relationship-icon-${icon}`));
    if (state === 1) {
      assert.match(printed, /Get married/);
      assert.match(printed, /End the engagement/);
    } else assert.doesNotMatch(printed, /Get married|End the engagement/);
    if (state === 2) assert.match(printed, /Ask for a divorce/);
    if (state === 3 || state === 4) assert.match(printed, /End friends with benefits/);
    else assert.doesNotMatch(printed, /End friends with benefits/);
    if (state === 0 || state >= 4) assert.doesNotMatch(printed, /End the romantic relationship|Ask for a divorce/);
    if (state === 5) assert.match(printed, /title='In love'/);
    check(runtime.input("999"));
  }
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

test("native casual agreement retains its character hooks, ten-minute cost and yearning", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = (await gameReady)!;
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  const result = settle(runtime, check(runtime.start("HOTPATCH_TEST_CASUAL")));
  assert.match(text(result), /Result: 1/);
  assert.match(text(result), /time=110/);
  assert.match(text(result), /yearning=1, casual=1/);
  assert.match(text(result), /Native hook: SEX_FRIEND \/ 成功/);
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
