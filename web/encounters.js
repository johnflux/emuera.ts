import { activeLlm, buildMessages, complete, converse, debugLog, ENCOUNTER_TOOLS, encounterMessage, GOSSIP_TOOLS, gossipPrompt,
  LISTENER_TOOLS, loadLlmConfig, memoryMessages, sceneContext, systemPrompt, textReplyCalls } from "./llm.js";
import { historyContext, sinceMemory } from "./interaction-history.js";

/** Whether characters the player runs into get to speak up through the LLM. */
export function encountersEnabled() {
  const llm = activeLlm();
  return !!llm && llm.tools !== false && loadLlmConfig().encounters !== false;
}

/**
 * Lets each character the player just ran into react through the LLM, one after another: after the game's own intro
 * (if it showed one), she may say or do something to the player or anyone else there, or nothing; each one hears what
 * the ones before said, since it is in her own history. `game` holds the calls for one character id:
 * history(id), runTool(id, name, args). Each exchange goes into that character's LLM debug log. Returns whether a tool
 * changed the game, so the room should be redrawn to show it.
 */
export async function runEncounters({ encounters, game, gameId, gameTitle, signal, onStatus }) {
  const llm = activeLlm();
  if (!llm) return false;
  const config = loadLlmConfig();
  let changed = false;
  for (const encounter of encounters) {
    if (signal.aborted) break;
    const { character } = encounter;
    onStatus?.(`${character.name} noticed you…`);
    const runTool = async (name, args) => {
      const outcome = await game.runTool(character.id, name, args);
      if (outcome.changed) changed = true;
      return outcome.result;
    };
    try {
      const history = await game.history(character.id);
      const scene = await game.runTool(character.id, "describe_scene", {})
        .then(({ result }) => result && !result.error && Object.keys(result).length ? result : undefined, () => undefined);
      const messages = buildMessages({
        system: systemPrompt({ character, gameTitle, instructions: config.instructions, tools: true, scene, encounter }),
        context: historyContext(history, config.historyChars), scene,
        message: encounterMessage({ character, encounter, scene }),
      });
      await converse({ llm, messages, temperature: config.temperature, log: debugLog(`${gameId}:${character.id}`), signal,
        runTool, toolset: ENCOUNTER_TOOLS, spokenLimit: 1 });
    } catch (error) {
      if (error.name === "AbortError") break;
      // The game moved on (409) or the LLM failed: the encounter just passes without a reaction.
      onStatus?.(`${character.name}: no reaction (${error.message})`);
    }
  }
  return changed;
}

/** Whether characters keep memories written by the LLM, and whether they pass news about the player on to each other. */
export function memoriesEnabled() { return !!activeLlm() && loadLlmConfig().memories !== false; }
export function gossipEnabled() {
  const llm = activeLlm();
  return !!llm && llm.tools !== false && loadLlmConfig().gossip !== false;
}

/**
 * Asks the LLM for a character's memory brought up to date: her previous memory and the history since it. Returns the
 * text and the newest event it takes in (to save with the memory), or undefined if there is nothing new.
 */
export async function writeMemory({ llm, history, gameId, gameTitle, signal }) {
  const config = loadLlmConfig();
  const since = sinceMemory(history);
  if (!since.entries.length) return undefined;
  const text = await complete({
    llm, temperature: 0.4, signal, json: false, log: debugLog(`${gameId}:${history.character.id}`),
    messages: memoryMessages({ character: history.character, gameTitle, previous: history.memory?.text ?? "",
      since: historyContext(since, config.historyChars) }),
  });
  const memory = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return memory ? { text: memory, covers: history.entries[0]?.id ?? null } : undefined;
}

/**
 * Brings the memory of each character in `characters` up to date (at the start of a new day), one after another.
 * `game` holds history(id) and remember(id, text, covers).
 */
export async function runMemories({ characters, game, gameId, gameTitle, signal, onStatus }) {
  const llm = activeLlm();
  if (!llm) return;
  for (const character of characters) {
    if (signal.aborted) break;
    onStatus?.(`${character.name} is thinking back on the day…`);
    try {
      const history = await game.history(character.id);
      const memory = await writeMemory({ llm, history, gameId, gameTitle, signal });
      if (memory) await game.remember(character.id, memory.text, memory.covers);
    } catch (error) {
      if (error.name === "AbortError") break;
      onStatus?.(`${character.name}: no memory written (${error.message})`);
    }
  }
}

/**
 * Lets characters who just met away from the player pass on news about the player: the teller may tell the listener
 * something (or nothing); if she does, the listener may change her feelings about the player and answer. Both go into
 * the event the two share in their histories. `game` holds history(id) and runTool(id, name, args) (talking aside).
 */
export async function runGossip({ gossip, game, gameId, gameTitle, signal, onStatus }) {
  const llm = activeLlm();
  if (!llm) return;
  const config = loadLlmConfig();
  const turn = async (character, other, place, told) => {
    const history = await game.history(character.id);
    const scene = await game.runTool(character.id, "describe_scene", {})
      .then(({ result }) => result && !result.error && Object.keys(result).length ? result : undefined, () => undefined);
    // A written-out reply counts only for what it puts in quotes, said to the other character.
    const textReply = (text) => textReplyCalls(text).filter((call) => call.name === "say")
      .map((call) => ({ name: "tell", args: { person: other.name, text: call.args.text } }));
    const { tools } = await converse({
      llm, temperature: config.temperature, log: debugLog(`${gameId}:${character.id}`), signal, spokenLimit: 1, textReply,
      toolset: told ? LISTENER_TOOLS : GOSSIP_TOOLS,
      runTool: async (name, args) => (await game.runTool(character.id, name, args)).result,
      messages: [
        { role: "system", content: gossipPrompt({ character, other, place, gameTitle, instructions: config.instructions, scene, told }) },
        { role: "system", content: historyContext(history, config.historyChars) },
        ...(scene ? [{ role: "system", content: sceneContext(scene) }] : []),
        { role: "user", content: told ? `What does ${character.name} do?` : `Does ${character.name} tell ${other.name} anything about the player?` },
      ],
    });
    const said = tools.find((tool) => tool.name === "tell" && !tool.result?.error);
    return said ? String(said.arguments.text) : undefined;
  };
  for (const { teller, listener, place } of gossip) {
    if (signal.aborted) break;
    onStatus?.(`${teller.name} is chatting with ${listener.name}…`);
    try {
      const told = await turn(teller, listener, place);
      if (told && !signal.aborted) await turn(listener, teller, place, told);
    } catch (error) {
      if (error.name === "AbortError") break;
      onStatus?.(`${teller.name} and ${listener.name}: nothing passed on (${error.message})`);
    }
  }
}
