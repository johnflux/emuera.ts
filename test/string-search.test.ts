import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { emptyGame, indexScript } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";

for (const jit of [false, true]) {
  test(`native STRFIND(U) index conversion and boundaries (${jit ? "warmed JIT" : "interpreted"})`, async () => {
    const source = await readFile(new URL("./fixtures/native-string-search.erb", import.meta.url), "utf8");
    const game = emptyGame();
    indexScript(game, source, "native-string-search.erb");
    const snapshot = new Runtime(game, 50_000, { jit }).start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    const expected = [
      "START -1 U -1 B 1 UE -1 BE 0",
      "START -99 U -1 B 1 UE -1 BE 0",
      "START 0 U 1 B 1 UE 0 BE 0",
      "START 1 U 1 B 1 UE 1 BE 1",
      "START 3 U -1 B -1 UE -1 BE -1",
      "START 4 U -1 B -1 UE -1 BE -1",
      "START 2147483648 U -1 B 1 UE -1 BE 0",
      "START 4294967296 U 1 B 1 UE 0 BE 0",
      "START 9007199254740992 U 1 B 1 UE 0 BE 0",
      "START 9223372036854775807 U -1 B 1 UE -1 BE 0",
      "START -9223372036854775808 U 1 B 1 UE 0 BE 0",
      "START -4294967296 U 1 B 1 UE 0 BE 0",
      "START -2147483649 U -1 B -1 UE -1 BE -1",
      "EMPTY -1 -1 -1 -1", "WIDTH 0 2 2 -1 -1", "STATEMENT -1", "STATEMENT 1",
    ];
    assert.deepEqual(snapshot.output.filter(line => line.type === "text").map(line => line.text), [
      ...Array.from({ length: 45 }, () => expected).flat(), "DONE", "Log written to emuera.log",
    ]);
  });

  test(`missing closing bracket terminates a settings-column scan (${jit ? "warmed JIT" : "interpreted"})`, () => {
    const game = emptyGame();
    indexScript(game, `@SYSTEM_TITLE
FOR A,0,45
CALL SCAN_COLUMN
NEXT
QUIT
@SCAN_COLUMN
#DIMS Description
#DIM ClosingBracket
Description = Settings label
ClosingBracket = STRFINDU(Description, "]")
IF STRFINDU(Description, "[", ClosingBracket) != -1
THROW Unexpected bracket
ENDIF
PRINTL OK`, "settings-column.erb");
    const snapshot = new Runtime(game, 50_000, { jit }).start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(snapshot.output.filter(line => line.type === "text").map(line => line.text), Array(45).fill("OK"));
  });
}
