import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyGame, indexScript, type Game } from "../src/loader.js";
import { Runtime, type Snapshot } from "../src/runtime.js";

function run(source: string, header = "", configure?: (game: Game) => void): Snapshot {
  const game = emptyGame();
  configure?.(game);
  indexScript(game, header, "newgame.ERH", true);
  indexScript(game, source, "newgame.ERB");
  return new Runtime(game).start();
}
function printed(snapshot: Snapshot): string[] {
  assert.notEqual(snapshot.status, "error", JSON.stringify(snapshot.error));
  return snapshot.output.filter((item) => item.type === "text").map((item) => item.text);
}
test("SUMARRAY sums exclusive ranges, omitted bounds and wraps signed 64-bit results", () => {
  const result = run(`@SYSTEM_TITLE
#DIM VALUES, 4 = 2, 3, 4, 5
#DIM OVERFLOW, 2 = 9223372036854775807, 1
PRINTFORML {SUMARRAY(VALUES)} {SUMARRAY(VALUES,1,3)} {SUMARRAY(VALUES,,2)} {SUMARRAY(OVERFLOW)}
VALUES:1 = 9
PRINTFORML {SUMARRAY(VALUES,1)}`);
  assert.deepEqual(printed(result), ["14 7 5 -9223372036854775808", "18"]);
  for (const expression of ["SUMARRAY(VALUES,-1)", "SUMARRAY(VALUES,0,5)", "SUMARRAY(VALUES,3,2)"]) {
    const invalid = run(`@SYSTEM_TITLE\n#DIM VALUES,4\nA = ${expression}`);
    assert.equal(invalid.status, "error");
    assert.match(invalid.error!.message, /Invalid SUMARRAY range/);
  }
});
test("RESETDATA preserves globals and constants, resets ordinary declarations and removes characters", () => {
  const result = run(`@SYSTEM_TITLE
GLOBAL = 7
KEEP = 9
FLAG = 8
FIRST_NAME = changed
CALL LOCAL_STATE
ADDCHARA 0
NAME:0 = Changed
RESETDATA
CALL LOCAL_STATE
PRINTFORML {GLOBAL} {KEEP} {FLAG} %FIRST_NAME% {CHARANUM} {FIXED}
ADDCHARA 0
PRINTFORML %NAME:0%
@LOCAL_STATE
#DIM STATE = 3
PRINTFORML {STATE}
STATE ++`,
  '#DIM GLOBAL KEEP = 2\n#DIM CONST FIXED = 3\n#DIMS FIRST_NAME = "Initial"',
  (game) => game.characters.set(0, { file: "Chara0.csv", rows: [["番号", "0"], ["名前", "Template"]] }));
  assert.deepEqual(printed(result), ["3", "3", "7 9 0 Initial 0 3", "Template"]);
});
test("character CSV instances are isolated, aliases and implicit TARGET indices work", () => {
  const result = run(`@SYSTEM_TITLE
ADDCHARA 7, 7
TARGET = 1
BASE:体力 = 42
EXTRA:1:0 = 8
PRINTFORML {CHARANUM} %NAME:0% {NO:1}
PRINTFORML {BASE:0:体力} {BASE:体力} {MAXBASE:1:体力}
PRINTFORML {TALENT:0:1} {CFLAG:0:2} {CFLAG:0:3} %CSTR:0:0%
PRINTFORML {EXTRA:0:0} {EXTRA:1:0} {VARSIZE("BASE")}
PRINTFORML {CSVBASE(7,0)} {CSVABL(7,1)} {EXISTCSV(7)} {EXISTCSV(8)}`,
  "#DIM CHARADATA EXTRA, 2",
  (game) => {
    game.names.set("BASE", new Map([["体力", 0]]));
    game.characters.set(7, { file: "Chara7.csv", rows: [
      ["番号", "7"], ["名前", "Template"], ["基礎", "体力", "2000"],
      ["素質", "1", ""], ["フラグ", "2", "1140:notes"], ["フラグ", "3", ""],
      ["CSTR", "0", "Profile"], ["能力", "1", "2"],
    ] });
  });
  assert.deepEqual(printed(result), ["2 Template 7", "2000 42 2000", "1 1140 1 Profile", "0 8 1000", "2000 2 1 0"]);
});
test("BEGIN returns like RETURN, the caller continues and the state changes when the system call ends", () => {
  const result = run(`@SYSTEM_TITLE
CALL START
PRINTL caller continues
@START
BEGIN FIRST
PRINTL not reached
@EVENTFIRST
PRINTL regular
@EVENTFIRST
#LATER
PRINTL later
@EVENTFIRST
#PRI
PRINTL priority`);
  assert.deepEqual(printed(result), ["caller continues", "priority", "regular", "later"]);
  const invalid = run("@SYSTEM_TITLE\nBEGIN NOWHERE");
  assert.equal(invalid.status, "error");
  assert.match(invalid.error!.message, /NOWHERE/);
});
test("dynamic calls, expression calls, omitted defaults and missing-target catch blocks execute correctly", () => {
  const result = run(`@SYSTEM_TITLE
RESULT = 1
CALLF DOUBLE(3)
PRINTFORML {A} {RESULT}
CALLFORMF DOU%"BLE"%(4)
PRINTFORML {A} {RESULT}
TRYCALLFORMF MISSING
TRYCALLF MISSING_TOO(1)
TRYCALLFORMF DOUBLE(5)
PRINTFORML {A} {RESULT}
CALLFORM SHOW(,8)
TRYCCALLFORM MISSING
  THROW missing call must not run this branch
CATCH
  PRINTL caught missing
ENDCATCH
TRYCCALLFORM SHOW("found",9)
  PRINTL success
CATCH
  THROW success must skip catch
ENDCATCH
TRYCALLFORM MISSING
@DOUBLE(ARG)
#FUNCTION
A = ARG * 2
RETURNF A
@SHOW(ARGS="default", ARG=0)
PRINTFORML %ARGS% {ARG}`);
  assert.deepEqual(printed(result), ["6 1", "8 1", "10 1", "default 8", "caught missing", "found 9", "success"]);
  const failure = run("@SYSTEM_TITLE\nTRYCCALLFORM BAD\nCATCH\nPRINTL should not hide errors\nENDCATCH\n@BAD\nTHROW broken");
  assert.equal(failure.status, "error");
  assert.match(failure.error!.message, /broken/);
  const printedFunction = run('@SYSTEM_TITLE\nPRINTFORML [%COLORED("a", 0xFF0000) + COLORED("b", 0x00FF00)%]\n@COLORED(ARGS, ARG)\n#FUNCTIONS\nSETCOLOR ARG\nPRINTFORM %ARGS%\nRESETCOLOR\nRETURNF');
  assert.equal(printedFunction.status, "halted", JSON.stringify(printedFunction.error));
  assert.deepEqual(printedFunction.output.flatMap((item) => "text" in item ? [[item.text, item.style.color]] : []),
    [["a", "#ff0000"], ["b", "#00ff00"], ["[]", "#c0c0c0"]]);
  const waitingFunction = run('@SYSTEM_TITLE\nCALLFORMF BAD()\n@BAD\n#FUNCTION\nWAIT\nRETURNF 1');
  assert.equal(waitingFunction.status, "error");
  assert.match(waitingFunction.error!.message, /attempted input/);
});
test("REF parameters bind whole arrays like Emuera and validate types", () => {
  const result = run(`@SYSTEM_TITLE
#DIM DATA, 3
#DIM INDEX
DATA:0 = 5,6,7
INDEX = 1
CALL CHANGE(DATA, DATA:INDEX)
PRINTFORML {DATA:0} {DATA:1} {DATA:2}
CALL CLEAR_VALUE(DATA:2)
PRINTFORML {DATA:0} {DATA:1} {DATA:2}
@CHANGE(ARRAY, WHOLE)
#DIM REF ARRAY, 0
#DIM REF WHOLE
WHOLE = 42
ARRAY:2 = 99
PRINTFORML {VARSIZE("ARRAY")} {VARSIZE("WHOLE")}
@CLEAR_VALUE(DEST)
#DIM REF DEST
VARSET DEST`);
  // Emuera ignores the argument's index: a sizeless REF is a 1-D reference to the whole array.
  assert.deepEqual(printed(result), ["3 3", "42 6 99", "0 0 0"]);
  for (const [source, message] of [
    ['@SYSTEM_TITLE\nCALL BAD(A)\n@BAD(ARRAY)\n#DIMS REF ARRAY, 0', /REF type mismatch/],
    ['@SYSTEM_TITLE\n#DIM D2, 2, 2\nCALL BAD(D2)\n@BAD(ARRAY)\n#DIM REF ARRAY', /REF dimension mismatch/],
    ['@SYSTEM_TITLE\nCALL BAD(CFLAG)\n@BAD(ARRAY)\n#DIM REF ARRAY', /character variable/],
    ['@SYSTEM_TITLE\n#DIM CONST FIXED_KEY = 1, 2\nCALL BAD(FIXED_KEY)\n@BAD(ARRAY)\n#DIM REF ARRAY', /constant/],
  ] as const) {
    const wrong = run(source);
    assert.equal(wrong.status, "error", source);
    assert.match(wrong.error!.message, message);
  }
});
test("sparse ARRAYREMOVE shifts values, zero-fills tails and supports string arrays", () => {
  const result = run(`@SYSTEM_TITLE
#DIM DATA, 5
#DIMS WORDS, 4
DATA:0 = 10,20,30,40,50
WORDS:0 '= "one","two","three","four"
ARRAYREMOVE DATA, 1, 2
ARRAYREMOVE WORDS, 0, 1
PRINTFORML {DATA:0} {DATA:1} {DATA:2} {DATA:3} {DATA:4}
PRINTFORML %WORDS:0% %WORDS:1% %WORDS:2% [%WORDS:3%]
PRINTFORML {FINDELEMENT(WORDS,"three",,,1)}
PRINTFORML {FINDELEMENT(DATA,50)}`);
  assert.deepEqual(printed(result), ["10 40 50 0 0", "two three four []", "1", "2"]);
  const invalid = run("@SYSTEM_TITLE\nPRINTFORML {FINDELEMENT(STR,\"[\")}");
  assert.equal(invalid.status, "error");
  assert.match(invalid.error!.message, /Invalid regular expression/);
});
test("recursive dynamic locals, local size directives and legacy comma signatures work", () => {
  const result = run(`@SYSTEM_TITLE
CALL COUNTDOWN(3)
@COUNTDOWN, COUNT_VALUE
#DIM DYNAMIC COUNT_VALUE
#LOCALSIZE 2
LOCAL:1 += 1
PRINTFORML {COUNT_VALUE} {LOCAL:1}
SIF COUNT_VALUE > 0
  CALL COUNTDOWN(COUNT_VALUE - 1)`);
  assert.deepEqual(printed(result), ["3 1", "2 2", "1 3", "0 4"]);
});
test("new-game formatting, bit operations, Rename replacements and random bounds", () => {
  const result = run(`@SYSTEM_TITLE
A = [[VALUE]]
SETBIT A, 1, 63
CLEARBIT A, 1
INVERTBIT A, 0
PRINTFORML {GETBIT(A,63)} {GETBIT(A,1)} {GETBIT(A,0)}
PRINTFORML [{7,3}] [%@"日",4,LEFT%] %TOSTR(255,"X6")%
PRINTFORML {GROUPMATCH(2,1,2,2)} {INRANGE(4,1,5)} {ISNUMERIC("42")}
PRINTFORML %HTML_ESCAPE("<tag>")% %TOUPPER("test")%
PRINTFORML {RAND:1}
REDRAW 0
PRINTFORML {CURRENTREDRAW()}`,
  "", (game) => game.renames.set("VALUE", "4"));
  assert.deepEqual(printed(result), ["1 0 1", "[  7] [日  ] 0000FF", "2 1 1", "&lt;tag&gt; TEST", "0", "0"]);
  assert.equal(run("@SYSTEM_TITLE\nA=RAND:0").status, "error");
});
