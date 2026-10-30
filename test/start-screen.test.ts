import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { applyHotpatches, GAME_ROOT, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type Snapshot } from "../src/runtime.js";
import { MemorySaveStore } from "../src/storage.js";
import { patchTitleImage } from "../src/render-patches.js";

function markup(snapshot: Snapshot): string {
  assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
  assert.equal(snapshot.status, "waiting");
  return snapshot.output.flatMap((item) => "text" in item ? [item.text] : []).join("\n");
}

function settle(runtime: Runtime, snapshot: Snapshot): Snapshot {
  for (let step = 0; snapshot.input?.kind === "wait"; step++) {
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    assert.ok(step < 100, "flow reaches an interactive screen");
    snapshot = runtime.input("");
  }
  return snapshot;
}

test("eraTW launch dialogs accept defaults, configure optionally and cancel safely", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const saves = new MemorySaveStore();
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { columns: 180, saves });
  const title = runtime.start();
  assert.match(markup(title), /era-launch-version/);
  assert.doesNotMatch(markup(title), /era-launch-title|eraThe World AnonTW/);
  assert.match(markup(title), /era-launch-art/);
  assert.equal(patchTitleImage(game, title).output.filter((item) => item.type === "title-image").length, 1,
    "the launch screen retains the complete original TW artwork as one cropped image");
  assert.match(markup(runtime.input("1")), /era-dialog era-load/);
  assert.match(markup(runtime.input("1002")), /Page 2 \/ 10/);
  assert.match(markup(runtime.input("1000")), /Page 1 \/ 10/);
  assert.match(markup(runtime.input("0")), /era-save-empty/);
  assert.match(markup(runtime.input("999")), /era-launch-version/);
  assert.match(markup(runtime.input("0")), /era-dialog era-setup/);
  const world = markup(runtime.input("701"));
  assert.match(world, /Map details and room selection/);
  assert.match(world, /Animation: On/);
  assert.match(world, /value='4130' class='era-setup-choice era-current'/);
  assert.doesNotMatch(world, /value='414[123]'/, "normal mode has no extra assertiveness setting");
  assert.match(markup(runtime.input("23")), /Animation: Off/);
  assert.match(markup(runtime.input("23")), /Animation: On/);
  const dialogue = markup(runtime.input("702"));
  assert.match(dialogue, /Alternative dialogue selection/);
  assert.doesNotMatch(dialogue, /Configure dialogue/);
  assert.match(dialogue, /&#10;/, "dialogue descriptions render line breaks");
  assert.doesNotMatch(dialogue, /&lt;br&gt;/, "literal break tags are not shown");
  const dialogueAction = /value='(2\d{4})' class='era-setup-choice/.exec(dialogue)?.[1];
  assert.ok(dialogueAction, "dialogue choices are available inline");
  assert.match(markup(runtime.input(dialogueAction)), new RegExp(`value='${dialogueAction}' class='era-setup-choice era-current'`));
  const bonuses = markup(runtime.input("703"));
  assert.match(bonuses, /Starting money/);
  assert.match(bonuses, /Basic Combat Proficiency/);
  assert.match(bonuses, /value='1000' class='era-setup-choice era-current'/);
  assert.doesNotMatch(bonuses, /Starting bonuses/);
  assert.match(markup(runtime.input("1008")), /value='1008' class='era-setup-choice era-current'/);
  assert.match(markup(runtime.input("1001")), /BONUS CHARACTER/);
  assert.match(markup(runtime.input("10001")), /value='10001' class='era-setup-choice era-current'/);
  markup(runtime.input("1000"));
  const farming = markup(runtime.input("704"));
  const landlordAction = /value='(3\d{4})' class='era-setup-choice/.exec(farming)?.[1];
  assert.ok(landlordAction, "landlords are available inline");
  const contract = markup(runtime.input(landlordAction));
  assert.match(contract, /Initial loan/);
  assert.match(contract, /era-setup-landlord-face'><img src='[^']+' height='74px'/,
    "the selected landlord has a native face portrait");
  assert.match(contract, /Landlord: [^\n]+Initial loan:[\s\S]*You will grow/,
    "landlord and loan details precede the farming description");
  assert.match(contract, /You will grow <strong>[^<]+<\/strong> for .+\. Work the rented plot from <strong>Shrine Approach<\/strong> in <strong>Hakurei Shrine<\/strong> using the field-work action each day\./);
  assert.match(contract, /era-setup-farm-heading'>.*Your home region: <strong>Hakurei Shrine<\/strong>/);
  assert.match(contract, /<strong>Hakurei Shrine<\/strong> \(Home region\)/);
  assert.doesNotMatch(contract, /<strong>Forest Of Magic<\/strong> \(Home region\)/);
  assert.match(contract, /value='3101'[^>]*aria-disabled='false'/);
  assert.match(contract, /No interest; buy your own tools/);
  assert.match(contract, /Strict landlord\. <strong>0\.42%<\/strong> monthly interest; tools lent with monthly fees/);
  assert.match(contract, /Tyrannical landlord\. <strong>5\.0%<\/strong> monthly interest; tools lent with higher monthly fees/);
  assert.match(contract, /CONTRACT TERMS[\s\S]*Normal Peasant[\s\S]*FARMING CONTRACT[\s\S]*No farming contract[\s\S]*value='3\d{4}'/,
    "contract terms are separate from the list containing no contract and landlords");
  assert.match(markup(runtime.input("3103")), /value='3103' class='era-setup-choice era-current'/);
  const noContract = markup(runtime.input("3000"));
  assert.match(noContract, /value='3000' class='era-setup-choice era-current'/);
  assert.doesNotMatch(noContract, /era-setup-landlord-face/);
  assert.match(noContract, /CONTRACT TERMS[\s\S]*Normal Peasant/,
    "contract terms remain visible without a farming contract");
  for (const action of [3101, 3102, 3103]) {
    assert.match(noContract, new RegExp(`value='${action}'[^>]*aria-disabled='true'`));
  }
  assert.match(noContract, /landlord collects the harvest each month/);
  assert.match(markup(runtime.input("3102")), /value='3102'[^>]*aria-disabled='true'/,
    "disabled terms cannot be selected through direct input either");
  markup(runtime.input("701"));
  markup(runtime.input("2005"));
  const forestFarm = markup(runtime.input("704"));
  assert.match(forestFarm, /Your home region: <strong>Forest of Magic<\/strong>/);
  assert.match(forestFarm, /<strong>Forest Of Magic<\/strong> \(Home region\)/);
  assert.doesNotMatch(forestFarm, /<strong>Hakurei Shrine<\/strong> \(Home region\)/);
  const marisaFarm = markup(runtime.input("30011"));
  assert.match(marisaFarm, /Strict landlord\. <strong>0\.50%<\/strong> monthly interest/);
  assert.match(marisaFarm, /Tyrannical landlord\. <strong>6\.0%<\/strong> monthly interest/);
  assert.match(marisaFarm, /Work the rented plot from <strong>Mushroom Colony<\/strong> in <strong>Forest Of Magic<\/strong>/);
  markup(runtime.input("701"));
  markup(runtime.input("2000"));
  const visitingFarm = markup(runtime.input("704"));
  assert.doesNotMatch(visitingFarm, /Work the rented plot from <strong>Mushroom Colony<\/strong>/,
    "outside the home region, the description uses the same travel-map replacement as field work");
  markup(runtime.input("3000"));
  assert.match(markup(runtime.input("705")), /Subtype change chance/);
  assert.match(markup(runtime.input("4201")), /<span>6&#37;<\/span>/);
  markup(runtime.input("4211"));
  markup(runtime.input("701"));
  const restricted = markup(runtime.input("4131"));
  assert.match(restricted, /You cannot confess/);
  assert.match(restricted, /value='4141' class='era-setup-choice era-current'/);
  for (let level = 1; level <= 3; level++) {
    assert.match(markup(runtime.input(String(4140 + level))),
      new RegExp(`value='${4140 + level}' class='era-setup-choice era-current'`));
  }
  const lustMode = markup(runtime.input("4132"));
  assert.match(lustMode, /value='4132' class='era-setup-choice era-current'/);
  assert.match(lustMode, /value='4143' class='era-setup-choice era-current'/,
    "switching mode preserves assertiveness");
  assert.match(lustMode, /You can still confess and use all actions/);
  assert.match(markup(runtime.input("4131")), /value='4143' class='era-setup-choice era-current'/);
  assert.match(markup(runtime.input("4110")), /value='4110' class='era-setup-choice era-current'/);
  markup(runtime.input("4110"));
  const normalMode = markup(runtime.input("4130"));
  assert.match(normalMode, /value='4130' class='era-setup-choice era-current'/);
  assert.doesNotMatch(normalMode, /value='414[123]'/);
  assert.match(markup(runtime.input("2003")), /value='2003' class='era-setup-choice era-current'/);
  assert.match(markup(runtime.input("2000")), /value='2000' class='era-setup-choice era-current'/);
  const characterOptions = markup(runtime.input("700"));
  assert.match(characterOptions, /Customize character/);
  for (const [type, description] of [
    [4, "firefly squid"],
    [5, "Have you forgotten to be considerate of others"],
    [6, "A heart can only pump so much blood"],
  ] as const) {
    assert.match(characterOptions, new RegExp(`value='${1200 + type}'[^<]*>.*?<span class='era-setup-choice-description'>[^<]*${description}`));
  }
  for (let type = 1; type <= 6; type++) {
    const character = markup(runtime.input(String(1200 + type)));
    assert.match(character, new RegExp(`value='${1200 + type}' class='era-setup-choice era-current'`));
    assert.doesNotMatch(character, /era-setup-editor/, "type selection stays inside the setup dialog");
  }
  markup(runtime.input("1203"));
  assert.match(markup(runtime.input("1104")), /value='1104' class='era-setup-choice era-current'/);
  markup(runtime.input("1199"));
  assert.match(markup(runtime.input("10")), /\[9999\] Finished/);
  assert.match(markup(runtime.input("9999")), /Completely finished/);
  assert.match(markup(runtime.input("0")), /Customize character/);
  assert.match(markup(runtime.input("999")), /era-launch-version/);
  assert.deepEqual(saves.list(), [], "canceling setup must not create an autosave");
  assert.match(markup(runtime.input("0")), /Start game/);
  const snapshot = settle(runtime, runtime.input("100"));
  const started = markup(snapshot);
  assert.match(started, /era-layout era-shop/, "defaults reach the normal wake-up screen");
  assert.match(started, /50,000/, "starting bonus is applied exactly once");
  assert.doesNotMatch(started, /Select Mode|Select a place to stay|Some characters have alternative dialogue options|Here some various settings/);
  assert.match(markup(settle(runtime, runtime.input("100"))), /era-room-stage/, "Wake Up reaches the main screen");

  const saved = saves.read("save99.sav");
  assert.ok(Buffer.isBuffer(saved), "new game produces a native autosave");
  saves.write("save00.sav", saved);
  const resumed = new Runtime(game, GAME_INSTRUCTION_LIMIT, { columns: 180, saves });
  resumed.start();
  const picker = markup(resumed.input("1"));
  assert.match(picker, /value='0' class='era-save-slot'/);
  assert.doesNotMatch(picker, /Select slot to save|Overwrite/);
  const loaded = settle(resumed, resumed.input("0"));
  assert.equal(loaded.error, null, JSON.stringify(loaded.error));
  assert.doesNotMatch(markup(loaded), /era-dialog era-load/, "selecting a native save leaves the picker");

  const configured = new Runtime(game, GAME_INSTRUCTION_LIMIT, { columns: 180 });
  configured.start();
  configured.input("0");
  assert.match(markup(configured.input("11")), /Select a character to play as/);
  assert.match(markup(settle(configured, configured.input("26"))), /Raise it to 2000/);
  assert.match(markup(configured.input("0")), /Be a virgin/);
  assert.match(markup(settle(configured, configured.input("0"))), /era-setup-name'>Yukari/);
  const home = markup(configured.input("701"));
  assert.match(home, /value='2006' class='era-setup-choice era-current'/, "predefined characters retain their own home");
  assert.match(markup(configured.input("999")), /era-launch-version/);

  indexScript(game, `@TEST_INLINE_SETUP
CALL MAKE_TALENT_MAP
CALL Name_Array_Set
CALL ADDCHARA_INIT(0)
CALL HOTPATCH_NEWGAME_PREPARE
PRINTFORML bonus=%ニューゲーム特典%;combat={ABL:MASTER:戦闘能力};money={MONEY};clothes={CFLAG:MASTER:基本服装セット};map={MAIN_MAP};farm={FLAG:農民難易度};tools={ITEM:園芸用品一式};loan={FLAG:地主貸付金};expansion={FLAG:畑拡張};confession={FLAG:甲斐性無};lust={FLAG:LUSTMODE};shape={TALENT:MASTER:形状}
QUIT`, "TEST_INLINE_SETUP.ERB");
  const inline = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  markup(inline.start("TEST_INLINE_SETUP"));
  markup(inline.input("703"));
  for (let bonus = 0; bonus < 12; bonus++) {
    assert.match(markup(inline.input(String(1000 + bonus))),
      new RegExp(`value='${1000 + bonus}' class='era-setup-choice era-current'`),
      `bonus ${bonus} can be selected without a submenu or confirmation`);
  }
  markup(inline.input("1008"));
  markup(inline.input("700"));
  markup(inline.input("1104"));
  markup(inline.input("1204"));
  markup(inline.input("701"));
  markup(inline.input("2003"));
  markup(inline.input("4132"));
  markup(inline.input("4142"));
  markup(inline.input("704"));
  markup(inline.input(landlordAction));
  markup(inline.input("3102"));
  const accepted = inline.input("100");
  assert.equal(accepted.error, null, JSON.stringify(accepted.error));
  assert.equal(accepted.status, "halted", "inline choices do not leave questionnaire prompts at Start Game");
  const values = accepted.output.flatMap(item => "text" in item ? [item.text] : []).join("\n");
  assert.match(values, /combat=2;money=0;clothes=4;map=3;farm=2;tools=1;loan=\d+;expansion=2;confession=2;lust=1;shape=4/);
});
