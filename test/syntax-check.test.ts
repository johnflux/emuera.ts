import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parseExpression, useMacros } from "../src/expression.js";
import { emptyGame, indexScript } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";
import { createApp } from "../src/server.js";
import { checkSyntax } from "../src/syntax-check.js";

test("parenthesized postfix indices and extended CSV/hash functions pass syntax checks", async () => {
  const game = emptyGame();
  indexScript(game, `@SYSTEM_TITLE
LOCALS:(LOCAL+LOCAL:1+(LOCAL:2)++) = text
LOCALS:(LOCAL+(LOCAL:1)++) = text
PRINTFORML {GETCSVNOBYNICKNAME("name")} {HASH_XXH32("name")}
`, "extended.ERB");
  const report = await checkSyntax(game);
  assert.deepEqual(report.diagnostics, []);
  assert.deepEqual(report.references, []);
  assert.throws(() => parseExpression("(LOCAL + 1)++"), /needs a variable/);
});

test("syntax checks report unvisited errors by source and continue after broken routines", async () => {
  const game = emptyGame();
  indexScript(game, `@SYSTEM_TITLE
PRINT title
WAIT
@UNVISITED
IF 1 +
LOCAL = (2 +
PRINTFORML broken {1 +}
SETCOLOR 1 +
ENDIF
@BROKEN_BLOCK
IF 1
@AFTER_BLOCK
RETURNF (3 +
@BAD_PARAMETER(LOCAL = (2 + 1))
RETURN 0
@BAD_DEFAULT(LOCAL = 1 +)
RETURN 0
`, "errors.ERB");
  const before = new Runtime(game).start();
  assert.equal(before.status, "waiting");
  const routines = [...game.routines.values()].flat();
  const original = JSON.stringify(routines);
  const result = await checkSyntax(game);
  assert.equal(result.routines, 6);
  assert.equal(result.skippedLines, 0);
  assert.deepEqual(result.diagnostics.map((d) => d.line).sort((a, b) => a - b), [5, 6, 7, 8, 11, 13, 16]);
  assert.ok(result.diagnostics.every((d) => d.file === "errors.ERB"));
  assert.match(result.diagnostics.find((d) => d.line === 11)!.message, /Unclosed IF/);
  assert.equal(JSON.stringify(routines), original, "checking must not modify loaded routines");
});

test("syntax checks accept native text, declarations, macros, calls and CASE forms without execution", async () => {
  const game = emptyGame();
  indexScript(game, `#DIMS GLOBAL TEXT, 2 = "a", "b"
#DIM REF MATRIX,,
#DEFINE PAIR 1, 2
`, "valid.ERH", true);
  indexScript(game, `@UNVISITED(LOCAL = 3)
#DIMS DYNAMIC MESSAGE
#DIM REF PARAM,,
VARS INLINE = "hello"
VARI NUMBER = 3
TEXT = raw text; not a comment {NUMBER}
MESSAGE = parentheses (and "quotes") are text
INLINE = hello {NUMBER}
LOCALS = native %TEXT%
STR:0 = plain text
LOCAL '= PAIR
LOCAL += (3 + 2)
++LOCAL ;刻印数加算
--LOCAL ; decrement comment
LOCAL--
LOCAL:(LOCAL++) = 1
TIMES LOCAL, 1.25
PRINT literal {not an expression
PRINTFORML {NUMBER, 5, LEFT} %INLINE%
PRINTVL 'value'(,LOCAL,')
INPUTS words, more words
ONEINPUTS words, more words
CALL OTHER(, NUMBER)
CALLFORM OTHER_{NUMBER}, NUMBER
TRYCALLFORM %INLINE%(NUMBER)
CALLF MAX(1, 2)
SELECTCASE INLINE
CASE "Learning to walk", "Learning to talk"
CASE @"Going to {NUMBER}"
CASE "a" TO "z"
CASEELSE
ENDSELECT
SELECTCASE NUMBER
CASE IS >= 2, 1 TO 5
ENDSELECT
FOR LOCAL, 0, 3
NEXT
THROW this must not execute
@OTHER
RETURN 0
`, "valid.ERB");
  const previous = useMacros(new Map([["SENTINEL", "42"]]));
  try {
    const result = await checkSyntax(game);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.skippedLines, 0);
    assert.deepEqual(parseExpression("SENTINEL"), { kind: "literal", value: 42n }, "restore the active runtime's macro table");
  } finally { useMacros(previous); }
});

test("syntax checks include loader diagnostics and count unsupported lines separately", async () => {
  const game = emptyGame();
  indexScript(game, "@UNUSED\nBADCOMMAND (unparsed\nLOCAL = 1 +", "unknown.ERB");
  game.diagnostics.push({ file: "header.ERH", line: 4, message: "Loader problem" });
  const result = await checkSyntax(game);
  assert.equal(result.skippedLines, 1);
  assert.equal(result.lines, 2);
  assert.equal(result.diagnostics.length, 2);
  assert.deepEqual(result.diagnostics[0], game.diagnostics[0]);
});

test("syntax checks accept native eraFL FORM encoding and omitted FOR starts", async () => {
  const game = emptyGame();
  indexScript(game, await readFile(new URL("./fixtures/native-conformance-fl-syntax.erb", import.meta.url), "utf8"), "fl-syntax.ERB");
  assert.deepEqual((await checkSyntax(game)).diagnostics, []);
});

test("reference checks recognize globals, routine locals, macros and CSV indices without execution", async () => {
  const game = emptyGame();
  game.names.set("TALENT", new Map([["NAMED", 1]]));
  game.names.set("MATRIX@2", new Map([["COLUMN", 1]]));
  game.names.set("STRNAME", new Map([["SAVED_COMMENT", 1]]));
  indexScript(game, `#DIM SHARED
#DIM MATRIX, 2, 2
#DEFINE SHARED_MACRO SHARED
`, "global.ERH", true);
  indexScript(game, `@FIRST(ARG, ARGS)
#DIM PRIVATE
#DIMS MESSAGE
#DIM REF REFERENCE
#DIM DYNAMIC TEMPORARY
PRIVATE = SHARED_MACRO + ARG + TALENT:NAMED + MATRIX:0:COLUMN
REFERENCE:0 = TEMPORARY
VARI INLINE = PRIVATE
VARS WORDS = "text"
MESSAGE = literal UNKNOWN_TEXT %WORDS% {INLINE}
PRINTFORML {RAND:2} {LINECOUNT} {LASTLOAD_VERSION} {LASTLOAD_NO} %LASTLOAD_TEXT%
PRINTFORML {__INT_MAX__} {__INT_MIN__} %__FILE__% %__FUNCTION__% {__LINE__} %DRAWLINESTR%
PRINTFORML {GAMEBASE_GAMECODE}
PRINTFORML %MONEYLABEL% %STR:SAVED_COMMENT%
ARRAYSORT MATRIX, BACK
SORTCHARA NO, FORWARD
SORTCHARA BACK
DT_COLUMN_OPTIONS "table", "column", DEFAULT, SHARED
PRINTFORML {DT_COLUMN_OPTIONS("table", "column", DEFAULT, SHARED)}
CALL KNOWN
CALLF MAX(1, 2)
TRYCALL ABSENT, UNUSED_OPTIONAL_ARGUMENT
TRYCALLF ABSENT_METHOD(UNUSED_OPTIONAL_ARGUMENT)
CALLFORM KNOWN
CALLSHARP UnknownPlugin(SHARED)
TRYCALLLIST
FUNC ABSENT
ENDFUNC
@KNOWN
RETURN 0
`, "first.ERB");
  assert.deepEqual((await checkSyntax(game)).references, []);
  indexScript(game, `@SECOND
PRIVATE = SHARED
PRINTFORML {MISSING_FUNCTION(MISSING_VARIABLE)}
CALL MISSING_ROUTINE
CALLFORM MISSING_FORM_ROUTINE
CALLF MISSING_METHOD()
TALENT:UNKNOWN_INDEX = 1
`, "second.ERB");
  const report = await checkSyntax(game);
  assert.deepEqual(report.diagnostics, []);
  assert.deepEqual(report.references.map((d) => [d.file, d.line, d.message]), [
    ["second.ERB", 2, "Unknown variable: PRIVATE"],
    ["second.ERB", 3, "Unknown function: MISSING_FUNCTION"],
    ["second.ERB", 3, "Unknown variable: MISSING_VARIABLE"],
    ["second.ERB", 4, "Unknown routine: MISSING_ROUTINE"],
    ["second.ERB", 5, "Unknown routine: MISSING_FORM_ROUTINE"],
    ["second.ERB", 6, "Unknown routine: MISSING_METHOD"],
    ["second.ERB", 7, "Unknown variable: UNKNOWN_INDEX"],
  ]);
});

test("reference checks inspect declarations and defaults, deduplicate per line and skip literal/dynamic targets", async () => {
  const game = emptyGame();
  indexScript(game, "#DIM GLOBAL_VALUE = UNKNOWN_INITIAL", "globals.ERH", true);
  indexScript(game, `@CHECK(ARG = UNKNOWN_DEFAULT)
#DIM LOCAL_VALUE, UNKNOWN_SIZE
LOCAL_VALUE = UNKNOWN + UNKNOWN
PRINT literal {UNKNOWN_LITERAL}
LOCALS = literal UNKNOWN_LITERAL
CALLFORM OPTIONAL_%LOCALS%
PRINTFORML {KNOWN(LOCAL_VALUE)}
RETURN
@KNOWN(ARG)
#FUNCTION
RETURNF ARG
`, "refs.ERB");
  const report = await checkSyntax(game);
  assert.deepEqual(report.diagnostics, []);
  assert.deepEqual(report.references.map((d) => d.message), [
    "Unknown variable: UNKNOWN_INITIAL",
    "Unknown variable: UNKNOWN_DEFAULT",
    "Unknown variable: UNKNOWN_SIZE",
    "Unknown variable: UNKNOWN",
  ]);
});
test("ignored duplicate routines are informational and preserve the first definition", async () => {
  const game = emptyGame();
  indexScript(game, "@SYSTEM_TITLE\nCALL DUPLICATE\nQUIT\n@DUPLICATE\nPRINTL first\n@DUPLICATE\nTHROW ignored", "duplicates.ERB");
  const report = await checkSyntax(game);
  assert.equal(report.diagnostics.length, 1);
  assert.equal(report.diagnostics[0]!.severity, "info");
  assert.match(report.diagnostics[0]!.message, /this definition is ignored/);
  const result = new Runtime(game).start();
  assert.equal(result.status, "halted");
  assert.ok(result.output.some((item) => item.text === "first"));
});

test("relationship hotpatch treats demo-only controls as an optional reference", async () => {
  const game = emptyGame();
  indexScript(game, await readFile(new URL("../hotpatch/RELATIONSHIPS.ERB", import.meta.url), "utf8"), "hotpatch/RELATIONSHIPS.ERB");
  assert.equal(game.routines.has("DEMO_RELATIONSHIP_CONTROLS"), false);
  const dialog = game.routines.get("HOTPATCH_RELATIONSHIP_DIALOG")![0]!;
  assert.ok(dialog.lines.some((line) => line.text === "TRYCALL DEMO_RELATIONSHIP_CONTROLS"));
  const report = await checkSyntax(game);
  assert.ok(!report.references.some((d) => d.message.includes("DEMO_RELATIONSHIP_CONTROLS")));
});

test("native character CSV integer fallbacks are informational without hiding fatal numeric errors", async () => {
  const game = emptyGame();
  game.characters.set(2, { file: "Chara2.csv", rows: [["NO", "2"], ["CFLAG", "3", ".."]] });
  indexScript(game, "@SYSTEM_TITLE\nADDCHARA 2\nPRINTFORML {CFLAG:0:3}", "character.ERB");
  const result = new Runtime(game).start();
  assert.equal(result.status, "halted");
  assert.ok(result.output.some((item) => item.text === "1"));
  const report = await checkSyntax(game);
  assert.deepEqual(report.diagnostics, [{
    file: "Chara2.csv", line: 0, severity: "info", message: "Invalid character CSV integer defaults to 1: ..",
  }]);
  game.characters.set(2, { file: "Chara2.csv", rows: [["NO", "2"], ["CFLAG", "3", "9223372036854775808"]] });
  const failed = new Runtime(game).start();
  assert.equal(failed.status, "error");
  assert.match(failed.error!.message, /out of range/);
  assert.notEqual(failed.error!.severity, "info");
});

test("syntax checks match native comma tolerance but reject missing values and extra left commas", async () => {
  const game = emptyGame();
  indexScript(game, await readFile(new URL("./fixtures/native-conformance-commas.erb", import.meta.url), "utf8"), "commas.ERB");
  assert.deepEqual((await checkSyntax(game)).diagnostics, []);
  indexScript(game, "@INVALID\n#DIM VALUE\nVALUE ,= ,\nVALUE ,,= 7\nSIF 1 +,\nRETURN", "invalid.ERB");
  const errors = (await checkSyntax(game)).diagnostics;
  assert.deepEqual(errors.map((d) => d.line), [3, 4, 5]);
  assert.match(errors[0]!.message, /Assignment requires a value/);
  assert.match(errors[1]!.message, /extra ','/);
  for (const jit of [false, true]) {
    const invalid = emptyGame();
    indexScript(invalid, "@SYSTEM_TITLE\n#DIM VALUE\nVALUE ,= ,", "missing.ERB");
    const result = new Runtime(invalid, { jit }).start();
    assert.equal(result.status, "error");
    assert.match(result.error!.message, /Assignment requires a value/);
  }
  assert.throws(() => parseExpression("1,"), /Unexpected ','/, "expressions are still strict outside statement argument lists");
});

test("large concurrent scans yield without leaking game macros into active runtimes", async () => {
  const first = emptyGame(), second = emptyGame();
  first.macros.set("TOKEN", "1");
  second.macros.set("TOKEN", '"other"');
  indexScript(first, "@FIRST\n" + "LOCAL = TOKEN\n".repeat(5000) + "@LAST\nLOCAL = TOKEN", "first.ERB");
  indexScript(second, "@SECOND\nLOCALS '= TOKEN", "second.ERB");
  const previous = useMacros(new Map([["TOKEN", "99"]]));
  try {
    const scan = checkSyntax(first);
    assert.deepEqual(parseExpression("TOKEN"), { kind: "literal", value: 99n });
    const other = await checkSyntax(second);
    assert.deepEqual(other.diagnostics, []);
    assert.deepEqual((await scan).diagnostics, []);
    assert.deepEqual(parseExpression("TOKEN"), { kind: "literal", value: 99n });
  } finally { useMacros(previous); }
});

test("CASE range syntax ignores TO in quoted strings in interpreted and JIT execution", () => {
  for (const jit of [false, true]) {
    const game = emptyGame();
    indexScript(game, `@SYSTEM_TITLE
REPEAT 5
CALL MATCH_TEXT
REND
WAIT
@MATCH_TEXT
SELECTCASE "Learning to walk"
CASE "Learning to walk"
PRINTL matched
CASEELSE
THROW incorrect case
ENDSELECT
SELECTCASE "a"
CASE "a" TO "z"
PRINTL range
ENDSELECT
`, "case.ERB");
    const result = new Runtime(game, { jit }).start();
    assert.equal(result.status, "waiting", JSON.stringify(result.error));
    assert.equal(result.output.filter((item) => item.text === "matched").length, 5);
    assert.equal(result.output.filter((item) => item.text === "range").length, 5);
  }
});

test("compatibility syntax endpoint selects its game, caches results and leaves play available", async () => {
  const good = emptyGame(), bad = emptyGame();
  indexScript(good, "@SYSTEM_TITLE\nPRINTL good\nWAIT", "good.ERB");
  indexScript(bad, "@UNUSED\nLOCAL = 1 +", "bad.ERB");
  const app = createApp([{ id: "good", title: "Good", game: good }, { id: "bad", title: "Bad", game: bad }]);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  const post = (route: string, data: object) => fetch(`http://127.0.0.1:${address.port}${route}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  try {
    const results = await Promise.all([post("/api/compatibility/syntax", { game: "bad" }), post("/api/compatibility/syntax", { game: "good" })]);
    assert.deepEqual(results.map((r) => r.status), [200, 200]);
    const [badReport, goodReport] = await Promise.all(results.map((r) => r.json()));
    assert.equal(badReport.diagnostics.length, 1);
    assert.equal(goodReport.diagnostics.length, 0);
    assert.equal(badReport.diagnostics[0].file, "bad.ERB");
    assert.deepEqual(await (await post("/api/compatibility/syntax", { game: "bad" })).json(), badReport);
    assert.equal((await post("/api/compatibility/syntax", { game: "missing" })).status, 404);
    const start = await (await post("/api/start", { mode: "game", game: "good" })).json();
    assert.equal(start.status, "waiting");
    assert.ok(start.output.some((item: { text?: string }) => item.text === "good"));
  } finally {
    app.closeAllConnections();
    await new Promise<void>((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});

test("compatibility screen runs a game-specific syntax check and exposes results and failures", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf('document.querySelector("#report").addEventListener'), source.indexOf("const library = createLibrary("));
  class Element {
    private content = "";
    className = "";
    get textContent(): string { return this.content + this.children.map((child) => child.textContent).join(""); }
    set textContent(value: string) { this.content = value; this.children = []; }
    disabled = false;
    hidden = true;
    children: Element[] = [];
    listeners = new Map<string, () => Promise<void>>();
    append(...elements: Element[]) { this.children.push(...elements); }
    replaceChildren() { this.children = []; }
    setAttribute() {}
    scrollIntoView() {}
    addEventListener(name: string, callback: () => Promise<void>) { this.listeners.set(name, callback); }
  }
  const toggle = new Element(), report = new Element();
  let game = "selected", fail = false;
  const calls: unknown[] = [], messages: unknown[] = [];
  const info = { file: "duplicate.ERB", line: 9, message: "Duplicate definition ignored", severity: "info" };
  runInNewContext(handler, {
    document: { querySelector: () => toggle, createElement: () => new Element() },
    report, get runGame() { return game; }, gameTitle: (id: string) => id,
    showReport: (show: boolean) => { report.hidden = !show; },
    message: (...args: unknown[]) => messages.push(args),
    api: async (url: string, data: unknown) => {
      calls.push([url, data]);
      if (url.startsWith("/api/compatibility?")) return {
        scriptFiles: 1, functions: 2, csvTables: 0, sprites: 0, note: "", gaps: [], diagnostics: [info], diagnosticCount: 1,
      };
      if (fail) throw new Error("scan unavailable");
      return { routines: 2, lines: 12, skippedLines: 1, diagnostics: [{ file: "<script>.ERB", line: 8, message: "Expected value" }, info],
        references: [{ file: "refs.ERB", line: 3, message: "Unknown variable: TYPO" }] };
    },
  });
  await toggle.listeners.get("click")!();
  game = "different";
  const button = report.children.find((element) => element.textContent === "Check syntax")!;
  const result = report.children[4]!;
  const pending = button.listeners.get("click")!();
  assert.equal(button.disabled, true);
  assert.equal(result.textContent, "Checking syntax...");
  await pending;
  assert.equal(button.disabled, false);
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(["/api/compatibility/syntax", { game: "selected" }]));
  assert.match(result.textContent, /2 routines \/ 12 lines \/ 1 errors \/ 1 info \/ 1 reference warnings \/ 1 unsupported lines not checked/);
  assert.match(result.textContent, /refs\.ERB:3: Reference: Unknown variable: TYPO/);
  assert.match(result.textContent, /<script>\.ERB:8: Expected value/);
  assert.ok(result.textContent.includes("\u2139 duplicate.ERB:9: Duplicate definition ignored"));
  assert.ok(report.children.at(-1)!.textContent.includes("\u2139 duplicate.ERB:9: Duplicate definition ignored"));
  assert.equal(result.children[0]!.className, "");
  assert.equal(result.children[1]!.className, "diagnostic-info");
  assert.equal(report.children.at(-1)!.children[0]!.className, "diagnostic-info");
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /#compatibility \.diagnostic-info \{ color: #666; \}/);
  fail = true;
  await button.listeners.get("click")!();
  assert.equal(button.disabled, false);
  assert.equal(result.textContent, "Syntax check failed: scan unavailable");
  assert.equal(messages.length, 1);
});
