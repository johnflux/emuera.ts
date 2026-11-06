import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

type Config = { clipboard: boolean; local: boolean; endpoint: string; model: string; language: string };
type State = { config?: Config; error?: string; text?: string; translating?: boolean };
type TranslationRequest = Config & { text: string; signal: AbortSignal };
type Tools = { publish(text: string): void; configure(values: Partial<Config>): void; config(): Config };

test("plain game output preserves line boundaries and does not copy cleared or typed input", () => {
  const source = readFileSync(new URL("../web/output-tools.js", import.meta.url), "utf8").replaceAll("export ", "");
  const text = vm.runInNewContext(source + "\ngameOutputText");
  assert.equal(text([
    { type: "text", text: "First", newline: true },
    { type: "text", text: "Erased", newline: true },
    { type: "clear", count: 1 },
    { type: "input", text: "Player input", newline: true },
    { type: "button", text: "[1] Choice" },
    { type: "text", text: " remains", newline: true },
  ]), "First\n[1] Choice remains");
});

function harness(translate: (request: TranslationRequest) => Promise<string> = async ({ text }) => "Translated " + text,
  writeClipboard?: (text: string) => Promise<void>) {
  const source = readFileSync(new URL("../web/output-tools.js", import.meta.url), "utf8").replaceAll("export ", "");
  const saved = new Map<string, string>();
  const timers = new Map<number, () => void>();
  let next = 0;
  const copied: string[] = [];
  const states: State[] = [];
  const create = vm.runInNewContext(source + "\ncreateOutputTools", {
    localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) },
    setTimeout: (fn: () => void) => { const id = ++next; timers.set(id, fn); return id; },
    clearTimeout: (id: number) => timers.delete(id), AbortController,
  });
  const tools: Tools = create({
    writeClipboard: writeClipboard ?? (async (text: string) => { copied.push(text); }),
    translate, onChange: (state: State) => states.push(state),
  });
  const flush = async () => {
    for (const [id, timer] of timers) { timers.delete(id); timer(); }
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return { tools, copied, states, flush, saved };
}

test("clipboard and local translation default off, persist toggles, and copy original text", async () => {
  const { tools, copied, states, flush, saved } = harness();
  assert.equal(tools.config().clipboard, false);
  assert.equal(tools.config().local, false);
  tools.publish("Original game text");
  await flush();
  assert.deepEqual(copied, []);
  assert.ok(!states.some((state) => state.translating));
  tools.configure({ clipboard: true, local: true, model: "gemma-3-12b" });
  await flush();
  assert.deepEqual(copied, ["Original game text"]);
  assert.equal(states.at(-1)?.text, "Translated Original game text");
  assert.equal(JSON.parse([...saved.values()][0]!).model, "gemma-3-12b");
  tools.configure({ clipboard: false, local: false });
  tools.publish("Next screen");
  await flush();
  assert.equal(copied.length, 1);
});

test("local translation cancels stale screens, never applies disabled results, and reports failures", async () => {
  const pending: { request: TranslationRequest; resolve(text: string): void; reject(error: Error): void }[] = [];
  const { tools, states, flush } = harness((request) => new Promise((resolve, reject) => pending.push({ request, resolve, reject })));
  tools.configure({ local: true, model: "gemma" });
  tools.publish("First");
  await flush();
  tools.publish("Second");
  assert.equal(pending[0]!.request.signal.aborted, true);
  await flush();
  pending[0]!.resolve("Old translation");
  await flush();
  assert.ok(!states.some((state) => state.text === "Old translation"));
  pending[1]!.reject(new Error("LM Studio not running"));
  await flush();
  assert.match(states.at(-1)!.error!, /LM Studio not running/);
  tools.publish("Third");
  await flush();
  tools.configure({ local: false });
  pending[2]!.resolve("Disabled translation");
  await flush();
  assert.ok(!states.some((state) => state.text === "Disabled translation"));
});

test("large output is translated in bounded sequential requests without truncation", async () => {
  const requests: TranslationRequest[] = [];
  const { tools, states, flush } = harness(async (request) => { requests.push(request); return request.text; });
  tools.configure({ local: true, model: "gemma" });
  tools.publish("x".repeat(13000));
  await flush();
  assert.deepEqual(requests.map((request) => request.text.length), [6000, 6000, 1000]);
  assert.equal(states.at(-1)!.text!.replaceAll("\n", "").length, 13000);
});

test("browser clipboard denial is ignored without showing an error", async () => {
  const { tools, states, flush } = harness(undefined, async () => { throw new Error("Clipboard permission denied"); });
  tools.configure({ clipboard: true });
  tools.publish("Game text");
  await flush();
  assert.ok(!states.some((state) => state.error?.includes("Could not copy game text")));
});

test("local model translation reuses the proxy without chat tools or JSON mode", async () => {
  const source = readFileSync(new URL("../web/llm.js", import.meta.url), "utf8").replaceAll("export ", "");
  const requests: { endpoint: string; payload: { messages: { role: string; content: string }[]; tools?: unknown; response_format?: unknown; model: string } }[] = [];
  const translate = vm.runInNewContext(source + "\ntranslateGameText", {
    URL, performance,
    fetch: async (_url: string, init: { body: string }) => {
      requests.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ ok: true, status: 200, text: JSON.stringify({ choices: [{ message: { content: "Hello" } }] }) }) };
    },
  });
  assert.equal(await translate({ endpoint: "http://127.0.0.1:1234/v1", model: "gemma-3-12b", language: "English", text: "Game text" }), "Hello");
  assert.equal(requests[0]!.payload.model, "gemma-3-12b");
  assert.equal(requests[0]!.payload.messages[1]!.content, "Game text");
  assert.equal(requests[0]!.payload.tools, undefined);
  assert.equal(requests[0]!.payload.response_format, undefined);
  await assert.rejects(translate({ endpoint: "https://remote.example/v1", model: "gemma", language: "English", text: "Private" }), /localhost/);
  assert.equal(requests.length, 1);
});

test("desktop clipboard writes use Electron IPC and reject non-game frames and oversized text", () => {
  const main = readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  const copied: string[] = [];
  const handlers = new Map<string, (event: unknown, text: unknown) => void>();
  const sender = {};
  let quits = 0;
  vm.runInNewContext(main + "\nwindow = {webContents: sender}; server = {address: () => ({port: 12345})};", {
    require: (name: string) => {
      if (name === "electron") return {
        app: { whenReady: () => ({ then: () => ({ catch() {} }) }), on() {}, quit: () => { quits++; } },
        ipcMain: { handle: (channel: string, handler: (event: unknown, text: unknown) => void) => handlers.set(channel, handler) },
        clipboard: { writeText: (text: string) => copied.push(text) },
      };
      if (name === "node:path") return { join() {} };
      if (name === "node:url") return {};
      if (name === "./game-paths.cjs") return () => {};
      if (name === "./steam-launch.cjs") return () => false;
      throw new Error("Unexpected import: " + name);
    },
    console: { error() {} }, sender,
  });
  const write = handlers.get("era:write-clipboard")!;
  write({ sender, senderFrame: { url: "http://127.0.0.1:12345/" } }, "Original game text");
  assert.deepEqual(copied, ["Original game text"]);
  assert.throws(() => write({ sender, senderFrame: { url: "https://untrusted.example/" } }, "Unexpected"), /only available from the game window/);
  assert.throws(() => write({ sender: {}, senderFrame: { url: "http://127.0.0.1:12345/" } }, "Unexpected"), /only available from the game window/);
  assert.throws(() => write({ sender, senderFrame: { url: "http://127.0.0.1:12345/" } }, "x".repeat(1_000_001)), /at most/);
  assert.equal(copied.length, 1);
  const quit = handlers.get("era:quit")!;
  assert.throws(() => quit({ sender: {}, senderFrame: { url: "http://127.0.0.1:12345/" } }, undefined), /only available from the game window/);
  assert.throws(() => quit({ sender, senderFrame: { url: "https://untrusted.example/" } }, undefined), /only available from the game window/);
  assert.equal(quits, 0);
  quit({ sender, senderFrame: { url: "http://127.0.0.1:12345/" } }, undefined);
  assert.equal(quits, 1);

  let bridge: { writeClipboard(text: string): unknown; quit(): unknown } | undefined;
  const preload = readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8");
  vm.runInNewContext(preload, {
    process: { argv: [] },
    require: () => ({
      contextBridge: { exposeInMainWorld: (name: string, api: typeof bridge) => { assert.equal(name, "eraDesktop"); bridge = api; } },
      ipcRenderer: { invoke: (channel: string, text: string) => ({ channel, text }) },
    }),
  });
  assert.deepEqual(bridge!.writeClipboard("Game text"), { channel: "era:write-clipboard", text: "Game text" });
  assert.deepEqual(bridge!.quit(), { channel: "era:quit", text: undefined });
});
