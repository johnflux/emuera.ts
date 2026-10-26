import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyGame, indexScript, loadGame } from "../src/loader.js";
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
test("CURRENTALIGN reports the active alignment in expressions and statements", () => {
  const result = new Runtime(game(`@SYSTEM_TITLE
PRINTSL CURRENTALIGN()
ALIGNMENT CENTER
PRINTSL CURRENTALIGN()
ALIGNMENT RIGHT
CURRENTALIGN
PRINTSL RESULTS
ALIGNMENT LEFT
PRINTSL CURRENTALIGN()`)).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.equal(printed(result), "LEFT\nCENTER\nRIGHT\nLEFT");
  const invalid = new Runtime(game("@SYSTEM_TITLE\nPRINTSL CURRENTALIGN(1)")).start();
  assert.equal(invalid.status, "error");
  assert.match(invalid.error!.message, /Invalid number of arguments for CURRENTALIGN/);
});
test("Anchor compatibility conversion defaults do not leak to other games or override explicit config", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-anchor-"));
  try {
    await mkdir(path.join(root, "ERB"));
    await mkdir(path.join(root, "CSV"));
    await writeFile(path.join(root, "ERB", "title.erb"), "@SYSTEM_TITLE\nCALL SHOW(42)\nRETURN\n@SHOW(ARGS)\nPRINTSL ARGS");
    const standard = new Runtime(await loadGame(root)).start();
    assert.equal(standard.status, "error");
    assert.match(standard.error!.message, /cannot convert an integer to a string/);
    await writeFile(path.join(root, "Emuera-Anchor.exe"), "");
    const anchor = new Runtime(await loadGame(root)).start();
    assert.equal(anchor.status, "halted", JSON.stringify(anchor.error));
    assert.equal(printed(anchor), "42");
    await writeFile(path.join(root, "emuera.config"), "ユーザー関数の引数に自動的にTOSTRを補完する:NO");
    const configured = new Runtime(await loadGame(root)).start();
    assert.equal(configured.status, "error");
    assert.match(configured.error!.message, /cannot convert an integer to a string/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("RESTART repeats the current frame, retaining arguments and locals but resetting loop bookkeeping", () => {
  const result = new Runtime(game(`@SYSTEM_TITLE
CALL MENU(7)
PRINTL returned
RETURN
@MENU(ARG)
#DIM DYNAMIC PASSES
PASSES++
PRINTFORML {ARG}:{PASSES}
FOR LOCAL, 0, 2
  SIF PASSES == 1
    RESTART
  PRINTFORML {LOCAL}
NEXT
RETURN`)).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.equal(printed(result), "7:1\n7:2\n0\n1\nreturned");
  const infinite = new Runtime(game("@SYSTEM_TITLE\nRESTART"), 20).start();
  assert.equal(infinite.status, "error");
  assert.match(infinite.error!.message, /Instruction limit/);
  const invalid = new Runtime(game("@SYSTEM_TITLE\nRESTART 1")).start();
  assert.equal(invalid.status, "error");
  assert.match(invalid.error!.message, /does not accept arguments/);
});
test("PRINTPLAIN variants preserve literal layout and FORM formatting without automatic buttons or newlines", () => {
  const result = new Runtime(game(`@SYSTEM_TITLE
LOCALS = [7] disabled
SETCOLOR 0x70C070
PRINTPLAIN   [1] literal; {2}
PRINTPLAINFORM   %LOCALS, 20, LEFT%; {2+3}
PRINTFORM [8] enabled
PRINTL
PRINTFORML {LINECOUNT}`)).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  const [literal, formatted, normal] = result.output;
  assert.ok(literal?.type === "text" && formatted?.type === "text" && normal?.type === "text");
  assert.equal(literal.text, "  [1] literal; {2}");
  assert.equal(formatted.text, "  " + "[7] disabled".padEnd(20) + "; 5");
  assert.equal(literal.plain, true);
  assert.equal(formatted.plain, true);
  assert.equal(normal.plain, undefined);
  assert.equal(literal.newline, false);
  assert.equal(formatted.newline, false);
  assert.equal(formatted.style.color, "#70c070");
  assert.equal(result.output.at(-1)?.type, "text");
  assert.equal(printed(result).split("\n").at(-1), "1");
});
test("separators and width queries share the terminal columns, including after resizing", () => {
  const runtime = new Runtime(game(`@SYSTEM_TITLE
DRAWLINE
CUSTOMDRAWLINE -=
CUSTOMDRAWLINE 日
PRINTFORML {MAXWIDTH()} {STRLENS(DRAWLINESTR)}
INPUT
DRAWLINE
PRINTFORML {MAXWIDTH()} {STRLENS(DRAWLINESTR)}
PRINTFORM %@"□ "%
PRINTBUTTON "Experience", 163
PRINTFORML  □%"-"*(MAXWIDTH()-6-STRLENS("Experience"))%
PRINTFORML {LINECOUNT}`), 50_000, { columns: 25 });
  const initial = runtime.start();
  assert.equal(initial.status, "waiting", JSON.stringify(initial.error));
  assert.equal(printed(initial), ["-".repeat(25), "-=".repeat(12), "日".repeat(12), "25 25"].join("\n"));
  runtime.setColumns(40);
  const resized = runtime.input("0");
  assert.equal(resized.status, "halted", JSON.stringify(resized.error));
  assert.equal(printed(resized), ["-".repeat(40), "40 40", "□ ", " □" + "-".repeat(24), "8"].join("\n"));
  assert.throws(() => runtime.setColumns(0), /Terminal columns/);
  assert.throws(() => runtime.setColumns(1.5), /Terminal columns/);
});
test("formatted literals, nested string expressions and lazy FORM conditionals", () => {
  const source = String.raw`@SYSTEM_TITLE
LOCALS '= @"Version: \@ 1 ? %TOSTR(4,"000")% # %MISSING()% \@"
PRINTFORML %LOCALS%
LOCALS '= @"\@ 0 ? wrong # \@\@ 1 ? right # wrong \@"
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
test("expression functions bind omitted arguments, enforce types and cannot wait for input", () => {
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
    ['WAIT\nRETURNF 1', /attempted input/],
    ['RETURNF "wrong"', /integer/],
  ] as const) {
    const invalid = new Runtime(game("@SYSTEM_TITLE\nA = FUNC()\nRETURN\n@FUNC\n#FUNCTION\n" + body)).start();
    assert.equal(invalid.status, "error");
    assert.match(invalid.error!.message, expected);
  }
});
test("FORM conditionals can be string operands inside percent interpolation", () => {
  const result = new Runtime(game(String.raw`@SYSTEM_TITLE
LOCALS = first
PRINTFORML %LOCALS + \@ STRLENS(LOCALS) ? %" "%#\@%second
PRINTSL @"%LOCALS + \@ 0 ? %MISSING()% # , %TOSTR(2,"00")%\@%"
#DIM A・B = 7
PRINTFORML {A・B}`)).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.equal(printed(result), "first second\nfirst, 02\n7");
});
test("MONEYSTR formats exact integer currency with the game's unit and placement", () => {
  const value = game(`@SYSTEM_TITLE
PRINTFORML %MONEYSTR(5000, "#,##0")% %MONEYSTR(-9223372036854775808, "#,##0")%
PRINTFORML %MONEYSTR(7, "000")% %MONEYSTR(-7)%`);
  const snapshot = new Runtime(value).start();
  assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
  assert.equal(printed(snapshot), "\u00a55,000 \u00a5-9,223,372,036,854,775,808\n\u00a5007 \u00a5-7");
  value.money = { label: " coins", first: false };
  assert.equal(printed(new Runtime(value).start()).split("\n")[1], "007 coins -7 coins");
  const invalid = new Runtime(game('@SYSTEM_TITLE\nPRINTSL MONEYSTR(5, "unsupported")')).start();
  assert.equal(invalid.status, "error");
  assert.match(invalid.error!.message, /Unsupported MONEYSTR format/);
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
PRINTFORML {GETNUM(TALENT, "example")} {GETNUM(TALENT, "missing")} {VARSIZE("LABELS")} %GETVARS("LABELS:1")%
PRINTFORML {GETNUM(TRAINNAME, "kiss")} {GETNUM(MAXBASE, "stamina")} {GETNUM(STR, "greeting")}`, '#DIMS LABELS = "first", "second"');
  data.names.set("TALENT", new Map([["EXAMPLE", 7]]));
  data.names.set("TRAIN", new Map([["KISS", 3]]));
  data.names.set("BASE", new Map([["STAMINA", 0]]));
  data.names.set("STR", new Map([["GREETING", 5]]));
  const result = new Runtime(data).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.equal(printed(result), "7 -1 2 second\n3 0 5");
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
test("REDRAW reads bit 0, accepts refresh flags and ignores higher bits like Emuera", () => {
  for (const jit of [false, true]) {
    const result = new Runtime(game(`@SYSTEM_TITLE
FOR LOCAL, 0, 34
REDRAW LOCAL
CURRENTREDRAW
PRINTFORML {RESULT}:{CURRENTREDRAW()}
NEXT
REDRAW -1
PRINTFORML {CURRENTREDRAW()}
REDRAW -2
PRINTFORML {CURRENTREDRAW()}`), 50_000, { jit }).start();
    assert.equal(result.status, "halted", JSON.stringify(result.error));
    assert.equal(printed(result), [...Array.from({ length: 34 }, (_, i) => `${i & 1}:${i & 1}`), "1", "0"].join("\n"));
  }
});
test("slider tracks retain struck-through spaces and their colors after the routine becomes hot", () => {
  for (const jit of [false, true]) {
    const result = new Runtime(game(`@SYSTEM_TITLE
REPEAT 3
CALL SLIDER
REND
@SLIDER
FOR LOCAL, 0, 30
IF LOCAL == 15
PRINTFORM %UNICODE(0x2588)%
ELSE
IF LOCAL < 15
SETCOLOR 0x40C040
ELSE
SETCOLOR 0xC040C0
ENDIF
FONTSTYLE 4
IF LOCAL == 0
PRINTFORM %UNICODE(0x25E3)%
ELSEIF LOCAL == 29
PRINTFORM %UNICODE(0x25E2)%
ELSE
PRINTFORM${"  "}
ENDIF
FONTSTYLE 0
ENDIF
RESETCOLOR
NEXT
PRINTL`), 50_000, { jit }).start();
    assert.equal(result.status, "halted", JSON.stringify(result.error));
    const runs = result.output.filter((item) => item.type === "text");
    for (let row = 0; row < 3; row++) {
      const slider = runs.slice(row * 31, row * 31 + 30);
      assert.equal(slider.map((item) => item.text).join(""), `◣${" ".repeat(14)}█${" ".repeat(13)}◢`);
      slider.forEach((item, i) => {
        assert.equal(item.style.fontStyle, i === 15 ? 0 : 4);
        if (i !== 15) assert.equal(item.style.color.toLowerCase(), i < 15 ? "#40c040" : "#c040c0");
      });
    }
  }
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
test("PRINT and PRINTFORM consume only one separator and preserve leading layout spaces", () => {
  const result = new Runtime(game("@SYSTEM_TITLE\nPRINT □ \nPRINTL  □---\nPRINTFORM  {1,3,LEFT} \nPRINTL\nPRINTL 　Indented\nPRINTL\t\tTabbed")).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.deepEqual(result.output.filter((item) => item.type === "text").map((item) => item.text), [
    "□ ", " □---", " 1   ", "", "　Indented", "\tTabbed",
  ]);
});
