import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { emptyGame, indexScript, loadGame, type Game } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";
import { MemorySaveStore } from "../src/storage.js";

function run(source: string, jit: boolean, game: Game = emptyGame()) {
  indexScript(game, source, "remaining.erb");
  return new Runtime(game, 50_000, { jit }).start();
}
const texts = (snapshot: ReturnType<Runtime["start"]>) =>
  snapshot.output.filter(line => line.type === "text").map(line => line.text);

test("SETANIMETIMER evaluates signed millisecond intervals and sets only RESULT:0", () => {
  for (const jit of [false, true]) {
    const snapshot = run(`@SYSTEM_TITLE
FOR A,0,45
CALL TIMER
NEXT
QUIT
@TIMER
RESULT = 913,914
SETANIMETIMER 50
PRINTFORML {RESULT} {RESULT:1}
SETANIMETIMER -1
PRINTFORML {RESULT}
SETANIMETIMER 0
RETURN`, jit);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.equal(snapshot.animationTimer, 0);
    assert.deepEqual(texts(snapshot), Array(45).fill(["1 914", "1"]).flat());
    for (const args of ["", "1,2", '"bad"'])
      assert.equal(run(`@SYSTEM_TITLE\nSETANIMETIMER ${args}`, jit).status, "error", args);
    assert.equal(run("@SYSTEM_TITLE\nWAIT", jit).animationTimer, null);
  }
});

test("browser animation timers throttle refreshes, stop while timed input is active, and disable cleanly", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("const animationClocks");
  const end = source.indexOf("const backgroundLayers", start);
  const context = { generation: 1, busy: false, input: { kind: "integer", timeout: undefined as number | undefined },
    requestAnimationFrame: () => 1, performance: { now: () => 0 } };
  const api = runInNewContext(`${source.slice(start, end)}
    ({ animate, tick: tickAnimations, interval(value) { animationInterval = value; } })`, context) as {
      animate: (name: string, holder: { isConnected: boolean }, layers: { hidden: boolean }[], delays: number[], token: number) => void;
      tick: (now: number) => void;
      interval: (value: number | undefined) => void;
    };
  const layers = [{ hidden: false }, { hidden: true }];
  api.animate("probe", { isConnected: true }, layers, [10, 10], 1);
  api.interval(50);
  api.tick(15);
  assert.equal(layers[1]!.hidden, false);
  api.tick(40);
  assert.equal(layers[1]!.hidden, false);
  api.tick(70);
  assert.equal(layers[0]!.hidden, false);
  context.input.timeout = 100;
  api.tick(135);
  assert.equal(layers[0]!.hidden, false);
  context.input.timeout = undefined;
  api.tick(155);
  assert.equal(layers[1]!.hidden, false);
  api.interval(0);
  api.tick(170);
  assert.equal(layers[1]!.hidden, false);
  api.interval(undefined);
  api.tick(180);
  assert.equal(layers[0]!.hidden, false);
});

test("portable remaining-history fixture matches native EE reflection, control flow and replacement modes", async () => {
  const [header, source] = await Promise.all([
    readFile(new URL("./fixtures/native-history-remaining.erh", import.meta.url), "utf8"),
    readFile(new URL("./fixtures/native-history-remaining.erb", import.meta.url), "utf8"),
  ]);
  for (const jit of [false, true]) {
    const game = emptyGame();
    game.variableSizes.set("CDFLAG", [2,3]);
    indexScript(game, header, "native-history-remaining.erh", true);
    const snapshot = run(source, jit, game);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), [
      "CDFLAG 2 3 42", "ENUMV 2 [ProbeGlobal] [ProbeWords]", "ENUMM 2 [ProbeOne] [ProbeTwo]",
      "CONSTANT_BRANCH", "DYNAMIC_BRANCH", "RESET 0 11", " 0+7=7", "CUP 7 0",
      "a-b-c", "a$1bsecondc", "a-b", "MODE 3", " 007", "-007", "zero", "TIMER 1",
      "DONE", "Log written to emuera.log",
    ]);
  }
});

test("native conditional gotos jump to labels and missing targets keep their first branch", () => {
  for (const jit of [false, true]) {
    const snapshot = run(`@SYSTEM_TITLE
FOR A,0,5
CALL PROBE
NEXT
QUIT
@PROBE
LOCAL = 0
TRYCGOTO MISSING
LOCAL += 1
CATCH
LOCAL = 100
ENDCATCH
TRYCGOTOFORM MISSING_{1}
LOCAL += 2
CATCH
LOCAL = 200
ENDCATCH
TRYCGOTO FOUND
LOCAL = 300
CATCH
LOCAL = 400
ENDCATCH
$FOUND
TRYCGOTOFORM FOUND_{2}
LOCAL = 500
CATCH
LOCAL = 600
ENDCATCH
$FOUND_2
PRINTFORML {LOCAL}
RETURN`, jit);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), Array(5).fill("3"));
  }
});

test("variable and macro enumerations preserve spelling, exclude private names and accept output arrays", () => {
  for (const jit of [false, true]) {
    const game = emptyGame();
    indexScript(game, "#DIM ProbeGlobal\n#DIMS ProbeWords\n#DEFINE ProbeOne 1\n#DEFINE ProbeTwo 2", "names.erh", true);
    const snapshot = run(`@SYSTEM_TITLE
#DIM ProbePrivate
#DIMS OUT,1
PRINTFORML {ENUMVARBEGINSWITH("probe")} [%RESULTS:0%] [%RESULTS:1%]
PRINTFORML {ENUMMACROBEGINSWITH("pRoBe")} [%RESULTS:0%] [%RESULTS:1%]
PRINTFORML {ENUMVARENDSWITH("Words")} [%RESULTS:0%]
PRINTFORML {ENUMMACROENDSWITH("Two")} [%RESULTS:0%]
PRINTFORML {ENUMVARWITH("Probe",OUT)} [%OUT%]
PRINTFORML {ENUMMACROWITH("Probe",OUT)} [%OUT%]
PRINTFORML {ENUMVARWITH("")} {ENUMMACROWITH("")}
QUIT`, jit, game);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), [
      "2 [ProbeGlobal] [ProbeWords]", "2 [ProbeOne] [ProbeTwo]", "1 [ProbeWords]", "1 [ProbeTwo]",
      "1 [ProbeGlobal]", "1 [ProbeOne]", "0 0",
    ]);
  }
});

test("CDFLAG uses per-axis CSV symbols and survives character operations and native save round trips", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-cdflag-"));
  try {
    await mkdir(path.join(root, "CSV"));
    await mkdir(path.join(root, "ERB"));
    await writeFile(path.join(root, "CSV/VariableSize.csv"), "CDFLAG,2,3");
    await writeFile(path.join(root, "CSV/CDFLAG1.csv"), "0,First\n1,Second");
    await writeFile(path.join(root, "CSV/CDFLAG2.csv"), "0,Left\n1,Middle\n2,Right");
    for (const jit of [false, true]) {
      const game = await loadGame(root);
      const snapshot = run(`@SYSTEM_TITLE
ADDVOIDCHARA
ADDVOIDCHARA
CDFLAG:0:Second:Right = 42
TARGET = 1
CDFLAG:1:First:Middle = 7
PRINTFORML {VARSIZE("CDFLAG",0)} {VARSIZE("CDFLAG",1)} {CDFLAG:0:1:2} {CDFLAG:1:0:1}
PRINTFORML NAMES %CDFLAGNAME1:Second% %CDFLAGNAME2:Right%
SWAPCHARA 0,1
SAVEDATA 1,"cdf"
VARSET CDFLAG
LOADDATA 1
QUIT
@SYSTEM_LOADEND
PRINTFORML SAVED {CDFLAG:0:0:1} {CDFLAG:1:1:2}
QUIT`, jit, game);
      assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
      assert.deepEqual(texts(snapshot), ["2 3 42 7", "NAMES Second Right", "SAVED 7 42"]);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("native two-dimensional character arrays require the character and both data indices, including warmed code", () => {
  for (const jit of [false, true]) {
    for (const reference of ["CDFLAG", "CDFLAG:0", "CDFLAG:0:0", "GRID", "GRID:0", "GRID:0:0"]) {
      const game = emptyGame();
      indexScript(game, "#DIM CHARADATA GRID,2,3", "grid.erh", true);
      const snapshot = run(`@SYSTEM_TITLE
ADDVOIDCHARA
FOR A,0,45
CALL PROBE
NEXT
QUIT
@PROBE
SIF A < 44
RETURN
${reference} = 7
RETURN`, jit, game);
      assert.equal(snapshot.status, "error", reference);
      assert.match(snapshot.error!.message, /Expected 3 indices/, reference);
    }
  }
});

test("CUPCHECK applies and clears only the selected character's CUP/CDOWN", () => {
  for (const jit of [false, true]) {
    const snapshot = run(`@SYSTEM_TITLE
ADDVOIDCHARA
ADDVOIDCHARA
CUP:0:1 = 7
CDOWN:0:1 = 2
CUP:1:1 = 9
UP:1 = 20
CUPCHECK 0
PRINTFORML {PALAM:0:1} {CUP:0:1} {CDOWN:0:1} {CUP:1:1} {UP:1}
QUIT`, jit);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), [" 0+7-2=5", "5 0 0 9 20"]);
    assert.match(run("@SYSTEM_TITLE\nCUPCHECK 0", jit).error?.message ?? "", /does not exist/);
  }
});

test("RESETGLOBAL clears built-ins, restores declared initializers and preserves active references", () => {
  for (const jit of [false, true]) {
    const game = emptyGame();
    indexScript(game, "#DIM GLOBAL UserCounter = 9\n#DIMS GLOBAL UserText = \"initial\"", "globals.erh", true);
    const snapshot = run(`@SYSTEM_TITLE
GLOBAL = 8
GLOBALS = text
UserCounter = 4
UserText = text
FLAG = 12
RESETGLOBAL
PRINTFORML {GLOBAL} [%GLOBALS%] {UserCounter} [%UserText%] {FLAG}
FOR A,0,45
UserCounter = 4
CALL RESTORE_GLOBAL(UserCounter)
NEXT
PRINTFORML {RESULT}
QUIT
@RESTORE_GLOBAL(Reference)
#DIM REF Reference
RESETGLOBAL
RETURN Reference`, jit, game);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), ["0 [] 9 [initial] 12", "9"]);
  }
});

test("SAVETEXT files enumerate and reload across case and Windows separators, including staged stores", () => {
  const saves = new MemorySaveStore();
  for (const jit of [false, true]) {
    const game = emptyGame();
    indexScript(game, `@SYSTEM_TITLE
PRINTW stage
LOCAL = SAVETEXT("hello","TXTDIR\\\\Entry.txt")
PRINTFORML {LOCAL} {ENUMFILES("txtdir/","*.TXT")} [%RESULTS:0%]
PRINTSL LOADTEXT(RESULTS:0)
PRINTSL LOADTEXT("txtdir/entry.TXT")
QUIT`, "files.erb");
    const runtime = new Runtime(game, undefined, { jit, saves });
    assert.equal(runtime.start().status, "waiting");
    assert.equal(runtime.prefetch(), true);
    const snapshot = runtime.input("");
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), ["1 1 [txtdir\\Entry.txt]", "hello", "hello"]);
  }
});

test("native REPLACE modes support literal replacements and one replacement array element per regex match", () => {
  for (const jit of [false, true]) {
    const snapshot = run(`@SYSTEM_TITLE
FOR A,0,5
CALL PROBE
NEXT
QUIT
@PROBE
#DIMS Replacements,2 = "$1","second"
PRINTSL REPLACE("a.b.c",".","-",2)
PRINTSL REPLACE("abc","","x",2)
PRINTSL REPLACE("a1b2c3","[0-9]",Replacements,1)
RETURN`, jit);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), Array.from({ length: 5 }, () => ["a-b-c", "abc", "a$1bsecondc"]).flat());
  }
});

test("native four-argument REPLACE reads its mode twice in the verified evaluation order", () => {
  for (const jit of [false, true]) {
    const snapshot = run(`@SYSTEM_TITLE
FOR A,0,45
CALL PROBE
NEXT
QUIT
@PROBE
RESULTS =
GLOBAL = 1
PRINTSL REPLACE(PROBE_SOURCE(),PROBE_PATTERN(),PROBE_REPLACEMENT(),PROBE_MODE())
PRINTFORML TRACE [%RESULTS%] {GLOBAL}
LOCAL = 1
PRINTSL REPLACE("a.b",".","-",LOCAL++)
PRINTFORML {LOCAL}
PRINTSL REPLACE("a.b",".","-",3)
PRINTSL REPLACE("a.b",".","-",-1)
RETURN
@PROBE_SOURCE
#FUNCTIONS
RESULTS += "S"
RETURNF "a.b"
@PROBE_PATTERN
#FUNCTIONS
RESULTS += "P"
RETURNF "."
@PROBE_REPLACEMENT
#FUNCTIONS
RESULTS += "R"
RETURNF "-"
@PROBE_MODE
#FUNCTION
RESULTS += "M"
GLOBAL += 1
RETURNF GLOBAL - 1`, jit);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), Array(45).fill(["a-b", "TRACE [MSMPR] 3", "a-b", "3", "---", "---"]).flat());
  }
});

test("focus color and displayed-line queries follow configuration and actual output", () => {
  for (const jit of [false, true]) {
    const game = emptyGame();
    game.config.set("選択中文字色", "1,2,3");
    const snapshot = run(`@SYSTEM_TITLE
PRINTL first
PRINTFORM second{2}
PRINTL
PRINTSL GETDISPLAYLINE(0)
PRINTSL GETDISPLAYLINE(1)
PRINTFORML {GETFOCUSCOLOR()} {STRLENS(GETLINESTR("ab")) == STRLENS(DRAWLINESTR)}
QUIT`, jit, game);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), ["first", "second2", "", "first", "second2", "66051 1"]);
  }
});

test("legacy SP commands are gated and match modern native EE's ordinary-character creation", () => {
  for (const jit of [false, true]) {
    const game = emptyGame();
    game.config.set("SPキャラを使用する", "YES");
    game.characters.set(1, { file: "Chara1.csv", rows: [["名前", "Example"]] });
    const snapshot = run("@SYSTEM_TITLE\nADDSPCHARA 1\nPRINTFORML {CHARANUM} {NO:0} {GETCHARA(1)} {GETSPCHARA(1)}\nQUIT", jit, game);
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(texts(snapshot), ["1 1 0 -1"]);
    assert.match(run("@SYSTEM_TITLE\nADDSPCHARA 1", jit).error?.message ?? "", /compatibility option/);
    assert.match(run("@SYSTEM_TITLE\nPRINTV GETSPCHARA(1)", jit).error?.message ?? "", /compatibility option/);
  }
});
