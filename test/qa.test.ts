import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { debugCommand } from "../src/debugger.js";
import { emptyGame, indexScript } from "../src/loader.js";
import { QaDriver } from "../src/mcp.js";
import { Runtime } from "../src/runtime.js";
import { createApp } from "../src/server.js";
import { MemoryGlobalStore, MemorySaveStore } from "../src/storage.js";
import { readNativeSave } from "../src/save-format.js";

const script = `@SYSTEM_TITLE
PRINTBUTTON "Choose seven", 7
HTML_PRINT "<button value='8'>Choose eight</button>"
INPUT
PRINTFORML Chose {RESULT}; count {FLAG:0}
INPUT
QUIT
@BUMP(ARG:0)
#FUNCTION
FLAG:0 += ARG:0
RETURNF FLAG:0
@WORD(ARGS:0)
#FUNCTIONS
RETURNF ARGS:0 + "!"
@SPIN
#FUNCTION
WHILE 1
WEND
RETURNF 0
@FAIL
#FUNCTION
FLAG:0 += 1
THROW test failure`;

function runtime() {
  const game = emptyGame();
  indexScript(game, script, "test.ERB");
  return new Runtime(game);
}
const command = (runtime: Runtime, data: unknown) => runtime.debugCommand(debugCommand.parse(data));

test("debugger preserves Int64 precision, reads named/computed indices, calls functions and preserves pending input", () => {
  const run = runtime();
  assert.equal(run.start().status, "waiting");
  assert.deepEqual(command(run, { action: "write", target: "FLAG:(1+1)", value: { type: "integer", value: "9223372036854775807" } }),
    { expression: "FLAG:(1+1)", type: "integer", value: "9223372036854775807" });
  assert.deepEqual(command(run, { action: "call", name: "@BUMP", arguments: ["4"] }), { type: "integer", value: "4" });
  assert.deepEqual(command(run, { action: "call", name: "WORD", arguments: ['"Hello"'] }), { type: "string", value: "Hello!" });
  assert.deepEqual(command(run, { action: "evaluate", expression: "++FLAG:0" }), { type: "integer", value: "5" });
  assert.match(JSON.stringify(run.input("7").output), /count 5/);
});

test("debugger rejects unsafe reads, invalid writes and runaway functions without consuming the paused input", () => {
  const run = runtime();
  run.start();
  for (const expression of ["RAND:100", "BUMP(1)", "FLAG:(FLAG:0++)"])
    assert.throws(() => command(run, { action: "read", expressions: [expression] }), /evaluate|side effects/);
  assert.throws(() => command(run, { action: "write", target: "FLAG:0", value: { type: "integer", value: "9223372036854775808" } }), /64-bit/);
  assert.throws(() => command(run, { action: "write", target: "FLAG:0", value: { type: "string", value: "wrong" } }), /type mismatch/);
  assert.throws(() => command(run, { action: "call", name: "SPIN" }), /Instruction limit/);
  assert.throws(() => command(run, { action: "call", name: "FAIL" }), /test failure/);
  assert.equal(run.input("7").status, "waiting");
  assert.deepEqual(command(run, { action: "read", expressions: ["FLAG:0"] }), [{ expression: "FLAG:0", type: "integer", value: "1" }]);
});

async function app(qa = true, source = script) {
  const game = emptyGame();
  indexScript(game, source, "test.ERB");
  const saves = new MemorySaveStore();
  const store = new MemoryGlobalStore();
  const server = createApp([{ id: "fixture", title: "QA fixture", game, saves, store }], false, undefined, [], qa ? { token: "a".repeat(64) } : undefined);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base, saves, store, game,
    post: (route: string, value: unknown, token = "a".repeat(64)) => fetch(base + route, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(value),
    }),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

test("debug routes are opt-in, authenticated and step-checked; failed calls still advance the revision", async () => {
  for (const enabled of [false, true]) {
    const server = await app(enabled);
    try {
      const started = await (await server.post("/api/start", { mode: "game" })).json();
      for (const route of ["/api/editor/open", "/api/editor/tool", "/api/editor/close", "/api/editor/prompt"])
        assert.equal((await server.post(route, { session: started.session, step: started.step })).status, 404);
      assert.equal((await fetch(server.base + "/editor.js")).status, 404);
      const page = await (await fetch(server.base)).text();
      assert.ok(!page.includes('id="game-editor"'));
      const data = { session: started.session, step: started.step, command: { action: "state" } };
      assert.equal((await server.post("/api/debug", data, "wrong")).status, enabled ? 403 : 404);
      assert.equal((await server.post("/api/debug", { ...data, step: 0 })).status, enabled ? 409 : 404);
      if (!enabled) continue;
      const state = await (await server.post("/api/debug", data)).json();
      assert.ok(state.result.buttonValues.includes("7"));
      assert.ok(state.result.buttonValues.includes("8"));
      const failure = await server.post("/api/debug", { ...data, command: { action: "call", name: "FAIL" } });
      assert.equal(failure.status, 400);
      const failed = await failure.json();
      assert.equal(failed.step, started.step + 1);
      assert.match(failed.error.message, /test failure/);
      assert.equal((await server.post("/api/input", { session: started.session, step: failed.step, value: "7" })).status, 200);
      assert.deepEqual(server.saves.list(), [], "QA never writes injected player stores");
    } finally { await server.close(); }
  }
});

test("QA script save/global/log writes stay in memory while ordinary sessions retain their stores", async () => {
  for (const qa of [false, true]) {
    const server = await app(qa, '@SYSTEM_TITLE\nSAVEDATA 1, "test"\nSAVEGLOBAL\nPRINTL log output\nOUTPUTLOG\nINPUT');
    try {
      const started = await (await server.post("/api/start", { mode: "game" })).json();
      assert.equal(started.status, "waiting", JSON.stringify(started.error));
      assert.equal(server.saves.read("save01.sav") !== null, !qa);
      assert.equal(server.saves.read("emuera.log") !== null, !qa);
      assert.equal(server.store.load() !== null, !qa);
    } finally { await server.close(); }
  }
});

test("native fixture import uses normal load hooks, preserves its slot and never changes source bytes", async () => {
  const server = await app(true, `@SYSTEM_TITLE
INPUT
@MAKE
FLAG:0 = 123
SAVEDATA 1, "fixture"
QUIT
@EVENTLOAD
FLAG:1 += 1
@SHOW_SHOP
PRINTFORML Loaded {FLAG:0}; hooks {FLAG:1}
@USERSHOP`);
  const directory = await mkdtemp(path.join(tmpdir(), "era-native-qa-"));
  const driver = new QaDriver(server.base, "a".repeat(64));
  try {
    const saves = new MemorySaveStore();
    assert.equal(new Runtime(server.game, 50_000, { saves }).start("MAKE").status, "halted");
    const bytes = saves.read("save01.sav");
    assert.ok(Buffer.isBuffer(bytes));
    const file = path.join(directory, "save01.sav");
    await writeFile(file, bytes);
    await driver.start({ game: "fixture", graphical: false, headed: false, viewport: { width: 900, height: 700 } });
    const restored = await driver.loadSave(file);
    assert.match(JSON.stringify(restored), /Loaded 123; hooks 1/);
    assert.match(JSON.stringify(await driver.debug(debugCommand.parse({ action: "read", expressions: ["LASTLOAD_NO"] }))), /"value":"1"/);
    assert.deepEqual(await readFile(file), bytes);
    assert.deepEqual(readNativeSave(await readFile(file)), readNativeSave(bytes));
    assert.deepEqual(server.saves.list(), [], "player store remains untouched");
  } finally { await driver.close(); await server.close(); await rm(directory, { recursive: true }); }
});

const chrome = process.env.ERA_QA_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
test("graphical driver observes and clicks real controls, synchronizes debugger changes and captures PNG evidence", {
  skip: existsSync(chrome) ? false : "Set ERA_QA_BROWSER to a Chrome/Chromium executable",
}, async () => {
  const server = await app();
  const driver = new QaDriver(server.base, "a".repeat(64));
  try {
    const first = await driver.start({ game: "fixture", graphical: true, headed: false, viewport: { width: 900, height: 700 } }) as {
      view: { controls: { ref: string; name: string; disabled: boolean }[]; step: number; text: string };
    };
    const seven = first.view.controls.find(control => control.name === "Choose seven");
    assert.ok(seven && !seven.disabled);
    await driver.debug(debugCommand.parse({ action: "write", target: "FLAG:0", value: { type: "integer", value: "42" } }));
    await assert.rejects(driver.act({ kind: "click", ref: seven.ref }), /Stale/);
    const current = await driver.observe() as typeof first;
    const choice = current.view.controls.find(control => control.name === "Choose seven");
    assert.ok(choice);
    const clicked = await driver.act({ kind: "click", ref: choice.ref }) as typeof first;
    assert.match(clicked.view.text, /Chose 7; count 42/);
    const png = await driver.screenshot();
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    const report = await driver.report() as { report: string; screenshot: string };
    try {
      assert.match(await readFile(report.report, "utf8"), /"ui"/);
      assert.ok((await readFile(report.screenshot)).length > 100);
    } finally { await rm(path.dirname(report.report), { recursive: true }); }
  } finally { await driver.close(); await server.close(); }
});

test("portable workspace MCP configuration initializes and lists QA tools", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const config = JSON.parse(await readFile(new URL("../.mcp.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(config), ["mcpServers"]);
  const server = config.mcpServers["era-qa"];
  assert.equal(server.type, "stdio");
  assert.equal("cwd" in server, false);
  assert.ok(!JSON.stringify(server).includes("${workspaceFolder}"));
  assert.equal(existsSync(new URL("../.vscode/mcp.json", import.meta.url)), false);
  const transport = new StdioClientTransport({
    command: server.command, args: server.args, cwd: root, stderr: "pipe",
  });
  const client = new Client({ name: "workspace-config-test", version: "1" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    for (const name of ["qa_start", "qa_context", "qa_observe", "qa_debug", "qa_finish"])
      assert.ok(tools.tools.some(tool => tool.name === name), name);
  } finally { await client.close(); }
});

test("generic stdio MCP works outside the repository and supports headless gameplay without stdout log corruption", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "era-mcp-test-"));
  const root = path.join(directory, "fixture");
  await mkdir(path.join(root, "ERB"), { recursive: true });
  await mkdir(path.join(root, "CSV"));
  await writeFile(path.join(root, "ERB", "test.ERB"), script);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL("../src/mcp.ts", import.meta.url))],
    cwd: directory,
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ERA_QA_GAMES_DIR: directory },
    stderr: "pipe",
  });
  const client = new Client({ name: "qa-test", version: "1" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    for (const name of ["qa_games", "qa_context", "qa_start", "qa_debug", "qa_input", "qa_observe", "qa_screenshot", "qa_act", "qa_load_save", "qa_report", "qa_finish"])
      assert.ok(tools.tools.some(tool => tool.name === name), name);
    const start = await client.callTool({ name: "qa_start", arguments: { game: "fixture", graphical: false } });
    assert.notEqual(start.isError, true, JSON.stringify(start));
    const context = await client.callTool({ name: "qa_context" });
    const sources = JSON.parse((context.content as { text: string }[])[0]!.text).sources;
    assert.equal(sources.root, root);
    assert.equal(sources.erb, path.join(root, "ERB"));
    const result = await client.callTool({ name: "qa_debug", arguments: { command: { action: "call", name: "BUMP", arguments: ["3"] } } });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.match(JSON.stringify(result), /\\\"value\\\": \\\"3\\\"/);
    assert.notEqual((await client.callTool({ name: "qa_input", arguments: { value: "8" } })).isError, true);
    assert.notEqual((await client.callTool({ name: "qa_finish" })).isError, true);
  } finally {
    await client.close();
    await rm(directory, { recursive: true });
  }
});
