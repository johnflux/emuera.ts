import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { compatibility } from "../src/compatibility.js";
import { demoGame } from "../src/demo.js";
import { GAME_ROOT, loadGame } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";

test("bundled game loads, inventories gaps and renders its actual title menu at INPUT", {
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
  const text = boot.output.filter((item) => item.type === "text").map((item) => item.text).join("\n");
  assert.match(text, /eraThe World AnonTW/);
  assert.match(text, /\[0\] Start Game/);
  assert.match(text, /\[1\] Continue/);
  assert.match(text, /Random Tip:/);
  assert.match(text, /WARNING: Window width/);
  assert.doesNotMatch(text, /Dev Quicktest/);
  const wideRuntime = new Runtime(game, 50_000, { columns: 180 });
  const wide = wideRuntime.start();
  assert.equal(wide.status, "waiting", JSON.stringify(wide.error));
  assert.ok(!wide.output.some((item) => item.type === "text" && item.text.includes("Window width")));
  const repeated = wideRuntime.input("42");
  assert.equal(repeated.status, "waiting", JSON.stringify(repeated.error));
  assert.equal(repeated.input?.kind, "integer");
  assert.ok(repeated.output.some((item) => item.type === "text" && item.text === "[0] Start Game"));
  const startGame = wideRuntime.input("0");
  assert.equal(startGame.status, "error", "Gameplay must not silently skip unsupported initialization");
  assert.match(startGame.error!.message, /RESETDATA/);
  const demo = new Runtime(demoGame(game)).start();
  assert.equal(demo.status, "waiting", JSON.stringify(demo.error));
});
