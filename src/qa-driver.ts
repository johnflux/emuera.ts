import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { chromium, type Browser, type Page } from "playwright";
import { z } from "zod";
import { COMPONENT_SAMPLES } from "./component-demo.js";
import { debugCommand, type DebugCommand } from "./debugger.js";

const runSchema = z.object({ session: z.string(), step: z.number().int() }).passthrough();
type Run = z.infer<typeof runSchema>;
type QaGlobal = typeof globalThis & {
  eraQA?: {
    state(): { session: string | null; step: number; busy: boolean; rendering: boolean };
    observe(): unknown;
    ready(): Promise<void>;
    resume(session: string): Promise<boolean>;
    validate(ref: string): boolean;
  };
};
const viewportSchema = z.object({
  width: z.number().int().min(320).max(3840).default(1440),
  height: z.number().int().min(240).max(2160).default(900),
});
const controlRef = z.string().regex(/^c\d+$/);
const uiAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), ref: controlRef }),
  z.object({ kind: z.literal("hover"), ref: controlRef }),
  z.object({ kind: z.literal("fill"), ref: controlRef, text: z.string().max(100_000) }),
  z.object({ kind: z.literal("select"), ref: controlRef, value: z.string().max(4096) }),
  z.object({ kind: z.literal("press"), key: z.string().min(1).max(100), ref: controlRef.optional() }),
  z.object({ kind: z.literal("scroll"), x: z.number().min(-10000).max(10000).default(0), y: z.number().min(-10000).max(10000), ref: controlRef.optional() }),
]);

/** One driver owns one run and browser context; it never attaches to a player's ordinary server. */
export class QaDriver {
  private browser: Browser | undefined;
  private page: Page | undefined;
  private run: Run | undefined;
  private messages: { type: string; text: string }[] = [];
  private actions: { time: string; action: string; details: unknown }[] = [];
  constructor(private base: string, private token: string) {}

  private record(action: string, details: unknown): void {
    this.actions.push({ time: new Date().toISOString(), action, details });
    if (this.actions.length > 2000) this.actions.shift();
  }
  private diagnostic(type: string, text: string): void {
    this.messages.push({ type, text: text.slice(0, 4000) });
    if (this.messages.length > 200) this.messages.shift();
  }
  private async request(route: string, data?: unknown): Promise<unknown> {
    const response = await fetch(this.base + route, {
      headers: { Authorization: `Bearer ${this.token}`, ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(data === undefined ? {} : { method: "POST", body: JSON.stringify(data) }),
    });
    const result: unknown = await response.json();
    const run = runSchema.safeParse(result);
    if (run.success) this.run = { ...this.run, ...run.data };
    if (!response.ok) throw new Error(`${route} (${response.status}): ${JSON.stringify(result)}`);
    return result;
  }
  async games(): Promise<unknown> {
    return { runtime: await this.request("/api/runtime"), fixtures: COMPONENT_SAMPLES };
  }
  async context(): Promise<unknown> {
    const run = await this.current();
    return this.request("/api/debug", { session: run.session, step: run.step, command: { action: "context" } });
  }
  private async ready(): Promise<Page> {
    const page = this.page;
    if (!page) throw new Error("No graphical run; call qa_start with graphical: true");
    await page.waitForFunction(() => {
      const bridge = (globalThis as QaGlobal).eraQA;
      return bridge && !bridge.state().busy && !bridge.state().rendering;
    }, undefined, { timeout: 30_000 });
    await page.evaluate(() => (globalThis as QaGlobal).eraQA!.ready());
    const current = runSchema.safeParse(await page.evaluate(() => (globalThis as QaGlobal).eraQA!.state()));
    if (current.success) this.run = current.data;
    return page;
  }
  private async synchronize(): Promise<void> {
    if (!this.page || !this.run) return;
    await this.ready();
    await this.page.evaluate(session => (globalThis as QaGlobal).eraQA!.resume(session), this.run.session);
    await this.ready();
  }
  private async current(): Promise<Run> {
    if (this.page) await this.ready();
    if (!this.run) throw new Error("No active run; call qa_start first");
    return this.run;
  }
  async start(options: {
    game?: string | undefined; fixture?: typeof COMPONENT_SAMPLES[number] | undefined;
    graphical: boolean; headed: boolean; viewport: { width: number; height: number };
  }): Promise<unknown> {
    const previous = this.run?.session;
    await this.closeBrowser();
    this.actions = [];
    this.messages = [];
    const started = await this.request("/api/start", {
      mode: options.fixture ? "demo" : "game", game: options.game, debug: true,
      ...(options.fixture ? { component: options.fixture } : {}), previousSession: previous,
      client: { ...options.viewport, active: true },
    });
    this.run = runSchema.parse(started);
    this.record("start", options);
    if (options.graphical) {
      const executable = process.env.ERA_QA_BROWSER ?? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
      ].find((candidate): candidate is string => !!candidate && existsSync(candidate));
      try {
        this.browser = await chromium.launch({ headless: !options.headed, ...(executable ? { executablePath: executable } : {}) });
        const context = await this.browser.newContext({ viewport: options.viewport });
        // QA does not invoke external LLMs, open external pages, or send game data off-machine.
        await context.route("**/*", route => {
          const url = new URL(route.request().url());
          return url.origin === this.base || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort("blockedbyclient");
        });
        this.page = await context.newPage();
        this.page.on("console", message => {
          if (message.type() === "error" || message.type() === "warning") this.diagnostic(message.type(), message.text());
        });
        this.page.on("pageerror", error => this.diagnostic("pageerror", error.message));
        this.page.on("requestfailed", request => this.diagnostic("requestfailed", `${request.url()}: ${request.failure()?.errorText}`));
        this.page.on("response", response => {
          if (response.status() >= 400) this.diagnostic("http", `${response.status()} ${response.url()}`);
        });
        this.page.on("dialog", dialog => { this.diagnostic("dialog", `${dialog.type()}: ${dialog.message()}`); void dialog.dismiss(); });
        await this.page.goto(this.base);
        await this.synchronize();
      } catch (error) {
        await this.closeBrowser();
        throw new Error(`Could not open QA browser: ${error instanceof Error ? error.message : String(error)}. Set ERA_QA_BROWSER to Chrome/Chromium or run npx playwright install chromium. The headless run is still available.`);
      }
    }
    return this.observe();
  }
  async observe(): Promise<unknown> {
    const run = await this.current();
    if (this.page) return {
      view: await this.page.evaluate(() => (globalThis as QaGlobal).eraQA!.observe()),
      diagnostics: this.messages, isolated: true,
    };
    const state = await this.request("/api/debug", { session: run.session, step: run.step, command: { action: "state" } });
    return { ...run, state, diagnostics: this.messages, isolated: true, graphical: false };
  }
  async input(value: string, timeout: boolean): Promise<unknown> {
    const run = await this.current();
    const result = await this.request(timeout ? "/api/timeout" : "/api/input", { session: run.session, step: run.step, value });
    this.record(timeout ? "timeout" : "input", { value, step: run.step });
    await this.synchronize();
    return this.page ? this.observe() : result;
  }
  async debug(command: DebugCommand): Promise<unknown> {
    const run = await this.current();
    this.record("debug", command);
    const mutation = ["write", "evaluate", "call", "seed"].includes(command.action);
    try { return await this.request("/api/debug", { session: run.session, step: run.step, command }); }
    finally { if (mutation) await this.synchronize(); }
  }
  async loadSave(file: string): Promise<unknown> {
    const run = await this.current();
    const bytes = await readFile(file);
    if (bytes.length > 40 * 1024 * 1024) throw new Error("Native save fixture exceeds 40 MiB");
    const basename = path.basename(file);
    const result = await this.request("/api/debug/save", {
      session: run.session, step: run.step, base64: bytes.toString("base64"),
      name: /^save\d+\.sav$/i.test(basename) ? basename : "save999.sav",
    });
    this.record("load_save", { file });
    await this.synchronize();
    return this.page ? this.observe() : result;
  }
  async act(action: z.infer<typeof uiAction>): Promise<unknown> {
    const page = await this.ready();
    const locator = "ref" in action && action.ref ? page.locator(`[data-era-qa-ref="${action.ref}"]`) : undefined;
    if ("ref" in action && action.ref) await page.evaluate(ref => (globalThis as QaGlobal).eraQA!.validate(ref), action.ref);
    this.record("ui", action);
    switch (action.kind) {
      case "click": await locator!.click(); break;
      case "hover": await locator!.hover(); break;
      case "fill": await locator!.fill(action.text); break;
      case "select": await locator!.selectOption(action.value); break;
      case "press": if (locator) await locator.press(action.key); else await page.keyboard.press(action.key); break;
      case "scroll":
        if (locator) await locator.hover();
        await page.mouse.wheel(action.x, action.y);
        break;
    }
    await this.ready();
    return this.observe();
  }
  async screenshot(): Promise<Buffer> {
    const page = await this.ready();
    return page.screenshot({ animations: "disabled" });
  }
  async report(): Promise<unknown> {
    const observation = await this.observe();
    const directory = await mkdtemp(path.join(tmpdir(), "era-qa-"));
    const report = path.join(directory, "report.json");
    await writeFile(report, JSON.stringify({ actions: this.actions, observation }, null, 2), { mode: 0o600 });
    const screenshot = this.page ? path.join(directory, "screenshot.png") : undefined;
    if (screenshot) await writeFile(screenshot, await this.screenshot(), { mode: 0o600 });
    return { report, screenshot, actions: this.actions.length };
  }
  private async closeBrowser(): Promise<void> {
    this.page = undefined;
    const browser = this.browser;
    this.browser = undefined;
    await browser?.close();
  }
  async close(): Promise<void> {
    try { await this.closeBrowser(); }
    finally {
      if (this.run) await this.request("/api/stop", { session: this.run.session });
      this.run = undefined;
    }
  }
}

export type QaTools = Pick<QaDriver, "games" | "context" | "start" | "observe" | "act" | "input" | "debug" | "loadSave" | "screenshot" | "report" | "close">;

export function createQaMcpServer(driver: QaTools, live = false): McpServer {
  const server = new McpServer({ name: "era-qa", version: "1.0.0" }, {
    instructions: live
      ? "Live Emuera debugger. The player must approve access in the game. Use qa_observe first; qa_start and qa_load_save are isolated-mode only. Actions and variable/function changes affect the player's actual running game and can be saved normally. No source editing. Debug integer values are decimal strings. Re-observe after changes. qa_act uses DOM events, not trusted OS input. Screenshots require the desktop app. qa_finish disconnects without stopping the game."
      : "Local Emuera QA debugger. Start a game or fixture, observe controls, then act. qa_act uses real UI events; qa_input bypasses the UI. Debug values use decimal strings to preserve Int64 precision. Mutations can affect game logic; stores are isolated in memory. Timers and prefetch are disabled. Re-observe after changes. Use qa_report before qa_finish to retain evidence.",
  });
  let queue = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
  const execute = (work: () => Promise<unknown>) => serial(async () => {
    try { return text(await work()); }
    catch (error) { return { ...text({ error: error instanceof Error ? error.message : String(error) }), isError: true }; }
  });
  server.registerTool("qa_games", { description: "List installed games and real game-screen fixtures.", inputSchema: {} }, () => execute(() => driver.games()));
  server.registerTool("qa_context", {
    description: "Identify the running game, absolute game/ERB/CSV/hotpatch paths and loaded routine source files. Use the agent client's file tools for edits: game logic belongs in upstream ERB files; hotpatches are for browser GUI changes. Scripts are cached; source changes require a restart, not an automatic hot reload.",
    inputSchema: {},
  }, () => execute(() => driver.context()));
  server.registerTool("qa_start", {
    description: live ? "Unavailable in live mode: use qa_observe to attach to the player-approved game. Use isolated stdio mode to start separate runs." : "Start an isolated game or component fixture. Graphical mode enables real UI controls and screenshots; headed shows its browser window.",
    inputSchema: { game: z.string().optional(), fixture: z.enum(COMPONENT_SAMPLES).optional(), graphical: z.boolean().default(true), headed: z.boolean().default(false), viewport: viewportSchema.default({ width: 1440, height: 900 }) },
  }, options => execute(() => driver.start(options)));
  server.registerTool("qa_observe", { description: "List all rendered controls, playable button values, labels, enabled states, bounds, visible text, errors and current step. Headless mode returns runtime state and candidate command values.", inputSchema: {} }, () => execute(() => driver.observe()));
  server.registerTool("qa_act", { description: `${live ? "Live DOM" : "Real browser"} click, hover, fill, select, keypress or scroll. Use refs from the latest observation. Does not bypass disabled or occluded controls.`, inputSchema: { action: uiAction } }, ({ action }) => execute(() => driver.act(action)));
  server.registerTool("qa_input", { description: "Send an Emuera button value/text directly, continue with an empty value, or explicitly expire a timed wait. Bypasses browser event handlers; use qa_act for graphical QA.", inputSchema: { value: z.string().max(16_000).default(""), timeout: z.boolean().default(false) } }, ({ value, timeout }) => execute(() => driver.input(value, timeout)));
  server.registerTool("qa_debug", { description: "Full runtime debugging: list global/character variables and routine signatures; read values or log watched expressions with state; write typed values; evaluate ERB expressions; call #FUNCTION(S) with ERB expression arguments; seed RNG. Reads reject calls/increments/RAND; evaluate/call may mutate. Functions use normal Emuera restrictions and a 1M instruction budget; failed calls may have partial side effects. Changes do not automatically rerun game display routines.", inputSchema: { command: debugCommand } }, ({ command }) => execute(() => driver.debug(command)));
  server.registerTool("qa_load_save", { description: "Load an existing native .sav fixture from an explicit local path into the isolated run. Never modifies the source file or native save layout.", inputSchema: { file: z.string().min(1) } }, ({ file }) => execute(() => driver.loadSave(file)));
  server.registerTool("qa_screenshot", { description: live ? "Capture the actual desktop game window as a PNG MCP image. Browser-hosted live mode does not support screenshots; use isolated graphical mode instead." : "Capture the actual browser viewport as a PNG MCP image.", inputSchema: {} }, () => serial(async () => {
    try { return { content: [{ type: "image" as const, data: (await driver.screenshot()).toString("base64"), mimeType: "image/png" }] }; }
    catch (error) { return { ...text({ error: error instanceof Error ? error.message : String(error) }), isError: true }; }
  }));
  server.registerTool("qa_report", { description: live ? "Write a local JSON observation report to a new temporary directory. Returns its path. No external upload." : "Write a persistent local JSON action/state/error report and screenshot to a new temporary directory. Returns paths. No external upload.", inputSchema: {} }, () => execute(() => driver.report()));
  server.registerTool("qa_finish", { description: live ? "Revoke agent access without closing or stopping the player's game." : "Close the QA browser and runtime session. In-memory saves last only for this MCP process.", inputSchema: {} }, () => execute(async () => { await driver.close(); return { closed: true }; }));
  return server;
}
