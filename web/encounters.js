import { activeLlm, buildMessages, converse, debugLog, ENCOUNTER_TOOLS, encounterMessage, loadLlmConfig, systemPrompt } from "./llm.js";
import { historyContext } from "./interaction-history.js";

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
