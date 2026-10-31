import { createHash, randomUUID } from "node:crypto";
import { EraError, type Value } from "./model.js";
import { coloredHtml, type ColoredText } from "./html.js";
import type { SaveStore } from "./storage.js";

export interface HistoryCharacter { id: string; name: string; number: string }
export interface InteractionContext {
  day: string;
  time: string[];
  location: string;
  locationName: string;
  affection: string;
  trust: string;
  /** Mark levels by name (pain, pleasure, lewd, hate); absent in events recorded before marks were tracked. */
  marks?: Record<string, string>;
}
export interface Interaction {
  id: string;
  parent: string | null;
  previous: Record<string, string | null>;
  source: "script" | "state";
  target: string;
  action: { id: number | "encounter" | "greeting" | "play-game" | "reaction" | "chat"; label: string };
  participants: HistoryCharacter[];
  before: InteractionContext;
  after: InteractionContext;
  lines: { text: string; character: string | null; runs?: ColoredText[] }[];
  choices: string[];
  truncated: boolean;
}
export interface CharacterHistory {
  character: HistoryCharacter;
  entries: Interaction[];
  notice: string;
  limit: number;
}
interface Host {
  read(name: string, indices?: Value[]): Value;
  write(name: string, indices: Value[], value: Value): void;
  label(command: number): string;
  count(): number;
}
interface Scope {
  capture: boolean;
  /** Captures only this routine's own prints, not those of the routines it calls. */
  direct?: boolean;
  /** SOURCE_CHECK's printout, condensed line by line (see `sourceLine`). */
  source?: { pending: ColoredText[]; group?: { name: string; color: string; changes: string[] } };
  character: HistoryCharacter | null;
  completes?: string;
  penetration?: { index: bigint; flags: bigint[] };
  reset?: bigint;
}
// Unused eraTW CFLAG slots within its existing 10,000-element saved array.
// Boolean pending aftereffects, not ejaculation or first-time-loss markers.
const PENETRATION_V = 7395n;
const PENETRATION_A = 7396n;
const PENETRATION_M = 7397n;
const PENETRATION_FLAGS = [PENETRATION_V, PENETRATION_A, PENETRATION_M];
// Talk, Serve Tea, Ask about Dating; Kiss, Push Down, Confess.
const COMMANDS = new Set([300, 301, 303, 312, 350, 352]);
const MARKS = { pain: 0n, pleasure: 1n, lewd: 2n, hate: 3n };
// SOURCE_CHECK prints each changed parameter as "Fear   0   + 108   =   108" under the character's name.
const SOURCE_ROW = /^(\S.*?)\s+-?\d+\s+([+-])\s*(\d+)\s+=\s+-?\d+$/;
const SOURCE_NOISE = /^(?:-{3,}|(?:STA|ENE|VIG|TSP)[+-]\d+.*)$/;
const LIMIT = 20;
const TEXT_LIMIT = 16_000;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const eventFile = (id: string) => `era-history-event-${id}.json`;
const checkpointFile = (save: string) => `era-history-${save}.json`;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const uuidMap = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.entries(value).every(([key, id]) => uuid(key) && uuid(id));
function context(value: unknown): value is InteractionContext {
  return isRecord(value) && strings(value.time) && value.time.length === 5 && value.time.every((time) => /^-?\d+$/.test(time))
    && ["day", "location", "locationName", "affection", "trust"].every((key) => typeof value[key] === "string")
    && (value.marks === undefined || isRecord(value.marks) && Object.values(value.marks).every((mark) => typeof mark === "string"));
}
function character(value: unknown): value is HistoryCharacter {
  return isRecord(value) && uuid(value.id) && typeof value.name === "string" && typeof value.number === "string";
}
function interaction(value: unknown): value is Interaction {
  if (!isRecord(value)) return false;
  const previous = value.previous;
  return uuid(value.id) && (value.parent === null || uuid(value.parent)) && (value.source === "script" || value.source === "state")
    && isRecord(value.action) && (typeof value.action.id === "number" && COMMANDS.has(value.action.id)
      || value.action.id === "encounter" || value.action.id === "greeting" || value.action.id === "play-game"
      || value.action.id === "reaction" || value.action.id === "chat") && typeof value.action.label === "string"
    && Array.isArray(value.participants) && value.participants.every(character) && uuid(value.target)
    && value.participants.some((person) => person.id === value.target) && context(value.before) && context(value.after)
    && isRecord(previous) && value.participants.every((person) => previous[person.id] === null || uuid(previous[person.id]))
    && Array.isArray(value.lines) && value.lines.every((line) => isRecord(line) && typeof line.text === "string" && (line.character === null || uuid(line.character))
      && (line.runs === undefined || Array.isArray(line.runs) && line.runs.every((run) => isRecord(run) && typeof run.text === "string"
        && typeof run.color === "string" && /^(?:#[0-9a-f]{3}(?:[0-9a-f]{3})?|[a-z]{1,30})$/i.test(run.color))
        && line.runs.map((run) => run.text).join("") === line.text))
    && strings(value.choices) && typeof value.truncated === "boolean";
}
function readJson(store: SaveStore, file: string): unknown {
  const raw = store.read(file);
  if (raw === null) throw new EraError(`Interaction history file is missing: ${file}`);
  try { return JSON.parse(raw.toString()); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new EraError(`Invalid interaction history JSON in ${file}: ${error.message}`);
  }
}

/**
 * eraTW adapter for everyday commands and character meetings, not general screen output.
 * Immutable linked events let save checkpoints share their past without inheriting an abandoned future.
 * All writes use the runtime's staged store, including writes made while prefetching.
 */
export class TwInteractionHistory {
  private ids: string[] = [];
  private head: string | null = null;
  private heads = new Map<string, string>();
  private active: { event: Interaction; size: number } | undefined;
  /**
   * The conversation being held through the chat window. It is written after every line so it shows at once, and is
   * closed (becoming immutable like any other event) by the next input at the command prompt.
   */
  private conversation: Interaction | undefined;
  private scopes: Scope[] = [];
  private notice = "";
  constructor(private store: SaveStore, private host: Host) {}

  reset(): void {
    this.ids = [];
    this.head = null;
    this.heads.clear();
    this.active = undefined;
    this.conversation = undefined;
    this.scopes = [];
    this.notice = "";
  }
  private sync(): void {
    while (this.ids.length < this.host.count()) this.ids.push(randomUUID());
    this.ids.length = this.host.count();
  }
  /** The current registration index of a history character id, or -1 once they have left. */
  indexOf(id: string): number {
    this.sync();
    return this.ids.indexOf(id);
  }
  rearrange(order: number[], copy = false): void {
    this.sync();
    const seen = new Set<number>();
    this.ids = order.map((old, i) => {
      const fresh = copy && (old !== i || seen.has(old));
      seen.add(old);
      return fresh ? randomUUID() : this.ids[old]!;
    });
  }
  private person(index: number): HistoryCharacter | undefined {
    this.sync();
    const id = this.ids[index];
    if (!id) return undefined;
    return { id, name: String(this.host.read("CALLNAME", [BigInt(index)]) || this.host.read("NAME", [BigInt(index)])),
      number: String(this.host.read("NO", [BigInt(index)])) };
  }
  private state(index: number, characterLocation = false): InteractionContext {
    const location = this.host.read("CFLAG", [characterLocation ? BigInt(index) : this.host.read("MASTER"), "現在位置"]);
    return {
      day: String(this.host.read("DAY")),
      time: [0n, 1n, 2n, 3n, 4n].map((i) => String(this.host.read("TIME", [i]))),
      location: String(location),
      locationName: String(this.host.read("STR", [8000n + BigInt(location)])),
      affection: String(this.host.read("CFLAG", [BigInt(index), "好感度"])),
      trust: String(this.host.read("CFLAG", [BigInt(index), "信頼度"])),
      marks: Object.fromEntries(Object.entries(MARKS).map(([name, mark]) => [name, String(this.host.read("MARK", [BigInt(index), mark]))])),
    };
  }
  private begin(target: number, action: Interaction["action"]): string | undefined {
    const master = Number(this.host.read("MASTER"));
    const player = this.person(master), selected = this.person(target);
    if (!player || !selected || target === master) return;
    const before = this.state(target);
    this.active = { size: 0, event: {
      id: randomUUID(), parent: this.head, previous: {}, source: "script", target: selected.id,
      action, participants: [player, selected], before, after: before, lines: [], choices: [], truncated: false,
    } };
    return this.active.event.id;
  }
  private penetrationFlags(index: bigint): bigint[] {
    if (this.host.read("FLAG", [70n]) !== 1n || this.host.read("ADD_TEMPTOUCHMODE") !== 0n) return [];
    const flags = new Set<bigint>();
    // SOURCE_EXP runs only after SOURCE_CHECK accepts the action. Its current
    // touch graph includes every recipient, unlike TARGET or command numbers.
    for (let touch = 0n; touch < BigInt(this.host.read("ADD_MAXTOUCH")); touch++) {
      if (this.host.read("ADD_TOUCH_ACTIVE", [touch]) === 0n) break;
      if (this.host.read("ADD_TOUCH_HISTORY", [touch]) !== 0n) continue;
      const actor = this.host.read("ADD_TOUCH_ACTOR", [touch]);
      const target = this.host.read("ADD_TOUCH_TARGET", [touch]);
      const actorPart = this.host.read("ADD_TOUCH_ACTOR_PART", [touch]);
      const targetPart = this.host.read("ADD_TOUCH_TARGET_PART", [touch]);
      // SET_P = 1; contacts may be stored in either direction.
      const part = target === index && actorPart === 1n ? targetPart
        : actor === index && targetPart === 1n ? actorPart : 0n;
      // SET_V = 6, SET_A = 7, SET_M = 4. Fingers/kisses are not penetration.
      if (part === 6n) flags.add(PENETRATION_V);
      else if (part === 7n) flags.add(PENETRATION_A);
      else if (part === 4n) flags.add(PENETRATION_M);
    }
    return [...flags];
  }
  private timeResumeNotices(index: bigint): string[] {
    const notices: string[] = [];
    // eraTW CSV field IDs; read pending reactions before TRANSLATION/BUGFIX.ERB's
    // TIMESTOP_RESET clears them. Hidden causes must not enter the character's log.
    // EX 50-54: unaware C/V/A/B/M orgasm counters, used for reaction intensity.
    const pleasure = [50n, 51n, 52n, 53n, 54n].reduce((sum, field) =>
      sum + BigInt(this.host.read("EX", [index, field])), 0n);
    if (pleasure > 30n) notices.push("experiences a sudden, intense wave of unexplained sexual pleasure.");
    else if (pleasure > 0n) notices.push("experiences a sudden feeling of unexplained sexual pleasure.");
    // CFLAG 291: no underwear; 295 = 2: she has not yet noticed it missing.
    if (this.host.read("CFLAG", [index, 291n]) === 1n && this.host.read("CFLAG", [index, 295n]) === 2n)
      notices.push("notices that her underwear is suddenly missing.");
    // EX 70: pending virginity loss (1) or restored-virginity loss (2).
    const virginity = this.host.read("EX", [index, 70n]);
    if (virginity !== 0n) notices.push("winces from a sudden pain between her legs.");
    // Substance recognition: TALENT 27 = sexual ignorance; EXP 14 = semen experience.
    // Match eraTW's knowledge rule; EXP 25 (oral experience) also allows oral recognition.
    const familiar = this.host.read("TALENT", [index, 27n]) === 0n
      || BigInt(this.host.read("EXP", [index, 14n])) >= 100n;
    const oralFamiliar = familiar || BigInt(this.host.read("EXP", [index, 25n])) > 0n;
    // CFLAG 286-290 = 2: unperceived ejaculation, pending a reaction at each location.
    if (this.host.read("CFLAG", [index, PENETRATION_V]) !== 0n
      || this.host.read("CFLAG", [index, 286n]) === 2n) { // 286: vaginal ejaculation.
      // Recent first-time loss takes precedence over familiarity.
      if (virginity === 1n)
        notices.push("feels sudden pain and discomfort inside her vagina, unsure what has happened.");
      // EXP 1: conscious vaginal experience; TALENT 0 = -1: unaware non-virgin.
      else if (this.host.read("TALENT", [index, 0n]) !== -1n && BigInt(this.host.read("EXP", [index, 1n])) > 0n)
        notices.push("feels sudden discomfort inside her vagina, similar to having sexual intercourse.");
      // EXP 61: unaware vaginal experience suggests recurrence, not knowledge of its cause.
      else if (BigInt(this.host.read("EXP", [index, 61n])) > 0n)
        notices.push("again feels a sudden discomfort inside her vagina.");
      else
        notices.push("feels sudden discomfort inside her vagina, unable to tell what is wrong.");
    }
    if (this.host.read("CFLAG", [index, PENETRATION_A]) !== 0n
      || this.host.read("CFLAG", [index, 287n]) === 2n) { // 287: anal ejaculation.
      // EXP 2: conscious anal experience allows recognition of the sensation.
      if (BigInt(this.host.read("EXP", [index, 2n])) > 0n)
        notices.push("feels the sudden unexpected discomfort in her bottom similar to having anal intercourse.");
      // EXP 62: unaware anal experience suggests recurrence without recognizing the cause.
      else if (BigInt(this.host.read("EXP", [index, 62n])) > 0n)
        notices.push("again feels a sudden discomfort inside her bottom");
      else
        notices.push("feels sudden discomfort inside her bottom, unsure what is causing it.");
    }
    if (this.host.read("CFLAG", [index, PENETRATION_M]) !== 0n) {
      if (BigInt(this.host.read("EXP", [index, 25n])) > 0n)
        notices.push("feels sudden soreness inside her mouth, similar to the aftermath of oral sex.");
      else
        notices.push("feels sudden soreness inside her mouth, unsure what is causing it.");
    }
    if (this.host.read("CFLAG", [index, 288n]) === 2n) { // 288: mouth ejaculation, not penetration.
      if (oralFamiliar)
        notices.push("notices the sudden unexpected taste of semen in her mouth.");
      else
        notices.push("suddenly finds something unexpected in her mouth, unsure what it is.");
    }
    if (this.host.read("CFLAG", [index, 289n]) === 2n) { // 289: face.
      if (familiar)
        notices.push("notices the sudden unexplained presence of semen on her face.");
      else
        notices.push("notices something unexpected on her face, unsure what it is.");
    }
    if (this.host.read("CFLAG", [index, 290n]) === 2n) { // 290: hand.
      if (familiar)
        notices.push("notices the sudden unexplained presence of semen on her hand.");
      else
        notices.push("notices something unexpected on her hand, unsure what it is.");
    }
    return notices;
  }
  enter(name: string, args: readonly (Value | object | undefined)[]): Scope {
    if (name === "SHOW_STATUS") this.finish();
    let reaction: string | undefined;
    const notices = name === "TIMESTOP_RESET" && typeof args[0] === "bigint" ? this.timeResumeNotices(args[0]) : [];
    if (notices.length && typeof args[0] === "bigint") {
      this.finish();
      reaction = this.begin(Number(args[0]), { id: "reaction", label: "Reaction" });
      if (this.active) {
        const event = this.active.event;
        const person = event.participants.find((person) => person.id === event.target)!;
        event.source = "state";
        event.before = this.state(Number(args[0]), true);
        event.lines.push({ character: person.id, text: notices.map((notice) => `${person.name} ${notice}`).join("\n") });
      }
    }
    const command = /^COM(\d+)$/.exec(name);
    if (command && COMMANDS.has(Number(command[1])) && !this.active) {
      this.begin(Number(this.host.read("TARGET")), { id: Number(command[1]), label: this.host.label(Number(command[1])) });
    }
    const game = /^ADD_GAME\d+$/.test(name);
    if (game && !this.active)
      this.begin(Number(this.host.read("TARGET")), { id: "play-game", label: "Play a game" });
    if (game && this.active?.event.action.id === "play-game") {
      const count = Number(this.host.read("ADD_GAME_PARTICIPANT_COUNT"));
      for (let i = 0; i < count; i++) {
        const person = this.person(Number(this.host.read("ADD_GAME_PARTICIPANTS", [BigInt(i)])));
        if (person && !this.active.event.participants.some((existing) => existing.id === person.id))
          this.active.event.participants.push(person);
      }
    }
    const meeting = name === "AFFAIR_DISCLOSURE" || name === "SYOTAIMEN" || name === "FIRSTMEETTODAY";
    const encounter = name === "KOJO_MESSAGE_SEND" && args[0] === "ENCOUNTER";
    const owner = meeting || name === "COM_KOJO_CALL" ? args[0] : name === "KOJO_MESSAGE_SEND" ? args[2] : undefined;
    let completes = reaction;
    if ((meeting || encounter) && typeof owner === "bigint" && !this.active) {
      completes = this.begin(Number(owner), name === "FIRSTMEETTODAY" ? { id: "greeting", label: "Daily greeting" }
        : { id: "encounter", label: name === "SYOTAIMEN" ? "First meeting" : "Meeting" });
    }
    if (name === "SYOTAIMEN" && this.active?.event.action.id === "encounter")
      this.active.event.action.label = "First meeting";
    const previous = this.scopes.at(-1);
    const scope: Scope = {
      ...(name === "EVENTCOMEND" ? { direct: true } : {}),
      ...(name === "SOURCE_CHECK" ? { source: { pending: [] } } : {}),
      capture: !!command && COMMANDS.has(Number(command[1])) || game || name.startsWith("ADD_GAME_BET_")
        || meeting || name === "KOJO_MESSAGE_SEND"
        || name === "COM_KOJO_CALL" || !!previous?.capture,
      character: previous?.character ?? null,
      ...(completes ? { completes } : {}),
      ...(name === "SOURCE_EXP" && typeof args[0] === "bigint"
        ? { penetration: { index: args[0], flags: this.penetrationFlags(args[0]) } } : {}),
      ...(name === "TIMESTOP_RESET" && typeof args[0] === "bigint" ? { reset: args[0] } : {}),
    };
    // These routines identify a character's scene, not necessarily the literal speaker of every line.
    if (this.active && typeof owner === "bigint") {
      const person = this.person(Number(owner));
      if (person) scope.character = person;
    }
    this.scopes.push(scope);
    return scope;
  }
  leave(scope: Scope, success: boolean): void {
    // RESETDATA/LOADDATA may have discarded the old routine stack.
    if (scope.source) this.flushSource(scope);
    if (this.scopes.at(-1) === scope) this.scopes.pop();
    if (!success) this.active = undefined;
    else {
      if (scope.penetration)
        for (const flag of scope.penetration.flags)
          this.host.write("CFLAG", [scope.penetration.index, flag], 1n);
      if (scope.reset !== undefined)
        for (const flag of PENETRATION_FLAGS) this.host.write("CFLAG", [scope.reset, flag], 0n);
      if (scope.completes === this.active?.event.id) this.finish();
    }
  }
  output(type: string, value: string, newline: boolean, color: string): void {
    const scope = this.scopes.at(-1);
    if (!this.active || !scope || (type !== "text" && type !== "html")) return;
    if (!scope.capture && !scope.direct && !scope.source) return;
    if (type === "html" && /<(?:button|era-open|era-close)\b/i.test(value)) return;
    const rendered = type === "html" ? coloredHtml(value, color) : [{ text: value, color }];
    if (newline) rendered.push({ text: "\n", color });
    if (scope.source && !scope.capture) return this.source(scope, rendered);
    this.append(rendered);
  }
  /** Condenses SOURCE_CHECK's printout: its parameter table becomes "Name: Fear +108, Hostility +432". */
  private source(scope: Scope, runs: ColoredText[]): void {
    const source = scope.source!;
    source.pending.push(...runs);
    for (;;) {
      const text = source.pending.map((run) => run.text).join("");
      const end = text.indexOf("\n");
      if (end < 0) return;
      const line: ColoredText[] = [];
      let offset = 0;
      for (const run of source.pending) {
        const part = run.text.slice(Math.max(0, -offset), Math.max(0, end - offset));
        offset += run.text.length;
        if (part) line.push({ text: part, color: run.color });
      }
      source.pending = [{ text: text.slice(end + 1), color: source.pending.at(-1)!.color }];
      this.sourceLine(scope, line);
    }
  }
  private sourceLine(scope: Scope, runs: ColoredText[]): void {
    const source = scope.source!;
    const text = runs.map((run) => run.text).join("").trim();
    const row = SOURCE_ROW.exec(text);
    if (row && source.group) {
      if (row[3] !== "0") source.group.changes.push(`${row[1]} ${row[2]}${row[3]}`);
      return;
    }
    this.flushGroup(scope);
    if (!text || SOURCE_NOISE.test(text)) return;
    this.sync();
    if (this.ids.some((_, i) => this.person(i)?.name === text)) {
      source.group = { name: text, color: runs[0]?.color ?? "", changes: [] };
      return;
    }
    this.append([...runs, { text: "\n", color: runs.at(-1)?.color ?? "" }]);
  }
  private flushGroup(scope: Scope): void {
    const group = scope.source?.group;
    if (!group) return;
    delete scope.source!.group;
    if (group.changes.length) this.append([{ text: `${group.name}: ${group.changes.join(", ")}\n`, color: group.color }]);
  }
  private flushSource(scope: Scope): void {
    const pending = scope.source!.pending.map((run) => run.text).join("");
    if (pending.trim()) this.sourceLine(scope, scope.source!.pending);
    scope.source!.pending = [];
    this.flushGroup(scope);
  }
  private append(rendered: ColoredText[]): void {
    if (!this.active) return;
    const available = TEXT_LIMIT - this.active.size;
    let remaining = available;
    const runs: ColoredText[] = [];
    for (const run of rendered) {
      const text = run.text.slice(0, remaining);
      if (text.length < run.text.length) this.active.event.truncated = true;
      if (text) runs.push({ text, color: run.color });
      remaining -= text.length;
    }
    const text = runs.map((run) => run.text).join("");
    this.active.size += text.length;
    if (!text) return;
    const lines = this.active.event.lines, participants = this.active.event.participants;
    let owner = this.scopes.at(-1)?.character ?? null;
    if (owner && !participants.some((person) => person.id === owner?.id)) {
      if (text.trim()) participants.push(owner);
      else owner = null;
    }
    const character = owner?.id ?? null;
    const last = lines.at(-1);
    if (last && last.character === character) {
      last.text += text;
      for (const run of runs) {
        const previous = last.runs?.at(-1);
        if (previous?.color === run.color) previous.text += run.text;
        else (last.runs ??= []).push(run);
      }
    } else lines.push({ text, character, runs });
  }
  choice(value: string): void {
    if (!this.active) return;
    const remaining = TEXT_LIMIT - this.active.size;
    const text = value.slice(0, remaining);
    if (text.length < value.length) this.active.event.truncated = true;
    if (text) this.active.event.choices.push(text);
    this.active.size += text.length;
  }
  finish(): void {
    if (!this.active) return;
    const { event } = this.active;
    if (typeof event.action.id === "string" && !event.lines.some((line) => line.text.trim())) {
      this.active = undefined;
      return;
    }
    const target = this.ids.indexOf(event.target);
    if (target < 0) throw new EraError("Interaction history target was removed during an interaction");
    event.after = this.state(target, event.action.id === "reaction");
    event.previous = Object.fromEntries(event.participants.map((person) => [person.id, this.heads.get(person.id) ?? null]));
    this.store.write(eventFile(event.id), JSON.stringify({ version: 1, event }));
    this.head = event.id;
    for (const person of event.participants) this.heads.set(person.id, event.id);
    this.active = undefined;
  }
  cancel(): void { this.active = undefined; }
  /** Adds a line to the conversation with a character (by history id), starting one if needed. */
  chat(character: string, line: { runs: ColoredText[]; speaker: string | null }): void {
    const target = this.indexOf(character);
    if (target < 0) throw new EraError("That character is no longer in the game");
    if (this.conversation?.target !== character) {
      this.endChat();
      const master = Number(this.host.read("MASTER"));
      const player = this.person(master), selected = this.person(target);
      if (!player || !selected || target === master) throw new EraError("Only the player can talk with this character");
      const before = this.state(target);
      this.conversation = { id: randomUUID(), parent: this.head, source: "script", target: character,
        previous: { [player.id]: this.heads.get(player.id) ?? null, [selected.id]: this.heads.get(selected.id) ?? null },
        action: { id: "chat", label: "Conversation" }, participants: [player, selected], before, after: before,
        lines: [], choices: [], truncated: false };
    }
    const event = this.conversation;
    const runs = line.runs.filter((run) => run.text);
    const text = runs.map((run) => run.text).join("");
    if (!text) return;
    if (event.lines.reduce((size, item) => size + item.text.length, 0) + text.length > TEXT_LIMIT) {
      event.truncated = true;
      return;
    }
    event.lines.push({ text, character: line.speaker, runs });
    event.after = this.state(target);
    this.writeChat();
  }
  /** Removes the last `count` lines of the newest conversation (for trying a message again); an emptied one is dropped. */
  unchat(character: string, count: number): void {
    const event = this.conversation?.target === character ? this.conversation : undefined;
    if (!event) throw new EraError("There is no conversation to take back");
    event.lines.splice(Math.max(0, event.lines.length - count));
    if (event.lines.length) return this.writeChat();
    // Nothing is left: the history goes back to where it was before the conversation started.
    this.conversation = undefined;
    this.head = event.parent;
    for (const [id, previous] of Object.entries(event.previous))
      if (previous) this.heads.set(id, previous); else this.heads.delete(id);
  }
  endChat(): void { this.conversation = undefined; }
  /** Whether a conversation through the chat window is open (no command has been entered since it started). */
  get chatting(): boolean { return this.conversation !== undefined; }
  private writeChat(): void {
    const event = this.conversation!;
    this.store.write(eventFile(event.id), JSON.stringify({ version: 1, event }));
    this.head = event.id;
    for (const person of event.participants) this.heads.set(person.id, event.id);
  }
  /** The character's whole history as it stands now, including a conversation in progress. */
  current(selected: HistoryCharacter): CharacterHistory {
    return this.forCharacter(selected, this.heads.get(selected.id) ?? null);
  }
  checkpoint(save: string, bytes: Buffer): void {
    this.sync();
    this.store.write(checkpointFile(save), JSON.stringify({
      version: 1, digest: digest(bytes), head: this.head, ids: this.ids, heads: Object.fromEntries(this.heads),
    }));
  }
  restore(save: string, bytes: Buffer): void {
    this.reset();
    const file = checkpointFile(save);
    if (this.store.read(file) === null) {
      this.notice = "This save predates interaction logging. Earlier interactions are unavailable.";
      return;
    }
    const data = readJson(this.store, file);
    if (!isRecord(data) || data.version !== 1 || typeof data.digest !== "string" || (data.head !== null && !uuid(data.head))
      || !Array.isArray(data.ids) || !data.ids.every(uuid) || new Set(data.ids).size !== data.ids.length
      || !uuidMap(data.heads))
      throw new EraError(`Invalid interaction history checkpoint: ${file}`);
    if (data.digest !== digest(bytes) || data.ids.length !== this.host.count()) {
      this.notice = "This save was replaced outside the app. Its previous interaction history was not attached.";
      return;
    }
    this.head = data.head;
    this.ids = data.ids;
    this.heads = new Map(Object.entries(data.heads));
  }
  remove(save: string): void { this.store.remove(checkpointFile(save)); }
  selected(): CharacterHistory | undefined {
    const selected = this.person(Number(this.host.read("TARGET")));
    if (!selected || this.host.read("TARGET") === this.host.read("MASTER")) return undefined;
    return this.forCharacter(selected, this.heads.get(selected.id) ?? null, LIMIT);
  }
  forCharacter(selected: HistoryCharacter, head: string | null, limit = Infinity): CharacterHistory {
    const entries: Interaction[] = [], seen = new Set<string>();
    let id = head;
    while (id && entries.length < limit) {
      if (seen.has(id)) throw new EraError("Interaction history contains a cycle");
      seen.add(id);
      const data = readJson(this.store, eventFile(id));
      if (!isRecord(data) || data.version !== 1 || !interaction(data.event) || data.event.id !== id)
        throw new EraError(`Invalid interaction history event: ${eventFile(id)}`);
      if (!data.event.participants.some((item) => item.id === selected.id))
        throw new EraError(`Interaction history index does not match character: ${id}`);
      entries.push(data.event);
      id = data.event.previous[selected.id]!;
    }
    return { character: selected, entries, notice: this.notice, limit: Number.isFinite(limit) ? limit : entries.length };
  }
}
