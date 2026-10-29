import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { emptyGame, GAME_ROOT, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type Snapshot } from "../src/runtime.js";
import { MemoryGlobalStore, MemorySaveStore } from "../src/storage.js";

function text(snapshot: Snapshot): string[] {
  return snapshot.output.filter((item) => item.type === "text" || item.type === "html").map((item) => item.text);
}

const PROGRAM = `@SYSTEM_TITLE
GLOBAL = 7
PRINTW first
SAVEGLOBAL
SAVEDATA 3, "memo"
CHKDATA 3
PRINTFORML saved {RESULT}
WAIT
GLOBAL = 9
PRINTW second
INPUT
PRINTFORML got {RESULT}
WAIT
PRINTL third
WAIT
THROW boom
`;

function run(prefetch: boolean) {
  const game = emptyGame();
  indexScript(game, PROGRAM, "test.ERB");
  const saves = new MemorySaveStore(), store = new MemoryGlobalStore();
  const runtime = new Runtime(game, undefined, { saves, store });
  const snapshots = [runtime.start()];
  for (const value of ["", "", "", "42", "", ""]) {
    if (snapshots.at(-1)!.status !== "waiting") break;
    if (prefetch) runtime.prefetch();
    snapshots.push(runtime.input(value));
  }
  return { snapshots: snapshots.map((snapshot) => ({ status: snapshot.status, error: snapshot.error, text: text(snapshot), input: snapshot.input })), saves, store };
}

test("running ahead of click-to-continue waits gives the same results", () => {
  const plain = run(false), ahead = run(true);
  assert.equal(ahead.snapshots.at(-1)!.error!.context!.action, "prefetch (wait)");
  assert.equal(plain.snapshots.at(-1)!.error!.context!.action, "input (wait)");
  assert.deepEqual(ahead.snapshots.map((snapshot) => ({
    ...snapshot,
    error: snapshot.error ? { ...snapshot.error, context: {
      ...snapshot.error.context, action: snapshot.error.context!.action.replace(/^prefetch /, "input "),
    } } : snapshot.error,
  })), plain.snapshots);
  assert.deepEqual(ahead.saves.list(), plain.saves.list());
  assert.deepEqual(ahead.store.load(), plain.store.load());
  assert.equal(plain.snapshots.at(-1)!.status, "error");
});

test("prefetch only runs plain waits and stages saves until the player continues", () => {
  const game = emptyGame();
  indexScript(game, PROGRAM, "test.ERB");
  const saves = new MemorySaveStore(), store = new MemoryGlobalStore();
  const runtime = new Runtime(game, undefined, { saves, store });
  runtime.start();
  assert.equal(runtime.prefetch(), true);
  assert.equal(runtime.prefetch(), false, "already ran ahead");
  assert.equal(runtime.prefetched, true);
  assert.deepEqual(saves.list(), [], "save writes are held back");
  assert.equal(store.load(), null);
  const continued = runtime.input("ignored");
  assert.ok(text(continued).includes("saved 0"), "the staged save was visible while running ahead");
  assert.equal(saves.list().length, 1);
  assert.notEqual(store.load(), null);
  runtime.input("");
  assert.equal(runtime.prefetch(), true);
  assert.equal(runtime.input("").input?.kind, "integer");
  assert.equal(runtime.prefetch(), false, "not at a wait");

  const untouched = new MemorySaveStore();
  const abandoned = new Runtime(game, undefined, { saves: untouched, store: new MemoryGlobalStore() });
  abandoned.start();
  abandoned.prefetch();
  assert.deepEqual(untouched.list(), [], "an abandoned run ahead never persists");
});

test("running ahead through the game gives the same screens", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = await loadGame();
  let ranAhead = 0;
  const runs = [false, true].map((prefetch) => {
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
    (runtime as unknown as { randomState: bigint }).randomState = 0x123456789abcdefn;
    const snapshots = [runtime.start()];
    for (const input of ["0", "0", "0", "0", "0", "0", "", "", ""]) {
      if (snapshots.at(-1)!.status !== "waiting") break;
      if (prefetch && runtime.prefetch()) ranAhead++;
      snapshots.push(runtime.input(snapshots.at(-1)!.input?.kind === "wait" ? "" : input || "0"));
    }
    return snapshots.map((snapshot) => ({ status: snapshot.status, error: snapshot.error, text: text(snapshot) }));
  });
  assert.deepEqual(runs[1], runs[0]);
  assert.ok(ranAhead >= 2, `ran ahead ${ranAhead} times`);
});
