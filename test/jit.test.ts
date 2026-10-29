import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { emptyGame, GAME_ROOT, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type Snapshot } from "../src/runtime.js";

function text(snapshot: Snapshot): string[] {
  return snapshot.output.filter((item) => item.type === "text" || item.type === "html").map((item) => item.text);
}
function both(source: string, entry?: string): [Snapshot, Snapshot, Runtime] {
  const game = emptyGame();
  indexScript(game, source, "test.ERB");
  const compiled = new Runtime(game, undefined, { jit: true });
  const interpreted = new Runtime(game, undefined, { jit: false });
  return [compiled.start(entry), interpreted.start(entry), compiled];
}

const PROGRAM = `@SYSTEM_TITLE
#DIM RESULTS_SEEN
REPEAT 4
  CALL LOOPS(COUNT)
  CALL SELECTS(COUNT * 7 - 3)
  CALL STRINGS(COUNT, "x" + TOSTR(COUNT))
  LOCAL = 0
  CALL REFS(LOCAL)
  PRINTFORML ref={LOCAL} fn={DOUBLE(COUNT)} s=%PAD(COUNT)%
  CALL JUMPS(COUNT)
  TRYCCALL MISSING_ROUTINE
  CATCH
    PRINTL caught
  ENDCATCH
  TRYCALLFORM ECHO_{COUNT % 2}
  PRINTFORML r={RESULT} rs=%RESULTS%
REND
CALL FAULT
QUIT

@LOOPS(LOOP_COUNT)
#DIM LOOP_COUNT
#DIM TOTAL
TOTAL = 0
FOR LOCAL, 0, 10
  SIF LOCAL == LOOP_COUNT
    CONTINUE
  SIF LOCAL > 6
    BREAK
  TOTAL += LOCAL
NEXT
FOR LOCAL:1, 10, 0, -3
  TOTAL += LOCAL:1 * 100
NEXT
LOCAL = 0
WHILE LOCAL < LOOP_COUNT + 2
  LOCAL ++
  TOTAL = TOTAL * 3 % 1000
WEND
DO
  LOCAL --
LOOP LOCAL > 0
VARSET LOCAL:5, 9
SWAP TOTAL, LOCAL:5
SETBIT TOTAL, 4
PRINTFORML loops {LOOP_COUNT} {TOTAL} {LOCAL:5} {LOCAL:1} {COUNT}

@SELECTS(VALUE)
#DIM VALUE
SELECTCASE VALUE
  CASE 0 TO 5
    PRINTFORML low {VALUE}
  CASE 11, 12
    PRINTFORML pair {VALUE}
  CASE IS >= 20
    PRINTFORML big {VALUE}
  CASEELSE
    PRINTFORML else {VALUE}
ENDSELECT
IF VALUE < 0
  PRINTL negative
ELSEIF VALUE == 4 || VALUE == 11
  PRINTL four-or-eleven
ELSE
  PRINTFORML {VALUE / 2} {VALUE % 3} {VALUE * VALUE} {VALUE << 2} {VALUE & 6} {!VALUE} {VALUE > 3 ? 1 # 2}
ENDIF

@STRINGS(COUNT_VALUE, TEXT_VALUE)
#DIM COUNT_VALUE
#DIMS TEXT_VALUE
#DIMS ACC
ACC = %TEXT_VALUE%-
FOR LOCAL, 0, COUNT_VALUE
  ACC += TOSTR(LOCAL)
NEXT
ACC = %ACC% * {COUNT_VALUE}
PRINTFORML %ACC% {STRLENS(ACC)} %TEXT_VALUE * 2% {TEXT_VALUE == "x2"} {TEXT_VALUE != "x3"}
LOCALS:2 = %TEXT_VALUE%
LOCALS:2 += "!"
PRINTFORML %LOCALS:2%

@REFS(REFERENCE)
#DIM REF REFERENCE
REFERENCE += 5
REFERENCE *= 3

@DOUBLE(NUMBER)
#FUNCTION
#DIM NUMBER
RETURNF NUMBER * 2

@PAD(NUMBER)
#FUNCTIONS
#DIM NUMBER
RETURNF "[" + TOSTR(NUMBER, "00") + "]"

@JUMPS(NUMBER)
#DIM NUMBER
SIF NUMBER == 2
  GOTO SKIP
PRINTFORML before {NUMBER}
$SKIP
PRINTFORML after {NUMBER}
SIF NUMBER == 3
  RETURN 7

@ECHO_0
RETURN 10, 20

@ECHO_1
RESULTS = echo
RETURN 11

@FAULT
#DIM DIVISOR
DIVISOR = 0
PRINTFORML {10 / DIVISOR}
`;

test("compiled routines produce the interpreter's output, results and errors", () => {
  const [compiled, interpreted, runtime] = both(PROGRAM);
  assert.deepEqual(text(compiled), text(interpreted));
  assert.equal(compiled.status, interpreted.status);
  assert.equal(compiled.status, "error");
  assert.deepEqual(compiled.error, interpreted.error);
  assert.ok(text(compiled).includes("caught"));
  const stats = (runtime as unknown as { jit: { compiledCount: number; errors: unknown[]; rejected: number } }).jit;
  assert.ok(stats.compiledCount >= 6, `compiled ${stats.compiledCount}`);
  assert.equal(stats.errors.length, 0);
});

test("compiled game flow matches the interpreter", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = await loadGame();
  const runs = [true, false].map((jit) => {
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit });
    (runtime as unknown as { randomState: bigint }).randomState = 0x123456789abcdefn;
    const snapshots = [runtime.start()];
    for (const input of ["0", "0", "0", "0", "0", "0"]) {
      if (snapshots.at(-1)!.status !== "waiting") break;
      snapshots.push(runtime.input(input));
    }
    return snapshots.map((snapshot) => ({ status: snapshot.status, error: snapshot.error, text: text(snapshot) }));
  });
  assert.deepEqual(runs[0], runs[1]);
});

const SUSPENDING = `@SYSTEM_TITLE
REPEAT 3
  CALL OUTER(COUNT)
  CALLFORM ASK_{COUNT % 2}
  PRINTFORML got={RESULT}
  SKIPDISP 1
  CALL QUIET(COUNT)
  SKIPDISP 0
REND
QUIT

@OUTER(COUNT_VALUE)
#DIM COUNT_VALUE
PRINTFORML outer {COUNT_VALUE}
CALL MIDDLE(COUNT_VALUE)
PRINTFORML outer done {COUNT_VALUE}

@MIDDLE(COUNT_VALUE)
#DIM COUNT_VALUE
PRINTFORMW middle {COUNT_VALUE}
CALL LEAF(COUNT_VALUE)

@LEAF(COUNT_VALUE)
#DIM COUNT_VALUE
PRINTFORML leaf {COUNT_VALUE * 10}

@ASK_0
INPUT
RETURN RESULT + 100

@ASK_1
INPUT
RETURN RESULT + 200

@QUIET(COUNT_VALUE)
#DIM COUNT_VALUE
PRINTFORMW quiet {COUNT_VALUE}
WAIT
`;

test("compiled callers suspend for input in nested and FORM-called routines", () => {
  const game = emptyGame();
  indexScript(game, SUSPENDING, "test.ERB");
  let compiledCount = 0;
  const runs = [true, false].map((jit) => {
    const runtime = new Runtime(game, undefined, { jit });
    const snapshots = [runtime.start()];
    for (let i = 0; i < 20 && snapshots.at(-1)!.status === "waiting"; i++) snapshots.push(runtime.input(String(i)));
    if (jit) compiledCount = (runtime as unknown as { jit: { compiledCount: number } }).jit.compiledCount;
    return snapshots.map((snapshot) => ({ status: snapshot.status, error: snapshot.error, text: text(snapshot) }));
  });
  assert.deepEqual(runs[0], runs[1]);
  assert.equal(runs[0].at(-1)!.status, "halted");
  assert.ok(compiledCount >= 3, `compiled ${compiledCount}`);
  assert.ok(runs[0].length > 6, `waits ${runs[0].length}`);
});
