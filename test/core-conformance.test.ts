import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { emptyGame, indexScript, isGameRoot, loadGame } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";

const suite = fileURLToPath(new URL("../OTHER/emuera-tty/compat", import.meta.url));

for (const jit of [false, true]) {
  test(`installed eraBasic conformance suite (${jit ? "JIT" : "interpreted"})`, { skip: !isGameRoot(suite) }, async () => {
    const game = await loadGame(suite);
    assert.deepEqual(game.diagnostics, []);
    const runtime = new Runtime(game, 2_000_000, { jit });
    const snapshot = runtime.start();
    assert.equal(snapshot.status, "waiting", JSON.stringify(snapshot.error));
    assert.equal(snapshot.input?.kind, "wait");
    const lines = snapshot.output.flatMap(line => "text" in line ? line.text.split(/\r?\n/) : []);
    assert.deepEqual(lines.filter(line => /^(NG  |SKIP )/.test(line)), []);
    const summary = lines.find(line => line.startsWith("== "));
    assert.ok(summary, "suite must reach its final summary");
    const counts = /^== (\d+) checks: (\d+) passed, 0 failed ==$/.exec(summary);
    assert.ok(counts, summary);
    assert.ok(Number(counts[1]) >= 528, "suite must exercise at least the audited 528 checks");
    assert.equal(counts[1], counts[2]);
    assert.equal(runtime.input("").status, "halted");
  });
  test(`native startup and RESETDATA defaults (${jit ? "JIT" : "interpreted"})`, async () => {
    const source = await readFile(new URL("./fixtures/native-conformance-defaults.erb", import.meta.url), "utf8");
    const game = emptyGame();
    indexScript(game, source, "native-conformance-defaults.erb");
    const snapshot = new Runtime(game, 50_000, { jit }).start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(snapshot.output.filter(line => line.type === "text").map(line => line.text), [
      "INITIAL 0 1 -1", "MONEY [$1234] [$-1,234] [$0007] [$zero]", "RESET 0 1 -1",
      "DONE", "Log written to emuera.log",
    ]);
  });
  for (const [fixture, expected] of [
    ["shifts", [
      "CONST 1 2 4 -4", "NEG -9223372036854775808 -1 1",
      "LARGE -9223372036854775808 8", "VAR 2 4", "ASSIGN 6",
    ]],
    ["select", ["RANGE 1 2 2 2 4 3", "EQUAL 1 3 3", "REVERSE 2"]],
    ["methods", ["METHOD 1 2 0 0", "BUILTIN 0 0 0", "RESULT 2"]],
    ["maps", [
      "ABSENT -1 -1 [] -1 1", "CREATE 1 0 0 1", "SET 1 1 1 [two]",
      "KEYS 1 0 1 1", "STATEMENT 0", "STATEMENT 1 [three]", "RELEASE 1 0 -1",
    ]],
  ] as const) {
    test(`native ${fixture} conformance fixture (${jit ? "warmed JIT" : "interpreted"})`, async () => {
      const source = await readFile(new URL(`./fixtures/native-conformance-${fixture}.erb`, import.meta.url), "utf8");
      const game = emptyGame();
      indexScript(game, source, `native-conformance-${fixture}.erb`);
      const snapshot = new Runtime(game, 50_000, { jit }).start();
      assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
      assert.deepEqual(snapshot.output.filter(line => line.type === "text").map(line => line.text), [
        ...Array.from({ length: 45 }, () => [...expected]).flat(), "DONE", "Log written to emuera.log",
      ]);
    });
  }
  test(`native built-in dimensions and legacy arrays (${jit ? "warmed JIT" : "interpreted"})`, async () => {
    const source = await readFile(new URL("./fixtures/native-conformance-sizes.erb", import.meta.url), "utf8");
    const game = emptyGame();
    indexScript(game, source, "native-conformance-sizes.erb");
    const snapshot = new Runtime(game, 50_000, { jit }).start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(snapshot.output.filter(line => line.type === "text").map(line => line.text), [
      "STRINGS 20000 100 100 100 100",
      "CHARACTER 100 100 100 100 100 100 100 100",
      "OTHER 1000 1000 200 200 100 100 100 100 100 100 100 100",
      "MULTI 100 100 100 100 100 100 100",
      ...Array(45).fill("LEGACY 3 4 5 6"), "DONE", "Log written to emuera.log",
    ]);
  });
  test(`configured dimensions override built-in defaults (${jit ? "warmed JIT" : "interpreted"})`, () => {
    const game = emptyGame();
    for (const [name, dimensions] of [
      ["BASE", [7]], ["ABL", [8]], ["PALAM", [9]], ["RESULTS", [12]],
      ["SAVESTR", [13]], ["GLOBALS", [14]], ["DA", [2, 3]], ["TA", [2, 3, 4]],
    ] as const) game.variableSizes.set(name, [...dimensions]);
    indexScript(game, `@SYSTEM_TITLE
FOR A,0,45
CALL CHECK_SIZES
NEXT
QUIT
@CHECK_SIZES
DA:1:2 = 15
TA:1:2:3 = 16
PRINTFORML {VARSIZE("BASE")} {VARSIZE("ABL")} {VARSIZE("CUP")} {VARSIZE("CDOWN")} {VARSIZE("RESULTS")} {VARSIZE("SAVESTR")} {VARSIZE("GLOBALS")} {VARSIZE("DA",1)} {VARSIZE("TA",2)} {DA:1:2} {TA:1:2:3}`, "configured-sizes.erb");
    const snapshot = new Runtime(game, 50_000, { jit }).start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(snapshot.output.filter(line => line.type === "text").map(line => line.text),
      Array(45).fill("7 8 9 9 12 13 14 3 4 15 16"));
  });
}
