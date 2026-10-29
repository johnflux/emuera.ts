import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compatibility } from "./compatibility.js";
import { demoGame } from "./demo.js";
import { applyHotpatches, displayDefaults, displayMetrics, discoverGames, emptyGame, gameDirectory, GAMES_DIR, KNOWN_GAMES, isGameRoot, loadGame, stillFrame, type DisplaySettings, type Game } from "./loader.js";
import { CATALOG_UPDATED, downloadedCatalogGames, GAME_CATALOG, installGame } from "./library.js";
import { EraError, key } from "./model.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type BackgroundLayer, type ClientState, type Snapshot } from "./runtime.js";
import { FileGlobalStore, FileSaveStore, gameSaveDirectory, MemoryGlobalStore, MemorySaveStore, type GlobalStore, type SaveStore } from "./storage.js";
import { patchTitleImage } from "./render-patches.js";

type BrowserSnapshot = ReturnType<typeof patchTitleImage>;

const WEB_ROOT = fileURLToPath(new URL("../web/", import.meta.url));
/** Drop-in pictures that replace the game's text maps: web/maps/<map key>.(webp|svg|png|jpg) plus optional <key>.json. */
const MAP_PICTURE = /^([a-z0-9-]+)\.(webp|svg|png|jpg)$/;
const MAP_PREFERENCE = ["webp", "svg", "png", "jpg"];
interface MapEntry { image?: string; layout?: unknown; error?: string }
/** Map key → picture URL (versioned by modification time so replaced files show at once) and parsed layout. */
async function mapManifest(root: string): Promise<Record<string, MapEntry>> {
  const files = await readdir(root).catch(() => [] as string[]);
  const maps: Record<string, MapEntry> = {};
  const entry = (name: string) => maps[name] ??= {};
  for (const file of files.sort((a, b) => MAP_PREFERENCE.indexOf(path.extname(a).slice(1)) - MAP_PREFERENCE.indexOf(path.extname(b).slice(1)))) {
    const picture = MAP_PICTURE.exec(file);
    if (picture) {
      if (!entry(picture[1]!).image) entry(picture[1]!).image = `/maps/${file}?v=${Math.round((await stat(path.join(root, file))).mtimeMs)}`;
    } else if (/^[a-z0-9-]+\.json$/.test(file)) {
      const name = file.slice(0, -5);
      try { entry(name).layout = JSON.parse(await readFile(path.join(root, file), "utf8")); }
      catch (error) { entry(name).error = `web/maps/${file}: ${error instanceof Error ? error.message : String(error)}`; }
    }
  }
  return maps;
}
/** Main-screen header pictures: web/areas/<map id>-<name>/<season>-<day|night>-<left|middle|right>.png (src/area-art.ts). */
const AREA_DIR = /^(\d+)-[a-z]+$/;
const AREA_PICTURE = /^((?:spring|summer|autumn|winter)-(?:day|night))-(left|middle|right)\.png$/;
/** Map id → "<season>-<day|night>" → part → picture URL (versioned by modification time). */
async function areaManifest(root: string): Promise<Record<string, Record<string, Record<string, string>>>> {
  const areas: Record<string, Record<string, Record<string, string>>> = {};
  for (const dir of await readdir(root).catch(() => [] as string[])) {
    const area = AREA_DIR.exec(dir);
    if (!area) continue;
    for (const file of await readdir(path.join(root, dir)).catch(() => [] as string[])) {
      const picture = AREA_PICTURE.exec(file);
      if (!picture) continue;
      const version = Math.round((await stat(path.join(root, dir, file))).mtimeMs);
      ((areas[area[1]!] ??= {})[picture[1]!] ??= {})[picture[2]!] = `/areas/${dir}/${file}?v=${version}`;
    }
  }
  return areas;
}
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".webp": "image/webp",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".bmp": "image/bmp",
  ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac", ".m4a": "audio/mp4", ".aac": "audio/aac",
};
/** How the browser renders a step: a fresh run, after a submitted input, after a click-to-continue, or a timeout. */
type Advance = "start" | "input" | "continue" | "timeout";
/** A game the server runs; the first entry is the default, and also hosts the conformance demo. */
export interface GameEntry {
  id: string; title: string; game: Game; store?: GlobalStore; saves?: SaveStore;
  /** Loads the game in Emuera's debug mode (with its [IF_DEBUG] code); by default a copy of `game` with the debug flag. */
  loadDebug?: () => Promise<Game>;
}
interface Session {
  runtime: Runtime;
  used: number;
  mode: "game" | "demo";
  game: string;
  debug: boolean;
  /** The delivered steps, oldest first, trimmed to HISTORY_BYTES. */
  history: { advance: Advance; snapshot: BrowserSnapshot; bytes: number }[];
  bytes: number;
  /** Steps delivered so far (not trimmed), so a stale tab's input can be refused. */
  step: number;
  /** The CBG layers as last delivered, which a trimmed history may no longer contain. */
  cbg?: BackgroundLayer[];
  cbgMap?: Snapshot["cbgMap"];
  tooltip?: Snapshot["tooltip"];
  audio?: Snapshot["audio"];
  textbox?: string;
}
const HISTORY_BYTES = 8 * 1024 * 1024;
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
async function resourceFile(root: string, relative: string, audio = false): Promise<string> {
  const base = await realpath(root);
  let resolved: string;
  try { resolved = await realpath(path.resolve(base, relative)); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new HttpError(404, `Resource not found: ${relative}`);
    throw error;
  }
  if (!resolved.startsWith(base + path.sep)) throw new HttpError(403, "Resource path outside game resources");
  if (!(audio ? [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"] : [".png", ".webp", ".jpg", ".jpeg", ".gif", ".bmp"]).includes(path.extname(resolved).toLowerCase()))
    throw new HttpError(403, audio ? "Unsupported audio type" : "Unsupported image type");
  if (!(await stat(resolved)).isFile()) throw new HttpError(404, "Image file not found");
  return resolved;
}
function displaySettings(value: unknown): Partial<DisplaySettings> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "display must be an object");
  const result: Partial<DisplaySettings> = {};
  for (const [name, setting] of Object.entries(value)) {
    if (name === "foreground" || name === "background" || name === "selection") {
      if (typeof setting !== "string" || !/^#[0-9a-f]{6}$/i.test(setting)) throw new HttpError(400, `display.${name} must be a #rrggbb color`);
      result[name] = setting.toLowerCase();
    } else if (name === "font") {
      if (typeof setting !== "string" || setting.length > 100 || /["\\;{}<>]/.test(setting)) throw new HttpError(400, "display.font is not a valid font name");
      result.font = setting;
    } else throw new HttpError(400, `Unknown display setting: ${name}`);
  }
  return result;
}
function clientState(value: unknown): ClientState | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "client must be an object");
  const fields = value as Record<string, unknown>;
  const { width, height, active } = fields;
  if (typeof width !== "number" || typeof height !== "number"
    || ![width, height].every((size) => Number.isSafeInteger(size) && size >= 0 && size <= 65535)
    || typeof active !== "boolean") throw new HttpError(400, "client requires integer width/height from 0 to 65535 and a boolean active");
  const result: ClientState = { width, height, active };
  for (const axis of ["mouseX", "mouseY"] as const) {
    const position = fields[axis];
    if (position === undefined) continue;
    if (typeof position !== "number" || !Number.isInteger(position) || position < -2147483648 || position > 2147483647)
      throw new HttpError(400, "client mouse coordinates must be signed 32-bit integers");
    result[axis] = position;
  }
  return result;
}

/**
 * Serves the browser UI for one or more games. Each game keeps its global data and saves in its own
 * Emuera save directory, and its resources/ images are served at /resources/ (the default game) or
 * /games/<id>/resources/.
 */
export function createApp(games: Game | readonly GameEntry[], development = false, gamesDir = GAMES_DIR) {
  gamesDir = path.resolve(gamesDir);
  const list = Array.isArray(games) ? games as readonly GameEntry[] : [{ id: "game", title: "Game", game: games as Game }];
  function register(entry: GameEntry, index: number) {
    const { game } = entry;
    if (!/^[a-z0-9-]+$/.test(entry.id)) throw new Error(`Invalid game id: ${entry.id}`);
    game.resourceBase = index === 0 ? "/resources/" : `/games/${entry.id}/resources/`;
    const saveDirectory = game.root && gameSaveDirectory(game.root, game.config);
    return {
      ...entry,
      store: entry.store ?? (saveDirectory ? new FileGlobalStore(path.join(saveDirectory, "global.sav")) : new MemoryGlobalStore()),
      saves: entry.saves ?? (saveDirectory ? new FileSaveStore(saveDirectory, path.join(game.root, "dat")) : new MemorySaveStore()),
      report: undefined as ReturnType<typeof compatibility> | undefined,
      debugGame: undefined as Promise<Game> | undefined,
    };
  }
  const entries = new Map(list.map((entry, index) => [entry.id, register(entry, index)]));
  const demoEntry = register({ id: "demo", title: "Demo", game: emptyGame() }, 0);
  const defaultEntry = () => entries.values().next().value ?? demoEntry;
  const entryFor = (id: unknown) => {
    if (id === undefined || id === null) {
      const entry = defaultEntry();
      if (entry === demoEntry) throw new HttpError(404, "No installed games. Choose a game from the library.");
      return entry;
    }
    const entry = typeof id === "string" ? entries.get(id) : undefined;
    if (!entry) throw new HttpError(404, `Unknown game: ${String(id)}`);
    return entry;
  };
  const sessions = new Map<string, Session>();
  function executionBreadcrumb(id: string, game: string, step: number, action: string, debug: boolean): void {
    if (!development) return;
    const { heapUsed, heapTotal, rss } = process.memoryUsage();
    writeSync(2, `[era execution] ${JSON.stringify({ pid: process.pid, session: id, game, step, action, debug,
      heapUsedMiB: Math.round(heapUsed / 1048576), heapTotalMiB: Math.round(heapTotal / 1048576), rssMiB: Math.round(rss / 1048576) })}\n`);
  }
  /** Delivers a step's snapshot and records it so a reloaded page can replay the run (see /api/resume). */
  function deliver(response: ServerResponse, id: string, session: Session | undefined, advance: Advance, snapshot: Snapshot, game: Game, gameId = session?.game ?? path.basename(game.root)): void {
    const patched = patchTitleImage(game, snapshot);
    if (patched.error?.context) patched.error.context.server = {
      game: gameId, session: id, step: session ? session.step + 1 : 0, action: advance,
    };
    if (session) {
      session.step++;
      if (patched.cbg) session.cbg = patched.cbg;
      if (patched.cbgMap !== undefined) session.cbgMap = patched.cbgMap;
      if (patched.tooltip) session.tooltip = patched.tooltip;
      if (patched.audio) session.audio = { ...patched.audio, sounds: [], stopSounds: true };
      if (patched.textbox !== undefined) session.textbox = patched.textbox;
      else if (advance === "input") session.textbox = "";
      const bytes = JSON.stringify(patched).length;
      session.history.push({ advance, snapshot: patched, bytes });
      session.bytes += bytes;
      // The oldest steps go first; the browser keeps a bounded scrollback anyway.
      while (session.bytes > HISTORY_BYTES && session.history.length > 1) session.bytes -= session.history.shift()!.bytes;
    }
    json(response, { session: id, step: session?.step ?? 0, ...patched });
  }
  const demo = demoGame(defaultEntry().game);
  let debugDemo: Game | undefined;
  /** Debug-mode games are loaded the first time a debug run asks for one. */
  const debugGame = (entry: ReturnType<typeof register>): Promise<Game> => entry.debugGame ??= (async () => {
    const game = entry.loadDebug ? await entry.loadDebug() : { ...entry.game };
    game.debug = true;
    game.resourceBase = entry.game.resourceBase;
    return game;
  })().catch((error: unknown) => { entry.debugGame = undefined; throw error; });
  const instance = randomUUID();
  let installing = false;
  async function refreshGames() {
    const known = KNOWN_GAMES.map((game) => ({ ...game, root: path.join(gamesDir, path.relative(GAMES_DIR, game.root)) }));
    for (const definition of discoverGames(gamesDir, known)) {
      if (!isGameRoot(definition.root) || [...entries.values()].some((entry) => entry.game.root === definition.root)) continue;
      if (entries.has(definition.id)) throw new HttpError(409, `Game id already in use: ${definition.id}`);
      const load = async (debug = false) => {
        const game = await loadGame(definition.root, { debug });
        if (definition.hotpatch) await applyHotpatches(game, definition.hotpatch);
        return game;
      };
      entries.set(definition.id, register({ id: definition.id, title: definition.title, game: await load(), loadDebug: () => load(true) }, entries.size));
    }
  }
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
      if (request.method === "GET" && url.pathname === "/api/library") {
        json(response, {
          installed: [...entries.values()].map(({ id, title, game }) => {
            const relative = path.relative(gamesDir, game.root);
            const catalog = GAME_CATALOG.find((item) => item.id === id || relative.split(path.sep)[0]?.toLowerCase() === item.folder.toLowerCase());
            return { id, title: catalog?.title ?? title, blurb: catalog?.blurb ?? "A locally installed ERB game.", genre: catalog?.genre ?? "Local game", catalogId: catalog?.id, monogram: catalog?.monogram };
          }),
          downloaded: await downloadedCatalogGames(gamesDir),
          catalog: GAME_CATALOG,
          catalogUpdated: CATALOG_UPDATED,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/library/refresh") {
        await body(request);
        await refreshGames();
        json(response, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/library/install") {
        const data = await body(request);
        const game = GAME_CATALOG.find((item) => item.id === data.id);
        if (!game || (!game.repository && !game.archive)) throw new HttpError(400, "Choose a catalog game with an available ZIP or Git repository.");
        if (installing) throw new HttpError(409, "Another game is being installed. Please wait.");
        installing = true;
        try {
          await installGame(game, gamesDir);
          await refreshGames();
          json(response, { ok: true });
        } catch (error) {
          console.error(`Installation failed for ${game.title}:`, error);
          throw new HttpError(400, `Could not install ${game.title}: ${error instanceof Error ? error.message : String(error)} Use ${game.archive ? "Download ZIP manually" : "the project page"} to download it manually.`);
        } finally { installing = false; }
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/runtime") {
        const games = [...entries.values()].map(({ id, title, game }) => ({ id, title, display: displayDefaults(game), metrics: displayMetrics(game) }));
        json(response, { instance, development, games, display: displayDefaults(defaultEntry().game), metrics: displayMetrics(defaultEntry().game) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/stop") {
        const data = await body(request);
        if (typeof data.session !== "string") throw new HttpError(400, "Expected a session string");
        sessions.delete(data.session);
        json(response, { ok: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/compatibility") {
        const entry = entryFor(url.searchParams.get("game"));
        json(response, entry.report ??= compatibility(entry.game));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/start") {
        const data = await body(request);
        if (data.mode !== "game" && data.mode !== "demo") throw new HttpError(400, "mode must be game or demo");
        const entry = data.mode === "demo" ? defaultEntry() : entryFor(data.game);
        if (data.debug !== undefined && typeof data.debug !== "boolean") throw new HttpError(400, "debug must be a boolean");
        const debug = data.debug === true;
        const display = displaySettings(data.display);
        const client = clientState(data.client);
        if (data.columns !== undefined && (typeof data.columns !== "number" || !Number.isSafeInteger(data.columns) || data.columns < 20 || data.columns > 1000))
          throw new HttpError(400, "columns must be an integer from 20 to 1000");
        const now = Date.now();
        for (const [id, session] of sessions) if (now - session.used > 30 * 60_000) sessions.delete(id);
        if (typeof data.previousSession === "string") sessions.delete(data.previousSession);
        if (sessions.size >= 8) throw new HttpError(429, "Too many sessions; restart the server or wait for expiry");
        const id = randomUUID();
        try {
          const game = data.mode === "demo" ? debug ? debugDemo ??= { ...demo, debug: true } : demo
            : debug ? await debugGame(entry) : entry.game;
          const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, {
            store: data.mode === "game" ? entry.store : new MemoryGlobalStore(),
            saves: data.mode === "game" ? entry.saves : new MemorySaveStore(),
            columns: typeof data.columns === "number" ? data.columns : 120,
            ...(display ? { display } : {}),
            ...(client ? { client } : {}),
          });
          executionBreadcrumb(id, entry.id, 0, "start", debug);
          const snapshot = runtime.start();
          const session: Session | undefined = snapshot.status === "waiting"
            ? { runtime, used: now, mode: data.mode, game: entry.id, debug, history: [], bytes: 0, step: 0 } : undefined;
          if (session) sessions.set(id, session);
          deliver(response, id, session, "start", snapshot, game, entry.id);
        } catch (error) {
          if (!(error instanceof EraError)) throw error;
          json(response, { session: id, status: "error", output: [], input: null, error: error.diagnostic() });
        }
        return;
      }
      if (request.method === "POST" && (url.pathname === "/api/input" || url.pathname === "/api/timeout")) {
        const timeout = url.pathname === "/api/timeout";
        const data = await body(request);
        if (typeof data.session !== "string" || (!timeout && typeof data.value !== "string")) throw new HttpError(400, "Expected session and value strings");
        if (data.columns !== undefined && (typeof data.columns !== "number" || !Number.isSafeInteger(data.columns) || data.columns < 20 || data.columns > 1000))
          throw new HttpError(400, "columns must be an integer from 20 to 1000");
        const display = displaySettings(data.display);
        const client = clientState(data.client);
        const session = sessions.get(data.session);
        if (!session) throw new HttpError(404, "Session expired or does not exist; start a new run");
        // Another tab (a duplicate of this one) has moved the run on; this page must resume to catch up.
        if (data.step !== undefined && data.step !== session.step) throw new HttpError(409, "This run was continued in another tab");
        session.used = Date.now();
        try {
          if (typeof data.columns === "number") session.runtime.setColumns(data.columns);
          if (display) session.runtime.setDisplay(display);
          if (client) session.runtime.setClient(client);
          const waiting = session.history.at(-1)?.snapshot.input?.kind === "wait";
          const kind = session.history.at(-1)?.snapshot.input?.kind ?? "unknown";
          executionBreadcrumb(data.session, session.game, session.step, `${timeout ? "timeout" : "input"} (${kind})`, session.debug);
          const snapshot = timeout ? session.runtime.timeout() : session.runtime.input(data.value as string);
          if (snapshot.status !== "waiting") sessions.delete(data.session);
          deliver(response, data.session, session, timeout ? "timeout" : waiting ? "continue" : "input", snapshot, session.runtime.game);
        } catch (error) {
          if (!(error instanceof EraError)) throw error;
          throw new HttpError(400, error.message);
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/character-history") {
        const data = await body(request);
        if (typeof data.session !== "string" || typeof data.character !== "string" || !Number.isSafeInteger(data.step))
          throw new HttpError(400, "Expected session, character and step");
        const session = sessions.get(data.session);
        if (!session) throw new HttpError(404, "Session expired or does not exist; start a new run");
        if (data.step !== session.step) throw new HttpError(409, "This run has moved on; reopen history on the current screen");
        const history = session.history.at(-1)?.snapshot.characterHistory;
        if (!history || history.character.id !== data.character)
          throw new HttpError(409, "The selected character has changed; reopen history on the current screen");
        session.used = Date.now();
        json(response, session.runtime.fullCharacterHistory(history));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/resume") {
        // Lets a reloaded page reattach to its still-running session: replays what was shown, without advancing it.
        const data = await body(request);
        if (typeof data.session !== "string") throw new HttpError(400, "Expected a session string");
        const session = sessions.get(data.session);
        if (!session) throw new HttpError(404, "Session expired or does not exist; start a new run");
        session.used = Date.now();
        json(response, { session: data.session, mode: session.mode, game: session.game, debug: session.debug, step: session.step,
          cbg: session.cbg ?? [], cbgMap: session.cbgMap ?? null, tooltip: session.tooltip, audio: session.audio, textbox: session.textbox ?? "",
          history: session.history.map(({ advance, snapshot }) => ({ advance, snapshot })) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/prefetch") {
        // Sent by the client once a click-to-continue screen is shown (and its images fetched): run the next step
        // now, while the player reads, so their click is answered at once.
        const data = await body(request);
        if (typeof data.session !== "string") throw new HttpError(400, "Expected a session string");
        const client = clientState(data.client);
        const session = sessions.get(data.session);
        if (client && session) session.runtime.setClient(client);
        if (session) executionBreadcrumb(data.session, session.game, session.step, "prefetch", session.debug);
        json(response, { prefetched: session?.runtime.prefetch() ?? false });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/sprite") {
        const name = url.searchParams.get("name") ?? "";
        const { game } = entryFor(url.searchParams.get("game"));
        const definition = game.sprites.get(key(name));
        if (!definition) throw new HttpError(404, `Unknown sprite: ${name}`);
        const sprite = stillFrame(definition);
        if (!sprite) throw new HttpError(404, `Animation sprite has no frames: ${name}`);
        // Validate before handing metadata to the browser.
        await resourceFile(gameDirectory(game.root, "resources"), sprite.file);
        json(response, { ...sprite, url: `${game.resourceBase}${sprite.file.split(path.sep).map(encodeURIComponent).join("/")}` });
        return;
      }
      const resource = /^(?:\/games\/([a-z0-9-]+))?\/(resources|sound)\/(.*)$/.exec(url.pathname);
      if (request.method === "GET" && resource) {
        const { game } = entryFor(resource[1]);
        let relative: string;
        try { relative = decodeURIComponent(resource[3]!); }
        catch (error) {
          if (!(error instanceof URIError)) throw error;
          throw new HttpError(400, "Invalid resource path encoding");
        }
        const file = await resourceFile(gameDirectory(game.root, resource[2]!), relative, resource[2] === "sound");
        response.writeHead(200, { "Content-Type": mime[path.extname(file).toLowerCase()]! });
        response.end(await readFile(file));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/maps") {
        json(response, await mapManifest(path.join(WEB_ROOT, "maps")));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/areas") {
        json(response, await areaManifest(path.join(WEB_ROOT, "areas")));
        return;
      }
      const pages: Record<string, string> = {
        "/": "index.html", "/app.js": "app.js", "/translate.js": "translate.js", "/interaction-history.js": "interaction-history.js", "/style.css": "style.css",
        "/library.js": "library.js", "/library.css": "library.css",
        "/fonts/BIZUDGothic-Regular.ttf": "fonts/BIZUDGothic-Regular.ttf",
        "/fonts/OFL.txt": "fonts/OFL.txt",
      };
      // The main screen's per-area header art (web/areas/<map id>-<name>.svg, or pictures in web/areas/<map id>-<name>/).
      // Map pictures (web/maps/<map key>.<ext>) replace the game's text maps.
      const page = pages[url.pathname] ?? (/^\/areas\/\d+-[a-z]+\.svg$/.test(url.pathname)
        || /^\/decoration\/deco_corner_flower_(spring|summer|autumn|winter)\.png$/.test(url.pathname)
        || /^\/areas\/\d+-[a-z]+\/(spring|summer|autumn|winter)-(day|night)-(left|middle|right)\.png$/.test(url.pathname)
        || /^\/maps\/[a-z0-9-]+\.(webp|svg|png|jpg)$/.test(url.pathname) ? url.pathname.slice(1) : undefined);
      if (request.method === "GET" && page) {
        const body = await readFile(path.join(WEB_ROOT, page)).catch(() => { throw new HttpError(404, "Not found"); });
        response.writeHead(200, { "Content-Type": mime[path.extname(page)]! });
        response.end(body);
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
export async function startServer(port = 3003, gamesDir = GAMES_DIR, development = false): Promise<Server> {
  gamesDir = path.resolve(gamesDir);
  const known = KNOWN_GAMES.map((game) => ({ ...game, root: path.join(gamesDir, path.relative(GAMES_DIR, game.root)) }));
  const loaded: GameEntry[] = [];
  for (const definition of discoverGames(gamesDir, known).filter((game) => isGameRoot(game.root))) {
    console.log(`Loading ${definition.title} from ${definition.root} ...`);
    const game = await loadGame(definition.root);
    const patched = definition.hotpatch ? await applyHotpatches(game, definition.hotpatch) : [];
    if (patched.length) console.log(`Hotpatched ${patched.map((name) => `@${name}`).join(", ")}`);
    console.log(`Loaded ${game.scriptFiles} scripts, ${game.routines.size} function names and ${game.sprites.size} sprites`);
    loaded.push({
      id: definition.id, title: definition.title, game,
      loadDebug: async () => {
        console.log(`Loading ${definition.title} in debug mode ...`);
        const debug = await loadGame(definition.root, { debug: true });
        if (definition.hotpatch) await applyHotpatches(debug, definition.hotpatch);
        return debug;
      },
    });
  }
  const app = createApp(loaded, development, gamesDir);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    app.once("error", onError);
    app.listen(port, "127.0.0.1", () => {
      app.off("error", onError);
      resolve();
    });
  });
  const address = app.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind to a TCP port");
  console.log(`Open http://127.0.0.1:${address.port}`);
  if (development) console.log("Development watch enabled; changes restart the backend and reload browser tabs. Active sessions reset.");
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const rawPort = process.env.PORT ?? "3003";
    const port = Number(rawPort);
    if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535");
    await startServer(port, GAMES_DIR, process.argv.includes("--dev"));
  } catch (error) {
    console.error("Startup failed:", error);
    process.exitCode = 1;
  }
}
