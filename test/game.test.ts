import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { compatibility } from "../src/compatibility.js";
import { demoGame } from "../src/demo.js";
import { GAME_ROOT, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime } from "../src/runtime.js";
import { patchTitleImage } from "../src/render-patches.js";
import { stringWidth } from "../src/strings.js";

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
  const nextSubsystem = wideRuntime.input("1");
  assert.equal(nextSubsystem.status, "error", "Do not silently skip housing/map rendering");
  assert.equal(nextSubsystem.error!.file, "ERB/COLOREDMAPS/DRAW_COLOREDMAP.ERB");
  assert.equal(nextSubsystem.error!.line, 23);
  assert.match(nextSubsystem.error!.message, /Unexpected ',' in expression/, JSON.stringify(nextSubsystem.error));
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
  const demo = new Runtime(demoGame(game)).start();
  assert.equal(demo.status, "waiting", JSON.stringify(demo.error));
});
