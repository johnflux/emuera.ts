import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { backgroundQuicksave } from "../src/background-quicksave.js";
import { emptyGame, indexScript } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";
import { FileSaveStore, MemorySaveStore, MIDDAY_FILE } from "../src/storage.js";
import { readSuspend } from "../src/suspend-format.js";

function runtime() {
  const game = emptyGame();
  game.variableSizes.set("CFLAG", [10000]);
  game.names.set("CFLAG", new Map([["現在位置", 0], ["好感度", 2], ["信頼度", 4]]));
  indexScript(game, `@SYSTEM_TITLE
ADDVOIDCHARA
BEGIN TRAIN
@SHOW_STATUS
PRINTL main
@SHOW_USERCOM
@USERCOM
TIME += 5
@HOTPATCH_TARGET_DATAGROUP
@KOJO_MESSAGE_SEND
@TRAINNAME_TR
#FUNCTIONS
RETURNF ""`, "worker.ERB");
  const runtime = new Runtime(game, 50_000, { saves: new MemorySaveStore() });
  const snapshot = runtime.start();
  assert.equal(snapshot.error, null);
  assert.equal(snapshot.midday?.available, true);
  return runtime;
}

function decode(encoded: Uint8Array) {
  const saved = readSuspend<{ game: string; runtime: Buffer }>(Buffer.from(encoded));
  assert.equal(saved.game, "tw");
  assert.ok(Buffer.isBuffer(saved.runtime), "inner buffer survives worker serialization");
  return readSuspend<ReturnType<Runtime["captureMidday"]>>(saved.runtime);
}

test("background encoding releases the event loop and captures state before subsequent input", async () => {
  const original = runtime();
  const state = original.captureMidday();
  // Exercise a sizable payload without introducing saved-state fields.
  state.data.variables.STR = { "0": "x".repeat(8 * 1024 * 1024) };
  const writing = backgroundQuicksave({ game: "tw", debug: false, runtime: state });
  let finished = false;
  void writing.then(() => { finished = true; });
  state.data.variables.STR["0"] = "changed";
  original.input("900");
  await setImmediate();
  assert.equal(finished, false, "main-thread work runs while the worker is still processing");
  const result = await writing;
  const saved = decode(result.encoded!);
  assert.equal(saved.data.variables.STR["0"]!.length, 8 * 1024 * 1024);
  assert.notDeepEqual(saved.data.variables.TIME, original.captureMidday().data.variables.TIME);
  assert.ok(result.bytes > 8 * 1024 * 1024);
  assert.ok(result.encodeMs >= 0 && result.writeMs >= 0);
});

test("worker prepares disk writes without replacing the slot, and commit/discard leave no temporary files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "era-worker-"));
  const store = new FileSaveStore(directory);
  try {
    store.write(MIDDAY_FILE, Buffer.from("previous save"));
    const revision = store.revision;
    const job = { game: "tw", debug: false, runtime: runtime().captureMidday(), directory };
    const prepared = await backgroundQuicksave(job);
    assert.ok(prepared.prepared);
    assert.equal(store.read(MIDDAY_FILE)!.toString(), "previous save");
    assert.equal(store.revision, revision, "preparing is not a committed write");
    store.commitWrite(prepared.prepared);
    assert.equal(store.revision, revision + 1);
    const saved = decode(store.read(MIDDAY_FILE) as Buffer);
    const fresh = new Runtime(runtime().game, 50_000);
    assert.equal(fresh.restoreMidday(readSuspend<{ runtime: Buffer }>(store.read(MIDDAY_FILE) as Buffer).runtime).error, null);
    assert.equal(saved.data.characters, 1);
    const discarded = await backgroundQuicksave(job);
    store.discardWrite(discarded.prepared!);
    assert.deepEqual(await readdir(directory), [MIDDAY_FILE]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("worker write failures reject explicitly without replacing a save or leaking temporary files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "era-worker-failure-"));
  try {
    const blocked = path.join(directory, "not-a-directory");
    await writeFile(blocked, "block");
    await assert.rejects(backgroundQuicksave({
      game: "tw", debug: false, runtime: runtime().captureMidday(), directory: blocked,
    }), /Background quicksave failed: Cannot write save file/);
    assert.deepEqual(await readdir(directory), ["not-a-directory"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("browser waits once per quicksave, shows failures while idle and ignores replaced sessions", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("const watchedQuicksaves =");
  const end = source.indexOf("async function loadMidday()", start);
  assert.ok(start >= 0 && end > start);
  const requests: { session: string; resolve: (value: { error: string | null }) => void }[] = [];
  const messages: string[] = [];
  const context = {
    session: "run",
    api: (route: string, data: { session: string }) => {
      assert.equal(route, "/api/quicksave/status");
      return new Promise<{ error: string | null }>((resolve) => requests.push({ session: data.session, resolve }));
    },
    message: (text: string, error: boolean) => {
      assert.equal(error, true);
      messages.push(text);
    },
  };
  const watch: (id: string) => Promise<void> = runInNewContext(`${source.slice(start, end)}\nwatchQuicksave`, context);
  const pending = watch("run");
  await watch("run");
  assert.equal(requests.length, 1, "repeated pending snapshots do not poll");
  requests[0]!.resolve({ error: "Disk full" });
  await pending;
  assert.deepEqual(messages, ["Could not automatically quicksave: Disk full"]);
  const next = watch("run");
  assert.equal(requests.length, 2, "a later save can be watched");
  context.session = "new run";
  requests[1]!.resolve({ error: "Old failure" });
  await next;
  assert.equal(messages.length, 1, "old save failures do not appear in a new run");
});
