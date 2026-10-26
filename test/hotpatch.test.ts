import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
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
CALL HOTPATCH_OCCUPANTS
CALL COM_ABLE428
PRINTFORML Mallet available: {RESULT}
WAIT`, "<cage-test>");
    game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
    const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT).start();
    assert.equal(snapshot.error, null, `${scenario.name}: ${JSON.stringify(snapshot.error)}`);
    const markup = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
    const text = snapshot.output.flatMap((item) => "text" in item ? [item.text] : []).join("");
    assert.equal(markup.includes("era-occupant-caged"), scenario.caged, scenario.name);
    assert.match(text, new RegExp(`Mallet available: ${Number(scenario.able)}`), scenario.name);
    if (scenario.caged) {
      assert.match(markup, /<span class='era-occupant era-occupant-caged'>/);
      assert.match(markup, /In her cage · Miracle Mallet only/);
      assert.doesNotMatch(markup, /<button[^>]*era-occupant-caged|value='1071'|Just you/);
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
  }
  assert.ok(screens[1]!.some((text) => /era-stopped'[^>]*value='999'|value='999'[^>]*era-stopped/.test(text)), "time stop switches to Resume Time");
});
