import assert from "node:assert/strict";
import { test } from "node:test";
import { DataTables } from "../src/data-tables.js";
import { emptyGame, indexScript } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";
import type { Value } from "../src/model.js";

test("data tables retain typed cells, stable IDs, nullable defaults and ordered selections", () => {
  const tables = new DataTables();
  const exec = (op: string, ...args: (Value | undefined)[]) => tables.execute(op, args).value;
  assert.equal(exec("DT_RELEASE", "t"), 1n);
  assert.equal(exec("DT_EXIST", "t"), 0n);
  assert.equal(exec("DT_CREATE", "t"), 1n);
  assert.equal(exec("DT_CREATE", "t"), 0n);
  assert.equal(exec("DT_COLUMN_ADD", "t", "label"), 1n);
  assert.equal(exec("DT_COLUMN_ADD", "t", "completed", "int16"), 1n);
  assert.equal(exec("DT_COLUMN_ADD", "t", "label"), 0n);
  assert.equal(exec("DT_COLUMN_LENGTH", "t"), 3n);
  const first = exec("DT_ROW_ADD", "t", "label", "O'Brien");
  const second = exec("DT_ROW_ADD", "t", "label", "O'Brien", "completed", 2n);
  assert.equal(typeof first, "bigint");
  assert.notEqual(first, second);
  assert.equal(exec("DT_ROW_LENGTH", "t"), 2n);
  assert.equal(exec("DT_CELL_GET", "t", 0n, "id"), first);
  assert.equal(exec("DT_CELL_GET", "t", 1n, "id"), second);
  assert.equal(exec("DT_CELL_GETS", "t", first, "label", 1n), "O'Brien");
  assert.equal(exec("DT_CELL_GET", "t", 0n, "completed"), 0n);
  assert.equal(exec("DT_CELL_ISNULL", "t", 0n, "completed"), 1n);
  assert.equal(exec("DT_CELL_GET", "t", second, "completed", 1n), 2n);
  assert.deepEqual(tables.execute("DT_SELECT", ["t", "label = 'O''Brien'"]), { value: 2n, selected: [first, second] });
  assert.deepEqual(tables.execute("DT_SELECT", ["t", "label = 'o''brien'"]), { value: 0n, selected: [] });
  assert.deepEqual(tables.execute("DT_SELECT", ["t", "completed = 2"]), { value: 1n, selected: [second] });
  assert.equal(exec("DT_CELL_SET", "t", first, "completed", -1n, 1n), 1n);
  assert.equal(exec("DT_CELL_GET", "t", 0n, "completed"), -1n);
  assert.equal(exec("DT_CELL_SET", "t", 0n, "completed"), 1n);
  assert.equal(exec("DT_CELL_ISNULL", "t", first, "completed", 1n), 1n);
  assert.equal(exec("DT_CLEAR", "t"), 1n);
  assert.equal(exec("DT_ROW_LENGTH", "t"), 0n);
  assert.notEqual(exec("DT_ROW_ADD", "t"), first);
  assert.equal(exec("DT_RELEASE", "t"), 1n);
  assert.equal(exec("DT_EXIST", "t"), 0n);
});

test("data-table schema validation is atomic and integer columns clamp like Emuera", () => {
  const tables = new DataTables();
  const exec = (op: string, ...args: (Value | undefined)[]) => tables.execute(op, args).value;
  exec("DT_CREATE", "t");
  exec("DT_COLUMN_ADD", "t", "small", 1n, 0n);
  exec("DT_COLUMN_ADD", "t", "medium", "int16");
  exec("DT_COLUMN_ADD", "t", "large", "int32");
  exec("DT_COLUMN_ADD", "t", "wide", "int64");
  exec("DT_COLUMN_ADD", "t", "label", 5n);
  assert.throws(() => exec("DT_COLUMN_ADD", "t", "bad", "float"), /Unsupported.*type/);
  for (const pairs of [
    ["label", "only"],
    ["small", 1n, "label", 42n],
    ["small", 1n, "missing", 42n],
    ["small", 1n, "id", 4n],
  ] satisfies Value[][]) {
    assert.throws(() => exec("DT_ROW_ADD", "t", ...pairs), /cannot be null|Expected|Unknown|Cannot assign/);
    assert.equal(exec("DT_ROW_LENGTH", "t"), 0n);
  }
  const id = exec("DT_ROW_ADD", "t", "small", 500n, "medium", -50000n, "large", 9999999999n, "wide", 9223372036854775807n);
  assert.equal(exec("DT_CELL_GET", "t", id, "small", 1n), 127n);
  assert.equal(exec("DT_CELL_GET", "t", id, "medium", 1n), -32768n);
  assert.equal(exec("DT_CELL_GET", "t", id, "large", 1n), 2147483647n);
  assert.equal(exec("DT_CELL_GET", "t", id, "wide", 1n), 9223372036854775807n);
  assert.deepEqual(tables.execute("DT_SELECT", ["t", "small = 500"]), { value: 0n, selected: [] });
  assert.throws(() => exec("DT_CELL_SET", "t", 0n, "small"), /cannot be null/);
  assert.equal(exec("DT_CELL_SET", "t", 0n, "small", "invalid"), -2n);
  assert.equal(exec("DT_CELL_GET", "t", 0n, "small"), 127n);
  assert.equal(exec("DT_CELL_SET", "t", 0n, "id", 42n), 0n);
  assert.equal(exec("DT_CELL_GET", "t", 0n, "id"), id);
  assert.throws(() => exec("DT_SELECT", "t", "small > 1"), /Unsupported DT_SELECT filter/);
  assert.throws(() => exec("DT_SELECT", "t", "missing = 1"), /Unknown.*column/);
  assert.throws(() => exec("DT_SELECT", "t", "", "label DESC"), /Unsupported arguments/);
  assert.equal(exec("DT_ROW_LENGTH", "absent"), -1n);
  assert.equal(exec("DT_CELL_GET", "absent", 0n, "x"), 0n);
  assert.equal(exec("DT_CELL_GETS", "absent", 0n, "x"), "");
  assert.equal(exec("DT_CELL_ISNULL", "absent", 0n, "x"), -1n);
  assert.equal(exec("DT_CELL_ISNULL", "t", -1n, "small"), -2n);
  assert.equal(exec("DT_CELL_SET", "t", 100n, "small", 0n), -3n);
});

test("DT commands and expressions share storage and selection RESULT shape, without sharing sessions", () => {
  const game = emptyGame();
  indexScript(game, `@SYSTEM_TITLE
DT_CREATE "t"
DT_COLUMN_ADD "t", "label"
DT_COLUMN_ADD "t", "done", "int16"
DT_ROW_ADD "t", "label", "a", "done", 1,
A = RESULT
B = DT_ROW_ADD("t", "label", "a")
DT_SELECT "t", "label = 'a'"
PRINTFORML {RESULT} {RESULT:1 == A} {RESULT:2 == B}
SIF DT_SELECT("t", "done = 1")
  DT_CELL_SET "t", RESULT:1, "done", 2, 1
PRINTFORML {RESULT} {DT_CELL_GET("t", A, "done", 1)} %DT_CELL_GETS("t", 1, "label")%
DT_SELECT "t", "done = 99"
PRINTFORML {RESULT}
INPUT
PRINTFORML {DT_ROW_LENGTH("t")}
RETURN
@ISOLATED
PRINTFORML {DT_EXIST("t")}`, "tables.ERB");
  const runtime = new Runtime(game);
  const snapshot = runtime.start();
  assert.equal(snapshot.status, "waiting", JSON.stringify(snapshot.error));
  assert.deepEqual(snapshot.output.filter((item) => item.type === "text").map((item) => item.text), ["2 1 1", "1 2 a", "0"]);
  const isolated = new Runtime(game).start("ISOLATED");
  assert.equal(isolated.status, "halted", JSON.stringify(isolated.error));
  assert.deepEqual(isolated.output.filter((item) => item.type === "text").map((item) => item.text), ["0"]);
  const resumed = runtime.input("0");
  assert.equal(resumed.status, "halted", JSON.stringify(resumed.error));
  assert.equal(resumed.output.at(-1)?.type === "text" && resumed.output.at(-1)?.text, "2");
});
