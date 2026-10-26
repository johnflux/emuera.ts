import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { compatibility } from "../src/compatibility.js";
import { demoGame } from "../src/demo.js";
import { GAME_ROOT, KNOWN_GAMES, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime } from "../src/runtime.js";
import { patchTitleImage } from "../src/render-patches.js";
import { stringWidth } from "../src/strings.js";

const ranceRoot = KNOWN_GAMES.find((game) => game.id === "rancek")!.root;
const kRoot = KNOWN_GAMES.find((game) => game.id === "k")!.root;
test("eraTohoK still renders its title and new-game scenario menu", {
  skip: !existsSync(kRoot),
}, async () => {
  const game = await loadGame(kRoot);
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  const title = runtime.start();
  assert.equal(title.status, "waiting", JSON.stringify(title.error));
  assert.ok(title.output.some((item) => "text" in item && item.text.includes("Custom Characters")));
  const scenarios = runtime.input("0");
  assert.equal(scenarios.status, "waiting", JSON.stringify(scenarios.error));
  assert.ok(scenarios.output.some((item) => "text" in item && item.text.includes("Gathering of Heroes")));
});

test("eraRanceK default scenario completes its diplomacy setup within the server instruction budget", {
  skip: !existsSync(ranceRoot),
}, async () => {
  const game = await loadGame(ranceRoot);
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  let snapshot = runtime.start();
  const waiting = () => assert.equal(snapshot.status, "waiting", JSON.stringify(snapshot.error));
  waiting();
  snapshot = runtime.input("0");
  waiting();
  assert.ok(snapshot.output.some((item) => item.type === "button" && item.value === "10"));
  snapshot = runtime.input("10");
  for (let i = 0; i < 40 && snapshot.input?.kind === "wait"; i++) {
    waiting();
    snapshot = runtime.input("");
  }
  waiting();
  assert.ok(snapshot.output.some((item) => "text" in item && item.text.includes("Begin this scenario")));
  snapshot = runtime.input("0");
  waiting();
  assert.ok(snapshot.output.some((item) => item.type === "button" && item.value === "1000" && item.text === "[Confirm]"));
  snapshot = runtime.input("1000");
  waiting();
  assert.ok(snapshot.output.some((item) => "text" in item && item.text.includes("You can click a city")),
    "The scenario should finish initializing and reach the faction map");
});

test("bundled game renders its title and runs real custom-character creation", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  const report = compatibility(game);
  assert.ok(report.scriptFiles > 3000);
  assert.ok(report.functions > 90000);
  assert.ok(report.instructions > 2_000_000);
  assert.ok(report.csvTables > 150);
  assert.ok(report.sprites > 20000);
  assert.ok(game.routines.has("SYSTEM_TITLE"));
  assert.ok(game.sprites.has("TW_TITLE000"));
  assert.equal(game.names.get("AL_PROG")?.get("PREGNANCY"), 2);
  assert.equal(game.names.get("AL_ENTRY_INTS")?.get("OBTAINABLE"), 1);
  assert.deepEqual(game.money, { label: "\u00a5", first: true });
  assert.ok(!report.gaps.some((gap) => gap.feature === "Instruction: LOADGLOBAL"));
  assert.ok(!report.gaps.some((gap) => /^Instruction: ["{}]/.test(gap.feature)),
    "Multiline values and delimiters must not be classified as instructions");
  assert.ok(!report.gaps.some((gap) => gap.feature.startsWith("Instruction: [")),
    "Preprocessor directives must not be classified as runtime instructions");
  assert.ok(!game.diagnostics.some((diagnostic) => diagnostic.message === "Unmatched [ENDIF]"));
  const endUfufu = game.routines.get("ENDUFUFU")![0]!;
  assert.ok(!endUfufu.lines.some((line) => line.line === 1000 || line.line === 1001));
  const nameArray = [...game.routines.values()].flat()
    .flatMap((routine) => routine.lines)
    .find((line) => line.file === "ERB/TRANSLATION/_Name_Array.ERB" && line.text.startsWith("nameArray:16:0"));
  assert.ok(nameArray);
  assert.match(nameArray.text, /The Eternal Young Scarlet Moon/);
  assert.equal(nameArray.line, 207);
  const boot = new Runtime(game).start();
  assert.equal(boot.status, "waiting", JSON.stringify(boot.error));
  assert.equal(boot.input?.kind, "integer");
  assert.equal(boot.error, null);
  assert.equal(boot.title, "eraThe World AnonTW (TW: 4.980 - ATW: 2025.04.18)");
  assert.equal(boot.output.filter((item) => item.type === "html" && /TW_title\d{3}/.test(item.text)).length, 35);
  const presentation = patchTitleImage(game, boot);
  assert.equal(presentation.output.filter((item) => item.type === "title-image").length, 1);
  assert.equal(presentation.output.filter((item) => item.type === "html").length, 0);
  const text = boot.output.filter((item) => item.type === "text").map((item) => item.text).join("\n");
  assert.match(text, /eraThe World AnonTW/);
  assert.match(text, /\[0\] Start Game/);
  assert.match(text, /\[1\] Continue/);
  assert.match(text, /Random Tip:/);
  assert.match(text, /WARNING: Window width/);
  assert.doesNotMatch(text, /Dev Quicktest/);
  const wideRuntime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { columns: 180 });
  const wide = wideRuntime.start();
  assert.equal(wide.status, "waiting", JSON.stringify(wide.error));
  assert.ok(!wide.output.some((item) => item.type === "text" && item.text.includes("Window width")));
  const repeated = wideRuntime.input("42");
  assert.equal(repeated.status, "waiting", JSON.stringify(repeated.error));
  assert.equal(repeated.input?.kind, "integer");
  assert.ok(repeated.output.some((item) => item.type === "text" && item.text === "[0] Start Game"));
  const startGame = wideRuntime.input("0");
  assert.equal(startGame.status, "waiting", JSON.stringify(startGame.error));
  assert.ok(startGame.output.some((item) => "text" in item && item.text.includes("★★Select Mode★★")));
  const custom = wideRuntime.input("0");
  assert.equal(custom.input?.kind, "wait", JSON.stringify(custom.error));
  const editor = wideRuntime.input("");
  assert.equal(editor.status, "waiting", JSON.stringify(editor.error));
  assert.match(editor.output.filter((item) => "text" in item).map((item) => item.text).join(""), /\[9999\] Finished/);
  const editorLines: string[] = [];
  let editorLine = "";
  for (const item of editor.output) {
    if (item.type === "text" || item.type === "button") editorLine += item.text;
    if ("newline" in item && item.newline) { editorLines.push(editorLine); editorLine = ""; }
  }
  const separators = editorLines.filter((value) => /^-+$/.test(value) || /^□ .+ □-+$/.test(value));
  assert.equal(separators.length, 7);
  assert.ok(separators.every((value) => stringWidth(value) === 180),
    "Plain separators and labeled section separators must fill the same column width");
  const traits = wideRuntime.input("3000");
  assert.equal(traits.status, "waiting", JSON.stringify(traits.error));
  assert.ok(traits.output.some((item) => item.type === "text" && item.plain &&
    item.text.includes("Human")), "Unavailable traits must print as non-clickable plain FORM output");
  const changedTraits = wideRuntime.input("1");
  assert.equal(changedTraits.status, "waiting", JSON.stringify(changedTraits.error));
  assert.ok(changedTraits.output.some((item) => item.type === "clear"));
  const traitEntry = (snapshot: typeof traits) => snapshot.output.find((item) =>
    item.type === "text" && item.text.includes("[  1]Male Virgin"));
  assert.ok(traitEntry(traits));
  assert.ok(traitEntry(changedTraits));
  assert.notDeepEqual(traitEntry(changedTraits), traitEntry(traits),
    "Changing a trait must update its displayed state");
  const restoredTraits = wideRuntime.input("1");
  assert.equal(restoredTraits.status, "waiting", JSON.stringify(restoredTraits.error));
  assert.deepEqual(
    restoredTraits.output.filter((item) => item.type === "text"),
    traits.output.filter((item) => item.type === "text"),
    "Toggling a trait twice must restore the menu, including its colors and availability");
  const returned = wideRuntime.input("9999");
  assert.equal(returned.status, "waiting", JSON.stringify(returned.error));
  const rename = wideRuntime.input("0");
  assert.equal(rename.input?.kind, "string", JSON.stringify(rename.error));
  const renamed = wideRuntime.input("John");
  assert.equal(renamed.input?.kind, "wait", JSON.stringify(renamed.error));
  assert.ok(renamed.output.some((item) => "text" in item && item.text.includes("Accepted. Name now set to John.")));
  const updatedEditor = wideRuntime.input("");
  assert.equal(updatedEditor.status, "waiting", JSON.stringify(updatedEditor.error));
  assert.ok(updatedEditor.output.some((item) => item.type === "html" && item.text.includes("Name: John")));
  const confirmation = wideRuntime.input("9999");
  assert.equal(confirmation.status, "waiting", JSON.stringify(confirmation.error));
  const dialogue = wideRuntime.input("0");
  assert.equal(dialogue.status, "waiting", JSON.stringify(dialogue.error));
  const map = wideRuntime.input("0");
  assert.equal(map.status, "waiting", JSON.stringify(map.error));
  assert.ok(map.output.some((item) => "text" in item && item.text.includes("Select type of map")));
  const housing = wideRuntime.input("1");
  assert.equal(housing.status, "waiting", JSON.stringify(housing.error));
  assert.ok(housing.output.some((item) => item.type === "html" && item.text.includes("<font face='ＭＳ ゴシック'>")), "Colored map renders");
  assert.ok(housing.output.some((item) => "text" in item && item.text.includes("Select a place to stay.")));
  const chosen = wideRuntime.input("1999");
  assert.ok(chosen.output.some((item) => "text" in item && item.text.includes("Hakurei Shrine has been chosen.")), JSON.stringify(chosen.error));
  wideRuntime.input("");
  const rooms = wideRuntime.input("");
  assert.equal(rooms.input?.kind, "integer", JSON.stringify(rooms.error));
  const roomHint = rooms.output.filter((item) => "text" in item && ["This map has more than one ", "room choice", "."].includes(item.text));
  assert.equal(roomHint.length, 3, "Output from an expression function precedes the calling PRINTFORML");
  assert.notEqual(roomHint[1]!.style.color, roomHint[0]!.style.color);
  const moved = wideRuntime.input("0");
  assert.ok(moved.output.some((item) => "text" in item && item.text.includes("Moved into the Back Room.")), JSON.stringify(moved.error));
  const settings = wideRuntime.input("");
  assert.equal(settings.status, "waiting", JSON.stringify(settings.error));
  assert.ok(settings.output.some((item) => item.type === "html" && item.text.includes("Re-customize yourself")));
  const tableProbe = { ...game, routines: new Map(game.routines) };
  indexScript(tableProbe, `@TABLE_PROBE
CALL Name_Array_Set
FOR LOCAL, 0, キャラクタ数上限
  SIF EXISTCSV(LOCAL)
    ADDCHARA LOCAL
NEXT
CALL MakeAchievementListModular("achievements")
CALL AL_ENTRY_MAKE
PRINTFORML {DT_ROW_LENGTH("achievements")} {DT_COLUMN_LENGTH("achievements")}
DT_SELECT "achievements", "defName = 'meet10'"
PRINTFORML {RESULT}
A = RESULT:1
PRINTFORML %DT_CELL_GETS("achievements", A, "label", 1)%
PRINTFORML %DT_CELL_GETS("achievements", A, "bonus", 1)%
CALL MakeAchievementList(0)
CALL VerifyLegacyAchievementDef("meet10", 1, 1)
DT_SELECT "saveAchievements", "defName = 'meet10'"
PRINTFORML {RESULT} {DT_CELL_GET("saveAchievements", RESULT:1, "claimed", 1)} {DT_CELL_GET("saveAchievements", RESULT:1, "completed", 1)}`, "table-probe.ERB");
  const tables = new Runtime(tableProbe, GAME_INSTRUCTION_LIMIT).start("TABLE_PROBE");
  assert.equal(tables.status, "halted", JSON.stringify(tables.error));
  assert.deepEqual(tables.output.filter((item) => item.type === "text").map((item) => item.text), [
    "75 7", "1", "Introducing Yourself", "\u00a55,000", "1 1 1",
  ]);
  const demo = new Runtime(demoGame(game));
  const menu = demo.start();
  assert.equal(menu.status, "waiting", JSON.stringify(menu.error));
  // The portraits page redraws in place: every input clears the page's previous output.
  for (const value of ["5", "1001", "11", "20", "22", "21", "99"]) {
    const step = demo.input(value);
    assert.equal(step.status, "waiting", `${value}: ${JSON.stringify(step.error)}`);
    if (value !== "5" && value !== "99") assert.ok(step.output.some((item) => item.type === "clear" && item.count > 0), value);
  }
  // The dialogue page stops at two click-to-continue waits, then returns to the menu.
  assert.equal(demo.input("6").input?.kind, "wait");
  assert.equal(demo.input("").input?.kind, "wait");
  assert.equal(demo.input("").input?.kind, "integer");
  const grid = demo.input("7");
  const cells = grid.output.filter((output) => output.type === "text" && output.cell);
  assert.equal(cells.length, 10);
  assert.ok(cells.every((cell) => cell.type === "text" && [...cell.text].length === 29), "PRINTC items are padded to PRINTCの文字数");
  assert.equal(grid.input?.kind, "integer");
  assert.ok(demo.input("405").output.some((output) => output.type === "text" && output.text.includes("Command 405 chosen.")));
  assert.equal(demo.input("0").status, "halted");
  // Menu item 8 starts the game itself on its main screen, here with two people and time stopped.
  const scene = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  scene.start();
  scene.input("8");
  let step = scene.input("5");
  for (let waits = 0; step.input?.kind === "wait" && waits < 40; waits++) step = scene.input("");
  assert.equal(step.input?.kind, "integer", JSON.stringify(step.error));
  const sceneText = step.output.map((item) => (item.type === "text" ? item.text : "")).join("");
  assert.match(sceneText, /There's 2 people around/);
  assert.match(sceneText, /Reimu/);
});

test("OBJ framework intrinsics return what the ERB framework returns", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  type Call = (name: string, args: unknown[]) => unknown;
  const runtimes = [true, false].map((intrinsics) => {
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { intrinsics });
    runtime.start();
    assert.equal(runtime.input("0").status, "waiting");
    return { runtime, call: ((runtime as unknown as { expressionFunction: Call }).expressionFunction).bind(runtime) as Call };
  });
  assert.equal(runtimes[0]!.runtime.enabledIntrinsics.length, 1);
  assert.equal(runtimes[1]!.runtime.enabledIntrinsics.length, 0);
  const results = runtimes.map(({ call: raw }) => {
    const call = (name: string, args: unknown[]): unknown => {
      try { return raw(name, args); } catch (error) { return (error as Error).message; }
    };
    const values: unknown[] = [];
    for (const className of ["衣装セット", "下半身下着_ずらし不可", "上半身下着_はだけ可能", "キャラデータ", "酒データ", "存在しないクラス"])
      for (let id = -1n; id < 40n; id++)
        for (const field of ["名前", "描写", "着せ替え可能", "ズボン", "普段着"]) {
          values.push(call("GET_STR", [0n, className, id, field]), call("GET_INT", [0n, className, id, field]));
          if (className !== "存在しないクラス") values.push(call("GET_EXIST", [className, id < 0n ? 0n : id]));
        }
    for (const name of ["パジャマ（ズボン）セット", "女装セット", "存在しない衣装"]) values.push(call("OBJNAME_TO_ID", [0n, "GET", "衣装セット", name]));
    values.push(call("TEMP_STOCK", ["GET_TOTAL"]));
    return values;
  });
  assert.deepEqual(results[0], results[1]);
});

test("string widths follow Emuera's Shift-JIS byte count", () => {
  assert.equal(stringWidth("Lv 0"), 4);
  assert.equal(stringWidth("あア×─"), 8, "JIS characters, including ×, are two columns");
  assert.equal(stringWidth("ｱ"), 1, "half-width kana is one byte");
  assert.equal(stringWidth("▄▄♥é"), 4, "characters CP932 can't encode become one-byte ?");
});
