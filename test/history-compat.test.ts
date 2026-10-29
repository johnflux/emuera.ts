import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isSupported } from "../src/compiler.js";
import { emptyGame, indexScript, loadGame, type Game } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";

function run(body: string, jit: boolean, setup?: (game: Game) => void) {
  const game = emptyGame();
  setup?.(game);
  indexScript(game, body, "history.erb");
  return new Runtime(game, 50_000, { jit }).start();
}
const texts = (snapshot: ReturnType<Runtime["start"]>) =>
  snapshot.output.filter((line) => line.type === "text").map((line) => line.text);

test("native PRINTN fixture preserves lines through waits, prefetch and warmed JIT callers", async () => {
  const source = await readFile(new URL("./fixtures/native-history-print.erb", import.meta.url), "utf8");
  for (const jit of [false, true]) for (const prefetch of [false, true]) {
    const game = emptyGame();
    indexScript(game, source, "native-history-print.erb");
    const runtime = new Runtime(game, 50_000, { jit });
    let snapshot = runtime.start();
    let line = "", waits = 0;
    const lines: string[] = [];
    while (true) {
      for (const output of snapshot.output) if (output.type === "text") {
        line += output.text;
        if (output.newline) { lines.push(line); line = ""; }
      }
      if (snapshot.status !== "waiting") break;
      assert.equal(snapshot.input?.kind, "wait");
      assert.equal(snapshot.input.keepLineOpen, true);
      assert.equal(snapshot.output.some((output) => "newline" in output && output.newline), waits % 5 === 0 && waits > 0);
      assert.ok(++waits <= 25, "fixture should finish after 25 waits");
      if (prefetch) assert.equal(runtime.prefetch(), true);
      snapshot = runtime.input("");
    }
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.equal(waits, 25);
    assert.equal(line, "");
    assert.deepEqual(lines, [
      ...Array(5).fill("prefix:literal;still-text:form57string:forms7:end"), "DONE", "Log written to emuera.log",
    ]);
  }
});

test("PRINTN supports only native combinations and obeys SKIPDISP and message skipping", () => {
  for (const op of ["PRINTN", "PRINTFORMN", "PRINTFORMSN", "PRINTVN", "PRINTSN"]) assert.ok(isSupported(op));
  for (const op of ["PRINTKN", "PRINTDN", "PRINTFORMKN", "PRINTCN", "PRINTLCN", "PRINTSINGLEN", "PRINTDATAN"])
    assert.equal(isSupported(op), false, op);
  for (const jit of [false, true]) {
    const snapshot = run(`@SYSTEM_TITLE
SKIPDISP 1
PRINTN hidden
SKIPDISP 0
SKIPLOG 1
PRINT before:
PRINTN skipped
PRINTL :after
QUIT`, jit);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), ["before:", "skipped", ":after"]);
    assert.deepEqual(snapshot.output.filter((output) => output.type === "text").map((output) => output.newline), [false, false, true]);
  }
});

test("native array fixture covers VARSETEX expression results, embedded indices and numeric versus string rows", async () => {
  const source = await readFile(new URL("./fixtures/native-history-arrays.erb", import.meta.url), "utf8");
  for (const jit of [false, true]) {
    const snapshot = run(source, jit);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), [
      ...Array.from({ length: 5 }, () => [
        "VECTOR 7 7 7 7", "SET 1", "GRID 0 0 9 9", "WORDS [] [x] [x]", "RESULT 1 88 7 3 3 7",
        "IGNORED 4 4", "CUBE 0 7 7 7 7", "CHARA 8 0 0 0", "EXPLICIT 6 6 0 0 0",
      ]).flat(), "DONE", "Log written to emuera.log",
    ]);
  }
});

test("VARSETEX expression functions resolve local arrays and preserve mutation guards", () => {
  for (const jit of [false, true]) {
    const snapshot = run(`@SYSTEM_TITLE
FOR A,0,5
PRINTFORML {FILL()}
NEXT
QUIT
@FILL
#FUNCTION
#DIM VALUES,3
RETURNF VARSETEX("VALUES",5,0,1,3) + VALUES:0 + VALUES:1 + VALUES:2`, jit);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), Array(5).fill("11"));
    for (const [declaration, expression, message] of [
      ["#DIM CONST VALUES = 1,2", 'VARSETEX("VALUES",3)', /constant/i],
      ["#DIM VALUES,3", 'VARSETEX("VALUES","x")', /type mismatch/],
      ["#DIMS VALUES,3", 'VARSETEX("VALUES",1)', /type mismatch/],
      ["#DIM VALUES,2,3", 'VARSETEX("VALUES:2:0",1)', /out of range/],
      ["#DIM VALUES,3", 'VARSETEX("VALUES",1,0,0,2,3)', /arguments/],
      ["#DIM VALUES,3", 'VARSETEX("VALUES",1,0,-1,2)', /range out of bounds/],
      ["#DIM VALUES,3", 'VARSETEX("VALUES",1,0,0,4)', /range out of bounds/],
      ["#DIM VALUES,3", 'VARSETEX("VALUES")', /arguments/],
      ["#DIM VALUES,3", 'VARSETEX("VALUES",)', /arguments/],
      ["#DIM VALUES,3", 'VARSETEX("VALUES",,1)', /requires a value/],
    ] as const) {
      const invalid = run(`@SYSTEM_TITLE\n${declaration}\nPRINTFORML {${expression}}\nQUIT`, jit);
      assert.equal(invalid.status, "error");
      assert.match(invalid.error!.message, message);
    }
  }
});

test("native history fixture covers semicolons, macro lists, VARS, defaults and formatted TRYLIST calls", async () => {
  const [header, source] = await Promise.all([
    readFile(new URL("./fixtures/native-history.erh", import.meta.url), "utf8"),
    readFile(new URL("./fixtures/native-history.erb", import.meta.url), "utf8"),
  ]);
  for (const jit of [false, true]) {
    const snapshot = run(source, jit, (game) => indexScript(game, header, "history.erh", true));
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), [
      ...Array.from({ length: 5 }, () => [
        "TEXT [a;b;c] [hello]", "BITS 1 4", "DEFAULTS 10000 0", "DEFINED 1 0", "PRINTC 3 3", "LIST 42",
      ]).flat(), "DONE", "Log written to emuera.log",
    ]);
  }
});

test("assignment comments depend on the resolved variable type, including shadowing and warmed JIT", () => {
  for (const jit of [false, true]) {
    const snapshot = run(`@SYSTEM_TITLE
#DIM TEXT
FOR A,0,5
CALL PROBE
NEXT
QUIT
@PROBE
#DIMS TEXT
TEXT = ;a;%STR:0%
LOCAL = 5; numeric comment
LOCAL += 2; compound comment
LOCAL ++; increment comment
LOCALS '= "quoted;value"; expression comment
PRINTFORML [%TEXT%] {LOCAL} [%LOCALS%]
RETURN`, jit);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), Array(5).fill("[;a;] 8 [quoted;value]"));
  }
});

test("macro argument expansion preserves quoted text and literal output and detects cycles", () => {
  for (const jit of [false, true]) {
    const snapshot = run(`@SYSTEM_TITLE
CALL TAKE, PAIR
PRINTFORML {RESULT}
PRINTL PAIR
PRINTBUTTON "PAIR", 1
QUIT
@TAKE(ARG, ARG:1)
RETURN ARG + ARG:1`, jit, (game) => indexScript(game, "#DEFINE PAIR 2,3", "macros.erh", true));
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), ["5", "PAIR"]);
    assert.equal(snapshot.output.find((line) => line.type === "button")?.text, "PAIR");
    const invalid = run("@SYSTEM_TITLE\nSETBIT CIRCULAR", jit,
      (game) => indexScript(game, "#DEFINE CIRCULAR CIRCULAR", "macros.erh", true));
    assert.equal(invalid.status, "error");
    assert.match(invalid.error!.message, /circular #DEFINE/);
  }
});

test("character CSVs allow arbitrary Chara names, skip empty templates and warn on malformed rows", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-history-loader-"));
  try {
    await mkdir(path.join(root, "CSV"));
    await mkdir(path.join(root, "ERB"));
    await writeFile(path.join(root, "ERB", "MAIN.ERB"), "@SYSTEM_TITLE\nADDCHARA 7\nPRINTFORML {NO:0} %NAME:0%\nQUIT");
    await writeFile(path.join(root, "CSV", "CharaABC.csv"),
      "NAME,Before\nNO,bad\n番号,7\nNAME,After\nNO,8\nUNKNOWN,1\n");
    await writeFile(path.join(root, "CSV", "Chara99.csv"), "; disabled character\n");
    await writeFile(path.join(root, "CSV", "CharaZZZ.csv"), "NO,7\nNAME,Duplicate\n");
    const game = await loadGame(root);
    assert.deepEqual([...game.characters.keys()], [7]);
    assert.equal(game.diagnostics.length, 5);
    assert.ok(game.diagnostics.some((d) => /before 番号/.test(d.message) && d.line === 1));
    assert.ok(game.diagnostics.some((d) => /Invalid character 番号/.test(d.message) && d.line === 2));
    assert.ok(game.diagnostics.some((d) => /Duplicate character 番号 row/.test(d.message) && d.line === 5));
    assert.ok(game.diagnostics.some((d) => /Unknown character CSV field/.test(d.message) && d.line === 6));
    assert.ok(game.diagnostics.some((d) => /Duplicate character number/.test(d.message)));
    const snapshot = new Runtime(game).start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), ["7 After"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("TRAIN honors COM_ABLE defaults, while explicit availability routines take precedence", () => {
  for (const jit of [false, true]) for (const defaultValue of ["0", "1"]) {
    const snapshot = run(`@SYSTEM_TITLE
ADDVOIDCHARA
BEGIN TRAIN
@SHOW_STATUS
RETURN
@COM_ABLE1
RETURN 1
@COM_ABLE2
RETURN 0
@SHOW_USERCOM
PRINTL DONE
QUIT`, jit, (game) => {
      game.tables.set("TRAIN", new Map([[0, ["Default"]], [1, ["Explicit"]], [2, ["Hidden"]]]));
      game.replacements.set("COM_ABLE初期値", defaultValue);
    });
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    const output = texts(snapshot).join("\n");
    assert.equal(output.includes("Default"), defaultValue === "1");
    assert.ok(output.includes("Explicit"));
    assert.ok(!output.includes("Hidden"));
  }
});

test("expression functions reject unsafe executed statements in interpreted and warmed JIT code", () => {
  for (const jit of [false, true]) for (const statement of [
    "CALL NORMAL", "TRYCALL MISSING", "CALLFORM NORMAL", "JUMP NORMAL", "RETURN 7", "QUIT",
    "BEGIN SHOP", "PRINTW not allowed", "PRINTDATAW\nDATA not allowed\nENDDATA", "WAIT", "INPUT",
    "TRYCALLLIST\nFUNC NORMAL\nENDFUNC", "OUTPUTLOG", "PRINTN unsafe", "PRINTFORMN unsafe",
    'PRINTFORMSN "unsafe"', "PRINTVN 1", 'PRINTSN "unsafe"',
  ]) {
    const snapshot = run(`@SYSTEM_TITLE
FOR A,0,5
LOCAL = FUN()
NEXT
QUIT
@FUN
#FUNCTION
IF A >= 4
${statement}
ENDIF
RETURNF 7
@NORMAL
RETURN 1`, jit);
    assert.equal(snapshot.status, "error", `${statement}: ${JSON.stringify(snapshot)}`);
    assert.match(snapshot.error!.message, /cannot be used in #FUNCTION/);
    assert.equal(snapshot.error!.file, "history.erb");
    assert.equal(snapshot.error!.line, 9);
  }
});

test("expression functions retain safe output, CALLF and assignment to a variable named VARS", () => {
  for (const jit of [false, true]) {
    const snapshot = run(`@SYSTEM_TITLE
FOR A,0,5
PRINTFORML {FUN()}
NEXT
QUIT
@FUN
#FUNCTION
#DIMS VARS
VARS = okay
CALLF OTHER()
PRINTFORM %VARS%
RETURNF 7
@OTHER
#FUNCTION
RETURNF 1`, jit);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), Array.from({ length: 5 }, () => ["okay", "7"]).flat());
  }
});

test("TRYLIST calls the first existing entry only, skips missing entries without evaluating arguments and can suspend", () => {
  for (const jit of [false, true]) {
    const game = emptyGame();
    indexScript(game, `@SYSTEM_TITLE
FOR A,0,5
CALL WRAPPER
NEXT
QUIT
@WRAPPER
CALL PROBE
RETURN
@PROBE
TRYCALLLIST
FUNC MISSING, 1/0
FUNC FOUND(7)
FUNC WRONG
ENDFUNC
PRINTFORML {RESULT}
RETURN
@FOUND(ARG)
INPUT
RETURN ARG
@WRONG
THROW "wrong entry"`, "trylist.erb");
    const runtime = new Runtime(game, 50_000, { jit });
    let snapshot = runtime.start();
    for (let i = 0; i < 5; i++) {
      assert.equal(snapshot.status, "waiting", JSON.stringify(snapshot.error));
      snapshot = runtime.input("1");
      assert.ok(texts(snapshot).includes("7"));
    }
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
  }
});

test("TRYLIST missing targets preserve RESULT, jumps unwind callers and gotos clear exited loop state", () => {
  for (const jit of [false, true]) {
    const snapshot = run(`@SYSTEM_TITLE
RESULT = 9
TRYCALLLIST
FUNC MISSING
ENDFUNC
PRINTFORML MISSING {RESULT}
CALL PROBE
PRINTFORML JUMP {RESULT}
QUIT
@PROBE
TRYJUMPLIST
FUNC MISSING
FUNC FOUND
ENDFUNC
THROW "jump returned to caller"
@FOUND
FOR LOCAL,0,5
TRYGOTOLIST
FUNC MISSING
FUNC EXIT
ENDFUNC
NEXT
$EXIT
RETURN 42`, jit);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), ["MISSING 9", "JUMP 42"]);
    for (const body of ["FUNC MISSING", "ENDFUNC", "TRYCALLLIST\nPRINTL bad\nENDFUNC", "TRYCALLLIST\nFUNC MISSING"]) {
      const invalid = run("@SYSTEM_TITLE\n" + body, jit);
      assert.equal(invalid.status, "error");
      assert.match(invalid.error!.message, /FUNC|TRYLIST|TRYCALLLIST/);
    }
  }
});

test("CALLEVENT dispatches event definitions in order and rejects ordinary routines", () => {
  for (const jit of [false, true]) {
    const snapshot = run(`@SYSTEM_TITLE
CALLEVENT EVENTEND
QUIT
@EVENTEND
PRINTL first
RETURN
@EVENTEND
PRINTL second
RETURN`, jit);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), ["first", "second"]);
    const invalid = run("@SYSTEM_TITLE\nCALLEVENT NORMAL\nQUIT\n@NORMAL\nRETURN", jit);
    assert.equal(invalid.status, "error");
    assert.match(invalid.error!.message, /not an event/);
    const game = emptyGame();
    indexScript(game, `@SYSTEM_TITLE
FOR A,0,5
CALL WRAPPER
NEXT
QUIT
@WRAPPER
CALLEVENT EVENTEND
RETURN
@EVENTEND
INPUT
RETURN`, "event-waits.erb");
    const runtime = new Runtime(game, 50_000, { jit });
    let waiting = runtime.start();
    for (let i = 0; i < 5; i++) {
      assert.equal(waiting.status, "waiting", JSON.stringify(waiting.error));
      waiting = runtime.input("1");
    }
    assert.equal(waiting.status, "halted", JSON.stringify(waiting.error));
  }
});

test("the GAMEBASE_GAMECODE alias shares storage and remains visible to reflection", () => {
  for (const jit of [false, true]) {
    const snapshot = run(`@SYSTEM_TITLE
FOR A,0,5
CALL PROBE
NEXT
QUIT
@PROBE
GAMEBASE_GAMECODE = 7
PRINTFORML {GAMEBASE_CODE} {EXISTVAR("GAMEBASE_GAMECODE")}
GAMEBASE_CODE = 9
PRINTFORML {GAMEBASE_GAMECODE}
ISDEFINED "FLAG"
PRINTFORML {RESULT}
RETURN`, jit);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), Array.from({ length: 5 }, () => ["7 1", "9", "0"]).flat());
  }
});
