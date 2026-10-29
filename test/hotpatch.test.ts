import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { demoGame } from "../src/demo.js";
import { applyHotpatches, emptyGame, GAME_ROOT, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime } from "../src/runtime.js";

async function withPatchDir(files: Record<string, string>, body: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "hotpatch-"));
  try {
    for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("hotpatches replace game routines and may add HOTPATCH_ helpers", async () => {
  const game = emptyGame("<memory>");
  indexScript(game, "@SYSTEM_TITLE\nCALL SHOW\nQUIT\n@SHOW\nPRINTL original", "GAME.ERB");
  await withPatchDir({ "A.ERB": "@SHOW\nCALL HOTPATCH_HELPER\n@HOTPATCH_HELPER\nPRINTL patched" }, async (dir) => {
    assert.deepEqual(await applyHotpatches(game, dir), ["SHOW"]);
  });
  const output = new Runtime(game).start().output.map((item) => ("text" in item ? item.text : "")).join("");
  assert.equal(output, "patched");
});

test("hotpatches reject new routines that are not named HOTPATCH_*", async () => {
  const game = emptyGame("<memory>");
  indexScript(game, "@SYSTEM_TITLE\nQUIT", "GAME.ERB");
  await withPatchDir({ "A.ERB": "@TYPO_NAME\nPRINTL x" }, async (dir) => {
    await assert.rejects(applyHotpatches(game, dir), /does not define/);
  });
});

test("translated ability HTML emits valid six-digit CSS colors", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  const stub = emptyGame(game.root);
  indexScript(stub, `@SYSTEM_TITLE
#DIMS MARKUP
MARKUP '= COLOR_PRINT_HTML("Ex", "C_P_PURPLE", 2)
HTML_PRINT MARKUP
MARKUP '= COLOR_STAMP_HTML(2, 3, "★", "0xFFFF00")
HTML_PRINT MARKUP
WAIT`, "<stub>");
  game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
  const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT).start();
  assert.equal(snapshot.error, null);
  const markup = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
  assert.match(markup, /<font color='#C070C0'>Ex<\/font>/);
  assert.match(markup, /<font color='#FFFF00'>  ★★<\/font>/);
  assert.doesNotMatch(markup, /#0x/i);
});

test("Palam hotpatch prints one HTML line with formatted values", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  assert.ok((await applyHotpatches(game)).includes("SHOW_INFO_PALAM"));
  const stub = emptyGame(game.root);
  indexScript(stub, `@SYSTEM_TITLE
ADDCHARA 0
ADDCHARA 1
TARGET = 1
PALAM:1:0 = 1234
PALAM:1:11 = 23456
EX:1:20 = 1
PRINTFORML {LINECOUNT}
CALL SHOW_INFO_PALAM
PRINTFORML {LINECOUNT}
WAIT`, "<stub>");
  game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
  const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT, { columns: 180 }).start();
  assert.equal(snapshot.error, null);
  const texts = snapshot.output.flatMap((item) => ("text" in item ? [item.text] : []));
  const html = snapshot.output.filter((item) => item.type === "html");
  assert.equal(html.length, 1);
  const markup = "text" in html[0]! ? html[0].text : "";
  assert.match(markup, /^<div class='era-section era-palam'>/);
  assert.match(markup, /era-palam-item era-hot'[^>]*>.*?1234</);
  assert.match(markup, /23\.4k/);
  assert.match(markup, /1234<span class='era-palam-next'>\/\d/, "values show the next level's threshold");
  assert.match(markup, /Next level at \d+/);
  assert.equal(Number(texts.at(-1)) - Number(texts[0]), 2, "the Palam block is one logical line");
});

test("occupants show a non-interactive cage entry at Miracle Mallet's remote-access locations", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const scenarios: {
    name: string;
    room: number;
    setup?: string;
    caged: boolean;
    able: boolean;
    normal?: boolean;
  }[] = [
    { name: "living room", room: 9, caged: true, able: true },
    { name: "veranda", room: 10, caged: true, able: true },
    { name: "other room", room: 8, caged: false, able: false },
    { name: "away living room", room: 8009, caged: false, able: false },
    { name: "away veranda", room: 8010, caged: false, able: false },
    { name: "not at home", room: 9, setup: "MAIN_MAP = 1", caged: false, able: false },
    { name: "cage empty", room: 9, setup: "CFLAG:71:現在位置 = 11", caged: false, able: false },
    { name: "asleep", room: 9, setup: "CFLAG:71:睡眠 = 1", caged: true, able: false },
    { name: "cooldown", room: 10, setup: "CFLAG:MASTER:魔力回収 = 3", caged: true, able: false },
    { name: "time stopped", room: 9, setup: "FLAG:70 = 1", caged: true, able: false },
    { name: "playing Shinmyoumaru", room: 9, setup: "FLAG:なりきり = 71", caged: false, able: true },
    { name: "physically present", room: 9, setup: "CFLAG:71:現在位置 = 9\nTARGET = 71\nTARGET:1 = 71", caged: false, able: true, normal: true },
    { name: "accompanying", room: 9, setup: "TARGET = 71\nTARGET:1 = 71\nCFLAG:71:同行 = 1", caged: false, able: true, normal: true },
    { name: "carried", room: 10, setup: "TARGET = 1\nTARGET:1 = 1\nTFLAG:運搬 = 71", caged: false, able: true, normal: true },
    { name: "with another occupant", room: 9, setup: "TARGET = 1\nTARGET:1 = 1\nCFLAG:1:現在位置 = 9", caged: true, able: true },
  ];
  for (const scenario of scenarios) {
    const stub = emptyGame(game.root);
    indexScript(stub, `@SYSTEM_TITLE
FOR LOCAL, 0, 72
  ADDCHARA LOCAL
NEXT
MASTER = 0
TARGET = 0
MAIN_MAP = 0
MAXROOM = 57
TFLAG:100 = 1
CFLAG:MASTER:現在位置 = ${scenario.room}
CFLAG:71:現在位置 = 54
CALLNAME:71 = Shinmyoumaru
${scenario.setup ?? ""}
FLAG:画像表示 = 3
FLAG:画像表示設定 = 1
isModifier = 10
CALL HOTPATCH_OCCUPANTS
PRINTFORML Image settings: {FLAG:画像表示}, {FLAG:画像表示設定}, {isModifier}
CALL COM_ABLE428
PRINTFORML Mallet available: {RESULT}
WAIT`, "<cage-test>");
    game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
    const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT).start();
    assert.equal(snapshot.error, null, `${scenario.name}: ${JSON.stringify(snapshot.error)}`);
    const markup = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
    const text = snapshot.output.flatMap((item) => "text" in item ? [item.text] : []).join("");
    assert.equal(markup.includes("era-occupant-caged"), scenario.caged, scenario.name);
    assert.match(text, /Image settings: 3, 1, 10/, "rendering each portrait restores the image settings");
    assert.match(text, new RegExp(`Mallet available: ${Number(scenario.able)}`), scenario.name);
    if (scenario.caged) {
      assert.match(markup, /<span class='era-occupant era-occupant-caged'>/);
      assert.match(markup, /In her cage · Miracle Mallet only/);
      assert.doesNotMatch(markup, /<button[^>]*era-occupant-caged|value='1071'|Nobody else is here/);
      assert.equal((markup.match(/era-occupant-name'>Shinmyoumaru</g) ?? []).length, 1, scenario.name);
      if (scenario.name === "asleep") assert.match(markup, /Miracle Mallet only · Asleep/);
    }
    if (scenario.normal) {
      assert.equal((markup.match(/era-occupant-name'>Shinmyoumaru</g) ?? []).length, 1, scenario.name);
      if (scenario.name !== "carried") assert.match(markup, /value='1071'/);
    }
  }
});

test("main screen hotpatch opens and closes its panel boxes in balance", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  const patched = await applyHotpatches(game);
  assert.ok(patched.includes("SHOW_STATUS") && patched.includes("SHOW_USERCOM"));
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { columns: 149 });
  let snapshot = runtime.start();
  let markup: string[] = [];
  const step = (value: string) => {
    markup = [];
    snapshot = runtime.input(value);
    for (let guard = 0; ; guard++) {
      assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
      for (const item of snapshot.output) if (item.type === "html") markup.push(item.text);
      if (snapshot.input?.kind !== "wait" || guard > 500) break;
      snapshot = snapshot.input.timeout ? runtime.timeout() : runtime.input("");
    }
  };
  // New game as Yukari with default settings, then the first main screen, Time Stop and Resume Time.
  for (const value of ["0", "1", "26", "0", "0", "0", "0", "100"]) step(value);
  const screens: string[][] = [];
  for (const value of ["100", "355", "999"]) {
    step(value);
    screens.push(markup);
  }
  for (const [index, screen] of screens.entries()) {
    const opens = screen.filter((text) => text.startsWith("<era-open")).length;
    const closes = screen.filter((text) => text === "<era-close>").length;
    assert.ok(opens > 5, `screen ${index} draws the panels`);
    assert.equal(opens, closes, `screen ${index} closes every box`);
    assert.ok(screen.some((text) => text.includes("era-timestop-button")), `screen ${index} has the time stop control`);
    const html = screen.join("");
    assert.equal((html.match(/value='805'/g) ?? []).length, 1, "inventory has exactly one entry point");
    assert.match(html, /era-player-actions'><button value='805' class='era-player-control era-inventory-button'/, "inventory is on the player card");
    assert.match(html, /era-guard-toggle[^']*' aria-pressed='(?:true|false)'/, "the guard exposes its toggle state");
  }
  assert.ok(screens[1]!.some((text) => /era-stopped'[^>]*value='999'|value='999'[^>]*era-stopped/.test(text)), "time stop switches to Resume Time");
  step("805");
  assert.ok(markup.some((text) => text.includes("era-dialog era-inventory")), "805 opens the inventory from the main screen");
  step("999");
  assert.ok(markup.some((text) => text.includes("era-player-actions")), "closing inventory returns to the player panel");
});

test("character info and player panels share body-size labels and highlights", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  for (const size of [0, -5, -2, -1, 1, 2, 5]) {
    const stub = emptyGame(game.root);
    indexScript(stub, `@SYSTEM_TITLE
CALL MAKE_TALENT_MAP
ADDCHARA 0
ADDCHARA 1
MASTER = 0
TARGET = 1
nameArray:1:na_Title = ●Race:Human
TALENT:MASTER:体型 = ${size}
TALENT:TARGET:体型 = ${size}
HTML_PRINT HOTPATCH_PLAYER_KIND()
CALL HOTPATCH_TARGET_SITUATION
WAIT`, "<info-size-test>");
    game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
    const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT).start();
    assert.equal(snapshot.error, null, `${size}: ${JSON.stringify(snapshot.error)}`);
    const html = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
    const sizes = [...html.matchAll(/<span class='era-size(?: era-unusual)?'[^>]*>[^<]+<\/span>/g)].map((match) => match[0]);
    assert.equal(sizes.length, 2, "player and target both show body size");
    assert.equal(sizes[0], sizes[1], "both panels use identical size markup");
    assert.equal(sizes[1]!.includes("era-unusual"), size !== 0);
    if (!size) assert.match(sizes[1]!, />Normal size</);
    assert.match(html, /class='era-race'[^>]*>[^<]+<\/span><span class='era-sep'> · <\/span>/);
    assert.match(html, /<div class='era-character-kind'><span class='era-race'[^>]*>[^<]+<\/span><span class='era-sep'> · <\/span><span class='era-size(?: era-unusual)?'[^>]*>[^<]+<\/span><\/div>/,
      "race and size share one HTML output row");
  }
});

test("character titles fill quiet info panels without hiding relationship or mood tags", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const scenarios = [
    { name: "quiet", setup: "", blurb: true },
    { name: "missing title", setup: `nameArray:1:na_Title '= ""`, blurb: false },
    { name: "hate mark", setup: "MARK:1:反発刻印 = 2", blurb: false, tag: "Hate Lv2" },
    { name: "relationship", setup: "TALENT:1:恋慕 = 1", blurb: false, tag: "era-feel-love" },
    { name: "happy", setup: "TALENT:1:機嫌 = 1", blurb: false },
    { name: "sullen", setup: "TALENT:1:機嫌 = -1", blurb: false },
    { name: "angry", setup: "BASE:1:怒り = 200", blurb: false },
    { name: "asleep", setup: "CFLAG:1:睡眠 = 1", blurb: false },
  ];
  for (const scenario of scenarios) {
    const stub = emptyGame(game.root);
    indexScript(stub, `@SYSTEM_TITLE
ADDCHARA 0
ADDCHARA 1
MASTER = 0
TARGET = 1
BASE:1:怒り = 0
nameArray:1:na_Title = ～A <quiet> visitor～　●Race:Human　●Ability:Floating
${scenario.setup}
CALL HOTPATCH_TARGET_SITUATION
WAIT`, "<info-title-test>");
    game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
    const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT).start();
    assert.equal(snapshot.error, null, `${scenario.name}: ${JSON.stringify(snapshot.error)}`);
    const html = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
    assert.equal(html.includes("era-character-blurb"), scenario.blurb, scenario.name);
    if (scenario.blurb) assert.match(html, /era-character-blurb'>A &lt;quiet&gt; visitor</);
    if (scenario.tag) assert.ok(html.includes(scenario.tag), "existing tags remain visible");
    assert.doesNotMatch(html, /●Race:|●Ability:/, "redundant race and ability fields are not part of the title");
  }
});

test("alcohol availability excludes empty inventory and non-alcohol drinks", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const stub = emptyGame();
  indexScript(stub, `@SYSTEM_TITLE
VALID_DRINK_COUNT = 2
VALID_DRINKS_LIST:0 = 100
VALID_DRINKS_LIST:1 = 101
ITEM:100 = 3
ITEM:101 = 0
PRINTFORML {HOTPATCH_HAS_ALCOHOL()}
ITEM:101 = 1
PRINTFORML {HOTPATCH_HAS_ALCOHOL()}
ITEM:101 = 0
PRINTFORML {HOTPATCH_HAS_ALCOHOL()}
QUIT
@IS_ALC(ARG)
#FUNCTION
RETURNF ARG == 101`, "alcohol-test.ERB");
  for (const [name, routine] of stub.routines) game.routines.set(name, routine);
  const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT).start();
  assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
  assert.deepEqual(snapshot.output.filter((item) => item.type === "text").map((item) => item.text), ["0", "1", "0"]);
});

test("room lineup renders every portrait and preserves target selection", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  for (const scenario of ["1", "2", "3", "4", "5", "6", "7", "9", "11"]) {
    const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
    runtime.start();
    runtime.input("8");
    let snapshot = runtime.input(scenario);
    const markup: string[] = [];
    for (let waits = 0; ; waits++) {
      assert.equal(snapshot.error, null, `${scenario}: ${JSON.stringify(snapshot.error)}`);
      for (const item of snapshot.output) if (item.type === "html") markup.push(item.text);
      if (snapshot.input?.kind !== "wait") break;
      assert.ok(waits < 40, "scenario reaches the main screen");
      snapshot = runtime.input("");
    }
    const html = markup.join("");
    assert.ok(!snapshot.output.some((item) => "text" in item && item.text.includes("Change Partner")),
      "the lineup replaces the redundant Change Partner menu button");
    const count = scenario === "11" ? 24 : scenario === "4" ? 6 : ["3", "5"].includes(scenario) ? 2 : ["1", "6", "9"].includes(scenario) ? 0 : 1;
    assert.equal((html.match(/<era-open class='era-portrait'>/g) ?? []).length, count, scenario);
    assert.equal((html.match(/aria-pressed='true'/g) ?? []).length, count ? 1 : 0, scenario);
    assert.equal((html.match(/<era-open/g) ?? []).length, (html.match(/<era-close>/g) ?? []).length, scenario);
    assert.doesNotMatch(html, /era-main-occupants/, "occupants are inside the room card");
    assert.doesNotMatch(html, /era-selected/, "selection uses only the existing sprite highlight, not an occupant highlight");
    assert.ok(html.indexOf("era-character") < html.indexOf("era-occupant-list"));
    assert.match(html, /era-room-stage/, "the lineup is inside a room stage");
    assert.doesNotMatch(html, /era-room-shrine|\/rooms\//, "the room has no illustrated background");
    assert.doesNotMatch(html, />Room Occupants</, "the room itself replaces the occupant-list heading");
    if (!count) {
      assert.equal((html.match(/Nobody else is here/g) ?? []).length, 1, "one empty-room message");
      assert.doesNotMatch(html, /Just you|No one else is in the room/);
      continue;
    }
    const labels = [...html.matchAll(/<button value='(\d+)' class='era-occupant-label' aria-pressed='(true|false)'/g)];
    assert.match(html, /era-info-title'>Character Info</);
    assert.match(html, /value='-9300' class='era-info-more'/, "More opens details for the selected character");
    assert.match(html, /<era-open class='era-info-body'>/);
    assert.match(html, /era-info-face/, "the details identify the selected person");
    assert.match(html, /<era-open class='era-info-head'>/);
    assert.match(html, /<era-open class='era-info-summary'>/);
    assert.equal(labels.length, count);
    const originalTarget = snapshot.target;
    assert.equal(originalTarget, Number(labels.find((label) => label[2] === "true")![1]) - 1000);
    if (scenario === "11") {
      assert.equal(new Set(labels.map((label) => label[1])).size, 24, "stress crowd has distinct characters");
      assert.equal(originalTarget, Number(labels.at(-1)![1]) - 1000, "stress crowd starts with the last person selected");
    }
    const next = labels.find((label) => label[2] === "false") ?? labels[0]!;
    snapshot = runtime.input(next[1]!);
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    const selected = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
    assert.match(selected, new RegExp(`value='${next[1]}' class='era-occupant-label' aria-pressed='true'`));
    assert.equal(snapshot.target, Number(next[1]) - 1000);
    if (count > 1) assert.notEqual(snapshot.target, originalTarget);
  }
});

test("character More opens the selected person's sheet while See more still opens the player", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  runtime.start();
  runtime.input("8");
  let snapshot = runtime.input("3");
  const settle = () => {
    for (let waits = 0; snapshot.input?.kind === "wait"; waits++) {
      assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
      assert.ok(waits < 40);
      snapshot = runtime.input("");
    }
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
  };
  const html = () => snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
  settle();
  const labels = [...html().matchAll(/value='(\d+)' class='era-occupant-label' aria-pressed='(true|false)'/g)];
  const next = labels.find((label) => label[2] === "false")!;
  snapshot = runtime.input(next[1]!);
  settle();
  const selected = snapshot.target;
  assert.equal(selected, Number(next[1]) - 1000);
  const selectedName = html().match(new RegExp(`value='${next[1]}' class='era-occupant-label'[^>]*>.*?era-occupant-name'[^>]*>([^<]+)<`))![1];
  for (const command of ["803", "-9300"]) {
    snapshot = runtime.input(command);
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    assert.match(html(), /era-dialog era-sheet/);
    assert.match(html(), /value='77' class='era-sheet-step'/);
    assert.match(html(), /value='88' class='era-sheet-step'/);
    assert.match(html(), /era-sheet-caption'>Character sheet<\/span><div class='era-sheet-people'>/);
    assert.doesNotMatch(html(), /era-sheet-name/);
    if (command === "803") assert.match(html(), /value='5000' class='era-sheet-person era-current'/);
    else {
      assert.equal(html().match(/class='era-sheet-person era-current'>([^<]+)</)![1], selectedName);
      assert.doesNotMatch(html(), /value='5000' class='era-sheet-person era-current'/);
      assert.doesNotMatch(html(), /class='era-sheet-person'>[^<]+<span class='era-sub'>You/);
    }
    assert.equal(snapshot.target, selected, "opening a sheet does not change the selected target");
    const initialName = html().match(/class='era-sheet-person era-current'>([^<]+)</)![1];
    snapshot = runtime.input("88");
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    assert.notEqual(html().match(/class='era-sheet-person era-current'>([^<]+)</)![1], initialName);
    snapshot = runtime.input("77");
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    assert.equal(html().match(/class='era-sheet-person era-current'>([^<]+)</)![1], initialName);
    assert.equal(snapshot.target, selected, "sheet navigation does not change the room target");
    snapshot = runtime.input("0");
    settle();
    assert.match(html(), /era-info-more/);
    assert.equal(snapshot.target, selected);
  }
  snapshot = runtime.input("-9200");
  settle();
  const first = html().match(/era-guard-toggle[^']*' aria-pressed='(true|false)'/)![1];
  snapshot = runtime.input("-9200");
  settle();
  const second = html().match(/era-guard-toggle[^']*' aria-pressed='(true|false)'/)![1];
  assert.notEqual(first, second, "guard still toggles through the game's command");
});

test("inventory dialog supplies a live-filter footer and preserves categories, mods and items", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  assert.ok((await applyHotpatches(game)).includes("QoL_AllItemSort"));
  const stub = emptyGame(game.root);
  indexScript(stub, `@SYSTEM_TITLE
ADDCHARA 0
MASTER = 0
CALLNAME:0 = Tester <&>
VARSET ITEM
ITEM:40 = 3
ITEM:36 = 1
CALL SHOW_ALLITEM
PRINTFORML Returned: {ITEM:40}, {ITEM:36}
WAIT`, "<inventory-test>");
  game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  const markup = (snapshot: ReturnType<Runtime["start"]>) => {
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    const html = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
    assert.equal((html.match(/<era-open/g) ?? []).length, (html.match(/<era-close>/g) ?? []).length);
    return html;
  };
  let html = markup(runtime.start());
  assert.match(html, /era-dialog era-inventory/);
  assert.match(html, /Tester &lt;&amp;&gt;/);
  assert.match(html, /title='Quantity'>3</);
  assert.match(html, /2 item types/);
  assert.equal((html.match(/class='era-inventory-item'/g) ?? []).length, 2);
  assert.match(html, /value='3020'/);
  assert.match(html, /era-inventory-footer'><span class='era-inventory-filter'><\/span>/);
  assert.match(html, /class='era-inventory-count'>2 item types</);
  assert.match(html, /class='era-inventory-item' title='Protects from the elements/);
  assert.match(html, /title='[^']*&#39;smoothly&#39;\.'/,
    "apostrophes do not truncate description tooltips");
  assert.doesNotMatch(html, /value='888'|era-inventory-description|Enter an item name/);

  html = markup(runtime.input("3002"));
  assert.match(html, /era-current'>Tools</);
  assert.match(html, /1 item type<\/span> · Tools/);
  html = markup(runtime.input("3016"));
  assert.match(html, /No items in this category/);
  assert.match(html, /0 item types/);
  assert.match(html, /value='999' class='era-dialog-close'/);
  html = markup(runtime.input("3000"));
  assert.match(html, /2 item types/);
  const mods = runtime.input("777");
  html = markup(mods);
  assert.match(html, /Back to items/);
  assert.match(mods.output.flatMap((item) => "text" in item ? [item.text] : []).join(""), /Umbrella/i);
  html = markup(runtime.input("889"));
  assert.match(html, /2 item types/);
  html = markup(runtime.input("-1"));
  assert.match(html, /Invalid Input/);
  const snapshot = runtime.input("999");
  assert.equal(snapshot.error, null);
  assert.match(snapshot.output.flatMap((item) => "text" in item ? [item.text] : []).join(""), /Returned: 3, 1/);

  const emptyStub = emptyGame(game.root);
  indexScript(emptyStub, "@SYSTEM_TITLE\nADDCHARA 0\nVARSET ITEM\nCALL SHOW_ALLITEM\nWAIT", "<empty-inventory-test>");
  game.routines.set("SYSTEM_TITLE", emptyStub.routines.get("SYSTEM_TITLE")!);
  const emptyRuntime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  html = markup(emptyRuntime.start());
  assert.match(html, /0 item types/);
  assert.match(html, /No items in this category/);
  html = markup(emptyRuntime.input("777"));
  assert.match(html, /You do not own any moddable items/);
});
