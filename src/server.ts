import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compatibility } from "./compatibility.js";
import { demoGame } from "./demo.js";
import { GAME_ROOT, loadGame, type Game } from "./loader.js";
import { EraError, key } from "./model.js";
import { Runtime } from "./runtime.js";
import { FileGlobalStore, MemoryGlobalStore, type GlobalStore } from "./storage.js";

const WEB_ROOT = fileURLToPath(new URL("../web/", import.meta.url));
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".webp": "image/webp",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".bmp": "image/bmp",
};
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function json(response: ServerResponse, data: unknown, status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new HttpError(413, "Request body too large");
    chunks.push(buffer);
  }
  let data: unknown;
  try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new HttpError(400, "Invalid JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "Expected a JSON object");
  return data as Record<string, unknown>;
}
async function resourceFile(root: string, relative: string): Promise<string> {
  const base = await realpath(root);
  let resolved: string;
  try { resolved = await realpath(path.resolve(base, relative)); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new HttpError(404, `Resource not found: ${relative}`);
    throw error;
  }
  if (!resolved.startsWith(base + path.sep)) throw new HttpError(403, "Resource path outside game resources");
  if (![".png", ".webp", ".jpg", ".jpeg", ".gif", ".bmp"].includes(path.extname(resolved).toLowerCase()))
    throw new HttpError(403, "Unsupported image type");
  if (!(await stat(resolved)).isFile()) throw new HttpError(404, "Image file not found");
  return resolved;
}
export function createApp(game: Game, development = false, store: GlobalStore = game.root
  ? new FileGlobalStore(path.join(game.root, ".era-typescript", "global.json")) : new MemoryGlobalStore()) {
  const sessions = new Map<string, { runtime: Runtime; used: number }>();
  const report = compatibility(game);
  const instance = randomUUID();
  return createServer((request, response) => {
    void (async () => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      const host = request.headers.host ?? "";
      const allowedHost = /^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host);
      if (!allowedHost) throw new HttpError(403, "Only localhost access is allowed");
      const origin = request.headers.origin;
      if (origin && origin !== `http://${host}`) throw new HttpError(403, "Cross-origin requests are not allowed");
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (request.method === "GET" && url.pathname === "/api/runtime") {
        json(response, { instance, development });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/compatibility") { json(response, report); return; }
      if (request.method === "POST" && url.pathname === "/api/start") {
        const data = await body(request);
        if (data.mode !== "game" && data.mode !== "demo") throw new HttpError(400, "mode must be game or demo");
        if (data.columns !== undefined && (typeof data.columns !== "number" || !Number.isSafeInteger(data.columns) || data.columns < 20 || data.columns > 1000))
          throw new HttpError(400, "columns must be an integer from 20 to 1000");
        const now = Date.now();
        for (const [id, session] of sessions) if (now - session.used > 30 * 60_000) sessions.delete(id);
        if (typeof data.previousSession === "string") sessions.delete(data.previousSession);
        if (sessions.size >= 8) throw new HttpError(429, "Too many sessions; restart the server or wait for expiry");
        const id = randomUUID();
        try {
          const runtime = new Runtime(data.mode === "demo" ? demoGame(game) : game, 50_000, {
            store: data.mode === "game" ? store : new MemoryGlobalStore(),
            columns: typeof data.columns === "number" ? data.columns : 120,
          });
          const snapshot = runtime.start();
          if (snapshot.status === "waiting") sessions.set(id, { runtime, used: now });
          json(response, { session: id, ...snapshot });
        } catch (error) {
          if (!(error instanceof EraError)) throw error;
          json(response, { session: id, status: "error", output: [], input: null, error: error.diagnostic() });
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/input") {
        const data = await body(request);
        if (typeof data.session !== "string" || typeof data.value !== "string") throw new HttpError(400, "Expected session and value strings");
        const session = sessions.get(data.session);
        if (!session) throw new HttpError(404, "Session expired or does not exist; start a new run");
        session.used = Date.now();
        try {
          const snapshot = session.runtime.input(data.value);
          if (snapshot.status !== "waiting") sessions.delete(data.session);
          json(response, { session: data.session, ...snapshot });
        } catch (error) {
          if (!(error instanceof EraError)) throw error;
          throw new HttpError(400, error.message);
        }
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/sprite") {
        const name = url.searchParams.get("name") ?? "";
        const sprite = game.sprites.get(key(name));
        if (!sprite) throw new HttpError(404, `Unknown sprite: ${name}`);
        // Validate before handing metadata to the browser.
        await resourceFile(path.join(game.root, "resources"), sprite.file);
        json(response, { ...sprite, url: `/resources/${sprite.file.split(path.sep).map(encodeURIComponent).join("/")}` });
        return;
      }
      if (request.method === "GET" && url.pathname.startsWith("/resources/")) {
        let relative: string;
        try { relative = decodeURIComponent(url.pathname.slice("/resources/".length)); }
        catch (error) {
          if (!(error instanceof URIError)) throw error;
          throw new HttpError(400, "Invalid resource path encoding");
        }
        const file = await resourceFile(path.join(game.root, "resources"), relative);
        response.writeHead(200, { "Content-Type": mime[path.extname(file).toLowerCase()]! });
        response.end(await readFile(file));
        return;
      }
      const pages: Record<string, string> = { "/": "index.html", "/app.js": "app.js", "/style.css": "style.css" };
      const page = pages[url.pathname];
      if (request.method === "GET" && page) {
        response.writeHead(200, { "Content-Type": mime[path.extname(page)]! });
        response.end(await readFile(path.join(WEB_ROOT, page)));
        return;
      }
      throw new HttpError(404, "Not found");
    })().catch((error: unknown) => {
      if (error instanceof HttpError) json(response, { error: error.message }, error.status);
      else {
        console.error("Request failed:", error);
        if (!response.headersSent) json(response, { error: "Internal server error; see server log" }, 500);
        else response.destroy(error instanceof Error ? error : undefined);
      }
    });
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const rawPort = process.env.PORT ?? "3000";
    const port = Number(rawPort);
    if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535");
    console.log(`Loading ${GAME_ROOT} ...`);
    const game = await loadGame();
    const development = process.argv.includes("--dev");
    const app = createApp(game, development);
    app.on("error", (error) => { console.error(error); process.exitCode = 1; });
    app.listen(port, "127.0.0.1", () => {
      console.log(`Loaded ${game.scriptFiles} scripts, ${game.routines.size} function names and ${game.sprites.size} sprites`);
      console.log(`Open http://127.0.0.1:${port}`);
      if (development) console.log("Development watch enabled; changes restart the backend and reload browser tabs. Active sessions reset.");
    });
  } catch (error) {
    console.error("Startup failed:", error);
    process.exitCode = 1;
  }
}
