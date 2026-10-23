import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyGame, indexScript } from "../src/loader.js";
import { Runtime, type Snapshot } from "../src/runtime.js";
import { FileGlobalStore, MemoryGlobalStore } from "../src/storage.js";
import { EraError, splitArguments, stripComment } from "../src/model.js";

function game(source: string, headers = "") {
  const value = emptyGame();
  if (headers) indexScript(value, headers, "globals.ERH", true);
  indexScript(value, source, "title.ERB");
  return value;
}
function printed(snapshot: Snapshot): string {
  return snapshot.output.filter((item) => item.type === "text").map((item) => item.text).join("\n");
}
test("formatted literals, nested string expressions and lazy FORM conditionals", () => {
  const source = String.raw`@SYSTEM_TITLE
LOCALS '= @"Version: \@ 1 ? %TOSTR(4,"000")% # %MISSING()% \@"
PRINTFORML %LOCALS%
LOCALS '= @"\@ 0 ? wrong # \@ 1 ? right # wrong \@ \@"
PRINTFORML %LOCALS%
PRINTFORML \%literal\% \{braces\}
PRINTSL @"Nested %TOSTR(3, "00")%, %@"inner {2}"%"`;
  const result = new Runtime(game(source)).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.equal(printed(result), "Version: 004\nright\n%literal% {braces}\nNested 03, inner 2");
  const argumentsSource = String.raw`@"x %TOSTR(3, "00")% ; quoted", 2`;
  assert.equal(splitArguments(argumentsSource).length, 2);
  assert.equal(stripComment(argumentsSource + " ; outside"), argumentsSource);
});
test("expression functions bind omitted arguments, enforce types and cannot print", () => {
  const result = new Runtime(game(`@SYSTEM_TITLE
PRINTFORML {ADD(3,,5)} %LABEL()%
RETURN
@ADD(ARG, ARG:1=4, ARG:2=6)
#FUNCTION
RETURNF ARG + ARG:1 + ARG:2
@LABEL(ARGS="default")
#FUNCTIONS
RETURNF ARGS`)).start();
  assert.equal(printed(result), "12 default");
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  for (const [body, expected] of [
    ['PRINTL forbidden\nRETURNF 1', /attempted output/],
    ['RETURNF "wrong"', /integer/],
  ] as const) {
    const invalid = new Runtime(game("@SYSTEM_TITLE\nA = FUNC()\nRETURN\n@FUNC\n#FUNCTION\n" + body)).start();
    assert.equal(invalid.status, "error");
    assert.match(invalid.error!.message, expected);
  }
});
test("dynamic private variables reset each call while static private variables persist", () => {
  const result = new Runtime(game(`@SYSTEM_TITLE
CALL INC
CALL INC
RETURN
@INC
#DIM DYNAMIC TEMP
#DIM TOTAL
TEMP++
TOTAL++
PRINTFORML {TEMP}/{TOTAL}`)).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.equal(printed(result), "1/1\n1/2");
});
test("global save/load round trip across independent runtimes, missing file status and corruption errors", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-globals-"));
  const file = path.join(root, "global.json");
  try {
    const headers = '#DIM GLOBAL SETTING, 2\n#DIMS GLOBAL LABEL = "initial"';
    const saveGame = game(`@SYSTEM_TITLE
LOADGLOBAL
PRINTFORML missing={RESULT}
GLOBAL:2 = 9223372036854775807
GLOBALS:1 '= "saved"
SETTING:1 = 42
LABEL '= "configured"
SAVEGLOBAL
PRINTFORML saved={RESULT}`, headers);
    const saved = new Runtime(saveGame, 50_000, { store: new FileGlobalStore(file) }).start();
    assert.equal(saved.status, "halted", JSON.stringify(saved.error));
    assert.equal(printed(saved), "missing=0\nsaved=1");
    assert.ok((await readFile(file, "utf8")).includes("9223372036854775807"));
    const loadGame = game(`@SYSTEM_TITLE
LOADGLOBAL
PRINTFORML loaded={RESULT} {GLOBAL:2} %GLOBALS:1% {SETTING:1} %LABEL%`, headers);
    const loaded = new Runtime(loadGame, 50_000, { store: new FileGlobalStore(file) }).start();
    assert.equal(printed(loaded), "loaded=1 9223372036854775807 saved 42 configured");
    await writeFile(file, "{bad json");
    const bad = new Runtime(loadGame, 50_000, { store: new FileGlobalStore(file) }).start();
    assert.equal(bad.status, "error");
    assert.match(bad.error!.message, /Invalid global data JSON/);
    assert.equal(bad.error!.line, 2);
    const blocked = path.join(root, "blocked");
    await writeFile(blocked, "not a directory");
    const failed = new Runtime(saveGame, 50_000, { store: new FileGlobalStore(path.join(blocked, "save.json")) }).start();
    assert.equal(failed.status, "error");
    assert.match(failed.error!.message, /Cannot load global data/);
    const failedSave = new Runtime(game("@SYSTEM_TITLE\nSAVEGLOBAL"), 50_000, {
      store: new FileGlobalStore(path.join(blocked, "save.json")),
    }).start();
    assert.equal(failedSave.status, "error");
    assert.match(failedSave.error!.message, /Cannot save global data/);
  } finally { await rm(root, { recursive: true }); }
});
test("global saves reject invalid numeric data and map operations retain actual entries", () => {
  const store = new MemoryGlobalStore();
  store.save({ GLOBAL: { "0": "not an integer" } });
  assert.match(new Runtime(game("@SYSTEM_TITLE\nLOADGLOBAL"), 50_000, { store }).start().error!.message, /Invalid saved integer/);
  const result = new Runtime(game(`@SYSTEM_TITLE
MAP_RELEASE "test"
MAP_CREATE "test"
MAP_SET "test", "one", "value"
MAP_SET "test", "one", "updated"
PRINTFORML {MAP_EXIST("test")} {MAP_SIZE("test")} {MAP_HAS("test","one")} %MAP_GET("test","one")%
MAP_RELEASE "test"
PRINTFORML {MAP_EXIST("test")}`)).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.equal(printed(result), "1 1 1 updated\n0");
});
test("CSV lookup references, declared variable sizes and GETVARS", () => {
  const data = game(`@SYSTEM_TITLE
PRINTFORML {GETNUM(TALENT, "example")} {GETNUM(TALENT, "missing")} {VARSIZE("LABELS")} %GETVARS("LABELS:1")%`, '#DIMS LABELS = "first", "second"');
  data.names.set("TALENT", new Map([["EXAMPLE", 7]]));
  const result = new Runtime(data).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.equal(printed(result), "7 -1 2 second");
});
test("unfinished print buffer can be popped, decoded and split without duplicating output", () => {
  const result = new Runtime(game(`@SYSTEM_TITLE
#DIMS DYNAMIC PARTS, 4
PRINT Literal <b>text</b>
LOCALS '= HTML_TOPLAINTEXT(HTML_POPPRINTINGSTR())
PRINTSL LOCALS
SPLIT "one:two", ":", PARTS
PRINTFORML {RESULT} %PARTS:0% %PARTS:1%
VARSET PARTS
PRINTFORML cleared=%PARTS:0%
PRINTSL HTML_TOPLAINTEXT("<b>safe &amp; text</b><br>next")`)).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.equal(result.output[1]?.type, "clear");
  assert.match(printed(result), /Literal <b>text<\/b>/);
  assert.match(printed(result), /2 one two/);
  assert.match(printed(result), /safe & text\nnext/);
});
test("string regex helpers and omitted defaults support game-style wrapping", () => {
  const result = new Runtime(game(String.raw`@SYSTEM_TITLE
PRINTFORML {STRCOUNT("one two three", "\s")}
PRINTSL REPLACE("one two", "(\w+)", "[$1]")
PRINTSL SUBSTRING("abc", 1, 2)
PRINTFORML {STRLENS("Aあ")}
PRINTSL @"\@ 1 ? ok # wrong \@"
DEBUGPRINTFORML ------------------------------
PRINTL done`)).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.equal(printed(result), "2\n[one] [two]\nbc\n3\nok\ndone");
});
test("PRINTDATA selects real entries and print styling, redraw and memory cleanup are executable", () => {
  const data = game(`@SYSTEM_TITLE
REDRAW 0
FONTSTYLE 3
PRINTDATAL
DATA first
DATAFORM {2 + 2}
ENDDATA
REDRAW 1
PRINTFORML {GETSTYLE()}
CLEARMEMORY
PRINTFORML {RESULT >= 0}
INPUT`);
  for (let i = 0; i < 5; i++) {
    const result = new Runtime(data).start();
    assert.equal(result.status, "waiting", JSON.stringify(result.error));
    const first = result.output[0];
    assert.ok(first?.type === "text" && ["first", "4"].includes(first.text));
    assert.equal(first.style.fontStyle, 3);
    assert.match(printed(result), /\n3\n1$/);
  }
  assert.throws(() => new Runtime(data, 50_000, { columns: -1 }), EraError);
});
test("literal print arguments retain spacing and semicolons", () => {
  const result = new Runtime(game("@SYSTEM_TITLE\nPRINT Random Tip: \nPRINTL text;not a comment")).start();
  const first = result.output[0];
  assert.ok(first?.type === "text");
  assert.equal(first.text, "Random Tip: ");
  assert.match(printed(result), /text;not a comment/);
});
