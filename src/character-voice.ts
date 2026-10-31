import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { EraError, type Routine } from "./model.js";

/** How a character talks, taken from her kojo (dialogue) files, so an LLM playing her can match her voice. */
export interface CharacterVoice {
  /** The kojo's own introduction of the character (CHARA_INFO_KOJO), as the status screen prints it. */
  description?: string;
  /** Lines she says in the kojo, in her own words. */
  examples: string[];
}
/** A character's voice as the player edits it: one set of lines for everyday talk, one for intimate scenes. */
export interface EditableVoice {
  description: string;
  examples: string[];
  intimateExamples: string[];
}
/** Voices the player has edited, by character number (NO), which stays the same across saves. */
export interface VoiceStore {
  load(no: number): EditableVoice | null;
  /** Saves a voice, or with null goes back to the generated one. */
  save(no: number, voice: EditableVoice | null): void;
  /** Where the voices are kept, to tell the player. */
  readonly location?: string;
}
export class MemoryVoiceStore implements VoiceStore {
  private voices = new Map<number, EditableVoice>();
  load(no: number): EditableVoice | null { return structuredClone(this.voices.get(no) ?? null); }
  save(no: number, voice: EditableVoice | null): void {
    if (voice) this.voices.set(no, structuredClone(voice)); else this.voices.delete(no);
  }
}
/** Edited voices in one JSON file (by default llm-voices.json in the game's save directory). */
export class FileVoiceStore implements VoiceStore {
  constructor(readonly location: string) {}
  private read(): Record<string, EditableVoice> {
    let source: string;
    try { source = readFileSync(this.location, "utf8"); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw new EraError(`Cannot read character voices: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const data = JSON.parse(source) as unknown;
      return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, EditableVoice> : {};
    } catch { throw new EraError(`Invalid character voices file: ${this.location}`); }
  }
  load(no: number): EditableVoice | null { const voice = this.read()[String(no)]; return voice ? editableVoice(voice) : null; }
  save(no: number, voice: EditableVoice | null): void {
    const voices = this.read();
    if (voice) voices[String(no)] = voice; else delete voices[String(no)];
    const temporary = `${this.location}.${randomUUID()}.tmp`;
    try {
      mkdirSync(path.dirname(this.location), { recursive: true });
      writeFileSync(temporary, `${JSON.stringify(voices, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.location);
    } catch (error) {
      throw new EraError(`Cannot save character voices: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
/** A voice from outside (a request or the file) with its fields checked and its lines trimmed; null if it isn't one. */
export function editableVoice(value: unknown): EditableVoice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const lines = (list: unknown) => Array.isArray(list) && list.every((line) => typeof line === "string")
    ? (list as string[]).map((line) => line.trim()).filter(Boolean) : null;
  const examples = lines(data.examples), intimateExamples = lines(data.intimateExamples);
  if (typeof data.description !== "string" || !examples || !intimateExamples) return null;
  return { description: data.description.trim(), examples, intimateExamples };
}
export interface VoiceHost {
  /** Whether a condition holds now: true, false, or undefined when it can't be known outside the moment it runs. */
  condition(source: string): boolean | undefined;
  /** A FORM string evaluated now, or undefined if it can't be. */
  format(source: string): string | undefined;
}

const EXAMPLES = 12;
/** Kojo files for sexual commands and counters (reactions during intimacy); their lines suit intimate scenes only. */
const INTIMATE_FILE = /カウンター|COUNTER|セクハラ|性交|愛撫|奉仕|加虐|ハード|道具|自慰|絶頂|派生|Hypnosis|催眠/i;
/** Routines for arousal, orgasm, sex and the like, whatever file they are in. */
const INTIMATE_ROUTINE = /COUNTER|PALAMCNG|ORGASM|EJAC|SEX|絶頂|射精|挿入|うふふ/i;
/** Lines that talk about sex belong with intimate scenes wherever they are. */
const INTIMATE_LINE = /\b(?:sex|seed|semen|cum|penis|cock|dick|pussy|womb|vagina|ejaculat\w*|erect\w*|orgasm\w*|climax\w*|naked|nipples?|breasts?|tits|butt|ass|anal|lick\w*|suck\w*|horny|aroused|fuck\w*)\b|精液|射精|おまんこ|おちんちん|ちんぽ|ちんちん|膣|子宮|セックス|乳首|おっぱい|お尻|イく|イっ/i;
/** A kojo routine's command number, as in M_KOJO_MESSAGE_COM_K1_312. */
const COMMAND = /_COM_K\d+(?:_\d+)?_(\d+)$/i;
/**
 * Whether a kojo routine is for intimate moments: in a sexual command file, about arousal or orgasm, or for an
 * eraTW command below 300 (the intimate scene's) or a groping one (310, 313–318).
 */
function intimateRoutine(routine: Routine): boolean {
  const command = Number(routine.name.match(COMMAND)?.[1] ?? -1);
  return INTIMATE_FILE.test(routine.file) || INTIMATE_ROUTINE.test(routine.name)
    || command >= 0 && (command < 300 || command === 310 || command >= 313 && command <= 318);
}
const PRINT = /^(PRINT(?:FORM)?(?:[KD])?(?:L|W|N|C|LC)?|DATA(?:FORM)?)(?:\s(.*))?$/;

/** Lines a routine prints in the current state; branches that can't be decided count as possible. */
export function printedLines(routine: Routine, host: VoiceHost): string[] {
  // Each open IF/SELECTCASE: whether its parent is live, whether a branch was surely taken, whether the current one is live.
  const stack: { parent: boolean; taken: boolean; live: boolean; subject?: string }[] = [];
  const live = () => stack.length ? stack.at(-1)!.live : true;
  const out: string[] = [];
  let open = "", skipNext = false;
  const flush = () => { if (open) out.push(open); open = ""; };
  for (const line of routine.lines) {
    const text = line.text.trim();
    const [, keyword = "", rest = ""] = text.match(/^(\S+)\s*(.*)$/) ?? [];
    const word = keyword.toUpperCase();
    if (word === "IF" || word === "SELECTCASE") {
      const parent = live();
      if (word === "IF") {
        const holds = parent ? host.condition(rest) : false;
        stack.push({ parent, taken: holds === true, live: parent && holds !== false });
      } else stack.push({ parent, taken: false, live: false, subject: rest });
      continue;
    }
    const top = stack.at(-1);
    if (top && (word === "ELSEIF" || word === "CASE")) {
      const holds = !top.parent || top.taken ? false : word === "ELSEIF" ? host.condition(rest) : caseHolds(top.subject ?? "", rest, host);
      top.live = holds !== false;
      top.taken ||= holds === true;
      continue;
    }
    if (top && (word === "ELSE" || word === "CASEELSE")) { top.live = top.parent && !top.taken; continue; }
    if (word === "ENDIF" || word === "ENDSELECT") { stack.pop(); continue; }
    const skipped = skipNext;
    skipNext = false;
    if (word === "SIF") { skipNext = !live() || host.condition(rest) === false; continue; }
    if (skipped || !live()) continue;
    const print = text.match(PRINT);
    if (!print) continue;
    const command = print[1]!.toUpperCase(), argument = print[2] ?? "";
    const value = /FORM/.test(command) ? (/[%{]|\\@/.test(argument) ? host.format(argument) : argument) : argument;
    if (value === undefined) { flush(); continue; }
    open += value;
    if (!/^PRINT(?:FORM)?[KD]?C?$/.test(command)) flush();
  }
  flush();
  return out;
}
/** Whether a SELECTCASE subject matches a CASE list ("1, 3", "2 TO 5", "IS > 3"). */
function caseHolds(subject: string, list: string, host: VoiceHost): boolean | undefined {
  let any: boolean | undefined = false;
  for (const item of splitTopLevel(list)) {
    const range = item.match(/^(.*?)\s+TO\s+(.*)$/i), is = item.match(/^IS\s*(==|!=|<=|>=|<|>)\s*(.*)$/i);
    const holds = host.condition(range ? `(${subject}) >= (${range[1]}) && (${subject}) <= (${range[2]})`
      : is ? `(${subject}) ${is[1]} (${is[2]})` : `(${subject}) == (${item})`);
    if (holds === true) return true;
    if (holds === undefined) any = undefined;
  }
  return any;
}
function splitTopLevel(list: string): string[] {
  const items: string[] = [];
  let depth = 0, quote = false, start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '"' && list[i - 1] !== "\\") quote = !quote;
    else if (!quote && c === "(") depth++;
    else if (!quote && c === ")") depth--;
    else if (!quote && depth === 0 && c === ",") { items.push(list.slice(start, i).trim()); start = i + 1; }
  }
  items.push(list.slice(start).trim());
  return items.filter(Boolean);
}

/** The character's description and sample lines from the routines of her kojo, chosen the same way each time. */
export function characterVoice(info: Routine | undefined, kojo: Routine[], seed: number, intimate: boolean, host: VoiceHost): CharacterVoice {
  const description = info ? printedLines(info, host).filter((line) => !/^\s*Dialogue v[\d.]/i.test(line)).join("\n").replace(/\n{3,}/g, "\n\n").trim() : "";
  const pools: [Map<string, string[]>, Map<string, string[]>] = [new Map(), new Map()];
  const seen = new Set<string>();
  for (const routine of kojo) {
    const file = intimateRoutine(routine);
    for (const line of printedLines(routine, host)) for (const match of line.matchAll(/「([^「」]+)」/g)) {
      const said = match[1]!.trim();
      if (said.length < 4 || said.length > 160 || !readable(said) || seen.has(said)) continue;
      seen.add(said);
      const pool = pools[file || INTIMATE_LINE.test(said) ? 1 : 0];
      pool.get(routine.name)?.push(said) ?? pool.set(routine.name, [said]);
    }
  }
  const [everyday, sexual] = pools;
  const examples = pick(intimate ? sexual : everyday, EXAMPLES, seed);
  if (examples.length < EXAMPLES) examples.push(...pick(intimate ? everyday : sexual, EXAMPLES - examples.length, seed));
  return { ...(description ? { description } : {}), examples };
}
/** Mostly letters in Latin or Japanese script, not garbled or decorative text. */
function readable(said: string): boolean {
  const letters = said.match(/\p{L}/gu) ?? [];
  return letters.length >= 2 && letters.filter((c) => /[A-Za-z\u3040-\u30ff\u4e00-\u9fff]/.test(c)).length >= letters.length * 0.9;
}
/** Up to count lines, one per routine in turn (in a seeded order) so they cover different situations. */
function pick(pool: Map<string, string[]>, count: number, seed: number): string[] {
  let state = Math.imul(seed, 2654435761) >>> 0 || 1;
  const random = () => (state = Math.imul(state, 1103515245) + 12345 >>> 0) / 4294967296;
  const shuffle = <T>(items: T[]) => { for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [items[i], items[j]] = [items[j]!, items[i]!]; } return items; };
  const groups = shuffle([...pool.keys()].sort()).map((name) => shuffle([...pool.get(name)!]));
  const chosen: string[] = [];
  for (let round = 0; chosen.length < count && groups.some((group) => group.length > round); round++)
    for (const group of groups) if (group[round] !== undefined && chosen.length < count) chosen.push(group[round]!);
  return chosen;
}
