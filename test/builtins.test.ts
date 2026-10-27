import assert from "node:assert/strict";
import { test } from "node:test";
import { displayDefaults, emptyGame, indexScript, type Game } from "../src/loader.js";
import { BUILTIN_FUNCTIONS, Runtime, type RuntimeOptions, type Snapshot } from "../src/runtime.js";
import { EraError } from "../src/model.js";

function runtime(source: string, configure?: (game: Game) => void, options: RuntimeOptions = {}): Runtime {
  const game = emptyGame();
  configure?.(game);
  indexScript(game, source, "builtins.ERB");
  return new Runtime(game, 50_000, options);
}
function texts(snapshot: Snapshot): string[] {
  assert.notEqual(snapshot.status, "error", JSON.stringify(snapshot.error));
  return snapshot.output.flatMap((item) => "text" in item ? [item.text] : []);
}
const template = (game: Game) => game.characters.set(0, { file: "Chara0.csv", rows: [
  ["番号", "0"], ["名前", "Name"], ["呼び名", "Call"], ["あだ名", "Nick"], ["主人の呼び方", "Master"],
  ["フラグ", "3", "42"], ["刻印", "1", "2"], ["CSTR", "1", "text"],
] });

test("AWAIT yields to the host, validates delays and cannot be skipped", () => {
  for (const jit of [false, true]) {
    const run = runtime(`@SYSTEM_TITLE
FOR LOCAL, 0, 4
CALL PAUSE
NEXT
RETURN
@PAUSE
AWAIT
AWAIT 0
AWAIT 10000
RETURN`, undefined, { jit });
    let snapshot = run.start();
    for (let i = 0; i < 12; i++) {
      assert.equal(snapshot.status, "waiting", JSON.stringify(snapshot.error));
      assert.equal(snapshot.input?.blocking, true);
      assert.equal(snapshot.input?.timeout, i % 3 === 2 ? 10000 : 1);
      assert.throws(() => run.input(""), /cannot be skipped/);
      assert.equal(run.prefetch(), false);
      snapshot = run.timeout();
    }
    assert.equal(snapshot.status, "halted");
    for (const time of [-1, 10001]) {
      const bad = runtime(`@SYSTEM_TITLE\nAWAIT ${time}`, undefined, { jit }).start();
      assert.equal(bad.status, "error");
      assert.match(bad.error!.message, /AWAIT time/);
    }
    const hidden = runtime("@SYSTEM_TITLE\nSKIPDISP 1\nAWAIT 0\nSKIPDISP 0\nPRINTL done", undefined, { jit });
    assert.equal(hidden.start().input?.sleep, true);
    assert.deepEqual(texts(hidden.timeout()), ["done"]);
    const skipping = runtime("@SYSTEM_TITLE\nSKIPLOG 1\nAWAIT 0\nPRINTL done", undefined, { jit });
    assert.equal(skipping.start().input?.sleep, true);
    assert.deepEqual(texts(skipping.timeout()), ["done"]);
  }
});

test("client dimensions and ISACTIVE follow the host state in interpreted and JIT routines", () => {
  for (const jit of [false, true]) {
    const run = runtime(`@SYSTEM_TITLE
FOR LOCAL, 0, 4
CALL SHOW_CLIENT
NEXT
INPUT
CALL SHOW_CLIENT
INPUT
CALL SHOW_CLIENT
RETURN
@SHOW_CLIENT
ISACTIVE
PRINTFORML {CLIENTWIDTH()} {CLIENTHEIGHT()} {ISACTIVE()} {RESULT}
RETURN`, undefined, { jit, client: { width: 1200, height: 800, active: true } });
    assert.deepEqual(texts(run.start()), Array(4).fill("1200 800 1 1"));
    run.setClient({ width: 640, height: 400, active: false });
    assert.deepEqual(texts(run.input("0")), ["0", "640 400 0 0"]);
    run.setClient({ width: 0, height: 0, active: true });
    assert.deepEqual(texts(run.input("0")), ["0", "0 0 1 1"]);
    for (const width of [-1, 0.5, NaN, Infinity, 65536])
      assert.throws(() => run.setClient({ width, height: 1, active: true }), /Client dimensions/);
    const fallback = runtime("@SYSTEM_TITLE\nPRINTFORML {CLIENTWIDTH()} {CLIENTHEIGHT()} {ISACTIVE()}", (game) => {
      game.config.set("ウィンドウ幅", "900");
      game.config.set("ウィンドウ高さ", "700");
      game.config.set("一行の高さ", "20");
    }, { jit }).start();
    assert.deepEqual(texts(fallback), ["900 680 1"]);
    assert.match(runtime("@SYSTEM_TITLE\nPRINTVL ISACTIVE(1)", undefined, { jit }).start().error!.message, /ISACTIVE/);
  }
});

test("VARSIZE statements inspect bare arrays and write every dimension without reading elements", () => {
  for (const jit of [false, true]) {
    const result = runtime(`@SYSTEM_TITLE
FOR LOCAL, 0, 4
CALL SIZES
NEXT
RETURN
@SIZES
#DIM DYNAMIC GRID, 8, 9
#DIMS CUBE, 4, 5, 6
#DIM VECTOR, 7
RESULT = 90, 91, 92, 93
VARSIZE CUBE
PRINTFORML {RESULT:0} {RESULT:1} {RESULT:2} {RESULT:3}
VARSIZE GRID
PRINTFORML {RESULT:0} {RESULT:1} {RESULT:2} {RESULT:3}
VARSIZE VECTOR
PRINTFORML {RESULT:0} {RESULT:1} {RESULT:2} {RESULT:3}
PRINTFORML {VARSIZE("GRID", 1)} {VARSIZE("CUBE", 2)}
RETURN`, undefined, { jit }).start();
    assert.deepEqual(texts(result), Array(4).fill([
      "4 5 6 93", "8 9 6 93", "7 9 6 93", "9 6",
    ]).flat());
    for (const args of ['"GRID"', "GRID:0", "GRID, 1", "UNKNOWN", ""]) {
      const bad = runtime(`@SYSTEM_TITLE\n#DIM GRID, 2, 3\nVARSIZE ${args}`, undefined, { jit }).start();
      assert.equal(bad.status, "error", args);
      assert.equal(bad.error!.line, 3);
    }
    const indexed = runtime("@SYSTEM_TITLE\n#DIM GRID, 2, 3\nPRINTVL GRID", undefined, { jit }).start();
    assert.equal(indexed.status, "error");
    assert.match(indexed.error!.message, /Expected 2 indices/);
  }
});

test("TOSTR custom currency affixes preserve grouping, signs, zero placeholders and Int64 precision", () => {
  for (const jit of [false, true]) {
    const result = runtime(`@SYSTEM_TITLE
FOR LOCAL, 0, 4
CALL FORMAT_MONEY
NEXT
RETURN
@FORMAT_MONEY
PRINTSL TOSTR(1234567, "$#,###")
PRINTSL TOSTR(-1234567, "$#,###")
PRINTSL TOSTR(0, "$#,###")
PRINTSL TOSTR(0, "$#,##0")
PRINTSL TOSTR(12, "$000.00")
PRINTSL TOSTR(1234, "#,##0 $")
PRINTSL TOSTR(-9223372036854775808, "$#,###")
PRINTSL TOSTR(1234567, "$0,,.00")
RETURN`, undefined, { jit }).start();
    assert.deepEqual(texts(result), Array(4).fill([
      "$1,234,567", "-$1,234,567", "$", "$0", "$012.00", "1,234 $",
      "-$9,223,372,036,854,775,808", "$1.23",
    ]).flat());
    const unsupported = runtime('@SYSTEM_TITLE\nPRINTSL TOSTR(1, "$0%")', undefined, { jit }).start();
    assert.equal(unsupported.status, "error");
    assert.match(unsupported.error!.message, /Unsupported TOSTR format/);
  }
});

test(".NET escaped commas work in Unicode regexes without changing escaped backslashes or invalid escapes", () => {
  const result = runtime(String.raw`@SYSTEM_TITLE
PRINTSL REPLACE("a,b,c", "\,(?!.*\,)", " and ")
PRINTSL REPLACE("a,b", "\\\\,", "|")
PRINTFORML {STRCOUNT("日,月", "\,")}`).start();
  assert.deepEqual(texts(result), ["a,b and c", "a,b", "1"]);
  const invalid = runtime(String.raw`@SYSTEM_TITLE
PRINTSL REPLACE("x", "\q", "")`).start();
  assert.equal(invalid.status, "error");
  assert.match(invalid.error!.message, /Invalid regular expression/);
});

test("STR defaults to 20000 elements, preserves CSV defaults on reset, and respects explicit sizes", () => {
  for (const jit of [false, true]) {
    const result = runtime(`@SYSTEM_TITLE
PRINTFORML {VARSIZE("STR")} {VARSIZE("STRNAME")}
FOR A, 0, 50
  CALL CLEAR_STR
NEXT
PRINTFORML [%STR:1029%][%STR:1030%][%STR:1037%][%STR:1038%][%STR:1040%][%STR:1048%]
STR:19999 = last
RESETDATA
PRINTFORML [%STR:19999%][%STR:1030%]
RETURN
@CLEAR_STR
STR:1029 = before
STR:1030 = clear
STR:1037 = clear
STR:1038 = boundary
STR:1040 = clear
STR:1048 = after
VARSET STR, "", 1030, 1038
VARSET STR, "", 1040, 1048`, (game) => {
      game.tables.set("STR", new Map([[1030, ["csv default"]]]));
    }, { jit }).start();
    assert.deepEqual(texts(result), [
      "20000 20000", "[before][][][boundary][][after]", "[][csv default]",
    ]);
    const configured = runtime(`@SYSTEM_TITLE
PRINTFORML {VARSIZE("STR")}
VARSET STR, "", 1030, 1038`, (game) => {
      game.variableSizes.set("STR", [1000]);
    }, { jit }).start();
    assert.equal(configured.status, "error");
    assert.equal(configured.error!.message, "Invalid VARSET range 1030-1038 for STR");
    assert.equal(configured.output.find((item) => item.type === "text")?.text, "1000");
    const invalid = runtime("@SYSTEM_TITLE\nSTR:20000 = outside", undefined, { jit }).start();
    assert.equal(invalid.status, "error");
    assert.match(invalid.error!.message, /Index 20000 out of range for STR/);
  }
});

test("UPCHECK applies and prints target deltas, wraps Int64, and clears changes even without a target", () => {
  const result = runtime(`@SYSTEM_TITLE
ADDCHARA 0
PALAM:0:0 = 10, 9223372036854775807, 30
UP = 5, 2, -3
DOWN = 2, -1, -4
UPCHECK
PRINTFORML {PALAM:0:0},{PALAM:0:1},{PALAM:0:2};{SUMARRAY(UP)},{SUMARRAY(DOWN)}
UP = 7
TARGET = -1
UPCHECK
PRINTFORML {UP},{DOWN}
TARGET = 0
SKIPDISP 1
UP = 2
UPCHECK
SKIPDISP 0
PRINTFORML {PALAM:0:0}`, (game) => {
    template(game);
    game.tables.set("PALAM", new Map([[0, ["Joy"]], [1, ["Trust"]]]));
    game.variableSizes.set("PALAM", [3]);
    game.variableSizes.set("UP", [5]);
    game.variableSizes.set("DOWN", [4]);
  }).start();
  assert.deepEqual(texts(result), [
    "Joy 10+5-2=13", "Trust 9223372036854775807+2=-9223372036854775806",
    "13,-9223372036854775806,30;0,0", "0,0", "15",
  ]);
  const invalid = runtime("@SYSTEM_TITLE\nUPCHECK 1").start();
  assert.equal(invalid.status, "error");
  assert.match(invalid.error!.message, /UPCHECK takes no arguments/);
});

test("OUTPUTLOG persists visible plain text including pending output and reports storage failures", async () => {
  const { MemorySaveStore } = await import("../src/storage.js");
  const saves = new MemorySaveStore();
  const result = runtime(`@SYSTEM_TITLE
PRINTL removed
CLEARLINE 1
PRINTL kept
HTML_PRINT "<b>styled &amp; decoded</b>"
PRINT pending
OUTPUTLOG`, undefined, { saves }).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.equal(saves.read("emuera.log"), "kept\nstyled & decoded\npending\n");
  assert.ok(texts(result).includes("Log written to emuera.log"));
  const failed = runtime("@SYSTEM_TITLE\nOUTPUTLOG", undefined, { saves: {
    read: () => null, list: () => [], remove: () => {},
    write: () => { throw new EraError("Disk full"); },
  } }).start();
  assert.equal(failed.status, "error");
  assert.match(failed.error!.message, /Disk full/);
});

test("ADDVOIDCHARA adds an empty character and ASSERT is skipped like other debug instructions", () => {
  const source = `@SYSTEM_TITLE
ADDCHARA 0
ADDVOIDCHARA
ASSERT 0
ASSERT UNDEFINED_THING(
PRINTFORML {CHARANUM} {NO:1} [%NAME:1%] {CFLAG:1:3} {CFLAG:0:3}
CFLAG:1:3 = 5
PRINTFORML {CFLAG:1:3}`;
  assert.deepEqual(texts(runtime(source, template).start()), ["2 0 [] 0 42", "5"]);
  assert.match(runtime("@SYSTEM_TITLE\nADDVOIDCHARA 1").start().error?.message ?? "", /takes no arguments/);
});
test("character CSVs accept Emuera's English keys in any case, JUEL/珠, and skip unknown keys", () => {
  const source = "@SYSTEM_TITLE\nADDCHARA 2\nPRINTFORML %NAME:0% %CALLNAME:0% {CFLAG:0:3} {JUEL:0:1} {JUEL:0:2} {MAXBASE:0:0} {BASE:0:0}";
  const game = runtime(source, (game) => game.characters.set(2, { file: "Chara2.csv", rows: [
    ["NO", "2"], ["name", "Eng"], ["CallName", "E"], ["CFLAG", "3", "7"], ["JUEL", "1", "4"], ["珠", "2", "5"], ["base", "0", "9"], ["UNKNOWN", "1", "1"],
  ] }));
  assert.deepEqual(texts(game.start()), ["Eng E 7 4 5 9 9"]);
});
test("INPUT and INPUTS take a default for an empty input; INPUTS's is FORM text", () => {
  const source = `@SYSTEM_TITLE
INPUT 9999
PRINTFORML {RESULT}
LOCAL = 3
INPUTS name{LOCAL}
PRINTFORML %RESULTS%
INPUT 5
PRINTFORML {RESULT}`;
  const game = runtime(source);
  assert.equal(game.start().input?.defaultValue, "9999");
  assert.deepEqual(texts(game.input("")).slice(-1), ["9999"]);
  assert.deepEqual(texts(game.input("")).slice(-1), ["name3"]);
  assert.deepEqual(texts(game.input("12")).slice(-1), ["12"]);
});
test("a duplicated non-event function keeps its first definition and reports the later one, like Emuera", () => {
  const game = emptyGame();
  indexScript(game, "@SYSTEM_TITLE\nCALL FOO\nPRINTFORML {BAR()}\n@FOO\nPRINTL first\n@BAR\n#FUNCTION\nRETURNF 1", "A.ERB");
  indexScript(game, "@FOO\nPRINTL second\n@BAR\n#FUNCTION\nRETURNF 2", "B.ERB");
  assert.deepEqual(texts(new Runtime(game, 50_000).start()), ["first", "1"]);
  assert.deepEqual(game.diagnostics.map((item) => item.message), [
    "Function @FOO is already defined (A.ERB:4); this definition is ignored",
    "Function @BAR is already defined (A.ERB:6); this definition is ignored",
  ]);
});
test("GOTOFORM jumps to a formatted label and TRYGOTO/TRYGOTOFORM skip missing ones", () => {
  const source = `@SYSTEM_TITLE
LOCALS = TWO
GOTOFORM LABEL_%LOCALS%
$LABEL_ONE
PRINTL one
$LABEL_TWO
PRINTL two
TRYGOTO NOWHERE
TRYGOTOFORM NO_{1}
PRINTL after
GOTOFORM MISSING_{1}`;
  const snapshot = runtime(source).start();
  assert.deepEqual(snapshot.output.flatMap((item) => "text" in item ? [item.text] : []), ["two", "after"]);
  assert.match(snapshot.error?.message ?? "", /MISSING_1/);
});
test("INPUTMOUSEKEY sets RESULT:0-5 (and RESULTS for string buttons) and times out with RESULT:0 = 4", () => {
  const source = `@SYSTEM_TITLE
REPEAT 3
  INPUTMOUSEKEY 500
  PRINTFORML {RESULT:0} {RESULT:1} {RESULT:2} {RESULT:3} {RESULT:4} {RESULT:5} %RESULTS%
REND
PLAYBGM "x.ogg"
STOPBGM
INPUTMOUSEKEY
PRINTFORML {RESULT:0} {RESULT:1} {RESULT:2}`;
  const game = runtime(source);
  assert.deepEqual(game.start().input, { kind: "mousekey", timeout: 500 });
  assert.throws(() => game.input("1"), /mouse or key input/);
  assert.throws(() => game.input(JSON.stringify({ result: [5] })), /mouse or key input/);
  assert.deepEqual(texts(game.input(JSON.stringify({ result: [1, 0x100000, 10, -20, -1, 7] }))), ["1 1048576 10 -20 -1 7 "]);
  assert.deepEqual(texts(game.input(JSON.stringify({ result: [1, 0x100000, 1, -2, -1, 0], results: "Yes" }))), ["1 1048576 1 -2 -1 0 Yes"]);
  const last = game.timeout();
  assert.deepEqual(texts(last), ["4 0 0 0 0 0 Yes"]);
  assert.deepEqual(last.input, { kind: "mousekey" });
  assert.deepEqual(texts(game.input(JSON.stringify({ result: [3, 38, 38 | 0x10000] }))), ["3 38 65574"]);
});
test("CBGSETG/CBGSETSPRITE layer pictures behind or in front of the text and CBGCLEAR/CBGREMOVERANGE remove them", () => {
  const source = `@SYSTEM_TITLE
GCREATE 1, 20, 10
GCREATE 2, 5, 5
CBGSETG 1, 0, 0, 10
PRINTFORML {RESULT}
CBGSETG 2, 3, -4, 20
CBGSETG 2, 1, 1, -1
CBGSETG 9, 0, 0, 5
PRINTFORML {RESULT}
WAIT
CBGREMOVERANGE 15, 30
WAIT
PRINTL no change
WAIT
CBGCLEAR
WAIT
CBGSETG 1, 0, 0, 0`;
  const game = runtime(source);
  let snapshot = game.start();
  assert.deepEqual(texts(snapshot), ["1", "0"]);
  assert.deepEqual(snapshot.cbg?.map(({ z, x, y, picture }) => [z, x, y, picture.width]), [[20, 3, -4, 5], [10, 0, 0, 20], [-1, 1, 1, 5]]);
  snapshot = game.input("");
  assert.deepEqual(snapshot.cbg?.map(({ z }) => z), [10, -1]);
  snapshot = game.input("");
  assert.equal(snapshot.cbg, undefined);
  snapshot = game.input("");
  assert.deepEqual(snapshot.cbg, []);
  assert.match(game.input("").error?.message ?? "", /must not be 0/);
});
test("debug mode loads [IF_DEBUG] code, sends DEBUGPRINT to the debug window, checks ASSERT and fills debug variables", () => {
  const source = `@SYSTEM_TITLE
[IF_DEBUG]
PRINTL debug build
[ENDIF]
[IF_NDEBUG]
PRINTL release build
[ENDIF]
DEBUGPRINTL first
DEBUGCLEAR
DEBUGPRINT a
DEBUGPRINTFORML {1 + 1}
PRINTFORML %__FILE__% {__LINE__} %__FUNCTION__%
ASSERT 1
INPUT
ASSERT 0`;
  const release = runtime(source).start();
  assert.deepEqual(texts(release), ["release build", " 0 "]);
  assert.equal(release.debug, undefined);
  const debug = runtime(source, (game) => { game.debug = true; });
  const first = debug.start();
  assert.deepEqual(texts(first), ["debug build", "builtins.ERB 12 SYSTEM_TITLE"]);
  assert.deepEqual([first.debug, first.debugClear], ["a2\n", true]);
  const failed = debug.input("0");
  assert.equal(failed.error?.message, "ASSERT文の引数が0です");
  assert.equal(failed.debug, undefined);
});
test("VARSET fills whole arrays, 1D ranges and one character's elements", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIM VALUES, 5
#DIMS WORDS, 3
#DIM GRID, 2, 3
VARSET VALUES, 7
VARSET VALUES, 1, 2, 4
VARSET WORDS, "x"
VARSET GRID, 4, 0, 1
PRINTFORML {VALUES:0}{VALUES:1}{VALUES:2}{VALUES:3}{VALUES:4} %WORDS:2% {GRID:1:2}
VARSET VALUES
PRINTFORML {SUMARRAY(VALUES)}
ADDCHARA 0
ADDCHARA 0
ADDCHARA 0
TARGET = 1
VARSET CFLAG, 5, 0, 3
VARSET CFLAG:2:0, 9, 1, 2
PRINTFORML {CFLAG:0:0} {CFLAG:1:0}{CFLAG:1:2}{CFLAG:1:3} {CFLAG:2:0}{CFLAG:2:1}`, template).start();
  assert.deepEqual(texts(result), ["77117 x 4", "0", "0 5542 09"]);
});

test("array and character-array scans count, sum, bound and find elements", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIM VALUES, 5 = 3, 7, 7, 1, 9
#DIMS WORDS, 3 = "apple", "banana", "cherry"
PRINTFORML {MATCH(VALUES, 7)} {MATCH(VALUES, 7, 2)} {MAXARRAY(VALUES)} {MINARRAY(VALUES, 1, 3)} {MATCH(WORDS, "banana")}
PRINTFORML {FINDELEMENT(VALUES, 7)} {FINDLASTELEMENT(VALUES, 7)} {FINDELEMENT(WORDS, "an")} {FINDELEMENT(WORDS, "an", 0, 3, 1)}
ADDCHARA 0
ADDCHARA 0
ADDCHARA 0
CFLAG:1:0 = 5
CFLAG:2:0 = 5
CFLAG:2:1 = 9
PRINTFORML {CMATCH(CFLAG:0, 5)} {CMATCH(CFLAG:0, 5, 0, 2)} {SUMCARRAY(CFLAG:0)} {MAXCARRAY(CFLAG:1)} {MINCARRAY(CFLAG:0, 1)}`, template).start();
  assert.deepEqual(texts(result), ["2 1 9 7 1", "1 2 1 -1", "2 1 10 9 5"]);
  const invalid = runtime("@SYSTEM_TITLE\nADDCHARA 0\nA = CMATCH(CFLAG:0, 1, 0, 2)", template).start();
  assert.equal(invalid.status, "error");
  assert.match(invalid.error!.message, /Invalid CMATCH character range/);
});

test("PRINT variants pad, ignore SETCOLOR, keep literal semicolons and mark single lines", () => {
  const result = runtime(`@SYSTEM_TITLE
SETCOLOR 0xFF0000
PRINTD d
PRINTL r
PRINTC ab
PRINTLC cd
PRINTL
PRINTFORMSL "{1+1}x"
PRINTVL 1, 2
PRINTSINGLE long
PRINTL a;b`).start();
  const items = result.output.flatMap((item) => "text" in item ? [item] : []);
  assert.deepEqual(items.map((item) => item.text), ["d", "r", " ".repeat(23) + "ab", "cd" + " ".repeat(23), "", "2x", "12", "long", "a;b"]);
  assert.equal(items[0]!.style.color, "#c0c0c0");
  assert.equal(items[1]!.style.color, "#ff0000");
  assert.deepEqual(items.map((item) => !!item.single), [false, false, false, false, false, false, false, true, false]);
});

test("PRINTDATA and STRDATA pick DATA, DATAFORM and DATALIST entries", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIMS WORD
PRINTDATAL
  DATALIST
    DATA one
    DATAFORM two{1}
  ENDLIST
ENDDATA
STRDATA WORD
  DATAFORM only{2}
ENDDATA
STRDATA
  DATA plain
ENDDATA
PRINTFORML %WORD% %RESULTS%`).start();
  assert.deepEqual(texts(result), ["one\ntwo1", "only2 plain"]);
});

test("string instructions store results and width-aware string functions follow Emuera rules", () => {
  const result = runtime(`@SYSTEM_TITLE
SUBSTRING "あいうえ", 1, 2
PRINTFORML %RESULTS%
SUBSTRINGU "あいうえ", 1, 2
PRINTFORML %RESULTS%
STRFIND "あいうえお", "うえ"
PRINTFORML {RESULT} {STRFINDU("あいうえお", "うえ")} {STRFIND("abcdeabced", "a", 3)}
STRCOUNT "abcabc", "b"
PRINTFORML {RESULT}
STRLEN あいa
PRINTFORML {RESULT}
STRLENFORM {12}あ
PRINTFORML {RESULT}
STRLENFORMU {12}あ
PRINTFORML {RESULT}
PRINTFORML %TOFULL("Ab 1ｶﾞ")% %TOHALF("Ａｂ　１ガ漢")%
PRINTFORML {__INT_MAX__} {__INT_MIN__}
DRAWLINEFORM {1}=
FONTBOLD
FONTITALIC
PRINTFORML {GETSTYLE()}
FONTREGULAR
FONTSTYLE 12
PRINTFORML {GETSTYLE()}`).start();
  assert.deepEqual(texts(result), [
    "い", "いう", "4 2 5", "2", "5", "4", "3", "Ａｂ　１ガ Ab 1ｶﾞ漢",
    "9223372036854775807 -9223372036854775808", "1=".repeat(60), "3", "12",
  ]);
});

test("CSV character accessors read names, named fields and CSTR rows", () => {
  const result = runtime(`@SYSTEM_TITLE
PRINTFORML %CSVNAME(0)% %CSVCALLNAME(0)% %CSVNICKNAME(0)% %CSVMASTERNAME(0, 0)%
PRINTFORML {CSVCFLAG(0, 3)} {CSVMARK(0, 1)} {CSVCFLAG(0, 4)} %CSVCSTR(0, 1)%`, template).start();
  assert.deepEqual(texts(result), ["Name Call Nick Master", "42 2 0 text"]);
});

test("display defaults come from emuera.config and per-session overrides drive default colors", () => {
  const game = emptyGame();
  assert.deepEqual(displayDefaults(game), { foreground: "#c0c0c0", background: "#000000", selection: "#ffff00", font: "ＭＳ ゴシック" });
  game.config.set("文字色", "1,2,3");
  game.config.set("背景色", "bad");
  game.config.set("フォント名", "Example");
  assert.deepEqual(displayDefaults(game), { foreground: "#010203", background: "#000000", selection: "#ffff00", font: "Example" });
  const session = runtime(`@SYSTEM_TITLE
PRINTFORML {GETDEFCOLOR()} {GETDEFBGCOLOR()} %GETFONT()%
SETCOLOR 0xFF0000
RESETCOLOR
WAIT
PRINTL after`, undefined, { display: { foreground: "#112233", background: "#000011", font: "Custom" } });
  const first = session.start();
  assert.deepEqual(texts(first), [`${0x112233} ${0x11} Custom`]);
  assert.equal(first.output[0]!.type === "text" && first.output[0]!.style.color, "#112233");
  session.setDisplay({ foreground: "#445566" });
  const after = session.input("");
  assert.equal(after.output[0]!.type === "text" && after.output[0]!.style.color, "#445566");
});

test("expression functions bind REF parameters to the caller's variables", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIM SEED
#DIM ITEMS, 3
SEED = 4
IF BUMP(SEED)
  PRINTFORML {SEED}
ENDIF
PRINTFORML {BUMP(SEED) + BUMP(SEED)} {SEED}
PRINTFORML {FILL(ITEMS, 7)} {ITEMS:2}
@BUMP(EFFECT_SEED)
#FUNCTION
#DIM REF EFFECT_SEED
EFFECT_SEED++
RETURNF EFFECT_SEED
@FILL(ARR, VALUE)
#FUNCTION
#DIM REF ARR, 0
#DIM VALUE
VARSET ARR, VALUE
RETURNF 1`).start();
  assert.deepEqual(texts(result), ["5", "13 7", "1 7"]);
});

test("TINPUT keeps its default for timeouts, not for an early empty Enter", () => {
  const game = runtime(`@SYSTEM_TITLE
TINPUT 1000, 7, 0, ""
PRINTFORML A{RESULT}`);
  assert.deepEqual(game.start().input, { kind: "integer", timeout: 1000 });
  assert.throws(() => game.input(""), /whole number/);
  assert.deepEqual(texts(game.input("3")), ["3", "A3"]);
});

test("TINPUT timeouts echo the default and replace the countdown", () => {
  const game = runtime(`@SYSTEM_TITLE
TINPUT 1000, 7, 0, ""
PRINTFORML A{RESULT}
TINPUT 2500, 8
PRINTFORML B{RESULT}
TINPUTS 300, "dflt", 0, "late"
PRINTFORML C%RESULTS%
TONEINPUT 300, -42, 0, ""
PRINTFORML D{RESULT}
TWAIT 100, 1
PRINTL E
TWAIT 0, 1
TWAIT 100, 0
PRINTL F
PRINTFORML {LINECOUNT}`);
  game.start();
  assert.deepEqual(texts(game.timeout()), ["7", "A7", "残り 2.5"]);
  let snapshot = game.timeout();
  assert.equal(snapshot.output[0]?.type, "clear");
  assert.deepEqual(texts(snapshot), ["時間切れ", "8", "B8"]);
  assert.deepEqual(texts(game.timeout()), ["late", "dflt", "Cdflt"]);
  snapshot = game.timeout();
  assert.deepEqual(texts(snapshot), ["4", "D4"]);
  assert.deepEqual(snapshot.input, { kind: "wait", timeout: 100, blocking: true });
  assert.throws(() => game.input(""), /cannot be skipped/);
  snapshot = game.timeout();
  assert.deepEqual(texts(snapshot), ["E"]);
  assert.deepEqual(snapshot.input, { kind: "wait", timeout: 100 });
  assert.deepEqual(texts(game.input("")), ["F", "12"]);
  assert.throws(() => game.timeout(), /not waiting/);
});

test("++/-- work inside expressions and assignment indices", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIM COUNT
#DIM ITEMS, 5
PRINTFORML {++LOCAL:1} {LOCAL:1++} {LOCAL:1} {--LOCAL:1} {(++LOCAL:1) % 4}
FOR LOCAL, 0, 6
  PRINTFORM [{LOCAL}]
  SIF (++LOCAL:2) % 4 == 0
    PRINTL
NEXT
PRINTL
ITEMS:(COUNT++) = 7
ITEMS:(COUNT++) += 8
PRINTFORML {COUNT} {ITEMS:0}{ITEMS:1}{ITEMS:2}
IF LOCAL:3++ == 0
  PRINTFORML first {LOCAL:3}
ENDIF
ARG:1 = 2
PRINTFORML {--ARG:1 > 0 ? 1 # 0}{--ARG:1 > 0 ? 1 # 0} {3 - -1}`).start();
  assert.deepEqual(texts(result), ["1 1 2 1 2", "[0]", "[1]", "[2]", "[3]", "", "[4]", "[5]", "", "2 780", "first 1", "10 4"]);
});

test("ISNUMERIC and TOINT accept Emuera integer literals and return 0 for non-numbers", () => {
  const result = runtime(`@SYSTEM_TITLE
PRINTFORML {ISNUMERIC("0x786450")}{ISNUMERIC("12")}{ISNUMERIC("-5")}{ISNUMERIC("1.5")}{ISNUMERIC("def")}{ISNUMERIC("")}{ISNUMERIC("１２")}{ISNUMERIC("12a")}
PRINTFORML {TOINT("0x786450")} {TOINT("0b101")} {TOINT("1e3")} {TOINT("1.5")} {TOINT("-7")} {TOINT("def")} {TOINT("")}`).start();
  assert.deepEqual(texts(result), ["11110000", "7890000 5 1000 1 -7 0 0"]);
});

test("full-width spaces are kept in values when the config excludes them from whitespace", () => {
  const source = "@SYSTEM_TITLE\n#DIMS ROW\nROW = \u3000a\u3000\nPRINTFORML [%ROW%]";
  const kept = runtime(source, (game) => game.config.set("全角スペースをホワイトスペースに含める", "NO")).start();
  assert.deepEqual(texts(kept), ["[\u3000a\u3000]"]);
  assert.deepEqual(texts(runtime(source).start()), ["[a]"]);
});

test("TIMES, BAR, SWAP, array shift/sort/copy/multi-sort, SETVAR, VARSETEX and seeded RAND", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIM A, 5
#DIM B, 5
#DIM C, 3
#DIMS S, 5
#DIM GRID, 2, 3
LOCAL = 100
TIMES LOCAL, 1.25
LOCAL:1 = -7
TIMES LOCAL:1, 0.5
PRINTFORML {LOCAL} {LOCAL:1}
BAR 3, 10, 5
BARL 20, 10, 4
BARSTR -1, 10, 3
PRINTSL RESULTS
A:0 = 1, 2
SWAP A:0, A:1
PRINTFORML {A:0}{A:1}
A:0 = 1, 2, 3, 4, 5
ARRAYSHIFT A, 2, 9
ARRAYSHIFT A, -1, 0, 1, 3
PRINTFORML {A:0}{A:1}{A:2}{A:3}{A:4}
ARRAYSORT A
ARRAYSORT A, BACK, 1, 3
ARRAYCOPY "A", "C"
PRINTFORML {A:0}{A:1}{A:2}{A:3}{A:4} {C:0}{C:1}{C:2}
B:0 = 3, 1, 2, 0, 5
S:0 = c
S:1 = a
S:2 = b
S:3 = x
S:4 = y
ARRAYMSORT B, S
PRINTFORML {B:0}{B:1}{B:2}{B:3}{B:4} %S:0%%S:1%%S:2%%S:3%%S:4% {RESULT}
SETVAR "A:1", 42
VARSETEX "GRID", 7, 1, 1
VARSETEX "GRID:1:0", 5, 0
PRINTFORML {A:1} {GRID:0:0}{GRID:0:1}{GRID:0:2}{GRID:1:0}{GRID:1:2}
RANDOMIZE 5
DUMPRAND
LOCAL:2 = RAND(10, 20)
LOCAL:3 = RAND:1000
INITRAND
PRINTFORML {LOCAL:2 >= 10 && LOCAL:2 < 20} {RAND(10, 20) == LOCAL:2 && RAND:1000 == LOCAL:3}`).start();
  assert.deepEqual(texts(result), ["125 -3", "[*....]", "[****]", "[...]", "21", "91203", "03219 032", "12305 abcxy 1", "42 07755", "1 1"]);
});

test("SKIPDISP hides output and waits, NOSKIP restores display, REUSELASTLINE is replaced, CVARSET and color names", () => {
  const result = runtime(`@SYSTEM_TITLE
PRINTL shown
SKIPDISP 1
PRINTL hidden
WAIT
PRINTFORML {ISSKIP()}
NOSKIP
PRINTFORML visible {ISSKIP()}
ENDNOSKIP
SKIPDISP 0
PRINTFORML {RESULT} back
REUSELASTLINE temp
PRINTL replaced
SETCOLORBYNAME lightgreen
PRINTL green
ADDCHARA 0
ADDCHARA 0
ADDCHARA 0
CVARSET CFLAG, 3, 8
CVARSET CFLAG, 4, 6, 2, 1
PRINTFORML {CFLAG:0:3}{CFLAG:1:3}{CFLAG:2:3} {CFLAG:0:4}{CFLAG:1:4}{CFLAG:2:4}`, template).start();
  assert.deepEqual(texts(result), ["shown", "visible 0", "0 back", "temp", "replaced", "green", "888 060"]);
  const kinds = result.output.map((item) => "text" in item ? item.text : item.type);
  assert.deepEqual(kinds.slice(kinds.indexOf("temp"), kinds.indexOf("replaced") + 1), ["temp", "clear", "replaced"]);
  assert.equal(result.output.find((item) => "text" in item && item.text === "green")!.style.color, "#90ee90");
  const blocked = runtime("@SYSTEM_TITLE\nSKIPDISP 1\nINPUT").start();
  assert.equal(blocked.status, "error");
  assert.match(blocked.error!.message, /SKIPDISP/);
});

test("RETURNFORM formats and evaluates numeric return expressions on every call", () => {
  for (const jit of [false, true]) {
    const result = runtime(`@SYSTEM_TITLE
REPEAT 4
CALL VALUES(COUNT)
PRINTFORML {RESULT}:{RESULT:1}
REND
CALL EMPTY
PRINTFORML {RESULT}
@VALUES(ARG)
RETURNFORM ARG + {ARG}, {ARG + 10}
THROW unreachable
@EMPTY
RETURNFORM`, undefined, { jit }).start();
    assert.deepEqual(texts(result), ["0:10", "2:11", "4:12", "6:13", "0"]);
    assert.match(runtime('@SYSTEM_TITLE\nRETURNFORM "wrong"', undefined, { jit }).start().error!.message, /type mismatch|integer/);
  }
});

test("BARSTR expressions and statements share clamping, formatting and validation", () => {
  for (const jit of [false, true]) {
    const result = runtime(`@SYSTEM_TITLE
RESULTS = untouched
PRINTSL BARSTR(3, 10, 5)
PRINTSL RESULTS
BARSTR 3, 10, 5
PRINTSL RESULTS
PRINTFORML %BARSTR(-1, 10, 3)% %BARSTR(20, 10, 4)%
PRINTFORML %BARSTR(0, 1, 1)% %BARSTR(1, 1, 99)%`, undefined, { jit }).start();
    assert.deepEqual(texts(result), ["[*....]", "untouched", "[*....]", "[...] [****]", `[.] [${"*".repeat(99)}]`]);
    for (const expression of ["BARSTR(1, 0, 5)", "BARSTR(1, -1, 5)", "BARSTR(1, 2, 0)", "BARSTR(1, 2, 100)", "BARSTR(1, 2)", 'BARSTR("x", 2, 5)'])
      assert.equal(runtime(`@SYSTEM_TITLE\nPRINTSL ${expression}`, undefined, { jit }).start().status, "error", expression);
  }
});

test("SAVENOS writes the configured slot count to a destination or RESULT", () => {
  for (const jit of [false, true]) {
    const source = `@SYSTEM_TITLE
SAVENOS LOCAL:2
PRINTFORML {LOCAL:2} {RESULT}
SAVENOS
PRINTFORML {RESULT} {SAVENOS()}`;
    assert.deepEqual(texts(runtime(source, undefined, { jit }).start()), ["20 0", "20 20"]);
    assert.deepEqual(texts(runtime(source, (game) => game.config.set("表示するセーブデータ数", "40"), { jit }).start()), ["40 0", "40 40"]);
    for (const destination of ["1", "RESULTS", "LOCAL, 1"])
      assert.equal(runtime(`@SYSTEM_TITLE\nSAVENOS ${destination}`, undefined, { jit }).start().status, "error", destination);
  }
});

test("PUTFORM appends to writable unsaved SAVEDATA_TEXT and saves its description", async () => {
  const { MemorySaveStore } = await import("../src/storage.js");
  const { readNativeSave } = await import("../src/save-format.js");
  for (const jit of [false, true]) {
    const saves = new MemorySaveStore();
    const result = runtime(`@SYSTEM_TITLE
PRINTFORML [%SAVEDATA_TEXT%]
SAVEDATA_TEXT = prefix:
PUTFORM  Day {7}${" "}
PUTFORM (%"night"%); notes
PRINTSL SAVEDATA_TEXT
SAVEDATA 3, SAVEDATA_TEXT
CHKDATA 3
PRINTSL RESULTS
RESETDATA
PRINTFORML [%SAVEDATA_TEXT%]
PUTFORM fresh
PRINTSL SAVEDATA_TEXT`, undefined, { jit, saves }).start();
    assert.deepEqual(texts(result), ["[]", "prefix: Day 7 (night); notes", "prefix: Day 7 (night); notes", "[]", "fresh"]);
    const saved = saves.read("save03.sav");
    assert.ok(Buffer.isBuffer(saved));
    const record = readNativeSave(saved);
    assert.equal(record.text, "prefix: Day 7 (night); notes");
    assert.equal(record.data.variables.SAVEDATA_TEXT, undefined);
  }
});

test("SORTCHARA is stable, fixes MASTER in place, remaps TARGET/ASSI and moves all character data", () => {
  for (const jit of [false, true]) {
    const result = runtime(`@SYSTEM_TITLE
ADDVOIDCHARA
ADDVOIDCHARA
ADDVOIDCHARA
ADDVOIDCHARA
MASTER = 1
TARGET = 0
ASSI = 3
NAME:0 = z
NAME:1 = master
NAME:2 = a
NAME:3 = b
CFLAG:0:2 = 9
CFLAG:1:2 = -1
CFLAG:2:2 = 3
CFLAG:3:2 = 3
CSTR:0:0 = zero
CSTR:1:0 = one
CSTR:2:0 = two
CSTR:3:0 = three
SORTCHARA CFLAG:0:ORDER
CALL SHOW
SORTCHARA CFLAG:ORDER, BACK
CALL SHOW
SORTCHARA NAME
CALL SHOW
MASTER = -1
SORTCHARA NAME, BACK
CALL SHOW
@SHOW
PRINTFORML %NAME:0%,%NAME:1%,%NAME:2%,%NAME:3% {MASTER}:{TARGET}:{ASSI}
PRINTFORML %CSTR:0:0%,%CSTR:1:0%,%CSTR:2:0%,%CSTR:3:0%`, (game) => {
      game.names.set("CFLAG", new Map([["ORDER", 2]]));
    }, { jit }).start();
    assert.deepEqual(texts(result), [
      "a,master,b,z 1:3:2", "two,one,three,zero",
      "z,master,a,b 1:0:3", "zero,one,two,three",
      "a,master,b,z 1:3:2", "two,one,three,zero",
      "z,master,b,a -1:0:2", "zero,one,three,two",
    ]);
    assert.deepEqual(texts(runtime("@SYSTEM_TITLE\nSORTCHARA\nADDVOIDCHARA\nSORTCHARA\nPRINTL ok", undefined, { jit }).start()), ["ok"]);
    for (const args of ["FLAG", "CFLAG, INVALID", "CFLAG, FORWARD, 1", "1", "CFLAG:10000"]) {
      const invalid = runtime(`@SYSTEM_TITLE\nADDVOIDCHARA\nADDVOIDCHARA\nSORTCHARA ${args}`, undefined, { jit }).start();
      assert.equal(invalid.status, "error", args);
    }
  }
});

test("SORTCHARA defaults to NO and resolves multidimensional sort indices once", () => {
  for (const jit of [false, true]) {
    const result = runtime(`@SYSTEM_TITLE
ADDVOIDCHARA
ADDVOIDCHARA
ADDVOIDCHARA
MASTER = -1
NO:0 = 30
NO:1 = 10
NO:2 = 20
GRID:0:1:0 = 1
GRID:1:1:0 = 3
GRID:2:1:0 = 2
SORTCHARA
PRINTFORML {NO:0},{NO:1},{NO:2}
LOCAL = 0
SORTCHARA GRID:0:1:(LOCAL++)
PRINTFORML {NO:0},{NO:1},{NO:2} {LOCAL}`, (game) => {
      indexScript(game, "#DIM CHARADATA GRID, 2, 2", "grid.ERH", true);
    }, { jit }).start();
    assert.deepEqual(texts(result), ["10,20,30", "30,20,10 1"]);
  }
});

test("default autosaving clears SAVEDATA_TEXT before SAVEINFO builds each description", async () => {
  const { MemorySaveStore } = await import("../src/storage.js");
  const { readNativeSave } = await import("../src/save-format.js");
  for (const jit of [false, true]) {
    const saves = new MemorySaveStore();
    const result = runtime(`@SYSTEM_TITLE
SAVEDATA_TEXT = stale
BEGIN SHOP
@SAVEINFO
PUTFORM fresh {7}
@SHOW_SHOP
PRINTSL SAVEDATA_TEXT
@USERSHOP
QUIT`, undefined, { jit, saves }).start();
    assert.deepEqual(texts(result), ["fresh 7"]);
    const saved = saves.read("save99.sav");
    assert.ok(Buffer.isBuffer(saved));
    assert.match(readNativeSave(saved).text, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} fresh 7$/);
  }
});

test("SAVEDATA, CHKDATA and LOADDATA round-trip game data and resume in the shop", async () => {
  const { MemorySaveStore } = await import("../src/storage.js");
  const saves = new MemorySaveStore();
  const source = `@SYSTEM_TITLE
CHKDATA 3
PRINTFORML {RESULT} %RESULTS%
IF RESULT == 0
  LOADDATA 3
ENDIF
FLAG:5 = 42
ADDCHARA 0
CFLAG:0:3 = 7
SAVEDATA 3, "slot three"
CHKDATA 3
PRINTFORML {RESULT} %RESULTS%
PRINTFORML function {CHKDATA(3)} {CHKDATA(4)} {RESULT}
@EVENTLOAD
PRINTFORML loaded {FLAG:5} {CHARANUM} {CFLAG:0:3}
@SHOW_SHOP
PRINTL shop
@USERSHOP
QUIT`;
  const first = runtime(source, template, { saves }).start();
  assert.deepEqual(texts(first), ["1 ----", "0 slot three", "function 0 1 0"]);
  const second = runtime(source, template, { saves }).start();
  assert.deepEqual(texts(second), ["0 slot three", "loaded 42 1 7", "shop"]);
  assert.equal(second.status, "waiting");
});

test("SAVECHARA and LOADCHARA append saved characters; SAVETEXT and LOADTEXT store text", () => {
  const result = runtime(`@SYSTEM_TITLE
ADDCHARA 0
CFLAG:0:3 = 9
SAVECHARA "hero", "the hero", 0
CHKCHARADATA "hero"
PRINTFORML {RESULT} %RESULTS%
LOADCHARA "hero"
PRINTFORML {RESULT} {CHARANUM} {CFLAG:1:3} %NAME:1%
LOADCHARA "missing"
PRINTFORML {RESULT}
PRINTFORML {SAVETEXT("a\\nb", 2)} %LOADTEXT(2)% {SAVETEXT("x", "sav/notes.xml")} %LOADTEXT("sav/notes.xml")%
PRINTFORML {SAVETEXT("x", "notes.csv")} {SAVETEXT("x", "../notes.txt")} [%LOADTEXT("missing.txt")%]`, (game) => {
    template(game);
    game.config.set("LOADTEXTとSAVETEXTで使える拡張子", "xml");
  }).start();
  assert.deepEqual(texts(result), ["0 the hero", "1 2 9 Name", "0", "1 a\nb 1 x", "0 0 []"]);
});

test("DT_TOXML and DT_FROMXML round-trip tables through .NET-style XML", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIMS schema
#DIMS rows
DT_CREATE "db"
DT_COLUMN_ADD "db", "name"
DT_COLUMN_ADD "db", "age", "int16"
DT_COLUMN_OPTIONS "db", "age", DEFAULT, 5
DT_ROW_ADD "db", "name", "A<1>", "age", 11
LOCAL = DT_ROW_ADD("db", "name", "B")
rows '= DT_TOXML("db", schema)
DT_RELEASE "db"
PRINTFORML {DT_FROMXML("db", schema, rows)} {DT_ROW_LENGTH("db")} %DT_CELL_GETS("db", 0, "name")% {DT_CELL_GET("db", 1, "age")} {DT_CELL_GET("db", 1, "id") == LOCAL}
PRINTFORML {DT_COLUMN_EXIST("db", "age")} {DT_COLUMN_NAMES("db")} %RESULTS:0%,%RESULTS:1%,%RESULTS:2%
PRINTFORML {DT_ROW_REMOVE("db", LOCAL)} {DT_ROW_LENGTH("db")} {DT_FROMXML("db", "", rows)} {DT_ROW_LENGTH("db")}
DT_TOXML "db"
PRINTFORML {STRCOUNT(RESULTS:1, "xs:short")} {STRCOUNT(RESULTS, "<age>11</age>")}`).start();
  assert.deepEqual(texts(result), ["1 2 A<1> 5 1", "2 3 id,name,age", "1 1 0 1", "1 1"]);
});

test("DT_SELECT filters with DataColumn expressions, sorts and writes ids to an output array", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIM ids, 3
DT_CREATE "db"
DT_COLUMN_ADD "db", "name"
DT_COLUMN_ADD "db", "age", "int16"
DT_COLUMN_ADD "db", "height", "int16"
DT_ROW_ADD "db", "name", "Ann", "age", 11, "height", 132
DT_ROW_ADD "db", "name", "bob", "age", 21, "height", 164
DT_ROW_ADD "db", "name", "Cy", "age", 18, "height", 159
DT_ROW_ADD "db", "name", "Di", "age", 18, "height", 172
DT_ROW_ADD "db", "name", "Ed"
LOCAL = DT_SELECT("db", "age >= 18", "age ASC, height DESC", ids)
PRINTFORML {LOCAL} %DT_CELL_GETS("db", ids:0, "name", 1)% %DT_CELL_GETS("db", ids:1, "name", 1)% %DT_CELL_GETS("db", ids:2, "name", 1)%
PRINTFORML {DT_SELECT("db", "name = 'BOB' OR (age < 15 AND NOT height IS NULL)")} {DT_SELECT("db", "name LIKE 'c*' OR age IN (21, 11)")} {DT_SELECT("db", "age IS NULL")}
DT_SELECT "db", , "name DESC"
PRINTFORML {RESULT} %DT_CELL_GETS("db", RESULT:1, "name", 1)% {DT_SELECT("db", "id = " + TOSTR(ids:0), , ids)}`).start();
  assert.deepEqual(texts(result), ["3 Di Cy bob", "2 3 1", "5 Ed 1"]);
});

test("XML_GET, XML_ADDNODE and XML_REMOVENODE query and edit XML strings and documents", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIMS xml = "<list><item k='a'>A</item><item k='b'>B</item></list>"
#DIMS found, 3
PRINTFORML {XML_GET(xml, "/list/item/@k", 1)} %RESULTS:0%%RESULTS:1% {XML_GET(xml, "/list/item[2]/text()", found)} %found%
PRINTFORML {XML_GET(xml, "/list/item", 1, 3)} %RESULTS:0%
XML_ADDNODE xml, "/list", "<item k='c'>C</item>"
XML_ADDNODE xml, "/list/item", "<x/>", 0
PRINTFORML {RESULT} {XML_REMOVENODE(xml, "/list/item[1]")} %xml%
XML_DOCUMENT 0, "<r/>"
PRINTFORML {XML_ADDNODE(0, "/r", "<c/>")} %XML_TOSTR(0)% {XML_GET(1, "/r")} {XML_EXIST(0)}`).start();
  assert.deepEqual(texts(result), [
    "2 ab 1 B",
    `2 <item k="a">A</item>`,
    `0 1 <list><item k="b">B</item><item k="c">C</item></list>`,
    "1 <r><c /></r> -1 1",
  ]);
});

test("FORCE_BEGIN matches BEGIN transitions, resets style and rejects unknown states", () => {
  for (const jit of [false, true]) {
    for (const op of ["BEGIN", "FORCE_BEGIN"]) {
      const run = runtime(`@SYSTEM_TITLE
FOR LOCAL, 0, 4
CALL TRANSITION, 0
NEXT
CALL TRANSITION, 1
RETURN
@TRANSITION(ARG)
SIF !ARG
  RETURN
RESULT = 42
SETCOLOR 0x123456
SETBGCOLOR 0x654321
ALIGNMENT RIGHT
FONTBOLD
${op} first
THROW transition continued
@EVENTFIRST
PRINTFORML first {RESULT}
INPUT
QUIT`, undefined, { jit });
      const snapshot = run.start();
      assert.equal(snapshot.status, "waiting", JSON.stringify(snapshot.error));
      assert.deepEqual(texts(snapshot), ["first 42"]);
      assert.deepEqual(snapshot.output[0]!.style, {
        color: "#c0c0c0", background: "#000000", alignment: "left", fontStyle: 0,
      });
      assert.equal(run.input("0").status, "halted");
    }
    for (const args of ["", "UNKNOWN", "TITLE, FIRST"]) {
      const invalid = runtime(`@SYSTEM_TITLE\nFORCE_BEGIN ${args}`, undefined, { jit }).start();
      assert.equal(invalid.status, "error");
      assert.match(invalid.error!.message, /FORCE_BEGIN/);
    }
  }
});

test("the shop loop sells items, rejects unaffordable ones and passes other values to USERSHOP", () => {
  const rt = runtime(`@SYSTEM_TITLE
MONEY = 150
ITEMSALES:1 = 1
BEGIN SHOP
@SHOW_SHOP
PRINTFORML money {MONEY}
@EVENTBUY
PRINTFORML bought {BOUGHT} {ITEM:1}
@USERSHOP
PRINTFORML user {RESULT}
IF RESULT == 200
  BEGIN TRAIN
ENDIF
@SHOW_STATUS
PRINTL status
@COM_ABLE2
RETURN 0
@SHOW_USERCOM
PRINTL usercom
@COM0
PRINTL did zero
RETURN 1
@SOURCE_CHECK
PRINTL source
@USERCOM
PRINTFORML usercom {RESULT}
BEGIN AFTERTRAIN
@EVENTEND
QUIT`, (game) => {
    game.tables.set("ITEM", new Map([[1, ["Rope", "100"]], [2, ["Gem", "999"]]]));
    game.tables.set("TRAIN", new Map([[0, ["Talk"]], [2, ["Hidden"]], [3, ["Kiss"]]]));
  });
  assert.deepEqual(texts(rt.start()), ["money 150"]);
  assert.deepEqual(texts(rt.input("1")), ["1", "bought 1 1", "money 50"]);
  const poor = rt.input("1");
  assert.deepEqual(texts(poor), ["1", "お金が足りません。"]);
  assert.deepEqual(texts(rt.input("2")), ["2", "売っていません。"]);
  const train = rt.input("200");
  const commands = `${"Talk[  0]".padStart(25)}${"Kiss[  2]".padStart(25)}`;
  assert.deepEqual(texts(train), ["200", "user 200", "status", commands, "usercom"]);
  assert.deepEqual(texts(rt.input("0")), ["0", "did zero", "source"]);
  const ended = rt.input("");
  assert.deepEqual(texts(ended), ["status", commands, "usercom"]);
  const user = rt.input("1");
  assert.deepEqual(texts(user), ["1", "usercom 1"]);
  assert.equal(user.status, "halted");
});

test("the train loop ends a line SHOW_STATUS leaves open before SHOW_USERCOM, as Emuera's PrintFlush does", () => {
  const rt = runtime(`@SYSTEM_TITLE
BEGIN TRAIN
@SHOW_STATUS
PRINT partial
PRINTBUTTON "[9]", 9
@COM_ABLE0
RETURN 0
@SHOW_USERCOM
PRINTL usercom
@USERCOM
QUIT`, (game) => game.tables.set("TRAIN", new Map([[0, ["Talk"]]])));
  const lines = rt.start().output.flatMap((item) => item.type === "text" || item.type === "button" ? [item] : []);
  const usercom = lines.findIndex((item) => item.text === "usercom");
  assert.ok(lines.slice(0, usercom).some((item) => item.type === "text" && item.text === "" && item.newline),
    "the open status line is ended before usercom");
  const closed = runtime(`@SYSTEM_TITLE
BEGIN TRAIN
@SHOW_STATUS
PRINTL status
@COM_ABLE0
RETURN 0
@SHOW_USERCOM
PRINTL usercom
@USERCOM
QUIT`, (game) => game.tables.set("TRAIN", new Map([[0, ["Talk"]]])));
  assert.deepEqual(texts(closed.start()), ["status", "usercom"], "no blank line when the status ended its line");
});

test("CALLTRAIN runs queued TRAIN ids with status and usercom output skipped, then calls CALLTRAINEND", () => {
  const rt = runtime(`@SYSTEM_TITLE
BEGIN TRAIN
@SHOW_STATUS
PRINTL status
@COM_ABLE2
RETURN 0
@SHOW_USERCOM
PRINTL usercom
NOSKIP
PRINTL noskip
ENDNOSKIP
IF SELECTCOM:3 == 0
  SELECTCOM:3 = 1
  SELECTCOM:1 = 3
  SELECTCOM:2 = 2
  CALLTRAIN 2
ENDIF
@COM3
PRINTL kiss
INPUT
RETURN 1
@SOURCE_CHECK
@USERCOM
PRINTFORML usercom {RESULT}
@CALLTRAINEND
PRINTFORML end {ISSKIP()}
QUIT`, (game) => game.tables.set("TRAIN", new Map([[0, ["Talk"]], [2, ["Hidden"]], [3, ["Kiss"]]])));
  const first = rt.start();
  assert.deepEqual(texts(first).slice(2), ["usercom", "noskip", "＜コマンド連続実行：1/2＞", "kiss"]);
  assert.equal(first.input?.kind, "integer");
  assert.deepEqual(texts(rt.input("5")), ["5"]);
  const rest = rt.input("");
  assert.deepEqual(texts(rest), ["noskip", "＜コマンド連続実行：2/2＞", "コマンドを実行できませんでした", "usercom 2", "end 0"]);
  assert.equal(rest.status, "halted");
});

test("PRINT_RECT and PRINT_SPACE emit Emuera shape tags in the current color", () => {
  const result = runtime(`@SYSTEM_TITLE
PRINT_RECT 100
SETCOLOR 255, 0, 0
PRINT_RECT 0, 10, 50, 80
PRINT_SPACE 50
PRINTL
QUIT`).start();
  assert.deepEqual(result.output.flatMap((o) => o.type === "html" ? [o.text] : []), [
    "<shape type='rect' param='100'>",
    "<shape type='rect' param='0, 10, 50, 80' color='#FF0000'>",
    "<shape type='space' param='50' color='#FF0000'>",
  ]);
});

test("string literals that look like punctuation stay arguments", () => {
  const result = runtime(`@SYSTEM_TITLE
PRINTSL REPLACE("a、b", "、", ",")
PRINTSL REPLACE("a", "a", ")") + "("
PRINTV STRCOUNT("a:b", ":") + 1
PRINTL
QUIT
`).start();
  assert.deepEqual(texts(result), ["a,b", ")(", "2", ""]);
});

test("RESETDATA empties only VarExt SAVE_* containers and keeps other MAPs", () => {
  const result = runtime(`@SYSTEM_TITLE
MAP_CREATE "kept"
MAP_SET "kept", "k", "v"
MAP_CREATE "saved"
MAP_SET "saved", "k", "v"
RESETDATA
PRINTFORML {MAP_EXIST("kept")} {MAP_SIZE("kept")} {MAP_EXIST("saved")} {MAP_SIZE("saved")}
QUIT
`, (game) => game.containers.SAVE.MAPS.add("saved")).start();
  assert.deepEqual(texts(result), ["1 1 1 0"]);
});

test("GETCONFIG and GETCONFIGS read emuera.config, _Replace.csv and defaults by Japanese or English name", () => {
  const result = runtime(`@SYSTEM_TITLE
PRINTFORML {GETCONFIG("フォントサイズ")} {GETCONFIG("Line Height")} {GETCONFIG("FONT SIZE")} {GETCONFIG("文字色")} {GETCONFIG("単位の位置")}
PRINTFORML %GETCONFIGS("描画インターフェース")% %GETCONFIGS("お金の単位")%
QUIT
`, (game) => { game.config.set("フォントサイズ", "16"); game.config.set("文字色", "1,2,3"); game.replacements.set("お金の単位", "G"); }).start();
  assert.deepEqual(texts(result), ["16 19 16 66051 1", "TEXTRENDERER G"]);
});

test("HTML_STRINGLEN measures the first line in half-width units or pixels", () => {
  const result = runtime(`@SYSTEM_TITLE
PRINTFORML {HTML_STRINGLEN("<b>B</b>")} {HTML_STRINGLEN("abc", 1)} {HTML_STRINGLEN("あい<br>longer line")} {HTML_STRINGLEN("<shape type='space' param='200'>x")}
QUIT
`).start();
  assert.deepEqual(texts(result), ["1 27 4 5"]);
});

test("POWER works as an instruction and an expression function", () => {
  const result = runtime(`@SYSTEM_TITLE
POWER A, 11, 2
PRINTFORML {A} {POWER(10000, 4)} {POWER(2, 0)}
QUIT
`).start();
  assert.deepEqual(texts(result), ["121 10000000000000000 1"]);
});

test("FORM conditionals inside @-strings do not hide trailing comments", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIMS T
LOCAL = 1
T += "a" + @"<\\@LOCAL % 2 ?/#\\@b>" ;comment with % sign
PRINTSL T
QUIT
`).start();
  assert.deepEqual(texts(result), ["a</b>"]);
});

test("HTML_TAGSPLIT splits tags and text into RESULTS or a given array and count", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIMS PARTS, 3
HTML_TAGSPLIT "<p align='right'>あ<!--c-->い</p>"
PRINTFORML {RESULT} %RESULTS:0%|%RESULTS:1%|%RESULTS:4%
HTML_TAGSPLIT "x<b>y</b>", PARTS:2, LOCAL
PRINTFORML {LOCAL} %PARTS:0%|%PARTS:2%
HTML_TAGSPLIT "<b", PARTS, LOCAL
PRINTFORML {LOCAL}
QUIT
`).start();
  assert.deepEqual(texts(result), ["5 <p align='right'>|あ|</p>", "4 x|y", "-1"]);
});

test("GETMETH and GETMETHS call expression functions by name with a fallback", () => {
  const result = runtime(`@SYSTEM_TITLE
PRINTFORML {GETMETH("TWICE", 0, 21)} {GETMETH("MISSING", -1)} %GETMETHS("GREET", "none", "Bob")% %GETMETHS("NOPE", "none")%
QUIT
@TWICE(X)
#FUNCTION
RETURNF X * 2
@GREET(ARGS)
#FUNCTIONS
RETURNF "Hi " + ARGS
`).start();
  assert.deepEqual(texts(result), ["42 -1 Hi Bob none"]);
});

test("integer arguments to string parameters follow the auto-TOSTR config", () => {
  const source = `@SYSTEM_TITLE
CALL SHOW(42)
QUIT
@SHOW(WORD)
#DIMS WORD
PRINTSL WORD + "!"
`;
  assert.deepEqual(texts(runtime(source, (game) => game.config.set("ユーザー関数の引数に自動的にTOSTRを補完する", "YES")).start()), ["42!"]);
  assert.equal(runtime(source).start().status, "error");
});

test("character scans accept per-character scalars like NO", () => {
  const result = runtime(`@SYSTEM_TITLE
ADDCHARA 0
ADDCHARA 0
CFLAG:1:3 = 5
PRINTFORML {CMATCH(NO, 0)} {CMATCH(CFLAG:3, 5)} {SUMCARRAY(CFLAG:3)} {MAXCARRAY(NO)}
QUIT
`, template).start();
  assert.deepEqual(texts(result), ["2 1 47 0"]);
});

test("array initializers allow a trailing comma", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIMS NAMES, 4 = "a", "b",
PRINTFORML {VARSIZE("NAMES")} %NAMES:1%
QUIT
`, template).start();
  assert.deepEqual(texts(result), ["4 b"]);
});

test("GETTIME works as an instruction and as expression functions", () => {
  const result = runtime(`@SYSTEM_TITLE
GETTIME
PRINTFORML {GETTIME() / 10000000000000 == RESULT / 10000000000000} %GETTIMES()% %RESULTS%
QUIT
`, template).start();
  assert.match(texts(result)[0]!, /^1 \d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d \d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d$/);
});

test("EXISTFUNCTION classifies user functions", () => {
  const result = runtime(`@SYSTEM_TITLE
EXISTFUNCTION "TEST3"
PRINTFORML {EXISTFUNCTION("TEST1")} {EXISTFUNCTION("test2")} {RESULT} {EXISTFUNCTION("SYSTEM_TITLE")} {EXISTFUNCTION("SHOP")} {EXISTFUNCTION("STRLENS")}
QUIT
@TEST1
@TEST2
#FUNCTION
RETURNF 0
@TEST3
#FUNCTIONS
RETURNF ""
`, template).start();
  assert.deepEqual(texts(result), ["1 2 3 1 0 0"]);
});

test("#DEFINE macros expand textually inside expressions only", () => {
  const result = runtime(`@SYSTEM_TITLE
X = SIX * NINE
PRINTFORML {X} {FIVE_3} %HOGE% {STRLENS(HOGE)} {WEATHER}
WEATHER = 7
PRINTFORML {TIME:5} {GROUPMATCH(WEATHER, 5, 7)}
PRINTL FIVE
QUIT
`, (game) => indexScript(game, `#DEFINE SIX 1 + 5
#DEFINE NINE 8 + 1 ;comment
#DEFINE FIVE_1 5
#DEFINE FIVE_2 FIVE_1 + FIVE_1
#DEFINE FIVE_3 FIVE_2 + FIVE_2
#DEFINE HOGE "hogehoge"
#DEFINE WEATHER TIME:5
#DEFINE FIVE 5
`, "MACROS.ERH", true)).start();
  assert.deepEqual(texts(result), ["42 20 hogehoge 8 0", "7 1", "FIVE"]);
});

test("circular #DEFINE macros are rejected", () => {
  const result = runtime(`@SYSTEM_TITLE
X = HOGE
`, (game) => indexScript(game, "#DEFINE HOGE HOGE\n", "MACROS.ERH", true)).start();
  assert.equal(result.status, "error");
  assert.match(result.error!.message, /circular #DEFINE/);
});

test("CLIENTWIDTH/CLIENTHEIGHT follow the configured drawing area", () => {
  const result = runtime(`@SYSTEM_TITLE
CLIENTHEIGHT
PRINTFORML {CLIENTWIDTH()} {CLIENTHEIGHT()} {RESULT}
QUIT
`, (game) => { game.config.set("ウィンドウ幅", "1200"); game.config.set("ウィンドウ高さ", "800"); game.config.set("一行の高さ", "20"); }).start();
  assert.deepEqual(texts(result), ["1200 780 780"]);
});

test("FIND_CHARADATA lists matching SAVECHARA files", () => {
  const result = runtime(`@SYSTEM_TITLE
ADDCHARA 0
SAVECHARA "001あなた", "a", 0
SAVECHARA "あなたABC", "b", 0
SAVECHARA "other", "c", 0
PRINTFORML {FIND_CHARADATA("*あなた*")} %RESULTS:0% %RESULTS:1%
FIND_CHARADATA
PRINTFORML {RESULT} {FIND_CHARADATA("OTH?R")} %RESULTS%
QUIT
`, template).start();
  assert.deepEqual(texts(result), ["2 001あなた あなたABC", "3 1 other"]);
});

test("EXISTFILE checks game files case-insensitively and rejects escapes", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const root = mkdtempSync(`${tmpdir()}/era-exist-`);
  mkdirSync(`${root}/resources`);
  writeFileSync(`${root}/resources/icon.png`, "");
  const result = runtime(`@SYSTEM_TITLE
EXISTFILE "RESOURCES/missing.png"
PRINTFORML {EXISTFILE("RESOURCES/Icon.png")} {RESULT} {EXISTFILE("resources")} {EXISTFILE("resources/../resources/icon.png")}
QUIT
`, (game) => { game.root = root; }).start();
  assert.deepEqual(texts(result), ["1 0 0 0"]);
});

test("derived variables index by their source CSV names", () => {
  const result = runtime(`@SYSTEM_TITLE
ADDCHARA 0
DOWNBASE:0:体力 = 5
LOSEBASE:気力 = 6
UP:快C = 7
PRINTFORML {DOWNBASE:0:0} {LOSEBASE:1} {UP:0}
QUIT
`, (game) => {
    template(game);
    game.names.set("BASE", new Map([["体力", 0], ["気力", 1]]));
    game.names.set("PALAM", new Map([["快C", 0]]));
  }).start();
  assert.deepEqual(texts(result), ["5 6 7"]);
});

test("math functions follow EM's double conversions", () => {
  const result = runtime(`@SYSTEM_TITLE
PRINTFORML {SQRT(17)} {CBRT(27)} {LOG10(1000)} {EXPONENT(2)} {LOG(1)} {SIGN(-5)} {SIGN(0)} {SIGN(9)}
QUIT
`).start();
  assert.deepEqual(texts(result), ["4 3 3 7 0 -1 0 1"]);
});

test("comparison, color and Unicode helper functions", () => {
  const result = runtime(`@SYSTEM_TITLE
PRINTFORML {ALLSAMES(1, 1, 1)} {ALLSAMES("a", "b")} {NOSAMES(1, 2, 3)} {NOSAMES("a", "b", "a")}
PRINTFORML {COLOR_FROMNAME("red")} {COLOR_FROMNAME("nothing")} {COLOR_FROMRGB(1, 2, 3)}
PRINTFORML {ENCODETOUNI("あい", 1)} {ENCODETOUNI("")} {CHKFONT("no such font")}
ENCODETOUNI "AB"
PRINTFORML {RESULT} {RESULT:1} {RESULT:2}
QUIT
`).start();
  assert.deepEqual(texts(result), ["1 0 1 0", "16711680 -1 66051", "12356 -1 0", "2 65 66"]);
});

test("INRANGEARRAY, INRANGECARRAY and STRJOIN", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIM VALUES, 5 = 1, 5, 10, 15, 20
#DIMS WORDS, 4 = "a", "b", "c", "d"
ADDCHARA 0
ADDCHARA 0
CFLAG:1:3 = 7
PRINTFORML {INRANGEARRAY(VALUES, 5, 20)} {INRANGEARRAY(VALUES, 0, 100, 1, 3)} {INRANGECARRAY(CFLAG:0:3, 5, 10)}
PRINTFORML %STRJOIN(WORDS)% %STRJOIN(WORDS, "-", 1, 2)% %STRJOIN(VALUES, "")%
QUIT
`, template).start();
  assert.deepEqual(texts(result), ["3 2 1", "a,b,c,d b-c 15101520"]);
});

test("REGEXPMATCH fills RESULTS or reference arguments with each match's groups", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIM GROUPS
#DIMS FOUND, 10
PRINTFORML {REGEXPMATCH("Apple Banana Car", "(.{2})\\\\b", 1)} {RESULT:1} %RESULTS:0% %RESULTS:1% %RESULTS:5%
PRINTFORML {REGEXPMATCH("Apple Banana Car", ".(.{2})\\\\b", GROUPS, FOUND)} {GROUPS} %FOUND:2% %FOUND:3%
QUIT
`).start();
  assert.deepEqual(texts(result), ["3 2 le le ar", "3 2 ana na"]);
});

test("printed-line queries see EM-style HTML lines and the current function", () => {
  const result = runtime(`@SYSTEM_TITLE
PRINTL first
SETCOLOR 255, 0, 0
PRINTL red
RESETCOLOR
PRINTL
LOCALS = %HTML_GETPRINTEDSTR(0)%|%HTML_GETPRINTEDSTR(1)%|%HTML_GETPRINTEDSTR(2)%|%HTML_GETPRINTEDSTR(9)%
PRINT x
LOCAL = LINEISEMPTY()
PRINTL
PRINTFORML %LOCALS% {LOCAL} {LINEISEMPTY()} %Helper()%
QUIT
@Helper
#FUNCTIONS
RETURNF GETDOINGFUNCTION()
`).start();
  assert.deepEqual(texts(result).at(-1), "<p align='left'><nobr> </nobr></p>|<p align='left'><nobr><font color='#FF0000'>red</font></nobr></p>|<p align='left'><nobr>first</nobr></p>| 0 1 Helper");
});

test(".NET inline regex options become JS flags or scoped modifier groups", () => {
  const result = runtime(`@SYSTEM_TITLE
PRINTFORML {STRCOUNT("Unicorn", "(?i)^uni|^usa")} {STRCOUNT("aBc", "a(?i)b")} {FINDELEMENT(LOCALS, "(?i)X", 0, 2, 1)}
PRINTSL REPLACE("YOU said", "(?i)you", "me")
QUIT`).start();
  assert.deepEqual(texts(result), ["1 1 -1", "me said"]);
});

test("FORM conditionals close at the next \\@ like Emuera, with literal quotes in arms", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIM M = 5
PRINTSL JOIN2(@"It's \\@ M >= 3 ? rich # poor\\@, ok", "Why?!")
PRINTFORML [\\@ M ? "a" # b\\@]\\s[\\@ M == 1 ? x\\@]
QUIT
@JOIN2(A, B)
#FUNCTIONS
#DIMS A
#DIMS B
RETURNF A + "|" + B`).start();
  assert.deepEqual(texts(result), ["It's rich, ok|Why?!", `["a"] []`]);
});

test("event ordering keywords are ignored on direct calls and size directives accept tabs", () => {
  const result = runtime(`@SYSTEM_TITLE
CALL EVENTSHOP
PRINTL done
QUIT
@EVENTSHOP
#PRI
#LOCALSIZE	3
#LOCALSSIZE 2
PRINTFORML {VARSIZE("LOCAL")} {VARSIZE("LOCALS")}`).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.deepEqual(texts(result), ["3 2", "done"]);
});

test("CHARADATA variables follow characters through add, swap, copy, delete, saves and SAVECHARA", async () => {
  const { MemorySaveStore } = await import("../src/storage.js");
  const saves = new MemorySaveStore();
  const header = (game: Game) => {
    template(game);
    indexScript(game, "#DIM CHARADATA SAVEDATA GRID, 2, 3\n#DIMS CHARADATA SAVEDATA LABEL, 2\n#DIM CHARADATA TEMP", "chara.ERH", true);
  };
  const source = `@SYSTEM_TITLE
CHKDATA 1
IF RESULT == 0
  LOADDATA 1
ENDIF
ADDCHARA 0, 0, 0
TARGET = 1
GRID:1:2 = 12
GRID:0:1:0 = 1
LABEL:2:1 = two
TEMP = 5
PRINTFORML {GRID:1:1:2} {GRID:0:1:0} %LABEL:2:1% {TEMP:1:0} {TEMP}
SWAPCHARA 1, 2
PRINTFORML {GRID:2:1:2} %LABEL:1:1% {TEMP:2:0}
COPYCHARA 2, 0
DELCHARA 1
PRINTFORML {CHARANUM} {GRID:0:1:2} {GRID:0:1:0} {TEMP:0:0} {GRID:1:1:2} [%LABEL:1:1%]
SAVECHARA "c", "c", 0
LOADCHARA "c"
PRINTFORML {CHARANUM} {GRID:2:1:2} {TEMP:2:0}
SAVEDATA 1, "slot"
@EVENTLOAD
PRINTFORML loaded {CHARANUM} {GRID:0:1:2} {GRID:1:1:2} {TEMP:0:0}
QUIT`;
  const first = runtime(source, header, { saves }).start();
  assert.deepEqual(texts(first), ["12 1 two 5 5", "12 two 5", "2 12 0 5 12 []", "3 12 0"]);
  const second = runtime(source, header, { saves }).start();
  assert.deepEqual(texts(second).at(-1), "loaded 3 12 12 0");
  const invalid = runtime("@SYSTEM_TITLE\nA = BAD:0:0:0:0", (game) => indexScript(game, "#DIM CHARADATA BAD, 2, 2, 2", "bad.ERH", true)).start();
  assert.equal(invalid.status, "error");
  assert.match(invalid.error!.message, /at most 2 dimensions/);
});

test("graphics compose sprites into display lists sent with html that shows them", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIM CM, 6, 6
CM:1:1 = 256
CM:2:2 = 256
CM:3:3 = 256
CM:4:4 = 128
CM:5:1 = 256
GCREATE 5, 40, 30
GSETBRUSH 5, 0xFF102030
GFILLRECTANGLE 5, 0, 0, 2, 2
GDRAWSPRITE 5, "BODY"
GDRAWSPRITE 5, "FACE", 10, 4, 20, 10, CM:1:1
PRINTFORML {SPRITECREATE("OUT", 5, 5, 0, 30, 20)} {SPRITEWIDTH("OUT")} {SPRITEHEIGHT("OUT")}
HTML_PRINT "<img src='OUT' height='200'>"
GCREATE 6, 10, 10
GDRAWG 6, 5, 0, 0, 10, 10, 0, 0, 40, 30
GCLEAR 5, 0
GDISPOSE 5
PRINTFORML {SPRITECREATED("OUT")} {SPRITECREATE("OUT", 6)} {SPRITEWIDTH("OUT")}
QUIT`, (game) => {
    game.sprites.set("BODY", { file: "chara/body.webp", x: 0, y: 0, width: 40, height: 30 });
    game.sprites.set("FACE", { file: "chara/face.webp", x: 8, y: 16, width: 4, height: 2 });
  }).start();
  assert.deepEqual(texts(result), ["1 30 20", "<img src='OUT' height='200'>", "0 1 10"]);
  const html = result.output.find((item) => item.type === "html");
  assert.ok(html && "sprites" in html && html.sprites);
  const out = html.sprites["OUT"]!;
  assert.deepEqual([out.width, out.height], [30, 20]);
  const [view] = out.picture.ops;
  assert.ok(view?.op === "graphics");
  assert.deepEqual([view.src, view.dest], [[5, 0, 30, 20], [0, 0, 30, 20]]);
  assert.deepEqual(view.source.ops.map((op) => op.op), ["fill", "image", "image"]);
  const [fill, body, face] = view.source.ops;
  assert.ok(fill?.op === "fill" && body?.op === "image" && face?.op === "image");
  assert.equal(fill.color, "rgba(16, 32, 48, 1)");
  assert.deepEqual([body.url, body.src, body.dest], ["/resources/chara/body.webp", [0, 0, 40, 30], [0, 0, 40, 30]]);
  assert.deepEqual([face.src, face.dest], [[8, 16, 4, 2], [10, 4, 20, 10]]);
  assert.deepEqual(face.matrix, [[1, 0, 0, 0, 0], [0, 1, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 0.5, 0], [1, 0, 0, 0, 0]]);
});

test("builtin functions written as statements store their result", () => {
  const result = runtime(`@SYSTEM_TITLE
#DIM NUMS, 4
#DIMS WORDS, 2
NUMS:1 = 5
NUMS:3 = 5
LIMIT 7, -1, 1
PRINTFORML {RESULT}
MATCH NUMS, 5
PRINTFORML {RESULT}
FINDELEMENT NUMS, 5
PRINTFORML {RESULT}
WORDS:0 '= "  pad  "
REPLACE WORDS:0, "(^\\\\s+|\\\\s+$)", ""
PRINTFORML [%RESULTS%]
GETBIT 6, 1
PRINTFORML {RESULT}
GCREATE 1, 10, 10
GCLEAR 1, 0xFF000000, 0, 0, 5, 5
PRINTFORML {RESULT}
SPRITECREATE "X", 1
PRINTFORML {RESULT} {SPRITEWIDTH("X")}
GETCOLOR
CURRENTREDRAW
VALUE ,= ,`).start();
  assert.equal(result.status, "error");
  assert.deepEqual(result.output.flatMap((item) => "text" in item ? [item.text] : []).slice(0, 7), ["1", "2", "1", "[pad]", "1", "1", "1 10"]);
  assert.match(result.error!.message, /extra ','/);
});
test("GCLEAR accepts only its two- and six-argument forms", () => {
  const result = runtime(`@SYSTEM_TITLE
GCREATE 1, 10, 10
GCLEAR 1, 0, 0`).start();
  assert.match(result.error!.message, /GCLEAR takes 2 or 6 arguments/);
});
test("every builtin function the compatibility report accepts is implemented", () => {
  for (const name of BUILTIN_FUNCTIONS) {
    const result = runtime(`@SYSTEM_TITLE\n${name}`).start();
    assert.doesNotMatch(result.error?.message ?? "", /Unsupported (?:expression function|instruction)/, name);
  }
});
test("animation sprites send every frame with the html that shows them", () => {
  const result = runtime(`@SYSTEM_TITLE
GCREATE 1, 40, 20
GDRAWSPRITE 1, "MOVING", 0, 0, 40, 20
PRINTFORML {SPRITEWIDTH("MOVING")} {SPRITEHEIGHT("MOVING")} {RESULT}
HTML_PRINT "<img src='MOVING'>"
GCREATE 2, 30, 30
GCLEAR 2, 0xFFFF0000
PRINTFORML {SPRITEANIMECREATE("BLINK", 20, 20)} {SPRITEANIMECREATE("BLINK", 20, 20)} {SPRITECREATED("BLINK")}
PRINTFORML {SPRITEANIMEADDFRAME("BLINK", 2, 0, 0, 30, 30, 0, 0, 4000)} {SPRITEANIMEADDFRAME("BLINK", 2, 0, 0, 10, 10, 15, -5, 70)}
PRINTFORML {SPRITEANIMEADDFRAME("BLINK", 2, 25, 0, 10, 10, 0, 0, 70)} {SPRITEANIMEADDFRAME("BLINK", 2, 0, 0, 10, 10, 0, 0, 0)} {SPRITEANIMEADDFRAME("MOVING", 9, 0, 0, 1, 1, 0, 0, 1)}
GCLEAR 2, 0xFF0000FF
HTML_PRINT "<img src='BLINK'>"`, (game) => game.sprites.set("MOVING", {
    file: "", x: 0, y: 0, width: 20, height: 10,
    animation: { width: 20, height: 10, frames: [
      { file: "sheet.png", x: 5, y: 0, width: 10, height: 10, offsetX: 10, offsetY: 0, delay: 100 },
      { file: "sheet.png", x: 0, y: 0, width: 30, height: 10, delay: 250 },
    ] },
  })).start();
  assert.deepEqual(texts(result).filter((line) => !line.includes("<img")), ["20 10 1", "1 0 1", "1 1", "0 0 0"]);
  const [moving, blink] = result.output.filter((item) => item.type === "html").map((item) => "sprites" in item ? item.sprites : undefined);
  // CSV frames: the second is clipped to the 20x10 sprite.
  assert.deepEqual(moving?.["MOVING"]?.frames, [
    { delay: 100, picture: { width: 20, height: 10, ops: [{ op: "image", url: "/resources/sheet.png", src: [5, 0, 10, 10], dest: [10, 0, 10, 10] }] } },
    { delay: 250, picture: { width: 20, height: 10, ops: [{ op: "image", url: "/resources/sheet.png", src: [0, 0, 20, 10], dest: [0, 0, 20, 10] }] } },
  ]);
  // Script frames show their G's content when printed (blue), clipped like Emuera's AnimeFrame.Normalize.
  const frames = blink?.["BLINK"]?.frames;
  assert.deepEqual(frames?.map((frame) => frame.delay), [4000, 70]);
  const [first, second] = frames!.map((frame) => frame.picture.ops[0]);
  assert.ok(first?.op === "graphics" && second?.op === "graphics");
  assert.deepEqual([first.src, first.dest, second.src, second.dest], [[0, 0, 20, 20], [0, 0, 20, 20], [0, 0, 5, 5], [15, 0, 5, 5]]);
  assert.deepEqual(first.source.ops.map((op) => op.op === "fill" && op.color), ["rgba(0, 0, 255, 1)"]);
});
