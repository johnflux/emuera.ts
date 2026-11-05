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
++LOCAL
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
    textContent = "";
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
  runInNewContext(handler, {
    document: { querySelector: () => toggle, createElement: () => new Element() },
    report, get runGame() { return game; }, gameTitle: (id: string) => id,
    showReport: (show: boolean) => { report.hidden = !show; },
    message: (...args: unknown[]) => messages.push(args),
    api: async (url: string, data: unknown) => {
      calls.push([url, data]);
      if (url.startsWith("/api/compatibility?")) return {
        scriptFiles: 1, functions: 2, csvTables: 0, sprites: 0, note: "", gaps: [], diagnostics: [], diagnosticCount: 0,
      };
      if (fail) throw new Error("scan unavailable");
      return { routines: 2, lines: 12, skippedLines: 1, diagnostics: [{ file: "<script>.ERB", line: 8, message: "Expected value" }] };
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
  assert.match(result.textContent, /2 routines \/ 12 lines \/ 1 errors \/ 1 unsupported lines not checked/);
  assert.match(result.textContent, /<script>\.ERB:8: Expected value/);
  fail = true;
  await button.listeners.get("click")!();
  assert.equal(button.disabled, false);
  assert.equal(result.textContent, "Syntax check failed: scan unavailable");
  assert.equal(messages.length, 1);
});
