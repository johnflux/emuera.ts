import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { compatibility } from "../src/compatibility.js";
import { emptyGame, GAMES_DIR, indexScript, isGameRoot, loadGame } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";

test("UPDATECHECK reports disabled without following the game URL or altering other result slots", () => {
  for (const jit of [false, true]) for (const forbidden of ["YES", "NO"]) {
    const game = emptyGame();
    game.config.set("UPDATECHECKを許可しない", forbidden);
    game.tables.set("GAMEBASE", new Map([[0, ["更新確認URL", "https://invalid.example/update"]]]));
    indexScript(game, `@SYSTEM_TITLE
FOR LOCAL, 0, 4
CALL CHECK_UPDATE
NEXT
RETURN
@CHECK_UPDATE
RESULT = 99, 77
RESULTS = unchanged
UPDATECHECK
PRINTFORML {RESULT} {RESULT:1} %RESULTS%
SELECTCASE RESULT
CASE 1, 2
THROW incorrectly reported an available update
CASE 3
THROW incorrectly reported a network error
ENDSELECT
RETURN`, "update-check.ERB");
    const snapshot = new Runtime(game, 50_000, { jit }).start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(snapshot.output.filter((item) => item.type === "text").map((item) => item.text),
      Array(4).fill("4 77 unchanged"));
    assert.deepEqual(compatibility(game).gaps, []);
    for (const args of ["1", '"url"', "0, 1"]) {
      const invalid = emptyGame();
      indexScript(invalid, `@SYSTEM_TITLE\nUPDATECHECK ${args}`, "invalid.ERB");
      const result = new Runtime(invalid, 50_000, { jit }).start();
      assert.equal(result.status, "error");
      assert.equal(result.error?.line, 2);
      assert.match(result.error!.message, /UPDATECHECK takes no arguments/);
    }
  }
});

const root = path.join(GAMES_DIR, "pops-tw");
test("pops-tw title layout ignores numeric assignment comments in interpreted and JIT execution", () => {
  for (const jit of [false, true]) {
    const game = emptyGame();
    indexScript(game, `@SYSTEM_TITLE
FOR LOCAL, 0, 5
CALL TITLE_LAYOUT
NEXT
RETURN
@TITLE_LAYOUT
#DIM MAX_LINES
#DIMS LABEL
MAX_LINES = CLIENTHEIGHT() ; can't automatically find it with GETCONFIG("WINDOW HEIGHT") so we have to assume.
MAX_LINES += 1 ; numeric compound assignment
LABEL '= "height;value" ; expression assignment
PRINTFORML {MAX_LINES == CLIENTHEIGHT() + 1} %LABEL%
LABEL = literal;value
PRINTSL LABEL
RETURN`, "title-layout.ERB");
    const snapshot = new Runtime(game, 50_000, { jit }).start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(snapshot.output.filter((item) => item.type === "text").map((item) => item.text),
      Array.from({ length: 5 }, () => ["1 height;value", "literal;value"]).flat());
  }
});

test("installed eraNAS has no lexical compatibility gaps or loader diagnostics", { skip: !isGameRoot(root) }, async () => {
  const report = compatibility(await loadGame(root));
  assert.deepEqual(report.gaps, []);
  assert.equal(report.recognizedInstructions, report.instructions);
  assert.equal(report.diagnosticCount, 0);
});
