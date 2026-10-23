import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { EraError, key, stripComment, splitArguments, type Diagnostic, type Line, type Routine } from "./model.js";

export const GAME_ROOT = path.resolve("anon-tw-anon-tw_eng-modding");
export interface Sprite { file: string; x: number; y: number; width: number; height: number }
export interface Game {
  root: string;
  routines: Map<string, Routine[]>;
  headers: Line[];
  tables: Map<string, Map<number, string[]>>;
  names: Map<string, Map<string, number>>;
  sprites: Map<string, Sprite>;
  diagnostics: Diagnostic[];
  scriptFiles: number;
}
export async function filesUnder(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}
export async function readText(file: string): Promise<string> {
  const buffer = await readFile(file);
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
  return { root, routines: new Map(), headers: [], tables: new Map(), names: new Map(), sprites: new Map(), diagnostics: [], scriptFiles: 0 };
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
  for (const logical of logicalLines(source, file)) {
    lastLine = logical.line;
    // Emuera joins continuation rows before interpreting comments.
    const content = stripComment(logical.text).trim();
    const line: Line = { ...logical, text: content };
    if (content === "[SKIPSTART]") { skipBlock = true; continue; }
    if (content === "[SKIPEND]") { skipBlock = false; continue; }
    if (skipBlock) continue;
    if (content === "[IF_DEBUG]") { pushCondition(false); continue; }
    if (content === "[IF_NDEBUG]") { pushCondition(true); continue; }
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
    if (header) { game.headers.push(line); continue; }
    if (content.startsWith("@")) {
      const match = /^@([^\s(,]+)\s*(.*)$/.exec(content)!;
      let args = match[2]!.trim();
      if (args.startsWith("(") && args.endsWith(")")) args = args.slice(1, -1);
      let parameters: string[] = [];
      const directives: Line[] = [];
      try { parameters = args ? splitArguments(args) : []; }
      catch (error) {
        if (!(error instanceof EraError)) throw error;
        game.diagnostics.push({ ...line, message: `Unsupported function signature: ${content}` });
        directives.push({ ...line, text: "#UNSUPPORTED_SIGNATURE" });
      }
      routine = { ...line, name: key(match[1]!), parameters, lines: [], directives };
      const list = game.routines.get(routine.name) ?? [];
      list.push(routine);
      game.routines.set(routine.name, list);
    } else if (routine) {
      if (content.startsWith("#")) routine.directives.push(line);
      else routine.lines.push(line);
    } else game.diagnostics.push({ ...line, message: "Content outside a function" });
  }
  if (conditions.length || skipBlock) game.diagnostics.push({ file, line: lastLine, message: "Unclosed preprocessor block" });
}
export async function loadGame(root = GAME_ROOT): Promise<Game> {
  const game = emptyGame(root);
  const scripts = (await filesUnder(path.join(root, "ERB"))).filter((file) => /\.(erb|erh)$/i.test(file));
  // Header macro declarations must be available to ERB conditional compilation.
  scripts.sort((a, b) => Number(/\.erh$/i.test(b)) - Number(/\.erh$/i.test(a)));
  for (const file of scripts) {
    indexScript(game, await readText(file), path.relative(root, file), /\.erh$/i.test(file));
    game.scriptFiles++;
  }
  for (const file of await filesUnder(path.join(root, "CSV"))) {
    if (!/\.csv$/i.test(file)) continue;
    const relative = path.relative(path.join(root, "CSV"), file).split(path.sep).join("/");
    const name = key(relative.replace(/\.csv$/i, ""));
    const rows = csvRows(await readText(file));
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
    for (const row of csvRows(await readText(file))) {
      if (!row[0] || !row[1]) continue;
      if (!/\.(png|webp|jpe?g|gif|bmp)$/i.test(row[1])) {
        game.diagnostics.push({ file: path.relative(root, file), line: 0, message: `Unsupported resource definition: ${row[0]}` });
        continue;
      }
      const [x, y, width, height] = [2, 3, 4, 5].map((i) => row[i] ? Number(row[i]) : 0);
      if (![x, y, width, height].every((n) => n !== undefined && Number.isSafeInteger(n) && n >= 0)) {
        game.diagnostics.push({ file: path.relative(root, file), line: 0, message: `Invalid sprite rectangle: ${row[0]}` });
        continue;
      }
      game.sprites.set(key(row[0]), {
        file: path.relative(path.join(root, "resources"), path.resolve(path.dirname(file), row[1].replaceAll("\\", "/"))),
        x: x!, y: y!, width: width!, height: height!,
      });
    }
  }
  return game;
}
