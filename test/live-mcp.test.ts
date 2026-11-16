import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server.js";
import { emptyGame, indexScript } from "../src/loader.js";
import { MemoryGlobalStore, MemorySaveStore } from "../src/storage.js";

async function app() {
  const root = await mkdtemp(path.join(tmpdir(), "era-live-test-"));
  await Promise.all(["erb", "csv", "gui"].map(directory => mkdir(path.join(root, directory))));
  const game = emptyGame(root);
  const source = `@SYSTEM_TITLE
PRINTBUTTON "Choose seven", 7
INPUT
PRINTFORML Chose {RESULT}; count {FLAG:0}
INPUT
QUIT
@BUMP(ARG:0)
#FUNCTION
FLAG:0 += ARG:0
RETURNF FLAG:0
@FAIL
#FUNCTION
FLAG:0 += 1
THROW test failure`;
  await writeFile(path.join(root, "erb", "live.ERB"), source);
  indexScript(game, source, "live.ERB");
  const saves = new MemorySaveStore();
  const server = createApp([{ id: "fixture", title: "Live fixture", hotpatch: path.join(root, "gui"), game, saves, store: new MemoryGlobalStore() }]);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base, saves, root,
    post: (route: string, value: unknown, headers: Record<string, string> = {}) => fetch(base + route, {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(value),
    }),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rm(root, { recursive: true });
    },
  };
}

test("embedded MCP validates host, origin, initialization, session and browser session possession", async () => {
  const server = await app();
  try {
    assert.equal((await fetch(server.base + "/mcp")).status, 400);
    assert.equal((await server.post("/mcp", {}, { Origin: "https://example.com" })).status, 403);
    const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(server.base + "/mcp", { headers: { Host: "attacker.example:3003" } }, response => {
        response.resume();
        resolve(response.statusCode);
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(wrongHost, 403);
    assert.equal((await server.post("/mcp", { jsonrpc: "2.0", method: "initialize", params: {} })).status, 400);
    assert.equal((await server.post("/mcp", {}, { "Mcp-Session-Id": "not-a-session" })).status, 404);
    assert.equal((await server.post("/api/mcp/browser", { session: "unknown", decision: "allow" })).status, 404);
    assert.equal((await server.post("/api/debug", { session: "unknown", command: { action: "context" } })).status, 404);
  } finally { await server.close(); }
});

const executablePath = process.env.ERA_QA_BROWSER ?? [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(candidate => existsSync(candidate));

test("pending approval remains available after long inactivity and Disconnect still revokes it", async t => {
  const server = await app();
  const client = new Client({ name: "patient-agent", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(server.base + "/mcp"));
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  try {
    const started = await (await server.post("/api/start", { mode: "game" })).json();
    await client.connect(transport);
    const pending = await (await server.post("/api/mcp/browser", { session: started.session })).json();
    assert.ok(pending.pending);
    now += 24 * 60 * 60_000;
    const later = await (await server.post("/api/mcp/browser", { session: started.session })).json();
    assert.deepEqual(later.pending, pending.pending);
    assert.equal((await client.callTool({ name: "qa_context" })).isError, true);
    const approved = await (await server.post("/api/mcp/browser", {
      session: started.session, id: pending.pending.id, decision: "allow",
    })).json();
    assert.equal(approved.connected, true);
    const revoked = await (await server.post("/api/mcp/browser", { session: started.session, revoke: true })).json();
    assert.equal(revoked.connected, false);
    await assert.rejects(client.callTool({ name: "qa_context" }), /404|revoked/);
  } finally { await client.close(); await server.close(); }
});

test("configured live HTTP MCP reuses one approval across actions and mutations until revoked", { skip: !executablePath }, async () => {
  const server = await app();
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  const page = await browser.newPage();
  const client = new Client({ name: "live-test", version: "1" });
  const config = JSON.parse(await readFile(new URL("../.mcp.json", import.meta.url), "utf8"));
  const live = config.mcpServers["era-live"];
  assert.equal(live.type, "http");
  const endpoint = new URL(live.url);
  endpoint.port = new URL(server.base).port;
  const transport = new StreamableHTTPClientTransport(endpoint);
  try {
    const started = await (await server.post("/api/start", { mode: "game" })).json();
    await page.goto(server.base);
    await page.waitForFunction(() => !!window.eraQA && !window.eraQA.state().busy);
    assert.equal(await page.evaluate(id => window.eraQA.resume(id), started.session), true);
    await client.connect(transport);
    assert.ok((await client.listTools()).tools.some(tool => tool.name === "qa_context"));
    const tool = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
    const blocked = await tool("qa_observe");
    assert.equal(blocked.isError, true);
    assert.match(JSON.stringify(blocked), /approval/);
    await page.locator("#agent-access[open]").waitFor();
    let staleDecisions = 0;
    await page.route("**/api/mcp/browser", async route => {
      if (route.request().postDataJSON().decision === "allow" && staleDecisions++ === 0) {
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "This pairing request is no longer available" }) });
      } else await route.continue();
    });
    await page.locator("#agent-allow").click();
    await page.locator("#agent-access[open]").waitFor();
    assert.equal(staleDecisions, 1, "an old decision must not be sent again on every poll");
    await page.locator("#agent-allow").click();
    await page.waitForFunction(() => document.querySelector("#agent-status")?.textContent === "Connected: live-test");
    assert.deepEqual(await (await server.post("/api/prefetch", { session: started.session })).json(), { prefetched: false });
    const context = await tool("qa_context");
    assert.notEqual(context.isError, true, JSON.stringify(context));
    const sources = JSON.parse((context.content as { text: string }[])[0]!.text).sources;
    assert.deepEqual(sources, {
      root: server.root, erb: path.join(server.root, "erb"), csv: path.join(server.root, "csv"),
      hotpatch: path.join(server.root, "gui"), files: ["live.ERB"],
    });
    const reloadFile = path.join(server.root, "erb", "reload.erb");
    await writeFile(reloadFile, "@HOTPATCH_LIVE_RELOAD\n#FUNCTION\nRETURNF 17");
    const reload = await tool("qa_reload", { scan: true });
    assert.notEqual(reload.isError, true, JSON.stringify(reload));
    const reloadStatus = JSON.parse((reload.content as { text: string }[])[0]!.text);
    assert.ok(reloadStatus.events.some((event: { status: string }) => event.status === "reloaded"));
    const reloadedFunction = await tool("qa_debug", { command: { action: "call", name: "HOTPATCH_LIVE_RELOAD" } });
    assert.match(JSON.stringify(reloadedFunction), /17/);
    const unchanged = await tool("qa_reload");
    assert.deepEqual(JSON.parse((unchanged.content as { text: string }[])[0]!.text).events, []);
    await writeFile(reloadFile, "@HOTPATCH_LIVE_RELOAD\n#FUNCTION\nRETURNF 1 +");
    const compileFailure = await tool("qa_reload", { scan: true });
    assert.notEqual(compileFailure.isError, true);
    const failedReload = JSON.parse((compileFailure.content as { text: string }[])[0]!.text);
    assert.equal(failedReload.last.status, "error");
    assert.ok(failedReload.last.errors.length);
    assert.match(JSON.stringify(await tool("qa_debug", { command: { action: "call", name: "HOTPATCH_LIVE_RELOAD" } })), /17/);
    await rm(reloadFile);
    await tool("qa_reload", { scan: true });
    const observe = await tool("qa_observe");
    const content = observe.content as { type: string; text: string }[];
    const before = JSON.parse(content[0]!.text);
    const oldRef = before.view.controls.find((control: { name: string }) => control.name === "Choose seven").ref;
    const write = await tool("qa_debug", { command: { action: "write", target: "FLAG:0", value: { type: "integer", value: "41" } } });
    assert.notEqual(write.isError, true, JSON.stringify(write));
    const failure = await tool("qa_debug", { command: { action: "call", name: "FAIL" } });
    assert.equal(failure.isError, true);
    assert.match(JSON.stringify(failure), /test failure/);
    const stale = await tool("qa_act", { action: { kind: "click", ref: oldRef } });
    assert.equal(stale.isError, true);
    assert.match(JSON.stringify(stale), /Stale/);
    const current = await tool("qa_observe");
    const view = JSON.parse((current.content as { text: string }[])[0]!.text).view;
    const choice = view.controls.find((control: { name: string }) => control.name === "Choose seven");
    const clicked = await tool("qa_act", { action: { kind: "click", ref: choice.ref } });
    assert.notEqual(clicked.isError, true, JSON.stringify(clicked));
    await page.getByText("Chose 7; count 42", { exact: true }).waitFor();
    assert.match(JSON.stringify(clicked), /Chose 7; count 42/);
    const poll = await (await server.post("/api/mcp/browser", { session: started.session })).json();
    const other = await (await server.post("/api/start", { mode: "game" })).json();
    const debug = { session: other.session, step: other.step, command: { action: "read", expressions: ["FLAG:0"] } };
    assert.equal((await server.post("/api/debug", debug, { Authorization: `Bearer ${poll.key}` })).status, 404, "approval is scoped to one game session");
    assert.equal((await tool("qa_load_save", { file: "/not-read" })).isError, true);
    assert.equal((await tool("qa_start")).isError, true);
    const screenshot = await tool("qa_screenshot");
    assert.equal(screenshot.isError, true);
    assert.match(JSON.stringify(screenshot), /desktop app/);
    const report = await tool("qa_debug", { command: { action: "read", expressions: ["FLAG:0"] } });
    assert.match(JSON.stringify(report), /42/);
    const ended = await tool("qa_input", { value: "1" });
    assert.notEqual(ended.isError, true, JSON.stringify(ended));
    assert.notEqual((await tool("qa_observe")).isError, true);
    await page.locator("#menu-toggle").click();
    await page.locator("#settings-toggle").click();
    await page.locator("#settings #agent-toggle").click();
    await page.locator("#agent-disconnect").click();
    await page.waitForFunction(() => document.querySelector("#agent-status")?.textContent === "No agent connected.");
    assert.equal((await server.post("/api/debug", { ...debug, session: started.session }, { Authorization: `Bearer ${poll.key}` })).status, 404);
    await assert.rejects(tool("qa_observe"), /404|revoked/);
    assert.equal((await server.post("/mcp", {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "spam", version: "1" } },
    })).status, 429);
  } finally {
    await client.close();
    await browser.close();
    await server.close();
  }
});

test("always approval is saved, reused without a popup and can be disabled or cleared by disconnect", { skip: !executablePath }, async () => {
  for (const remembered of [false, true]) {
    const server = await app();
    const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
    const page = await browser.newPage();
    const client = new Client({ name: "always-approval-test", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL(server.base + "/mcp"));
    const preference = "era-typescript.agent-auto-approve";
    try {
      const started = await (await server.post("/api/start", { mode: "game" })).json();
      await page.goto(server.base);
      if (remembered) {
        await page.evaluate(key => localStorage.setItem(key, "1"), preference);
        await page.reload();
      }
      await page.waitForFunction(() => !!window.eraQA && !window.eraQA.state().busy);
      assert.equal(await page.evaluate(id => window.eraQA.resume(id), started.session), true);
      let popupCount = 0;
      await page.exposeFunction("recordAgentPopup", () => { popupCount++; });
      await page.evaluate(() => {
        const dialog = document.querySelector("#agent-access");
        new MutationObserver(() => {
          if (dialog?.hasAttribute("open")) window.recordAgentPopup();
        }).observe(dialog!, { attributes: true, attributeFilter: ["open"] });
      });
      await client.connect(transport);
      if (!remembered) {
        await page.locator("#agent-access[open]").waitFor();
        assert.equal(await page.getByRole("button", { name: "Always approve", exact: true }).count(), 0);
        const checkbox = page.locator("#agent-auto-approve");
        await checkbox.check();
        await checkbox.focus();
        const spacing = await checkbox.evaluate(input => {
          const label = input.closest("label")!;
          const style = getComputedStyle(label);
          const buttons = document.querySelector("#agent-access .confirm-actions")!;
          return {
            gap: buttons.getBoundingClientRect().top - label.getBoundingClientRect().bottom,
            outline: parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset),
          };
        });
        assert.ok(spacing.gap >= spacing.outline + 4, JSON.stringify(spacing));
        assert.equal(await page.locator("#agent-access").isVisible(), true);
        assert.equal(await page.evaluate(key => localStorage.getItem(key), preference), null);
        assert.equal((await client.callTool({ name: "qa_context" })).isError, true, "checking the box must not grant access before Allow");
        await page.locator("#agent-allow").click();
      }
      await page.waitForFunction(() => document.querySelector("#agent-status")?.textContent === "Connected: always-approval-test");
      assert.equal(popupCount, remembered ? 0 : 1);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), preference), "1");
      assert.notEqual((await client.callTool({ name: "qa_context" })).isError, true);
      await page.reload();
      await page.waitForFunction(() => !!window.eraQA && !window.eraQA.state().busy);
      await page.waitForFunction(() => document.querySelector("#agent-status")?.textContent === "Connected: always-approval-test");
      assert.equal(await page.locator("#agent-auto-approve").isChecked(), true);
      await page.locator("#menu-toggle").click();
      await page.locator("#settings-toggle").click();
      await page.locator("#settings #agent-toggle").click();
      if (!remembered) {
        await page.locator("#agent-auto-approve").uncheck();
        assert.equal(await page.evaluate(key => localStorage.getItem(key), preference), null);
        assert.notEqual((await client.callTool({ name: "qa_context" })).isError, true, "turning off future approval does not revoke current access");
      }
      await page.locator("#agent-disconnect").click();
      await page.waitForFunction(() => document.querySelector("#agent-status")?.textContent === "No agent connected.");
      assert.equal(await page.evaluate(key => localStorage.getItem(key), preference), null);
      assert.equal(await page.locator("#agent-auto-approve").isChecked(), false);
      await assert.rejects(client.callTool({ name: "qa_context" }), /404|revoked/);
    } finally {
      await client.close();
      await browser.close();
      await server.close();
    }
  }
});

test("finishing, HTTP deletion and game restart revoke agent capabilities without stopping the game", async () => {
  for (const action of ["finish", "delete", "restart"]) {
    const server = await app();
    const client = new Client({ name: "lifecycle-test", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL(server.base + "/mcp"));
    try {
      const started = await (await server.post("/api/start", { mode: "game" })).json();
      await client.connect(transport);
      const pending = await (await server.post("/api/mcp/browser", { session: started.session })).json();
      const approval = { session: started.session, id: pending.pending.id, decision: "allow" };
      const approved = await (await server.post("/api/mcp/browser", approval)).json();
      assert.equal(approved.connected, true);
      assert.equal((await server.post("/api/mcp/browser", approval)).status, 200, "a retried approval is idempotent");
      let session = started;
      if (action === "finish") assert.notEqual((await client.callTool({ name: "qa_finish" })).isError, true);
      else if (action === "delete") await transport.terminateSession();
      else session = await (await server.post("/api/start", { mode: "game", previousSession: started.session })).json();
      assert.equal((await server.post("/api/debug", {
        session: started.session, step: started.step, command: { action: "read", expressions: ["FLAG:0"] },
      }, { Authorization: `Bearer ${approved.key}` })).status, 404);
      const input = await server.post("/api/input", { session: session.session, step: session.step, value: "7" });
      assert.equal(input.status, 200);
      assert.match(JSON.stringify(await input.json()), /Chose 7; count 0/);
    } finally {
      await client.close();
      await server.close();
    }
  }
});

test("local stdio adapter exposes embedded tools and respects denial", async () => {
  const server = await app();
  const started = await (await server.post("/api/start", { mode: "game" })).json();
  const client = new Client({ name: "adapter-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL("../src/mcp.ts", import.meta.url)), "--connect", server.base + "/mcp"],
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    assert.ok((await client.listTools()).tools.some(tool => tool.name === "qa_debug"));
    const waiting = await client.callTool({ name: "qa_context" });
    assert.equal(waiting.isError, true);
    const pending = await (await server.post("/api/mcp/browser", { session: started.session })).json();
    assert.equal(pending.pending.name, "era-stdio-adapter");
    assert.equal((await server.post("/api/mcp/browser", { session: started.session, id: "wrong", decision: "allow" })).status, 409);
    await server.post("/api/mcp/browser", { session: started.session, id: pending.pending.id, decision: "deny" });
    await assert.rejects(client.callTool({ name: "qa_observe" }), /404|revoked/);
  } finally {
    await client.close();
    await server.close();
  }
});
