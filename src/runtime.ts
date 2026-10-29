import { compile, inlineDeclaration, isPrintData, printVariant, PRINTDATA_PATTERN, type Compiled, type InlineDeclaration, type Instruction } from "./compiler.js";
import { evaluate, expandArgumentMacros, parseExpression, settleIndices, useMacros, type EvaluationContext, type Expr } from "./expression.js";
import { displayDefaults, gameDirectory, imageSize, readTextFileSync, type Sprite, type ContainerScope, type DisplaySettings, type Game } from "./loader.js";
import path from "node:path";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { allowsFullWidthSpace, characterField, EraError, EVENT_FUNCTIONS, integer, integerLiteral, numericString, INTEGER_LITERAL, key, splitArguments, stripComment, text, type Diagnostic, type Routine, type Source, type Value } from "./model.js";
import { symbolTable, Variables, type GlobalData, type SaveData } from "./variables.js";
import { parseFormat } from "./format.js";
import { MemoryGlobalStore, MemorySaveStore, StagedStores, type GlobalStore, type SaveStore } from "./storage.js";
import { randomInt, randomUUID } from "node:crypto";
import { escapeHtml, htmlButtons, htmlLineCount, htmlSpriteNames, htmlTagSplit, htmlWidth, plainHtml } from "./html.js";
import { formatInteger, stringWidth, toFullWidth, toHalfWidth } from "./strings.js";
import { DataTables, TABLE_OPERATIONS } from "./data-tables.js";
import { CONFIG_ITEMS, configSetting } from "./config-items.js";
import type { Document as XmlDocument } from "@xmldom/xmldom";
import { addAttribute, addNode, nodeOutput, parseXml, removeAttributes, removeNode, replaceNodes, selectNodes, serializeXml, setNodes } from "./xml.js";
import { DECLINE, loadIntrinsics, type Intrinsic } from "./intrinsics.js";
import { ASYNC, Jit, type CallAnalysis } from "./jit.js";
import { readNativeSave, writeNativeSave, type NativeSave, type SavedContainers, type SaveMetadata } from "./save-format.js";
import { fixHistoryHtml, SHARP_METHODS, supportedSharpCall, translateHistoryDate } from "./plugin-compat.js";
import { regexCharacterClasses, regexGroupOrder, replaceRegex } from "./regex.js";

export interface Style { color: string; background: string; alignment: "left" | "center" | "right"; fontStyle: number; font?: string }
type Rect = [x: number, y: number, width: number, height: number];
/** A 5x5 GDI+ ColorMatrix: output channel j = sum of [r, g, b, a, 1][i] * matrix[i][j]. */
type ColorMatrix = number[][];
/** Paint operations, replayed in order on a transparent canvas of the picture's size. */
export type GraphicOp =
  | { op: "rotate"; angle: number; x: number; y: number }
  | { op: "image"; url: string; src: Rect; dest: Rect; matrix?: ColorMatrix }
  | { op: "graphics"; source: Picture; src: Rect; dest: Rect; matrix?: ColorMatrix }
  /** Blends a CSS color over rect; replace first clears it (GCLEAR, GSETCOLOR). */
  | { op: "fill"; color: string; rect: Rect; replace?: boolean; absolute?: boolean }
  | { op: "line"; color: string; width: number; from: [number, number]; to: [number, number] }
  | { op: "text"; text: string; color: string; x: number; y: number; font: GraphicFont }
  /** GDRAWGWITHMASK: the mask's blue channel blends source over the destination. */
  | { op: "mask"; source: Picture; mask: Picture; x: number; y: number };
export interface Picture { width: number; height: number; ops: GraphicOp[] }
/**
 * A sprite the browser cannot fetch from /api/sprite, sent with the html output that shows it: a runtime-made
 * sprite, or an animation. Animations also carry every frame, pre-composed at the sprite's size; picture is the first.
 */
export interface SpriteDefinition { width: number; height: number; x: number; y: number; picture: Picture; frames?: { picture: Picture; delay: number }[] }
/** One frame of an animation sprite (Emuera SpriteAnime.AnimeFrame), already clipped to the sprite. */
interface AnimationFrame {
  /** A resource image, or the G whose current content is shown (referenced live like EM's BaseImage). */
  url?: string; graphics?: bigint;
  src: Rect; offset: [x: number, y: number]; delay: number;
}
export interface GraphicFont { name: string; size: number; style: number }
interface Canvas extends Picture { brush?: string; pen?: { color: string; width: number }; font?: GraphicFont }
interface SpriteInfo {
  width: number; height: number;
  /** SPRITEPOS offset (Emuera DestBasePosition). */
  x: number; y: number;
  /** A resources/*.csv sprite's image URL and crop rectangle. */
  url?: string; src?: Rect;
  /** The G a SPRITECREATE sprite shows, and its rectangle there. */
  graphics?: bigint; rect?: Rect;
  /** Set for animation sprites (CSV `ANIME` or SPRITEANIMECREATE), even before any frame is added. */
  frames?: AnimationFrame[];
}
/** Emuera AnimeFrame.Normalize: the frame keeps only the part inside the sprite; outside entirely, it draws nothing. */
function animationFrame(frame: Omit<AnimationFrame, "src" | "offset">, src: Rect, offset: [number, number], width: number, height: number): AnimationFrame {
  const left = Math.max(offset[0], 0), top = Math.max(offset[1], 0);
  const right = Math.min(offset[0] + src[2], width), bottom = Math.min(offset[1] + src[3], height);
  if (right <= left || bottom <= top) return { delay: frame.delay, src: [0, 0, 0, 0], offset: [0, 0] };
  return { ...frame, src: [src[0], src[1], right - left, bottom - top], offset: [left, top] };
}
export type Output =
  /** cell: a PRINTC item that the display wraps as a whole (Emuera's ボタンの途中で行を折りかえさない). */
  | { type: "text" | "html" | "input"; text: string; newline: boolean; style: Style; plain?: boolean; single?: boolean; cell?: boolean; sprites?: Record<string, SpriteDefinition>; browserLaunch?: { id: string; url: string } }
  | { type: "button"; text: string; value: string; style: Style }
  | { type: "clear"; count: number };
/**
 * A CBGSETG/CBGSETSPRITE layer: a picture fixed to the client area, its bottom-left at (x, y) from the area's
 * bottom-left (y down). z > 0 is behind the text (further back as z grows), z < 0 in front of it.
 */
export interface BackgroundLayer { z: number; x: number; y: number; picture: Picture; hover?: Picture; buttonValue?: number; tooltip?: string }
interface BackgroundSource { z: number; x: number; y: number; graphics?: bigint; sprite?: string; hover?: string; buttonValue?: number; tooltip?: string }
export interface TooltipSettings { custom: boolean; font: string; fontSize: number; delay: number; duration: number; color: string; background: string; format?: number }
export interface AudioSettings {
  soundVolume: number; bgmVolume: number;
  bgm: { id: string; url: string } | null;
  sounds: { id: string; url: string; repeat: number }[];
  stopSounds: boolean;
}
/**
 * INPUTMOUSEKEY's answer, sent as the input value: RESULT:0-5 (type 1 click, 2 wheel, 3 key, 4 timeout) and,
 * for a click on a string button, its RESULTS.
 */
export interface MouseKeyInput { result: number[]; results?: string }
export interface InputRequest {
  /** mousekey: INPUTMOUSEKEY, answered with a JSON MouseKeyInput. */
  kind: "integer" | "string" | "any" | "wait" | "mousekey";
  /** BINPUT(S) accepts only the currently displayed button values, including keyboard submissions. */
  buttonValues?: string[];
  singleCharacter?: boolean;
  /** What an empty input gives (INPUT/INPUTS/ONEINPUT(S) argument). */
  defaultValue?: string;
  /** Milliseconds before the browser should call the timeout endpoint. */
  timeout?: number;
  /** The last output line is a "残り" countdown the browser keeps updated. */
  countdown?: boolean;
  /** TWAIT with a nonzero flag: input cannot end the wait early. */
  blocking?: boolean;
  /** FORCEWAIT stops automatic message skipping without disabling click-to-continue. */
  stopSkipping?: boolean;
  /** PRINT...N waits without terminating the current output line. */
  keepLineOpen?: boolean;
  /** AWAIT yields to the host even when SKIPDISP is hiding output. */
  sleep?: boolean;
}
type Yield = { output: Output } | { input: InputRequest };
export interface Snapshot {
  status: "waiting" | "halted" | "error";
  output: Output[];
  input: InputRequest | null;
  error: Diagnostic | null;
  title: string;
  /** The TARGET character index, so the client can mark that character's picture. */
  target: number;
  /** Debug mode: text for Emuera's debug window since the previous snapshot; `debugClear` (DEBUGCLEAR) empties it first. */
  debug?: string;
  debugClear?: boolean;
  /** Every CBG layer, in drawing order, when they changed during this step. */
  cbg?: BackgroundLayer[];
  /** Present only when SETTEXTBOX changed the command field during this step. */
  textbox?: string;
  tooltip?: TooltipSettings;
  audio?: AudioSettings;
  /** CBG hit map, independent of the visible layers; null removes it. */
  cbgMap?: Picture | null;
}
interface RoutineInfo {
  returnType: "integer" | "string" | undefined;
  dynamic: Routine["directives"];
  inline: Map<string, InlineDeclaration>;
  references: boolean[];
  parameters: { target: Extract<Expr, { kind: "variable" }>; defaultSource: string | undefined }[];
}
type CaseTest =
  | { kind: "range"; from: string; to: string }
  | { kind: "compare"; op: string; operand: string }
  | { kind: "value"; source: string };
function argInt(args: (Value | undefined)[], name: string, i: number): bigint {
  const value = args[i];
  if (value === undefined) throw new EraError(`Missing argument for ${name}`);
  return integer(value);
}
function argText(args: (Value | undefined)[], name: string, i: number): string {
  const value = args[i];
  if (value === undefined) throw new EraError(`Missing argument for ${name}`);
  return text(value);
}
interface Evaluators { ev(source: string): Value; num(source: string): bigint; lineNum(instruction: Instruction): bigint }
interface Assignment { reference: Extract<Expr, { kind: "variable" }>; operator: string; value: string; expressionValue: string }
interface CallTarget { name: string; parameters: string }
const NO_VARIABLES: EvaluationContext = {
  get() { throw new EraError("Unexpected variable"); },
  call() { throw new EraError("Unexpected call"); },
};
interface Frame { variables: Variables; compiled: Compiled; context: EvaluationContext; returnType?: "integer" | "string" }
interface LoopState { variable: Expr; end: bigint; step: bigint }
// Single-stepped instructions never touch loop state; compiled routines keep their own.
/**
 * Compiled (and JIT-compiled) routines depend only on the routine and on which routines the game defines, so every
 * runtime of a game shares them.
 */
const COMPILED = new WeakMap<Game, { compiled: Map<Routine, Compiled>; analysis: CallAnalysis }>();
const NO_LOOP_STATES = new Map<number, LoopState>();
interface ReferenceArgument { variables: Variables; name: string; indices: Expr[]; context: EvaluationContext }
type Argument = Value | undefined | ReferenceArgument;
/** Thrown once a system-level call returns after BEGIN; unwinds to the state loop. */
class StateChange {
  constructor(public state: string) {}
}
class RestartTransition {}
/** Thrown by LOADDATA after the save has been restored; Emuera discards the whole call stack. */
class LoadTransition {}
class Halt {}
const BEGIN_STATES = new Set(["SHOP", "TRAIN", "AFTERTRAIN", "ABLUP", "TURNEND", "FIRST", "TITLE"]);
// Executed most often; they skip the PRINT/DATA/table prefix checks and sit at the head of runFrame's switch.
const HOT_OPS = new Set(["ASSIGN", "SIF", "RETURNF", "IF", "ELSEIF", "ELSE", "ENDIF", "FOR", "REPEAT", "NEXT", "REND", "SELECTCASE", "CASE", "CASEELSE", "ENDSELECT", "LABEL"]);
const SKIPPED_INPUTS = new Set(["INPUT", "INPUTS", "ONEINPUT", "ONEINPUTS", "TINPUT", "TINPUTS", "TONEINPUT", "TONEINPUTS", "BINPUT", "BINPUTS", "INPUTANY"]);
/** Variables that start a new turn of training at zero. */
const TRAIN_RESET = { global: ["TFLAG", "TSTR"], character: ["GOTJUEL", "TEQUIP", "EX", "PALAM", "SOURCE", "TCVAR"] };
const COMMAND_RESET = { global: ["UP", "DOWN", "LOSEBASE"], character: ["DOWNBASE", "CUP", "CDOWN"] };
const literal = (value: Value): Expr => ({ kind: "literal", value });
/** Parses and checks an INPUTMOUSEKEY answer; RESULT:0 must be 1-4 and the values 32-bit (RESULT:5 a button value). */
function mouseKeyInput(value: string): MouseKeyInput {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { parsed = undefined; }
  const input = parsed as Partial<MouseKeyInput> | undefined;
  const result = input?.result;
  if (!Array.isArray(result) || result.length < 1 || result.length > 6 || !result.every((n) => Number.isSafeInteger(n))
    || ![1, 2, 3, 4].includes(result[0]!) || (input!.results !== undefined && typeof input!.results !== "string"))
    throw new EraError("Expected a mouse or key input");
  return { result, ...(input!.results !== undefined ? { results: input!.results } : {}) };
}
/** Emuera ReadColor: 0xAARRGGBB as a CSS color. */
function argbColor(value: bigint, name: string): string {
  if (value < 0n || value > 0xFFFFFFFFn) throw new EraError(`${name}: invalid ARGB color ${value}`);
  const c = Number(value);
  return `rgba(${(c >>> 16) & 255}, ${(c >>> 8) & 255}, ${c & 255}, ${+((c >>> 24) / 255).toFixed(4)})`;
}
function rgbColor(value: bigint): string {
  if (value < 0n || value > 0xffffffn) throw new EraError("Color out of range");
  return "#" + value.toString(16).padStart(6, "0");
}
const SKIPPED: Yield = { output: { type: "text", text: "", newline: false, style: {} as Style } };
/** .NET KnownColor names accepted by SETCOLORBYNAME (lowercase keys are matched case-insensitively). */
const KNOWN_COLORS: Record<string, string> = Object.fromEntries(Object.entries({
  AliceBlue: "f0f8ff", AntiqueWhite: "faebd7", Aqua: "00ffff", Aquamarine: "7fffd4", Azure: "f0ffff", Beige: "f5f5dc", Bisque: "ffe4c4",
  Black: "000000", BlanchedAlmond: "ffebcd", Blue: "0000ff", BlueViolet: "8a2be2", Brown: "a52a2a", BurlyWood: "deb887", CadetBlue: "5f9ea0",
  Chartreuse: "7fff00", Chocolate: "d2691e", Coral: "ff7f50", CornflowerBlue: "6495ed", Cornsilk: "fff8dc", Crimson: "dc143c", Cyan: "00ffff",
  DarkBlue: "00008b", DarkCyan: "008b8b", DarkGoldenrod: "b8860b", DarkGray: "a9a9a9", DarkGreen: "006400", DarkKhaki: "bdb76b",
  DarkMagenta: "8b008b", DarkOliveGreen: "556b2f", DarkOrange: "ff8c00", DarkOrchid: "9932cc", DarkRed: "8b0000", DarkSalmon: "e9967a",
  DarkSeaGreen: "8fbc8b", DarkSlateBlue: "483d8b", DarkSlateGray: "2f4f4f", DarkTurquoise: "00ced1", DarkViolet: "9400d3", DeepPink: "ff1493",
  DeepSkyBlue: "00bfff", DimGray: "696969", DodgerBlue: "1e90ff", Firebrick: "b22222", FloralWhite: "fffaf0", ForestGreen: "228b22",
  Fuchsia: "ff00ff", Gainsboro: "dcdcdc", GhostWhite: "f8f8ff", Gold: "ffd700", Goldenrod: "daa520", Gray: "808080", Green: "008000",
  GreenYellow: "adff2f", Honeydew: "f0fff0", HotPink: "ff69b4", IndianRed: "cd5c5c", Indigo: "4b0082", Ivory: "fffff0", Khaki: "f0e68c",
  Lavender: "e6e6fa", LavenderBlush: "fff0f5", LawnGreen: "7cfc00", LemonChiffon: "fffacd", LightBlue: "add8e6", LightCoral: "f08080",
  LightCyan: "e0ffff", LightGoldenrodYellow: "fafad2", LightGray: "d3d3d3", LightGreen: "90ee90", LightPink: "ffb6c1", LightSalmon: "ffa07a",
  LightSeaGreen: "20b2aa", LightSkyBlue: "87cefa", LightSlateGray: "778899", LightSteelBlue: "b0c4de", LightYellow: "ffffe0", Lime: "00ff00",
  LimeGreen: "32cd32", Linen: "faf0e6", Magenta: "ff00ff", Maroon: "800000", MediumAquamarine: "66cdaa", MediumBlue: "0000cd",
  MediumOrchid: "ba55d3", MediumPurple: "9370db", MediumSeaGreen: "3cb371", MediumSlateBlue: "7b68ee", MediumSpringGreen: "00fa9a",
  MediumTurquoise: "48d1cc", MediumVioletRed: "c71585", MidnightBlue: "191970", MintCream: "f5fffa", MistyRose: "ffe4e1", Moccasin: "ffe4b5",
  NavajoWhite: "ffdead", Navy: "000080", OldLace: "fdf5e6", Olive: "808000", OliveDrab: "6b8e23", Orange: "ffa500", OrangeRed: "ff4500",
  Orchid: "da70d6", PaleGoldenrod: "eee8aa", PaleGreen: "98fb98", PaleTurquoise: "afeeee", PaleVioletRed: "db7093", PapayaWhip: "ffefd5",
  PeachPuff: "ffdab9", Peru: "cd853f", Pink: "ffc0cb", Plum: "dda0dd", PowderBlue: "b0e0e6", Purple: "800080", Red: "ff0000",
  RosyBrown: "bc8f8f", RoyalBlue: "4169e1", SaddleBrown: "8b4513", Salmon: "fa8072", SandyBrown: "f4a460", SeaGreen: "2e8b57",
  SeaShell: "fff5ee", Sienna: "a0522d", Silver: "c0c0c0", SkyBlue: "87ceeb", SlateBlue: "6a5acd", SlateGray: "708090", Snow: "fffafa",
  SpringGreen: "00ff7f", SteelBlue: "4682b4", Tan: "d2b48c", Teal: "008080", Thistle: "d8bfd8", Tomato: "ff6347", Turquoise: "40e0d0",
  Violet: "ee82ee", Wheat: "f5deb3", White: "ffffff", WhiteSmoke: "f5f5f5", Yellow: "ffff00", YellowGreen: "9acd32",
}).map(([name, hex]) => [key(name), `#${hex}`]));
const BUILTIN_ARITIES: Record<string, [number, number]> = {
    ABS: [1, 1], MIN: [1, 1000], MAX: [1, 1000], LIMIT: [3, 3], BARSTR: [3, 3], SAVENOS: [0, 0],
    TOSTR: [1, 2], MONEYSTR: [1, 2], TOINT: [1, 1], STRLENU: [1, 1], MAXWIDTH: [0, 0],
    GETCOLOR: [0, 0], GETSTYLE: [0, 0], GETCONFIG: [1, 1], GETCONFIGS: [1, 1], GETMETH: [1, 10000], GETMETHS: [1, 10000], POWER: [2, 2], HTML_STRINGLEN: [1, 2], EXISTVAR: [1, 1], GETVAR: [1, 1], GETVARS: [1, 1], VARSIZE: [1, 2],
    MAP_EXIST: [1, 1], MAP_SIZE: [1, 1], MAP_HAS: [2, 2], MAP_GET: [2, 2], MAP_CLEAR: [1, 1], MAP_FROMXML: [2, 2],
    HTML_POPPRINTINGSTR: [0, 0], STRFIND: [2, 3], STRFINDU: [2, 3], TOFULL: [1, 1], TOHALF: [1, 1], HTML_TOPLAINTEXT: [1, 1], STRLENS: [1, 1],
    STRCOUNT: [2, 2], REPLACE: [3, 3], SUBSTRING: [2, 3],
    EXISTCSV: [1, 2], RAND: [1, 2], ISSKIP: [0, 0], GETPALAMLV: [2, 2], GETEXPLV: [2, 2], MOUSESKIP: [0, 0], GETCHARA: [1, 2], CSVNAME: [1, 2], CSVCALLNAME: [1, 2], CSVNICKNAME: [1, 2], CSVMASTERNAME: [1, 2],
    CHKCHARADATA: [1, 1], SAVETEXT: [2, 4], LOADTEXT: [1, 3],
    INRANGE: [3, 3], ESCAPE: [1, 1],
    ISNUMERIC: [1, 1], ISDEFINED: [1, 1], VARSETEX: [2, 5],
    GROUPMATCH: [2, 1000], GETBIT: [2, 2],
    UNICODE: [1, 1],
    TOLOWER: [1, 1], TOUPPER: [1, 1], STRLENSU: [1, 1], HTML_ESCAPE: [1, 1],
    CURRENTREDRAW: [0, 0], CURRENTALIGN: [0, 0],
    SPRITECREATED: [1, 1], SPRITEWIDTH: [1, 1], SPRITEHEIGHT: [1, 1], SPRITEPOSX: [1, 1], SPRITEPOSY: [1, 1],
    SPRITECREATE: [2, 6], SPRITEDISPOSE: [1, 1], SPRITEANIMECREATE: [3, 3], SPRITEANIMEADDFRAME: [9, 9], SPRITESETPOS: [3, 3], SPRITEMOVE: [3, 3],
    SPRITEDISPOSEALL: [1, 1], SETTEXTBOX: [1, 1], MAP_REMOVE: [2, 2],
    GETNUMB: [2, 2], MAP_TOXML: [1, 1], EXISTSOUND: [1, 1], STRFORM: [1, 1],
    HTML_STRINGLINES: [2, 2],
    GCREATE: [3, 3], GCREATEFROMFILE: [2, 3], GCREATED: [1, 1], GWIDTH: [1, 1], GHEIGHT: [1, 1], GDISPOSE: [1, 1], GCLEAR: [2, 6],
    GSETCOLOR: [4, 4], GGETCOLOR: [3, 3], GDRAWG: [10, 11], GDRAWGWITHMASK: [5, 5], GDRAWGWITHROTATE: [3, 5], GDRAWSPRITE: [2, 7], GFILLRECTANGLE: [5, 5],
    GSETBRUSH: [2, 2], GSETPEN: [3, 3], GSETFONT: [3, 4], GSAVE: [2, 2], GLOAD: [2, 2],
    GDRAWTEXT: [2, 4], GDRAWLINE: [5, 5], GGETTEXTSIZE: [3, 4], GGETFONT: [1, 1], GGETFONTSIZE: [1, 1], GGETFONTSTYLE: [1, 1],
  GETTIME: [0, 0], GETTIMES: [0, 0], EXISTFUNCTION: [1, 1], CLIENTWIDTH: [0, 0], CLIENTHEIGHT: [0, 0], FIND_CHARADATA: [0, 1], EXISTFILE: [1, 1], SQRT: [1, 1], CBRT: [1, 1], LOG: [1, 1], LOG10: [1, 1], EXPONENT: [1, 1], GETMILLISECOND: [0, 0], GETSECOND: [0, 0], GETDEFCOLOR: [0, 0], GETBGCOLOR: [0, 0], GETDEFBGCOLOR: [0, 0], GETFONT: [0, 0],
  CONVERT: [2, 2], SUBSTRINGU: [2, 3], CHARATU: [2, 2],
  SIGN: [1, 1], ALLSAMES: [1, 10000], NOSAMES: [1, 10000], COLOR_FROMNAME: [1, 1], COLOR_FROMRGB: [3, 3], ENCODETOUNI: [1, 2], CHKFONT: [1, 1], CHKDATA: [1, 1],
  LINEISEMPTY: [0, 0], HTML_GETPRINTEDSTR: [0, 1], GETDOINGFUNCTION: [0, 0], MESSKIP: [0, 0], ISACTIVE: [0, 0], GETKEY: [1, 1], GETKEYTRIGGERED: [1, 1],
  MOUSEX: [0, 0], MOUSEY: [0, 0], MOUSEB: [0, 0], GETTEXTBOX: [0, 0], REGEXPMATCH: [2, 3], CLEARMEMORY: [0, 0], GETMEMORYUSAGE: [0, 0], PRINTCPERLINE: [0, 0], PRINTCLENGTH: [0, 0],
    CSVCSTR: [2, 3], CSVABL: [2, 3], CSVTALENT: [2, 3], CSVBASE: [2, 3], CSVEXP: [2, 3], CSVRELATION: [2, 3], CSVFLAG: [2, 3],
    CSVCFLAG: [2, 3], CSVMARK: [2, 3], CSVJUEL: [2, 3], CSVEQUIP: [2, 3],
};
// Milliseconds from 0001-01-01 to the Unix epoch, as used by GETMILLISECOND.
const EPOCH_OFFSET_MS = 62_135_596_800_000n;
/** GETTIME values: yyyyMMddHHmmssfff as an integer and "yyyy/MM/dd HH:mm:ss". */
function currentTime(): [bigint, string] {
  const now = new Date(), pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const date = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return [BigInt(`${date}${time}${pad(now.getMilliseconds(), 3)}`.replace(/\D/g, "")), `${date} ${time}`];
}
/** End of a CALLFORM-style function name: the first top-level "(" or "," outside %...% and {...}. */
function formNameEnd(source: string): number {
  let braces = 0, percent = false, quote = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quote) { if (c === "\\") i++; else if (c === '"') quote = false; continue; }
    if (c === '"' && (braces || percent)) quote = true;
    else if (c === "{") braces++;
    else if (c === "}") braces--;
    else if (c === "%" && !braces) percent = !percent;
    else if (!braces && !percent && (c === "(" || c === ",")) return i;
  }
  return source.length;
}
function optionalInteger(expr: Expr | undefined, fallback: number, context: EvaluationContext): number {
  return expr && expr.kind !== "omitted" ? Number(integer(evaluate(expr, context))) : fallback;
}
/** Builtin expression functions evaluated outside BUILTIN_ARITIES; all of them may also be used as statements. */
const FUNCTION_ENUMERATIONS = new Set(["ENUMFUNCBEGINSWITH", "ENUMFUNCENDSWITH", "ENUMFUNCWITH"]);
const RAW_FUNCTIONS = ["ARRAYMSORT", "ARRAYMSORTEX", ...FUNCTION_ENUMERATIONS, "ENUMFILES", "MAP_GETKEYS", "ERDNAME", "FINDCHARA", "FINDLASTCHARA", "REGEXPMATCH", "STRJOIN", "INRANGEARRAY", "INRANGECARRAY", "GDRAWG", "GDRAWSPRITE", "GETNUM"];
const ARRAY_SCANS = new Set(["SUMARRAY", "MATCH", "MAXARRAY", "MINARRAY", "FINDELEMENT", "FINDLASTELEMENT"]);
const CHARACTER_SCANS = new Set(["SUMCARRAY", "CMATCH", "MAXCARRAY", "MINCARRAY"]);
const XML_FUNCTIONS = new Set([
  "XML_DOCUMENT", "XML_RELEASE", "XML_EXIST", "XML_TOSTR", "XML_GET", "XML_GET_BYNAME",
  "XML_ADDNODE", "XML_ADDNODE_BYNAME", "XML_REMOVENODE", "XML_REMOVENODE_BYNAME",
  "XML_SET", "XML_SET_BYNAME", "XML_REPLACE", "XML_REPLACE_BYNAME",
  "XML_ADDATTRIBUTE", "XML_ADDATTRIBUTE_BYNAME", "XML_REMOVEATTRIBUTE", "XML_REMOVEATTRIBUTE_BYNAME",
]);
/** Table operations whose arguments include output references or bare keywords. */
const TABLE_REFERENCE_OPERATIONS = new Set(["DT_TOXML", "DT_COLUMN_NAMES", "DT_COLUMN_OPTIONS", "DT_SELECT"]);
// Character CSV row label and index-name table for each CSV* function.
const CSV_FIELDS: Record<string, [string, string]> = {
  CSVCSTR: ["CSTR", "CSTR"], CSVABL: ["能力", "ABL"], CSVTALENT: ["素質", "TALENT"], CSVBASE: ["基礎", "BASE"], CSVEXP: ["経験", "EXP"],
  CSVRELATION: ["相性", "RELATION"], CSVFLAG: ["フラグ", "CFLAG"], CSVCFLAG: ["フラグ", "CFLAG"], CSVMARK: ["刻印", "MARK"],
  CSVJUEL: ["珠", "PALAM"], CSVEQUIP: ["装着物", "EQUIP"],
};
/** Names the expression evaluator implements; a statement using one stores its value in RESULT/RESULTS. */
export const BUILTIN_FUNCTIONS: ReadonlySet<string> = new Set([
  ...Object.keys(BUILTIN_ARITIES), ...Object.keys(CSV_FIELDS), ...RAW_FUNCTIONS, ...ARRAY_SCANS, ...CHARACTER_SCANS,
  ...XML_FUNCTIONS, ...TABLE_REFERENCE_OPERATIONS, ...TABLE_OPERATIONS,
]);
export interface ClientState { width: number; height: number; active: boolean; mouseX?: number; mouseY?: number }
export interface RuntimeOptions {
  store?: GlobalStore; saves?: SaveStore; columns?: number; display?: Partial<DisplaySettings>;
  /** Drawable client area in game pixels; omitted for headless runs using the configured window size. */
  client?: ClientState;
  /** Native replacements for recognised game routines (default on); see src/intrinsics.ts. */
  intrinsics?: boolean;
  /** Compiles hot routines to JavaScript (default on); see src/jit.ts. */
  jit?: boolean;
}
// RanceK's default scenario builds its diplomacy maps in ~187 million instructions before asking for input.
export const GAME_INSTRUCTION_LIMIT = 250_000_000;

/** Emuera computes POWER with Math.Pow on doubles and rejects NaN, infinities and results outside Int64. */
/** Emuera's double-to-long conversion with its NaN, infinity and range errors. */
function doubleToInt64(name: string, result: number): bigint {
  if (Number.isNaN(result)) throw new EraError(`${name} result is not a number`);
  if (!Number.isFinite(result)) throw new EraError(`${name} result is infinite`);
  if (result >= 2 ** 63 || result <= -(2 ** 63)) throw new EraError(`${name} result (${result}) is outside the 64-bit integer range`);
  return BigInt(Math.trunc(result));
}
function power(base: bigint, exponent: bigint): bigint {
  return doubleToInt64("POWER", Math.pow(Number(base), Number(exponent)));
}

export class Runtime {
  private dataTables = new DataTables();
  private autoToStr: boolean;
  private xmlDocuments = new Map<string, XmlDocument>();
  private globals: Variables;
  private statics = new Map<Routine, Variables>();
  private compiled: Map<Routine, Compiled>;
  private routineInfo = new Map<Routine, RoutineInfo>();
  private contexts = new WeakMap<Variables, EvaluationContext>();
  private iterator: Generator<Yield, Value | undefined, string> | undefined;
  private pending: InputRequest | null = null;
  private readonly fullWidthSpace: boolean;
  private timed: { value: string; message: string | undefined; countdown: boolean } | undefined;
  private steps = 0;
  private randomState = BigInt.asUintN(64, (BigInt(randomInt(2 ** 47)) << 17n) ^ BigInt(randomInt(2 ** 17)));
  private dumpedRandom: bigint | undefined;
  private lastLoad = { version: -1n, slot: -1n, text: "" };
  private skipDisplay = false;
  private messageSkip = false;
  private noSkip: boolean[] = [];
  /** The last line came from REUSELASTLINE and is replaced by the next output. */
  private temporaryLine = false;
  private depth = 0;
  private lineCount = 0;
  private display: DisplaySettings;
  private style: Style;
  private finished = false;
  private expressionCache = new Map<string, Expr>();
  /** Names that resolved to a user function without REF parameters, so later calls skip builtin dispatch. */
  private userFunctions = new Set<string>();
  private intrinsics = new Map<string, Intrinsic>();
  private jit: Jit | undefined;
  /** Descriptions of the intrinsic groups whose ERB sources matched. */
  readonly enabledIntrinsics: string[] = [];
  private evaluatorCache = new WeakMap<EvaluationContext, Evaluators>();
  private directoryCache = new Map<string, string[]>();
  private argumentCache = new Map<string, readonly string[]>();
  private formatCache = new Map<string, Expr>();
  private regexCache = new Map<string, RegExp>();
  private assignmentCache = new Map<string, Assignment>();
  private callCache = new Map<string, CallTarget | null>();
  private caseCache = new Map<string, CaseTest[]>();
  private currentSource: Source | undefined;
  private maps = new Map<string, Map<string, string>>();
  private store: GlobalStore;
  private columns: number;
  private client: ClientState | undefined;
  private printingHtml = "";
  /** Emuera's print buffer holds text or buttons not yet ended by a newline (PrintFlush(false) only ends such a line). */
  private lineOpen = false;
  /** HTML_GETPRINTEDSTR's record of completed lines (EM DisplayLine2Html format) and the line being printed. */
  private printedLines: string[] = [];
  private printedLine = "";
  private buttonLines: string[][] = [];
  private lineButtons: string[] = [];
  private textbox = "";
  private textboxChanged = false;
  /** Routines currently executing, innermost last. */
  private doing: Routine[] = [];
  /** Debug mode's DEBUGPRINT output since the last snapshot, and whether DEBUGCLEAR ran meanwhile. */
  private debugText = "";
  private debugClear = false;
  /** CBG layers ordered back to front (descending z, then insertion), and whether they changed since the last snapshot. */
  private background: BackgroundSource[] = [];
  private backgroundChanged = false;
  private lastBackground = "[]";
  private lastBackgroundMap = "null";
  private backgroundMap: bigint | undefined;
  private tooltipSettings: TooltipSettings = { custom: false, font: "", fontSize: 12, delay: 500, duration: 5000, color: "#000000", background: "#ffffe1" };
  private tooltipChanged = false;
  private audio: AudioSettings | undefined;
  private forceKana = 0;
  private printCLength: number;
  private deferred: Output[] = [];
  private redraw = 1n;
  private saves: SaveStore;
  private staged: StagedStores;
  /** The result of continuing a click-to-continue wait ahead of the click; see prefetch(). */
  private ahead: { snapshot: Snapshot } | { error: unknown } | null = null;
  private stainDefault: bigint[];
  private maxShopItem: number;
  private printCPerLine: number;
  private outputBytes = 0;
  private outputEvents = 0;
  private action = "start";
  private prefetching = false;
  /** ボタンの途中で行を折りかえさない: a line wraps between buttons, never inside one (unless it starts the line). */
  private readonly buttonWrap: boolean;
  private autoSave: boolean;
  /** Set by BEGIN; the transition happens once the system-level call returns. */
  private pendingBegin: string | undefined;
  /** Set by DOTRAIN; the command runs once the current training-phase call returns. */
  private pendingTrain: bigint | undefined;
  private trainPhaseActive = false;
  /** CALLTRAIN's queued commands (TRAIN.CSV ids) and how many have run. */
  private ctrain: { coms: bigint[]; count: number } | undefined;
  /** SKIPDISP was set by script (Emuera's userDefinedSkip), so INPUT while skipping is an error. */
  private userSkip = false;
  /** Counts waits and inputs so EVENTCOMEND can tell whether it already waited. */
  private waits = 0;
  /** G canvases (GCREATE) as display lists the browser paints; see Picture. */
  private graphics = new Map<bigint, Canvas>();
  /** SPRITECREATE sprites reference their G by id, live like Emuera's SpriteG; SPRITEANIMECREATE sprites have no graphics. */
  private dynamicSprites = new Map<string, SpriteInfo>();
  private spriteSizes = new Map<string, SpriteInfo>();
  private disposedSprites = new Set<string>();
  constructor(public game: Game, private maxSteps = 50_000, options: RuntimeOptions = {}) {
    this.fullWidthSpace = allowsFullWidthSpace(game.config);
    let shared = COMPILED.get(game);
    if (!shared) COMPILED.set(game, shared = { compiled: new Map(), analysis: { suspends: new Map(), targets: new Map() } });
    this.compiled = shared.compiled;
    this.staged = new StagedStores(options.saves ?? new MemorySaveStore(), options.store ?? new MemoryGlobalStore());
    this.store = this.staged.store;
    this.columns = 120;
    const printCLength = Number(game.config.get("PRINTCの文字数") ?? 25);
    this.printCLength = Number.isSafeInteger(printCLength) && printCLength > 0 ? printCLength : 25;
    this.setColumns(options.columns ?? 120);
    if (options.client) this.setClient(options.client);
    this.display = { ...displayDefaults(game), ...options.display };
    this.style = { color: this.display.foreground, background: this.display.background, alignment: "left", fontStyle: 0 };
    this.globals = this.createGlobals();
    const stain = game.replacements.get("汚れの初期値");
    this.stainDefault = stain ? stain.split("/").map((n) => /^-?\d+$/.test(n.trim()) ? BigInt(n.trim()) : 0n) : [0n, 0n, 2n, 1n, 8n];
    const maxShopItem = Number(game.replacements.get("販売アイテム数") ?? 100);
    this.maxShopItem = Number.isSafeInteger(maxShopItem) && maxShopItem >= 0 ? maxShopItem : 100;
    const perLine = Number(game.config.get("PRINTCを並べる数") ?? 3);
    this.printCPerLine = Number.isSafeInteger(perLine) ? perLine : 3;
    this.autoSave = game.config.get("オートセーブを行なう")?.toUpperCase() !== "NO";
    this.buttonWrap = this.configValue("ボタンの途中で行を折りかえさない") === 1n;
    this.autoToStr = this.configValue("ユーザー関数の引数に自動的にTOSTRを補完する") === 1n;
    this.saves = this.staged.saves;
    this.seedDefaults();
    if (options.intrinsics !== false) {
      const { functions, enabled } = loadIntrinsics({
        routines: game.routines,
        call: (name, args, native = true) => this.expressionFunction(name, args as Argument[], native),
        statics: (name) => { const routine = game.routines.get(name)?.[0]; return routine && this.statics.get(routine); },
        context: (variables) => this.context(variables),
        global: (name, indices = []) => this.globals.get(name, indices.map((i) => literal(BigInt(i))), this.context(this.globals)),
        characterCount: () => this.globals.characterCount(),
      });
      this.intrinsics = functions;
      this.enabledIntrinsics.push(...enabled);
    }
    if (options.jit !== false) this.jit = new Jit({
      parse: (source) => this.parse(source),
      arguments: (source) => this.arguments(source),
      assignment: (source) => this.assignment(source) as ReturnType<ConstructorParameters<typeof Jit>[0]["assignment"]>,
      caseTests: (source) => this.caseTests(source),
      callTarget: (source) => this.callTarget(source),
      references: (name) => { const routine = this.game.routines.get(name)?.[0]; return routine && this.info(routine).references; },
      routine: (name) => this.game.routines.has(name),
      callable: (name) => this.game.routines.has(key(name)) || key(name) in BUILTIN_ARITIES,
      formNameEnd,
      targets: (name) => this.game.routines.get(name) ?? [],
      names: () => this.game.routines.keys(),
      analysis: shared.analysis,
      debug: !!game.debug,
    });
  }
  private createGlobals(): Variables {
    const game = this.game;
    const globals = new Variables(game);
    const numeric = ["RESULT", "FLAG", "TFLAG", "GLOBAL", "DAY", "TIME", "MONEY", "ITEM", "TARGET", "MASTER", "PLAYER", "ASSI", "COUNT", ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ")];
    numeric.forEach((name) => globals.define(name, false, game.variableSizes.get(name) ?? [name === "FLAG" ? 10000 : 1000]));
    for (const name of ["ITEMSALES", "NOITEM", "BOUGHT", "PBAND", "ASSIPLAY", "UP", "DOWN", "LOSEBASE", "PALAMLV", "EXPLV", "EJAC", "PREVCOM", "SELECTCOM", "NEXTCOM"])
      globals.define(name, false, game.variableSizes.get(name) ?? [1000]);
    globals.seed("EJAC", 0, 10000n);
    for (const name of ["BASE", "MAXBASE", "ABL", "TALENT", "EXP", "MARK", "PALAM", "SOURCE", "EX", "CFLAG", "JUEL", "RELATION", "EQUIP", "TEQUIP", "STAIN", "GOTJUEL", "NOWEX", "TCVAR"])
      globals.defineCharacter(name, false, game.variableSizes.get(name) ?? [1000]);
    for (const name of ["NO", "ISASSI"]) globals.defineCharacter(name);
    for (const name of ["NAME", "CALLNAME", "NICKNAME", "MASTERNAME"]) globals.defineCharacter(name, true);
    globals.defineCharacter("CSTR", true, game.variableSizes.get("CSTR") ?? [100]);
    globals.defineCharacter("DOWNBASE", false, game.variableSizes.get("BASE") ?? [100]);
    for (const name of ["CUP", "CDOWN"]) globals.defineCharacter(name, false, game.variableSizes.get("PALAM") ?? [200]);
    globals.define("TSTR", true, game.variableSizes.get("TSTR") ?? [100]);
    globals.define("SAVEDATA_TEXT", true, [1]);
    ["STR", "SAVESTR", "GLOBALS", "RESULTS", "WINDOW_TITLE", "GAMEBASE_TITLE", "GAMEBASE_INFO", "GAMEBASE_YEAR", "GAMEBASE_AUTHOR"].forEach((name) => globals.define(name, true, game.variableSizes.get(name) ?? [name === "STR" ? 20000 : 1000]));
    for (const name of ["GAMEBASE_VERSION", "GAMEBASE_CODE", "GAMEBASE_ALLOWVERSION", "GAMEBASE_DEFAULTCHARA", "GAMEBASE_NOITEM", "CHARANUM"]) globals.define(name);
    globals.seed("GAMEBASE_DEFAULTCHARA", 0, -1n);
    const base = new Map([...(game.tables.get("GAMEBASE")?.values() ?? [])].map((row) => [row[0], row[1] ?? ""]));
    for (const [variable, csv] of [["GAMEBASE_TITLE", "タイトル"], ["GAMEBASE_INFO", "追加情報"], ["GAMEBASE_YEAR", "製作年"], ["GAMEBASE_AUTHOR", "作者"], ["WINDOW_TITLE", "ウィンドウタイトル"]])
      globals.seed(variable!, 0, base.get(csv!) ?? "");
    for (const [variable, csv] of [["GAMEBASE_CODE", "コード"], ["GAMEBASE_VERSION", "バージョン"], ["GAMEBASE_ALLOWVERSION", "バージョン違い認める"],
      ["GAMEBASE_DEFAULTCHARA", "最初からいるキャラ"], ["GAMEBASE_NOITEM", "アイテムなし"]]) {
      const value = base.get(csv!);
      if (value && /^-?\d+$/.test(value)) globals.seed(variable!, 0, BigInt(value));
      else if (variable === "GAMEBASE_VERSION" && value === "proto") globals.seed(variable, 0, 0n);
    }
    for (const [name, table] of game.tables) {
      if (name.includes("/") || name === "GAMEBASE" || !table.size) continue;
      const size = Math.max(game.variableSizes.get(`${name}NAME`)?.at(-1) ?? game.variableSizes.get(name)?.at(-1) ?? (name === "STR" ? 20000 : 1000), Math.max(...table.keys()) + 1);
      if (size > 1_000_000) continue;
      globals.define(`${name}NAME`, true, [size], true);
      for (const [index, row] of table) globals.seed(`${name}NAME`, index, row[0] ?? "");
    }
    for (const line of game.headers) {
      if (/^#DIMS?\s/i.test(line.text)) globals.declare(line);
      // Other header directives are diagnosed by the compatibility report.
    }
    // Macros apply to ERB expressions only, so ERH declarations above are read unexpanded.
    useMacros(game.macros);
    const items = game.tables.get("ITEM");
    globals.define("ITEMPRICE", false, [Math.max(game.variableSizes.get("ITEM")?.[0] ?? 1000, ...[...items?.keys() ?? []].map((i) => i + 1))], true);
    for (const [index, row] of items ?? []) if (/^-?\d+$/.test(row[1]?.trim() ?? "")) globals.seed("ITEMPRICE", index, BigInt(row[1]!.trim()));
    return globals;
  }
  /** Config.DrawableWidth: WindowX less the shape shift used by every drawing mode except WINAPI. */
  private drawableWidth(): number {
    const fontSize = Number(this.configValue("FontSize"));
    const shift = String(this.configValue("TextDrawingMode")).toUpperCase() === "WINAPI" ? 0 : Math.max(2, Math.trunc(fontSize / 6));
    return Number(this.configValue("WindowX")) - shift;
  }
  /** GETCONFIG(S): Emuera's ConfigData.GetConfigValueInERB over emuera.config, _Replace.csv and the built-in defaults. */
  private configValue(name: string): Value {
    const wanted = name.toUpperCase();
    const item = CONFIG_ITEMS.find(([code, japanese, english, , , replace]) =>
      code.toUpperCase() === wanted || japanese.toUpperCase() === wanted || (!replace && english.toUpperCase() === wanted));
    if (!item) throw new EraError(`GETCONFIG: unknown config item ${name}`);
    const [, japanese, , kind, fallback, replace] = item;
    const raw = replace ? this.game.replacements.get(japanese)?.trim() : configSetting(this.game.config, name);
    switch (kind) {
      case "bool":
        if (raw === undefined) return BigInt(fallback);
        return /^(YES|TRUE|1|前)$/i.test(raw) ? 1n : 0n;
      case "int": return raw !== undefined && /^[-+]?\d+$/.test(raw) ? BigInt(raw) : BigInt(fallback);
      case "color": {
        const channels = raw?.split(",").map((part) => Number(part.trim()));
        if (!channels || channels.length !== 3 || channels.some((c) => !Number.isInteger(c) || c < 0 || c > 255)) return BigInt(fallback);
        return BigInt((channels[0]! * 256 + channels[1]!) * 256 + channels[2]!);
      }
      case "string": return raw ?? String(fallback);
      default: {
        const value = raw ?? String(fallback);
        if (value.toUpperCase() === "YES") return 1n;
        if (value.toUpperCase() === "NO") return 0n;
        return /^[-+]?\d+$/.test(value) ? BigInt(value) : value;
      }
    }
  }
  /** RESETDATA: non-global variables return to their defaults and the VarExt SAVE_* containers are emptied. */
  private resetData(): void {
    this.globals.resetData();
    for (const variables of this.statics.values()) variables.resetData();
    this.seedDefaults();
    this.clearContainers("SAVE");
    this.lastLoad = { version: -1n, slot: -1n, text: "" };
  }
  private restart(): void {
    this.statics.clear();
    this.contexts = new WeakMap();
    this.evaluatorCache = new WeakMap();
    this.globals = this.createGlobals();
    this.seedDefaults();
    this.maps.clear();
    this.xmlDocuments.clear();
    this.dataTables = new DataTables();
    this.graphics.clear();
    this.dynamicSprites.clear();
    this.spriteSizes.clear();
    this.disposedSprites.clear();
    this.randomState = BigInt.asUintN(64, (BigInt(randomInt(2 ** 47)) << 17n) ^ BigInt(randomInt(2 ** 17)));
    this.dumpedRandom = undefined;
    this.lastLoad = { version: -1n, slot: -1n, text: "" };
    this.pending = null;
    this.timed = undefined;
    this.skipDisplay = this.userSkip = this.messageSkip = false;
    this.noSkip = [];
    this.temporaryLine = this.lineOpen = false;
    this.lineCount = this.waits = 0;
    this.printingHtml = this.printedLine = this.textbox = this.debugText = "";
    this.printedLines = [];
    this.buttonLines = [];
    this.lineButtons = [];
    this.textboxChanged = this.debugClear = true;
    this.background = [];
    this.backgroundMap = undefined;
    this.backgroundChanged = true;
    this.tooltipSettings = { custom: false, font: "", fontSize: 12, delay: 500, duration: 5000, color: "#000000", background: "#ffffe1" };
    this.tooltipChanged = true;
    this.audio = { soundVolume: 100, bgmVolume: 100, bgm: null, sounds: [], stopSounds: true };
    this.forceKana = 0;
    this.redraw = 1n;
    this.pendingBegin = undefined;
    this.pendingTrain = undefined;
    this.trainPhaseActive = false;
    this.ctrain = undefined;
    this.style = { color: this.display.foreground, background: this.display.background, alignment: "left", fontStyle: 0 };
    this.deferOutput({ type: "clear", count: Number.MAX_SAFE_INTEGER });
  }
  /** Like Emuera EE's RemoveEM*Data: MAPs and DataTables named in VarExt*.csv are emptied, XmlDocuments are removed; other containers survive. */
  private clearContainers(scope: ContainerScope): void {
    const names = this.game.containers[scope];
    for (const name of names.MAPS) this.maps.get(name)?.clear();
    for (const name of names.XMLS) this.xmlDocuments.delete(name);
    for (const name of names.DTS) this.dataTables.clearRows(name);
  }
  private exportContainers(scope: ContainerScope): SavedContainers {
    const names = this.game.containers[scope];
    const saved: SavedContainers = { maps: {}, xmls: {}, dts: {} };
    for (const name of names.MAPS) { const map = this.maps.get(name); if (map) saved.maps[name] = [...map]; }
    for (const name of names.XMLS) { const document = this.xmlDocuments.get(name); if (document) saved.xmls[name] = serializeXml(document); }
    for (const name of names.DTS) { const table = this.dataTables.export(name); if (table) saved.dts[name] = table; }
    return saved;
  }
  private importContainers(saved: SavedContainers | undefined): void {
    for (const [name, entries] of Object.entries(saved?.maps ?? {})) this.maps.set(name, new Map(entries));
    for (const [name, source] of Object.entries(saved?.xmls ?? {})) this.xmlDocuments.set(name, parseXml(source));
    for (const [name, table] of Object.entries(saved?.dts ?? {})) this.dataTables.import(name, table);
  }
  /** Values Emuera restores whenever data is reset: STR from Str.csv and the PALAMLV/EXPLV thresholds. */
  private seedDefaults(): void {
    for (const [index, row] of this.game.tables.get("STR") ?? []) this.globals.seed("STR", index, row[0] ?? "");
    [0n, 100n, 500n, 3000n, 10000n, 30000n, 60000n, 100000n, 150000n, 250000n].forEach((n, i) => this.globals.seed("PALAMLV", i, n));
    [0n, 1n, 4n, 20n, 50n, 200n].forEach((n, i) => this.globals.seed("EXPLV", i, n));
  }
  setDisplay(display: Partial<DisplaySettings>): void {
    const previous = this.display;
    this.display = { ...previous, ...display };
    // Text still using the old defaults follows the new ones.
    if (this.style.color === previous.foreground) this.style.color = this.display.foreground;
    if (this.style.background === previous.background) this.style.background = this.display.background;
  }
  setColumns(columns: number): void {
    if (!Number.isSafeInteger(columns) || columns < 1 || columns > 1000) throw new EraError("Terminal columns must be between 1 and 1000");
    this.columns = columns;
  }
  setClient(client: ClientState): void {
    if (![client.width, client.height].every((size) => Number.isSafeInteger(size) && size >= 0 && size <= 65535)
      || typeof client.active !== "boolean") throw new EraError("Client dimensions must be integers from 0 to 65535 and active must be a boolean");
    if ([client.mouseX, client.mouseY].some((position) => position !== undefined
      && (!Number.isInteger(position) || position < -2147483648 || position > 2147483647)))
      throw new EraError("Client mouse coordinates must be signed 32-bit integers");
    this.client = { ...client };
  }
  start(entry = "SYSTEM_TITLE"): Snapshot {
    if (this.iterator) throw new EraError("Runtime has already started");
    this.action = `start @${entry}`;
    this.iterator = this.run(entry);
    return this.advance();
  }
  private *run(entry: string): Generator<Yield, Value | undefined, string> {
    let state = key(entry) === "SYSTEM_TITLE" ? "TITLE" : key(entry);
    let previous = "";
    let loaded = false;
    while (true) {
      try {
        if (loaded) yield* this.afterLoad();
        else yield* this.state(state, previous);
        return;
      } catch (error) {
        if (error instanceof Halt) return;
        if (error instanceof RestartTransition) {
          this.restart();
          state = "TITLE";
          previous = "";
          loaded = false;
          continue;
        }
        loaded = error instanceof LoadTransition;
        if (!loaded && !(error instanceof StateChange)) throw error;
        previous = state;
        state = error instanceof StateChange ? error.state : "SHOP";
        this.pendingBegin = undefined;
        this.pendingTrain = undefined;
      }
    }
  }
  /** Runs one system state; it ends by throwing StateChange, LoadTransition or Halt, or by returning to halt. */
  private *state(state: string, previous: string): Generator<Yield, void, string> {
    if (state === "TITLE" || state === "AFTERTRAIN" || state === "ABLUP") {
      // Leaving TRAIN mid-CALLTRAIN runs @CALLTRAINEND with output skipped, as Emuera's ClearCommands does.
      if (this.ctrain) {
        this.ctrain = undefined;
        this.skipDisplay = true;
        try { yield* this.system("CALLTRAINEND", false); } finally { this.skipDisplay = false; }
      }
      this.skipDisplay = false;
    }
    switch (state) {
      case "TITLE": yield* this.system("SYSTEM_TITLE", true); return;
      case "FIRST": yield* this.system("EVENTFIRST", true); return;
      case "AFTERTRAIN": case "TURNEND":
        yield* this.system(state === "AFTERTRAIN" ? "EVENTEND" : "EVENTTURNEND", true);
        throw new EraError(`予期しないスクリプト終端です (${state} ended without BEGIN)`, this.currentSource);
      case "SHOP": {
        yield* this.system("EVENTSHOP", false, false);
        // A BEGIN inside EVENTSHOP takes effect after the autosave.
        if (this.autoSave && ["FIRST", "AFTERTRAIN", "TURNEND", "TITLE"].includes(previous)) yield* this.autosave();
        this.checkBegin();
        yield* this.shop();
        return;
      }
      case "TRAIN": yield* this.train(); return;
      case "ABLUP": yield* this.ablup(); return;
      default:
        if (!this.game.routines.has(state)) throw new EraError(`Undefined function: ${state}`);
        yield* this.system(state, true);
    }
  }
  /** Calls a system function (as an event, so every definition runs); returns whether it exists. */
  private *system(name: string, forced: boolean, check = true): Generator<Yield, boolean, string> {
    if (!this.game.routines.has(name)) {
      if (forced) throw new EraError(`Required system function @${name} is not defined`);
      return false;
    }
    yield* this.dispatch(name, []);
    if (this.finished) throw new Halt();
    if (check) this.checkBegin();
    return true;
  }
  private checkBegin(): void {
    const state = this.pendingBegin;
    if (state) throw new StateChange(state);
  }
  /** Event dispatch: #PRI definitions, then regular ones, then #LATER; #SINGLE returning 1 ends its group and #ONLY ends the event. */
  private *dispatch(name: string, args: Argument[]): Generator<Yield, void, string> {
    const routines = this.game.routines.get(name) ?? [];
    if (routines.length === 1) { yield* this.execute(name, args, false, routines[0]); return; }
    const has = (routine: Routine, directive: string): boolean => routine.directives.some((d) => d.text.trim().toUpperCase() === directive);
    const groups = [routines.filter((r) => has(r, "#PRI")), routines.filter((r) => !has(r, "#PRI") && !has(r, "#LATER")), routines.filter((r) => has(r, "#LATER"))];
    for (const group of groups) {
      for (const routine of group) {
        yield* this.execute(name, args, false, routine);
        if (this.finished || has(routine, "#ONLY")) return;
        if (has(routine, "#SINGLE") && this.globals.get("RESULT", [], this.context(this.globals)) === 1n) break;
      }
    }
  }
  /** Integer input requested by the system loop; the entered value is echoed like INPUT. */
  private *systemInput(): Generator<Yield, bigint, string> {
    const value = yield { input: { kind: "integer" } };
    yield this.emit("input", value, true);
    return BigInt(value.trim());
  }
  /** Prints a line that the next output replaces, optionally removing the echoed input first. */
  private *temporary(message: string, removeEcho: boolean): Generator<Yield, void, string> {
    if (removeEcho && !this.temporaryLine) {
      this.dropLines(1);
      this.deferOutput({ type: "clear", count: 1 });
    }
    const output = this.emit("text", message, true);
    this.temporaryLine = true;
    yield output;
  }
  private number(name: string, ...indices: number[]): bigint {
    return integer(this.globals.get(name, indices.map((i) => literal(BigInt(i))), this.context(this.globals)));
  }
  private setNumber(name: string, value: bigint, ...indices: number[]): void {
    this.globals.set(name, indices.map((i) => literal(BigInt(i))), value, this.context(this.globals));
  }
  /** STAIN takes _Replace.csv's initial values, zero-filling (or truncating to) the array length. */
  private resetStain(character: number): void {
    const length = this.globals.dimensions("STAIN", this.context(this.globals)).at(-1)!;
    for (let j = 0; j < length; j++) this.setNumber("STAIN", this.stainDefault[j] ?? 0n, character, j);
  }
  private clearVariables(names: { global: string[]; character: string[] }): void {
    const context = this.context(this.globals);
    for (const name of [...names.global, ...names.character]) this.globals.clear(name, context);
  }
  private *shop(): Generator<Yield, void, string> {
    while (true) {
      yield* this.system("SHOW_SHOP", true);
      while (true) {
        const value = yield* this.systemInput();
        if (value >= 0n && value < BigInt(this.maxShopItem)) {
          const item = Number(value);
          if (this.number("ITEMSALES", item) !== 0n && this.game.tables.get("ITEM")?.has(item)) {
            const price = this.number("ITEMPRICE", item);
            if (this.number("MONEY") >= price) {
              this.setNumber("MONEY", this.number("MONEY") - price);
              this.setNumber("ITEM", this.number("ITEM", item) + 1n, item);
              this.setNumber("BOUGHT", value);
              yield* this.system("EVENTBUY", false);
              break;
            }
            yield* this.temporary("お金が足りません。", true);
          } else yield* this.temporary("売っていません。", true);
          continue;
        }
        this.setNumber("RESULT", value);
        yield* this.system("USERSHOP", true);
        if (!this.temporaryLine) break;
      }
    }
  }
  private *train(): Generator<Yield, void, string> {
    this.setNumber("ASSIPLAY", 0n);
    this.setNumber("PREVCOM", -1n);
    this.setNumber("NEXTCOM", -1n);
    this.clearVariables(TRAIN_RESET);
    const characters = this.globals.characterCount();
    for (let i = 0; i < characters; i++) this.resetStain(i);
    const names = this.game.tables.get("TRAIN") ?? new Map<number, string[]>();
    const ids = [...names.keys()].filter((id) => id >= 0).sort((a, b) => a - b);
    yield* this.trainPhase("EVENTTRAIN", false);
    while (true) {
      let command: bigint | undefined = this.takeTrain();
      if (command === undefined && this.number("NEXTCOM") >= 0n) {
        command = this.number("NEXTCOM");
        this.setNumber("NEXTCOM", 0n);
      }
      if (command === undefined) {
        // CALLTRAIN hides SHOW_STATUS, the command list and SHOW_USERCOM (NOSKIP still prints).
        if (this.ctrain) this.skipDisplay = true;
        yield* this.trainPhase("SHOW_STATUS", true);
        command = this.takeTrain();
      }
      const available: number[] = [];
      if (command === undefined) {
        let printed = 0;
        let line = "";
        for (const id of ids) {
          const shown = available.length;
          available.push(-1);
          if (this.game.routines.has(`COM_ABLE${id}`)) {
            yield* this.system(`COM_ABLE${id}`, true);
            if (this.number("RESULT") === 0n) continue;
          } else if (integer(this.configValue("ComAbleDefault")) === 0n) continue;
          available[shown] = id;
          if (this.ctrain) continue;
          line += this.printC(`${names.get(id)![0] ?? ""}[${String(shown).padStart(3)}]`, "C");
          if (this.printCPerLine > 0 && ++printed % this.printCPerLine === 0) { yield this.emit("text", line, true); line = ""; }
        }
        if (line) yield this.emit("text", line, true);
        // Emuera PrintFlush(false)s before SHOW_USERCOM, ending a line SHOW_STATUS left open (e.g. a partial Palam row).
        else if (this.lineOpen) yield this.emit("text", "", true);
        yield* this.trainPhase("SHOW_USERCOM", true);
        if (this.ctrain) this.skipDisplay = false;
        command = this.takeTrain();
      }
      while (true) {
        if (command === undefined && this.ctrain && this.ctrain.count < this.ctrain.coms.length) {
          const queued = this.ctrain.coms[this.ctrain.count++]!;
          this.clearVariables(COMMAND_RESET);
          yield this.emit("text", `＜コマンド連続実行：${this.ctrain.count}/${this.ctrain.coms.length}＞`, true);
          // Queued commands are TRAIN.CSV ids, not menu positions.
          if (available.includes(Number(queued))) command = queued;
          else {
            yield this.emit("text", "コマンドを実行できませんでした", true);
            this.setNumber("RESULT", queued);
            yield* this.trainPhase("USERCOM", true);
            command = this.takeTrain();
            if (command === undefined) { yield* this.commandEnded(); break; }
          }
        }
        if (command === undefined) {
          this.clearVariables(COMMAND_RESET);
          const value = yield* this.systemInput();
          const selected = value >= 0n && value < BigInt(available.length) ? available[Number(value)]! : -1;
          if (selected >= 0) command = BigInt(selected);
          else {
            this.setNumber("RESULT", value);
            yield* this.trainPhase("USERCOM", true);
            command = this.takeTrain();
            if (command === undefined) {
              if (yield* this.commandEnded()) continue;
              break;
            }
          }
        }
        this.setNumber("SELECTCOM", command);
        command = undefined;
        // A command that failed or ended on a temporary line returns to input without redrawing the status.
        if (!(yield* this.command())) break;
      }
    }
  }
  /** Runs a training-phase system call during which DOTRAIN is allowed. */
  private *trainPhase(name: string, forced: boolean): Generator<Yield, void, string> {
    this.trainPhaseActive = true;
    try { yield* this.system(name, forced); } finally { this.trainPhaseActive = false; }
  }
  private takeTrain(): bigint | undefined {
    const command = this.pendingTrain;
    this.pendingTrain = undefined;
    if (command !== undefined) this.clearVariables(COMMAND_RESET);
    return command;
  }
  /** One training command: EVENTCOM, COMn, SOURCE_CHECK and EVENTCOMEND; returns whether to re-request input. */
  private *command(): Generator<Yield, boolean, string> {
    while (true) {
      this.globals.clear("NOWEX", this.context(this.globals));
      yield* this.system("EVENTCOM", false);
      yield* this.system(`COM${this.number("SELECTCOM")}`, true);
      if (this.number("RESULT") === 0n) return yield* this.commandEnded();
      yield* this.system("SOURCE_CHECK", true);
      this.globals.clear("SOURCE", this.context(this.globals));
      const waits = this.waits;
      yield* this.trainPhase("EVENTCOMEND", false);
      const next = this.takeTrain();
      if (next !== undefined) { this.setNumber("SELECTCOM", next); continue; }
      if (yield* this.commandEnded()) return true;
      if (this.waits === waits) yield { input: { kind: "wait" } };
      return false;
    }
  }
  /** Emuera's endCallEventComEnd: re-request input after a temporary line, or finish a CALLTRAIN run with @CALLTRAINEND. */
  private *commandEnded(): Generator<Yield, boolean, string> {
    if (this.temporaryLine && !this.ctrain) return true;
    if (this.ctrain && this.ctrain.count >= this.ctrain.coms.length) {
      this.ctrain = undefined;
      this.skipDisplay = false;
      yield* this.system("CALLTRAINEND", false);
    }
    return false;
  }
  private *ablup(): Generator<Yield, void, string> {
    while (true) {
      yield* this.system("SHOW_JUEL", true);
      yield* this.system("SHOW_ABLUP_SELECT", true);
      while (true) {
        const value = yield* this.systemInput();
        if (value >= 0n && value < 100n) {
          if (!this.game.routines.has(`ABLUP${value}`)) { yield* this.temporary("無効な値です", true); continue; }
          yield* this.system(`ABLUP${value}`, true);
        } else {
          this.setNumber("RESULT", value);
          yield* this.system("USERABLUP", true);
        }
        if (!this.temporaryLine) break;
      }
    }
  }
  private *autosave(): Generator<Yield, void, string> {
    if (yield* this.system("SYSTEM_AUTOSAVE", false, false)) return;
    this.globals.set("SAVEDATA_TEXT", [], "", this.context(this.globals));
    yield* this.system("SAVEINFO", false, false);
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    this.saveGame(99n, `${stamp} ${text(this.globals.get("SAVEDATA_TEXT", [], this.context(this.globals)))}`.trimEnd());
  }
  private *afterLoad(): Generator<Yield, void, string> {
    yield* this.system("SYSTEM_LOADEND", false);
    yield* this.system("EVENTLOAD", false);
    yield* this.shop();
  }
  /** A sprite from resources/*.csv (sized from its image when the rectangle is omitted) or one made by SPRITECREATE. */
  private sprite(name: string): SpriteInfo | undefined {
    const id = key(name);
    const dynamic = this.dynamicSprites.get(id);
    // Emuera keeps a SpriteG whose G was disposed, but it is not "created" until the G exists again.
    if (dynamic) return dynamic.graphics === undefined || this.graphics.has(dynamic.graphics) ? dynamic : undefined;
    if (this.disposedSprites.has(id)) return undefined;
    let cached = this.spriteSizes.get(id);
    if (cached) return cached;
    const sprite = this.game.sprites.get(id);
    if (!sprite) return undefined;
    const crop = (part: Sprite): Rect => {
      let { width, height } = part;
      if ((!width || !height) && this.game.root) {
        const size = imageSize(path.join(gameDirectory(this.game.root, "resources"), part.file));
        width ||= size?.width ?? 0;
        height ||= size?.height ?? 0;
      }
      return [part.x, part.y, width, height];
    };
    if (sprite.animation) {
      const { width, height, frames } = sprite.animation;
      cached = { width, height, x: 0, y: 0, frames: frames.map((frame) =>
        animationFrame({ url: this.resourceUrl(frame.file), delay: frame.delay }, crop(frame), [frame.offsetX ?? 0, frame.offsetY ?? 0], width, height)) };
    } else {
      const src = crop(sprite), size = sprite.size ?? { width: src[2], height: src[3] };
      cached = { width: size.width, height: size.height, x: sprite.offsetX ?? 0, y: sprite.offsetY ?? 0, url: this.resourceUrl(sprite.file), src };
    }
    this.spriteSizes.set(id, cached);
    return cached;
  }
  /** The current content of a G; later drawing to that G does not change it. */
  private picture(id: bigint): Picture | undefined {
    const canvas = this.graphics.get(id);
    return canvas && { width: canvas.width, height: canvas.height, ops: canvas.ops.slice() };
  }
  private spritePicture(name: string): Picture | undefined {
    const sprite = this.sprite(name);
    if (!sprite) return undefined;
    const op = this.spriteOp(sprite, [0, 0, sprite.width, sprite.height]);
    return { width: sprite.width, height: sprite.height, ops: op ? [op] : [] };
  }
  private graphicFont(name: string, size: number, style: number): GraphicFont {
    if (!name || size < 1 || size > 8192 || !Number.isSafeInteger(size) || style < 0 || style > 15)
      throw new EraError("Graphics font requires a name, size between 1 and 8192, and style between 0 and 15");
    return { name, size, style };
  }
  private defaultGraphicFont(): GraphicFont {
    return { name: this.display.font, size: Number(this.configValue("FontSize")), style: 0 };
  }
  /** Emuera ASpriteSingle.GraphicsDraw: a SPRITEPOS offset scales with the destination. */
  private spriteOp(sprite: SpriteInfo, dest: Rect, matrix?: ColorMatrix): GraphicOp | undefined {
    let src = sprite.src ?? sprite.rect, source: Picture | undefined;
    if (sprite.frames) {
      // Drawing an animation into a G captures one moment of it; without a clock that is its first frame.
      if (!sprite.frames[0]) return undefined;
      source = this.framePicture(sprite, sprite.frames[0]);
      src = [0, 0, sprite.width, sprite.height];
    }
    if (!src) return undefined;
    if (sprite.x || sprite.y) {
      const [x, y, width, height] = dest;
      dest = [x + Math.trunc(sprite.x * width / sprite.width), y + Math.trunc(sprite.y * height / sprite.height),
        Math.trunc(width * src[2] / sprite.width), Math.trunc(height * src[3] / sprite.height)];
    }
    const extra = matrix ? { matrix } : {};
    if (sprite.url) return { op: "image", url: sprite.url, src, dest, ...extra };
    source ??= this.picture(sprite.graphics!);
    return source && { op: "graphics", source, src, dest, ...extra };
  }
  /** One animation frame painted at its offset on a transparent picture of the sprite's size. */
  private framePicture(sprite: SpriteInfo, frame: AnimationFrame): Picture {
    const picture: Picture = { width: sprite.width, height: sprite.height, ops: [] };
    if (!frame.src[2] || !frame.src[3]) return picture;
    const dest: Rect = [frame.offset[0], frame.offset[1], frame.src[2], frame.src[3]];
    if (frame.url) picture.ops.push({ op: "image", url: frame.url, src: frame.src, dest });
    else {
      // EM skips a frame whose G was disposed.
      const source = this.picture(frame.graphics!);
      if (source) picture.ops.push({ op: "graphics", source, src: frame.src, dest });
    }
    return picture;
  }
  /** Definitions of the runtime-made and animated sprites an html string shows, for the browser to paint. */
  private htmlSprites(html: string): Record<string, SpriteDefinition> | undefined {
    let found: Record<string, SpriteDefinition> | undefined;
    for (const name of htmlSpriteNames(html)) {
      if (found?.[name]) continue;
      const sprite = this.sprite(name);
      if (!sprite) {
        if (this.disposedSprites.has(key(name))) (found ??= {})[name] = { width: 0, height: 1, x: 0, y: 0, picture: { width: 1, height: 1, ops: [] } };
        continue;
      }
      const { width, height } = sprite;
      if (sprite.frames) {
        const frames = sprite.frames.map((frame) => ({ picture: this.framePicture(sprite, frame), delay: frame.delay }));
        (found ??= {})[name] = { width, height, x: 0, y: 0, picture: frames[0]?.picture ?? { width, height, ops: [] }, frames };
        continue;
      }
      if (!sprite.rect) continue;
      const op = this.spriteOp({ ...sprite, x: 0, y: 0 }, [0, 0, width, height]);
      if (op) (found ??= {})[name] = { width, height, x: 0, y: 0, picture: { width, height, ops: [op] } };
    }
    return found;
  }
  /** Emuera ReadColormatrix: a 5x5 block of an integer array starting at the given element, scaled by 1/256. */
  private colorMatrix(expr: Expr | undefined, variables: Variables, context: EvaluationContext, name: string): ColorMatrix {
    if (expr?.kind !== "variable" || variables.isString(expr.name, context)) throw new EraError(`${name}: the color matrix must be an integer array variable`);
    const rank = variables.dimensions(expr.name, context).length;
    if (rank < 2 || rank > 3) throw new EraError(`${name}: the color matrix must be a 2D or 3D array`);
    const indices = expr.indices.map((index) => integer(evaluate(index, context)));
    while (indices.length < rank) indices.push(0n);
    const fixed = indices.slice(0, -2).map(literal), [row, column] = indices.slice(-2) as [bigint, bigint];
    return Array.from({ length: 5 }, (_, x) => Array.from({ length: 5 }, (_, y) =>
      Number(integer(variables.get(expr.name, [...fixed, literal(row + BigInt(x)), literal(column + BigInt(y))], context))) / 256));
  }
  /** GDRAWSPRITE and GDRAWG, with an optional color matrix (Emuera GDrawCImg/GDrawG). */
  private draw(name: string, args: (Value | undefined)[], matrix?: ColorMatrix): bigint {
    const n = (i: number) => Number(integer(args[i] ?? 0n));
    const canvas = this.graphics.get(integer(args[0] ?? 0n));
    if (!canvas) return 0n;
    if (name === "GDRAWSPRITE") {
      const sprite = this.sprite(text(args[1] ?? ""));
      if (!sprite) return 0n;
      const dest: Rect = args.length >= 6 ? [n(2), n(3), n(4), n(5)] : [args.length >= 4 ? n(2) : 0, args.length >= 4 ? n(3) : 0, sprite.width, sprite.height];
      const op = this.spriteOp(sprite, dest, matrix);
      if (op) canvas.ops.push(op);
      return 1n;
    }
    const source = this.picture(integer(args[1] ?? 0n));
    if (!source) return 0n;
    canvas.ops.push({ op: "graphics", source, src: [n(6), n(7), n(8), n(9)], dest: [n(2), n(3), n(4), n(5)], ...(matrix ? { matrix } : {}) });
    return 1n;
  }
  private saveFile(slot: bigint): string {
    if (slot < 0n || slot > 1_000_000n) throw new EraError("Save slot must be between 0 and 1000000");
    return `save${String(slot).padStart(2, "0")}.sav`;
  }
  private charaFile(name: string): string {
    return `chara_${name}.dat`;
  }
  /**
   * SAVETEXT/LOADTEXT files: integers name numbered save-folder texts; strings are game-relative
   * paths with an allowed extension (txt plus the config list). Writes go to the save store, so
   * game files are only ever read, as the fallback for paths never saved.
   */
  /** A file under the game root, matched case-insensitively like Windows paths; ".." and absolute paths are refused. */
  private gameFile(relative: string): string | undefined {
    const parts = relative.replace(/\\/g, "/").split("/").filter((part) => part && part !== ".");
    if (!this.game.root || !parts.length || parts.includes("..") || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) return undefined;
    let current = this.game.root;
    for (const part of parts) {
      let entries = this.directoryCache.get(current);
      if (!entries) {
        try { entries = readdirSync(current); } catch { return undefined; }
        this.directoryCache.set(current, entries);
      }
      const match = entries.find((entry) => entry === part) ?? entries.find((entry) => entry.toLowerCase() === part.toLowerCase());
      if (!match) return undefined;
      current = path.join(current, match);
    }
    try { return statSync(current).isFile() ? current : undefined; } catch { return undefined; }
  }
  private enumerateFiles(directory: string, pattern: string, recursive: boolean): string[] | undefined {
    const parts = directory.replaceAll("\\", "/").split("/").filter((part) => part && part !== ".");
    if (parts.includes("..") || path.isAbsolute(directory) || /^[A-Za-z]:/.test(directory))
      throw new EraError("ENUMFILES requires a path within the game directory");
    if (!pattern || /[\\/]/.test(pattern)) throw new EraError("ENUMFILES pattern must be a file name wildcard");
    if (!this.game.root) return undefined;
    const missing = (error: unknown): boolean => error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
    const root = realpathSync(this.game.root);
    const inside = (file: string): boolean => file === root || file.startsWith(root + path.sep);
    let current = root;
    try {
      for (const part of parts) {
        const entries = readdirSync(current);
        const match = entries.find((entry) => entry === part) ?? entries.find((entry) => key(entry) === key(part));
        if (!match) return undefined;
        current = realpathSync(path.join(current, match));
        if (!inside(current)) throw new EraError("ENUMFILES cannot follow a link outside the game directory");
      }
      const wildcard = pattern === "*.*" ? "*" : pattern;
      const matcher = new RegExp("^" + wildcard.split("").map((c) => c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("") + "$", "iu");
      const files: string[] = [];
      const prefix = parts.join("\\");
      const base = current;
      const visit = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => key(a.name) < key(b.name) ? -1 : key(a.name) > key(b.name) ? 1 : 0)) {
          const file = path.join(dir, entry.name);
          // Do not follow directory links (cycles) or expose files outside the game.
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory() && recursive) visit(file);
          else if (entry.isFile() && matcher.test(entry.name)) {
            const relative = path.relative(base, file).split(path.sep).join("\\");
            files.push(prefix ? `${prefix}\\${relative}` : relative);
          }
        }
      };
      visit(current);
      return files;
    } catch (error) {
      if (missing(error)) return undefined;
      throw new EraError(`ENUMFILES: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  private textFile(value: Value | undefined): { store: string; game?: string } | undefined {
    if (typeof value === "bigint") return value >= 0n ? { store: `text${value}.txt` } : undefined;
    if (typeof value !== "string") return undefined;
    const relative = value.replace(/\\/g, "/");
    if (!relative || relative.split("/").includes("..") || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) return undefined;
    const extensions = ["txt", ...(this.game.config.get("LOADTEXTとSAVETEXTで使える拡張子") ?? "").split(",").map((ext) => ext.trim().toLowerCase()).filter(Boolean)];
    if (!extensions.includes(path.extname(relative).slice(1).toLowerCase())) return undefined;
    const game = this.gameFile(relative);
    return { store: `text-${Buffer.from(relative, "utf8").toString("base64url")}`, ...(game ? { game } : {}) };
  }
  private gameStamp(): { code: string; gameVersion: string } {
    const context = this.context(this.globals);
    return { code: String(this.globals.get("GAMEBASE_CODE", [], context)), gameVersion: String(this.globals.get("GAMEBASE_VERSION", [], context)) };
  }
  /** CHKDATA states: 0 OK, 1 missing, 2 another game, 3 incompatible version, 4 corrupt. */
  private checkSave(file: string): { state: bigint; message: string; record?: NativeSave } {
    const raw = this.saves.read(file);
    if (raw === null) return { state: 1n, message: "----" };
    let record: NativeSave;
    try {
      if (!Buffer.isBuffer(raw)) throw new EraError("Expected binary Emuera save");
      record = readNativeSave(raw);
      if (record.type !== (file.endsWith(".dat") ? 3 : 0)) throw new EraError("Wrong Emuera save file type");
    } catch (error) { return { state: 4n, message: `セーブデータが壊れています: ${error instanceof Error ? error.message : String(error)}` }; }
    const { code, gameVersion } = this.gameStamp();
    if (record.code !== "0" && record.code !== code) return { state: 2n, message: "異なるゲームのセーブデータです" };
    const target = BigInt(record.gameVersion);
    const declared = [...(this.game.tables.get("GAMEBASE")?.values() ?? [])].find((row) => row[0] === "バージョン")?.[1];
    const minimum = [...(this.game.tables.get("GAMEBASE")?.values() ?? [])].find((row) => row[0] === "バージョン違い認める")?.[1];
    const compatible = (!declared || !/^-?\d+$/.test(declared)) && target !== 1000n
      || (minimum !== undefined && /^-?\d+$/.test(minimum.trim()) && BigInt(minimum.trim()) <= target)
      || target === BigInt(gameVersion);
    if (!compatible) return { state: 3n, message: "セーブデータのバーションが異なります" };
    return { state: 0n, message: record.text, record };
  }
  /** Restores a save: everything but global data returns to its defaults before the saved values are applied. */
  private loadGame(data: SaveData, containers?: SavedContainers): void {
    this.resetData();
    const context = this.context(this.globals);
    this.globals.set("CHARANUM", [], BigInt(data.characters), context);
    this.globals.importSave(data, context);
    this.importContainers(containers);
  }
  private saveGame(slot: bigint, message: string): void {
    if (message.includes("\n")) throw new EraError("SAVEDATA text must not contain a newline");
    const context = this.context(this.globals);
    const record: NativeSave = { type: 0, ...this.gameStamp(), text: message, data: this.globals.exportSave(context),
      characters: this.globals.exportCharacters(Array.from({ length: this.globals.characterCount() }, (_, i) => i), context),
      containers: this.exportContainers("SAVE") };
    this.saves.write(this.saveFile(slot), writeNativeSave(record, this.saveMetadata()));
  }
  private saveMetadata(global = false): SaveMetadata {
    return { ...this.gameStamp(), layout: this.globals.saveLayout(this.context(this.globals), global),
      compressed: /^(YES|TRUE|1)$/i.test(configSetting(this.game.config, "ZipSaveData") ?? "") };
  }
  /**
   * Continues a plain click-to-continue wait before the click arrives, so the next input() returns at once.
   * The value given to a wait is ignored, so any later input() just takes this result. Save and global writes made
   * meanwhile are staged and only persisted by that input(); abandoning the run drops them.
   * Returns whether it ran ahead.
   */
  prefetch(): boolean {
    const pending = this.pending;
    if (this.ahead || !pending || pending.kind !== "wait" || pending.timeout !== undefined || pending.blocking) return false;
    this.staged.stage();
    this.prefetching = true;
    try { this.ahead = { snapshot: this.input("") }; }
    catch (error) { this.ahead = { error }; }
    finally { this.prefetching = false; }
    return true;
  }
  /** Whether a click-to-continue has been run ahead and is waiting for the player. */
  get prefetched(): boolean { return this.ahead !== null; }
  input(value: string): Snapshot {
    if (this.ahead) {
      const ahead = this.ahead;
      this.ahead = null;
      this.staged.commit();
      if ("error" in ahead) throw ahead.error;
      return ahead.snapshot;
    }
    if (!this.pending) throw new EraError("Runtime is not waiting for input");
    if (this.pending.blocking) throw new EraError("This wait cannot be skipped");
    if (this.pending.singleCharacter) {
      value = Array.from(value)[0] ?? this.pending.defaultValue ?? "";
    } else if (value === "" && this.pending.defaultValue !== undefined) value = this.pending.defaultValue;
    if (this.pending.kind === "integer" && !/^-?\d+$/.test(value.trim())) throw new EraError("Enter a whole number");
    if (this.pending.kind === "mousekey") mouseKeyInput(value);
    if (this.pending.kind === "integer") {
      const n = BigInt(value.trim());
      if (n < -(1n << 63n) || n >= (1n << 63n)) throw new EraError("Input is outside signed 64-bit range");
    }
    if (this.pending.kind === "any" && /^-?\d+$/.test(value.trim())) {
      const n = BigInt(value.trim());
      if (n < -(1n << 63n) || n >= (1n << 63n)) throw new EraError("Input is outside signed 64-bit range");
    }
    const accepted = this.pending.kind === "integer" ? BigInt(value.trim()).toString() : value;
    if (this.pending.buttonValues && !this.pending.buttonValues.includes(accepted)) throw new EraError("Choose one of the displayed button values");
    this.action = `${this.prefetching ? "prefetch" : "input"} (${this.pending.kind})`;
    this.messageSkip = false;
    this.textbox = "";
    if (this.pending.kind !== "wait") { this.buttonLines = []; this.lineButtons = []; }
    this.pending = null;
    this.timed = undefined;
    return this.advance(value);
  }
  /** Ends a timed wait (TINPUT family or TWAIT) as Emuera's timer would. */
  timeout(): Snapshot {
    if (this.ahead) throw new EraError("Runtime is not waiting for timed input");
    if (!this.pending?.timeout || !this.timed) throw new EraError("Runtime is not waiting for timed input");
    this.outputBytes = 0;
    this.outputEvents = 0;
    this.action = `timeout (${this.pending.kind})`;
    const { value, message, countdown } = this.timed;
    // The countdown line is replaced by the timeout message; otherwise a nonempty message is printed.
    if (countdown) {
      this.dropLines(1);
      this.deferOutput({ type: "clear", count: 1 });
    }
    if (message) this.deferred.push((this.emit("text", message, true) as { output: Output }).output);
    this.pending = null;
    this.timed = undefined;
    return this.advance(value, false);
  }
  private advance(input = "", resetOutputBytes = true): Snapshot {
    useMacros(this.game.macros);
    if (!this.iterator || this.finished) throw new EraError("Runtime is not running");
    this.steps = 0;
    if (resetOutputBytes) {
      this.outputBytes = 0;
      this.outputEvents = 0;
    }
    const output: Output[] = [];
    try {
      while (true) {
        const next = this.iterator.next(input);
        input = "";
        output.push(...this.deferred);
        this.deferred = [];
        if (next.done) {
          this.finished = true;
          return this.withDebug({ status: "halted", output, input: null, error: null, title: this.windowTitle(), target: this.currentTarget() });
        }
        if ("input" in next.value) {
          if (this.skipDisplay && !next.value.input.sleep) {
            if (next.value.input.kind === "wait") continue;
            throw new EraError("Input was requested while SKIPDISP is hiding output; wrap it in NOSKIP...ENDNOSKIP", this.currentSource);
          }
          if (this.messageSkip && next.value.input.kind === "wait" && !next.value.input.stopSkipping) {
            this.timed = undefined;
            continue;
          }
          // Ordinary waits flush an open line (PRINT then INPUT); PRINT...N explicitly keeps it open.
          if (this.lineOpen && !next.value.input.keepLineOpen) {
            const flush = this.emit("text", "", true);
            if (flush !== SKIPPED && "output" in flush) output.push(flush.output);
          }
          this.pending = next.value.input;
          this.waits++;
          return this.withDebug({ status: "waiting", output, input: this.pending, error: null, title: this.windowTitle(), target: this.currentTarget() });
        }
        if (next.value === SKIPPED) continue;
        output.push(next.value.output);
      }
    } catch (error) {
      if (!(error instanceof EraError)) throw error;
      this.captureError(error);
      output.push(...this.deferred);
      this.deferred = [];
      this.finished = true;
      this.iterator.return(undefined);
      return this.withDebug({ status: "error", output, input: null, error: error.diagnostic(), title: this.windowTitle(), target: this.currentTarget() });
    }
  }
  private captureError(error: EraError): void {
    if (error.context) return;
    const source = this.currentSource;
    error.context = {
      game: path.basename(this.game.root), gameVersion: this.gameStamp().gameVersion,
      debug: !!this.game.debug, jit: !!this.jit, action: this.action,
      ...(source && "text" in source && typeof source.text === "string" ? { instruction: source.text.slice(0, 500) } : {}),
      routines: this.doing.slice(-16).map((routine) => `@${routine.label ?? routine.name} (${routine.file}:${routine.line})`),
      instructions: this.steps, instructionLimit: this.maxSteps,
      outputCharacters: this.outputBytes, outputLimit: 2_000_000, outputEvents: this.outputEvents,
      deferredEvents: this.deferred.length, lastLoadedSlot: this.lastLoad.slot.toString(),
    };
  }
  private currentTarget(): number {
    return Number(this.globals.get("TARGET", [], this.context(this.globals)));
  }
  private windowTitle(): string {
    return text(this.globals.get("WINDOW_TITLE", [], this.context(this.globals)));
  }
  private addCharacter(number: number, context: EvaluationContext): void {
    const template = this.game.characters.get(number);
    if (!template) throw new EraError(`Unknown character template: ${number}`);
    const index = this.globals.addCharacter();
    this.globals.set("CHARANUM", [], BigInt(index + 1), context);
    this.globals.set("NO", [literal(BigInt(index))], BigInt(number), context);
    for (const row of template.rows) {
      // Unknown keys were reported when the game loaded.
      const name = characterField(row[0]);
      if (!name) continue;
      const scalar = ["NAME", "CALLNAME", "NICKNAME", "MASTERNAME"].includes(name);
      const value = row[scalar ? 1 : 2] ?? "";
      const indices = [literal(BigInt(index))];
      if (!scalar) indices.push(literal(/^\d+$/.test(row[1] ?? "") ? BigInt(row[1]!) : row[1] ?? ""));
      if (scalar || name === "CSTR") this.globals.set(name, indices, value, context);
      else {
        const numeric = this.characterNumber(value, template.file);
        this.globals.set(name, indices, numeric, context);
        if (name === "MAXBASE") this.globals.set("BASE", indices, numeric, context);
      }
    }
  }
  // Character list operations follow uEmuera's VariableEvaluator; only PICKUPCHARA remaps TARGET/ASSI/MASTER.
  /** Uniform integer in [0, bound) from a seedable SplitMix64 stream (RANDOMIZE/DUMPRAND/INITRAND). */
  private random(bound: bigint): bigint {
    if (bound <= 0n) throw new EraError("Random bound must be positive");
    const limit = (1n << 64n) - (1n << 64n) % bound;
    for (;;) {
      this.randomState = BigInt.asUintN(64, this.randomState + 0x9e3779b97f4a7c15n);
      let z = this.randomState;
      z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
      z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
      z ^= z >> 31n;
      if (z < limit) return z % bound;
    }
  }
  private characterOperation(op: string, values: number[], context: EvaluationContext): void {
    const count = this.globals.characterCount();
    const check = (index: number | undefined, what: string): number => {
      if (index === undefined || !Number.isSafeInteger(index) || index < 0 || index >= count) throw new EraError(`${op}: character ${index ?? "(missing)"} does not exist (${what})`);
      return index;
    };
    const arity = (min: number, max: number) => {
      if (values.length < min || values.length > max) throw new EraError(`Invalid number of arguments for ${op}`);
    };
    let order: number[];
    switch (op) {
      case "DELALLCHARA": order = []; break;
      case "DELCHARA": {
        arity(1, Infinity);
        const removed = new Set<number>();
        for (const value of values) {
          if (removed.has(check(value, "delete"))) throw new EraError(`DELCHARA: character ${value} was given more than once`);
          removed.add(value);
        }
        order = [...Array(count).keys()].filter((i) => !removed.has(i));
        break;
      }
      case "COPYCHARA": {
        arity(2, 2);
        const from = check(values[0], "source"), to = check(values[1], "destination");
        order = [...Array(count).keys()].map((i) => i === to ? from : i);
        break;
      }
      case "ADDCOPYCHARA": {
        arity(1, 1);
        order = [...Array(count).keys(), check(values[0], "source")];
        break;
      }
      case "SWAPCHARA": {
        arity(2, 2);
        const a = check(values[0], "swap"), b = check(values[1], "swap");
        order = [...Array(count).keys()].map((i) => i === a ? b : i === b ? a : i);
        break;
      }
      default: {
        order = [...new Set(values.filter((value) => value >= 0))];
        order.forEach((value) => check(value, "pick up"));
        for (const name of ["TARGET", "ASSI", "MASTER"]) {
          const old = Number(integer(this.globals.get(name, [], context)));
          this.globals.set(name, [], BigInt(order.indexOf(old)), context);
        }
      }
    }
    this.globals.rearrangeCharacters(order.length, (i) => order[i]!);
    this.globals.set("CHARANUM", [], BigInt(order.length), context);
  }
  private characterTemplate(number: bigint) {
    const template = this.game.characters.get(Number(number));
    if (!template) throw new EraError(`Unknown character template: ${number}`);
    return template;
  }
  private sortCharacters(args: string, frame: Frame): void {
    const parts = this.arguments(args);
    const direction = key(parts[1]?.trim() ?? "FORWARD");
    if (parts.length > 2 || !["FORWARD", "BACK"].includes(direction))
      throw new EraError("SORTCHARA expects character variable[, FORWARD or BACK]");
    const reference = this.parse(parts[0] || "NO");
    if (reference.kind !== "variable" || !frame.variables.isCharacter(reference.name, frame.context))
      throw new EraError("SORTCHARA requires a character variable");
    const count = this.globals.characterCount();
    if (count <= 1) return;
    const rank = frame.variables.characterRank(reference.name, frame.context);
    const indices = reference.indices.length > rank ? reference.indices.slice(1) : [...reference.indices];
    while (indices.length < rank) indices.push(literal(0n));
    const values = frame.variables.characterValues(reference.name, indices, frame.context);
    const master = Number(this.number("MASTER"));
    const order = Array.from({ length: count }, (_, i) => i).filter((i) => i !== master);
    order.sort((a, b) => {
      const left = values[a]!, right = values[b]!;
      const comparison = left < right ? -1 : left > right ? 1 : 0;
      return direction === "BACK" ? -comparison : comparison;
    });
    if (master >= 0 && master < count) order.splice(master, 0, master);
    for (const name of ["TARGET", "ASSI"]) {
      const old = Number(this.number(name));
      if (old >= 0 && old < count) this.setNumber(name, BigInt(order.indexOf(old)));
    }
    this.globals.rearrangeCharacters(count, (i) => order[i]!);
  }
  private bar(value: bigint, maximum: bigint, length: bigint, op = "BARSTR"): string {
    if (maximum <= 0n) throw new EraError(`${op} maximum must be positive`);
    if (length <= 0n || length >= 100n) throw new EraError(`${op} length must be between 1 and 99`);
    let filled = value * length / maximum;
    filled = filled < 0n ? 0n : filled > length ? length : filled;
    return `[${"*".repeat(Number(filled))}${".".repeat(Number(length - filled))}]`;
  }
  private characterNumber(source: string, file: string): bigint {
    // Emuera reads a leading integer from character CSV values; a missing value
    // means 1 for every numeric field, not just TALENT. Trailing notes are allowed.
    const negative = source.startsWith("-");
    const match = INTEGER_LITERAL.exec(/^[+-]/.test(source) ? source.slice(1) : source);
    if (!match) {
      if (source && !this.game.diagnostics.some((d) => d.file === file && d.message === `Invalid character CSV integer defaults to 1: ${source}`))
        this.game.diagnostics.push({ file, line: 0, message: `Invalid character CSV integer defaults to 1: ${source}` });
      return 1n;
    }
    let value: bigint;
    try { value = integerLiteral(match[0]); }
    catch (error) {
      if (!(error instanceof EraError)) throw error;
      throw new EraError(error.message, { file, line: 0 });
    }
    if (negative) value = -value;
    if (BigInt.asIntN(64, value) !== value) throw new EraError(`Character CSV integer out of range: ${source}`, { file, line: 0 });
    return value;
  }
  private parse(source: string): Expr {
    let expr = this.expressionCache.get(source);
    if (!expr) { useMacros(this.game.macros); expr = parseExpression(source); this.expressionCache.set(source, expr); }
    return expr;
  }
  private context(variables: Variables): EvaluationContext {
    const cached = this.contexts.get(variables);
    if (cached) return cached;
    const context: EvaluationContext = {
      get: (name, indices) => {
        if (name === "LINECOUNT") return BigInt(this.lineCount);
        if (name === "LASTLOAD_VERSION") return this.lastLoad.version;
        if (name === "LASTLOAD_NO") return this.lastLoad.slot;
        if (name === "LASTLOAD_TEXT") return this.lastLoad.text;
        if (name === "__INT_MAX__") return 0x7fff_ffff_ffff_ffffn;
        if (name === "__INT_MIN__") return -0x8000_0000_0000_0000n;
        // Debug variables are only populated in Emuera's debug mode.
        if (name === "__FILE__") return this.game.debug ? this.currentSource?.file ?? "" : "";
        if (name === "__FUNCTION__") { const routine = this.game.debug ? this.doing.at(-1) : undefined; return routine ? routine.label ?? routine.name : ""; }
        if (name === "__LINE__") return this.game.debug ? BigInt(this.currentSource?.line ?? 0) : 0n;
        if (name === "DRAWLINESTR") return "-".repeat(this.columns);
        if (name === "GAMEBASE_VERSION") {
          const version = [...(this.game.tables.get("GAMEBASE")?.values() ?? [])].find((row) => row[0] === "バージョン")?.[1];
          if (version && version !== "proto" && !/^-?\d+$/.test(version)) throw new EraError(`Non-numeric GameBase version is not yet supported: ${version}`);
        }
        if (name === "RAND") {
          if (indices.length !== 1) throw new EraError("RAND expects one positive bound");
          const bound = integer(evaluate(indices[0]!, context));
          if (bound <= 0n) throw new EraError("RAND bound must be a positive integer");
          return this.random(bound);
        }
        return variables.get(name, indices, context);
      },
      set: (name, indices, value) => { variables.set(name, indices, value, context); },
      referenceCall: (name, args) => {
        if (this.userFunctions.has(name)) return this.expressionFunction(name, args.map((arg) => arg.kind === "omitted" ? undefined : evaluate(arg, context)));
        const routine = this.game.routines.get(name)?.[0];
        if (routine && this.info(routine).references.some(Boolean)) {
          const references = this.info(routine).references;
          return this.expressionFunction(name, args.map((arg, i): Argument => {
            if (arg.kind === "omitted") return undefined;
            if (!references[i]) return evaluate(arg, context);
            if (arg.kind !== "variable") throw new EraError("REF arguments must be variable references");
            return { variables, name: arg.name, indices: arg.indices, context };
          }));
        }
        if (ARRAY_SCANS.has(name)) {
          // One-dimensional array scans; a character array scans one character's elements.
          const valued = name === "MATCH" || name.startsWith("FIND");
          const [reference, ...rest] = args;
          if (!reference || reference.kind !== "variable" || args.length > (name.startsWith("FIND") ? 5 : valued ? 4 : 3))
            throw new EraError(`${name} expects an array variable`);
          const dimensions = variables.dimensions(reference.name, context);
          if (dimensions.length !== 1) throw new EraError(`${name} requires a one-dimensional array`);
          const prefix = reference.indices.length > 1 ? reference.indices.slice(0, -1) : [];
          const sought = valued ? evaluate(rest.shift() ?? { kind: "omitted" }, context) : undefined;
          const from = optionalInteger(rest[0], 0, context), to = optionalInteger(rest[1], dimensions[0]!, context);
          if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > dimensions[0]!) throw new EraError(`Invalid ${name} range`);
          let row: ReturnType<Variables["row"]> | undefined;
          const element = (i: number): Value => (row ??= variables.row(reference.name, [...prefix, literal(0n)], context)).get(i);
          if (name.startsWith("FIND")) {
            const full = optionalInteger(rest[2], 0, context) !== 0;
            // A pattern without metacharacters matches literally, which avoids a regex test per element.
            const plain = typeof sought === "string" && !/[\\^$.|?*+()[\]{}]/.test(sought);
            const regex = typeof sought === "string" && !plain ? this.regex(full ? `^(?:${sought})$` : sought) : null;
            const matches = plain
              ? (value: Value): boolean => typeof value === "string" && (full ? value === sought : value.includes(sought as string))
              : (value: Value): boolean => {
                if (regex) regex.lastIndex = 0;
                return regex && typeof value === "string" ? regex.test(value) : value === sought;
              };
            if (name === "FINDELEMENT") { for (let i = from; i < to; i++) if (matches(element(i))) return BigInt(i); }
            else for (let i = to - 1; i >= from; i--) if (matches(element(i))) return BigInt(i);
            return -1n;
          }
          return this.reduceElements(name, element, from, to, sought);
        }
        if (CHARACTER_SCANS.has(name)) {
          // Scans one element across registered characters.
          const valued = name === "CMATCH";
          const [reference, ...rest] = args;
          if (!reference || reference.kind !== "variable" || args.length > (valued ? 4 : 3)) throw new EraError(`${name} expects a character array variable`);
          if (!variables.isCharacter(reference.name, context)) throw new EraError(`${name} requires a character variable`);
          const rank = variables.characterRank(reference.name, context);
          const indices = reference.indices.length > rank ? reference.indices.slice(1) : [...reference.indices];
          while (indices.length < rank) indices.push(literal(0n));
          const sought = valued ? evaluate(rest.shift() ?? { kind: "omitted" }, context) : undefined;
          const characters = Number(integer(context.get("CHARANUM", [])));
          const from = optionalInteger(rest[0], 0, context), to = optionalInteger(rest[1], characters, context);
          if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > characters) throw new EraError(`Invalid ${name} character range`);
          const element = (i: number): Value => variables.get(reference.name, [literal(BigInt(i)), ...indices], context);
          return this.reduceElements(name, element, from, to, sought);
        }
        if (name === "INRANGEARRAY" || name === "INRANGECARRAY") {
          // Counts elements with min <= value < max.
          const [reference, minExpr, maxExpr, startExpr, endExpr] = args;
          if (!reference || reference.kind !== "variable" || !minExpr || !maxExpr || args.length > 5) throw new EraError(`${name} expects an array variable, a minimum and a maximum`);
          const min = integer(evaluate(minExpr, context)), max = integer(evaluate(maxExpr, context));
          let element: (i: number) => Value, limit: number;
          if (name === "INRANGECARRAY") {
            if (!variables.isCharacter(reference.name, context)) throw new EraError(`${name} requires a character variable`);
            const rank = variables.characterRank(reference.name, context);
            const indices = reference.indices.length > rank ? reference.indices.slice(1) : [...reference.indices];
            while (indices.length < rank) indices.push(literal(0n));
            limit = Number(integer(context.get("CHARANUM", [])));
            element = (i) => variables.get(reference.name, [literal(BigInt(i)), ...indices], context);
          } else {
            const dimensions = variables.dimensions(reference.name, context);
            if (dimensions.length !== 1) throw new EraError(`${name} requires a one-dimensional array`);
            const prefix = reference.indices.length > 1 ? reference.indices.slice(0, -1) : [];
            limit = dimensions.at(-1)!;
            element = (i) => variables.get(reference.name, [...prefix, literal(BigInt(i))], context);
          }
          const from = optionalInteger(startExpr, 0, context), to = optionalInteger(endExpr, limit, context);
          if (from < 0 || from > limit || to < 0 || to > limit || from > to) throw new EraError(`Invalid ${name} range ${from} to ${to}`);
          let count = 0n;
          for (let i = from; i < to; i++) { const value = integer(element(i)); if (value >= min && value < max) count++; }
          return count;
        }
        if (name === "STRJOIN") {
          const [reference, delimiterExpr, startExpr, countExpr] = args;
          if (!reference || reference.kind !== "variable" || args.length > 4) throw new EraError("STRJOIN expects an array variable");
          const dimensions = variables.dimensions(reference.name, context);
          const last = dimensions.at(-1)!;
          const prefix = reference.indices.length >= dimensions.length ? reference.indices.slice(0, -1) : [...reference.indices];
          const delimiter = delimiterExpr && delimiterExpr.kind !== "omitted" ? text(evaluate(delimiterExpr, context)) : ",";
          const from = optionalInteger(startExpr, 0, context), count = optionalInteger(countExpr, last - from, context);
          if (count < 0) throw new EraError(`STRJOIN: argument 4 (${count}) must not be negative`);
          if (from < 0 || from + count > last) throw new EraError(`Invalid STRJOIN range ${from} to ${from + count}`);
          return Array.from({ length: count }, (_, i) => String(variables.get(reference.name, [...prefix, literal(BigInt(from + i))], context))).join(delimiter);
        }
        if (name === "REGEXPMATCH" && args.length === 4) {
          const [sourceExpr, patternExpr, countRef, matchesRef] = args;
          if (countRef?.kind !== "variable" || matchesRef?.kind !== "variable" || !variables.isString(matchesRef.name, context))
            throw new EraError("REGEXPMATCH expects an integer variable and a string array for its group count and matches");
          const result = this.regexpMatch(text(evaluate(sourceExpr!, context)), text(evaluate(patternExpr!, context)));
          variables.set(countRef.name, countRef.indices, BigInt(result.groups), context);
          if (result.count) this.writeArray(variables, context, { kind: "variable", name: matchesRef.name, indices: [] }, result.values);
          return BigInt(result.count);
        }
        if (name === "FINDCHARA" || name === "FINDLASTCHARA") {
          const [reference, soughtExpr, fromExpr, toExpr] = args;
          if (!reference || reference.kind !== "variable" || !soughtExpr || soughtExpr.kind === "omitted" || args.length > 4)
            throw new EraError(`${name} expects a character variable and a value`);
          if (!variables.isCharacter(reference.name, context)) throw new EraError(`${name} requires a character variable`);
          const rank = variables.characterRank(reference.name, context);
          const indices = reference.indices.length > rank ? reference.indices.slice(1) : [...reference.indices];
          while (indices.length < rank) indices.push(literal(0n));
          const sought = evaluate(soughtExpr, context);
          if ((typeof sought === "string") !== variables.isString(reference.name, context)) throw new EraError(`${name} value type does not match ${reference.name}`);
          const characters = Number(integer(context.get("CHARANUM", [])));
          const from = optionalInteger(fromExpr, 0, context), to = optionalInteger(toExpr, characters, context);
          if (!characters) return -1n;
          if (from < 0 || from >= characters) throw new EraError(`${name}: start ${from} is outside the character range`);
          if (to < 0 || to > characters) throw new EraError(`${name}: end ${to} is outside the character range`);
          const matches = (i: number) => variables.get(reference.name, [literal(BigInt(i)), ...indices], context) === sought;
          if (name === "FINDCHARA") { for (let i = from; i < to; i++) if (matches(i)) return BigInt(i); }
          else for (let i = to - 1; i >= from; i--) if (matches(i)) return BigInt(i);
          return -1n;
        }
        if ((name === "GDRAWSPRITE" && args.length === 7 || name === "GDRAWG" && args.length === 11) && args.at(-1)!.kind !== "omitted") {
          const values = args.slice(0, -1).map((arg) => evaluate(arg, context));
          return this.draw(name, values, this.colorMatrix(args.at(-1), variables, context, name));
        }
        if (FUNCTION_ENUMERATIONS.has(name) || name === "ENUMFILES") {
          const outputIndex = name === "ENUMFILES" ? 3 : 1;
          if (args.length < 1 || args.length > outputIndex + 1) throw new EraError(`Invalid number of arguments for ${name}`);
          const output = args[outputIndex];
          const destination: Expr = output && output.kind !== "omitted" ? output : { kind: "variable", name: "RESULTS", indices: [] };
          if (destination.kind !== "variable" || destination.indices.length || !variables.isString(destination.name, context)
            || variables.isCharacter(destination.name, context) || variables.dimensions(destination.name, context).length !== 1)
            throw new EraError(`${name} output must be a one-dimensional string array`);
          const first = text(evaluate(args[0]!, context));
          const matches = (id: string): boolean => name === "ENUMFUNCENDSWITH" ? id.endsWith(key(first)) : name === "ENUMFUNCWITH" ? id.includes(key(first)) : id.startsWith(key(first));
          const values = name === "ENUMFILES"
            ? this.enumerateFiles(first, args[1] && args[1].kind !== "omitted" ? text(evaluate(args[1], context)) : "*", optionalInteger(args[2], 0, context) !== 0)
            : first ? [...this.game.routines].filter(([id]) => !EVENT_FUNCTIONS.has(id) && matches(id)).map(([id, routines]) => routines[0]?.label ?? id) : [];
          if (!values) return -1n;
          const count = Math.min(values.length, variables.dimensions(destination.name, context)[0]!);
          this.writeArray(variables, context, destination, values.slice(0, count));
          return BigInt(count);
        }
        if (name === "MAP_GETKEYS") {
          if (args.length < 1 || args.length > 3) throw new EraError("MAP_GETKEYS expects map[, output, split]");
          const keys = [...(this.maps.get(text(evaluate(args[0]!, context)))?.keys() ?? [])];
          this.globals.set("RESULT", [], BigInt(keys.length), context);
          if (args.length < 2) return keys.join(",");
          const output = args.length === 3 ? args[1] : undefined;
          const destination: Expr = output ?? { kind: "variable", name: "RESULTS", indices: [] };
          if (destination.kind !== "variable" || destination.indices.length || !variables.isString(destination.name, context)
            || variables.dimensions(destination.name, context).length !== 1 || variables.isCharacter(destination.name, context))
            throw new EraError("MAP_GETKEYS output must be a one-dimensional string array");
          const split = optionalInteger(args.at(-1), 0, context) !== 0;
          const values = split ? keys : [keys.join(",")];
          const count = Math.min(values.length, variables.dimensions(destination.name, context)[0]!);
          this.writeArray(variables, context, destination, values.slice(0, count));
          return output ? "" : values[0] ?? "";
        }
        if (name === "ARRAYMSORTEX") {
          if (args.length < 2 || args.length > 4) throw new EraError("ARRAYMSORTEX expects key array, array names[, ascending, count]");
          const first = args[0]!;
          const keyName = first.kind === "variable" && !first.indices.length ? first.name : key(text(evaluate(first, context)));
          const list = args[1]!;
          if (list.kind !== "variable" || list.indices.length || !variables.isString(list.name, context)
            || variables.isCharacter(list.name, context) || variables.dimensions(list.name, context).length !== 1)
            throw new EraError("ARRAYMSORTEX targets must be a one-dimensional string array of variable names");
          if (variables.dimensions(keyName, context).length !== 1 || variables.isCharacter(keyName, context))
            throw new EraError("ARRAYMSORTEX key must be a non-character one-dimensional array");
          const keys = variables.row(keyName, [], context), requested = optionalInteger(args[3], -1, context);
          if (requested < -1 || requested > keys.size) throw new EraError("ARRAYMSORTEX count out of range");
          if (requested === 0) return 0n;
          const names = variables.row(list.name, [], context);
          const targets: string[] = [];
          for (let i = 0; i < names.size; i++) {
            const target = text(names.get(i));
            if (target) targets.push(key(target));
          }
          const order: number[] = [];
          for (let i = 0; i < (requested < 0 ? keys.size : requested); i++) {
            if (requested < 0 && (keys.get(i) === "" || keys.get(i) === 0n)) break;
            order.push(i);
          }
          const ascending = optionalInteger(args[2], 1, context) !== 0;
          order.sort((a, b) => (keys.get(a) < keys.get(b) ? -1 : keys.get(a) > keys.get(b) ? 1 : 0) * (ascending ? 1 : -1));
          for (const target of new Set(targets)) {
            const { variable } = variables.slot(target, context);
            if (variable.constant || variable.character) throw new EraError(`ARRAYMSORTEX cannot reorder ${target}`);
            if (variable.dimensions[0]! < order.length) return 0n;
          }
          for (const target of new Set(targets)) variables.permute(target, order, context);
          return 1n;
        }
        if (name === "ARRAYMSORT") {
          // Sorts the first array ascending up to its first 0/"" and applies that order to every array's first dimension.
          if (args.length < 2 || args.some((arg) => arg.kind !== "variable" || arg.indices.length)) throw new EraError("ARRAYMSORT expects at least two array variables");
          const names = args.map((arg) => (arg as { name: string }).name);
          if (variables.dimensions(names[0]!, context).length !== 1) throw new EraError("ARRAYMSORT key must be a one-dimensional array");
          const keys = variables.row(names[0]!, [], context);
          const entries: [Value, number][] = [];
          for (let i = 0; i < keys.size; i++) {
            const value = keys.get(i);
            if (value === 0n || value === "") break;
            entries.push([value, i]);
          }
          entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
          const order = entries.map(([, i]) => i);
          for (const array of names) if (!variables.permute(array, order, context)) return 0n;
          return 1n;
        }
        if (XML_FUNCTIONS.has(name)) return this.xmlFunction(name, args, variables, context);
        if (TABLE_REFERENCE_OPERATIONS.has(name)) {
          const outputIndex = name === "DT_SELECT" ? 3 : name === "DT_COLUMN_OPTIONS" ? -1 : 1;
          const values = args.map((arg, i): Value | undefined => {
            if (arg.kind === "omitted" || i === outputIndex) return undefined;
            if (name === "DT_COLUMN_OPTIONS" && i >= 2 && i % 2 === 0 && arg.kind === "variable" && !arg.indices.length) return arg.name;
            return evaluate(arg, context);
          });
          while (values.length && values.at(-1) === undefined) values.pop();
          const output = args[outputIndex]?.kind === "variable" ? args[outputIndex] as Expr & { kind: "variable" } : undefined;
          if (name === "DT_SELECT" && !output) return this.tableOperation(name, values, context);
          const result = this.dataTables.execute(name, values);
          if (output && variables.isString(output.name, context) !== (name !== "DT_SELECT")) throw new EraError(`${name} output variable has the wrong type`);
          const strings = (items: string[], fallback: number) => this.writeArray(variables, context, output ?? { kind: "variable", name: "RESULTS", indices: [literal(BigInt(fallback))] }, items);
          if (result.schema !== undefined) strings([result.schema], 1);
          if (result.names) strings(result.names, 0);
          if (result.selected && output) this.writeArray(variables, context, output, result.selected);
          return result.value;
        }
        if (name === "ERDNAME") {
          if (args.length < 2 || args.length > 3 || args[0]?.kind !== "variable") throw new EraError("ERDNAME expects variable, index[, dimension]");
          const table = args[0].name + (args[2] && args[2].kind !== "omitted" ? `@${integer(evaluate(args[2], context))}` : "");
          const index = integer(evaluate(args[1]!, context));
          return this.game.erdNames.get(table)?.get(Number(index)) ?? "";
        }
        if (name !== "GETNUM") return undefined;
        if (args.length < 2 || args.length > 3) throw new EraError("GETNUM expects a CSV variable and a name[, dimension]");
        const reference = args[0]!;
        if (reference.kind !== "variable" || reference.indices.length) throw new EraError("GETNUM expects a bare CSV variable");
        const table = args[2] && args[2].kind !== "omitted" ? `${reference.name}@${integer(evaluate(args[2], context))}` : symbolTable(reference.name);
        const symbols = this.game.names.get(table);
        if (!symbols) throw new EraError(`No CSV name table for ${reference.name}`);
        return BigInt(symbols.get(key(text(evaluate(args[1]!, context)))) ?? -1);
      },
      call: (name, args) => {
        if (TABLE_OPERATIONS.has(name)) return this.tableOperation(name, args, context);
        const arity = BUILTIN_ARITIES[name];
        if (arity && (args.length < arity[0] || args.length > arity[1]))
          throw new EraError(`Invalid number of arguments for ${name}`);
        switch (name) {
          case "VARSETEX": {
            const reference = this.parse(argText(args, name, 0));
            if (reference.kind !== "variable") throw new EraError("VARSETEX name must be a variable");
            if (args[1] === undefined) throw new EraError("VARSETEX requires a value");
            variables.fillExtended(reference.name, reference.indices, args[1], args[2] === undefined || argInt(args, name, 2) !== 0n,
              args[3] === undefined ? 0n : argInt(args, name, 3), args[4] === undefined ? undefined : argInt(args, name, 4), context);
            return 1n;
          }
          case "BARSTR": return this.bar(argInt(args, name, 0), argInt(args, name, 1), argInt(args, name, 2));
          case "SAVENOS": return integer(this.configValue("SaveDataNos"));
          case "EXISTCSV": return this.game.characters.has(Number(argInt(args, name, 0))) ? 1n : 0n;
          case "ISSKIP": return this.skipDisplay ? 1n : 0n;
          case "GETPALAMLV": case "GETEXPLV": {
            // The first level whose next threshold exceeds the value, capped at the maximum.
            const table = name === "GETPALAMLV" ? "PALAMLV" : "EXPLV", value = argInt(args, name, 0), maximum = argInt(args, name, 1);
            for (let i = 0n; i < maximum; i++) if (value < integer(this.globals.get(table, [literal(i + 1n)], context))) return i;
            return maximum;
          }
          case "MOUSESKIP": return 0n;
          case "RAND": {
            const [low, high] = args.length === 1 ? [0n, argInt(args, name, 0)] : [argInt(args, name, 0), argInt(args, name, 1)];
            if (high <= low) throw new EraError("RAND maximum must exceed its minimum");
            return low + this.random(high - low);
          }
          case "GETCHARA": {
            const sought = argInt(args, name, 0), count = this.globals.characterCount();
            for (let i = 0; i < count; i++) if (this.globals.get("NO", [literal(BigInt(i))], context) === sought) return BigInt(i);
            return -1n;
          }
          case "CSVNAME": case "CSVCALLNAME": case "CSVNICKNAME": case "CSVMASTERNAME": {
            const field = ({ CSVNAME: "名前", CSVCALLNAME: "呼び名", CSVNICKNAME: "あだ名", CSVMASTERNAME: "主人の呼び方" } as Record<string, string>)[name]!;
            return this.characterTemplate(argInt(args, name, 0)).rows.find((r) => r[0] === field)?.[1] ?? "";
          }
          case "INRANGE": return argInt(args, name, 0) >= argInt(args, name, 1) && argInt(args, name, 0) <= argInt(args, name, 2) ? 1n : 0n;
          case "SIGN": return argInt(args, name, 0) > 0n ? 1n : argInt(args, name, 0) < 0n ? -1n : 0n;
          case "ALLSAMES": case "NOSAMES": {
            if (!args.length) throw new EraError(`${name} requires arguments`);
            if (args.some((value) => typeof value !== typeof args[0])) throw new EraError(`${name}: arguments must all have the type of the first`);
            if (name === "ALLSAMES") return args.every((value) => value === args[0]) ? 1n : 0n;
            return new Set(args).size === args.length ? 1n : 0n;
          }
          case "COLOR_FROMNAME": {
            if (key(argText(args, name, 0)) === "TRANSPARENT") throw new EraError("COLOR_FROMNAME: Transparent is not supported");
            const color = KNOWN_COLORS[key(argText(args, name, 0))];
            return color === undefined ? -1n : BigInt("0x" + color.slice(1));
          }
          case "COLOR_FROMRGB": {
            for (let i = 0; i < 3; i++) if (argInt(args, name, i) < 0n || argInt(args, name, i) > 255n) throw new EraError(`COLOR_FROMRGB: argument ${i + 1} (${argInt(args, name, i)}) must be between 0 and 255`);
            return (argInt(args, name, 0) << 16n) + (argInt(args, name, 1) << 8n) + argInt(args, name, 2);
          }
          case "ENCODETOUNI": {
            const source = argText(args, name, 0);
            if (!source.length) return -1n;
            const position = args[1] === undefined ? 0 : Number(argInt(args, name, 1));
            if (position < 0) throw new EraError(`ENCODETOUNI: argument 2 (${position}) must not be negative`);
            if (position >= source.length) throw new EraError(`ENCODETOUNI: position ${position} is beyond the end of "${source}"`);
            return BigInt(source.codePointAt(position)!);
          }
          // Only the configured font is known to exist in the browser; scripts fall back to it otherwise.
          case "CHKFONT": return key(argText(args, name, 0)) === key(this.display.font) ? 1n : 0n;
          // The function form returns the instruction's RESULT state without touching RESULT/RESULTS.
          case "CHKDATA": return this.checkSave(this.saveFile(argInt(args, name, 0))).state;
          case "LINEISEMPTY": return this.printedLine === "" && this.printingHtml === "" ? 1n : 0n;
          case "HTML_GETPRINTEDSTR": {
            const lineNo = args[0] === undefined ? 0 : Number(argInt(args, name, 0));
            if (lineNo < 0) throw new EraError(`HTML_GETPRINTEDSTR: argument 1 (${lineNo}) must not be negative`);
            return this.printedLines[this.printedLines.length - 1 - lineNo] ?? "";
          }
          case "GETDOINGFUNCTION": {
            const routine = this.doing.at(-1);
            return routine ? routine.label ?? routine.name : "";
          }
          // Keyboard state, skip state and hover are not observable between inputs: nothing is held, skipped or hovered.
          case "MESSKIP": return this.messageSkip ? 1n : 0n;
          case "ISACTIVE": return this.client?.active === false ? 0n : 1n;
          case "GETKEY": case "GETKEYTRIGGERED": return 0n;
          // The JS heap is not collectable on demand, so no memory is reported as freed.
          case "CLEARMEMORY": return 0n;
          case "GETMEMORYUSAGE": return BigInt(process.memoryUsage().rss);
          case "PRINTCPERLINE": return BigInt(this.printCPerLine);
          case "PRINTCLENGTH": return BigInt(this.printCLength);
          case "MOUSEB": return "";
          // The text box is emptied when input is accepted, so scripts always observe an empty box.
          case "GETTEXTBOX": return this.textbox;
          case "SETTEXTBOX":
            this.textbox = argText(args, name, 0);
            this.textboxChanged = true;
            return 1n;
          case "ESCAPE": return argText(args, name, 0).replace(/[\t\n\f\r #$()*+.?[\^{|\\]/g, (c) =>
            ({ "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r" })[c] ?? "\\" + c);
          case "ISNUMERIC": return numericString(argText(args, name, 0)) === undefined ? 0n : 1n;
          case "ISDEFINED": return this.game.macros.has(key(argText(args, name, 0))) ? 1n : 0n;
          case "GROUPMATCH": return BigInt(args.slice(1).filter((value) => value === args[0]).length);
          case "TOLOWER": return argText(args, name, 0).toLowerCase();
          case "TOUPPER": return argText(args, name, 0).toUpperCase();
          case "TOFULL": return toFullWidth(argText(args, name, 0));
          case "TOHALF": return toHalfWidth(argText(args, name, 0));
          case "UNICODE": {
            const code = Number(argInt(args, name, 0));
            if (code < 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) throw new EraError("Invalid Unicode code point");
            return String.fromCodePoint(code);
          }
          case "GETBIT":
            if (argInt(args, name, 1) < 0n || argInt(args, name, 1) > 63n) throw new EraError("Bit index must be between 0 and 63");
            return (argInt(args, name, 0) >> argInt(args, name, 1)) & 1n;
          case "CSVCSTR": case "CSVABL": case "CSVTALENT": case "CSVBASE": case "CSVEXP": case "CSVRELATION": case "CSVFLAG": case "CSVCFLAG":
          case "CSVMARK": case "CSVJUEL": case "CSVEQUIP": {
            const template = this.characterTemplate(argInt(args, name, 0));
            const [field, table] = CSV_FIELDS[name]!;
            const row = template.rows.find((r) => r[0] === field && (/^\d+$/.test(r[1] ?? "") ? Number(r[1]) : this.game.names.get(table)?.get(key(r[1] ?? ""))) === Number(argInt(args, name, 1)));
            if (name === "CSVCSTR") return row?.[2] ?? "";
            return row ? this.characterNumber(row[2] ?? "", template.file) : 0n;
          }
          case "ABS": return BigInt.asIntN(64, argInt(args, name, 0) < 0n ? -argInt(args, name, 0) : argInt(args, name, 0));
          case "SQRT": case "CBRT": {
            if (argInt(args, name, 0) < 0n) throw new EraError(`${name}: argument 1 is negative (${argInt(args, name, 0)})`);
            return BigInt(Math.trunc(name === "SQRT" ? Math.sqrt(Number(argInt(args, name, 0))) : Math.pow(Number(argInt(args, name, 0)), 1 / 3)));
          }
          case "LOG": case "LOG10": case "EXPONENT": {
            if (name !== "EXPONENT" && argInt(args, name, 0) <= 0n) throw new EraError(`${name}: argument 1 must be positive (${argInt(args, name, 0)})`);
            const x = Number(argInt(args, name, 0));
            return doubleToInt64(name, name === "LOG" ? Math.log(x) : name === "LOG10" ? Math.log10(x) : Math.exp(x));
          }
          case "MIN": case "MAX":
            if (!args.length) throw new EraError(`${name} requires arguments`);
            return args.map((_, i) => argInt(args, name, i)).reduce((a, b) => name === "MIN" ? (a < b ? a : b) : (a > b ? a : b));
          case "LIMIT":
            if (argInt(args, name, 1) > argInt(args, name, 2)) throw new EraError("LIMIT minimum exceeds maximum");
            return argInt(args, name, 0) < argInt(args, name, 1) ? argInt(args, name, 1) : argInt(args, name, 0) > argInt(args, name, 2) ? argInt(args, name, 2) : argInt(args, name, 0);
          case "MONEYSTR": {
            const value = argInt(args, name, 0);
            let formatted = value.toString();
            if (args[1] !== undefined) {
              const format = argText(args, name, 1);
              if (format === "#,##0") formatted = formatted.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
              else if (/^0{1,100}$/.test(format))
                formatted = (value < 0n ? "-" : "") + (value < 0n ? -value : value).toString().padStart(format.length, "0");
              else throw new EraError(`Unsupported MONEYSTR format: ${format}`);
            }
            return this.game.money.first ? this.game.money.label + formatted : formatted + this.game.money.label;
          }
          case "TOSTR": {
            const value = argInt(args, name, 0).toString();
            if (args.length < 2) return value;
            const format = argText(args, name, 1);
            const result = format.length <= 100 ? formatInteger(argInt(args, name, 0), format) : undefined;
            if (result === undefined) throw new EraError(`Unsupported TOSTR format: ${format}`);
            return result;
          }
          case "TOINT": {
            return numericString(argText(args, name, 0), "convert") ?? 0n;
          }
          case "STRLENU": return BigInt([...argText(args, name, 0)].length);
          case "STRLENSU": return BigInt(argText(args, name, 0).length);
          case "MAXWIDTH": return BigInt(this.columns);
          case "CURRENTREDRAW": return this.redraw;
          // Graphics are display lists painted by the browser; pixels are never read back here.
          case "SPRITECREATED": return this.sprite(argText(args, name, 0)) ? 1n : 0n;
          case "SPRITEWIDTH": return BigInt(this.sprite(argText(args, name, 0))?.width ?? 0);
          case "SPRITEHEIGHT": return BigInt(this.sprite(argText(args, name, 0))?.height ?? 0);
          case "SPRITEPOSX": return BigInt(this.sprite(argText(args, name, 0))?.x ?? 0);
          case "SPRITEPOSY": return BigInt(this.sprite(argText(args, name, 0))?.y ?? 0);
          case "SPRITESETPOS": case "SPRITEMOVE": {
            const sprite = this.sprite(argText(args, name, 0));
            if (!sprite) return 0n;
            sprite.x = Number(argInt(args, name, 1)) + (name === "SPRITEMOVE" ? sprite.x : 0);
            sprite.y = Number(argInt(args, name, 2)) + (name === "SPRITEMOVE" ? sprite.y : 0);
            return 1n;
          }
          case "SPRITECREATE": {
            const graphics = this.graphics.get(argInt(args, name, 1));
            if (!argText(args, name, 0) || this.sprite(argText(args, name, 0)) || !graphics) return 0n;
            const rect: Rect = args.length === 6 ? [Number(argInt(args, name, 2)), Number(argInt(args, name, 3)), Number(argInt(args, name, 4)), Number(argInt(args, name, 5))] : [0, 0, graphics.width, graphics.height];
            if (args.length !== 2 && args.length !== 6) throw new EraError("SPRITECREATE expects a name and a G id, optionally followed by x, y, width and height");
            // Emuera allows negative sizes (mirroring) but the rectangle must overlap the G.
            const [x, y, width, height] = rect, left = Math.min(x, x + width), top = Math.min(y, y + height);
            if (!width || !height || left >= graphics.width || top >= graphics.height || left + Math.abs(width) <= 0 || top + Math.abs(height) <= 0)
              throw new EraError("SPRITECREATE rectangle is outside the graphics");
            this.dynamicSprites.set(key(argText(args, name, 0)), { width, height, x: 0, y: 0, graphics: argInt(args, name, 1), rect });
            return 1n;
          }
          case "SPRITEANIMECREATE": {
            if (!argText(args, name, 0) || this.sprite(argText(args, name, 0))) return 0n;
            const [width, height] = [Number(argInt(args, name, 1)), Number(argInt(args, name, 2))];
            if (width <= 0 || height <= 0) throw new EraError(`${name}: the size must be positive`);
            if (width > 8192 || height > 8192) throw new EraError(`${name}: the size must be at most 8192`);
            this.dynamicSprites.set(key(argText(args, name, 0)), { width, height, x: 0, y: 0, frames: [] });
            return 1n;
          }
          case "SPRITEANIMEADDFRAME": {
            const sprite = argText(args, name, 0) ? this.sprite(argText(args, name, 0)) : undefined;
            const graphics = this.graphics.get(argInt(args, name, 1));
            if (!sprite?.frames || !graphics) return 0n;
            const [x, y, width, height, delay] = [2, 3, 4, 5, 8].map((i) => Number(argInt(args, name, i))) as [number, number, number, number, number];
            if (width <= 0 || height <= 0 || x < 0 || y < 0 || x + width > graphics.width || y + height > graphics.height) return 0n;
            if (delay <= 0 || delay > 0x7fff_ffff) return 0n;
            sprite.frames.push(animationFrame({ graphics: argInt(args, name, 1), delay }, [x, y, width, height], [Number(argInt(args, name, 6)), Number(argInt(args, name, 7))], sprite.width, sprite.height));
            return 1n;
          }
          case "SPRITEDISPOSE": {
            const id = key(argText(args, name, 0));
            const dynamic = this.dynamicSprites.delete(id);
            const resource = this.game.sprites.has(id) && !this.disposedSprites.has(id);
            if (resource) this.disposedSprites.add(id);
            this.spriteSizes.delete(id);
            return dynamic || resource ? 1n : 0n;
          }
          case "SPRITEDISPOSEALL": {
            let count = this.dynamicSprites.size;
            this.dynamicSprites.clear();
            if (argInt(args, name, 0) !== 0n) {
              for (const id of this.game.sprites.keys()) if (!this.disposedSprites.has(id)) { this.disposedSprites.add(id); count++; }
              this.spriteSizes.clear();
            }
            return BigInt(count);
          }
          case "GCREATE": {
            if (this.graphics.has(argInt(args, name, 0))) return 0n;
            const width = Number(argInt(args, name, 1)), height = Number(argInt(args, name, 2));
            if (width <= 0 || height <= 0 || width > 8192 || height > 8192) throw new EraError("GCREATE size must be between 1 and 8192");
            this.graphics.set(argInt(args, name, 0), { width, height, ops: [] });
            return 1n;
          }
          case "GCREATEFROMFILE": {
            if (this.graphics.has(argInt(args, name, 0)) || !this.game.root) return 0n;
            const resources = path.resolve(gameDirectory(this.game.root, "resources"));
            const file = path.resolve(resources, argText(args, name, 1).replaceAll("\\", "/"));
            if (!file.startsWith(resources + path.sep)) return 0n;
            const size = imageSize(file);
            if (!size) return 0n;
            const whole: Rect = [0, 0, size.width, size.height];
            this.graphics.set(argInt(args, name, 0), { ...size, ops: [{ op: "image", url: this.resourceUrl(path.relative(resources, file)), src: whole, dest: whole }] });
            return 1n;
          }
          case "GCREATED": return this.graphics.has(argInt(args, name, 0)) ? 1n : 0n;
          case "GWIDTH": return BigInt(this.graphics.get(argInt(args, name, 0))?.width ?? 0);
          case "GHEIGHT": return BigInt(this.graphics.get(argInt(args, name, 0))?.height ?? 0);
          case "GDISPOSE": return this.graphics.delete(argInt(args, name, 0)) ? 1n : 0n;
          case "GGETCOLOR": return this.graphics.has(argInt(args, name, 0)) ? 0n : -1n;
          case "GDRAWSPRITE": case "GDRAWG": return this.draw(name, args);
          case "GDRAWGWITHROTATE": {
            if (args.length !== 3 && args.length !== 5) throw new EraError("GDRAWGWITHROTATE takes 3 or 5 arguments");
            const canvas = this.graphics.get(argInt(args, name, 0)), source = this.picture(argInt(args, name, 1));
            if (!canvas || !source) return 0n;
            const x = args.length === 5 ? Number(argInt(args, name, 3)) : Math.trunc(source.width / 2);
            const y = args.length === 5 ? Number(argInt(args, name, 4)) : Math.trunc(source.height / 2);
            canvas.ops.push({ op: "rotate", angle: Number(argInt(args, name, 2) % 360n), x, y },
              { op: "graphics", source, src: [0, 0, source.width, source.height], dest: [0, 0, source.width, source.height] });
            return 1n;
          }
          case "GDRAWGWITHMASK": {
            const canvas = this.graphics.get(argInt(args, name, 0)), source = this.picture(argInt(args, name, 1)), mask = this.picture(argInt(args, name, 2));
            if (!canvas || !source || !mask || source.width !== mask.width || source.height !== mask.height) return 0n;
            const x = Number(argInt(args, name, 3)), y = Number(argInt(args, name, 4));
            if (x + source.width > canvas.width || y + source.height > canvas.height) return 0n;
            canvas.ops.push({ op: "mask", source, mask, x, y });
            return 1n;
          }
          case "GCLEAR": {
            if (args.length !== 2 && args.length !== 6) throw new EraError("GCLEAR takes 2 or 6 arguments");
            const canvas = this.graphics.get(argInt(args, name, 0));
            if (!canvas) return 0n;
            const color = argbColor(argInt(args, name, 1), name);
            if (args.length >= 6) canvas.ops.push({ op: "fill", color, rect: [Number(argInt(args, name, 2)), Number(argInt(args, name, 3)), Number(argInt(args, name, 4)), Number(argInt(args, name, 5))], replace: true });
            else canvas.ops = [
              ...(argInt(args, name, 1) >> 24n ? [{ op: "fill" as const, color, rect: [0, 0, canvas.width, canvas.height] as Rect, replace: true }] : []),
              ...canvas.ops.filter((op) => op.op === "rotate"),
            ];
            return 1n;
          }
          case "GSETCOLOR": {
            const canvas = this.graphics.get(argInt(args, name, 0));
            if (!canvas) return 0n;
            const x = Number(argInt(args, name, 2)), y = Number(argInt(args, name, 3));
            if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) throw new EraError("GSETCOLOR position is outside the graphics");
            canvas.ops.push({ op: "fill", color: argbColor(argInt(args, name, 1), name), rect: [x, y, 1, 1], replace: true,
              ...(canvas.ops.some((op) => op.op === "rotate") ? { absolute: true } : {}) });
            return 1n;
          }
          case "GSETBRUSH": {
            const canvas = this.graphics.get(argInt(args, name, 0));
            if (!canvas) return 0n;
            canvas.brush = argbColor(argInt(args, name, 1), name);
            return 1n;
          }
          case "GFILLRECTANGLE": {
            const canvas = this.graphics.get(argInt(args, name, 0));
            if (!canvas) return 0n;
            canvas.ops.push({ op: "fill", color: canvas.brush ?? this.display.background, rect: [Number(argInt(args, name, 1)), Number(argInt(args, name, 2)), Number(argInt(args, name, 3)), Number(argInt(args, name, 4))] });
            return 1n;
          }
          case "GSETPEN": {
            const canvas = this.graphics.get(argInt(args, name, 0));
            const width = Number(argInt(args, name, 2));
            if (width < 0 || width > 8192) throw new EraError("GSETPEN width must be between 0 and 8192");
            const color = argbColor(argInt(args, name, 1), name);
            if (!canvas) return 0n;
            canvas.pen = { color, width: width || 1 };
            return 1n;
          }
          case "GSETFONT": {
            const font = this.graphicFont(argText(args, name, 1), Number(argInt(args, name, 2)), Number(args[3] === undefined ? 0n : argInt(args, name, 3)));
            const canvas = this.graphics.get(argInt(args, name, 0));
            if (!canvas) return 0n;
            canvas.font = font;
            return 1n;
          }
          case "GGETFONT": return this.graphics.get(argInt(args, name, 0))?.font?.name ?? this.defaultGraphicFont().name;
          case "GGETFONTSIZE": return BigInt(this.graphics.get(argInt(args, name, 0))?.font?.size ?? this.defaultGraphicFont().size);
          case "GGETFONTSTYLE": return BigInt(this.graphics.get(argInt(args, name, 0))?.font?.style ?? 0);
          case "GDRAWLINE": {
            const canvas = this.graphics.get(argInt(args, name, 0));
            if (!canvas) return 0n;
            canvas.ops.push({ op: "line", ...(canvas.pen ?? { color: this.display.foreground, width: 1 }),
              from: [Number(argInt(args, name, 1)), Number(argInt(args, name, 2))], to: [Number(argInt(args, name, 3)), Number(argInt(args, name, 4))] });
            return 1n;
          }
          case "GDRAWTEXT": {
            if (args.length === 3) throw new EraError("GDRAWTEXT x and y must be supplied together");
            const canvas = this.graphics.get(argInt(args, name, 0));
            if (!canvas) return 0n;
            canvas.ops.push({ op: "text", text: argText(args, name, 1), color: canvas.brush ?? this.display.foreground,
              x: Number(args[2] === undefined ? 0n : argInt(args, name, 2)), y: Number(args[3] === undefined ? 0n : argInt(args, name, 3)),
              font: { ...(canvas.font ?? this.defaultGraphicFont()) } });
            return 1n;
          }
          case "GGETTEXTSIZE": {
            const font = this.graphicFont(argText(args, name, 1), Number(argInt(args, name, 2)), Number(args[3] === undefined ? 0n : argInt(args, name, 3)));
            // The server uses the same fixed-cell measurement as HTML_STRINGLEN, not platform GDI+ metrics.
            const lines = argText(args, name, 0).split(/\r?\n/);
            this.globals.set("RESULT", [literal(1n)], BigInt(font.size * lines.length), context);
            return BigInt(Math.ceil(Math.max(...lines.map((line) => stringWidth(line))) * font.size / 2));
          }
          case "GSAVE": case "GLOAD": return 0n;
          case "CURRENTALIGN": return this.style.alignment.toUpperCase();
          case "GETCOLOR": return BigInt("0x" + this.style.color.slice(1));
          case "POWER": return power(argInt(args, name, 0), argInt(args, name, 1));
          case "EXISTFUNCTION": {
            // 1: ordinary function, 2: #FUNCTION, 3: #FUNCTIONS; built-ins and undefined names give 0.
            const routines = this.game.routines.get(key(argText(args, name, 0)));
            if (!routines?.length) return 0n;
            const returnType = this.info(routines[0]!).returnType;
            return returnType === "string" ? 3n : returnType === "integer" ? 2n : 1n;
          }
          case "GETMETH": case "GETMETHS": {
            // Calls a #FUNCTION/#FUNCTIONS by name; the second argument is returned when it is not defined.
            const target = key(argText(args, name, 0)), wanted = name === "GETMETHS" ? "string" : "integer";
            const routines = this.game.routines.get(target);
            const returnType = routines?.length === 1 ? this.info(routines[0]!).returnType : undefined;
            if (!returnType) {
              if (args[1] === undefined) throw new EraError(`${name}: ${argText(args, name, 0)} is not a defined expression function`);
              return wanted === "string" ? argText(args, name, 1) : argInt(args, name, 1);
            }
            if (returnType !== wanted) throw new EraError(`${name}: ${argText(args, name, 0)} does not return ${wanted === "string" ? "a string" : "an integer"}`);
            return this.expressionFunction(target, args.slice(2));
          }
          case "GETCONFIG": case "GETCONFIGS": {
            const value = this.configValue(argText(args, name, 0));
            if ((typeof value === "string") !== (name === "GETCONFIGS"))
              throw new EraError(`${name}: ${argText(args, name, 0)} is ${typeof value === "string" ? "a string; use GETCONFIGS" : "an integer; use GETCONFIG"}`);
            return value;
          }
          case "GETSTYLE": return BigInt(this.style.fontStyle);
          case "GETBGCOLOR": return BigInt("0x" + this.style.background.slice(1));
          case "GETDEFCOLOR": return BigInt("0x" + this.display.foreground.slice(1));
          case "GETDEFBGCOLOR": return BigInt("0x" + this.display.background.slice(1));
          case "GETFONT": return this.style.font ?? this.display.font;
          case "GETTIME": return currentTime()[0];
          case "GETTIMES": return currentTime()[1];
          case "GETMILLISECOND": return BigInt(Date.now()) + EPOCH_OFFSET_MS;
          case "GETSECOND": return (BigInt(Date.now()) + EPOCH_OFFSET_MS) / 1000n;
          case "CONVERT": {
            const base = argInt(args, name, 1);
            if (base !== 2n && base !== 8n && base !== 10n && base !== 16n) throw new EraError("CONVERT base must be 2, 8, 10 or 16");
            // Like .NET Convert.ToString(long, base): two's complement for non-decimal bases.
            return base === 10n ? argInt(args, name, 0).toString() : BigInt.asUintN(64, argInt(args, name, 0)).toString(Number(base));
          }
          case "SUBSTRINGU": {
            const source = argText(args, name, 0);
            const start = Number(argInt(args, name, 1));
            let length = args[2] === undefined ? -1 : Number(argInt(args, name, 2));
            if (start >= source.length || length === 0) return "";
            if (length < 0 || length > source.length) length = source.length;
            const from = Math.max(0, start);
            return source.slice(from, Math.min(source.length, from + length));
          }
          case "CHARATU": {
            const position = Number(argInt(args, name, 1));
            return position < 0 || position >= argText(args, name, 0).length ? "" : argText(args, name, 0)[position]!;
          }
          case "EXISTFILE": return this.gameFile(argText(args, name, 0)) ? 1n : 0n;
          case "FIND_CHARADATA": {
            // Directory.GetFiles("chara_<pattern>.dat"): * and ? wildcards, case-insensitive; the empty name never matches.
            const pattern = args[0] === undefined ? "*" : argText(args, name, 0);
            const glob = new RegExp(`^${[...pattern].map((c) => c === "*" ? ".*" : c === "?" ? "." : c.replace(/[\\^$.+()[\]{}|]/g, "\\$&")).join("")}$`, "isu");
            const names = this.saves.list().flatMap((file) => {
              const match = /^chara_(.*)\.dat$/i.exec(file);
              const name = match?.[1] ?? "";
              return name && glob.test(name) ? [name] : [];
            }).sort();
            const size = this.globals.dimensions("RESULTS", context)[0]!;
            names.slice(0, size).forEach((name, i) => this.globals.set("RESULTS", [literal(BigInt(i))], name, context));
            return BigInt(names.length);
          }
          case "CHKCHARADATA": {
            const result = this.checkSave(this.charaFile(argText(args, name, 0)));
            this.globals.set("RESULTS", [], result.message, context);
            return result.state;
          }
          case "SAVETEXT": {
            const file = this.textFile(args[1]!);
            if (!file) return 0n;
            this.saves.write(file.store, argText(args, name, 0));
            return 1n;
          }
          case "LOADTEXT": {
            const file = this.textFile(args[0]!);
            if (!file) return "";
            const saved = this.saves.read(file.store) ?? (file.game ? readTextFileSync(file.game) : null);
            return (saved?.toString() ?? "").replace(/\r/g, "");
          }
          case "EXISTVAR": {
            // Bit flags: 1 integer, 2 string, 4 constant, 8 two-dimensional, 16 three-dimensional.
            const target = argText(args, name, 0);
            if (!variables.has(target)) return 0n;
            const rank = variables.dimensions(target, context).length;
            return (variables.isString(target, context) ? 2n : 1n) | (variables.isConstant(target, context) ? 4n : 0n) | (rank === 2 ? 8n : rank === 3 ? 16n : 0n);
          }
          case "GETVAR": case "GETVARS": {
            const reference = this.parse(argText(args, name, 0));
            if (reference.kind !== "variable") throw new EraError(`${name} requires a variable reference string`);
            const value = evaluate(reference, context);
            if ((typeof value === "string") !== (name === "GETVARS")) throw new EraError(`${name} variable type mismatch: ${argText(args, name, 0)}`);
            return value;
          }
          case "VARSIZE": {
            const variable = key(argText(args, name, 0));
            const dimensions = variables.has(variable) ? variables.dimensions(variable, context) : this.game.variableSizes.get(variable);
            if (!dimensions) throw new EraError(`Unknown variable for VARSIZE: ${variable}`);
            const dimension = args.length === 2 ? Number(argInt(args, name, 1)) : 0;
            const size = dimensions[dimension];
            if (size === undefined) throw new EraError(`Invalid VARSIZE dimension: ${dimension}`);
            return BigInt(size);
          }
          case "MAP_EXIST": return this.maps.has(argText(args, name, 0)) ? 1n : 0n;
          case "MAP_SIZE": return BigInt(this.map(argText(args, name, 0)).size);
          case "MAP_HAS": return this.maps.get(argText(args, name, 0))?.has(argText(args, name, 1)) ? 1n : 0n;
          case "MAP_GET": return this.map(argText(args, name, 0)).get(argText(args, name, 1)) ?? "";
          case "MAP_CLEAR": {
            const map = this.maps.get(argText(args, name, 0));
            if (!map) return -1n;
            map.clear();
            return 1n;
          }
          case "MAP_FROMXML": {
            const map = this.maps.get(argText(args, name, 0));
            if (!map) return 0n;
            const document = parseXml(argText(args, name, 1));
            for (const pair of selectNodes(document, "/map/p")) {
              const keys = selectNodes(pair, "./k"), values = selectNodes(pair, "./v");
              if (keys.length === 1 && values.length === 1) map.set(nodeOutput(keys[0]!, 1), nodeOutput(values[0]!, 2));
            }
            return 1n;
          }
          case "MAP_REMOVE": {
            const map = this.maps.get(argText(args, name, 0));
            if (!map) return -1n;
            return map.delete(argText(args, name, 1)) ? 1n : 0n;
          }
          case "MAP_TOXML": {
            const map = this.maps.get(argText(args, name, 0));
            if (!map) return "";
            return `<map>${[...map].map(([k, v]) => `<p><k>${escapeHtml(k)}</k><v>${escapeHtml(v)}</v></p>`).join("")}</map>`;
          }
          case "GETNUMB": {
            const variable = key(argText(args, name, 0));
            if (!variables.has(variable)) throw new EraError(`GETNUMB: unknown variable ${variable}`);
            return BigInt(this.game.names.get(symbolTable(variable))?.get(key(argText(args, name, 1))) ?? -1);
          }
          case "MOUSEX": return BigInt(this.client?.mouseX ?? 0);
          case "MOUSEY": return BigInt(this.client?.mouseY ?? 0);
          case "EXISTSOUND": return this.gameFile("sound/" + argText(args, name, 0)) ? 1n : 0n;
          case "STRFORM": return evaluate(parseFormat(argText(args, name, 0).split(/\r?\n/)[0]!), context);
          case "HTML_POPPRINTINGSTR": {
            const html = this.printingHtml;
            if (html) this.deferOutput({ type: "clear", count: 1 });
            this.printingHtml = "";
            this.printedLine = "";
            return html;
          }
          case "HTML_TOPLAINTEXT": return plainHtml(argText(args, name, 0));
          case "HTML_STRINGLEN": {
            const fontSize = Number(this.configValue("フォントサイズ"));
            const measured = htmlWidth(argText(args, name, 0), fontSize, (id) => this.sprite(id));
            // Without <nobr> the first line wraps at Config.DrawableWidth.
            const pixels = measured.nobr ? measured.pixels : Math.min(measured.pixels, this.drawableWidth());
            return args[1] !== undefined && argInt(args, name, 1) !== 0n ? BigInt(Math.round(pixels)) : BigInt(Math.ceil(pixels / (fontSize / 2)));
          }
          case "HTML_STRINGLINES": {
            const width = Number(argInt(args, name, 1));
            if (width <= 0) throw new EraError("HTML_STRINGLINES width must be positive");
            return BigInt(htmlLineCount(argText(args, name, 0), width, Number(this.configValue("FontSize")), (id) => this.sprite(id)));
          }
          case "HTML_ESCAPE": return escapeHtml(argText(args, name, 0));
          // EM sizes the drawing area to WindowX by WindowY less the input box (one line high).
          case "CLIENTWIDTH": return this.client ? BigInt(this.client.width) : integer(this.configValue("WindowX"));
          case "CLIENTHEIGHT": return this.client ? BigInt(this.client.height) : integer(this.configValue("WindowY")) - integer(this.configValue("LineHeight"));
          case "STRLENS": return BigInt(stringWidth(argText(args, name, 0)));
          case "STRCOUNT": {
            const matches = this.regex(argText(args, name, 1));
            return BigInt([...argText(args, name, 0).matchAll(matches)].length);
          }
          case "REGEXPMATCH": {
            const result = this.regexpMatch(argText(args, name, 0), argText(args, name, 1));
            if (args[2] !== undefined && argInt(args, name, 2) !== 0n) {
              this.globals.set("RESULT", [literal(1n)], BigInt(result.groups), context);
              if (result.count) this.writeArray(this.globals, context, { kind: "variable", name: "RESULTS", indices: [] }, result.values);
            }
            return BigInt(result.count);
          }
          case "REPLACE": return replaceRegex(argText(args, name, 0), this.regex(argText(args, name, 1)), argText(args, name, 2));
          case "STRFIND": case "STRFINDU": {
            const source = argText(args, name, 0), sought = argText(args, name, 1);
            let start = args[2] === undefined ? 0 : Number(argInt(args, name, 2));
            if (!Number.isSafeInteger(start) || start < 0) throw new EraError(`Invalid ${name} start index`);
            if (name === "STRFINDU") return start > source.length ? -1n : BigInt(source.indexOf(sought, start));
            // STRFIND counts full-width characters as two positions.
            let index = 0;
            for (let width = 0; index < source.length && width < start; index++) width += stringWidth(source[index]!);
            const found = source.indexOf(sought, index);
            return found < 0 ? -1n : BigInt(stringWidth(source.slice(0, found)));
          }
          case "SUBSTRING": {
            const start = Number(argInt(args, name, 1));
            const length = args[2] === undefined ? -1 : Number(argInt(args, name, 2));
            if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length))
              throw new EraError("Invalid SUBSTRING range");
            // Positions inside a full-width character move to the following character boundary.
            let offset = 0, result = "";
            for (const c of argText(args, name, 0)) {
              const width = stringWidth(c);
              if (offset >= start && (length < 0 || offset < start + length)) result += c;
              offset += width;
            }
            return result;
          }
          default: {
            if (!this.game.routines.has(name)) throw new EraError(`Unsupported expression function: ${name}`);
            if (!BUILTIN_ARITIES[name] && !TABLE_OPERATIONS.has(name)) this.userFunctions.add(name);
            return this.expressionFunction(name, args);
          }
        }
      },
    };
    this.contexts.set(variables, context);
    return context;
  }
  private reduceElements(name: string, element: (i: number) => Value, from: number, to: number, sought: Value | undefined): Value {
    if (name === "MATCH" || name === "CMATCH") {
      let count = 0n;
      for (let i = from; i < to; i++) if (element(i) === sought) count++;
      return count;
    }
    if (name.startsWith("SUM")) {
      let sum = 0n;
      for (let i = from; i < to; i++) sum += integer(element(i));
      return BigInt.asIntN(64, sum);
    }
    const maximum = name.startsWith("MAX");
    let result = integer(element(from));
    for (let i = from; i < to; i++) {
      const value = integer(element(i));
      if (maximum ? value > result : value < result) result = value;
    }
    return result;
  }
  private expressionFunction(name: string, args: Argument[], native = true): Value {
    if (native) {
      const intrinsic = this.intrinsics.get(name);
      if (intrinsic) {
        const value = intrinsic(args);
        if (value !== DECLINE) return value;
      }
    }
    const source = this.currentSource;
    if (++this.depth > 128) { this.depth--; throw new EraError("Call depth limit exceeded", this.currentSource); }
    let generator: Generator<Yield, Value | undefined, string> | undefined;
    let pushed = false;
    try {
      const routines = this.game.routines.get(name);
      if (!routines?.length) throw new EraError(`Undefined function: ${name}`, this.currentSource);
      if (routines.length !== 1) throw new EraError(`${name} has multiple definitions and cannot be used as an expression function`, this.currentSource);
      const { frame, routine } = this.prepare(name, args, true, routines[0]!);
      this.doing.push(routine);
      pushed = true;
      const code = frame.compiled.code;
      // A body that is a single RETURNF needs no generator; this mirrors runFrame's handling of that instruction.
      if (code.length === 1 && code[0]!.op === "RETURNF" && code[0]!.args && !this.finished) {
        const line = code[0]!;
        this.currentSource = line;
        try {
          if (++this.steps > this.maxSteps) throw new EraError("Instruction limit exceeded between inputs", line);
          const value = evaluate(line.parsed ??= this.parse(line.args), frame.context);
          return frame.returnType === "string" ? text(value) : integer(value);
        } catch (error) {
          if (error instanceof EraError) {
            if (!error.source) error.source = line;
            else if (error.source !== line && error.trace.length < 30) error.trace.push(line);
          }
          throw error;
        }
      }
      const entry = this.jit?.entry(frame.compiled);
      if (entry && !entry.generator) {
        const value = (entry.run(this, frame) as Value | undefined) ?? (frame.returnType === "string" ? "" : frame.returnType ? 0n : undefined);
        if (value === undefined) throw new EraError(`Expression function ${name} did not return a value`);
        return value;
      }
      generator = this.runFrame(frame);
      let result = generator.next();
      // Output is allowed and precedes the calling instruction's own output; input is not.
      while (!result.done) {
        if ("input" in result.value) throw new EraError(`Expression function ${name} attempted input`, this.currentSource);
        this.deferred.push(result.value.output);
        result = generator.next();
      }
      // runFrame returns nothing when the body ends without RETURNF; execute substitutes the type's default.
      const value = result.value ?? (frame.returnType === "string" ? "" : frame.returnType ? 0n : undefined);
      if (value === undefined) throw new EraError(`Expression function ${name} did not return a value`);
      return value;
    } catch (error) {
      if (error instanceof EraError) this.captureError(error);
      throw error;
    } finally {
      generator?.return(undefined);
      if (pushed) this.doing.pop();
      this.depth--;
      this.currentSource = source;
    }
  }
  private tableOperation(name: string, args: (Value | undefined)[], context: EvaluationContext): Value {
    const result = this.dataTables.execute(name, args);
    if (result.selected) {
      const capacity = this.globals.dimensions("RESULT", context)[0]! - 1;
      if (capacity > 0 && result.selected.length)
        this.globals.setMany("RESULT", [literal(1n)], result.selected.slice(0, capacity), context);
      this.globals.set("RESULT", [], result.value, context);
    }
    return result.value;
  }
  /** Writes values into consecutive elements of an array reference, clipped to the array's end. */
  private writeArray(variables: Variables, context: EvaluationContext, reference: Expr & { kind: "variable" }, items: Value[]): void {
    const dimensions = variables.dimensions(reference.name, context);
    const indices = [...reference.indices];
    while (indices.length < dimensions.length) indices.push(literal(0n));
    const start = dimensions.length ? Number(integer(evaluate(indices.at(-1)!, context))) : 0;
    const capacity = dimensions.length ? dimensions.at(-1)! - start : 1;
    if (items.length) variables.setMany(reference.name, indices, items.slice(0, Math.max(0, capacity)), context);
  }
  /** Emuera-EM XML functions over XML strings, string variables (written back) or stored XmlDocuments. */
  private xmlFunction(name: string, args: Expr[], variables: Variables, context: EvaluationContext): Value {
    const base = name.replace(/_BYNAME$/, "");
    const limits: Record<string, [number, number]> = {
      XML_DOCUMENT: [2, 2], XML_RELEASE: [1, 1], XML_EXIST: [1, 1], XML_TOSTR: [1, 1],
      XML_GET: [2, 4], XML_ADDNODE: [3, 5], XML_REMOVENODE: [2, 3],
      XML_SET: [3, 5], XML_REPLACE: [2, 4], XML_ADDATTRIBUTE: [3, 6], XML_REMOVEATTRIBUTE: [2, 3],
    };
    const [min, max] = limits[base]!;
    if (args.length < min || args.length > max) throw new EraError(`Invalid number of arguments for ${name}`);
    const value = (i: number): Value | undefined => args[i] && args[i]!.kind !== "omitted" ? evaluate(args[i]!, context) : undefined;
    const number = (i: number): number => Number(integer(value(i) ?? 0n));
    const id = (): string => String(value(0)!);
    switch (base) {
      case "XML_REPLACE": {
        if (args.length !== 2) break;
        const replacement = parseXml(text(value(1)!));
        if (!this.xmlDocuments.has(id())) return -1n;
        this.xmlDocuments.set(id(), replacement);
        return 1n;
      }
      case "XML_DOCUMENT": {
        if (this.xmlDocuments.has(id())) return 0n;
        this.xmlDocuments.set(id(), parseXml(text(value(1)!)));
        return 1n;
      }
      case "XML_RELEASE": this.xmlDocuments.delete(id()); return 1n;
      case "XML_EXIST": return this.xmlDocuments.has(id()) ? 1n : 0n;
      case "XML_TOSTR": {
        const document = this.xmlDocuments.get(id());
        return document ? serializeXml(document.documentElement!) : "";
      }
    }
    // A string first argument is XML text unless the _BYNAME form names a stored document.
    const source = value(0)!;
    const stored = name.endsWith("_BYNAME") || typeof source === "bigint";
    const document = stored ? this.xmlDocuments.get(String(source)) : parseXml(source as string);
    if (!document) return -1n;
    const path = text(value(1)!);
    if (base === "XML_GET") {
      const nodes = selectNodes(document, path);
      const third = args[2];
      const reference = third?.kind === "variable" && variables.isString(third.name, context) ? third : undefined;
      const type = number(3);
      if (reference) this.writeArray(variables, context, reference, nodes.map((node) => nodeOutput(node, type)));
      else if (number(2) !== 0) this.writeArray(variables, context, { kind: "variable", name: "RESULTS", indices: [literal(0n)] }, nodes.map((node) => nodeOutput(node, type)));
      return BigInt(nodes.length);
    }
    let count: number;
    switch (base) {
      case "XML_SET": count = setNodes(document, path, text(value(2)!), number(3) !== 0, number(4)); break;
      case "XML_REPLACE": count = replaceNodes(document, path, parseXml(text(value(2)!)), number(3) !== 0); break;
      case "XML_ADDATTRIBUTE": count = addAttribute(document, path, text(value(2)!), text(value(3) ?? ""), number(4), number(5) !== 0); break;
      case "XML_REMOVEATTRIBUTE": count = removeAttributes(document, path, number(2) !== 0); break;
      case "XML_ADDNODE": count = addNode(document, path, text(value(2)!), number(3), number(4) !== 0); break;
      default: count = removeNode(document, path, number(2) !== 0);
    }
    if (!stored && count) {
      const target = args[0]!;
      if (target.kind !== "variable") throw new EraError(`${name} needs a string variable to update`);
      variables.set(target.name, target.indices, serializeXml(document.documentElement!), context);
    }
    return BigInt(count);
  }
  private map(name: string): Map<string, string> {
    const map = this.maps.get(name);
    if (!map) throw new EraError(`Map does not exist: ${name}`);
    return map;
  }
  /** REGEXPMATCH: the match count, groups per match (group 0 included) and each match's groups in order. */
  private regexpMatch(source: string, pattern: string): { count: number; groups: number; values: string[] } {
    const regex = this.regex(pattern);
    const order = regexGroupOrder(regex);
    const matches = [...source.matchAll(regex)];
    return { count: matches.length, groups: order.length, values: matches.flatMap((match) => order.map((index) => match[index] ?? "")) };
  }
  /** Compiles a .NET pattern; leading inline options like (?i) become JS flags, mid-pattern ones scope the rest. */
  private regex(pattern: string): RegExp {
    let cached = this.regexCache.get(pattern);
    if (!cached) {
      let source = pattern;
      let flags = "gu";
      const leading = /^\(\?([ims]+)\)/.exec(source);
      if (leading) {
        source = source.slice(leading[0].length);
        for (const flag of leading[1]!) if (!flags.includes(flag)) flags += flag;
      }
      // A later (?i) applies to the remainder of its group, which a scoped modifier group expresses.
      source = source.replace(/\(\?([ims]+)\)((?:[^()\\]|\\.|\((?:[^()\\]|\\.)*\))*)/g, "(?$1:$2)");
      // .NET accepts escaped punctuation that JS rejects under the Unicode flag.
      source = source.replace(/\\(.)/g, (escape: string, character: string) =>
        /^[ ,#=!:%&@<>;"'`~]$/.test(character) ? character : escape);
      source = regexCharacterClasses(source);
      try { cached = new RegExp(source, flags); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new EraError(`Invalid regular expression: ${error.message}`);
      }
      if (this.regexCache.size > 1000) this.regexCache.clear();
      this.regexCache.set(pattern, cached);
    }
    cached.lastIndex = 0;
    return cached;
  }
  private assign(frame: Frame, reference: Expr, value: Value): void {
    if (reference.kind !== "variable") throw new EraError("Assignment target must be a variable");
    frame.variables.set(reference.name, reference.indices, value, frame.context);
  }
  private formatted(source: string, frame: Frame): string {
    let expr = this.formatCache.get(source);
    if (!expr) { expr = parseFormat(source); this.formatCache.set(source, expr); }
    return text(evaluate(expr, frame.context));
  }
  private debugInstruction(op: string, args: string, frame: Frame): void {
    if (op === "ASSERT") {
      if (integer(evaluate(this.parse(args), frame.context)) === 0n) throw new EraError("ASSERT文の引数が0です");
    } else if (op === "DEBUGCLEAR") {
      this.debugText = "";
      this.debugClear = true;
    } else {
      const form = op.startsWith("DEBUGPRINTFORM");
      this.debugText += (form ? this.formatted(args, frame) : args) + (op.endsWith("L") ? "\n" : "");
      if (this.debugText.length > 200_000) this.debugText = this.debugText.slice(-100_000);
    }
  }
  /** Adds the debug window text gathered since the last snapshot. */
  private withDebug(snapshot: Snapshot): Snapshot {
    if (this.debugClear) snapshot.debugClear = true;
    if (this.debugText) snapshot.debug = this.debugText;
    this.debugText = "";
    this.debugClear = false;
    if (this.backgroundChanged || this.background.length) {
      const layers = this.background.flatMap((layer): BackgroundLayer[] => {
        const picture = layer.graphics !== undefined ? this.picture(layer.graphics) : this.spritePicture(layer.sprite!);
        if (!picture) return [];
        const hover = layer.hover ? this.spritePicture(layer.hover) : undefined;
        return [{ z: layer.z, x: layer.x, y: layer.y, picture, ...(hover ? { hover } : {}),
          ...(layer.buttonValue !== undefined ? { buttonValue: layer.buttonValue } : {}), ...(layer.tooltip ? { tooltip: layer.tooltip } : {}) }];
      });
      const signature = JSON.stringify(layers);
      if (this.backgroundChanged || signature !== this.lastBackground) snapshot.cbg = layers;
      this.lastBackground = signature;
    }
    if (this.backgroundChanged || this.backgroundMap !== undefined) {
      const picture = this.backgroundMap === undefined ? null : this.picture(this.backgroundMap) ?? null;
      const signature = JSON.stringify(picture);
      if (signature !== this.lastBackgroundMap) snapshot.cbgMap = picture;
      this.lastBackgroundMap = signature;
    }
    this.backgroundChanged = false;
    if (this.textboxChanged) snapshot.textbox = this.textbox;
    this.textboxChanged = false;
    if (this.tooltipChanged) snapshot.tooltip = { ...this.tooltipSettings };
    this.tooltipChanged = false;
    if (this.audio) {
      snapshot.audio = { ...this.audio, sounds: this.audio.sounds.slice() };
      this.audio.sounds = [];
      this.audio.stopSounds = false;
    }
    return snapshot;
  }
  private resourceUrl(file: string): string {
    return `${this.game.resourceBase}${file.split(/[\\/]/).map(encodeURIComponent).join("/")}`;
  }
  private assignment(source: string): Assignment {
    let assignment = this.assignmentCache.get(source);
    if (assignment) return assignment;
    const prefix = /^(\+\+|--)\s*(.+)$/.exec(source);
    if (prefix) {
      const reference = this.parse(prefix[2]!);
      if (reference.kind !== "variable") throw new EraError("Invalid assignment target");
      assignment = { reference, operator: prefix[1]!, value: "", expressionValue: "" };
      this.assignmentCache.set(source, assignment);
      return assignment;
    }
    // The operator is the first one outside parentheses/strings, so `A:(N++) = X` targets A.
    let depth = 0, quoted = false, match: RegExpExecArray | null = null, at = 0;
    for (; at < source.length; at++) {
      const c = source[at]!;
      if (quoted) { if (c === "\\") at++; else if (c === '"') quoted = false; continue; }
      if (c === '"') quoted = true;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (depth === 0 && (match = (this.fullWidthSpace ? /^(\+\+|--|'=|==|<<=|>>=|[+\-*/%&|^]?=)\s*/ : /^(\+\+|--|'=|==|<<=|>>=|[+\-*/%&|^]?=)[ \t]*/).exec(source.slice(at)))) break;
    }
    if (!match) throw new EraError("Invalid assignment");
    const operator = match[1]!;
    let target = source.slice(0, at).trim();
    if (/^(?:<<|>>|[+\-*/%&|^])=$/.test(operator)) target = target.replace(/,$/, "").trimEnd();
    if (splitArguments(target).length > 1) throw new EraError("Left side of assignment has an extra ','");
    const reference = this.parse(target);
    if (reference.kind !== "variable") throw new EraError("Invalid assignment target");
    const value = source.slice(at + match[0].length);
    assignment = { reference, operator: operator === "==" ? "=" : operator, value, expressionValue: stripComment(value, this.fullWidthSpace) };
    this.assignmentCache.set(source, assignment);
    return assignment;
  }
  private callTarget(source: string): CallTarget | null {
    let target = this.callCache.get(source);
    if (target !== undefined) return target;
    const match = /^([^\s,(]+)\s*(.*)$/.exec(source);
    if (match) {
      let parameters = match[2]!.trim();
      if (parameters.startsWith("(") && parameters.endsWith(")")) parameters = parameters.slice(1, -1);
      else parameters = parameters.replace(/^,/, "");
      target = { name: key(match[1]!), parameters: parameters.trim() };
    } else target = null;
    this.callCache.set(source, target);
    return target;
  }
  private formattedCallTarget(source: string, frame: Frame): CallTarget | null {
    const split = formNameEnd(source);
    const name = key(this.formatted(source.slice(0, split), frame).trim());
    let parameters = source.slice(split).trim();
    if (parameters.startsWith("(") && parameters.endsWith(")")) parameters = parameters.slice(1, -1);
    else parameters = parameters.replace(/^,/, "");
    return name ? { name, parameters: parameters.trim() } : null;
  }
  private gotoDestination(compiled: Compiled, pc: number, destination: number, states: Map<number, LoopState>): number {
    const { loops } = compiled;
    if (loops.some((loop) => destination > loop.start && destination <= loop.end && !(pc > loop.start && pc <= loop.end)))
      throw new EraError("GOTO into a loop is not supported");
    for (const start of states.keys()) {
      const loop = loops.find((loop) => loop.start === start)!;
      if (destination < start || destination > loop.end) states.delete(start);
    }
    return destination;
  }
  private caseTests(source: string): CaseTest[] {
    let tests = this.caseCache.get(source);
    if (tests) return tests;
    tests = this.arguments(source).filter((part) => part !== "").map((part): CaseTest => {
      const range = /^(.*?)\s+TO\s+(.*)$/i.exec(part);
      if (range) return { kind: "range", from: range[1]!, to: range[2]! };
      // Emuera accepts any binary operator after IS; the case matches when `value op operand` is non-zero.
      const comparison = /^IS\s*(==|!=|<=|>=|<<|>>|&&|\|\||\^\^|!&|!\||<|>|&|\||\^|\+|-|\*|\/|%)\s*(.*)$/i.exec(part);
      if (comparison) return { kind: "compare", op: comparison[1]!, operand: comparison[2]! };
      return { kind: "value", source: part };
    });
    this.caseCache.set(source, tests);
    return tests;
  }
  private emit(type: "text" | "html" | "input", value: string, newline: boolean, plain = false, options: { style?: Style; single?: boolean; cell?: boolean } = {}): Yield {
    if (value.length > 1_000_000) throw new EraError("Output string exceeds limit");
    if (this.skipDisplay) return SKIPPED;
    if (this.temporaryLine) {
      this.temporaryLine = false;
      this.dropLines(1);
      this.deferOutput({ type: "clear", count: 1 });
    }
    this.lineCount += (value.match(/\n/g)?.length ?? 0) + (newline ? 1 : 0);
    this.lineOpen = newline ? false : value.includes("\n") ? !value.endsWith("\n") : this.lineOpen || value !== "";
    this.printingHtml += type === "html" ? value : escapeHtml(value);
    if (newline) this.printingHtml = "";
    else if (value.includes("\n")) this.printingHtml = escapeHtml(value.slice(value.lastIndexOf("\n") + 1));
    this.recordPrinted(type, value, newline, options.style ?? this.style, !plain);
    const sprites = type === "html" ? this.htmlSprites(value) : undefined;
    const output: Output = { type, text: value, newline, style: { ...(options.style ?? this.style) }, ...(plain ? { plain: true } : {}), ...(options.single ? { single: true } : {}), ...(options.cell ? { cell: true } : {}), ...(sprites ? { sprites } : {}) };
    this.accountOutput(output);
    return { output };
  }
  private accountOutput(output: Output): void {
    this.outputEvents++;
    this.outputBytes += JSON.stringify(output).length;
    if (this.outputBytes > 2_000_000) throw new EraError("Output limit exceeded between inputs", this.currentSource);
  }
  private deferOutput(output: Output): void {
    this.accountOutput(output);
    this.deferred.push(output);
  }
  private dropLines(count: number): void {
    this.lineCount = Math.max(0, this.lineCount - count);
    if (count > 0) this.printedLines.splice(-count, count);
    if (count > 0) this.buttonLines.splice(-count, count);
  }
  /** Mirrors EM HtmlManager.DisplayLine2Html: styled runs inside <p align><nobr>, an empty line holding one space. */
  private recordPrinted(type: "text" | "html" | "input", value: string, newline: boolean, style: Style, buttons = true): void {
    const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
    const styled = (s: string): string => {
      if (!s) return "";
      const face = style.font && style.font !== this.display.font ? style.font : undefined;
      const colored = style.color.toLowerCase() !== this.display.foreground.toLowerCase();
      let open = "", close = "";
      if (face || colored) {
        open = `<font${face ? ` face='${escape(face)}'` : ""}${colored ? ` color='#${style.color.slice(1).toUpperCase()}'` : ""}>`;
        close = "</font>";
      }
      const tags = ([[4, "s"], [8, "u"], [2, "i"], [1, "b"]] as const).filter(([bit]) => style.fontStyle & bit).map(([, tag]) => tag);
      return open + tags.map((t) => `<${t}>`).join("") + escape(s) + tags.reverse().map((t) => `</${t}>`).join("") + close;
    };
    const segments = type === "html" ? [value] : value.split("\n");
    segments.forEach((segment, i) => {
      if (i > 0) this.flushPrinted();
      this.printedLine += type === "html" ? segment : styled(segment);
      if (type === "html") this.lineButtons.push(...htmlButtons(segment));
      else if (type === "text" && buttons) this.lineButtons.push(...[...segment.matchAll(/\[[ \t]*(-?\d+)[ \t]*\]/g)].map((match) => match[1]!));
    });
    if (newline) this.flushPrinted();
  }
  private flushPrinted(): void {
    this.buttonLines.push(this.lineButtons);
    this.lineButtons = [];
    if (this.buttonLines.length > 4096) this.buttonLines.splice(0, this.buttonLines.length - 4096);
    this.printedLines.push(`<p align='${this.style.alignment}'><nobr>${this.printedLine || " "}</nobr></p>`);
    if (this.printedLines.length > 4096) this.printedLines.splice(0, this.printedLines.length - 4096);
    this.printedLine = "";
  }
  /** Emuera wraps a PRINTC item holding a numeric [n] button only between items when ButtonWrap is on; others may split. */
  private isButtonCell(value: string): boolean {
    return this.buttonWrap && !value.includes("\n") && /\[\s*[+-]?\d+\s*\]/.test(value);
  }
  private printC(value: string, align: "" | "C" | "LC"): string {
    if (!align) return value;
    const padding = " ".repeat(Math.max(0, this.printCLength - stringWidth(value)));
    return align === "C" ? padding + value : value + padding;
  }
  private printStyle(mode: "" | "K" | "D"): Style {
    return mode === "D" ? { ...this.style, color: this.display.foreground } : this.style;
  }
  private kana(value: string, mode: "" | "K" | "D"): string {
    if (mode !== "K" || !this.forceKana) return value;
    if (this.forceKana === 1) return value.replace(/[\u3041-\u3096\u309D\u309E]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
    const source = this.forceKana === 3 ? value.replace(/[\uFF66-\uFF9F]+/g, (c) => c.normalize("NFKC")) : value;
    return source.replace(/[\u30A1-\u30F6\u30FD\u30FE]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }
  private arguments(source: string): readonly string[] {
    let parts = this.argumentCache.get(source);
    if (!parts) {
      const values = splitArguments(expandArgumentMacros(source, this.game.macros));
      if (values.length > 1 && values.at(-1) === "") values.pop();
      parts = values;
      if (source.length <= 4096 && this.argumentCache.size < 16_384)
        this.argumentCache.set(source, parts);
    }
    return parts;
  }
  private info(routine: Routine): RoutineInfo {
    let info = this.routineInfo.get(routine);
    if (info) return info;
    const functionType = routine.directives.find((line) => /^#FUNCTIONS?$/i.test(line.text));
    const references = new Set(routine.directives.map((d) => /^#DIMS?\s+REF\s+([^\s,=]+)/i.exec(d.text)?.[1]).filter((name) => name !== undefined).map(key));
    info = {
      returnType: functionType ? key(functionType.text) === "#FUNCTIONS" ? "string" : "integer" : undefined,
      dynamic: routine.directives.filter((line) => /^#DIMS?\s/i.test(line.text) && /\b(?:DYNAMIC|REF)\b/i.test(line.text)),
      inline: new Map(),
      references: routine.parameters.map((parameter) => references.has(key(parameter.split("=")[0]!.trim().split(":")[0]!))),
      parameters: routine.parameters.map((parameter) => {
        const equal = parameter.indexOf("=");
        const target = this.parse(equal < 0 ? parameter : parameter.slice(0, equal).trim());
        if (target.kind !== "variable") throw new EraError("Parameter target must be a variable", routine);
        return { target, defaultSource: equal < 0 ? undefined : parameter.slice(equal + 1) };
      }),
    };
    for (const line of routine.lines) {
      const declaration = inlineDeclaration(line);
      if (!declaration) continue;
      const reference = this.parse(declaration.name);
      if (reference.kind !== "variable" || reference.indices.length) throw new EraError(`Invalid inline variable name: ${declaration.name}`, line);
      if (!info.inline.has(declaration.name)) info.inline.set(declaration.name, declaration);
    }
    this.routineInfo.set(routine, info);
    return info;
  }
  private callArguments(name: string, sources: readonly string[], frame: Frame): Argument[] {
    const routine = this.game.routines.get(name)?.[0];
    const references = routine && this.info(routine).references;
    return sources.map((source, i) => {
      if (!source) return undefined;
      if (!references?.[i]) return evaluate(this.parse(source), frame.context);
      const reference = this.parse(source);
      if (reference.kind !== "variable") throw new EraError("REF arguments must be variable references");
      return { variables: frame.variables, name: reference.name, indices: reference.indices, context: frame.context };
    });
  }
  /**
   * Runs an instruction or call that cannot wait for input (see Jit.suspends) without suspending its caller: output
   * is deferred exactly as `advance` would have collected it, and waits skipped by SKIPDISP pass.
   */
  private drive(generator: Generator<Yield, Value | undefined, string>): Value | undefined {
    let done = false;
    try {
      let result = generator.next();
      while (!result.done) {
        const value = result.value;
        if ("input" in value) {
          if (!this.skipDisplay) throw new EraError("Internal error: compiled code requested input", this.currentSource);
          if (value.input.kind !== "wait") throw new EraError("Input was requested while SKIPDISP is hiding output; wrap it in NOSKIP...ENDNOSKIP", this.currentSource);
        } else if (value !== SKIPPED) this.deferred.push(value.output);
        result = generator.next("");
      }
      done = true;
      return result.value;
    } finally {
      if (!done) generator.return(undefined);
    }
  }
  /** A call from compiled code to routines that cannot wait for input. */
  private callSync(name: string, args: Argument[]): Value | undefined {
    const result = this.callCompiled(name, args);
    return result === ASYNC ? this.drive(this.execute(name, args)) : result;
  }
  /** `execute` for a routine already compiled to a plain function, with no generators; ASYNC when that is not the case. */
  private callCompiled(name: string, args: Argument[]): Value | undefined | typeof ASYNC {
    const routines = this.game.routines.get(name);
    if (routines?.length !== 1) return ASYNC;
    const entry = this.compiled.get(routines[0]!)?.jit;
    if (!entry || entry.generator) return ASYNC;
    if (++this.depth > 128) throw new EraError("Call depth limit exceeded", this.currentSource);
    try {
      const { frame, routine, info } = this.prepare(name, args, false, routines[0]!);
      this.doing.push(routine);
      let result: Value | undefined;
      try { result = entry.run(this, frame) as Value | undefined; }
      catch (error) {
        if (error instanceof EraError) this.captureError(error);
        throw error;
      }
      finally { this.doing.pop(); }
      if (info.returnType && result === undefined) return frame.returnType === "string" ? "" : 0n;
      return result;
    } finally { this.depth--; }
  }
  private *execute(name: string, args: Argument[], expression = false, selected?: Routine): Generator<Yield, Value | undefined, string> {
    if (++this.depth > 128) throw new EraError("Call depth limit exceeded", this.currentSource);
    try {
      const routines = this.game.routines.get(name);
      if (!routines?.length) throw new EraError(`Undefined function: ${name}`, this.currentSource);
      if (!selected && routines.length !== 1) {
        if (expression) throw new EraError(`${name} has multiple definitions and cannot be used as an expression function`, this.currentSource);
        yield* this.dispatch(name, args);
        return undefined;
      }
      const { frame, routine, info } = this.prepare(name, args, expression, selected ?? routines[0]!);
      this.doing.push(routine);
      let result: Value | undefined;
      try { result = yield* this.runFrame(frame); }
      catch (error) {
        if (error instanceof EraError) this.captureError(error);
        throw error;
      }
      finally { this.doing.pop(); }
      if (info.returnType && result === undefined) return frame.returnType === "string" ? "" : 0n;
      return result;
    } finally { this.depth--; }
  }
  private compiledRoutine(routine: Routine): Compiled {
    let compiled = this.compiled.get(routine);
    if (!compiled) { compiled = compile(routine); this.compiled.set(routine, compiled); }
    return compiled;
  }
  /** Sets up a routine's frame: static and dynamic variables plus bound parameters. */
  private prepare(name: string, args: Argument[], expression: boolean, routine: Routine): { frame: Frame; routine: Routine; info: RoutineInfo } {
    const info = this.info(routine);
    if (expression && !info.returnType) throw new EraError(`${name} is not declared #FUNCTION or #FUNCTIONS`, routine);
    const compiled = this.compiledRoutine(routine);
    let variables = this.statics.get(routine);
    if (!variables) {
      variables = new Variables(this.game, this.globals);
      for (const variable of ["LOCAL", "ARG", "LOCALS", "ARGS"]) {
        const pattern = new RegExp(`^#${variable}SIZE\\s+(.+)$`, "i");
        const size = routine.directives.find((d) => pattern.test(d.text.trim()));
        const dimensions = size ? [Number(integer(evaluate(this.parse(pattern.exec(size.text.trim())![1]!), this.context(this.globals))))] : [...(this.game.variableSizes.get(variable) ?? [1000])];
        if (dimensions.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 1_000_000)) throw new EraError(`Invalid ${variable} size`, size);
        if (variable === "ARG" || variable === "ARGS") {
          for (const { target } of info.parameters) {
            if (target.name !== variable) continue;
            if (target.indices.length > 1) throw new EraError(`${variable} parameters require one dimension`, routine);
            const index = target.indices.length ? integer(evaluate(target.indices[0]!, this.context(this.globals))) : 0n;
            if (index < 0n || index >= 1_000_000n) throw new EraError(`Invalid ${variable} parameter index`, routine);
            dimensions[0] = Math.max(dimensions[0]!, Number(index) + 1);
          }
        }
        variables.define(variable, variable.endsWith("S"), dimensions);
      }
      for (const directive of routine.directives) {
        if (/^#FUNCTIONS?$/i.test(directive.text)) continue;
        if (/^#(?:LOCAL|LOCALS|ARG|ARGS)SIZE\s/i.test(directive.text)) continue;
        // Event ordering keywords only affect dispatch; Emuera ignores them on directly called functions.
        if (/^#(?:PRI|LATER|SINGLE|ONLY)$/i.test(directive.text.trim())) continue;
        if (!/^#DIMS?\s/i.test(directive.text)) throw new EraError(`Unsupported function directive: ${directive.text}`, directive);
        if (/\b(?:DYNAMIC|REF)\b/i.test(directive.text)) continue;
        variables.declare(directive, true);
      }
      this.statics.set(routine, variables);
    }
    if (info.dynamic.length || info.inline.size) {
      variables = new Variables(this.game, variables);
      variables.transient = true;
      for (const declaration of info.dynamic) variables.declare(declaration, true);
      for (const declaration of info.inline.values()) {
        if (variables.owns(declaration.name) || variables.parent!.owns(declaration.name)) continue;
        variables.define(declaration.name, declaration.string, declaration.dimensions);
      }
    }
    const context = this.context(variables);
    const frame: Frame = { variables, compiled, context };
    if (info.returnType) frame.returnType = info.returnType;
    if (args.length > info.parameters.length) throw new EraError(`Too many arguments for ${name}`, routine);
    for (let i = 0; i < info.parameters.length; i++) {
      const { target: reference, defaultSource } = info.parameters[i]!;
      const argument = args[i];
      if (typeof argument === "object") {
        variables.bindReference(reference.name, argument.variables, argument.name, argument.indices, argument.context);
        continue;
      }
      const string = variables.isString(reference.name, context);
      let value = argument ?? (defaultSource !== undefined ? evaluate(this.parse(defaultSource), context) : string ? "" : 0n);
      if (argument !== undefined && string !== (typeof value === "string")) {
        if (!string) throw new EraError(`${name}: argument ${i + 1} cannot convert a string to an integer`, this.currentSource);
        if (!this.autoToStr) throw new EraError(`${name}: argument ${i + 1} cannot convert an integer to a string (enable ユーザー関数の引数に自動的にTOSTRを補完する)`, this.currentSource);
        value = String(value);
      }
      this.assign(frame, reference, value);
    }
    return { frame, routine, info };
  }
  /** Per-context evaluation helpers, reused across calls instead of allocating closures for every frame. */
  private evaluators(context: EvaluationContext): Evaluators {
    let helpers = this.evaluatorCache.get(context);
    if (!helpers) {
      const ev = (source: string): Value => evaluate(this.parse(source), context);
      helpers = {
        ev,
        num: (source) => integer(ev(source)),
        lineNum: (instruction) => integer(evaluate(instruction.parsed ??= this.parse(instruction.args), context)),
      };
      this.evaluatorCache.set(context, helpers);
    }
    return helpers;
  }
  /**
   * Runs a frame from `start`. With `single`, runs one instruction and stores the next pc there (-1 when the frame
   * returned); compiled routines use this for instructions they leave to the interpreter.
   */
  private *runFrame(frame: Frame, start = 0, single?: { next: number }): Generator<Yield, Value | undefined, string> {
    if (!single) {
      const entry = this.jit?.entry(frame.compiled);
      if (entry) return entry.generator ? yield* entry.run(this, frame) as Generator<Yield, Value | undefined, string> : entry.run(this, frame) as Value | undefined;
    } else single.next = -1;
    const { code, labels, loops } = frame.compiled;
    const { ev, num, lineNum } = this.evaluators(frame.context);
    const loopStates = single ? NO_LOOP_STATES : new Map<number, LoopState>();
    for (let pc = start; pc < code.length && !this.finished;) {
      const line = code[pc]!;
      this.currentSource = line;
      if (++this.steps > this.maxSteps) throw new EraError("Instruction limit exceeded between inputs", line);
      let next = pc + 1;
      try {
        const { op, args, target } = line;
        if (line.forbiddenInFunction) throw new EraError(`${op} instruction cannot be used in #FUNCTION(S)`, line);
        const special = !HOT_OPS.has(op);
        if (special && (op.startsWith("DEBUGPRINT") || op === "DEBUGCLEAR" || op === "ASSERT")) {
          // Outside debug mode Emuera skips debug instructions (DEBUG_FUNC) without evaluating them.
          if (this.game.debug) this.debugInstruction(op, args, frame);
        } else if (special && this.skipDisplay && SKIPPED_INPUTS.has(op)) {
          // Emuera skips input instructions while output is skipped, but a script's own SKIPDISP makes that an error.
          if (this.userSkip) throw new EraError("SKIPDISP中にユーザー入力が求められました。NOSKIP～ENDNOSKIPで囲ってください");
        } else if (special && (op === "PRINTPLAIN" || op === "PRINTPLAINFORM")) {
          yield this.emit("text", op === "PRINTPLAINFORM" ? this.formatted(args, frame) : args, false, true);
        } else if (special && op.startsWith("PRINT") && printVariant(op)) {
          const variant = printVariant(op)!;
          const raw = variant.argument === "FORM" ? this.formatted(args, frame)
            : variant.argument === "FORMS" ? this.formatted(text(ev(args)), frame)
            : variant.argument === "S" ? String(ev(args))
            : variant.argument === "V" ? this.arguments(args).map((part) => String(ev(part))).join("")
            : args;
          const value = this.kana(this.printC(raw, variant.align), variant.mode);
          yield this.emit("text", value, variant.single || variant.end === "L" || variant.end === "W", false, { style: this.printStyle(variant.mode), single: variant.single, cell: !!variant.align && this.isButtonCell(value) });
          if (variant.end === "W") yield { input: { kind: "wait" } };
          else if (variant.end === "N") yield { input: { kind: "wait", keepLineOpen: true } };
        } else if (special && (op === "STRDATA" || op.startsWith("PRINTDATA") && isPrintData(op))) {
          const groups: Instruction[][] = [];
          for (let i = pc + 1; i < target; i++) {
            const row = code[i]!;
            if (row.op === "DATA" || row.op === "DATAFORM") { groups.push([row]); continue; }
            if (row.op !== "DATALIST") throw new EraError(`${op} may only contain DATA, DATAFORM and DATALIST`, row);
            const group: Instruction[] = [];
            for (i++; i < target && code[i]!.op !== "ENDLIST"; i++) {
              if (code[i]!.op !== "DATA" && code[i]!.op !== "DATAFORM") throw new EraError("DATALIST may only contain DATA and DATAFORM", code[i]);
              group.push(code[i]!);
            }
            if (i >= target) throw new EraError("DATALIST without ENDLIST", row);
            groups.push(group);
          }
          next = target + 1;
          if (groups.length) {
            const index = Number(this.random(BigInt(groups.length)));
            const value = groups[index]!.map((row) => row.op === "DATAFORM" ? this.formatted(row.args, frame) : row.args).join("\n");
            if (op === "STRDATA") {
              const reference = this.parse(args || "RESULTS");
              this.assign(frame, reference, value);
            } else {
              if (args) this.assign(frame, this.parse(args), BigInt(index));
              const [, mode = "", end = ""] = PRINTDATA_PATTERN.exec(op)!;
              yield this.emit("text", this.kana(value, mode as "K" | "D" | ""), end !== "", false, { style: this.printStyle(mode as "K" | "D" | "") });
              if (end === "W") yield { input: { kind: "wait" } };
            }
          }
        } else if (special && TABLE_OPERATIONS.has(op) && !TABLE_REFERENCE_OPERATIONS.has(op)) {
          const parts = this.arguments(args).slice();
          if (parts.at(-1) === "" && op === "DT_ROW_ADD") parts.pop();
          const value = this.tableOperation(op, parts.map((part) => part ? ev(part) : undefined), frame.context);
          this.globals.set(typeof value === "string" ? "RESULTS" : "RESULT", [], value, frame.context);
        } else switch (op) {
          case "LABEL": case "ENDIF": case "ENDSELECT": break;
          case "ASSIGN": {
            const assignment = (line.assignment ??= this.assignment(args)) as Assignment;
            const { operator } = assignment;
            const reference = settleIndices(assignment.reference, frame.context);
            const string = frame.variables.isString(reference.name, frame.context);
            const source = operator === "=" && string ? assignment.value : assignment.expressionValue;
            if (operator === "'=" || (operator === "=" && !string)) {
              let parsed = line.values;
              if (!parsed) {
                const parts = this.arguments(source).slice();
                if (parts.at(-1) === "") parts.pop();
                if (!parts.length) throw new EraError("Assignment requires a value");
                parsed = line.values = parts.map((part) => this.parse(part));
              }
              const values = parsed.map((expr) => evaluate(expr, frame.context));
              frame.variables.setMany(reference.name, reference.indices, values, frame.context);
              break;
            }
            const rhs = operator === "++" || operator === "--" ? 1n : operator === "=" && string
              ? this.formatted(source, frame) : ev(source);
            if ((operator === "++" || operator === "--") && source) throw new EraError("Unexpected text after increment/decrement");
            const value = operator === "=" || operator === "'=" ? rhs : evaluate({
              kind: "binary", op: operator === "++" ? "+" : operator === "--" ? "-" : operator.slice(0, -1),
              left: literal(evaluate(reference, frame.context)), right: literal(rhs),
            }, frame.context);
            this.assign(frame, reference, value);
            break;
          }
          case "IF": {
            let branch = pc;
            while ((code[branch]!.op === "IF" || code[branch]!.op === "ELSEIF") && lineNum(code[branch]!) === 0n)
              branch = code[branch]!.target;
            next = branch + 1;
            break;
          }
          case "ELSE": case "ELSEIF": next = this.blockEnd(code, pc) + 1; break;
          case "SIF": if (lineNum(line) === 0n) next++; break;
          case "SELECTCASE": {
            const value = evaluate(line.parsed ??= this.parse(args), frame.context);
            let branch = target;
            while (code[branch]!.op !== "ENDSELECT") {
              const candidate = code[branch]!;
              if (candidate.op === "CASEELSE" || ((candidate.cases ??= this.caseTests(candidate.args)) as CaseTest[]).some((test) => this.matchesCase(value, test, ev))) break;
              branch = candidate.target;
            }
            next = branch + 1;
            break;
          }
          case "CASE": case "CASEELSE": next = this.blockEnd(code, pc) + 1; break;
          case "FOR": case "REPEAT": {
            const values = this.arguments(args);
            if (op === "REPEAT" && values.length !== 1) throw new EraError("REPEAT expects a count");
            const parts = op === "FOR" ? values : ["COUNT", "0", values[0]!];
            if (parts.length < 3 || parts.length > 4) throw new EraError("FOR expects variable, start, end[, step]");
            let state = loopStates.get(pc);
            if (!state) {
              state = { variable: this.parse(parts[0]!), end: num(parts[2]!), step: parts[3] ? num(parts[3]) : 1n };
              if (state.step === 0n) throw new EraError("FOR step cannot be zero");
              loopStates.set(pc, state);
              this.assign(frame, state.variable, num(parts[1]!));
            }
            const value = integer(evaluate(state.variable, frame.context));
            if (state.step > 0n ? value >= state.end : value <= state.end) { loopStates.delete(pc); next = target + 1; }
            break;
          }
          case "NEXT": case "REND": {
            const state = loopStates.get(target);
            if (!state) throw new EraError("Loop state missing");
            this.assign(frame, state.variable, BigInt.asIntN(64, integer(evaluate(state.variable, frame.context)) + state.step));
            next = target; break;
          }
          case "RETURNF": {
            if (!frame.returnType) throw new EraError("RETURNF outside an expression function");
            const value = args ? evaluate(line.parsed ??= this.parse(args), frame.context) : frame.returnType === "string" ? "" : 0n;
            return frame.returnType === "string" ? text(value) : integer(value);
          }
          case "ARRAYREMOVE": {
            const parts = this.arguments(args);
            const reference = this.parse(parts[0] ?? "");
            if (parts.length !== 3 || reference.kind !== "variable") throw new EraError("ARRAYREMOVE expects array, start, count");
            frame.variables.remove(reference.name, reference.indices, Number(num(parts[1]!)), Number(num(parts[2]!)), frame.context);
            break;
          }
          case "SETBIT": case "CLEARBIT": case "INVERTBIT": {
            const parts = this.arguments(args).slice();
            const reference = this.parse(parts.shift() ?? "");
            if (reference.kind !== "variable" || !parts.length) throw new EraError(`${op} expects variable and bit indices`);
            let value = integer(evaluate(reference, frame.context));
            for (const part of parts) {
              const bit = num(part);
              if (bit < 0n || bit > 63n) throw new EraError("Bit index must be between 0 and 63");
              const mask = 1n << bit;
              value = op === "SETBIT" ? value | mask : op === "CLEARBIT" ? value & ~mask : value ^ mask;
            }
            this.assign(frame, reference, BigInt.asIntN(64, value));
            break;
          }
          case "RESETDATA":
            if (args) throw new EraError("RESETDATA takes no arguments");
            this.resetData();
            break;
          case "ADDCHARA":
            for (const part of this.arguments(args)) this.addCharacter(Number(num(part)), frame.context);
            break;
          case "ADDDEFCHARA": {
            if (args) throw new EraError("ADDDEFCHARA takes no arguments");
            if (this.doing.at(-1)?.name !== "SYSTEM_TITLE") throw new EraError("ADDDEFCHARA may only be used in @SYSTEM_TITLE");
            this.addCharacter(0, frame.context);
            const character = integer(this.globals.get("GAMEBASE_DEFAULTCHARA", [], frame.context));
            if (character > 0n) this.addCharacter(Number(character), frame.context);
            break;
          }
          case "ADDVOIDCHARA": {
            // Emuera's pseudo character: template 0 with no CSV data, so NO is 0 and every value is empty.
            if (args.trim()) throw new EraError("ADDVOIDCHARA takes no arguments");
            const index = this.globals.addCharacter();
            this.globals.set("CHARANUM", [], BigInt(index + 1), frame.context);
            break;
          }
          case "DELCHARA": case "DELALLCHARA": case "COPYCHARA": case "ADDCOPYCHARA": case "SWAPCHARA": case "PICKUPCHARA":
            this.characterOperation(op, op === "DELALLCHARA" ? [] : this.arguments(args).map((part) => Number(num(part))), frame.context);
            break;
          case "SORTCHARA":
            this.sortCharacters(args, frame);
            break;
          case "BEGIN": case "FORCE_BEGIN": {
            const state = key(args.trim());
            if (!BEGIN_STATES.has(state)) throw new EraError(`${op}のキーワード"${args.trim()}"は未定義です`);
            this.pendingBegin = state;
            this.style = { color: this.display.foreground, background: this.display.background, alignment: "left", fontStyle: 0 };
            // End this routine without touching RESULT; the system loop switches state once its call returns.
            return;
          }
          case "DOTRAIN": {
            if (!this.trainPhaseActive) throw new EraError("DOTRAIN命令をこの位置で実行することはできません");
            const command = num(args);
            const size = this.globals.has("TRAINNAME") ? this.globals.dimensions("TRAINNAME", frame.context)[0]! : 0;
            if (command < 0n) throw new EraError("DOTRAIN命令に0未満の値が渡されました");
            if (command >= BigInt(size)) throw new EraError("DOTRAIN命令にTRAINNAMEの配列数以上の値が渡されました");
            this.pendingTrain = command;
            break;
          }
          case "UPCHECK": {
            if (args) throw new EraError("UPCHECK takes no arguments");
            const up = this.globals.row("UP", [], frame.context);
            const down = this.globals.row("DOWN", [], frame.context);
            const character = integer(this.globals.get("TARGET", [], frame.context));
            if (character >= 0n && character < BigInt(this.globals.characterCount())) {
              const palam = this.globals.row("PALAM", [literal(character), literal(0n)], frame.context);
              for (let i = 0; i < Math.min(palam.size, up.size, down.size); i++) {
                const gain = integer(up.get(i)), loss = integer(down.get(i));
                if (gain <= 0n && loss <= 0n) continue;
                const before = integer(palam.get(i));
                const after = BigInt.asIntN(64, before + gain - loss);
                palam.set(i, after);
                const name = this.game.tables.get("PALAM")?.get(i)?.[0] ?? "";
                yield this.emit("text", `${name} ${before}${gain > 0n ? `+${gain}` : ""}${loss > 0n ? `-${loss}` : ""}=${after}`, true);
              }
            }
            this.globals.clear("UP", frame.context);
            this.globals.clear("DOWN", frame.context);
            break;
          }
          case "OUTPUTLOG": {
            if (args) throw new EraError("OUTPUTLOG takes no arguments");
            const lines = this.printedLines.map(plainHtml);
            if (this.printedLine) lines.push(plainHtml(this.printedLine));
            this.saves.write("emuera.log", lines.join("\n") + (lines.length ? "\n" : ""));
            if (this.lineOpen) yield this.emit("text", "", true);
            yield this.emit("text", "Log written to emuera.log", true);
            break;
          }
          case "PRINT_MARK": {
            if (this.skipDisplay) break;
            const character = num(args);
            const marks = this.globals.row("MARK", [literal(character), literal(0n)], frame.context);
            let value = "";
            for (let i = 0; i < marks.size; i++) {
              const level = integer(marks.get(i));
              const name = this.game.tables.get("MARK")?.get(i)?.[0];
              if (level !== 0n && name) value += `${name}LV${level} `;
            }
            yield this.emit("text", value, true);
            break;
          }
          case "SAVEDATA": {
            const parts = this.arguments(args);
            if (parts.length !== 2) throw new EraError("SAVEDATA expects slot, text");
            this.saveGame(num(parts[0]!), text(ev(parts[1]!)));
            break;
          }
          case "LOADDATA": {
            const slot = num(args);
            const file = this.saveFile(slot);
            const result = this.checkSave(file);
            if (result.state !== 0n || !result.record?.data) throw new EraError(`LOADDATA: ${result.message}`);
            this.loadGame(result.record.data, result.record.containers);
            this.lastLoad = { version: BigInt(result.record.gameVersion), slot, text: result.record.text };
            throw new LoadTransition();
          }
          case "DELDATA":
            this.saves.remove(this.saveFile(num(args)));
            break;
          case "CHKDATA": {
            const result = this.checkSave(this.saveFile(num(args)));
            this.globals.set("RESULTS", [], result.message, frame.context);
            this.globals.set("RESULT", [], result.state, frame.context);
            break;
          }
          case "SAVECHARA": {
            const parts = this.arguments(args);
            if (parts.length < 3) throw new EraError("SAVECHARA expects file, text, character...");
            const count = this.globals.characterCount();
            const indices = parts.slice(2).map((part) => Number(num(part)));
            if (indices.some((i) => i < 0 || i >= count)) throw new EraError("SAVECHARA character index is out of range");
            if (new Set(indices).size !== indices.length) throw new EraError("SAVECHARA lists the same character twice");
            const message = text(ev(parts[1]!));
            if (message.includes("\n")) throw new EraError("SAVECHARA text must not contain a newline");
            const record: NativeSave = { type: 3, ...this.gameStamp(), text: message,
              data: { characters: indices.length, variables: {} }, characters: this.globals.exportCharacters(indices, frame.context),
              containers: { maps: {}, xmls: {}, dts: {} } };
            this.saves.write(this.charaFile(text(ev(parts[0]!))), writeNativeSave(record, this.saveMetadata()));
            break;
          }
          case "LOADCHARA": {
            const result = this.checkSave(this.charaFile(text(ev(args))));
            const characters = result.state === 0n ? result.record?.characters : undefined;
            if (Array.isArray(characters)) {
              this.globals.appendCharacters(characters, frame.context);
              this.globals.set("CHARANUM", [], BigInt(this.globals.characterCount()), frame.context);
            }
            this.globals.set("RESULT", [], Array.isArray(characters) ? 1n : 0n, frame.context);
            break;
          }
          case "RESET_STAIN": {
            const character = num(args);
            if (character < 0n || character >= BigInt(this.globals.characterCount())) throw new EraError(`RESET_STAIN: character ${character} does not exist`);
            this.resetStain(Number(character));
            break;
          }
          case "SAVENOS":
            this.assign(frame, this.parse(args.trim() || "RESULT"), integer(this.configValue("SaveDataNos")));
            break;
          case "PRINTCPERLINE":
            this.assign(frame, this.parse(args.trim() || "RESULT"), BigInt(this.printCPerLine));
            break;
          case "CALLEVENT": {
            const name = key(args.trim());
            if (!EVENT_FUNCTIONS.has(name)) throw new EraError(`CALLEVENT: @${name} is not an event function`);
            yield* this.dispatch(name, []);
            break;
          }
          case "TRYCALLLIST": case "TRYJUMPLIST": case "TRYGOTOLIST": {
            if (args) throw new EraError(`${op} takes no arguments`);
            next = target + 1;
            for (let entry = pc + 1; entry < target; entry++) {
              const candidate = code[entry]!;
              this.currentSource = candidate;
              if (++this.steps > this.maxSteps) throw new EraError("Instruction limit exceeded between inputs", candidate);
              const call = this.formattedCallTarget(candidate.args, frame);
              if (!call) continue;
              const { name, parameters } = call;
              if (op === "TRYGOTOLIST") {
                if (!labels.has(name)) continue;
                next = this.gotoDestination(frame.compiled, pc, labels.get(name)!, loopStates);
                break;
              }
              if (!this.game.routines.has(name)) continue;
              const values = this.callArguments(name, parameters ? this.arguments(parameters) : [], frame);
              const result = yield* this.execute(name, values);
              if (result !== undefined) this.globals.set(typeof result === "string" ? "RESULTS" : "RESULT", [], result, frame.context);
              if (op === "TRYJUMPLIST") return result;
              break;
            }
            break;
          }
          case "FUNC": case "ENDFUNC": throw new EraError(`${op} reached outside a TRYLIST instruction`);
          case "PUTFORM":
            this.globals.set("SAVEDATA_TEXT", [], text(this.globals.get("SAVEDATA_TEXT", [], frame.context)) + this.formatted(args, frame), frame.context);
            break;
          case "CALLF": case "TRYCALLF": {
            const call = this.callTarget(args);
            if (!call) throw new EraError(`${op} expects a function call`);
            const expr = this.parse(`${call.name}(${call.parameters})`);
            if (expr.kind !== "call") throw new EraError(`${op} expects a function call`);
            if (op === "TRYCALLF" && !this.game.routines.has(key(expr.name)) && !(key(expr.name) in BUILTIN_ARITIES)) break;
            // The return value is discarded.
            evaluate(expr, frame.context);
            break;
          }
          case "CALL": case "JUMP": case "TRYCALL": case "TRYJUMP": case "TRYCCALL": case "TRYCJUMP":
          case "CALLFORM": case "JUMPFORM": case "TRYCALLFORM": case "TRYJUMPFORM": case "TRYCCALLFORM": case "TRYCJUMPFORM":
          case "CALLFORMF": case "TRYCALLFORMF": {
            let call: CallTarget | null;
            if (op.includes("FORM")) call = this.formattedCallTarget(args, frame);
            else call = this.callTarget(args);
            if (!call) {
              if (!op.startsWith("TRY") || !op.includes("FORM")) throw new EraError(`Missing ${op} target`);
              if (/^TRYC(?:CALL|JUMP)/.test(op)) next = target + 1;
              break;
            }
            if (!this.game.routines.has(call.name)) {
              if (!op.startsWith("TRY")) throw new EraError(`Undefined function: ${call.name}`);
              if (/^TRYC(?:CALL|JUMP)/.test(op)) next = target + 1;
              break;
            }
            const values = this.callArguments(call.name, call.parameters ? this.arguments(call.parameters) : [], frame);
            if (op.endsWith("F")) { this.expressionFunction(call.name, values); break; }
            const result = yield* this.execute(call.name, values);
            // A plain RETURN has already stored RESULT; only #FUNCTION results are stored here.
            if (result !== undefined) this.globals.set(typeof result === "string" ? "RESULTS" : "RESULT", [], result, frame.context);
            if (op.includes("JUMP")) return result;
            break;
          }
          case "CATCH": next = target + 1; break;
          case "ENDCATCH": break;
          case "LOADGLOBAL": {
            if (args) throw new EraError("LOADGLOBAL takes no arguments");
            const saved = this.store.load(this.gameStamp().code);
            if (saved) this.globals.importGlobals(saved, frame.context);
            this.globals.set("RESULT", [], saved ? 1n : 0n, frame.context);
            break;
          }
          case "SAVEGLOBAL":
            if (args) throw new EraError("SAVEGLOBAL takes no arguments");
            this.store.save(this.globals.exportGlobals(frame.context), this.saveMetadata(true));
            this.globals.set("RESULT", [], 1n, frame.context);
            break;
          case "CLEARMEMORY": {
            if (args) throw new EraError("CLEARMEMORY takes no arguments");
            const before = process.memoryUsage().heapUsed;
            this.expressionCache.clear();
            this.formatCache.clear();
            this.assignmentCache.clear();
            this.callCache.clear();
            this.caseCache.clear();
            this.routineInfo.clear();
            if (global.gc) global.gc();
            const freed = Math.max(0, before - process.memoryUsage().heapUsed);
            this.globals.set("RESULT", [], BigInt(freed), frame.context);
            break;
          }
          case "BITMAP_CACHE_ENABLE":
            // Only affects graphics caching; no graphics are cached here.
            num(args);
            break;
          case "MAP_RELEASE": this.maps.delete(text(ev(args))); break;
          case "MAP_CREATE": {
            const name = text(ev(args));
            if (this.maps.has(name)) throw new EraError(`Map already exists: ${name}`);
            this.maps.set(name, new Map());
            break;
          }
          case "MAP_SET": {
            const parts = this.arguments(args);
            if (parts.length !== 3) throw new EraError("MAP_SET expects map, key and value");
            this.map(text(ev(parts[0]!))).set(text(ev(parts[1]!)), text(ev(parts[2]!)));
            break;
          }
          case "REDRAW": {
            this.redraw = num(args) & 1n;
            // Bit 1 requests an immediate refresh in Emuera; snapshots already flush at INPUT/WAIT.
            break;
          }
          case "SETFONT": {
            const font = args ? text(ev(args)) : "";
            if (font) this.style.font = font;
            else delete this.style.font;
            break;
          }
          case "FORCEKANA": {
            const mode = num(args);
            if (mode < 0n || mode > 3n) throw new EraError("FORCEKANA expects a value from 0 to 3");
            this.forceKana = Number(mode);
            break;
          }
          case "FONTBOLD": this.style.fontStyle |= 1; break;
          case "FONTITALIC": this.style.fontStyle |= 2; break;
          case "FONTREGULAR": this.style.fontStyle = 0; break;
          case "FONTSTYLE": {
            const style = num(args);
            if (style < 0n || style > 15n) throw new EraError("FONTSTYLE expects a value from 0 to 15");
            this.style.fontStyle = Number(style);
            break;
          }
          case "HTML_PRINT": {
            const parts = this.arguments(args);
            if (parts.length < 1 || parts.length > 2 || !parts[0]) throw new EraError("HTML_PRINT expects html[, toPrintBuffer]");
            const html = text(ev(parts[0]));
            const buffered = parts[1] ? num(parts[1]) !== 0n : false;
            if (!html || this.skipDisplay) break;
            // PrintHtml flushes pending plain text before adding its own display lines. Panel markers are
            // our layout extension, not Emuera HTML, and retain their shared-line behavior.
            const panel = /^\s*<era-(?:open|close)(?:\s+class\s*=\s*(?:'[^']*'|"[^"]*"))?\s*\/?>\s*$/i.test(html);
            if (this.lineOpen && !panel && !buffered) yield this.emit("text", "", true);
            yield this.emit("html", html, !buffered);
            break;
          }
          case "PRINT_RECT": case "PRINT_SPACE": {
            // ConsoleShapePart's alt text: params are percentages of the font size, drawn in the current color.
            const params = this.arguments(args).map((part) => num(part));
            if (op === "PRINT_SPACE" ? params.length !== 1 : params.length !== 1 && params.length !== 4) throw new EraError(`${op}: invalid number of arguments`);
            const colored = this.style.color.toLowerCase() !== this.display.foreground.toLowerCase();
            const shape = `<shape type='${op === "PRINT_RECT" ? "rect" : "space"}' param='${params.join(", ")}'${colored ? ` color='#${this.style.color.slice(1).toUpperCase()}'` : ""}>`;
            yield this.emit("html", shape, false);
            break;
          }
          case "PRINT_IMG": {
            const parts = this.arguments(args), values = new Map<number, Value>();
            const value = (i: number): Value => {
              if (!values.has(i)) values.set(i, ev(parts[i]!));
              return values.get(i)!;
            };
            const main = parts[0] ? text(value(0)) : "";
            if (!main || parts.length > 6) throw new EraError("PRINT_IMG expects sprite[, hover][, color matrix][, width, height, ypos]");
            let at = 1, hover: string | undefined, matrix: ColorMatrix | undefined;
            const isMatrix = (expr: Expr): boolean => expr.kind === "variable" && frame.variables.dimensions(expr.name, frame.context).length > 1;
            if (parts[at] && !isMatrix(this.parse(parts[at]!)) && typeof value(at) === "string") hover = text(value(at++));
            if (parts[at]) {
              const candidate = this.parse(parts[at]!);
              if (isMatrix(candidate)) {
                matrix = this.colorMatrix(candidate, frame.variables, frame.context, op);
                at++;
              }
            }
            if (parts.length - at > 3) throw new EraError("PRINT_IMG accepts at most width, height and ypos after its sprites and matrix");
            const sizes = parts.slice(at).map((part, i) => part ? ` ${["width", "height", "ypos"][i]}='${integer(value(at + i))}'` : "").join("");
            const html = `<img src="${escapeHtml(main)}"${hover ? ` srcb="${escapeHtml(hover)}"` : ""}${sizes}>`;
            const emitted = this.emit("html", html, false);
            if (matrix && "output" in emitted && emitted.output.type === "html") {
              for (const id of [main, hover].filter((id): id is string => !!id)) {
                const sprite = this.sprite(id);
                if (!sprite) continue;
                const draw = this.spriteOp(sprite, [0, 0, sprite.width, sprite.height], matrix);
                (emitted.output.sprites ??= {})[id] = { width: sprite.width, height: sprite.height, x: 0, y: 0,
                  picture: { width: sprite.width, height: sprite.height, ops: draw ? [draw] : [] } };
              }
            }
            yield emitted;
            break;
          }
          case "PRINTBUTTON": case "PRINTBUTTONC": case "PRINTBUTTONLC": {
            const parts = this.arguments(args);
            if (parts.length !== 2) throw new EraError(`${op} expects label and value`);
            const label = this.printC(text(ev(parts[0]!)), op === "PRINTBUTTON" ? "" : op === "PRINTBUTTONC" ? "C" : "LC");
            if (this.skipDisplay) break;
            this.lineOpen = true;
            const value = String(ev(parts[1]!));
            this.lineButtons.push(value);
            const output: Output = { type: "button", text: label, value, style: { ...this.style } };
            this.accountOutput(output);
            yield { output };
            break;
          }
          case "DRAWLINE": yield this.emit("text", "-".repeat(this.columns), true); break;
          case "CUSTOMDRAWLINE": case "DRAWLINEFORM": {
            const pattern = op === "DRAWLINEFORM" ? this.formatted(args, frame) : args;
            const width = stringWidth(pattern);
            yield this.emit("text", width ? pattern.repeat(Math.floor(this.columns / width)) : "", true);
            break;
          }
          case "CLEARLINE": {
            const count = Number(BigInt.asIntN(32, num(args)));
            if (count <= 0) break;
            this.dropLines(count);
            if (count) { this.printingHtml = ""; this.printedLine = ""; this.lineButtons = []; this.temporaryLine = false; this.lineOpen = false; }
            const output: Output = { type: "clear", count };
            this.accountOutput(output);
            yield { output };
            break;
          }
          case "WHILE": if (num(args) === 0n) next = target + 1; break;
          case "WEND": next = target; break;
          case "DO": break;
          case "LOOP": if (num(args) !== 0n) next = target; break;
          case "BREAK": case "CONTINUE": {
            const loop = loops.filter((loop) => loop.start < pc && loop.end > pc).sort((a, b) => b.start - a.start)[0];
            if (!loop) throw new EraError(`${op} outside a loop`);
            if (op === "BREAK") {
              const state = loopStates.get(loop.start);
              if (state) this.assign(frame, state.variable, BigInt.asIntN(64, integer(evaluate(state.variable, frame.context)) + state.step));
              next = loop.end + 1;
              loopStates.delete(loop.start);
            }
            else next = loop.end;
            break;
          }
          case "RESTART":
            if (args) throw new EraError("RESTART does not accept arguments");
            loopStates.clear();
            next = 0;
            break;
          case "GOTO": case "GOTOFORM": case "TRYGOTO": case "TRYGOTOFORM": {
            const label = op.endsWith("FORM") ? this.formatted(args, frame).trim() : args;
            const destination = labels.get(key(label));
            if (destination === undefined) {
              // TRYGOTO and TRYGOTOFORM continue with the next line when the label does not exist.
              if (op.startsWith("TRY")) break;
              throw new EraError(`Unknown label: ${label}`);
            }
            next = this.gotoDestination(frame.compiled, pc, destination, loopStates); break;
          }
          case "RETURN": case "RETURNFORM": {
            const source = op === "RETURNFORM" ? this.formatted(args, frame) : args;
            if (source.trim()) this.arguments(source).map(ev).forEach((value, i) => this.globals.set("RESULT", [literal(BigInt(i))], value, frame.context));
            else this.globals.set("RESULT", [], 0n, frame.context);
            return;
          }
          case "VARSIZE": {
            const reference = this.parse(args);
            if (reference.kind !== "variable" || reference.indices.length)
              throw new EraError("VARSIZE expects an array variable name");
            const dimensions = frame.variables.dimensions(reference.name, frame.context);
            this.globals.setMany("RESULT", [literal(0n)], dimensions.map(BigInt), frame.context);
            break;
          }
          case "VARSET": {
            const parts = this.arguments(args);
            const reference = this.parse(parts[0] ?? "");
            if (reference.kind !== "variable" || parts.length > 4) throw new EraError("VARSET expects variable[, value, start, end]");
            const value = parts[1] ? ev(parts[1]) : undefined;
            const bound = (i: number): number | undefined => parts[i] ? Number(num(parts[i]!)) : undefined;
            frame.variables.fill(reference.name, reference.indices, value, [bound(2), bound(3)], frame.context);
            break;
          }
          case "VARI": case "VARS": {
            const declaration = inlineDeclaration(line)!;
            frame.variables.fill(declaration.name, [], declaration.string ? "" : 0n, [undefined, undefined], frame.context);
            const dimensions = frame.variables.dimensions(declaration.name, frame.context);
            if (dimensions.length === 1 && dimensions[0] === 1) {
              const value = declaration.initializer ? ev(declaration.initializer) : declaration.string ? "" : 0n;
              this.assign(frame, this.parse(declaration.name), value);
            }
            break;
          }
          case "STRLEN": case "STRLENU": case "STRLENFORM": case "STRLENFORMU": {
            const source = op.startsWith("STRLENFORM") ? this.formatted(args, frame) : args;
            this.globals.set("RESULT", [], BigInt(op.endsWith("U") ? source.length : stringWidth(source)), frame.context);
            break;
          }
          case "STRLENS": case "STRLENSU": case "SUBSTRING": case "SUBSTRINGU": case "STRFIND": case "STRFINDU": case "STRCOUNT": case "EXISTFUNCTION":
          case "CLIENTWIDTH": case "CLIENTHEIGHT": case "ISACTIVE": case "MOUSEX": case "MOUSEY": case "FIND_CHARADATA": case "EXISTFILE":
          case "SIGN": case "ALLSAMES": case "NOSAMES": case "COLOR_FROMNAME": case "COLOR_FROMRGB": case "CHKFONT": case "LINEISEMPTY": case "HTML_GETPRINTEDSTR":
          case "GETDOINGFUNCTION": case "MESSKIP": case "GETKEY": case "GETKEYTRIGGERED": case "GETTEXTBOX": case "REGEXPMATCH": case "STRJOIN":
          case "INRANGEARRAY": case "INRANGECARRAY": case "CLEARMEMORY": case "GETMEMORYUSAGE": case "ISDEFINED": {
            // Instruction forms of string functions store the result in RESULT or RESULTS.
            const result = evaluate({ kind: "call", name: op, args: args.trim() ? this.arguments(args).map((part) => this.parse(part)) : [] }, frame.context);
            this.globals.set(typeof result === "string" ? "RESULTS" : "RESULT", [], result, frame.context);
            break;
          }
          case "ENCODETOUNI": {
            // RESULT:0 is the UTF-16 length and RESULT:1~ the code points.
            const source = text(ev(args));
            const points = [...source].map((c) => BigInt(c.codePointAt(0)!));
            this.globals.set("RESULT", [], BigInt(source.length), frame.context);
            this.writeArray(this.globals, frame.context, { kind: "variable", name: "RESULT", indices: [literal(1n)] }, points);
            break;
          }
          case "SPLIT": {
            const parts = this.arguments(args);
            if (parts.length !== 3 && parts.length !== 4) throw new EraError("SPLIT expects source, separator, destination(, count variable)");
            const separator = text(ev(parts[1]!));
            if (!separator) throw new EraError("SPLIT separator must not be empty");
            const values = text(ev(parts[0]!)).split(separator);
            const reference = this.parse(parts[2]!);
            if (reference.kind !== "variable") throw new EraError("SPLIT destination must be a string array");
            const count = BigInt(values.length);
            if (parts[3]) this.assign(frame, this.parse(parts[3]), count);
            else this.globals.set("RESULT", [], count, frame.context);
            // Pieces beyond the array's length are dropped, as in Emuera.
            const length = frame.variables.dimensions(reference.name, frame.context).at(-1) ?? values.length;
            frame.variables.setMany(reference.name, reference.indices, values.slice(0, length), frame.context);
            break;
          }
          case "HTML_TAGSPLIT": {
            const parts = this.arguments(args);
            if (parts.length < 1 || parts.length > 3) throw new EraError("HTML_TAGSPLIT expects html(, string array, integer variable)");
            const output: Expr = parts[1] ? this.parse(parts[1]) : { kind: "variable", name: "RESULTS", indices: [] };
            const count: Expr = parts[2] ? this.parse(parts[2]) : { kind: "variable", name: "RESULT", indices: [] };
            if (output.kind !== "variable" || count.kind !== "variable") throw new EraError("HTML_TAGSPLIT outputs must be variables");
            const pieces = htmlTagSplit(text(ev(parts[0]!)));
            // Emuera fills the destination array from index 0 whatever index was written.
            if (pieces) this.writeArray(frame.variables, frame.context, { kind: "variable", name: output.name, indices: [] }, pieces);
            this.assign(frame, count, BigInt(pieces?.length ?? -1));
            break;
          }
          case "UPDATECHECK":
            if (args) throw new EraError("UPDATECHECK takes no arguments");
            // Native result 4 means update checks are disabled; game-provided URLs are never fetched.
            this.globals.set("RESULT", [], 4n, frame.context);
            break;
          case "QUIT_AND_RESTART": case "FORCE_QUIT_AND_RESTART":
            if (args) throw new EraError(`${op} takes no arguments`);
            throw new RestartTransition();
          case "QUIT": this.finished = true; return;
          case "BINPUT": case "BINPUTS": {
            const numeric = op === "BINPUT";
            const parts = args.trim() ? this.arguments(args) : [];
            if (parts.length > 3) throw new EraError(`${op} expects default[, allowClick, canSkip]`);
            // Mouse side-channel extensions must not be silently accepted without implementing their result slots.
            if (parts[1] && num(parts[1]) !== 0n) throw new EraError(`${op} mouse side-channel mode is not supported`);
            if (parts[2]) num(parts[2]);
            const fallback = parts[0] ? numeric ? integer(ev(parts[0])).toString() : text(ev(parts[0])) : undefined;
            const values = [...new Set([...this.buttonLines.flat(), ...this.lineButtons])]
              .filter((value) => !numeric || /^-?\d+$/.test(value))
              .map((value) => numeric ? BigInt(value).toString() : value);
            if (!values.length) {
              if (fallback === undefined) throw new EraError(`${op} requires a displayed button or a default value`);
              this.globals.set(numeric ? "RESULT" : "RESULTS", [], numeric ? BigInt(fallback) : fallback, frame.context);
              break;
            }
            const request: InputRequest = { kind: numeric ? "integer" : "string", buttonValues: values };
            if (fallback !== undefined) request.defaultValue = fallback;
            const value = yield { input: request };
            yield this.emit("input", value, true);
            this.globals.set(numeric ? "RESULT" : "RESULTS", [], numeric ? BigInt(value.trim()) : value, frame.context);
            break;
          }
          case "INPUTANY": {
            if (args.trim()) throw new EraError("INPUTANY does not accept arguments");
            const value = yield { input: { kind: "any" } };
            yield this.emit("input", value, true);
            const numeric = /^-?\d+$/.test(value.trim());
            this.globals.set(numeric ? "RESULT" : "RESULTS", [], numeric ? BigInt(value.trim()) : value, frame.context);
            break;
          }
          case "INPUT": case "INPUTS": case "ONEINPUT": case "ONEINPUTS": {
            const singleCharacter = op.startsWith("ONE");
            const numeric = !op.endsWith("S");
            const request: InputRequest = { kind: numeric ? "integer" : "string" };
            if (singleCharacter) request.singleCharacter = true;
            // The argument is the value an empty input gives: an integer expression, or FORM text for the S forms.
            if (args.trim()) {
              const fallback = numeric ? integer(ev(args)) : this.formatted(args, frame);
              if (!singleCharacter) request.defaultValue = fallback.toString();
              else if (typeof fallback === "string" || fallback >= 0n) {
                const first = Array.from(fallback.toString())[0];
                if (first !== undefined) request.defaultValue = first;
              }
            }
            const value = yield { input: request };
            yield this.emit("input", value, true);
            this.globals.set(numeric ? "RESULT" : "RESULTS", [], numeric ? BigInt(value.trim()) : value, frame.context);
            break;
          }
          case "WAIT": yield { input: { kind: "wait" } }; break;
          case "FORCEWAIT": yield { input: { kind: "wait", stopSkipping: true } }; break;
          case "INPUTMOUSEKEY": {
            // Prints nothing, not even the timeout message; the script reads RESULT:0-5.
            const time = args.trim() ? Number(num(args)) : 0;
            const request: InputRequest = { kind: "mousekey" };
            if (time > 0) {
              request.timeout = Math.min(time, 2 ** 31 - 1);
              this.timed = { value: JSON.stringify({ result: [4, 0, 0, 0, 0, 0] } satisfies MouseKeyInput), message: undefined, countdown: false };
            }
            const { result, results } = mouseKeyInput(yield { input: request });
            result.forEach((value, i) => this.globals.set("RESULT", [literal(BigInt(i))], BigInt(value), frame.context));
            if (results !== undefined) this.globals.set("RESULTS", [], results, frame.context);
            break;
          }
          case "CBGCLEAR":
            if (args.trim()) throw new EraError("CBGCLEAR does not accept arguments");
            this.background = [];
            this.backgroundMap = undefined;
            this.backgroundChanged = true;
            break;
          case "CBGSETBMAPG":
            this.backgroundMap = num(args);
            if (!this.graphics.has(this.backgroundMap)) throw new EraError("CBGSETBMAPG requires existing graphics");
            this.backgroundChanged = true;
            break;
          case "CBGREMOVEBMAP":
            if (args.trim()) throw new EraError("CBGREMOVEBMAP does not accept arguments");
            this.backgroundMap = undefined;
            this.backgroundChanged = true;
            break;
          case "CBGCLEARBUTTON":
            if (args.trim()) throw new EraError("CBGCLEARBUTTON does not accept arguments");
            this.background = this.background.filter((layer) => layer.buttonValue === undefined);
            this.backgroundChanged = true;
            break;
          case "CBGSETBUTTONSPRITE": {
            const parts = this.arguments(args);
            if (parts.length < 6 || parts.length > 7 || parts.slice(0, 6).some((part) => !part)) throw new EraError("CBGSETBUTTONSPRITE expects value, sprite, hover, x, y, z[, tooltip]");
            const buttonValue = Number(num(parts[0]!)), z = Number(num(parts[5]!));
            if (buttonValue < 0 || buttonValue > 0xffffff) throw new EraError("CBG button values must fit in 24 bits");
            if (!z) throw new EraError("CBGSETBUTTONSPRITE: zDepth must not be 0");
            const layer: BackgroundSource = { buttonValue, sprite: text(ev(parts[1]!)), hover: text(ev(parts[2]!)),
              x: Number(num(parts[3]!)), y: Number(num(parts[4]!)), z, tooltip: parts[6] ? text(ev(parts[6])) : "" };
            if (!this.sprite(layer.sprite!) || (layer.hover && !this.sprite(layer.hover))) throw new EraError("CBGSETBUTTONSPRITE requires existing sprites");
            const at = this.background.findIndex((other) => other.z < z);
            this.background.splice(at < 0 ? this.background.length : at, 0, layer);
            this.backgroundChanged = true;
            break;
          }
          case "CBGREMOVERANGE": {
            const parts = this.arguments(args);
            if (parts.length !== 2 || !parts[0] || !parts[1]) throw new EraError("CBGREMOVERANGE expects zmin, zmax");
            const from = Number(num(parts[0])), to = Number(num(parts[1]));
            this.background = this.background.filter((layer) => layer.z < from || layer.z > to);
            this.backgroundChanged = true;
            break;
          }
          case "CBGSETG": case "CBGSETSPRITE": {
            const parts = this.arguments(args);
            if (parts.length !== 4 || parts.some((part) => !part)) throw new EraError(`${op} expects ${op === "CBGSETG" ? "gID" : "sprite"}, x, y, zDepth`);
            const z = Number(num(parts[3]!));
            if (z === 0) throw new EraError(`${op}: zDepth must not be 0 (the text layer)`);
            const source = ev(parts[0]!);
            let picture: Picture | undefined;
            if (op === "CBGSETG") picture = this.picture(integer(source));
            else {
              const sprite = this.sprite(text(source));
              const draw = sprite && this.spriteOp(sprite, [0, 0, sprite.width, sprite.height]);
              if (sprite && draw) picture = { width: sprite.width, height: sprite.height, ops: [draw] };
            }
            this.globals.set("RESULT", [], picture ? 1n : 0n, frame.context);
            if (!picture) break;
            const layer: BackgroundSource = { z, x: Number(num(parts[1]!)), y: Number(num(parts[2]!)),
              ...(op === "CBGSETG" ? { graphics: integer(source) } : { sprite: text(source) }) };
            const at = this.background.findIndex((other) => other.z < z);
            this.background.splice(at < 0 ? this.background.length : at, 0, layer);
            this.backgroundChanged = true;
            break;
          }
          case "TWAIT": {
            const parts = this.arguments(args);
            if (parts.length !== 2 || !parts[0] || !parts[1]) throw new EraError("TWAIT expects time and flag");
            const time = Number(num(parts[0]));
            const blocking = num(parts[1]) !== 0n;
            if (time <= 0 && blocking) break;
            const request: InputRequest = { kind: "wait" };
            if (time > 0) request.timeout = Math.min(time, 2 ** 31 - 1);
            if (blocking) request.blocking = true;
            this.timed = { value: "", message: undefined, countdown: false };
            yield { input: request };
            break;
          }
          case "TINPUT": case "TINPUTS": case "TONEINPUT": case "TONEINPUTS": {
            const numeric = !op.endsWith("S");
            const single = op.startsWith("TONE");
            const parts = this.arguments(args);
            if (parts.length < 2 || parts.length > 4 || !parts[0] || !parts[1]) throw new EraError(`${op} expects time, default{, display, message}`);
            const time = Number(num(parts[0]));
            let fallback = numeric ? integer(ev(parts[1])).toString() : text(ev(parts[1]));
            if (single) {
              // TONEINPUT keeps only the leading digit of the absolute default; TONEINPUTS its first character.
              if (numeric && fallback.startsWith("-")) fallback = fallback.slice(1);
              fallback = Array.from(fallback)[0] ?? "";
            }
            const countdown = parts[2] ? num(parts[2]) !== 0n : true;
            const message = parts[3] !== undefined ? text(ev(parts[3])) : this.game.config.get("時間切れ表示") ?? "時間切れ";
            const request: InputRequest = { kind: numeric ? "integer" : "string" };
            if (single) request.singleCharacter = true;
            if (time > 0) {
              request.timeout = Math.min(time, 2 ** 31 - 1);
              if (countdown) {
                request.countdown = true;
                yield this.emit("text", `残り ${Math.trunc(time / 100) / 10}`, true);
              }
              this.timed = { value: fallback, message, countdown };
            }
            const value = yield { input: request };
            yield this.emit("input", value, true);
            this.globals.set(numeric ? "RESULT" : "RESULTS", [], numeric ? BigInt(value.trim()) : value, frame.context);
            break;
          }
          case "SETCOLOR": case "SETBGCOLOR": {
            const channels = this.arguments(args).map(num);
            if (channels.length !== 1 && channels.length !== 3) throw new EraError(`${op} expects RGB integer or three channels`);
            if (channels.some((c) => c < 0n || c > (channels.length === 1 ? 0xffffffn : 255n))) throw new EraError("Color out of range");
            const color = channels.length === 1 ? channels[0]! : (channels[0]! << 16n) | (channels[1]! << 8n) | channels[2]!;
            this.style[op === "SETCOLOR" ? "color" : "background"] = "#" + color.toString(16).padStart(6, "0"); break;
          }
          case "RESETCOLOR": this.style.color = this.display.foreground; break;
          case "RESETBGCOLOR": this.style.background = this.display.background; break;
          case "ALIGNMENT": {
            const alignment = args.toLowerCase();
            if (alignment !== "left" && alignment !== "center" && alignment !== "right") throw new EraError(`Invalid alignment: ${args}`);
            this.style.alignment = alignment; break;
          }
          case "TIMES": {
            const parts = this.arguments(args);
            const reference = this.parse(parts[0] ?? "");
            const factor = /^\s*([+-]?)(\d*)(?:\.(\d*))?\s*$/.exec(parts[1] ?? "");
            if (parts.length !== 2 || reference.kind !== "variable" || !factor || !(factor[2] || factor[3])) throw new EraError("TIMES expects integer variable and decimal literal");
            const scale = 10n ** BigInt((factor[3] ?? "").length);
            const numerator = BigInt((factor[2] || "0") + (factor[3] ?? "")) * (factor[1] === "-" ? -1n : 1n);
            this.assign(frame, reference, BigInt.asIntN(64, integer(evaluate(reference, frame.context)) * numerator / scale));
            break;
          }
          case "BAR": case "BARL": case "BARSTR": {
            const parts = this.arguments(args);
            if (parts.length !== 3) throw new EraError(`${op} expects value, maximum, length`);
            const [value, maximum, length] = parts.map(num) as [bigint, bigint, bigint];
            const bar = this.bar(value, maximum, length, op);
            if (op === "BARSTR") this.globals.set("RESULTS", [], bar, frame.context);
            else yield this.emit("text", bar, op === "BARL");
            break;
          }
          case "SKIPDISP":
            this.skipDisplay = num(args) !== 0n;
            this.userSkip = this.skipDisplay;
            this.globals.set("RESULT", [], this.skipDisplay ? 1n : 0n, frame.context);
            break;
          case "SKIPLOG":
            this.messageSkip = num(args) !== 0n;
            break;
          case "CALLTRAIN": {
            const count = num(args);
            const length = this.globals.dimensions("SELECTCOM", frame.context)[0] ?? 1;
            if (count >= BigInt(length)) throw new EraError("CALLTRAIN命令の引数の値がSELECTCOMの要素数を超えています");
            const coms: bigint[] = [];
            for (let i = 1n; i <= count; i++) coms.push(integer(this.globals.get("SELECTCOM", [literal(i)], frame.context)));
            this.ctrain = { coms, count: 0 };
            break;
          }
          case "STOPCALLTRAIN":
            if (this.ctrain) {
              this.ctrain = undefined;
              this.skipDisplay = true;
              try { yield* this.system("CALLTRAINEND", false, false); } finally { this.skipDisplay = false; }
            }
            break;
          case "NOSKIP": this.noSkip.push(this.skipDisplay); this.skipDisplay = false; break;
          case "ENDNOSKIP":
            if (!this.noSkip.length) throw new EraError("ENDNOSKIP without NOSKIP");
            this.skipDisplay = this.noSkip.pop()!;
            break;
          case "ISSKIP": case "MOUSESKIP":
            this.globals.set("RESULT", [], op === "ISSKIP" && this.skipDisplay ? 1n : 0n, frame.context);
            break;
          case "REUSELASTLINE": {
            const output = this.emit("text", this.formatted(args, frame), true);
            this.temporaryLine = true;
            yield output;
            break;
          }
          case "CVARSET": {
            const parts = this.arguments(args);
            const reference = this.parse(parts[0] ?? "");
            if (reference.kind !== "variable" || reference.indices.length || parts.length > 5 || !this.globals.isCharacter(reference.name, frame.context))
              throw new EraError("CVARSET expects character variable[, index, value, start, end]");
            const count = BigInt(this.globals.characterCount());
            const index = parts[1] ? ev(parts[1]) : 0n;
            const value = parts[2] ? ev(parts[2]) : this.globals.isString(reference.name, frame.context) ? "" : 0n;
            let start = parts[3] ? num(parts[3]) : 0n, end = parts[4] ? num(parts[4]) : count;
            if (start > end) [start, end] = [end, start];
            if (start < 0n || end > count) throw new EraError("CVARSET character range out of bounds");
            const dimensions = this.globals.dimensions(reference.name, frame.context).length;
            for (let i = start; i < end; i++) {
              const indices: Expr[] = [literal(i), literal(index)];
              if (dimensions > 1) throw new EraError("CVARSET supports one-dimensional character variables only");
              this.globals.set(reference.name, indices, value, frame.context);
            }
            break;
          }
          case "ARRAYSHIFT": {
            const parts = this.arguments(args);
            const reference = this.parse(parts[0] ?? "");
            if (reference.kind !== "variable" || parts.length < 3 || parts.length > 5) throw new EraError("ARRAYSHIFT expects array, shift, default[, start, count]");
            const row = frame.variables.row(reference.name, reference.indices, frame.context);
            const shift = Number(num(parts[1]!)), fill = ev(parts[2]!);
            const start = parts[3] ? Number(num(parts[3])) : 0;
            let count = parts[4] ? Number(num(parts[4])) : -1;
            if (start < 0 || start >= row.size) throw new EraError("ARRAYSHIFT start out of range");
            if (count < 0 || start + count > row.size) count = row.size - start;
            if (shift === 0 || count === 0) break;
            const before = Array.from({ length: count }, (_, i) => row.get(start + i));
            for (let i = 0; i < count; i++) {
              const source = i - shift;
              row.set(start + i, source >= 0 && source < count ? before[source]! : fill);
            }
            break;
          }
          case "ARRAYSORT": {
            const parts = this.arguments(args);
            const reference = this.parse(parts[0] ?? "");
            if (reference.kind !== "variable" || parts.length > 4) throw new EraError("ARRAYSORT expects array[, FORWARD|BACK, start, count]");
            const direction = key(parts[1] || "FORWARD");
            if (direction !== "FORWARD" && direction !== "BACK") throw new EraError("ARRAYSORT order must be FORWARD or BACK");
            const row = frame.variables.row(reference.name, reference.indices, frame.context);
            const start = parts[2] ? Number(num(parts[2])) : 0;
            let count = parts[3] ? Number(num(parts[3])) : 0;
            if (start < 0 || start >= row.size) throw new EraError("ARRAYSORT start out of range");
            if (count <= 0 || start + count > row.size) count = row.size - start;
            const values = Array.from({ length: count }, (_, i) => row.get(start + i));
            values.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0) * (direction === "BACK" ? -1 : 1));
            values.forEach((value, i) => row.set(start + i, value));
            break;
          }
          case "ARRAYCOPY": {
            const parts = this.arguments(args);
            if (parts.length !== 2) throw new EraError("ARRAYCOPY expects source and destination names");
            frame.variables.copyArray(text(ev(parts[0]!)), text(ev(parts[1]!)), frame.context);
            break;
          }
          case "POWER": {
            const parts = this.arguments(args);
            const target = this.parse(parts[0] ?? "");
            if (parts.length !== 3 || target.kind !== "variable") throw new EraError("POWER expects an integer variable and two integers");
            this.assign(frame, target, power(integer(evaluate(this.parse(parts[1]!), frame.context)), integer(evaluate(this.parse(parts[2]!), frame.context))));
            break;
          }
          case "SWAP": {
            const parts = this.arguments(args);
            const left = this.parse(parts[0] ?? ""), right = this.parse(parts[1] ?? "");
            if (parts.length !== 2 || left.kind !== "variable" || right.kind !== "variable") throw new EraError("SWAP expects two variables");
            const a = evaluate(left, frame.context), b = evaluate(right, frame.context);
            if (typeof a !== typeof b) throw new EraError("SWAP variables must have the same type");
            this.assign(frame, left, b);
            this.assign(frame, right, a);
            break;
          }
          case "SETVAR": {
            const parts = this.arguments(args);
            if (parts.length !== 2) throw new EraError("SETVAR expects variable name and value");
            const reference = this.parse(text(ev(parts[0]!)));
            if (reference.kind !== "variable") throw new EraError("SETVAR name must be a variable");
            this.assign(frame, reference, ev(parts[1]!));
            break;
          }
          case "VARSETEX": {
            const parts = this.arguments(args);
            const value = frame.context.call(op, parts.map((part) => part ? ev(part) : undefined));
            this.globals.set("RESULT", [], value, frame.context);
            break;
          }
          case "SETCOLORBYNAME": case "SETBGCOLORBYNAME": {
            const color = KNOWN_COLORS[key(args.trim())];
            if (color === undefined) throw new EraError(`Unknown color name: ${args.trim()}`);
            this.style[op === "SETCOLORBYNAME" ? "color" : "background"] = color;
            break;
          }
          case "GETTIME": {
            const [value, text] = currentTime();
            this.globals.set("RESULT", [], value, frame.context);
            this.globals.set("RESULTS", [], text, frame.context);
            break;
          }
          case "GETMILLISECOND": case "GETSECOND": {
            const ms = BigInt(Date.now()) + EPOCH_OFFSET_MS;
            this.globals.set("RESULT", [], op === "GETSECOND" ? ms / 1000n : ms, frame.context);
            break;
          }
          case "RANDOMIZE": {
            const seed = args.trim() ? num(args) : BigInt(Date.now());
            this.randomState = BigInt.asUintN(64, seed);
            break;
          }
          case "DUMPRAND": this.dumpedRandom = this.randomState; break;
          case "INITRAND": if (this.dumpedRandom !== undefined) this.randomState = this.dumpedRandom; break;
          case "WAITANYKEY": yield { input: { kind: "wait" } }; break;
          case "TOOLTIP_CUSTOM": case "TOOLTIP_SETFONTSIZE": case "TOOLTIP_SETFONT": case "TOOLTIP_FORMAT":
          case "TOOLTIP_SETDELAY": case "TOOLTIP_SETDURATION": case "TOOLTIP_SETCOLOR": {
            const parts = this.arguments(args), count = op === "TOOLTIP_SETCOLOR" ? 2 : 1;
            if (parts.length !== count || parts.some((part) => !part)) throw new EraError(`${op} expects ${count} argument(s)`);
            if (op === "TOOLTIP_FORMAT") {
              const format = num(parts[0]!);
              if (format < 0n || format > 2n) throw new EraError("TOOLTIP_FORMAT supports Left (0), HorizontalCenter (1), or Right (2)");
              this.tooltipSettings.format = Number(format);
            } else if (op === "TOOLTIP_SETFONT") this.tooltipSettings.font = text(ev(parts[0]!));
            else if (op === "TOOLTIP_SETCOLOR") {
              this.tooltipSettings.color = rgbColor(num(parts[0]!));
              this.tooltipSettings.background = rgbColor(num(parts[1]!));
            } else if (op === "TOOLTIP_CUSTOM") this.tooltipSettings.custom = num(parts[0]!) !== 0n;
            else {
              const value = Number(num(parts[0]!));
              if (value < 0 || value > 2 ** 31 - 1 || op === "TOOLTIP_SETFONTSIZE" && (value < 1 || value > 8192))
                throw new EraError(`${op} argument out of range`);
              this.tooltipSettings[op === "TOOLTIP_SETFONTSIZE" ? "fontSize" : op === "TOOLTIP_SETDELAY" ? "delay" : "duration"] = value;
            }
            this.tooltipChanged = true;
            break;
          }
          case "SETBGMVOLUME": case "SETSOUNDVOLUME": case "PLAYSOUND": case "PLAYBGM": case "STOPSOUND": case "STOPBGM": {
            const parts = args.trim() ? this.arguments(args) : [];
            const expected = op === "STOPSOUND" || op === "STOPBGM" ? 0 : 1;
            if (parts.length < expected || parts.length > (op === "PLAYSOUND" ? 2 : expected) || parts.some((part) => !part))
              throw new EraError(`${op} expects ${op === "PLAYSOUND" ? "1 or 2" : expected} argument(s)`);
            const audio = this.audio ??= { soundVolume: 100, bgmVolume: 100, bgm: null, sounds: [], stopSounds: false };
            if (op === "SETBGMVOLUME" || op === "SETSOUNDVOLUME") {
              const volume = Number(num(parts[0]!));
              audio[op === "SETBGMVOLUME" ? "bgmVolume" : "soundVolume"] = Math.min(100, Math.max(0, volume));
            } else if (op === "STOPBGM") audio.bgm = null;
            else if (op === "STOPSOUND") { audio.sounds = []; audio.stopSounds = true; }
            else {
              const filename = text(ev(parts[0]!));
              const repeat = parts[1] ? Math.max(1, Number(num(parts[1]))) : 1;
              if (/^(?:[\\/]|[A-Za-z]:)/.test(filename) || filename.replaceAll("\\", "/").split("/").includes(".."))
                throw new EraError(`${op} requires a path within the sound directory`);
              const file = this.gameFile("sound/" + filename);
              // Native Emuera ignores missing sound files.
              if (file) {
                const relative = path.relative(this.game.root, file).split(path.sep).slice(1).map(encodeURIComponent).join("/");
                const url = `${this.game.resourceBase.replace(/resources\/$/, "sound/")}${relative}`;
                const track = { id: randomUUID(), url };
                if (op === "PLAYBGM") audio.bgm = track;
                else audio.sounds.push({ ...track, repeat });
              }
            }
            break;
          }
          case "AWAIT": {
            const time = args.trim() ? Number(num(args)) : 0;
            if (time < 0 || time > 10000) throw new EraError("AWAIT time must be between 0 and 10000 milliseconds");
            this.timed = { value: "", message: undefined, countdown: false };
            // Even AWAIT 0 must yield to the host so focus/minimize polling loops cannot block the server.
            yield { input: { kind: "wait", timeout: Math.max(1, time), blocking: true, stopSkipping: true, sleep: true } };
            break;
          }
          case "SETANIMETIMER":
            break;
          case "CALLSHARP": {
            if (!supportedSharpCall(args))
              throw new EraError("CALLSHARP requires a native .NET plugin; only LAUNCH_BROWSER, FixHTML and TranslateDate have TypeScript replacements");
            const call = this.parse(args);
            if (call.kind !== "call" || !SHARP_METHODS.has(call.name)) throw new EraError("CALLSHARP expects a supported method call");
            if (call.name === "LAUNCH_BROWSER") {
              if (call.args.length !== 1) throw new EraError("CALLSHARP LAUNCH_BROWSER expects one HTTP(S) URL");
              const target = text(evaluate(call.args[0]!, frame.context));
              if (!/^https?:\/\//i.test(target) || !URL.canParse(target))
                throw new EraError("CALLSHARP LAUNCH_BROWSER expects a valid HTTP(S) URL");
              const url = new URL(target);
              if (url.username || url.password) throw new EraError("CALLSHARP LAUNCH_BROWSER does not allow URLs containing credentials");
              if (!this.skipDisplay) {
                if (this.lineOpen) yield this.emit("text", "", true);
                const event = this.emit("html", `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">Open in browser: ${escapeHtml(target)}</a>`, true);
                if ("output" in event && event.output.type === "html")
                  event.output.browserLaunch = { id: randomUUID(), url: url.href };
                yield event;
              }
            } else {
              const [input, output] = call.args;
              if (call.args.length !== 2 || !input || output?.kind !== "variable")
                throw new EraError(`CALLSHARP ${call.name} expects a string and a writable string variable`);
              const source = text(evaluate(input, frame.context));
              const reference = settleIndices(output, frame.context);
              if (!frame.variables.isString(reference.name, frame.context))
                throw new EraError(`CALLSHARP ${call.name} output must be a string variable`);
              this.assign(frame, reference, call.name === "FIXHTML" ? fixHistoryHtml(source) : translateHistoryDate(source));
            }
            break;
          }
          case "THROW": throw new EraError(this.formatted(args, frame));
          default: {
            // Emuera lets any built-in method run as a statement, storing its value in RESULT/RESULTS.
            if (this.game.routines.has(op) || !/^[A-Z_][A-Z0-9_]*$/.test(op)) throw new EraError(`Unsupported instruction: ${op}`);
            let value: Value;
            try { value = evaluate(this.parse(`${op}(${args})`), frame.context); }
            catch (error) {
              if (error instanceof EraError && error.message === `Unsupported expression function: ${op}`) throw new EraError(`Unsupported instruction: ${op}`);
              throw error;
            }
            this.globals.set(typeof value === "string" ? "RESULTS" : "RESULT", [], value, frame.context);
          }
        }
      } catch (error) {
        if (error instanceof EraError) {
          if (!error.source) error.source = line;
          else if (error.source !== line && error.trace.length < 30) error.trace.push(line);
          throw error;
        }
        throw error;
      }
      pc = next;
      if (single) { single.next = next; return undefined; }
    }
    if (!single && !this.finished && !frame.returnType) this.globals.set("RESULT", [], 0n, frame.context);
  }
  private blockEnd(code: Instruction[], start: number): number {
    let current = start;
    while (!["ENDIF", "ENDSELECT"].includes(code[current]!.op)) current = code[current]!.target;
    return current;
  }
  private matchesCase(value: Value, test: CaseTest, ev: (source: string) => Value): boolean {
    if (test.kind === "range") return integer(value) >= integer(ev(test.from)) && integer(value) <= integer(ev(test.to));
    if (test.kind === "compare") return integer(evaluate({ kind: "binary", op: test.op, left: literal(value), right: literal(ev(test.operand)) }, NO_VARIABLES)) !== 0n;
    return value === ev(test.source);
  }
}
