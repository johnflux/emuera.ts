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
  indexScript(game, `@TEST_FIXED_RESOURCE_BARS
HTML_PRINT HOTPATCH_BAR("Sta", 800, 1600, "era-sta", "Stamina", 1)
HTML_PRINT HOTPATCH_BAR("Ene", 2400, 2800, "era-ene", "Energy", 1)
HTML_PRINT HOTPATCH_BAR("Drnk", 20, 80, "era-drnk", "Drunkenness")
HTML_PRINT HOTPATCH_BAR("Vig", 600, 800, "era-vig", "Vigor")
HTML_PRINT HOTPATCH_BAR("Comp", 1200, 1500, "era-composure", "Composure")
INPUT
QUIT`, "TEST_FIXED_RESOURCE_BARS.ERB");
  const barMarkup = markup(new Runtime(game, GAME_INSTRUCTION_LIMIT).start("TEST_FIXED_RESOURCE_BARS"));
  assert.match(barMarkup, /value='1600' max='2000'/);
  assert.match(barMarkup, /value='800' max='2000'/);
  assert.match(barMarkup, /era-bar-overflow.*value='800' max='2000'.*value='400' max='2000'/);
  assert.match(barMarkup, /value='20' max='80'/, "other resource bars keep their native scale");
  assert.match(barMarkup, /value='800' max='1000'.*value='600' max='1000'/);
  assert.match(barMarkup, /era-bar-overflow.*value='500' max='1000'.*value='200' max='1000'/);
  indexScript(game, `@TEST_BODY_BULK_FEEDBACK
CALL MAKE_TALENT_MAP
CALL Name_Array_Set
CALL ADDCHARA_INIT(0)
CALL ADDCHARA_INIT(1)
TALENT:1:無知 = 0
CALL HOTPATCH_SETUP_CHARACTER_BODY_ACTION(10)
PRINTFORML clueless={TALENT:1:無知};virgin={TALENT:1:処女}
CALL HOTPATCH_SETUP_CHARACTER_BODY_ACTION(15)
PRINTFORML butt={TALENT:1:ヒップサイズ}
INPUT
QUIT`, "TEST_BODY_BULK_FEEDBACK.ERB");
  const bulkValues = markup(new Runtime(game, GAME_INSTRUCTION_LIMIT).start("TEST_BODY_BULK_FEEDBACK"));
  assert.match(bulkValues, /clueless=1;virgin=1/);
  assert.match(bulkValues, /butt=4/);
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
  const initialSetup = markup(runtime.input("0"));
  assert.match(initialSetup, /era-dialog era-setup/);
  assert.match(initialSetup, /value='715' class='era-sheet-subpage era-current'>Body/);
  assert.doesNotMatch(initialSetup, />Back to title<\/button>/);
  const world = markup(runtime.input("701"));
  assert.match(world, /era-setup-world/);
  assert.match(world, /era-setup-indent'><button value='23'/);
  assert.match(world, /era-setup-indent'><button value='20'/);
  assert.doesNotMatch(world, /You can also change this in game options later/);
  for (const heading of ["Home", "Romance Mode", "Pregnancy Restrictions", "Lunatic Survival", "Map Display"]) {
    assert.ok(world.includes(`class='era-launch-eyebrow'>${heading}</span>`));
  }
  assert.match(world, /Map details and room selection/);
  assert.match(world, /Animation: On/);
  assert.match(world, /value='4130' class='era-setup-choice era-current'/);
  assert.doesNotMatch(world, /value='414[123]'/, "normal mode has no extra assertiveness setting");
  assert.match(markup(runtime.input("23")), /Animation: Off/);
  assert.match(markup(runtime.input("23")), /Animation: On/);
  const dialogue = markup(runtime.input("702"));
  assert.match(dialogue, /era-setup-dialogue/);
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
  assert.match(markup(runtime.input("1001")), /Bonus Character/);
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
  assert.match(contract, /Contract Terms[\s\S]*Normal Peasant[\s\S]*Farming Contract[\s\S]*No farming contract[\s\S]*value='3\d{4}'/,
    "contract terms are separate from the list containing no contract and landlords");
  assert.match(markup(runtime.input("3103")), /value='3103' class='era-setup-choice era-current'/);
  const noContract = markup(runtime.input("3000"));
  assert.match(noContract, /value='3000' class='era-setup-choice era-current'/);
  assert.doesNotMatch(noContract, /era-setup-landlord-face/);
  assert.match(noContract, /Contract Terms[\s\S]*Normal Peasant/,
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
  const yandere = markup(runtime.input("705"));
  assert.match(yandere, /Subtype change chance/);
  assert.match(yandere, /era-setup-setting era-setup-percent/);
  for (const heading of ["Yandere Settings", "Triggers", "Event Frequency"]) {
    assert.ok(yandere.includes(`class='era-launch-eyebrow'>${heading}</span>`));
  }
  assert.match(markup(runtime.input("4201")), /value='9900'[^>]*>6<\/button>&#37;/);
  assert.match(markup(runtime.input("4160027")), /value='9900'[^>]*>27<\/button>/);
  assert.match(markup(runtime.input("4160101")), /value='9900'[^>]*>27<\/button>/,
    "direct percentage edits reject values above 100");
  assert.match(markup(runtime.input("4190037")), /value='9903'[^>]*>37<\/button>/);
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
  const mansionWorld = markup(runtime.input("2003"));
  assert.match(mansionWorld, /value='2003' class='era-setup-choice era-current'/);
  assert.match(mansionWorld, /era-setup-help-row'>.*value='4120'.*character behaviour\. <button value='32'/);
  assert.match(markup(runtime.input("2000")), /value='2000' class='era-setup-choice era-current'/);
  markup(runtime.input("700"));
  const characterOptions = markup(runtime.input("710"));
  assert.match(characterOptions, /era-setup-player-face/);
  assert.match(characterOptions, /Human · Male · Adult/);
  assert.match(characterOptions, /value='715'[^>]*>Body/);
  assert.ok(characterOptions.indexOf("value='715'") < characterOptions.indexOf("value='710'"));
  assert.match(characterOptions, /era-setup-name-field'>Player<\/span><span>Nickname:<\/span>/);
  assert.doesNotMatch(characterOptions, /PLAYER ·|Custom character|Predefined character/);
  assert.doesNotMatch(characterOptions, /value='500[01]'/);
  assert.doesNotMatch(characterOptions, /Customize character/);
  assert.match(characterOptions, /value='1199' class='era-setup-choice era-current'[^>]*>.*Default.*Men's clothing/);
  assert.ok(characterOptions.indexOf("value='1199'") < characterOptions.indexOf("value='1101'"),
    "Default is the first clothing option");
  assert.match(characterOptions, /value='700' class='era-sheet-subpage era-current'>Player/);
  assert.doesNotMatch(characterOptions, /Character Bodies|value='26'/);
  const otherCharacters = markup(runtime.input("706"));
  assert.match(otherCharacters, /value='706' class='era-sheet-subpage era-current'>Characters/);
  assert.match(otherCharacters, /Character Bodies[\s\S]*value='45001'[^>]*>Individual Settings/);
  assert.doesNotMatch(otherCharacters, /Idividual|\[0\] Finished|value='26'/);
  assert.match(markup(runtime.input("45013")), /Character Bodies[\s\S]*Individual Settings/,
    "bulk body settings return directly to the Characters tab");
  assert.equal((otherCharacters.match(/class='era-setup-character-action'/g) ?? []).length, 21);
  assert.match(markup(runtime.input("45010")), /Applied: Everyone Is Clueless\./);
  assert.doesNotMatch(otherCharacters, /Customize character|Penis Size/);
  markup(runtime.input("700"));
  const bodyOptions = markup(runtime.input("715"));
  assert.match(bodyOptions, /era-setup-body-options/);
  assert.match(bodyOptions, /value='100212' class='era-setup-choice era-current'/);
  assert.match(bodyOptions, /value='100211'[^>]*>.*Female/);
  assert.doesNotMatch(bodyOptions, /Breast Size/);
  assert.match(bodyOptions, /Butt Size/);
  assert.match(bodyOptions, /era-launch-eyebrow'>Animal Ears/);
  assert.match(bodyOptions, /era-launch-eyebrow'>Cat Tongue/);
  assert.match(bodyOptions, /value='105410'[^>]*>.*<span class='era-setup-choice-description'><\/span>/);
  assert.match(bodyOptions, /value='114310'[^>]*>.*<span class='era-setup-choice-description'><\/span>/);
  assert.match(bodyOptions, /value='100213'[^>]*>.*Has both genitals\./);
  for (let value = 1; value <= 4; value++) {
    assert.match(bodyOptions, new RegExp(`value='${114310 + value}'[^>]*>.*<span class='era-setup-choice-description'>Can go into heat; dislikes washing; prefers Doggy Style; matching Fortune boosts Favor/Trust\\.</span>`));
  }
  assert.match(bodyOptions, /era-launch-eyebrow'>Figure/);
  assert.match(bodyOptions, /Very small or large bodies cannot use many commands without Forbidden Knowledge/);
  assert.match(bodyOptions, /Large differences in body size make insertion harder/);
  for (const [value, name, description] of [
    [-5, "Inchling", "Tiny enough to fit in a hand. More Pain; less Desire from most commands, less C/V/A/B/M Pleasure and Lubrication. Can be used as an onahole."],
    [-2, "Child-Sized", "A small frame, about the size of a child."],
    [-1, "Petite", "Shorter and smaller-framed than average."],
    [0, "Adult", "An ordinary adult height and build."],
    [1, "Tall", "Taller than average."],
    [2, "Huge", "An unusually large frame, towering over most people."],
    [5, "Giant", "A gigantic body, far beyond human proportions."],
  ] as const) {
    assert.match(bodyOptions, new RegExp(`value='${110010 + value}'[^>]*>.*${name}`));
    const figureChoice = bodyOptions.match(new RegExp(`value='${110010 + value}'[^>]*>.*?</button>`))?.[0];
    assert.ok(figureChoice?.includes(`<span class='era-setup-choice-description'>${description}</span>`));
    assert.match(markup(runtime.input(String(110010 + value))),
      new RegExp(`value='${110010 + value}' class='era-setup-choice era-current'`));
  }
  assert.doesNotMatch(bodyOptions, /Indicates the body size/);
  markup(runtime.input("110010"));
  assert.match(markup(runtime.input("105411")), /value='105411' class='era-setup-choice era-current'/);
  markup(runtime.input("105410"));
  assert.match(markup(runtime.input("114314")), /value='114314' class='era-setup-choice era-current'/);
  markup(runtime.input("114310"));
  assert.match(markup(runtime.input("130090")), /Human · Male · Adult/);
  assert.match(markup(runtime.input("6090")), /Human · Male · Adult/);
  assert.match(markup(runtime.input("6091")), /Human · Male · Adult/);
  assert.doesNotMatch(bodyOptions, /value='130\d+'|value='11(?:64|66|9\d)\d+'/,
    "locked races show neither race choices nor sub-options");
  assert.equal((bodyOptions.match(/Unlocks in New Game\+/g) ?? []).length, 1);
  assert.match(bodyOptions, /era-setup-description era-setup-locked'>Unlocks in New Game/);
  assert.doesNotMatch(bodyOptions, /value='119112'/, "unselected races have no sub-options");
  assert.doesNotMatch(bodyOptions, /Indicates the butt size/);
  const blockedRace = markup(runtime.input("130191"));
  assert.match(blockedRace, /Human · Male · Adult/);
  const femaleBody = markup(runtime.input("100211"));
  assert.match(femaleBody, /Human · Female · Adult/);
  assert.match(femaleBody, /Flat chest; some breast actions unavailable/);
  assert.match(femaleBody, /Average size/);
  assert.doesNotMatch(femaleBody, /Penis Size/);
  const restoredMale = markup(runtime.input("100212"));
  assert.match(restoredMale, /Human · Male · Adult/);
  assert.match(bodyOptions, /value='101710' class='era-setup-choice era-current'[^>]*>.*Adult/);
  assert.match(bodyOptions, /value='101709'[^>]*>.*Child/);
  assert.match(bodyOptions, /value='101711'[^>]*>.*Middle Age/);
  assert.match(bodyOptions, /value='101712'[^>]*>.*Elder/);
  for (const action of [101709, 101710, 101711, 101712]) {
    assert.match(bodyOptions, new RegExp(`value='${action}'[^>]*>.*<span class='era-setup-choice-description'></span>`));
  }
  assert.doesNotMatch(bodyOptions, /Physically /);
  assert.doesNotMatch(bodyOptions, /Shows the physical age of the character/);
  assert.doesNotMatch(characterOptions, /Penis Size/);
  assert.match(bodyOptions, /era-launch-eyebrow'>Penis Size/);
  assert.ok(bodyOptions.indexOf("era-launch-eyebrow'>Race") < bodyOptions.indexOf("era-launch-eyebrow'>Butt Size"));
  for (const [type, description] of [
    [4, "firefly squid"],
    [5, "Have you forgotten to be considerate of others"],
    [6, "A heart can only pump so much blood"],
  ] as const) {
    assert.match(bodyOptions, new RegExp(`value='${1200 + type}'[^<]*>.*?<span class='era-setup-choice-description'>[^<]*${description}`));
  }
  for (let type = 1; type <= 6; type++) {
    const character = markup(runtime.input(String(1200 + type)));
    assert.match(character, new RegExp(`value='${1200 + type}' class='era-setup-choice era-current'`));
    assert.doesNotMatch(character, /era-setup-editor/, "type selection stays inside the setup dialog");
  }
  markup(runtime.input("1203"));
  markup(runtime.input("710"));
  assert.match(markup(runtime.input("1104")), /value='1104' class='era-setup-choice era-current'/);
  assert.match(markup(runtime.input("1199")), /value='1199' class='era-setup-choice era-current'/);
  assert.match(markup(runtime.input("5000")), /enter a new name/);
  assert.match(markup(runtime.input("")), /era-setup-player/);
  assert.match(markup(runtime.input("5101")), /<span>STA<\/span>.*value='9500'[^>]*>1600<\/button>/);
  markup(runtime.input("5100"));
  assert.match(markup(runtime.input("161734")), /value='9500'[^>]*>1734<\/button>/);
  assert.match(markup(runtime.input("160499")), /value='9500'[^>]*>1734<\/button>/,
    "direct STA edits enforce the displayed minimum");
  markup(runtime.input("161500"));
  assert.match(markup(runtime.input("172234")), /value='9501'[^>]*>2234<\/button>/);
  markup(runtime.input("172000"));
  const traits = markup(runtime.input("711"));
  assert.match(traits, /value='711' class='era-sheet-subpage era-current'>Traits/);
  assert.doesNotMatch(traits, /Cat Tongue|Animal Ears|Kitsune|Youko|Figure/);
  assert.match(traits, /Select a trait/);
  assert.match(traits, /era-setup-trait-help-text/);
  assert.doesNotMatch(traits, /value='6191'|Unlocks in New Game/);
  assert.doesNotMatch(traits, /value='6002'|value='6105'|value='6108'|Penis Size/);
  assert.match(traits, /class='era-setup-trait[^']*' aria-disabled='[^']*' title='[^']+'/,
    "native trait descriptions are available as tooltips");
  assert.doesNotMatch(traits, /era-setup-choice-name/);
  assert.doesNotMatch(traits, /era-setup-editor/);
  markup(runtime.input("715"));
  const futanariBody = markup(runtime.input("6002")); // Native default becomes women's clothing.
  assert.match(futanariBody, /value='100213' class='era-setup-choice era-current'/);
  markup(runtime.input("6105"));
  assert.match(markup(runtime.input("6105")), /value='110510' class='era-setup-choice era-current'/);
  assert.match(markup(runtime.input("710")), /Default.*Women's clothing/);
  markup(runtime.input("711"));
  markup(runtime.input("6002"));
  markup(runtime.input("6002"));
  const maleTraits = markup(runtime.input("715"));
  assert.match(maleTraits, /value='100212' class='era-setup-choice era-current'/,
    "native sex cycling returns to Male, never no sex");
  const buttSizes = [];
  for (let step = 0; step < 8; step++) {
    const body = markup(runtime.input(String(110800 + step + 7)));
    buttSizes.push(/value='1108\d+' class='era-setup-choice era-current'[^>]*><span class='era-setup-choice-name'>([^<]+)/.exec(body)?.[1]);
  }
  assert.equal(new Set(buttSizes).size, 8, "all eight native butt sizes have distinct labels");
  assert.ok(buttSizes.every((size) => size && size !== "-"), "no unnamed butt sizes");
  const middleAge = markup(runtime.input("101711"));
  assert.match(middleAge, /Human · Male · Adult/);
  assert.match(middleAge, /value='101711' class='era-setup-choice era-current'/);
  markup(runtime.input("101710"));
  const abilities = markup(runtime.input("712"));
  assert.match(abilities, /Sensitivity &amp; Response/);
  assert.match(abilities, /Your sensitivity and response to pleasure and others/);
  assert.match(abilities, /Sensitivity &amp; Response Details/);
  assert.match(abilities, /era-setup-detail' title='C Sense: sensitivity/);
  const abilityIncrease = /value='(7\d{2}[13579])'[^>]*aria-disabled='false'/.exec(abilities)?.[1];
  assert.ok(abilityIncrease, "eligible abilities have inline controls");
  const abilityIndex = Math.floor((Number(abilityIncrease) - 7000) / 2);
  assert.match(markup(runtime.input(String(160000 + (100 + abilityIndex) * 10000 + 2))),
    new RegExp(`value='${9600 + abilityIndex}'[^>]*>2</button>`));
  assert.match(markup(runtime.input(String(160000 + (100 + abilityIndex) * 10000 + 3))),
    new RegExp(`value='${9600 + abilityIndex}'[^>]*>2</button>`),
    "direct ability edits reject values above 2");
  assert.doesNotMatch(markup(runtime.input(abilityIncrease)), /era-setup-editor/);
  const experience = markup(runtime.input("713"));
  assert.match(experience, /Starting experience \(0-30\): records of past activities and encounters/);
  assert.match(experience, /Experience Details/);
  assert.match(experience, /Past experience of clitoral or penile stimulation/);
  assert.match(experience, /Train Masturb Exp/);
  assert.doesNotMatch(experience, /Training Masturb Exp/);
  const inlineExperience = markup(runtime.input("140009"));
  assert.doesNotMatch(inlineExperience, /title='(?:Decrease|Increase|Enter a value)/);
  assert.match(markup(runtime.input("2160012")), /value='9700'[^>]*>12<\/button>/);
  assert.match(markup(runtime.input("2160031")), /value='9700'[^>]*>12<\/button>/);
  assert.match(inlineExperience, /value='9700'[^>]*>9<\/button>/);
  assert.match(markup(runtime.input("140030")), /value='9700'[^>]*>30<\/button>/);
  assert.match(markup(runtime.input("140031")), /value='9700'[^>]*>30<\/button>/,
    "inline experience rejects values above 30");
  markup(runtime.input("140000"));
  const experienceAction = /value='(9\d{3})' class='era-setup-number'/.exec(experience)?.[1];
  assert.ok(experienceAction, "experience values support direct entry");
  assert.match(markup(runtime.input(experienceAction)), /Enter a whole number/);
  assert.match(markup(runtime.input("0")), /era-setup-player/);
  markup(runtime.input("710"));
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
  assert.match(markup(configured.input("11")), /era-setup-predefined/);
  assert.match(markup(configured.input("999")), /era-setup-player/);
  const predefinedList = markup(configured.input("11"));
  assert.match(predefinedList, /era-setup-predefined/);
  assert.match(predefinedList, /era-predefined-filter/);
  assert.match(predefinedList, /era-predefined-face/);
  assert.match(predefinedList, /Female · Youkai · /);
  assert.doesNotMatch(predefinedList, / · Adult · /);
  assert.doesNotMatch(predefinedList, / · TSP |Yukari · Youkai/);
  assert.match(predefinedList, /era-bars era-predefined-bars/);
  assert.ok((predefinedList.match(/class='era-predefined-character'/g) ?? []).length > 100);
  assert.doesNotMatch(predefinedList, /Applicable for|Next page/);
  assert.match(markup(settle(configured, configured.input("26"))), /Raise it to 2000/);
  assert.match(markup(configured.input("0")), /Be a virgin/);
  assert.match(markup(settle(configured, configured.input("0"))), /era-setup-nickname-field'>Yukari/);
  markup(configured.input("700"));
  const predefinedPlayer = markup(configured.input("710"));
  assert.match(predefinedPlayer, /era-setup-player-face'><img src='[^']+' height='112px'/);
  assert.match(predefinedPlayer, /value='1199' class='era-setup-choice era-current'[^>]*>.*Default.*Yukari/);
  assert.match(predefinedPlayer, /value='12'[^>]*>Custom Character/);
  const home = markup(configured.input("701"));
  assert.match(home, /value='2006' class='era-setup-choice era-current'/, "predefined characters retain their own home");
  markup(configured.input("700"));
  const customAgain = markup(configured.input("12"));
  assert.match(customAgain, /era-setup-name-field'>Player/);
  assert.match(customAgain, /Human · Male · Adult/);
  assert.doesNotMatch(customAgain, /value='12'[^>]*>Custom Character/);
  assert.match(customAgain, /Default.*Men's clothing/);
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

  indexScript(game, `@TEST_PLAYER_SETUP
CALL MAKE_TALENT_MAP
CALL Name_Array_Set
CALL ADDCHARA_INIT(0)
CALL HOTPATCH_NEWGAME_PREPARE
PRINTFORML player=%NAME:MASTER%;sta={MAXBASE:MASTER:体力};ene={MAXBASE:MASTER:気力};sex={TALENT:MASTER:性別};outfit={CFLAG:MASTER:基本服装セット}
QUIT`, "TEST_PLAYER_SETUP.ERB");
  const player = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  markup(player.start("TEST_PLAYER_SETUP"));
  const nameInput = player.input("5002");
  assert.equal(nameInput.input?.kind, "string");
  assert.equal(player.input("Test Player").input?.kind, "string");
  assert.match(markup(player.input("Test Nickname")), /era-setup-nickname-field'>Test Nickname/);
  player.input("5002");
  player.input("Renamed Player");
  assert.match(markup(player.input("")), /era-setup-nickname-field'>Renamed Player/);
  player.input("5002");
  player.input("Test Player");
  player.input("Test Nickname");
  markup(player.input("5101"));
  markup(player.input("5102"));
  markup(player.input("711"));
  markup(player.input("6002"));
  markup(player.input("6002"));
  assert.match(markup(player.input("710")), /Default.*Women's clothing/);
  markup(player.input("1104"));
  markup(player.input("711"));
  markup(player.input("6002"));
  const explicitClothes = markup(player.input("710"));
  assert.match(explicitClothes, /value='1104' class='era-setup-choice era-current'/,
    "an explicit outfit survives gender changes");
  assert.doesNotMatch(explicitClothes, /value='1199' class='era-setup-choice era-current'/);
  const playerAccepted = player.input("100");
  assert.equal(playerAccepted.error, null);
  assert.equal(playerAccepted.status, "halted");
  assert.match(playerAccepted.output.flatMap(item => "text" in item ? [item.text] : []).join("\n"),
    /player=Test Player;sta=2100;ene=1900;sex=2;outfit=4/);

  indexScript(game, `@TEST_BODY_RACES
CALL MAKE_TALENT_MAP
CALL Name_Array_Set
CALL ADDCHARA_INIT(0)
FLAG:周回数 = 1
CALL HOTPATCH_SETUP_INPUT(130191)
CALL HOTPATCH_SETUP_INPUT(119112)
CALL HOTPATCH_SETUP_INPUT(110814)
CALL HOTPATCH_SETUP_BODY
PRINTFORML human={TALENT:MASTER:人間};youkai={TALENT:MASTER:妖怪};butt={TALENT:MASTER:ヒップサイズ}
CALL HOTPATCH_SETUP_INPUT(130090)
PRINTFORML fox={TALENT:MASTER:90};youkai={TALENT:MASTER:妖怪}
CALL HOTPATCH_SETUP_INPUT(130091)
PRINTFORML spirit={TALENT:MASTER:91};fox={TALENT:MASTER:90}
QUIT`, "TEST_BODY_RACES.ERB");
  const races = new Runtime(game, GAME_INSTRUCTION_LIMIT).start("TEST_BODY_RACES");
  assert.equal(races.error, null);
  assert.equal(races.status, "halted");
  assert.match(races.output.flatMap(item => "text" in item ? [item.text] : []).join("\n"),
    /human=0;youkai=2;butt=4/);
  const raceMarkup = races.output.flatMap(item => "text" in item ? [item.text] : []).join("\n");
  assert.match(raceMarkup, /value='119112' class='era-setup-choice era-current'/);
  assert.match(raceMarkup, /value='130191' class='era-setup-choice era-current'/);
  assert.match(raceMarkup, /value='130090'/);
  assert.match(raceMarkup, /value='130091'/);
  assert.match(raceMarkup, /fox=1;youkai=0/);
  assert.match(raceMarkup, /spirit=1;fox=0/);
  assert.doesNotMatch(raceMarkup, /Unlocks in New Game\+/);
  assert.doesNotMatch(raceMarkup, /value='119011'/, "human sub-options disappear after selecting Youkai");
});
