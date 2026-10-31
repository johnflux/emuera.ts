import type { CharacterVoice } from "./character-voice.js";
import { EraError, type Value } from "./model.js";

/** What the tools need from the running game: eraTW variables and #FUNCTION routines. */
export interface ToolHost {
  read(name: string, indices?: Value[]): Value;
  write(name: string, indices: Value[], value: Value): void;
  call(name: string, args: Value[]): Value;
  /** Runs a procedure (not an expression function) for its effect on variables. */
  run(name: string, args: Value[]): void;
  has(name: string): boolean;
  count(): number;
  /** In-world actions already queued this turn, so later calls see their effect (e.g. a move before a line). */
  queued(): readonly CharacterAction[];
  /** How the character talks (her kojo's description and sample lines), for intimate scenes or everyday ones. */
  voice?(intimate: boolean): CharacterVoice;
}
/** Effects that print to the room, so they run on the game's own screen once the chat window is closed. */
export type CharacterAction =
  | { kind: "say"; character: string; text: string }
  | { kind: "act"; character: string; text: string }
  | { kind: "move"; character: string; destination: number }
  /** A TRAIN command run as if the player had typed its number, e.g. Kiss (312). */
  | { kind: "command"; character: string; command: number };
export interface ToolOutcome {
  result: Record<string, unknown>;
  action?: { kind: "say" | "act"; text: string } | { kind: "move"; destination: number } | { kind: "command"; command: number };
  /** Whether game state or the room will change, so the main screen needs redrawing afterwards. */
  changed: boolean;
}

/** Per-call limits, roughly the largest change a single player command makes. */
export const TOOL_LIMITS = { favor: 50, trust: 10, affinity: 10, mood: 300, anger: 300, mark: 1 } as const;
const MARKS = { pain: 0, pleasure: 1, lewd: 2, hate: 3 } as const;
const OLD_HATE = 4, MARK_MAX = 3, FAVOR_MAX = 1_000_000, TRUST_MAX = 999_999;
const LOVE = [3, 7, 8, 184];
const FIND_LIMIT = 25;
/** CFLAG 既成事実 bits: 1 has agreed to sex before, 2 kisses are always welcome. */
const AGREED_SEX = 1, AGREED_KISS = 2;
const KISS = 312n;
/** The player's commands for each intimate activity: Kiss, Push Down (whose first step asks for consent) and Confess. */
const COMMANDS: Record<string, number> = { kiss: 312, sex: 350, become_lovers: 352 };
const ACTIVITIES = Object.keys(COMMANDS);
/** What the player can try through player_attempts: the intimate commands and Apologize (303), whose own rules decide
 * whether words calm the character's anger and whether a gift box (菓子折り) removes a first hate mark. */
const ATTEMPTS: Record<string, number> = { ...COMMANDS, apologize: 303 };
/** TRAIN.CSV ids below this are the commands of an intimate scene (caressing, positions, toys and so on). */
const SCENE_COMMANDS = 200;
/** USERCOM's "end the affair" input. */
const END_SCENE = 999;
/** TEQUIP 101-108 hold which of the player's parts touches each of the character's (TOUCH_SET's numbering). */
const PARTS = ["", "penis", "clitoris", "fingers", "mouth", "breasts", "vagina", "anus", "feet"];
const AROUSAL = { clitoris: "快Ｃ", vagina: "快Ｖ", anus: "快Ａ", breasts: "快Ｂ", wetness: "潤滑", lust: "欲情", submission: "屈服", shame: "恥情", pain: "苦痛", fear: "恐怖", disgust: "反感" } as const;
const ORGASMS = { clitoral: "Ｃ絶頂", vaginal: "Ｖ絶頂", anal: "Ａ絶頂", breast: "Ｂ絶頂", oral: "Ｍ絶頂" } as const;
const CATEGORIES = ["RACE", "SEXUAL", "PHYSICAL", "MENTAL", "PRACTICAL", "OTHER"];

class ToolError extends Error {}

export function runCharacterTool(host: ToolHost, self: number, id: string, name: string, args: Record<string, unknown>): ToolOutcome {
  try {
    const tools = new CharacterTools(host, self, id);
    switch (name) {
      case "get_character_info": return tools.info(args);
      case "find_characters": return tools.find(args);
      case "change_feelings": return tools.feelings(args);
      case "change_mark": return tools.mark(args);
      case "change_mood": return tools.mood(args);
      case "check_consent": return tools.consent(args);
      case "player_attempts": return tools.attempt(args);
      case "scene_action": return tools.sceneAction(args);
      case "end_scene": return tools.endScene();
      case "say": return tools.say(args);
      case "act": return tools.act(args);
      case "move_to": return tools.move(args);
      case "push_down_player": return tools.pushDown();
      case "describe_scene": return tools.scene();
      default: throw new ToolError(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof ToolError || error instanceof EraError) return { result: { error: error.message }, changed: false };
    throw error;
  }
}

class CharacterTools {
  private master: number;
  constructor(private host: ToolHost, private self: number, private id: string) {
    this.master = Number(host.read("MASTER"));
  }
  private num(name: string, ...indices: Value[]): number { return Number(this.host.read(name, indices)); }
  private str(name: string, ...indices: Value[]): string { return String(this.host.read(name, indices)); }
  private name(i: number): string { return this.str("CALLNAME", BigInt(i)) || this.str("NAME", BigInt(i)); }
  private call(name: string, ...args: Value[]): string {
    if (!this.host.has(name)) return "";
    try { return String(this.host.call(name, args)); }
    catch (error) { if (error instanceof EraError) return ""; throw error; }
  }
  private place(location: number): string { return this.call("NAME_FROM_PLACE", BigInt(location)) || this.str("STR", BigInt(8000 + location)); }
  /** Where a character will be once queued moves have run. */
  private location(i: number): number {
    const moves = i === this.self ? this.host.queued().filter((action) => action.kind === "move" && action.character === this.id) : [];
    const last = moves.at(-1);
    return last?.kind === "move" ? last.destination : this.num("CFLAG", BigInt(i), "現在位置");
  }
  private together(i: number): boolean { return this.location(i) === this.location(this.master); }
  private asleep(i: number): boolean { return this.num("CFLAG", BigInt(i), "睡眠") !== 0; }
  private integer(value: unknown, field: string, limit: number): number {
    if (value === undefined || value === null) return 0;
    const n = typeof value === "string" ? Number(value.trim()) : value;
    if (typeof n !== "number" || !Number.isFinite(n)) throw new ToolError(`${field} must be a number`);
    return Math.max(-limit, Math.min(limit, Math.round(n)));
  }
  /** Accepts "self"/"player", a name, or a character registration index. */
  private character(value: unknown, fallback = this.self): number {
    if (value === undefined || value === null || value === "") return fallback;
    const count = this.host.count();
    if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value.trim()))) {
      const i = Number(value);
      if (!Number.isSafeInteger(i) || i < 0 || i >= count) throw new ToolError(`No character has id ${String(value)}`);
      return i;
    }
    if (typeof value !== "string") throw new ToolError("character must be a name or id");
    const wanted = value.trim().toLowerCase();
    if (["self", "me", "myself", "yourself"].includes(wanted)) return this.self;
    if (["player", "you", "master", "the player"].includes(wanted)) return this.master;
    const exact: number[] = [], partial: number[] = [];
    for (let i = 0; i < count; i++) {
      const names = [this.str("CALLNAME", BigInt(i)), this.str("NAME", BigInt(i))].map((item) => item.toLowerCase()).filter(Boolean);
      if (names.includes(wanted)) exact.push(i);
      else if (names.some((item) => item.split(/[\s・]+/).includes(wanted) || (wanted.length >= 3 && item.includes(wanted)))) partial.push(i);
    }
    const found = exact.length ? exact : partial;
    if (found.length === 1) return found[0]!;
    if (!found.length) throw new ToolError(`No character is called ${JSON.stringify(value)}`);
    throw new ToolError(`${JSON.stringify(value)} could mean ${found.slice(0, 8).map((i) => this.str("NAME", BigInt(i))).join(", ")}; use the full name`);
  }
  private talents(i: number, category: string): string[] {
    return this.call("GET_CHARA_TALENT_BY_CATEGORY_TR", BigInt(i), category).split("＠").map((item) => item.trim()).filter(Boolean);
  }
  /** TALENT 性別 bits: 1 female, 2 male, both futanari. */
  private sexBits(i: number): number { return this.num("TALENT", BigInt(i), "性別"); }
  private sex(i: number): string { return ["", "female", "male", "futanari"][this.sexBits(i) & 3] || "unknown"; }
  private race(i: number): string { return this.talents(i, "RACE").join(", "); }
  /** Every non-race talent in one list, without virginity entries for organs the character lacks. */
  private traits(i: number): string[] {
    const bits = this.sexBits(i);
    return CATEGORIES.slice(1).flatMap((category) => this.talents(i, category))
      .filter((talent) => !(talent.endsWith("♂") && !(bits & 2)) && !(talent.endsWith("♀") && !(bits & 1)) && !/^(male|female|futanari)$/i.test(talent));
  }
  private loveTalents(i: number): string[] {
    return LOVE.filter((talent) => this.num("TALENT", BigInt(i), BigInt(talent)) !== 0)
      .map((talent) => this.call("TALENT_TR", BigInt(talent)) || String(talent));
  }
  private marks(i: number): Record<string, number> {
    return Object.fromEntries(Object.entries(MARKS).map(([key, mark]) => [key, this.num("MARK", BigInt(i), BigInt(mark))]));
  }
  /** RELATION is a percentage multiplier keyed by character NO; eraTW treats an unset 0 as the neutral 100. */
  private affinity(from: number, to: number): number {
    const value = this.num("RELATION", BigInt(from), this.host.read("NO", [BigInt(to)]));
    return value === 0 ? 100 : value;
  }
  private towardPlayer(i: number): Record<string, unknown> {
    const marks = Object.fromEntries(Object.entries(this.marks(i)).filter(([, level]) => level));
    const love = this.loveTalents(i);
    return { favor: this.num("CFLAG", BigInt(i), "好感度"), trust: this.num("CFLAG", BigInt(i), "信頼度"),
      ...(love.length ? { love } : {}), ...(Object.keys(marks).length ? { marks } : {}) };
  }
  /** eraTW parks characters who are not on any map in the Gap (SUKIMA). */
  private whereabouts(i: number): string {
    const location = this.location(i);
    return location === Number(this.call("SUKIMA") || NaN) ? "away (not on this map)" : this.place(location);
  }
  /** Where the character lives, as eraTW's detailed info shows it; residents of the player's map have a room there. */
  private home(i: number): string {
    const resident = this.num("CFLAG", BigInt(i), "神社在住"), home = this.num("CFLAG", BigInt(i), "自宅位置");
    const mainMap = this.num("MAIN_MAP");
    if (resident) return `${this.call("STR_TR", BigInt((mainMap ? 8000 : 0) + resident))} (${this.call("GET_MAPNAME", BigInt(mainMap))} area)`;
    const name = home ? this.call("STR_TR", BigInt(Math.floor(home / 10) + 6000)) : "";
    return name ? `${name} (${this.call("GET_MAPNAME", BigInt(Number(this.call("GET_MAPID", BigInt(home))) || 0))} area)` : "unknown";
  }
  /** "value/max" for a BASE gauge. */
  private gauge(i: number, base: string): string { return `${this.num("BASE", BigInt(i), base)}/${this.num("MAXBASE", BigInt(i), base)}`; }
  /** One line per character: who they are and, from this character's point of view, how they relate. */
  private line(i: number): string {
    const tags = [this.race(i), this.sex(i), i === this.self ? "me" : "", i === this.master ? "the player" : "", this.asleep(i) ? "asleep" : ""];
    if (i === this.master) {
      const { favor, trust, love, marks } = this.towardPlayer(this.self) as { favor: number; trust: number; love?: string[]; marks?: Record<string, number> };
      tags.push(`my favor ${favor}`, `my trust ${trust}`, ...(love ?? []), ...Object.entries(marks ?? {}).map(([mark, level]) => `my ${mark} mark ${level}`));
    } else if (i !== this.self) {
      const affinity = this.affinity(this.self, i);
      if (affinity !== 100) tags.push(`my affinity ${affinity}%`);
    }
    return `${this.str("NAME", BigInt(i))} (${tags.filter(Boolean).join(", ")})`;
  }

  info(args: Record<string, unknown>): ToolOutcome {
    const i = this.character(args.character);
    const fullName = this.str("NAME", BigInt(i)), name = this.name(i);
    const profile = Object.fromEntries([["workplace", 2], ["schedule", 3], ["profile", 10]]
      .map(([key, index]) => [key, this.str("CSTR", BigInt(i), BigInt(index as number))]).filter(([, value]) => value));
    const result: Record<string, unknown> = { name, ...(fullName && fullName !== name ? { fullName } : {}),
      ...(i === this.master ? { isPlayer: true } : {}), sex: this.sex(i), race: this.race(i), traits: this.traits(i),
      location: this.whereabouts(i), home: this.home(i), ...(this.asleep(i) ? { asleep: true } : {}), ...profile };
    if (i !== this.master) Object.assign(result, { romanticMood: this.gauge(i, "ムード"), anger: this.gauge(i, "怒り"), feelingsTowardPlayer: this.towardPlayer(i) });
    if (i !== this.self && i !== this.master) Object.assign(result, { myAffinityForThem: this.affinity(this.self, i), theirAffinityForMe: this.affinity(i, this.self) });
    return { result, changed: false };
  }
  /** Characters whose name, race, traits, home or location contain any of the "|"-separated words. */
  find(args: Record<string, unknown>): ToolOutcome {
    const terms = typeof args.query === "string" ? args.query.split("|").map((term) => term.trim().toLowerCase()).filter(Boolean) : [];
    if (!terms.length) throw new ToolError("query is required, e.g. \"fairy|fairies\"");
    const matches: string[] = [];
    for (let i = 0; i < this.host.count(); i++) {
      const home = this.home(i), location = this.whereabouts(i);
      const text = [this.str("NAME", BigInt(i)), this.str("CALLNAME", BigInt(i)), this.race(i), ...this.traits(i), home, location].join("\n").toLowerCase();
      if (terms.some((term) => text.includes(term))) matches.push(`${this.line(i)}: lives at ${home}; now ${location}`);
    }
    return { result: matches.length ? { found: matches.length, characters: matches.slice(0, FIND_LIMIT) } : { found: 0 }, changed: false };
  }
  /** What the character can see without asking: the time, the room, who is here, and where they could go. */
  scene(): ToolOutcome {
    const time = this.num("TIME"), date = this.call("PRINT_DATE_F", this.host.read("DAY"), 1n);
    const present: string[] = [];
    for (let i = 0; i < this.host.count(); i++) if (i !== this.self && i !== this.master && this.together(i)) present.push(this.line(i));
    return { result: {
      time: `${String(Math.floor(time / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}${date ? `, ${date}` : ""}`,
      me: this.info({}).result, player: this.info({ character: "player" }).result,
      othersHere: present.length ? present : "nobody else", placesOnThisMap: [...new Set(this.places().map((place) => place.name))],
      ...(this.inScene() ? { intimateScene: this.intimate() } : {}),
      ...this.voice(),
    }, changed: false };
  }
  /** The character's voice from her kojo, if it has anything to say about it. */
  private voice(): { voice?: CharacterVoice } {
    const voice = this.host.voice?.(this.inScene());
    return voice && (voice.description || voice.examples.length) ? { voice } : {};
  }
  /** Whether the character is in an intimate scene (eraTW's うふふ) with the player. */
  private inScene(): boolean {
    return this.num("CFLAG", BigInt(this.self), "うふふ") !== 0 && this.together(this.self) && !this.asleep(this.self);
  }
  /** The scene commands the player could choose now, as the command menu offers them (COM_ABLE{n}). */
  private sceneCommands(): { id: number; name: string }[] {
    const commands: { id: number; name: string }[] = [];
    for (let id = 0; id < SCENE_COMMANDS; id++) {
      if (!this.host.has(`COM_ABLE${id}`)) continue;
      try { this.host.run(`COM_ABLE${id}`, []); } catch (error) { if (error instanceof EraError) continue; throw error; }
      if (!Number(this.host.read("RESULT"))) continue;
      const name = this.call("TRAINNAME_TR", BigInt(id)).trim();
      if (name) commands.push({ id, name });
    }
    return commands;
  }
  /**
   * The scene from the character's side: both bodies' reserves, the character's arousal gauges (PALAM levels, as the
   * status screen shows them) and orgasms so far, what is touching what, and the commands available now.
   */
  private intimate(): Record<string, unknown> {
    const self = BigInt(this.self), master = BigInt(this.master);
    const level = (name: string) => this.palamLevel(this.num("PALAM", self, name), 10);
    const arousal = Object.fromEntries(Object.entries(AROUSAL).map(([key, name]) => [key, level(name)]).filter(([, value]) => value));
    const orgasms = Object.fromEntries(Object.entries(ORGASMS).map(([key, name]) => [key, this.num("EX", self, name)]).filter(([, value]) => value));
    const touching: string[] = [];
    for (let part = 1; part < PARTS.length; part++) {
      const theirs = this.num("TEQUIP", self, BigInt(100 + part));
      if (theirs > 0 && theirs < PARTS.length) touching.push(`the player's ${PARTS[theirs]} on your ${PARTS[part]}`);
    }
    const last = this.num("SELECTCOM");
    return {
      ...(this.num("TFLAG", 102n) === 3 ? { started: "you pushed the player down" } : {}),
      me: { stamina: this.gauge(this.self, "体力"), energy: this.gauge(this.self, "気力"), ...(Object.keys(arousal).length ? { arousalLevels: arousal } : {}),
        ...(Object.keys(orgasms).length ? { orgasms } : {}) },
      player: { stamina: this.gauge(this.master, "体力"), energy: this.gauge(this.master, "気力"),
        ...(this.num("MAXBASE", master, "精力") ? { vigor: this.gauge(this.master, "精力"), erection: this.gauge(this.master, "勃起"), ejaculation: this.gauge(this.master, "射精") } : {}) },
      touching: touching.length ? touching : "nothing right now",
      ...(last >= 0 && last < SCENE_COMMANDS ? { lastCommand: this.call("TRAINNAME_TR", BigInt(last)).trim() } : {}),
      limits: "The scene ends at once if the player's stamina falls to 500 or yours below 500. Energy is spent by "
        + "commands; with none left, they cannot be done. Vigor is the player's sexual reserve (ejaculating spends it); "
        + "below 500 his erection stops recovering.",
      availableCommands: this.sceneCommands().map((command) => command.name),
    };
  }
  /** Named places on the same map as the character; other maps need the game's own outing logic. */
  private places(): { id: number; name: string }[] {
    const map = this.call("GET_MAPID", BigInt(this.location(this.self)));
    const places: { id: number; name: string }[] = [];
    for (let id = 1; id < 10_000; id++) {
      let raw: string;
      try { raw = this.str("STR", BigInt(8000 + id)); } catch (error) { if (error instanceof EraError) break; throw error; }
      if (!raw || this.call("GET_MAPID", BigInt(id)) !== map) continue;
      const name = this.place(id);
      if (name) places.push({ id, name });
    }
    return places;
  }
  feelings(args: Record<string, unknown>): ToolOutcome {
    const toward = this.character(args.toward, this.master);
    if (toward === this.self) throw new ToolError("You cannot change feelings toward yourself");
    if (toward === this.master) {
      const favor = this.integer(args.favor, "favor", TOOL_LIMITS.favor), trust = this.integer(args.trust, "trust", TOOL_LIMITS.trust);
      if (!favor && !trust) throw new ToolError("Give a nonzero favor or trust change");
      const change = (flag: string, delta: number, max: number) => {
        const before = this.num("CFLAG", BigInt(this.self), flag), after = Math.max(0, Math.min(max, before + delta));
        if (after !== before) this.host.write("CFLAG", [BigInt(this.self), flag], BigInt(after));
        return { before, after };
      };
      const result: Record<string, unknown> = { toward: this.name(toward) };
      if (favor) result.favor = change("好感度", favor, FAVOR_MAX);
      if (trust) result.trust = change("信頼度", trust, TRUST_MAX);
      return { result, changed: true };
    }
    const delta = this.integer(args.affinity ?? args.favor, "affinity", TOOL_LIMITS.affinity);
    if (!delta) throw new ToolError("Give a nonzero affinity change for another character");
    const before = this.affinity(this.self, toward), after = Math.max(10, Math.min(300, before + delta));
    this.host.write("RELATION", [BigInt(this.self), this.host.read("NO", [BigInt(toward)])], BigInt(after));
    return { result: { toward: this.name(toward), affinity: { before, after } }, changed: true };
  }
  mark(args: Record<string, unknown>): ToolOutcome {
    const kind = typeof args.mark === "string" ? args.mark.trim().toLowerCase() : "";
    if (!(kind in MARKS)) throw new ToolError(`mark must be one of ${Object.keys(MARKS).join(", ")}`);
    const change = this.integer(args.change ?? 1, "change", TOOL_LIMITS.mark);
    if (!change) throw new ToolError("change must be 1 or -1");
    if (kind === "hate" && change < 0) throw new ToolError("A hate mark is not lost by words: only the player's apology (with a gift) can remove it");
    const mark = MARKS[kind as keyof typeof MARKS];
    const before = this.num("MARK", BigInt(this.self), BigInt(mark)), after = Math.max(0, Math.min(MARK_MAX, before + change));
    this.host.write("MARK", [BigInt(this.self), BigInt(mark)], BigInt(after));
    if (mark === MARKS.hate && after > this.num("MARK", BigInt(this.self), BigInt(OLD_HATE)))
      this.host.write("MARK", [BigInt(this.self), BigInt(OLD_HATE)], BigInt(after));
    return { result: { mark: kind, before, after, max: MARK_MAX }, changed: after !== before };
  }
  mood(args: Record<string, unknown>): ToolOutcome {
    const changes = { romanticMood: this.integer(args.romantic_mood ?? args.mood, "romantic_mood", TOOL_LIMITS.mood),
      anger: this.integer(args.anger, "anger", TOOL_LIMITS.anger) };
    if (!changes.romanticMood && !changes.anger) throw new ToolError("Give a nonzero romantic_mood or anger change");
    const result: Record<string, unknown> = {};
    for (const [key, base] of [["romanticMood", "ムード"], ["anger", "怒り"]] as const) {
      if (!changes[key]) continue;
      const before = this.num("BASE", BigInt(this.self), base), max = this.num("MAXBASE", BigInt(this.self), base);
      const after = Math.max(0, Math.min(max || Infinity, before + changes[key]));
      this.host.write("BASE", [BigInt(this.self), base], BigInt(after));
      result[key] = { before, after };
    }
    return { result, changed: true };
  }
  say(args: Record<string, unknown>): ToolOutcome {
    const line = typeof args.text === "string" ? args.text.replace(/\s+/g, " ").trim().slice(0, 500) : "";
    if (!line) throw new ToolError("text is required");
    if (this.asleep(this.self)) throw new ToolError("You are asleep");
    if (!this.together(this.self)) return { result: { heard: false, note: "The player is not in the same room, so nobody heard you" }, changed: false };
    return { result: { heard: true }, action: { kind: "say", text: line }, changed: true };
  }
  /**
   * Whether the character is willing, decided the way eraTW decides when the player tries the matching command:
   * kiss is REJECT_CHECK(312) from the Kiss command; sex is the push-down consent check (抱き寄せ) against
   * 抱き寄せ必要値; become_lovers is the Confess command's threshold. The consent value (合意判定) is first recomputed
   * with CHARA_ATTITUDE, as the status screen does, so feelings changed this turn count.
   */
  private activity(args: Record<string, unknown>, allowed = ACTIVITIES): string {
    const activity = typeof args.activity === "string" ? args.activity.trim().toLowerCase() : "";
    if (!allowed.includes(activity)) throw new ToolError(`activity must be one of ${allowed.join(", ")}`);
    return activity;
  }
  consent(args: Record<string, unknown>): ToolOutcome {
    const activity = this.activity(args);
    if (this.asleep(this.self)) throw new ToolError("You are asleep");
    if (this.host.has("CHARA_ATTITUDE")) this.host.run("CHARA_ATTITUDE", []);
    const result = this.verdict(activity);
    // A refusal says how the other activities would go too, so a model does not offer a kiss it would also refuse.
    if (!result.willing) result.otherActivities = Object.fromEntries(ACTIVITIES.filter((other) => other !== activity)
      .map((other) => [other, this.verdict(other).answer]));
    return { result, changed: false };
  }
  /** Emuera's GETPALAMLV: the highest PALAMLV step (up to max) the value has reached. */
  private palamLevel(value: number, max: number): number {
    let level = 0;
    while (level < max && value >= this.num("PALAMLV", BigInt(level + 1))) level++;
    return level;
  }
  /**
   * The consent value's parts, as CHARA_ATTITUDE adds them up; whatever it does that is not listed here (event and
   * patch adjustments) is the remainder against the real value, so the parts always add up to it.
   */
  private consentParts(consent: number): Term[] {
    const self = BigInt(this.self), terms = new Terms();
    const cflag = (name: string) => this.num("CFLAG", self, name), talent = (name: string) => this.num("TALENT", self, name);
    const abl = (name: string) => this.num("ABL", self, name), mark = (name: string) => this.num("MARK", self, name);
    const tcvar = (name: string) => this.num("TCVAR", self, name), fn = (name: string, ...args: Value[]) => Number(this.call(name, ...args) || 0);
    const favor = cflag("好感度"), trust = cflag("信頼度");
    terms.add("favor", favor < 1000 ? 0 : favor <= 3000 ? 50 : favor <= 5000 ? 75 : favor <= 10000 ? 100 : favor <= 30000 ? 150 : favor <= 50000 ? 200 : 300);
    terms.add("trust", trust < 100 ? -50 : trust <= 300 ? -20 : trust <= 500 ? 0 : trust <= 750 ? 30 : trust <= 1000 ? 50 : 100);
    terms.add("in love with the player", talent("恋慕") * 100);
    terms.add("longing for the player", talent("思慕") * 30);
    terms.add("lusts for the player", talent("愛欲") * 80);
    terms.add("sex friend", talent("セフレ") * 30);
    terms.add("intimacy", Math.min(abl("親密"), 20) * 10);
    terms.add("desire", Math.min(abl("欲望"), 20) * 5);
    terms.add("aroused", this.palamLevel(this.num("PALAM", self, "欲情"), 15) * 5);
    terms.add("affection felt this encounter", this.palamLevel(this.num("PALAM", self, "好意"), 15) * 5);
    terms.add("romantic mood", Math.trunc(this.num("BASE", self, "ムード") / 25));
    terms.add("reason worn down", Math.trunc((1000 - this.num("BASE", self, "理性")) / 25));
    terms.add("lewd mark", mark("不埒刻印") * 20);
    terms.add("pleasure mark", mark("快楽刻印") * 20);
    // Hate marks not offset by timestop marks (docs/game-patches.md #4; unpatched, this term is never negative and lands
    // in "other effects").
    terms.add("hate mark", -Math.max(mark("反発刻印") - mark("時姦刻印"), 0) * 30);
    if (tcvar("発情")) terms.add("in heat", 50);
    else if (tcvar("惚れ薬") || tcvar("媚薬")) terms.add("love potion or aphrodisiac", 30);
    if (tcvar("泥酔") > 0) terms.add("drunk", 70);
    if (fn("IsGardenValid", self)) terms.add("garden's scent", 40);
    else if (fn("IsInsenceValid", self)) terms.add("incense", 30);
    if (fn("OTOKOGIRAI", self)) terms.add("dislikes men", -70);
    if (talent("性別嗜好") !== -1 && fn("HETEROSEX", this.host.read("MASTER"), self)) {
      if (terms.total < 150) terms.add("attracted to the player's sex", 20);
      else if (terms.total > 200) terms.add("same sex as the player", -30);
    }
    if (talent("ヤリマン") || talent("ヤンデレ")) terms.add(talent("ヤンデレ") ? "yandere" : "promiscuous", 400);
    if (cflag("無理矢理膣射")) terms.add("was forcibly creampied", -100);
    if (terms.total >= 100 && this.num("FLAG", "甲斐性無")) terms.add("spineless player bonus", 50);
    terms.add("hypnosis", tcvar("Common_Sense_Alteration_Status") * 4);
    terms.add("other effects", consent - terms.total);
    return terms.list;
  }
  /** What an activity needs, part by part (抱き寄せ必要値 for sex, REJECT_CHECK's for a kiss, Confess's for lovers). */
  private neededParts(activity: string): Term[] {
    const self = BigInt(this.self), terms = new Terms();
    const talent = (name: string) => this.num("TALENT", self, name), cflag = (name: string) => this.num("CFLAG", self, name);
    const agreed = (bit: number) => (cflag("既成事実") >> bit & 1) === 1;
    if (activity === "kiss") {
      terms.add("base", 200);
      terms.add("reserved", talent("一線越えない") * 30);
      terms.add("never kissed", Math.abs(talent("キス未経験")) * 20);
      if (agreed(0)) terms.add("has kissed the player before", -20);
      if (talent("思慕") && !talent("恋慕")) terms.add("longing for the player", -30);
      return terms.list;
    }
    if (activity === "become_lovers") {
      terms.add("base", 350);
      terms.add("reserved", talent("一線越えない") * 100);
      return terms.list;
    }
    const fn = (name: string, ...args: Value[]) => Number(this.call(name, ...args) || 0);
    terms.add("base", 350);
    terms.add("reserved", talent("一線越えない") * 50);
    terms.add("pride", talent("プライド") * 30);
    terms.add("attitude", talent("態度") * 20);
    terms.add("interest in sex", -talent("性的興味") * 20);
    terms.add("chastity", talent("貞操") * 50);
    if (!agreed(0)) terms.add("has never kissed the player", 20);
    if (talent("性別嗜好") !== -1 && fn("OTOKOGIRAI", self)) terms.add("not attracted to the player's sex", 50);
    if (!talent("思慕") && !talent("恋慕") && !talent("愛欲")) terms.add("no romantic feelings for the player yet", 50);
    if (fn("OTOKOGIRAI", self)) terms.add("dislikes men", 50);
    if (talent("無知")) terms.add("innocent", -50);
    if (cflag("弱み握られ")) terms.add("the player has something on them", -50);
    terms.add("pent-up frustration", -Math.trunc(cflag("溜まってる度") / 20));
    const edged = ["Ｃ寸止め", "Ｖ寸止め", "Ａ寸止め", "Ｂ寸止め", "Ｍ寸止め"].reduce((sum, name) => sum + this.num("EX", self, name), 0);
    terms.add("left on the edge", -edged * 20);
    terms.add("other effects", Number(this.call("抱き寄せ必要値", self) || NaN) - terms.total);
    if (cflag("ヤラせちゃった")) terms.add("gave in before", -20);
    return terms.list;
  }
  /**
   * The margin is the consent value less what the activity needs (the same comparison the game makes) and decides
   * whether the character goes along with it; `why` says what it is made of, and `because` names a push-down outcome
   * the game decides on something other than wanting it (a timid character giving in from fear, or one who lost to
   * the player submitting).
   */
  private verdict(activity: string): Record<string, unknown> {
    const self = BigInt(this.self);
    const consent = this.num("CFLAG", self, "合意判定");
    const agreed = (bit: number) => (this.num("CFLAG", self, "既成事実") >> bit & 1) === 1;
    const needs = this.neededParts(activity), needed = needs.reduce((sum, [, value]) => sum + value, 0);
    if (!Number.isFinite(needed)) throw new ToolError("This game has no consent check for sex");
    let willing: boolean, note: string | undefined, because: string | undefined;
    if (activity === "kiss") {
      // REJECT_CHECK reads the implicit TARGET's variables, so it is asked about this character.
      const target = this.host.read("TARGET", [0n]);
      try {
        this.host.write("TARGET", [0n], self);
        willing = !Number(this.host.call("REJECT_CHECK", [KISS]));
      } finally { this.host.write("TARGET", [0n], target); }
      if (agreed(AGREED_KISS)) note = "you always welcome their kisses";
    } else if (activity === "become_lovers") willing = consent > needed;
    else {
      willing = consent >= needed || agreed(AGREED_SEX);
      if (agreed(AGREED_SEX)) note = "you have agreed to sex with the player before";
      else if (!willing && this.num("CFLAG", self, "負け犬")) because = "you lost to the player, so you submit, glaring and humiliated";
      else if (!willing && consent >= needed - 50 && this.num("TALENT", self, "度胸") < 0) because = "you are too timid to refuse, so you give in out of fear, not desire";
    }
    const margin = consent - needed;
    const answer = because ? "gives in" : willing ? (margin >= 100 ? "eager" : margin >= 30 || note ? "willing" : "hesitantly willing")
      : margin >= -50 ? "tempted, but not ready" : margin >= -150 ? "refuses" : "firmly refuses";
    // Written as the sum itself: each part of the feelings, less each part of what it takes, equals the margin.
    const terms: Term[] = [...this.consentParts(consent), ...needs.map(([label, value]): Term => [label, -value])].filter(([, value]) => value);
    const sum = terms.map(([label, value], index) => `${index ? (value < 0 ? " − " : " + ") : value < 0 ? "−" : ""}${Math.abs(value)} (${label})`).join("");
    return { activity, decision: decision(activity, answer, because), willing: willing || !!because, answer, margin,
      why: `${this.name(this.self)}'s feelings, less what it takes: ${sum || "0"} = ${signed(margin)}`,
      ...(note ? { note } : {}) };
  }
  /**
   * The player's own attempt, played out by the game: the command runs as if the player had typed its number once the
   * conversation ends, so its consent check, rejection penalties (antipathy, hate marks, lost favor) and scene apply.
   */
  attempt(args: Record<string, unknown>): ToolOutcome {
    const activity = this.activity(args, Object.keys(ATTEMPTS));
    const command = ATTEMPTS[activity]!;
    if (this.self !== Number(this.host.read("TARGET"))) throw new ToolError("The player is not with you, so they cannot try that");
    if (!this.together(this.self)) throw new ToolError("The player is not in the same room");
    if (this.host.queued().some((action) => action.kind === "command")) throw new ToolError("The player is already trying something");
    // The commands read the consent cached by CHARA_ATTITUDE, so feelings changed during this conversation count.
    if (this.host.has("CHARA_ATTITUDE")) this.host.run("CHARA_ATTITUDE", []);
    if (this.host.has(`COM_ABLE${command}`)) this.host.run(`COM_ABLE${command}`, []);
    if (activity === "apologize" && this.host.has("COM_ABLE303") && !Number(this.host.read("RESULT")))
      throw new ToolError(`${this.name(this.self)} is not furious with the player, so the game has nothing to forgive; respond in words instead`);
    if (this.host.has(`COM_ABLE${command}`) && !Number(this.host.read("RESULT"))) throw new ToolError(`The game does not let the player try that right now (command ${command} is unavailable), so respond in words instead`);
    return { result: { note: "The player tries it now; the game decides how you react. The conversation ends here." },
      action: { kind: "command", command }, changed: true };
  }
  /** A scene command, run as if the player had chosen it once the conversation ends (by their request or the character's lead). */
  sceneAction(args: Record<string, unknown>): ToolOutcome {
    if (!this.inScene()) throw new ToolError("You are not in an intimate scene with the player");
    if (this.host.queued().some((action) => action.kind === "command")) throw new ToolError("Something is already about to happen");
    const wanted = typeof args.command === "string" ? args.command.trim().toLowerCase() : "";
    if (!wanted) throw new ToolError("command is required");
    const commands = this.sceneCommands();
    const command = commands.find((item) => item.name.toLowerCase() === wanted) ?? commands.find((item) => item.name.toLowerCase().includes(wanted));
    if (!command) throw new ToolError(`${JSON.stringify(args.command)} is not available now; choose one of: ${commands.map((item) => item.name).join(", ")}`);
    return { result: { command: command.name, note: "It happens now; the game plays it out. The conversation ends here." },
      action: { kind: "command", command: command.id }, changed: true };
  }
  endScene(): ToolOutcome {
    if (!this.inScene()) throw new ToolError("You are not in an intimate scene with the player");
    if (this.host.queued().some((action) => action.kind === "command")) throw new ToolError("Something is already about to happen");
    return { result: { note: "The scene ends now. The conversation ends here." }, action: { kind: "command", command: END_SCENE }, changed: true };
  }
  act(args: Record<string, unknown>): ToolOutcome {
    const line = typeof args.text === "string" ? args.text.replace(/\s+/g, " ").trim().slice(0, 500) : "";
    if (!line) throw new ToolError("text is required");
    if (!this.together(this.self)) return { result: { seen: false, note: "The player is not in the same room, so nobody saw this" }, changed: false };
    return { result: { seen: true }, action: { kind: "act", text: line }, changed: true };
  }
  move(args: Record<string, unknown>): ToolOutcome {
    if (this.asleep(this.self)) throw new ToolError("You are asleep");
    const places = this.places(), from = this.location(this.self);
    const wanted = args.destination;
    let target: { id: number; name: string } | undefined;
    if (typeof wanted === "number" || (typeof wanted === "string" && /^\d+$/.test(wanted.trim()))) target = places.find((place) => place.id === Number(wanted));
    else if (typeof wanted === "string" && wanted.trim()) {
      const query = wanted.trim().toLowerCase();
      target = places.find((place) => place.name.toLowerCase() === query) ?? places.find((place) => place.name.toLowerCase().includes(query));
    }
    if (!target) throw new ToolError(`Unknown destination ${JSON.stringify(wanted)}; choose one of the places on this map`);
    if (target.id === from) throw new ToolError(`You are already at ${target.name}`);
    return { result: { from: this.place(from), to: target.name, note: "The move happens in the room once the conversation pauses" },
      action: { kind: "move", destination: target.id }, changed: true };
  }
  pushDown(): ToolOutcome {
    if (this.self !== Number(this.host.read("TARGET"))) throw new ToolError("Only the character the player is currently with can push them down");
    if (this.asleep(this.self)) throw new ToolError("You are asleep");
    if (this.asleep(this.master)) throw new ToolError("The player is asleep");
    if (!this.together(this.self)) throw new ToolError("The player is not in the same room");
    if (this.num("CFLAG", BigInt(this.self), "うふふ") !== 0) throw new ToolError("You are already being intimate with the player");
    this.host.write("nForcePushDown", [BigInt(this.self)], 1n);
    return { result: { note: "You will push the player down as soon as the conversation pauses" }, changed: true };
  }
}

const ACTIVITY_WORDS: Record<string, string> = { kiss: "the kiss", sex: "sex", become_lovers: "becoming lovers" };

type Term = [string, number];
/** Labelled parts of a sum, keeping only the ones that count. */
class Terms {
  list: Term[] = [];
  total = 0;
  add(label: string, value: number): void {
    if (!value) return;
    this.list.push([label, value]);
    this.total += value;
  }
}

/** Spells the consent answer out, since weaker models ignore a bare `willing: false`. */
function decision(activity: string, answer: string, because?: string): string {
  const what = ACTIVITY_WORDS[activity] ?? activity;
  if (because) return `YES, but unwillingly: you do not want ${what}, but ${because}.`;
  const said: Record<string, string> = {
    eager: `YES: you eagerly want ${what}.`,
    willing: `YES: you are willing to accept ${what}.`,
    "hesitantly willing": `YES, hesitantly: you want ${what}, but feel shy or unsure.`,
    "tempted, but not ready": `NOT YET: you are tempted, but not ready for ${what}. Refuse it for now; it does not happen.`,
    refuses: `NO: you refuse ${what}. Your words and actions must refuse it; it does not happen.`,
  };
  return said[answer] ?? `NO: you absolutely refuse ${what}. Your words and actions must refuse it; it does not happen.`;
}

/** A piece of a tool call as written in the interaction history: the call itself, or its outcome (toned if it matters). */
export interface ToolLinePart { text: string; tone?: "call" | "good" | "bad" | "uneasy" }
const SUMMARY_LIMIT = 300;
const signed = (value: number) => `${value < 0 ? "−" : "+"}${Math.abs(value)}`;
const clip = (text: string) => text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT)}…` : text;
const plain = (value: unknown): string => typeof value === "string" ? value : typeof value === "number" ? String(value) : JSON.stringify(value);

/** How a call reads in the history: name(arguments) → a short outcome, rather than its raw JSON. */
export function toolCallSummary(who: string, name: string, args: Record<string, unknown>, result: Record<string, unknown>): ToolLinePart[] {
  const shown = Object.entries(args).filter(([key]) => key !== "reason")
    .map(([key, value]) => typeof value === "number" ? `${key} ${signed(value)}` : plain(value)).join(", ");
  const reason = typeof args.reason === "string" && args.reason.trim() ? ` (${args.reason.trim()})` : "";
  const call: ToolLinePart = { text: `${name}(${shown})${reason} → `, tone: "call" };
  if (result.error) return [call, { text: `failed: ${clip(plain(result.error))}`, tone: "bad" }];
  return [call, ...outcome(who, name, result)];
}
// How a consent answer reads after the character's name, and after "Will also".
const ANSWERS: Record<string, [string, string]> = {
  "eager": ["is eager", "be eager for"], "willing": ["is willing", "be willing to"],
  "hesitantly willing": ["is hesitantly willing", "be hesitantly willing to"], "gives in": ["gives in", "give in to"],
  "tempted, but not ready": ["is tempted, but not ready", "be tempted, but not ready for"],
  "refuses": ["refuses", "refuse"], "firmly refuses": ["firmly refuses", "firmly refuse"],
};
function outcome(who: string, name: string, result: Record<string, unknown>): ToolLinePart[] {
  const change = (label: string, value: unknown) => {
    const { before, after } = value as { before: number; after: number };
    return `${label} ${before} → ${after}`;
  };
  switch (name) {
    case "check_consent": {
      const answer = String(result.answer);
      const tone = answer === "gives in" ? "uneasy" : result.willing ? "good" : "bad";
      // The history is read by the player, so it names the character rather than saying "you".
      const sum = String(result.why ?? "").replace(/^.*?, less what it takes: /, "");
      const parts: ToolLinePart[] = [{ text: `${sum} (` }, { text: `${who} ${ANSWERS[answer]?.[0] ?? answer}`, tone }, { text: ")" }];
      // A refusal also reports the other activities; those with the same answer are named together.
      const groups = new Map<string, string[]>();
      for (const [activity, verdict] of Object.entries((result.otherActivities ?? {}) as Record<string, string>))
        groups.set(verdict, [...groups.get(verdict) ?? [], activity === "become_lovers" ? "becoming lovers" : activity]);
      for (const [verdict, activities] of groups) {
        const listed = activities.join(" or ");
        parts.push({ text: verdict === answer ? `. Will also ${ANSWERS[verdict]?.[1] ?? verdict}: ${listed}`
          : `. ${listed[0]!.toUpperCase()}${listed.slice(1)}: ${ANSWERS[verdict]?.[0] ?? verdict}` });
      }
      return parts;
    }
    case "change_mark": {
      const text = change(`${result.mark} mark`, result);
      return [result.mark === "hate" ? { text, tone: "bad" } : { text }];
    }
    case "get_character_info": {
      const traits = Array.isArray(result.traits) ? result.traits.slice(0, 6).join(", ") : "";
      return [{ text: clip([result.fullName ?? result.name, `${result.race}, ${result.sex}`, `at ${result.location}`, traits].filter(Boolean).join(" · ")) }];
    }
    case "find_characters": {
      const names = ((result.characters as string[] | undefined) ?? []).map((line) => line.replace(/ \(.*$/, ""));
      return [{ text: result.found ? `${result.found} found: ${names.slice(0, 10).join(", ")}${names.length > 10 ? ", …" : ""}` : "nobody found" }];
    }
    case "move_to": return [{ text: `${result.from} → ${result.to}` }];
    case "player_attempts": case "push_down_player": case "end_scene": return [{ text: "handed to the game" }];
    case "scene_action": return [{ text: `${result.command}: handed to the game` }];
  }
  const changes = Object.entries(result).filter(([, value]) => value && typeof value === "object" && "before" in value && "after" in value)
    .map(([key, value]) => change(key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`), value));
  if (changes.length) return [{ text: changes.join(", ") + ("affinity" in result ? ` toward ${result.toward}` : "") }];
  if (typeof result.note === "string") return [{ text: result.note }];
  return [{ text: clip(Object.entries(result).map(([key, value]) => `${key}: ${plain(value)}`).join(", ")) }];
}
