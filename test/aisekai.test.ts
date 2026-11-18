import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { chromium } from "playwright";
import { AISEKAI_ID } from "../src/aisekai.js";
import { emptyGame, GAMES_DIR, indexScript } from "../src/loader.js";
import { createApp } from "../src/server.js";
import { MemorySaveStore } from "../src/storage.js";

const executablePath = process.env.ERA_QA_BROWSER ?? [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(candidate => existsSync(candidate));

test("closing AiSekai LLM settings only refreshes the game when the saved connection changes", {
  skip: executablePath ? false : "Chrome/Chromium not found; set ERA_QA_BROWSER",
}, async () => {
  const game = emptyGame();
  indexScript(game, `@SYSTEM_TITLE
$MENU
HTML_PRINT "<button data-app-action='llm-settings'>LLM Settings</button><br>"
PRINTBUTTON "Return", 99
INPUT
IF RESULT == 14
    PRINTL Refreshed
    TWAIT 1, 1
    GOTO MENU
ENDIF
PRINTL Returned
WAIT`, "settings-test.erb");
  const app = createApp([{ id: AISEKAI_ID, title: "AiSekai settings fixture", game, saves: new MemorySaveStore() }]);
  const browser = await chromium.launch({ executablePath });
  try {
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const inputs: string[] = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/api/input") inputs.push(request.postDataJSON().value);
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.getByRole("button", { name: "Play game: AiSekai settings fixture", exact: true }).click();
    const settings = () => page.locator("#terminal .screen.is-active").getByRole("button", { name: "LLM Settings", exact: true });
    const dialog = page.locator("#llm-config");
    const cancel = async (escape = false) => {
      await settings().click();
      await dialog.locator("[name=model]").fill("discarded-model");
      if (escape) await dialog.press("Escape");
      else await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.waitForTimeout(100);
      assert.equal(await dialog.isVisible(), false);
      assert.deepEqual(inputs, []);
      assert.equal(await page.locator("#terminal .screen.is-active button.choice[data-value='99']").isEnabled(), true);
    };
    await cancel();
    await cancel(true);
    await cancel();
    await settings().click();
    await dialog.locator("[name=provider]").selectOption("local");
    await dialog.locator("[name=model]").fill("saved-model");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Refreshed", { exact: true }).waitFor();
    await settings().waitFor();
    assert.deepEqual(inputs, ["14"]);
    inputs.length = 0;
    await cancel(true);
    await cancel();
    await page.locator("#terminal:not(.is-settling) .screen.is-active button.choice[data-value='99']").click();
    await page.getByText("Returned", { exact: true }).waitFor();
    assert.deepEqual(inputs, ["99"]);
  } finally {
    await browser.close();
    await new Promise<void>(resolve => {
      app.close(() => resolve());
      app.closeAllConnections();
    });
  }
});

test("AiSekai routes bridge completions and context lookups through the configured app provider", async (t) => {
  const bundled = path.join(GAMES_DIR, "EraTohoTW AiSekai v0.6", "ai_bridge");
  try {
    if (!/\bexport function createBridge\b/.test(await readFile(path.join(bundled, "bridge.mjs"), "utf8"))) {
      t.skip("The installed AiSekai does not have the importable bridge update");
      return;
    }
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    t.skip("AiSekai fixture is not installed");
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), "era-aisekai-"));
  const previous = process.env.ERA_AISEKAI_BRIDGE;
  const calls: { route?: string; authorization?: string; payload?: { model: string; messages: unknown[] } }[] = [];
  let validKey = true;
  const responseText = "A patient scholar studies the stars from a quiet hill above the village.";
  const provider = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    calls.push({ route: request.url, authorization: request.headers.authorization, payload });
    response.writeHead(request.url === "/v1/key" && !validKey ? 401 : 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(request.url === "/v1/models"
      ? { data: [{ id: "mock-model", context_length: 8192 }] }
      : { choices: [{ message: { content: responseText } }] }));
  });
  const game = emptyGame(root);
  indexScript(game, String.raw`@SYSTEM_TITLE
SAVETEXT "TYPE=DESC\nREQ_ID=desc\nACTION=GENERATE\nCHAR_NAME=Sample\nEND=1\n", "sav/ai_q_1_1.txt"
WHILE !EXISTFILE("sav/ai_desc_res.xml")
    TWAIT 1, 1
WEND
PRINTSL LOADTEXT("sav/ai_desc_res.xml")
INPUT
SAVETEXT "TYPE=CONFIG\nREQ_ID=ctx\nACTION=CTX_CHECK\nEND=1\n", "sav/ai_q_1_2.txt"
WHILE !EXISTFILE("sav/ai_cmd_res.xml")
    TWAIT 1, 1
WEND
PRINTSL LOADTEXT("sav/ai_cmd_res.xml")
INPUT
SAVETEXT "TYPE=CONFIG\nREQ_ID=settings\nACTION=GET_CONFIG\nEND=1\n", "sav/ai_q_1_3.txt"
WHILE !EXISTFILE("sav/ai_cmd_res.xml")
    TWAIT 1, 1
WEND
PRINTSL LOADTEXT("sav/ai_cmd_res.xml")
FOR LOCAL, 0, 2
INPUT
SAVETEXT "TYPE=CONFIG\nREQ_ID=connection\nACTION=TEST_CONNECTION\nEND=1\n", "sav/ai_q_1_4.txt"
WHILE !EXISTFILE("sav/ai_cmd_res.xml")
    TWAIT 1, 1
WEND
PRINTSL LOADTEXT("sav/ai_cmd_res.xml")
NEXT
INPUT`, "bridge-test.erb");
  const saves = new MemorySaveStore();
  const app = createApp([{ id: AISEKAI_ID, title: "AiSekai fixture", game, saves }]);
  try {
    // Copy only code, never the installed game's keys, lore, or saves.
    await cp(path.join(bundled, "bridge.mjs"), path.join(root, "ai_bridge/bridge.mjs"));
    await cp(path.join(bundled, "lib"), path.join(root, "ai_bridge/lib"), { recursive: true });
    delete process.env.ERA_AISEKAI_BRIDGE;
    provider.listen(0, "127.0.0.1");
    app.listen(0, "127.0.0.1");
    await Promise.all([once(provider, "listening"), once(app, "listening")]);
    const origin = (server: typeof app) => {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      return `http://127.0.0.1:${address.port}`;
    };
    const aiSekai = { provider: "openrouter", endpoint: origin(provider) + "/v1", model: "mock-model", apiKey: "fixture-key", jsonMode: false };
    const metadata = await (await fetch(origin(app) + "/api/runtime")).json();
    assert.equal(metadata.games.find((entry: { id: string }) => entry.id === AISEKAI_ID)?.aiSekaiBridge, true);
    const post = async (route: string, body: object) => {
      const response = await fetch(origin(app) + route, { method: "POST", body: JSON.stringify({ ...body, aiSekai }) });
      assert.equal(response.status, 200);
      const snapshot = await response.json();
      assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
      return snapshot;
    };
    const untilInput = async (snapshot: Awaited<ReturnType<typeof post>>) => {
      const deadline = Date.now() + 5000;
      while (snapshot.input?.kind === "wait" && Date.now() < deadline) {
        await delay(15);
        snapshot = await post("/api/timeout", { session: snapshot.session, step: snapshot.step });
      }
      assert.equal(snapshot.input?.kind, "integer", JSON.stringify(snapshot));
      return snapshot;
    };
    const desc = await untilInput(await post("/api/start", { mode: "game", game: AISEKAI_ID }));
    assert.ok(JSON.stringify(desc.output).includes(responseText));
    const context = await untilInput(await post("/api/input", { session: desc.session, step: desc.step, value: "0" }));
    assert.match(JSON.stringify(context.output), /8,192 context tokens/);
    const next = async (snapshot: typeof context) => untilInput(await post("/api/input", { session: snapshot.session, step: snapshot.step, value: "0" }));
    const settings = await next(context);
    assert.match(JSON.stringify(settings.output), /PROVIDER=openrouter.*ACTIVE_MODEL=mock-model/);
    assert.ok(!JSON.stringify(settings).includes("fixture-key"));
    const success = await next(settings);
    assert.match(JSON.stringify(success.output), /OpenRouter is reachable and the API key is valid/);
    validKey = false;
    const failure = await next(success);
    assert.match(JSON.stringify(failure.output), /Authentication failed \(HTTP 401\)/);
    assert.deepEqual(calls.map(call => [call.route, call.authorization]), [
      ["/v1/chat/completions", "Bearer fixture-key"], ["/v1/models", "Bearer fixture-key"],
      ["/v1/key", "Bearer fixture-key"], ["/v1/key", "Bearer fixture-key"],
    ]);
    assert.equal(calls[0]?.payload?.model, "mock-model");
    assert.ok(calls[0]?.payload?.messages.length);
    assert.ok(!JSON.stringify(context).includes("fixture-key"));
    assert.deepEqual(saves.list(), []);
  } finally {
    if (previous === undefined) delete process.env.ERA_AISEKAI_BRIDGE;
    else process.env.ERA_AISEKAI_BRIDGE = previous;
    await Promise.all([app, provider].map(server => new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
    })));
    await rm(root, { recursive: true, force: true });
  }
});
