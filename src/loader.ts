import { readdir, readFile } from "node:fs/promises";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import { characterField, EraError, EVENT_FUNCTIONS, isCharacterNumberField, key, allowsFullWidthSpace, stripComment, splitArguments, type Diagnostic, type Line, type Routine } from "./model.js";

/** Browser-presentation ERB layered over eraToho The World without editing its files (see docs/hotpatches.md). */
export const HOTPATCH_ROOT = path.resolve("hotpatch");
/** A game the server offers when its directory exists; the first is the default. */
export interface GameDefinition { id: string; title: string; root: string; hotpatch?: string }
/** Games with a fixed id (used in ?game= addresses), title or hotpatch; other folders in GAMES/ are discovered. */
export const KNOWN_GAMES: readonly GameDefinition[] = [
  { id: "tw", title: "eraToho The World", root: path.resolve("GAMES/anon-tw-anon-tw_eng-modding"), hotpatch: HOTPATCH_ROOT },
  { id: "k", title: "eraTohoK", root: path.resolve("GAMES/eraTohoK/eraTohoK-master") },
  { id: "rancek", title: "eraRanceK", root: path.resolve("GAMES/eraRanceK") },
];
const isGameRoot = (dir: string): boolean => existsSync(path.join(dir, "ERB")) && existsSync(path.join(dir, "CSV"));
const subdirectories = (dir: string): string[] => {
  try { return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort(); }
  catch { return []; }
};
/**
 * Known games, then every other folder in `gamesDir` holding ERB/ and CSV/ directly or one level down (as in an
 * unzipped `name/name-master`). A discovered game is titled and identified by its top-level folder name.
 */
export function discoverGames(gamesDir = path.resolve("GAMES"), known: readonly GameDefinition[] = KNOWN_GAMES): GameDefinition[] {
  const games = [...known];
  const roots = new Set(known.map((game) => game.root));
  const ids = new Set(known.map((game) => game.id));
  for (const name of subdirectories(gamesDir)) {
    const dir = path.join(gamesDir, name);
    const root = isGameRoot(dir) ? dir : subdirectories(dir).map((child) => path.join(dir, child)).find(isGameRoot);
    if (!root || roots.has(root) || [...roots].some((known) => known.startsWith(dir + path.sep))) continue;
    const base = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "game";
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    games.push({ id, title: name, root });
    roots.add(root);
    ids.add(id);
  }
  return games;
}
export const GAMES: readonly GameDefinition[] = discoverGames();
export const GAME_ROOT = GAMES[0]!.root;
/** A CSV sprite: a crop of a resource image. width/height 0 mean the whole image. */
/** What a static renderer draws for a sprite: itself, or an animation's first frame (undefined while it has none). */
export function stillFrame(sprite: Sprite): Sprite | undefined {
  return sprite.animation ? sprite.animation.frames[0] : sprite;
}
export interface Sprite {
  file: string; x: number; y: number; width: number; height: number; offsetX?: number; offsetY?: number;
  /** Destination size (columns 10-11), when it differs from the crop. */
  size?: { width: number; height: number };
  /** Set by a `name,ANIME,w,h` declaration; its following rows with the same name are frames. */
  animation?: { width: number; height: number; frames: (Sprite & { delay: number })[] };
}
/** Pixel size from a PNG, GIF, BMP, WebP or JPEG header; undefined if unreadable. */
export function imageSize(file: string): { width: number; height: number } | undefined {
  let header: Buffer;
  try {
    const fd = openSync(file, "r");
    try {
      header = Buffer.alloc(65536);
      header = header.subarray(0, readSync(fd, header, 0, header.length, 0));
    } finally { closeSync(fd); }
  } catch { return undefined; }
  const ascii = (start: number, end: number): string => header.toString("latin1", start, end);
  if (ascii(1, 4) === "PNG" && header.length >= 24) return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  if (ascii(0, 3) === "GIF" && header.length >= 10) return { width: header.readUInt16LE(6), height: header.readUInt16LE(8) };
  if (ascii(0, 2) === "BM" && header.length >= 26) return { width: header.readInt32LE(18), height: Math.abs(header.readInt32LE(22)) };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP" && header.length >= 30) {
    const chunk = ascii(12, 16);
    if (chunk === "VP8 ") return { width: header.readUInt16LE(26) & 0x3fff, height: header.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = header.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { width: header.readUIntLE(24, 3) + 1, height: header.readUIntLE(27, 3) + 1 };
  }
  if (header[0] === 0xff && header[1] === 0xd8) {
    for (let i = 2; i + 9 < header.length;) {
      if (header[i] !== 0xff) return undefined;
      const marker = header[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { width: header.readUInt16BE(i + 7), height: header.readUInt16BE(i + 5) };
      i += 2 + header.readUInt16BE(i + 2);
    }
  }
  return undefined;
}
export interface Game {
  root: string;
  routines: Map<string, Routine[]>;
  headers: Line[];
  tables: Map<string, Map<number, string[]>>;
  names: Map<string, Map<string, number>>;
  sprites: Map<string, Sprite>;
  diagnostics: Diagnostic[];
  scriptFiles: number;
  variableSizes: Map<string, number[]>;
  /** ERH #DEFINE macros: name -> replacement text. */
  macros: Map<string, string>;
  characters: Map<number, { file: string; rows: string[][] }>;
  renames: Map<string, string>;
  money: { label: string; first: boolean };
  config: Map<string, string>;
  /** Settings from CSV/_Replace.csv, keyed by their Japanese names. */
  replacements: Map<string, string>;
  /** CSV/VarExt*.csv: which MAP, XmlDocument and DataTable names are saved, global or static. */
  containers: Record<ContainerScope, ContainerNames>;
  /** URL path the browser fetches resources/ files from. */
  resourceBase: string;
  /** Emuera's debug mode (-Debug): [IF_DEBUG] code is loaded and DEBUG_FUNC instructions such as DEBUGPRINT and ASSERT run. */
  debug?: boolean;
}
export type ContainerScope = "SAVE" | "GLOBAL" | "STATIC";
export interface ContainerNames { MAPS: Set<string>; XMLS: Set<string>; DTS: Set<string> }
const containerNames = (): ContainerNames => ({ MAPS: new Set(), XMLS: new Set(), DTS: new Set() });
const ordinalIgnoreCase = (a: string, b: string): number => {
  const x = a.toUpperCase(), y = b.toUpperCase();
  return x < y ? -1 : x > y ? 1 : 0;
};
/**
 * Emuera's load order (Config.getFiles with ファイル名順にソート): each directory's subdirectories first, then its
 * files, both ordered case-insensitively by code unit. Event functions run, and duplicates resolve, in this order.
 */
export async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const names = (directory: boolean): string[] =>
    entries.filter((entry) => directory ? entry.isDirectory() : entry.isFile()).map((entry) => entry.name).sort(ordinalIgnoreCase);
  const result: string[] = [];
  for (const name of names(true)) result.push(...await filesUnder(path.join(root, name)));
  for (const name of names(false)) result.push(path.join(root, name));
  return result;
}
export async function readText(file: string): Promise<string> {
  return decodeText(await readFile(file));
}
/** Synchronous read for script-requested files; null when the file is missing. */
export function readTextFileSync(file: string): string | null {
  try { return decodeText(readFileSync(file)).replace(/^\uFEFF/, ""); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "EISDIR") return null;
    throw error;
  }
}
function decodeText(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return new TextDecoder("shift_jis", { fatal: true }).decode(buffer);
  }
}
export function csvRows(source: string): string[][] {
  return source.replace(/^\uFEFF/, "").split(/\r?\n/).flatMap((raw) => {
    if (!raw.trim() || raw.trimStart().startsWith(";")) return [];
    const row: string[] = [];
    let value = "", quoted = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]!;
      if (c === '"') {
        if (quoted && raw[i + 1] === '"') { value += '"'; i++; }
        else quoted = !quoted;
      } else if (c === "," && !quoted) { row.push(value.trim()); value = ""; }
      else if (c === ";" && !quoted) break;
      else value += c;
    }
    if (quoted) throw new EraError("Unterminated CSV quote");
    row.push(value.trim());
    return [row];
  });
}
export function emptyGame(root = ""): Game {
  return { root, routines: new Map(), headers: [], tables: new Map(), names: new Map(), sprites: new Map(), diagnostics: [], scriptFiles: 0, variableSizes: new Map(), macros: new Map(), characters: new Map(), renames: new Map(), money: { label: "\u00a5", first: true }, config: new Map(), replacements: new Map(), containers: { SAVE: containerNames(), GLOBAL: containerNames(), STATIC: containerNames() }, resourceBase: "/resources/" };
}
function* logicalLines(source: string, file: string): Generator<Line> {
  const rows = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  let opening: number | undefined;
  let start: number | undefined;
  let parts: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]!;
    const trimmed = raw.trim();
    if (trimmed === "{") {
      if (opening !== undefined) throw new EraError("Nested multiline statement", { file, line: i + 1 });
      opening = i + 1;
      continue;
    }
    if (trimmed === "}") {
      if (opening === undefined) throw new EraError("Unmatched multiline statement terminator", { file, line: i + 1 });
      yield { file, line: start ?? opening, text: parts.join(" ") };
      opening = undefined;
      start = undefined;
      parts = [];
    } else if (opening !== undefined) {
      if (trimmed && start === undefined) start = i + 1;
      parts.push(trimmed);
    } else yield { file, line: i + 1, text: raw };
  }
  if (opening !== undefined) throw new EraError("Unclosed multiline statement", { file, line: opening });
}
export function indexScript(game: Game, source: string, file: string, header = false): void {
  let routine: Routine | undefined;
  let skipBlock = false;
  const conditions: { active: boolean; matched: boolean; seenElse: boolean }[] = [];
  const defined = (name: string): boolean => game.headers.some((line) =>
    key(/^#DEFINE\s+([^\s(]+)/i.exec(line.text)?.[1] ?? "") === key(name));
  const pushCondition = (active: boolean): void => { conditions.push({ active, matched: active, seenElse: false }); };
  let lastLine = 0;
  const fullWidthSpace = allowsFullWidthSpace(game.config);
  for (const logical of logicalLines(source, file)) {
    lastLine = logical.line;
    // Emuera joins continuation rows before interpreting comments.
    const content = stripComment(logical.text.replace(/\[\[([^\]]+)\]\]/g, (match, name: string) => game.renames.get(name) ?? match), fullWidthSpace).trimStart();
    const line: Line = { ...logical, text: content };
    if (content === "[SKIPSTART]") { skipBlock = true; continue; }
    if (content === "[SKIPEND]") { skipBlock = false; continue; }
    if (skipBlock) continue;
    if (content === "[IF_DEBUG]") { pushCondition(!!game.debug); continue; }
    if (content === "[IF_NDEBUG]") { pushCondition(!game.debug); continue; }
    const conditional = /^\[(IF|ELSEIF)\s+([\p{L}\p{N}_\p{M}]+)\]$/iu.exec(content);
    if (conditional) {
      const active = defined(conditional[2]!);
      if (key(conditional[1]!) === "IF") pushCondition(active);
      else {
        const frame = conditions.at(-1);
        if (!frame || frame.seenElse) throw new EraError("Unmatched [ELSEIF] or [ELSEIF] after [ELSE]", line);
        frame.active = !frame.matched && active;
        frame.matched ||= active;
      }
      continue;
    }
    if (content === "[ELSE]") {
      const frame = conditions.at(-1);
      if (!frame || frame.seenElse) throw new EraError("Unmatched or duplicate [ELSE]", line);
      frame.active = !frame.matched;
      frame.matched = true;
      frame.seenElse = true;
      continue;
    }
    if (content === "[ENDIF]") {
      if (!conditions.length) game.diagnostics.push({ ...line, message: "Unmatched [ENDIF]" });
      conditions.pop(); continue;
    }
    if (conditions.some((frame) => !frame.active) || !content) continue;
    if (content.startsWith("[")) {
      game.diagnostics.push({ ...line, message: `Unsupported preprocessor directive: ${content}` });
      // Retain it so executing this path also fails explicitly.
    }
    if (header) {
      const define = /^#DEFINE\s+([^\s(]+)\s*(.*)$/i.exec(content);
      if (define) game.macros.set(key(define[1]!), define[2]!.trim());
      game.headers.push(line);
      continue;
    }
    if (content.startsWith("@")) {
      const match = /^@([^\s(,]+)\s*(.*)$/.exec(content)!;
      let args = match[2]!.trim();
      if (args.startsWith("(") && args.endsWith(")")) args = args.slice(1, -1);
      else if (args.startsWith(",")) args = args.slice(1).trimStart();
      let parameters: string[] = [];
      const directives: Line[] = [];
      try { parameters = args ? splitArguments(args) : []; }
      catch (error) {
        if (!(error instanceof EraError)) throw error;
        game.diagnostics.push({ ...line, message: `Unsupported function signature: ${content}` });
        directives.push({ ...line, text: "#UNSUPPORTED_SIGNATURE" });
      }
      routine = { ...line, name: key(match[1]!), label: match[1]!, parameters, lines: [], directives };
      const list = game.routines.get(routine.name) ?? [];
      // Like Emuera, a non-event function defined again keeps its first definition; the later one is parsed but unused.
      if (list.length && !EVENT_FUNCTIONS.has(routine.name))
        game.diagnostics.push({ ...line, message: `Function @${routine.label} is already defined (${list[0]!.file}:${list[0]!.line}); this definition is ignored` });
      else {
        list.push(routine);
        game.routines.set(routine.name, list);
      }
    } else if (routine) {
      if (content.startsWith("#")) routine.directives.push(line);
      else routine.lines.push(line);
    } else game.diagnostics.push({ ...line, message: "Content outside a function" });
  }
  if (conditions.length || skipBlock) game.diagnostics.push({ file, line: lastLine, message: "Unclosed preprocessor block" });
}
/**
 * Indexes every .ERB under dir and replaces the game's functions of the same name; functions the game lacks
 * (patch helpers) are added. A patch for a function the game doesn't define is rejected, so a renamed or
 * removed original surfaces at startup instead of leaving a dead patch. Returns the replaced function labels.
 */
export async function applyHotpatches(game: Game, dir = HOTPATCH_ROOT): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const patch: Game = { ...game, routines: new Map(), diagnostics: [] };
  for (const file of (await filesUnder(dir)).filter((file) => /\.erb$/i.test(file)).sort())
    indexScript(patch, await readText(file), path.relative(path.dirname(dir), file).split(path.sep).join("/"));
  game.diagnostics.push(...patch.diagnostics);
  const replaced: string[] = [];
  for (const [name, routines] of patch.routines) {
    const label = routines[0]!.label ?? name;
    if (!game.routines.has(name) && !/^HOTPATCH_/i.test(name))
      throw new EraError(`Hotpatch replaces @${label}, which the game does not define (patch helpers are named HOTPATCH_*)`, routines[0]!);
    if (game.routines.has(name)) replaced.push(label);
    game.routines.set(name, routines);
  }
  return replaced;
}
export async function loadGame(root = GAME_ROOT, options: { debug?: boolean } = {}): Promise<Game> {
  const game = emptyGame(root);
  if (options.debug) game.debug = true;
  const configFile = path.join(root, "emuera.config");
  if (existsSync(configFile)) {
    for (const row of (await readText(configFile)).split(/\r?\n/)) {
      const separator = row.indexOf(":");
      if (separator > 0 && !row.startsWith(";")) game.config.set(row.slice(0, separator).trim(), row.slice(separator + 1).trim());
    }
  }
  const csvFiles = (await filesUnder(path.join(root, "CSV"))).filter((file) => /\.csv$/i.test(file));
  for (const file of csvFiles.filter((file) => path.basename(file).toUpperCase() === "_RENAME.CSV")) {
    for (const row of csvRows(await readText(file))) {
      if (row[1]) game.renames.set(row[1], row[0] ?? "");
    }
  }
  const erbFiles = await filesUnder(path.join(root, "ERB"));
  for (const file of erbFiles.filter((file) => /\.erd$/i.test(file))) {
    const name = key(path.basename(file).slice(0, -4));
    if (game.names.has(name)) throw new EraError(`Duplicate ERD name table: ${name}`, { file, line: 0 });
    const names = new Map<string, number>();
    for (const row of csvRows(await readText(file))) {
      const index = Number(row[0]);
      if (!/^\d+$/.test(row[0] ?? "") || !Number.isSafeInteger(index) || !row[1])
        throw new EraError(`Invalid ERD index definition: ${row.join(",")}`, { file, line: 0 });
      names.set(key(row[1]), index);
    }
    game.names.set(name, names);
  }
  const scripts = erbFiles.filter((file) => /\.(erb|erh)$/i.test(file));
  // Header macro declarations must be available to ERB conditional compilation.
  scripts.sort((a, b) => Number(/\.erh$/i.test(b)) - Number(/\.erh$/i.test(a)));
  for (const file of scripts) {
    indexScript(game, await readText(file), path.relative(root, file), /\.erh$/i.test(file));
    game.scriptFiles++;
  }
  for (const file of csvFiles) {
    const relative = path.relative(path.join(root, "CSV"), file).split(path.sep).join("/");
    const name = key(relative.replace(/\.csv$/i, ""));
    const rows = csvRows(await readText(file));
    if (/^VAREXT/.test(path.basename(name))) {
      for (const row of rows) {
        const match = /^(SAVE|GLOBAL|STATIC)_(MAPS|XMLS|DTS)$/i.exec(row[0] ?? "");
        if (!match) continue;
        const names = game.containers[match[1]!.toUpperCase() as ContainerScope][match[2]!.toUpperCase() as keyof ContainerNames];
        for (const id of row.slice(1)) names.add(id.trim());
      }
    }
    if (name === "_REPLACE") {
      for (const row of rows) {
        if (row[0]) game.replacements.set(row[0].trim(), (row[1] ?? "").trim());
        if (row[0] === "お金の単位") game.money.label = row[1] ?? "";
        if (row[0] === "単位の位置") {
          if (row[1] !== "前" && row[1] !== "後") throw new EraError("Invalid money unit position", { file, line: 0 });
          game.money.first = row[1] === "前";
        }
      }
    }
    if (/(?:^|\/)CHARA\d/i.test(name)) {
      const number = rows.find((row) => isCharacterNumberField(row[0]))?.[1];
      if (!number || !/^\d+$/.test(number)) throw new EraError("Character CSV requires a numeric 番号", { file, line: 0 });
      const id = Number(number);
      if (game.characters.has(id)) throw new EraError(`Duplicate character number: ${id}`, { file, line: 0 });
      game.characters.set(id, { file: path.relative(root, file), rows });
      // Like Emuera, an unknown key only warns and its row is skipped.
      for (const row of rows) {
        if (!isCharacterNumberField(row[0]) && !characterField(row[0])) game.diagnostics.push({ file: path.relative(root, file), line: 0, message: `Unknown character CSV field "${row[0]}"; this row is ignored` });
      }
    }
    if (name === "VARIABLESIZE") {
      for (const row of rows) {
        const dimensions = row.slice(1).map(Number);
        if (dimensions.length && dimensions.every((n) => n === -1)) {
          game.variableSizes.set(key(row[0]!), []);
          continue;
        }
        if (!row[0] || !dimensions.length || dimensions.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 1_000_000))
          throw new EraError(`Invalid variable size: ${row.join(",")}`, { file: path.relative(root, file), line: 0 });
        game.variableSizes.set(key(row[0]), dimensions);
      }
    }
    const table = new Map<number, string[]>(), names = new Map<string, number>();
    for (const row of rows) {
      if (!/^\d+$/.test(row[0] ?? "")) continue;
      const index = Number(row[0]);
      table.set(index, row.slice(1));
      if (row[1]) names.set(key(row[1]), index);
    }
    game.tables.set(name, table);
    game.names.set(name, names);
    if (name === "GAMEBASE") {
      // GameBase uses textual keys rather than numeric indices.
      game.tables.set(name, new Map(rows.map((row, i) => [i, row])));
    }
  }
  for (const file of await filesUnder(path.join(root, "resources"))) {
    if (!/\.csv$/i.test(file)) continue;
    const warn = (message: string) => game.diagnostics.push({ file: path.relative(root, file), line: 0, message });
    // Emuera AppContents.CreateFromCsv: unparseable optional numbers keep their defaults rather than rejecting the row.
    const int = (value: string | undefined) => value !== undefined && /^\s*[+-]?\d+\s*$/.test(value) ? Number(value) : undefined;
    const ints = (row: string[], from: number, count: number) => {
      const values = row.slice(from, from + count).map(int);
      return values.length === count && values.every((n) => n !== undefined) ? values as number[] : undefined;
    };
    let animation: { name: string; sprite: Sprite } | undefined;
    for (const row of csvRows(await readText(file))) {
      if (row.length < 2 || !row[0] || !row[1]) continue;
      const name = key(row[0]);
      if (row[1].toUpperCase() === "ANIME") {
        const size = ints(row, 2, 2);
        if (!size || size.some((n) => n <= 0 || n > 8192)) { warn(`Invalid animation sprite size: ${row[0]}`); continue; }
        const sprite: Sprite = { file: "", x: 0, y: 0, width: size[0]!, height: size[1]!, animation: { width: size[0]!, height: size[1]!, frames: [] } };
        if (game.sprites.has(name)) { warn(`Sprite name already used: ${row[0]}`); animation = undefined; continue; }
        game.sprites.set(name, sprite);
        animation = { name, sprite };
        continue;
      }
      if (!row[1].includes(".")) { warn(`Resource image has no file extension: ${row[0]}`); continue; }
      const sprite: Sprite = {
        file: path.relative(path.join(root, "resources"), path.resolve(path.dirname(file), row[1].replaceAll("\\", "/"))),
        x: 0, y: 0, width: 0, height: 0,
      };
      let delay = 1000;
      if (row.length >= 6) {
        const rect = ints(row, 2, 4);
        if (rect) {
          if (rect[2]! <= 0 || rect[3]! <= 0) { warn(`Sprite size is not positive: ${row[0]}`); continue; }
          [sprite.x, sprite.y, sprite.width, sprite.height] = rect as [number, number, number, number];
        }
        const offset = row.length >= 8 ? ints(row, 6, 2) : undefined;
        if (offset) [sprite.offsetX, sprite.offsetY] = offset as [number, number];
        if (row.length >= 9) {
          const value = int(row[8]);
          if (value !== undefined && value <= 0) { warn(`Animation frame time is not positive: ${row[0]}`); continue; }
          delay = value ?? delay;
          const size = row.length >= 11 ? ints(row, 9, 2) : undefined;
          if (size) sprite.size = { width: size[0]!, height: size[1]! };
        }
      }
      if (animation?.name === name) { animation.sprite.animation!.frames.push({ ...sprite, delay }); continue; }
      animation = undefined;
      if (game.sprites.has(name)) { warn(`Sprite name already used: ${row[0]}`); continue; }
      game.sprites.set(name, sprite);
    }
  }
  return game;
}

export interface DisplaySettings { foreground: string; background: string; selection: string; font: string }

function configColor(value: string | undefined, fallback: string): string {
  const channels = value?.split(",").map((part) => Number(part.trim()));
  if (!channels || channels.length !== 3 || channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) return fallback;
  return "#" + channels.map((channel) => channel.toString(16).padStart(2, "0")).join("");
}

/** Emuera's configured font size and line height in pixels; game image layouts (sizes, ypos, reserved lines) use these units. */
export function displayMetrics(game: Game): { fontSize: number; lineHeight: number; columns: number } {
  const pixels = (name: string, fallback: number) => {
    const value = Number(game.config.get(name)?.trim());
    return Number.isInteger(value) && value > 0 ? value : fallback;
  };
  const fontSize = pixels("フォントサイズ", 18);
  // Emuera's drawable width (Config.DrawableWidth) in half-width cells, as DRAWLINESTR measures it.
  const drawable = pixels("ウィンドウ幅", 760) - Math.max(2, Math.floor(fontSize / 6));
  return { fontSize, lineHeight: pixels("一行の高さ", 19), columns: Math.max(1, Math.floor(drawable / (fontSize / 2))) };
}

/** Display defaults from emuera.config, with Emuera's built-in defaults as fallbacks. */
export function displayDefaults(game: Game): DisplaySettings {
  return {
    foreground: configColor(game.config.get("文字色"), "#c0c0c0"),
    background: configColor(game.config.get("背景色"), "#000000"),
    selection: configColor(game.config.get("選択中文字色"), "#ffff00"),
    font: game.config.get("フォント名") || "ＭＳ ゴシック",
  };
}
