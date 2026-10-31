// LLM-driven character replies: provider settings (kept only in this browser), prompts built from a character's
// interaction history, and requests sent through the server's /api/llm proxy.
const CONFIG_KEY = "era-typescript.llm";
const DEBUG_LIMIT = 30;
/** Tool-call rounds per message; the last round asks for a reply without tools. */
const TOOL_ROUNDS = 8;
/** say and act calls allowed per reply each, so a reply stays a few seconds long; going past either ends the reply. */
const SPOKEN_LIMIT = 3;

const fn = (name, description, properties = {}, required = []) => ({
  type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});
const who = (description) => ({ type: "string", description });
/** Game tools the character can call (OpenAI function-calling format); the server runs them against the live game. */
export const TOOLS = [
  fn("get_character_info", "Look up a character by name: sex, race, traits, where they are, workplace and schedule, romantic "
    + "mood and anger, their feelings toward the player, and your affinity with each other (a percentage: 100 is neutral, "
    + "higher is closer). Everyone in this room is already described in the scene.",
    { character: who("A name such as \"Marisa\"") }, ["character"]),
  fn("find_characters", "Search everyone in the world by name, race, trait, home or current location; each match says where "
    + "they live and where they are now. Matching is plain case-insensitive text, so list alternative spellings and "
    + "translations separated by |.",
    { query: who("Words to look for, separated by |, e.g. \"fairy|fairies\" or \"misty lake|lake\"") }, ["query"]),
  fn("change_feelings", "Change how you feel about the player (favor and trust) or another character (affinity), in proportion to "
    + "what just happened. Typical player actions move favor by 1-30 and trust by 1-10; per call favor is limited to ±50, "
    + "trust to ±10 and affinity to ±10.",
    { toward: who("\"player\" (default) or another character's name"),
      favor: { type: "integer", description: "Change in favor toward the player, -50 to 50" },
      trust: { type: "integer", description: "Change in trust toward the player, -10 to 10" },
      affinity: { type: "integer", description: "Change in affinity toward another character, -10 to 10" },
      reason: who("Why your feelings changed") }),
  fn("change_mark", "Gain or lose one level (0-3) of a mark toward the player, for something significant: hate after being "
    + "treated badly, pleasure or lewd after intimate experiences, pain after being hurt. A hate mark cannot be lost this "
    + "way; only the player's apology (with a gift) removes it.",
    { mark: { type: "string", enum: ["hate", "pleasure", "lewd", "pain"] },
      change: { type: "integer", enum: [1, -1], description: "1 to gain a level, -1 to lose one" } }, ["mark", "change"]),
  fn("change_mood", "Change your romantic mood toward the player (the intimate atmosphere between you: it builds up through "
    + "pleasant moments together and makes you more receptive to intimacy) or your anger, each by at most ±300 per call.",
    { romantic_mood: { type: "integer", description: "-300 to 300" }, anger: { type: "integer", description: "-300 to 300" } }),
  fn("check_consent", "Ask the game whether you are willing to do something intimate with the player, decided exactly as "
    + "when the player tries the matching command: kiss, sex, or become_lovers (accepting a confession of love). It "
    + "reflects your current feelings, including changes made this turn. It says whether you would go along with it: "
    + "eager, willing, hesitantly willing, gives in (without wanting it, from fear or defeat), tempted but not ready, "
    + "refuses or firmly refuses; margin is how far your feelings are above (or below) what it takes, and why is that sum: "
    + "each part of your feelings, less each part of what it takes. A refusal also says how the other activities would go.",
    { activity: { type: "string", enum: ["kiss", "sex", "become_lovers"] } }, ["activity"]),
  fn("player_attempts", "The player actually tries to kiss you, to have sex (pushing you down, by force or not), confesses "
    + "their love and asks to become lovers, or sincerely apologizes: hand that moment to the game, which plays it out "
    + "with its own checks, your reaction and the consequences (an unwelcome attempt angers you and can leave a hate "
    + "mark; an apology may calm your anger, and only with a gift removes a hate mark). The conversation ends with this "
    + "call, so make it last.",
    { activity: { type: "string", enum: ["kiss", "sex", "become_lovers", "apologize"] } }, ["activity"]),
  fn("say", "Say something out loud. This is how you talk: the player sees it in this conversation and everyone in the "
    + "room hears it in the game.",
    { text: who("The words, without quotation marks") }, ["text"]),
  fn("act", "Describe something you physically do, such as a gesture or expression; it is shown to the player and in the room.",
    { text: who("A short third-person description, e.g. \"Reimu sips her tea.\"") }, ["text"]),
  fn("move_to", "Walk to another place on the current map, for example to leave the room.",
    { destination: who("A place name from the scene's placesOnThisMap") }, ["destination"]),
  fn("push_down_player", "Push the player down to start being intimate with them. Only possible when you are the player's "
    + "current companion, both of you are awake and in the same room. Use only when it really fits the situation."),
  fn("scene_action", "During an intimate scene: do one of the scene's commands next, by its name from the scene's "
    + "availableCommands, either because the player asks for or does it, or because you take the lead. The game plays it "
    + "out, including both bodies' reactions; the conversation ends with this call, so make it last.",
    { command: who("A name from availableCommands, e.g. \"Kiss\"") }, ["command"]),
  fn("end_scene", "During an intimate scene: stop it now, because the player wants to or you do. The game plays out the "
    + "ending; the conversation ends with this call, so make it last."),
];
/** Tools that hand the moment over to the game to play out; the conversation stops once one succeeds. */
const HANDOVER = new Set(["player_attempts", "scene_action", "end_scene"]);
const tools = (...names) => TOOLS.filter((tool) => names.includes(tool.function.name));
/** Outside an intimate scene. */
export const CHAT_TOOLS = tools("get_character_info", "find_characters", "change_feelings", "change_mark", "change_mood",
  "check_consent", "player_attempts", "say", "act", "move_to", "push_down_player");
/** During one: consent was already given, and leaving or starting over goes through end_scene. */
export const SCENE_TOOLS = tools("get_character_info", "find_characters", "change_feelings", "change_mark", "change_mood",
  "say", "act", "scene_action", "end_scene");
/** When the player and a character run into each other: she may react, but nothing is asked of her yet. */
export const ENCOUNTER_TOOLS = tools("get_character_info", "find_characters", "change_feelings", "change_mark", "change_mood",
  "say", "act", "move_to");
/** The toolset for the moment described by describe_scene. */
export const toolsFor = (scene) => scene?.intimateScene ? SCENE_TOOLS : CHAT_TOOLS;

export const PROVIDERS = {
  openai: { label: "OpenAI", endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini", jsonMode: true, tools: true,
    hint: "Create a key at platform.openai.com/api-keys." },
  openrouter: { label: "OpenRouter", endpoint: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", jsonMode: true, tools: true,
    hint: "Create a key at openrouter.ai/keys. Models are named provider/model." },
  local: { label: "Local (OpenAI-compatible)", endpoint: "http://127.0.0.1:11434/v1", model: "", jsonMode: false, tools: true,
    hint: "Any OpenAI-compatible server. Ollama: http://127.0.0.1:11434/v1 · LM Studio: http://127.0.0.1:1234/v1 · llama.cpp: http://127.0.0.1:8080/v1. The key is usually not needed." },
};
const DEFAULTS = { provider: "openai", temperature: 0.8, historyChars: 24000, instructions: "", encounters: true };

export function loadLlmConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}") ?? {}; } catch { /* use the defaults */ }
  const config = { ...DEFAULTS, ...saved, providers: {} };
  if (!PROVIDERS[config.provider]) config.provider = DEFAULTS.provider;
  for (const [id, preset] of Object.entries(PROVIDERS)) {
    config.providers[id] = { endpoint: preset.endpoint, apiKey: "", model: preset.model, jsonMode: preset.jsonMode, tools: preset.tools, ...saved.providers?.[id] };
  }
  return config;
}

export function saveLlmConfig(config) { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); }

/** The chosen provider's settings, or null until it has what a request needs. */
export function activeLlm(config = loadLlmConfig()) {
  const settings = config.providers[config.provider];
  if (!settings.endpoint || !settings.model || (config.provider !== "local" && !settings.apiKey)) return null;
  return { provider: config.provider, ...settings };
}

async function proxy(llm, path, payload, signal) {
  const response = await fetch("/api/llm", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ provider: llm.provider, endpoint: llm.endpoint, apiKey: llm.apiKey, path, payload }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}

function parseJson(text) { try { return JSON.parse(text); } catch { return undefined; } }

function upstreamError(result) {
  const data = parseJson(result.text);
  const detail = data?.error?.message ?? data?.error ?? data?.message ?? result.text.slice(0, 300);
  return new Error(`${result.status} ${result.statusText}${detail ? `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
}

export async function listModels(llm) {
  const result = await proxy(llm, "models");
  if (!result.ok) throw upstreamError(result);
  const data = parseJson(result.text);
  const models = data?.data ?? data?.models ?? [];
  return models.map((model) => model.id ?? model.name).filter((id) => typeof id === "string").sort();
}

/** Chats are kept per game and character, so a conversation continues the next time history is opened. */
const debugLogs = new Map();
/** Request/response exchanges for the debug tab; kept in memory only, as they hold whole prompts. */
export function debugLog(key) {
  if (!debugLogs.has(key)) debugLogs.set(key, []);
  return debugLogs.get(key);
}

export function systemPrompt({ character, gameTitle, instructions, tools = false, scene, encounter }) {
  const name = character.name;
  const reply = tools && encounter ? [
    `${name} has just run into people (the latest message says who walked in where). Nobody has said anything to `
      + `${name} yet: this is ${name}'s chance to react, or not. The current scene below gives the time, weekday and `
      + `date (and a special day such as a festival, if it is one), the weather, where you are, what ${name} and the `
      + `player are wearing, and in othersHere everyone else in the room with how ${name} and they feel about each other.`,
    `${name} may speak to anyone here, not only the player: greet a friend, needle a rival, or say something to the `
      + `room. Address whoever ${name} is talking to by name. Everyone in the room hears what ${name} says.`,
    `Talk and act only through tool calls: call say for what ${name} says out loud and act for what ${name} physically `
      + `does. Any other text is ignored. Keep it to a moment: at most one short say and one act. Saying nothing is `
      + `often right; then reply with just DONE and call no tools. When ${name} has finished, reply with just DONE.`,
    `Do not invent people, places or facts about them; look up anyone or anything not in the scene first.`,
    `Decide what to do by following the first rule that matches:`,
    `1. The game just showed ${name} greeting the player or reacting (the latest message quotes it): that already `
      + `happened, so do not repeat or rephrase it. Add something only if there is something new worth reacting to `
      + `(rule 3 or 4); otherwise DONE.`,
    `2. ${name} hates the player (a hate mark) or is angry with the player: a cold remark, a glare or pointedly `
      + `ignoring the player (DONE), as fits ${name}'s personality; if ${name} cannot stand being near the player, `
      + `move_to somewhere else.`,
    `3. Something about the player stands out: naked or in underwear, dressed oddly for the place, weather or occasion, `
      + `showing up at an odd hour, or walking into ${name}'s bath, bedroom or other private place. React as ${name} `
      + `would (embarrassed, angry, amused, teasing, indifferent...), and change_feelings if it is offensive or pleasing.`,
    `4. It is a special day, or the weather or time of day is notable (a storm, late at night, early morning): a `
      + `fitting greeting or remark, if ${name} is the kind to make one and knows the player at least a little.`,
    `5. Otherwise it depends on relationships and ${name}'s mood and personality, with the player and with each other `
      + `person here: a lover greets warmly, a friend says hello, an acquaintance may nod or say a word, someone ${name} `
      + `dislikes gets a cool look or a jab, and a stranger, someone shy or someone busy usually gets nothing (DONE). `
      + `Something ${name} wants to tell or ask the player, from your recent interactions, is fine. If someone just `
      + `spoke to ${name} (the latest message says), ${name} may answer them.`,
    `Call change_feelings, change_mood or change_mark only when something meaningful happened.`,
  ] : tools && scene?.intimateScene ? [
    `${name} and the player are in the middle of an intimate scene; intimateScene in the current scene below gives its `
      + `live state: both bodies' stamina and energy, the player's vigor, ${name}'s arousal levels and orgasms, what is `
      + `touching what, the last command, and the commands available now.`,
    `Talk and act only through tool calls: call say for what ${name} says out loud (moans and gasps included) and act for `
      + `what ${name} physically does or how ${name}'s body reacts, in the order they happen. Any other text is ignored; `
      + `when ${name} has finished (typically after one or two say or act calls), reply with just DONE.`,
    `Your reply should represent approximately 6 seconds of time. Never describe what the player does or feels.`,
    `Decide what to do by following the first rule that matches the player's latest message:`,
    `1. The player asks for, or does, something physical that matches one of the commands available now `
      + `(${(scene.intimateScene.availableCommands ?? []).join(", ") || "none"}): call scene_action with that command, `
      + `e.g. "Can I touch your breasts?" → scene_action("Breast Caress"). Do not answer yes or no with say first: the `
      + `game plays it out, including ${name}'s reaction. If no available command matches, ${name} reacts to the `
      + `request instead (it cannot happen right now).`,
    `2. The player wants to stop or rest (e.g. "let's stop", "I'm tired"): call end_scene; the game plays out the ending.`,
    `3. ${name} wants it to stop (too much pain or fear, disgust, exhaustion, or the player was cruel): say and act `
      + `that, change_feelings if it is deserved, then call end_scene.`,
    `4. ${name} wants something and it fits ${name}'s personality, desire and who leads between you (dominant or `
      + `submissive): say or act it, then call scene_action with that command to take the lead.`,
    `5. Otherwise react in the moment: words, moans and body reactions consistent with ${name}'s personality and the `
      + `gauges (more aroused, the more the arousal levels and orgasms show; pain and fear show too). When ${name}'s or `
      + `the player's stamina or energy is running low, show the tiredness. Call change_feelings or change_mark only `
      + `when something meaningful happened.`,
  ] : tools ? [
    `Talk and act only through tool calls: call say for what ${name} says out loud and act for what ${name} physically `
      + `does, in the order they happen. Any other text is ignored; when ${name} has finished (typically after one or two `
      + `say or act calls), reply with just DONE.`,
    `Your reply should represent approximately 6 seconds of time: usually one or two short say calls and at most one or `
      + `two act calls, then stop and let the player respond.`,
    `Do not invent people, places or facts about them. Before mentioning any character or place that is not in the scene, `
      + `verify it with find_characters or get_character_info; if you find nothing, ${name} does not know.`,
    `The current scene below already describes ${name}, the player, who else is here and the places on this map.`,
    `Decide what to do by following the first rule that matches the player's latest message:`,
    `1. The player actually tries to have sex with ${name}, push ${name} down or force anything sexual: call `
      + `player_attempts("sex"). The game plays it out, including ${name}'s reaction, so do not refuse or accept it yourself.`,
    `2. The player actually tries to kiss ${name}: call player_attempts("kiss").`,
    `3. The player confesses their love and asks ${name} to be their lover: call player_attempts("become_lovers").`,
    `4. The player only asks nicely, or says they want a kiss or something sexual: call check_consent for it and answer `
      + `as its result says: eager is an enthusiastic yes, willing a yes, hesitantly willing a shy or unsure yes, gives in a `
      + `yes from fear or defeat rather than desire, tempted but not ready a "not yet", refuses a no, firmly refuses an `
      + `absolute no. Its why says what ${name}'s feelings are made of (such as love, fear or a hate mark), which colours `
      + `how ${name} says it. Weigh ${name}'s and the player's `
      + `personality and traits (including who is dominant or submissive), your relationship and recent interactions; `
      + `reply with say and act, and change_feelings accordingly. In extremes, also change_mark (hate). If ${name} is `
      + `afraid or uncomfortable, move_to somewhere else to leave.`,
    `5. The player is rude or disrespectful, or especially polite and kind: weigh the same things, reply with say and act, `
      + `and change_feelings in proportion.`,
    `6. The player sincerely apologizes: call player_attempts("apologize") first; the game decides whether ${name} `
      + `forgives. Words alone can only calm a minor hurt; forgiving a hate mark takes a gift. A sarcastic, grudging or `
      + `dismissive apology ("fine, sorry, jeez") is not sincere: do not call player_attempts; treat it as rude (step 5).`,
    `7. Anything else is normal conversation: weigh the same things and reply. When asked about other characters or `
      + `places, look them up first; if you find nothing, ${name} is unsure and says so. Most replies are a single say `
      + `and/or act, in either order; a very talkative or emotional one may use two of each. Call change_feelings, `
      + `change_mood or change_mark only when something meaningful happened, in proportion to it.`,
    `Use push_down_player only when ${name} would really do that now and check_consent says ${name} is willing to have sex.`,
  ] : [
    `Reply with only a JSON object, no other text, of this form:`,
    `{"speech": "what ${name} says out loud", "actions": ["a short third-person description of something ${name} physically does"]}`,
    `Use "" for speech if ${name} says nothing, and [] for actions if ${name} does nothing.`,
  ];
  return [
    `You are role-playing as ${name}, a character in the text adventure game "${gameTitle}".`,
    encounter ? `The player character ("you" in the history) and ${name} have just met, maybe with others around. Stay `
      + `in character as ${name}: react in a way consistent with ${name}'s personality, the current situation, and how `
      + `${name} feels about the player and anyone else here given the interaction history (including favor and trust). `
      + `Reply in English.`
      : `The player character ("you" in the history) is talking to ${name} directly. Stay in character as ${name}: react `
      + `to what the player says and does in a way consistent with ${name}'s personality, the current situation, and `
      + `how ${name} feels about the player given the interaction history (including favor and trust). Reply in English.`,
    `Keep the reply short: usually one to four sentences of speech. Never speak or act for the player, `
      + `and never repeat the player's words back as ${name}'s own.`,
    ...(scene?.voice?.examples?.length ? [`Speak the way ${name} does in the example lines below: the same formality, `
      + `vocabulary and verbal tics. Above all, ${name} refers to ${name}self exactly as in the examples, in every line `
      + `(characters differ: some say "I", some a royal "We"/"Us"/"Our", some their own name). Say new things that fit `
      + `the moment; never copy an example line word for word.`] : []),
    ...reply,
    instructions?.trim() ? `Additional instructions:\n${instructions.trim()}` : "",
  ].filter(Boolean).join("\n");
}

/** The game's description of the moment, from the describe_scene tool, as prompt text. */
export function sceneContext(scene) {
  if (!scene) return "";
  const { voice, ...rest } = scene;
  return [
    `Current scene ("me" is you, the character you play):\n${JSON.stringify(rest)}`,
    voice?.description ? `How the game introduces you:\n${voice.description}` : "",
    voice?.examples?.length ? `Example lines you say in the game (your voice):\n${voice.examples.map((line) => `「${line}」`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

/**
 * The message that starts an encounter: who walked in where, and what the game itself just showed of it (her scripted
 * greeting or the like), so the model adds to it rather than repeating it.
 */
export function encounterMessage({ character, encounter, scene }) {
  const room = scene?.me?.location ?? "the room";
  const others = Array.isArray(scene?.othersHere) ? scene.othersHere.map((line) => String(line).replace(/ \(.*$/, "")) : [];
  const also = others.length ? ` Also here: ${others.join(", ")}.` : "";
  return [
    (encounter.arrived === "player" ? `The player has just walked into ${room}, where ${character.name} is.`
      : `${character.name} has just walked into ${room}, where the player is.`) + also,
    encounter.intro ? `The game just showed this (in it "you" is the player, lines starting with ● are what the player `
      + `did or said, and lines in 「」 are what ${character.name} already said):\n${encounter.intro}`
      : `The game showed nothing more.`,
    `Anything said or done in the room since is at the end of the interaction history.`,
    `What does ${character.name} do now, if anything? Only ${character.name}'s own words and actions: never say the `
      + `player's lines or address ${character.name} by name as if you were the player.`,
  ].join("\n");
}

/**
 * Messages for the chat completion: instructions, the interaction history (which includes the conversation so far:
 * speech in 「」, actions as narration and tool calls summarised) and the scene as context, then the new message.
 */
export function buildMessages({ system, context, scene, message }) {
  return [
    { role: "system", content: system },
    { role: "system", content: context },
    ...(scene ? [{ role: "system", content: sceneContext(scene) }] : []),
    { role: "user", content: message },
  ];
}

/**
 * Tool calls a model wrote out as text instead of calling them, such as `say(text: "Hi")`, `say("Hi")` or
 * `act({"text": "..."})`, in the order written. Only names of offered tools count.
 */
export function textToolCalls(text, offered = TOOLS) {
  const names = new Set(offered.map((tool) => tool.function.name));
  const calls = [];
  const string = /^"(?:[^"\\]|\\.)*"/;
  const value = /^(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)/;
  for (const match of String(text ?? "").matchAll(/\b([a-z_]+)\(/g)) {
    if (!names.has(match[1])) continue;
    let rest = text.slice(match.index + match[0].length).trimStart();
    let args;
    if (rest.startsWith("{")) {
      // The JSON object ends at the first closing brace that parses.
      for (let end = rest.indexOf("}"); end >= 0 && !args; end = rest.indexOf("}", end + 1)) args = parseJson(rest.slice(0, end + 1));
      if (!args || typeof args !== "object" || Array.isArray(args)) continue;
    } else if (string.test(rest)) {
      const first = rest.match(string)[0];
      if (!/^\s*\)/.test(rest.slice(first.length))) continue;
      args = { text: parseJson(first) };
    } else {
      args = {};
      for (let pair; (pair = rest.match(/^(\w+)\s*[:=]\s*/));) {
        const found = rest.slice(pair[0].length).match(value);
        if (!found) break;
        args[pair[1]] = parseJson(found[0]);
        rest = rest.slice(pair[0].length + found[0].length).replace(/^\s*,\s*/, "");
      }
      if (!/^\s*\)/.test(rest)) continue;
    }
    calls.push({ name: match[1], args });
  }
  return calls;
}

/** Reads {"speech", "actions"} from a reply, tolerating code fences, reasoning blocks and plain-text replies. */
export function parseReply(text) {
  const cleaned = String(text ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const unfenced = cleaned.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  const data = parseJson(unfenced) ?? (start >= 0 && end > start ? parseJson(unfenced.slice(start, end + 1)) : undefined);
  if (!data || typeof data !== "object" || Array.isArray(data)) return { speech: cleaned, actions: [] };
  const speech = typeof data.speech === "string" ? data.speech : typeof data.say === "string" ? data.say : "";
  const raw = data.actions ?? data.action ?? [];
  const actions = (Array.isArray(raw) ? raw : [raw]).filter((action) => typeof action === "string" && action.trim()).map((action) => action.trim());
  return { speech: speech.trim(), actions };
}

/**
 * A plain-text reply from a model that should have called say and act, as those calls in order: quoted speech
 * (「」, "" or “”) is said and the narration around it is acted. A {"speech", "actions"} object is read as such.
 */
export function textReplyCalls(text) {
  const cleaned = String(text ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (/^(?:```(?:json)?\s*)?\{/.test(cleaned)) {
    const { speech, actions } = parseReply(cleaned);
    if (speech !== cleaned) return [...actions.map((action) => ({ name: "act", args: { text: action } })), ...(speech ? [{ name: "say", args: { text: speech } }] : [])];
  }
  const calls = [];
  const narrate = (part) => {
    const text = part.replace(/\*+/g, "").replace(/\s+/g, " ").trim();
    if (/\p{L}/u.test(text)) calls.push({ name: "act", args: { text } });
  };
  let last = 0;
  for (const match of cleaned.matchAll(/「([^「」]*)」|"([^"]*)"|“([^“”]*)”/g)) {
    const said = (match[1] ?? match[2] ?? match[3]).trim();
    if (!said) continue;
    narrate(cleaned.slice(last, match.index));
    calls.push({ name: "say", args: { text: said } });
    last = match.index + match[0].length;
  }
  narrate(cleaned.slice(last));
  return calls;
}

const SPOKEN = new Set(["say", "act"]);
const spoken = (tool) => SPOKEN.has(tool.name) && !tool.result?.error && typeof tool.arguments?.text === "string";
/** The reply a model gives when it has finished; it may also end a reply that wrote its calls out as text. */
const DONE = /(?:^|\n)\W*DONE\W*$/;

/**
 * Runs a chat completion. Without `runTool` the reply is the model's text. With it, the model replies through tool calls
 * (say/act), which run with `runTool(name, args)` and have their results sent back until it stops calling tools. Calls
 * written out as text are run too, and other text is taken as the reply itself (speech in quotes said, the rest acted),
 * which ends it. Returns the final text and the tool calls made, in order.
 */
export async function converse({ llm, messages, temperature, log, signal, runTool, onTool, toolset = CHAT_TOOLS,
  spokenLimit = SPOKEN_LIMIT }) {
  const useTools = !!runTool && llm.tools !== false;
  const tools = [];
  const attempted = () => handedOver(tools);
  const done = () => ({ content: "", tools });
  messages = [...messages];
  for (let round = 0; ; round++) {
    if (useTools && round >= TOOL_ROUNDS) return done();
    // With tools the reply comes through say/act calls, so a JSON-only reply format would get in the way.
    const message = await request({ llm, messages, temperature, log, signal, tools: useTools ? toolset : undefined, json: !useTools });
    let calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!useTools) {
      if (typeof message.content !== "string") throw new Error("The response has no message content");
      return { content: message.content, tools };
    }
    const reply = typeof message.content === "string" ? message.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() : "";
    let finished = DONE.test(reply);
    const text = reply.replace(DONE, "").trim();
    if (!calls.length && text) {
      // Weaker models sometimes write the calls out instead of making them, or just write the reply; run those as if
      // they had been called. A written reply is the whole reply, so nothing more is asked.
      let written = textToolCalls(text, toolset);
      if (!written.length) { written = textReplyCalls(text); finished = true; }
      calls = written.map(({ name, args }, index) => ({
        id: `text${round}_${index}`, type: "function", function: { name, arguments: JSON.stringify(args) } }));
    }
    if (!calls.length) return done();
    messages.push({ role: "assistant", content: message.tool_calls?.length ? message.content ?? "" : "", tool_calls: calls });
    let overran = false;
    for (const call of calls) {
      if (attempted()) break;
      const name = call.function?.name ?? "";
      const raw = call.function?.arguments;
      const args = typeof raw === "string" ? parseJson(raw || "{}") : raw;
      // Past the limit the reply is over: the extra lines are dropped (they stay in the debug log) and nothing more is asked.
      if (SPOKEN.has(name) && tools.filter((tool) => tool.name === name && spoken(tool)).length >= spokenLimit) {
        overran = true;
        continue;
      }
      let result;
      if (!args || typeof args !== "object" || Array.isArray(args)) result = { error: "Arguments must be a JSON object" };
      else {
        try { result = await runTool(name, args); }
        catch (error) { if (error.name === "AbortError") throw error; result = { error: error.message }; }
      }
      const record = { name, arguments: args ?? raw, result };
      tools.push(record);
      onTool?.(record);
      messages.push({ role: "tool", tool_call_id: call.id ?? "", name, content: JSON.stringify(result) });
    }
    // The player's attempt or a scene command is the game's to play out, so the conversation stops there.
    // Once the character has said all it may, there is nothing left to ask for.
    const saidAll = tools.filter((tool) => tool.name === "say" && spoken(tool)).length >= spokenLimit;
    if (overran || saidAll || attempted() || finished) return done();
  }
}

/** Whether a reply handed the moment to the game (an attempt or a scene command), which plays out on the game screen. */
export function handedOver(tools) { return tools.some((tool) => HANDOVER.has(tool.name) && !tool.result?.error); }

/** Sends a chat completion and returns its content; see converse() for replies that may call tools. */
export async function complete(options) {
  const message = await request(options);
  if (typeof message.content !== "string") throw new Error("The response has no message content");
  return message.content;
}

/** Sends one chat completion; every attempt, failed or not, is recorded in `log` for the debug tab. */
async function request({ llm, messages, temperature, log, signal, tools, json = true }) {
  const payload = { model: llm.model, messages };
  if (Number.isFinite(temperature)) payload.temperature = temperature;
  if (tools) payload.tools = tools;
  if (llm.jsonMode && json) payload.response_format = { type: "json_object" };
  const entry = {
    time: new Date().toISOString(), provider: llm.provider, model: llm.model,
    url: `${llm.endpoint.replace(/\/+$/, "")}/chat/completions`, sent: payload, received: null, status: "pending", duration: 0,
  };
  log.push(entry);
  if (log.length > DEBUG_LIMIT) log.splice(0, log.length - DEBUG_LIMIT);
  const started = performance.now();
  try {
    const result = await proxy(llm, "chat/completions", payload, signal);
    entry.received = parseJson(result.text) ?? result.text;
    entry.status = `${result.status} ${result.statusText}`.trim();
    if (!result.ok) throw upstreamError(result);
    const choice = entry.received?.choices?.[0];
    if (!choice) throw new Error("The response has no choices");
    return choice.message ?? { content: choice.text };
  } catch (error) {
    if (entry.status === "pending") entry.status = error.name === "AbortError" ? "cancelled" : "failed";
    entry.error = error.message;
    throw error;
  } finally {
    entry.duration = performance.now() - started;
  }
}

/** Wires up the configuration dialog in index.html; returns a function that opens it. */
export function setupLlmConfig(dialog) {
  const form = dialog.querySelector("form");
  const fields = form.elements;
  const status = dialog.querySelector(".llm-config-status");
  const hint = dialog.querySelector(".llm-config-hint");
  const models = dialog.querySelector("datalist");
  let draft = loadLlmConfig();
  let shown = draft.provider;
  const keep = () => {
    draft.providers[shown] = {
      endpoint: fields.endpoint.value.trim(), apiKey: fields.apiKey.value.trim(), model: fields.model.value.trim(),
      jsonMode: fields.jsonMode.checked, tools: fields.tools.checked,
    };
  };
  const show = (provider) => {
    shown = provider;
    const settings = draft.providers[provider];
    fields.provider.value = provider;
    fields.endpoint.value = settings.endpoint;
    fields.apiKey.value = settings.apiKey;
    fields.apiKey.placeholder = provider === "local" ? "Optional" : "Required";
    fields.model.value = settings.model;
    fields.jsonMode.checked = settings.jsonMode;
    fields.tools.checked = settings.tools !== false;
    hint.textContent = PROVIDERS[provider].hint;
    models.replaceChildren();
    status.textContent = "";
  };
  fields.provider.addEventListener("change", () => { keep(); show(fields.provider.value); });
  dialog.querySelector(".llm-load-models").addEventListener("click", async () => {
    keep();
    status.textContent = "Loading models...";
    try {
      const ids = await listModels({ provider: shown, ...draft.providers[shown] });
      models.replaceChildren(...ids.map((id) => Object.assign(document.createElement("option"), { value: id })));
      status.textContent = ids.length ? `Found ${ids.length} models; pick one in the Model field.` : "The server listed no models.";
    } catch (error) { status.textContent = `Could not load models: ${error.message}`; }
  });
  dialog.querySelector(".llm-reset-endpoint").addEventListener("click", () => { fields.endpoint.value = PROVIDERS[shown].endpoint; });
  form.addEventListener("submit", (event) => {
    if (event.submitter?.value !== "save") return;
    keep();
    const temperature = fields.temperature.value === "" ? undefined : Number(fields.temperature.value);
    const historyChars = Math.max(1000, Math.round(Number(fields.historyChars.value) || DEFAULTS.historyChars));
    draft = { ...draft, provider: shown, temperature, historyChars, instructions: fields.instructions.value,
      encounters: fields.encounters.checked };
    saveLlmConfig(draft);
  });
  // Keys typed here are not game input.
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key !== "Escape") return;
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  return () => {
    draft = loadLlmConfig();
    show(draft.provider);
    fields.temperature.value = draft.temperature ?? "";
    fields.historyChars.value = draft.historyChars;
    fields.instructions.value = draft.instructions;
    fields.encounters.checked = draft.encounters !== false;
    dialog.showModal();
  };
}
