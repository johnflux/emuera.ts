import assert from "node:assert/strict";
import { test } from "node:test";
import { compatibility } from "../src/compatibility.js";
import { evaluate, parseExpression } from "../src/expression.js";
import { csvRows, emptyGame, indexScript } from "../src/loader.js";
import { EraError } from "../src/model.js";
import { Runtime, type Snapshot } from "../src/runtime.js";

function runtime(source: string, headers = "", limit?: number) {
  const game = emptyGame();
  if (headers) indexScript(game, headers, "globals.ERH", true);
  indexScript(game, source, "test.ERB");
  return new Runtime(game, limit);
}
function output(snapshot: Snapshot): string {
  return snapshot.output.map((item) => item.type === "text" || item.type === "html" ? item.text : "").join("\n");
}
const context = {
  get(): never { throw new EraError("Unexpected variable evaluation"); },
  call(): never { throw new EraError("Unexpected function evaluation"); },
};
test("signed 64-bit arithmetic, precedence, ternary and short circuit without eval", () => {
  for (const [source, expected] of [
    ["2 + 3 * 4", 14n], ["-7 / 3", -2n], ["9223372036854775807 + 1", -9223372036854775808n],
    ["0 && BAD()", 0n], ["1 || BAD()", 1n], ["1 ? 4 # BAD()", 4n], ["0 ? BAD() # 8", 8n],
    ["1 << 40", 1099511627776n], ['"a" + "b"', "ab"], ['"a" * 3', "aaa"],
    ["1 || 0 && 0", 0n],
  ] as const) assert.equal(evaluate(parseExpression(source), context), expected, source);
  assert.throws(() => evaluate(parseExpression("1 / 0"), context), /Division by zero/);
  assert.throws(() => evaluate(parseExpression('"1" + 2'), context), /string/);
  assert.throws(() => parseExpression("process.exit()"), /Unsupported/);
});
test("CSV comments, escaped quotes, quoted commas and semicolons", () => {
  assert.deepEqual(csvRows('; comment\n0,"a,b"\n1,"x;""y"; ignored'), [["0", "a,b"], ["1", 'x;"y']]);
});
test("nested branches, SIF, loops, BREAK, CONTINUE, negative FOR and SELECTCASE", () => {
  const rt = runtime(`@SYSTEM_TITLE
A = 0
IF 1
  IF 0
    A = 100
  ELSEIF 1
    A = 2
  ELSE
    A = 200
  ENDIF
ELSEIF 1
  A = 300
ELSE
  A = 400
ENDIF
SIF 0
  A = 999
FOR B, 5, 0, -1
  SIF B == 4
    CONTINUE
  SIF B == 2
    BREAK
  A += B
NEXT
WHILE A < 12
  A++
WEND
DO
  A++
LOOP A < 14
REPEAT 2
  A += COUNT
REND
SELECTCASE A
  CASE 1 TO 10
    PRINTL wrong
  CASE 15
    PRINTL correct
  CASEELSE
    PRINTL wrong default
ENDSELECT
PRINTFORML {A}`);
  const result = rt.start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.equal(output(result), "correct\n15");
});
test("empty branches and false loops do not enter bodies", () => {
  const result = runtime(`@SYSTEM_TITLE
IF 1
ELSEIF 1
  THROW wrong
ELSE
  THROW wrong
ENDIF
IF 0
  THROW wrong
ENDIF
FOR A,0,0
  THROW wrong
NEXT
WHILE 0
  THROW wrong
WEND
PRINTL ok`).start();
  assert.equal(result.status, "halted");
  assert.equal(output(result), "ok");
});
test("calls, parameter binding, string assignment, input suspension and validation", () => {
  const rt = runtime(`@SYSTEM_TITLE
CALL MUL(6, 7)
PRINTFORML {RESULT}
INPUT
PRINTFORML {RESULT}
INPUTS
LOCALS '= RESULTS + "!"
PRINTFORML %LOCALS%
RETURN
@MUL(ARG:0, ARG:1)
RETURN ARG:0 * ARG:1`);
  const first = rt.start();
  assert.equal(output(first), "42");
  assert.equal(first.input?.kind, "integer");
  assert.throws(() => rt.input("not a number"), /whole number/);
  assert.throws(() => rt.input("9223372036854775808"), /64-bit/);
  const second = rt.input("23");
  assert.equal(output(second), "23");
  assert.equal(second.input?.kind, "string");
  assert.equal(output(rt.input("<b>safe as text</b>")), "<b>safe as text</b>!");
});
test("global/private declarations, multidimensional arrays and CSV aliases", () => {
  const game = emptyGame();
  game.names.set("FLAG", new Map([["SCORE", 7]]));
  indexScript(game, '#DIM CONST SIZE_CONST = 3\n#DIMS LABEL = "score"\n#DIM GRID, 2, 3', "test.ERH", true);
  indexScript(game, `@SYSTEM_TITLE
#DIM X
X = SIZE_CONST + 1
FLAG:SCORE = X
GRID:1:2 = FLAG:SCORE
PRINTFORML %LABEL% {GRID:1:2}`, "test.ERB");
  const snapshot = new Runtime(game).start();
  assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
  assert.equal(output(snapshot), "score 4");
});
test("constants, unknown variables, bounds, bad declarations and directives fail with locations", () => {
  for (const [body, headers, expected] of [
    ["FIXED_VALUE = 4", "#DIM CONST FIXED_VALUE = 3", /constant/],
    ["MISSING = 1", "", /Unknown variable/],
    ["A:1000 = 1", "", /out of range/],
    ["PRINTFORML {BADSIZE}", "#DIM BADSIZE, 0", /dimensions/],
    ["#FUNCTION\nRETURN 1", "", /directive/],
    ["IF 1\nPRINTL bad", "", /Unclosed IF/],
    ["GOTO missing", "", /Unknown label/],
    ["UNSUPPORTED_THING", "", /Unsupported instruction/],
  ] as const) {
    const result = runtime("@SYSTEM_TITLE\n" + body, headers).start();
    assert.equal(result.status, "error", body);
    assert.match(result.error!.message, expected);
    assert.ok(result.error!.line > 0, JSON.stringify(result.error));
  }
});
test("budget stops infinite loops and global QUIT stops callers", () => {
  const infinite = runtime("@SYSTEM_TITLE\n$AGAIN\nGOTO AGAIN", "", 25).start();
  assert.match(infinite.error!.message, /Instruction limit/);
  const quit = runtime("@SYSTEM_TITLE\nCALL STOP\nTHROW should not execute\n@STOP\nQUIT").start();
  assert.equal(quit.status, "halted");
  const recursive = runtime("@SYSTEM_TITLE\nCALL SYSTEM_TITLE").start();
  assert.match(recursive.error!.message, /Recursive calls/);
});
test("string parameters default to empty strings and built-ins reject invalid arguments", () => {
  const result = runtime(`@SYSTEM_TITLE
CALL GREET
RETURN
@GREET(ARGS)
PRINTFORML Default [%ARGS%]`).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.equal(output(result), "Default []");
  for (const expr of ["ABS(1,2)", "LIMIT(1,5,2)", "MAXWIDTH(5)"]) {
    const invalid = runtime(`@SYSTEM_TITLE\nA = ${expr}`).start();
    assert.equal(invalid.status, "error", expr);
  }
});
test("preprocessing, BOM, unsupported signatures and lexical report", () => {
  const game = emptyGame();
  indexScript(game, '\uFEFF@SYSTEM_TITLE\n[IF_DEBUG]\nTHROW debug\n[ELSE]\nPRINTL release\n[ENDIF]\n[SKIPSTART]\nBAD\n[SKIPEND]\nBADCOMMAND', "sample.ERB");
  assert.equal(output(new Runtime(game).start()), "release");
  const report = compatibility(game);
  assert.equal(report.gaps.find((gap) => gap.feature === "Instruction: BADCOMMAND")?.count, 1);
  assert.match(report.note, /Lexical inventory/);
  indexScript(game, "@BROKEN(A,", "bad.ERB");
  assert.ok(game.diagnostics.some((d) => d.file === "bad.ERB"));
});
test("macro conditionals test definitions, not debug mode or macro values, and preserve nested branch selection", () => {
  const game = emptyGame();
  indexScript(game, "#DEFINE PRESENT 0\n#DEFINE OTHER 1", "macros.ERH", true);
  indexScript(game, `@SYSTEM_TITLE
[IF DEBUG]
THROW DEBUG is not defined
[ELSEIF PRESENT]
  [IF MISSING]
  THROW missing
  [ELSE]
  PRINTL selected
  [ENDIF]
[ELSEIF OTHER]
THROW already selected
[ELSE]
THROW already selected
[ENDIF]
[IF MISSING]
  [IF PRESENT]
  THROW outer inactive
  [ENDIF]
[ELSE]
PRINTL fallback
[ENDIF]
[IF_NDEBUG]
PRINTL release
[ENDIF]
[UNSUPPORTED_DIRECTIVE]`, "conditional.ERB");
  const snapshot = new Runtime(game).start();
  assert.equal(output(snapshot), "selected\nfallback\nrelease");
  assert.equal(snapshot.status, "error");
  const report = compatibility(game);
  assert.ok(!report.gaps.some((gap) => gap.feature.startsWith("Instruction: [")));
  assert.ok(report.gaps.some((gap) => gap.feature === "Preprocessor directive: [UNSUPPORTED_DIRECTIVE]"));
  const debug = emptyGame();
  indexScript(debug, "#DEFINE DEBUG", "debug.ERH", true);
  indexScript(debug, "@SYSTEM_TITLE\n[IF DEBUG]\nPRINTL defined\n[ELSE]\nTHROW wrong\n[ENDIF]", "debug.ERB");
  assert.equal(output(new Runtime(debug).start()), "defined");
  for (const source of ["[ELSEIF FEATURE]", "[ELSE]\n[ELSE]", "[IF MISSING]\n[ELSE]\n[ELSEIF OTHER]"]) {
    assert.throws(() => indexScript(emptyGame(), source, "bad-conditional.ERB"), EraError);
  }
});
test("HTML output is structured and never executed by the interpreter", () => {
  const result = runtime(`@SYSTEM_TITLE
HTML_PRINT "<p><button value='2'>Choose</button><img src='test'></p>"
PRINTBUTTON "plain", 3
WAIT`).start();
  assert.equal(result.input?.kind, "wait");
  assert.equal(result.output[0]?.type, "html");
  assert.equal(result.output[1]?.type, "button");
});
test("multiline statements join before classification, including declarations and function signatures", () => {
  const game = emptyGame();
  indexScript(game, `{
#DIMS CONST NAMES =
  "first",
  "second"
}`, "multiline.ERH", true);
  indexScript(game, `{
@SYSTEM_TITLE
}
#DIMS nameArray, 2, 3
{
nameArray:1:0 '=
  "ogname",
  "～The Eternal Young Scarlet Moon～",
  "literal {braces}; commas, too"
}
{
PRINTFORML
  %NAMES:1%: %nameArray:1:1%
}
`, "multiline.ERB");
  const routine = game.routines.get("SYSTEM_TITLE")![0]!;
  assert.equal(routine.lines.length, 2);
  assert.equal(routine.lines[0]!.line, 6);
  assert.equal(routine.lines[1]!.line, 12);
  assert.deepEqual(compatibility(game).gaps, []);
  const snapshot = new Runtime(game).start();
  assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
  assert.equal(output(snapshot), "second: ～The Eternal Young Scarlet Moon～");
});
test("multiline concatenation happens before comments and excluded debug branches remain excluded", () => {
  const snapshot = runtime(`@SYSTEM_TITLE
{
A = 1 ; continuation is also part of this comment
  + 999
}
[IF_DEBUG]
{
  THROW
    debug only
}
[ENDIF]
PRINTFORML {A}`).start();
  assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
  assert.equal(output(snapshot), "1");
  for (const [source, message, line] of [
    ["@SYSTEM_TITLE\n{\nPRINTL test", /Unclosed multiline/, 2],
    ["@SYSTEM_TITLE\n}", /Unmatched multiline/, 2],
    ["@SYSTEM_TITLE\n{\n{\n}\n}", /Nested multiline/, 3],
  ] as const) {
    assert.throws(() => indexScript(emptyGame(), source, "malformed.ERB"), (error: unknown) =>
      error instanceof EraError && message.test(error.message) && error.source?.line === line);
  }
});
test("batch assignment advances only the final dimension, handles CSV aliases and preserves literal string assignment", () => {
  const game = emptyGame();
  game.names.set("FLAG", new Map([["SCORE", 7]]));
  indexScript(game, `@SYSTEM_TITLE
#DIM GRID, 2, 3
FLAG:SCORE = 10, 20, 30
GRID:1:1 = FLAG:8, FLAG:9
STR:2 '= "first, literal", "second; literal"
STR:4 = plain, comma
PRINTFORML {FLAG:7}/{GRID:1:1}/{GRID:1:2} %STR:2% %STR:3% %STR:4%`, "batch.ERB");
  const snapshot = new Runtime(game).start();
  assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
  assert.equal(output(snapshot), "10/20/30 first, literal second; literal plain, comma");
  for (const statement of ["GRID:0:2 = 1, 2", 'GRID:0:0 = 1, "wrong type"', "GRID:0:0 += 1, 2"]) {
    const invalid = runtime(`@SYSTEM_TITLE\n#DIM GRID, 2, 3\n${statement}`).start();
    assert.equal(invalid.status, "error", statement);
    assert.equal(invalid.error!.line, 3);
  }
});
