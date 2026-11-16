import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { debugCommand } from "../src/debugger.js";
import { applyHotpatches, loadGame } from "../src/loader.js";
import { QaDriver } from "../src/qa-driver.js";
import { Runtime } from "../src/runtime.js";
import { ScriptReload } from "../src/script-reload.js";
import { createApp } from "../src/server.js";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "era-reload-"));
  await Promise.all(["ERB", "CSV", "hotpatch"].map(name => mkdir(path.join(root, name))));
  const file = path.join(root, "ERB", "main.erb");
  const hotpatch = path.join(root, "hotpatch");
  const source = (value: number) => `@SYSTEM_TITLE
PRINTL old active frame
INPUT
CALL SHOW
INPUT
QUIT
@SHOW
PRINTFORML new call {VALUE()}
@VALUE
#FUNCTION
RETURNF ${value}`;
  await writeFile(file, source(1));
  await writeFile(path.join(root, "ERB", "macros.erh"), "#DEFINE BONUS 10");
  return { root, file, hotpatch, source };
}
const runCommand = (runtime: Runtime, data: unknown) => runtime.debugCommand(debugCommand.parse(data));

test("script watcher reloads atomic saves, macros and hotpatches; retains state/active frames and recovers after compilation failure", async () => {
  const f = await fixture();
  const game = await loadGame(f.root);
  const runtime = new Runtime(game);
  runtime.start();
  runCommand(runtime, { action: "write", target: "MONEY", value: { type: "integer", value: "99" } });
  for (let i = 0; i < 4; i++) runCommand(runtime, { action: "call", name: "VALUE" });
  assert.equal((runCommand(runtime, { action: "evaluate", expression: "BONUS + VALUE()" }) as { value: string }).value, "11");
  const watcher = new ScriptReload(game, f.hotpatch, () => [game], (_previous, next) => runtime.reloadScripts(next));
  try {
    await watcher.ready;
    await writeFile(f.file + ".tmp", f.source(2).replace("old active frame", "replacement entry"));
    await rename(f.file + ".tmp", f.file);
    const deadline = Date.now() + 10_000;
    while (!watcher.status(0).revision && Date.now() < deadline) await setTimeout(50);
    const first = watcher.status(0);
    assert.equal(first.last?.status, "reloaded", JSON.stringify(first));
    assert.ok(first.last.files.includes(f.file));
    assert.ok(first.last.routines.includes("VALUE"));
    assert.equal((runCommand(runtime, { action: "call", name: "VALUE" }) as { value: string }).value, "2");
    const advanced = runtime.input("7");
    assert.match(JSON.stringify(advanced.output), /new call 2/);
    assert.doesNotMatch(JSON.stringify(advanced.output), /replacement entry/);
    assert.equal((runCommand(runtime, { action: "read", expressions: ["MONEY"] }) as { value: string }[])[0]!.value, "99");
    await writeFile(f.file, f.source(3) + "\n@BAD\nIF 1\nPRINTL broken");
    await watcher.scan();
    const failed = watcher.status(first.revision);
    assert.equal(failed.last?.status, "error");
    assert.ok(failed.last.errors.length);
    assert.equal((runCommand(runtime, { action: "call", name: "VALUE" }) as { value: string }).value, "2");
    await writeFile(f.file, f.source(4));
    await writeFile(path.join(f.root, "ERB", "macros.erh"), "#DEFINE BONUS 20");
    await writeFile(path.join(f.hotpatch, "value.erb"), "@VALUE\n#FUNCTION\nRETURNF 8");
    await watcher.scan();
    const fixed = watcher.status(failed.revision);
    assert.equal(fixed.last?.status, "reloaded", JSON.stringify(fixed));
    assert.equal((runCommand(runtime, { action: "evaluate", expression: "BONUS + VALUE()" }) as { value: string }).value, "28");
    assert.deepEqual(watcher.status(fixed.revision).events, []);
    await rm(path.join(f.hotpatch, "value.erb"));
    await watcher.scan();
    assert.equal((runCommand(runtime, { action: "call", name: "VALUE" }) as { value: string }).value, "4");
    const step = runtime.input("1");
    assert.equal(step.status, "halted");
  } finally { watcher.close(); await rm(f.root, { recursive: true }); }
});

test("qa_reload manually scans and consumes feedback per driver without changing game state", async () => {
  const f = await fixture();
  const game = await loadGame(f.root);
  await applyHotpatches(game, f.hotpatch);
  const token = "a".repeat(64);
  const server = createApp([{ id: "fixture", title: "Reload fixture", game, hotpatch: f.hotpatch }], false, undefined, [], { token });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const driver = new QaDriver(`http://127.0.0.1:${address.port}`, token);
  try {
    await driver.start({ game: "fixture", graphical: false, headed: false, viewport: { width: 900, height: 700 } });
    const initial = await driver.reload(false) as { revision: number; events: unknown[] };
    assert.equal(initial.revision, 0);
    await writeFile(f.file, f.source(6));
    const status = await driver.reload(true) as { revision: number; events: { status: string }[] };
    assert.ok(status.events.some(event => event.status === "reloaded"), JSON.stringify(status));
    assert.deepEqual((await driver.reload(false) as { events: unknown[] }).events, []);
    const result = await driver.debug(debugCommand.parse({ action: "call", name: "VALUE" }));
    assert.match(JSON.stringify(result), /"value":"6"/);
    await writeFile(f.file, f.source(6).replace("RETURNF 6", "RETURNF 1 +"));
    const failure = await driver.reload(true) as { events: { status: string; errors: unknown[] }[] };
    assert.ok(failure.events.some(event => event.status === "error" && event.errors.length), JSON.stringify(failure));
    assert.match(JSON.stringify(await driver.debug(debugCommand.parse({ action: "call", name: "VALUE" }))), /"value":"6"/);
    await writeFile(f.file, f.source(7));
    assert.ok(JSON.stringify(await driver.reload(true)).includes("reloaded"));
    await driver.input("1", false);
    assert.match(JSON.stringify(await driver.observe()), /new call 7/);
    assert.equal(await readFile(f.file, "utf8"), f.source(7));
  } finally {
    await driver.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(f.root, { recursive: true });
  }
});
