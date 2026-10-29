import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { DataTables } from "../src/data-tables.js";
import { compatibility } from "../src/compatibility.js";
import { emptyGame, indexScript } from "../src/loader.js";
import { Runtime, type Snapshot } from "../src/runtime.js";

function runtime(source: string, jit = false) {
  const game = emptyGame();
  indexScript(game, source, "input-table.ERB");
  assert.deepEqual(compatibility(game).gaps, []);
  return new Runtime(game, 100_000, { jit });
}
function texts(snapshot: Snapshot): string[] {
  assert.notEqual(snapshot.status, "error", JSON.stringify(snapshot.error));
  return snapshot.output.flatMap((item) => "text" in item ? [item.text] : []);
}

test("ONEBINPUT and ONEBINPUTS suspend warmed routines and restrict one-character answers to live buttons", () => {
  for (const jit of [false, true]) {
    const r = runtime(`@SYSTEM_TITLE
FOR A, 0, 45
  CALL ASK
NEXT
RETURN
@ASK
PRINTL [7] seven
PRINTBUTTON "letter", "x"
ONEBINPUT
PRINTFORML numeric={RESULT}
PRINTBUTTON "letter", "x"
ONEBINPUTS
PRINTFORML string=%RESULTS%
RETURN`, jit);
    let snapshot = r.start();
    for (let i = 0; i < 45; i++) {
      assert.equal(snapshot.status, "waiting");
      assert.deepEqual(snapshot.input, { kind: "integer", singleCharacter: true, buttonValues: ["7"] });
      assert.throws(() => r.input("8"), /displayed button/);
      assert.throws(() => r.input(""), /whole number/);
      snapshot = r.input("79");
      assert.ok(texts(snapshot).includes("numeric=7"));
      assert.deepEqual(snapshot.input, { kind: "string", singleCharacter: true, buttonValues: ["x"] });
      assert.throws(() => r.input("y"), /displayed button/);
      snapshot = r.input("xyz");
      assert.ok(texts(snapshot).includes("string=x"));
    }
    assert.equal(snapshot.status, "halted");
  }
});

test("ONEBINPUT defaults are full values without buttons; ONEBINPUTS defaults are FORM text", () => {
  for (const jit of [false, true]) {
    const snapshot = runtime(`@SYSTEM_TITLE
ONEBINPUT -27
PRINTFORML numeric={RESULT}
ONEBINPUTS % "words" %
PRINTFORML string=[%RESULTS%]
ONEBINPUTS "quoted"
PRINTFORML literal=[%RESULTS%]
PRINTL [2] removed
CLEARLINE 1
ONEBINPUT 85
PRINTFORML cleared={RESULT}`, jit).start();
    assert.deepEqual(texts(snapshot).filter((value) => /^(numeric|string|literal|cleared)=/.test(value)),
      ["numeric=-27", "string=[words]", 'literal=["quoted"]', "cleared=85"]);
    assert.equal(runtime("@SYSTEM_TITLE\nONEBINPUT", jit).start().status, "error");
    assert.equal(runtime("@SYSTEM_TITLE\nONEBINPUTS", jit).start().status, "error");
    assert.match(runtime("@SYSTEM_TITLE\nONEBINPUT 1, 1", jit).start().error!.message, /side-channel/);
  }
});

test("empty ONEBINPUT answers use the default without truncating it but still validate button membership", () => {
  for (const jit of [false, true]) {
    const r = runtime(`@SYSTEM_TITLE
PRINTL [27] twenty-seven
ONEBINPUT 27
PRINTFORML {RESULT}
PRINTBUTTON "word", "word"
ONEBINPUTS word
PRINTSL RESULTS`, jit);
    assert.equal(r.start().input?.defaultValue, "27");
    const next = r.input("");
    assert.ok(texts(next).includes("27"));
    assert.equal(next.input?.defaultValue, "word");
    assert.deepEqual(texts(r.input("")), ["word", "word"]);
  }
});

test("button input canSkip uses full defaults during message skipping, without requiring matching buttons", () => {
  for (const jit of [false, true]) {
    const snapshot = runtime(`@SYSTEM_TITLE
SKIPLOG 1
PRINTL [7] displayed
ONEBINPUT 27, 0, 1
PRINTFORML {RESULT}
ONEBINPUTS words, 0, 1
PRINTSL RESULTS`, jit).start();
    assert.deepEqual(texts(snapshot), ["[7] displayed", "27", "words"]);
    assert.equal(snapshot.status, "halted");
  }
});

test("timed input defaults apply on timeout, not empty submissions while the timer is running", () => {
  for (const jit of [false, true]) {
    const r = runtime(`@SYSTEM_TITLE
TINPUT 5000, 77, 0, ""
PRINTFORML {RESULT}
TINPUTS 5000, "word", 0, ""
PRINTFORML [%RESULTS%]
TINPUT 0, 88, 0, ""
PRINTFORML {RESULT}
TONEINPUT 0, -42, 0, ""
PRINTFORML {RESULT}`, jit);
    assert.equal(r.start().input?.defaultValue, undefined);
    assert.throws(() => r.input(""), /whole number/);
    let snapshot = r.timeout();
    assert.ok(texts(snapshot).includes("77"));
    snapshot = r.input("");
    assert.ok(texts(snapshot).includes("[]"));
    assert.equal(snapshot.input?.defaultValue, "88");
    snapshot = r.input("");
    assert.ok(texts(snapshot).includes("88"));
    assert.equal(snapshot.input?.defaultValue, "-42");
    assert.ok(texts(r.input("")).includes("-42"));
  }
});

test("CLEARTEXTBOX synchronizes the input field, preserves RESULT, and rejects arguments", () => {
  for (const jit of [false, true]) {
    const r = runtime(`@SYSTEM_TITLE
SETTEXTBOX "draft"
RESULT = 913
CLEARTEXTBOX
PRINTFORML [%GETTEXTBOX()%] {RESULT}
WAIT
SETTEXTBOX "later"
WAIT
CLEARTEXTBOX
WAIT`, jit);
    let snapshot = r.start();
    assert.equal(snapshot.textbox, "");
    assert.deepEqual(texts(snapshot), ["[] 913"]);
    snapshot = r.input("");
    assert.equal(snapshot.textbox, "later");
    snapshot = r.input("");
    assert.equal(snapshot.textbox, "");
    assert.equal(runtime("@SYSTEM_TITLE\nCLEARTEXTBOX 1", jit).start().status, "error");
  }
});

test("DT_NOCASE toggles comparison filters per table, separates filter caches, and survives XML export", () => {
  const tables = new DataTables();
  tables.execute("DT_CREATE", ["a"]);
  tables.execute("DT_CREATE", ["b"]);
  for (const name of ["a", "b"]) {
    tables.execute("DT_COLUMN_ADD", [name, "label"]);
    tables.execute("DT_ROW_ADD", [name, "label", "A"]);
    tables.execute("DT_ROW_ADD", [name, "label", "a"]);
  }
  const select = (name: string) => tables.execute("DT_SELECT", [name, "label = 'a'"]).value;
  assert.equal(select("a"), 1n);
  assert.equal(tables.execute("DT_NOCASE", ["absent", 1n]).value, -1n);
  for (const ignore of [1n, -5n, 0n, 1n, 0n]) {
    assert.equal(tables.execute("DT_NOCASE", ["a", ignore]).value, 1n);
    assert.equal(select("a"), ignore ? 2n : 1n);
    assert.equal(tables.execute("DT_SELECT", ["a", "label LIKE 'a%'"]).value, ignore ? 2n : 1n);
    assert.equal(tables.execute("DT_SELECT", ["a", "label IN ('a')"]).value, ignore ? 2n : 1n);
    assert.equal(select("b"), 1n);
    tables.import("copy", tables.export("a")!);
    assert.equal(select("copy"), select("a"));
  }
  assert.throws(() => tables.execute("DT_NOCASE", ["a"]), /Unsupported arguments/);
  assert.throws(() => tables.execute("DT_NOCASE", ["a", "wrong"]), /integer/);
});

test("DT_NOCASE works as statement and expression in warmed execution without overwriting expression RESULT", () => {
  for (const jit of [false, true]) {
    const snapshot = runtime(`@SYSTEM_TITLE
DT_CREATE "db"
DT_COLUMN_ADD "db", "label"
DT_ROW_ADD "db", "label", "Mixed"
FOR A, 0, 45
  CALL QUERY
NEXT
RETURN
@QUERY
DT_NOCASE "db", 0
PRINTFORML {RESULT} {DT_SELECT("db", "label = 'mixed'")}
RESULT = 913
LOCAL = DT_NOCASE("db", -1)
PRINTFORML {LOCAL} {RESULT} {DT_SELECT("db", "label = 'mixed'")}
RETURN`, jit).start();
    assert.deepEqual(texts(snapshot), Array.from({ length: 45 }, () => ["1 0", "1 913 1"]).flat());
  }
});

test("TOOLTIP_IMG supplies live graphics only for custom image tooltips and resets explicitly", () => {
  for (const jit of [false, true]) {
    const r = runtime(`@SYSTEM_TITLE
GCREATE 12, 3, 2
GSETBRUSH 12, 0xFFFF0000
GFILLRECTANGLE 12, 0, 0, 3, 2
RESULT = 913
TOOLTIP_IMG -1
TOOLTIP_CUSTOM 1
PRINTFORML preserved={RESULT}
HTML_PRINT "<nonbutton title='12'>picture</nonbutton>"
WAIT
GDISPOSE 12
WAIT
TOOLTIP_IMG 0
PRINTFORML {RESULT}
WAIT`, jit);
    let snapshot = r.start();
    assert.ok(texts(snapshot).includes("preserved=913"));
    assert.equal(snapshot.tooltip?.image, true);
    assert.deepEqual(Object.keys(snapshot.tooltip?.pictures ?? {}), ["12"]);
    assert.equal(snapshot.tooltip?.pictures?.["12"]?.width, 3);
    snapshot = r.input("");
    assert.deepEqual(snapshot.tooltip?.pictures, {});
    snapshot = r.input("");
    assert.equal(snapshot.tooltip?.image, false);
    assert.equal(snapshot.tooltip?.pictures, undefined);
    assert.equal(runtime("@SYSTEM_TITLE\nTOOLTIP_IMG", jit).start().status, "error");
    assert.equal(runtime('@SYSTEM_TITLE\nTOOLTIP_IMG "bad"', jit).start().status, "error");
  }
});

test("image tooltip UI paints a graphics canvas while missing IDs and ordinary titles remain text", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("function describe(");
  const end = source.indexOf('\ndocument.addEventListener("keydown"', start);
  for (const [description, custom, image, expectedImage] of [
    [" +12 ", true, true, true], ["12", false, true, false],
    ["12", true, false, false], ["99", true, true, false], ["hello<br>world", true, true, false],
  ] as const) {
    const handlers = new Map<string, () => Promise<void>>();
    const canvas = { getContext: () => ({ drawImage() {} }) };
    const tooltip = {
      textContent: "", hidden: true, id: "tooltip", style: {}, popover: false,
      getBoundingClientRect: () => ({ width: 3, height: 2 }), child: null as unknown,
      replaceChildren(child: unknown) { this.child = child; },
    };
    const scope = {
      busy: false, tooltipTarget: null as unknown, tooltip, tooltipDuration: undefined,
      tooltipSettings: { custom, image, duration: 0, pictures: { 12: { width: 3, height: 2 } } },
      hideTooltip() { scope.tooltipTarget = null; tooltip.textContent = ""; },
      translation: { text: (value: string) => value }, paintPicture: async () => ({}), newCanvas: () => canvas,
      visibleBox: () => ({ left: 0, bottom: 1 }), innerWidth: 100, innerHeight: 100,
    };
    const describe = runInNewContext(`${source.slice(start, end)}\ndescribe`, scope);
    describe({
      classList: { add() {} }, dataset: {}, matches: () => false,
      closest: (selector: string) => selector.includes(".screen.is-active") ? {} : null,
      addEventListener(name: string, handler: () => Promise<void>) { handlers.set(name, handler); },
      setAttribute() {},
    }, description);
    await handlers.get("focus")!();
    assert.equal(tooltip.hidden, false);
    assert.equal(tooltip.child === canvas, expectedImage);
    if (!expectedImage) assert.equal(tooltip.textContent, description.replaceAll("<br>", "\n"));
  }
});
