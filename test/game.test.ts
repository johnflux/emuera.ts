import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { compatibility } from "../src/compatibility.js";
import { demoGame } from "../src/demo.js";
import { GAME_ROOT, loadGame } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";

test("bundled game loads, inventories gaps and stops explicitly at its first unsupported instruction", {
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
  assert.ok(report.gaps.some((gap) => gap.feature === "Instruction: LOADGLOBAL"));
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
  assert.equal(boot.status, "error");
  assert.equal(boot.error?.file, "ERB/TITLE.ERB");
  assert.equal(boot.error?.line, 5);
  assert.match(boot.error!.message, /LOADGLOBAL/);
  const demo = new Runtime(demoGame(game)).start();
  assert.equal(demo.status, "waiting", JSON.stringify(demo.error));
});
