import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { compatibility } from "../src/compatibility.js";
import { emptyGame, indexScript } from "../src/loader.js";
import { Runtime, type Snapshot } from "../src/runtime.js";
import { createApp } from "../src/server.js";

function runtime(source: string, jit = true) {
  const game = emptyGame();
  indexScript(game, source, "megaten.ERB");
  assert.deepEqual(compatibility(game).gaps, []);
  return new Runtime(game, 50_000, { jit });
}
function printed(snapshot: Snapshot) {
  assert.equal(snapshot.error, null);
  return snapshot.output.filter((item) => item.type === "text").map((item) => item.text).join("\n");
}

test("MATCHALL returns exact matching indices, ranges, empty results and the Megaten minimum-rate selection", () => {
  for (const jit of [false, true]) {
    const result = runtime(`@SYSTEM_TITLE
#DIM RATES, 6
#DIMS WORDS, 4
RATES:0 = 30
RATES:1 = 10
RATES:2 = 10
RATES:3 = 20
RESULT:4 = 99
FOR LOCAL, 0, 4
CALL SCAN(RATES)
NEXT
WORDS:0 '= "cat"
WORDS:1 '= "cats"
WORDS:2 '= "cat"
MATCHALL WORDS, "cat"
PRINTFORML {RESULT} {RESULT:1} {RESULT:2}
MATCHALL RATES, 10, 2, 4
PRINTFORML {RESULT} {RESULT:1}
MATCHALL RATES, 10, 2, 2
PRINTFORML {RESULT} {RESULT:1}
MATCHALL RATES, 999
PRINTFORML {RESULT} {RESULT:4}
RETURN
@SCAN(RATES)
#DIM REF RATES, 0
MATCHALL RATES, MINARRAY(RATES, 0, 4)
PRINTFORML {RESULT} {RESULT:1} {RESULT:2}`).start();
    assert.equal(printed(result), Array(4).fill("2 1 2").join("\n") + "\n2 0 2\n1 2\n0 2\n0 99");
  }
});

test("MATCHALL counts beyond RESULT capacity and scans numeric and string character variables", () => {
  for (const jit of [false, true]) {
    const report = runtime(`@SYSTEM_TITLE
#DIM VALUES, 1100
VARSET VALUES, 7
MATCHALL VALUES, 7
PRINTFORML {RESULT} {RESULT:1} {RESULT:(VARSIZE("RESULT")-1)}
ADDVOIDCHARA
ADDVOIDCHARA
ADDVOIDCHARA
CFLAG:0:4 = 8
CFLAG:2:4 = 8
NAME:0 '= "same"
NAME:2 '= "same"
MATCHALL CFLAG, 2 + 2, 8
PRINTFORML {RESULT} {RESULT:1} {RESULT:2}
MATCHALL NAME, "same", 1, 3
PRINTFORML {RESULT} {RESULT:1}`).start();
    assert.equal(printed(report), "1100 0 998\n2 0 2\n1 2");
  }
});

test("MATCHALL rejects malformed arguments, mismatched types, dimensions and invalid ranges", () => {
  for (const args of ["", "1, 2", "VALUES", 'VALUES, "bad"', "VALUES, 1, -1", "VALUES, 1, 3, 2",
    "VALUES, 1, 0, 5", "VALUES, 1, 0, 1, 2", "GRID, 1", "CFLAG, LOCAL, 1", "CFLAG, 999999, 1"]) {
    const report = runtime(`@SYSTEM_TITLE\n#DIM VALUES, 4\n#DIM GRID, 2, 2\nMATCHALL ${args}`).start();
    assert.equal(report.status, "error", args);
    assert.match(report.error!.message, /MATCHALL/);
  }
});

test("HTML islands accumulate by layer, stay outside print history, survive input and clear independently", () => {
  for (const jit of [false, true]) {
    const run = runtime(`@SYSTEM_TITLE
FOR LOCAL, 0, 4
CALL OVERLAY
NEXT
PRINT prefix
HTML_PRINT_ISLAND "<b>default</b>"
PRINTL suffix
PRINTFORML {LINECOUNT}
BINPUTS
HTML_PRINT_ISLAND_CLEAR 2
CLEARLINE 1
BINPUTS
HTML_PRINT_ISLAND_CLEAR
PRINTL done
RETURN
@OVERLAY
HTML_PRINT_ISLAND "<button value='upper'>Upper</button>", 2
HTML_PRINT_ISLAND "<button value='lower'>Lower</button>", 1`);
    const first = run.start();
    assert.equal(first.status, "waiting", JSON.stringify(first.error));
    assert.equal(first.islands!.length, 9);
    assert.equal(first.output.filter((item) => item.type === "html").length, 0);
    assert.deepEqual(first.input!.buttonValues, ["upper", "lower"]);
    assert.equal(printed(first), "prefix\nsuffix\n1");
    const second = run.input("upper");
    assert.deepEqual(second.islands!.map((item) => item.layer), [1, 1, 1, 1, 0]);
    assert.deepEqual(second.input!.buttonValues, ["lower"]);
    assert.equal(first.islands!.length, 9, "earlier snapshots are immutable");
    const last = run.input("lower");
    assert.equal(last.status, "halted");
    assert.deepEqual(last.islands, []);
  }
});

test("islands support formatted HTML, dynamic sprites, restart, empty output and explicit argument errors", () => {
  const run = runtime(`@SYSTEM_TITLE
GCREATE 1, 4, 4
SPRITECREATE "ICON", 1
HTML_PRINT_ISLAND "<img src='ICON'>", 5
HTML_PRINT_ISLAND @"<b>{7}</b>", -3
HTML_PRINT_ISLAND ""
WAIT
GCLEAR 1, 0xFFFF0000
WAIT
HTML_PRINT_ISLAND_CLEAR
WAIT`);
  const first = run.start();
  assert.deepEqual(first.islands!.map((item) => [item.text, item.layer]), [["<img src='ICON'>", 5], ["<b>7</b>", -3]]);
  assert.equal(first.islands![0]!.sprites!.ICON!.width, 4);
  const second = run.input("");
  assert.notDeepEqual(second.islands![0]!.sprites!.ICON!.picture, first.islands![0]!.sprites!.ICON!.picture);
  assert.deepEqual(run.input("").islands, []);
  for (const command of ['HTML_PRINT_ISLAND', 'HTML_PRINT_ISLAND 1', 'HTML_PRINT_ISLAND "x", "layer"',
    'HTML_PRINT_ISLAND "x", 1, 2', 'HTML_PRINT_ISLAND_CLEAR 1, 2']) {
    const result = runtime(`@SYSTEM_TITLE\n${command}`).start();
    assert.equal(result.status, "error", command);
  }
  const restart = runtime(`@SYSTEM_TITLE
HTML_PRINT_ISLAND "old"
WAIT
QUIT_AND_RESTART`);
  assert.equal(restart.start().islands!.length, 1);
  assert.equal(restart.input("").islands!.length, 1, "restart clears old overlays before printing the new title");
});

test("server resume retains current islands independently of output history and records clears", async () => {
  const game = emptyGame();
  indexScript(game, `@SYSTEM_TITLE
HTML_PRINT_ISLAND "<button value='7'>Overlay</button>", 99
WAIT
WAIT
HTML_PRINT_ISLAND_CLEAR
WAIT`, "islands.ERB");
  const app = createApp([{ id: "islands", title: "Islands", root: "", load: async () => game }]);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  try {
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    const post = async (route: string, data: object) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const start = await post("/api/start", { mode: "game", game: "islands" });
    const unchanged = await post("/api/input", { session: start.session, value: "", step: start.step });
    assert.equal(unchanged.islands, undefined);
    const resumed = await post("/api/resume", { session: start.session });
    assert.deepEqual(resumed.islands, start.islands);
    const cleared = await post("/api/input", { session: start.session, value: "", step: unchanged.step });
    assert.deepEqual(cleared.islands, []);
    assert.deepEqual((await post("/api/resume", { session: start.session })).islands, []);
  } finally {
    app.closeAllConnections();
    await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
  }
});
