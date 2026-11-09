import { activeLlm, buildMessages, converse, debugLog, handedOver, loadLlmConfig, parseReply, PROVIDERS, systemPrompt, TOOLS, toolsFor } from "./llm.js";
import { speechQuotes } from "./translate.js";
import { syncChromeControllerHints } from "./controller-menu.js";

let expanded = true;
const inlineChats = new WeakMap();
const HISTORY_KEY = "era-typescript.character-history";

export function characterHistoryEnabled() {
  const saved = localStorage.getItem(HISTORY_KEY);
  return saved === null ? globalThis.eraDesktop?.steam !== true : saved === "1";
}

export function setupCharacterHistoryToggle(onChange) {
  const toggle = document.querySelector("#character-history-toggle");
  const apply = () => { toggle.checked = characterHistoryEnabled(); };
  apply();
  toggle.addEventListener("click", () => {
    localStorage.setItem(HISTORY_KEY, characterHistoryEnabled() ? "0" : "1");
    apply();
    onChange();
  });
  return {
    reset() {
      localStorage.removeItem(HISTORY_KEY);
      apply();
      onChange();
    },
  };
}

export function disposeCharacterChats(root) {
  for (const host of root.querySelectorAll(".era-main-chat")) inlineChats.get(host)?.dispose();
}

export function sendInlineChat(host) {
  const controller = inlineChats.get(host);
  if (!controller) throw new Error("The selected character's chat is no longer available.");
  return controller.send();
}

export function setupInlineChat(parent, history, loadAll, chat) {
  const main = parent.closest(".era-main");
  if (!main || !chat || main.querySelector(".era-main-chat")) return;
  const room = main.querySelector(".era-character");
  if (!room) return;
  const host = element("section", "era-main-chat");
  host.setAttribute("aria-label", `Chat with ${history.character.name}`);
  const pane = element("div", "era-history-pane");
  const content = element("div");
  pane.append(content);
  host.append(pane);
  room.append(host);
  const cleanup = [];
  const controller = setupChat({ dialog: host, pane, content, history, loadAll, chat, cleanup, inline: true });
  const observer = new ResizeObserver(() => scrollHistoryToBottom(content));
  observer.observe(pane);
  observer.observe(content);
  cleanup.push(() => observer.disconnect());
  let disposed = false;
  inlineChats.set(host, {
    send: controller.send,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const done of cleanup) done();
    },
  });
  protectHistoryControls(host);
}

function protectHistoryControls(parent) {
  for (const type of ["click", "pointerdown", "keydown", "contextmenu"])
    parent.addEventListener(type, (event) => {
      if ((type === "click" || type === "pointerdown")
        && !event.target?.closest("button, a[href], input, textarea, select, summary, dialog, [contenteditable]:not([contenteditable='false'])")) return;
      event.stopPropagation();
    });
}

function scrollHistoryToBottom(parent) {
  requestAnimationFrame(() => {
    for (const element of [parent, parent.querySelector(".era-history-body"), parent.closest(".era-history-pane"), parent.closest(".era-history-dialog")]) {
      if (element) element.scrollTop = element.scrollHeight;
    }
  });
}

function clock(context) {
  const minutes = BigInt(context.time[0]);
  const hour = ((minutes / 60n) % 24n).toString().padStart(2, "0");
  const minute = (minutes % 60n).toString().padStart(2, "0");
  return `Day ${context.day}, ${hour}:${minute}`;
}

function compactRuns(runs, entry, speaker, playerName = "Player", narrationName = playerName, hideNarrationPrefix = false) {
  const content = runs.map((run) => run.text).join("");
  const quoted = speechQuotes(content);
  const result = [];
  const append = (text, color, speaker = false) => {
    const last = result.at(-1);
    if (last && last.color === color && !!last.speaker === speaker) last.text += text;
    else result.push({ text, color, ...(speaker ? { speaker: true } : {}) });
  };
  for (const match of content.matchAll(/[^\r\n]+/g)) {
    if (!match[0].trim() || /^-{3,}$/.test(match[0].trim())) continue;
    const line = match[0].trim();
    const roomIntro = entry.participants.some((person) =>
      line === `${person.name} was in the ${entry.before.locationName}.`);
    const teaIntro = entry.action.id === 301 && entry.participants.some((person) =>
      line === `You serve some tea to ${person.name}...`
      || line === `You serve some tea to ${person.name} and the others...`
      || line === `You offer to take a break and serve some tea to ${person.name}...`
      || line === `You offer to take a break and serve some tea to ${person.name} and the others...`);
    if (roomIntro || teaIntro) continue;
    const legacyNarration = [playerName, ...entry.participants.map((person) => person.name)]
      .map((name) => `${name} (narration): `).find((prefix) => line.startsWith(prefix));
    let start = match.index + match[0].length - match[0].trimStart().length + (legacyNarration?.length ?? 0);
    const end = match.index + match[0].trimEnd().length;
    const attributed = [playerName, ...entry.participants.map((person) => person.name)].some((name) =>
      line.startsWith(`${name}:`) || line.startsWith(`${name} (thought):`));
    const narration = `Narration to ${narrationName}: `;
    const tool = TOOLS.some(({ function: fn }) => line.startsWith(`${fn.name}(`));
    const conversation = entry.action.id === "chat" || entry.action.id === "gossip";
    let prefix = speaker && /^["“「]/.test(line) ? `${speaker}: `
      : conversation || attributed || tool || /^["“「`]/.test(line) || line.startsWith(narration) ? "" : narration;
    if (conversation && speaker && !prefix && !attributed && !tool && !line.startsWith("`")
      && !line.startsWith(narration) && !/^[^:\n]+:\s/.test(line)) prefix = `${speaker}: `;
    if (hideNarrationPrefix && narrationName === playerName) {
      if (prefix === narration) prefix = "";
      if (line.startsWith(narration)) start += narration.length;
    }
    if (result.length) append("\n", result.at(-1).color);
    const nameLength = quoted.slice(start, end).match(/^[^:\n]+:\s*(?=「)/)?.[0].length ?? 0;
    let offset = 0;
    for (const run of runs) {
      const from = Math.max(start, offset), to = Math.min(end, offset + run.text.length);
      const text = quoted.slice(from, Math.max(from, to));
      offset += run.text.length;
      if (text) {
        if (prefix) {
          const label = prefix === `${speaker}: `;
          append(prefix, label ? undefined : run.color, label);
          prefix = "";
        }
        const labelEnd = Math.min(to, start + nameLength);
        if (labelEnd > from) append(quoted.slice(from, labelEnd), undefined, true);
        if (to > Math.max(from, labelEnd)) append(quoted.slice(Math.max(from, labelEnd), to), run.color);
      }
    }
  }
  return result;
}

function attributedRuns(line, entry, player, hideNarrationPrefix = false) {
  const speaker = entry.participants.find((person) => person.id === line.character)?.name
    ?? (entry.action.id === "chat" && line.character === null ? player?.name ?? "Player" : undefined);
  const reaction = entry.source === "state" && entry.action.id === "reaction";
  const narrationName = reaction ? speaker : player?.name;
  const isPlayer = line.character === player?.id || (entry.action.id === "chat" && line.character === null);
  return compactRuns(line.runs ?? [{ text: line.text }], entry, speaker, player?.name ?? "Player",
    narrationName ?? player?.name ?? "Player", hideNarrationPrefix)
    .map((run) => ({ ...run, ...(line.thought ? { thought: true } : {}),
      ...(isPlayer || reaction ? { color: "#c5a3ff" } : {}) }));
}

function changes(entry) {
  const result = [];
  for (const [field, label] of [["affection", "Favor"], ["trust", "Trust"]]) {
    const delta = BigInt(entry.after[field]) - BigInt(entry.before[field]);
    if (delta !== 0n) result.push(`${label}${delta > 0n ? "+" : ""}${delta}`);
  }
  for (const [mark, label] of [["hate", "Hate Mark"], ["pain", "Pain Mark"], ["pleasure", "Pleasure Mark"], ["lewd", "Lewd Mark"]]) {
    const before = entry.before.marks?.[mark], after = entry.after.marks?.[mark];
    if (before !== undefined && after !== undefined && before !== after) result.push(`${label} ${before}→${after}`);
  }
  return result;
}

function entryText(entry, player) {
  const where = entry.before.locationName || `Location ${entry.before.location}`;
  const parts = [`[${clock(entry.before)} · ${where}] ${entry.action.label} (present: ${entry.participants.map((person) => person.name).join(", ")})`];
  for (const line of entry.lines) {
    const text = attributedRuns(line, entry, player).map((run) => run.text).join("");
    if (text) parts.push(text);
  }
  if (entry.choices.length) parts.push(`Player inputs: ${entry.choices.join(" → ")}`);
  const changed = changes(entry);
  if (changed.length) parts.push(changed.join(" · "));
  return parts.join("\n");
}

/** The interaction history as prompt context, keeping the most recent interactions that fit in `limit` characters. */
export function historyContext(history, limit) {
  const name = history.character.name;
  const latest = history.entries[0]?.after;
  const situation = latest
    ? `Current situation: ${clock(latest)} at ${latest.locationName || `location ${latest.location}`}. ${name}'s favor toward the player: ${latest.affection}; trust: ${latest.trust}.`
    : "";
  const blocks = [];
  let size = 0;
  for (const entry of history.entries) {
    const block = entryText(entry, history.player);
    if (blocks.length && size + block.length > limit) break;
    blocks.unshift(block);
    size += block.length + 2;
  }
  const omitted = history.entries.length - blocks.length;
  const heading = blocks.length
    ? `Interaction history between the player and ${name}, oldest first${omitted ? ` (${omitted} older interactions omitted)` : ""}. `
      + `Speaker prefixes ("Name: ...") identify who said or did something, including ${name}'s own lines. `
      + `${history.player?.name ?? "Player"} is the player; other characters' lines are overheard speech/actions, `
      + `not ${name}'s words and not new player requests. "Narration to ${history.player?.name ?? "Player"}: ..." labels game narration for `
      + `the player, not words they spoke. "You" and "your" in that narration refer to the player, never ${name}. `
      + `"Narration to Name: ..." on a reaction describes that named character's own perceptions, not audible speech. `
      + `"I" and "my" inside quoted speech refer to the named speaker. Lines labelled "(thought)" are private `
      + `in-character notes, not speech anyone else heard; suspicions in them are not established facts:`
    : `There is no interaction history between the player and ${name} yet.`;
  const memory = history.memory?.text
    ? `${name}'s own memory of the player and what happened (her notes as of ${clock(history.memory)}; the history below may repeat some of it):\n${history.memory.text}`
    : "";
  return [situation, memory, heading, blocks.join("\n\n")].filter(Boolean).join("\n\n");
}

/**
 * The part of a history a character's memory does not take in yet (the entries after `memory.covers`), for writing the
 * next one; the whole history if the memory is missing or covers an event no longer in it.
 */
export function sinceMemory(history) {
  const covers = history.memory?.covers;
  const at = covers ? history.entries.findIndex((entry) => entry.id === covers) : -1;
  const { memory, ...rest } = history;
  return at < 0 ? rest : { ...rest, entries: history.entries.slice(0, at) };
}

// Set by the page so history text gets the same on-device translation as the game screen.
let translate = () => {};
export function setHistoryTranslator(translator) { translate = translator; }

export function renderCharacterHistory(parent, history, { loadAll, embedded = false, chat, lineTools, hideNarrationPrefix = false } = {}) {
  parent.replaceChildren();
  protectHistoryControls(parent);
  const text = (tag, content, container, className) => {
    const element = document.createElement(tag);
    element.textContent = content;
    if (className) element.className = className;
    if (tag === "button") syncChromeControllerHints(element);
    container.append(element);
    return element;
  };
  const panel = document.createElement(embedded ? "div" : "details");
  panel.open = expanded;
  parent.append(panel);
  if (!embedded) {
    text("summary", `${history.character.name}'s interaction history (${history.entries.length})`, panel);
    panel.addEventListener("toggle", () => { expanded = panel.open; });
  }
  if (loadAll) {
    const overlay = text("div", "", panel, "era-history-more-overlay");
    const open = text("button", "more...", overlay, "era-history-more ui-button ui-button--quiet ui-button--small");
    open.type = "button";
    open.setAttribute("aria-label", "View all interaction history");
    open.addEventListener("click", async () => {
      const dialog = document.createElement("dialog");
      dialog.className = "era-history-dialog";
      parent.append(dialog);
      const header = text("div", "", dialog, "era-history-toolbar");
      text("h2", `${history.character.name}'s interaction history`, header);
      const tabs = text("div", "", header, "era-history-tabs");
      const close = text("button", "Close", header, "ui-button ui-button--quiet");
      close.type = "button";
      close.setAttribute("data-controller-hint", "B");
      const pane = text("div", "", dialog, "era-history-pane");
      const content = text("div", "Loading history...", pane);
      const cleanup = [];
      close.addEventListener("click", () => dialog.close());
      dialog.addEventListener("close", () => { for (const done of cleanup) done(); dialog.remove(); open.focus(); });
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); dialog.close(); });
      dialog.showModal();
      try {
        const all = await loadAll();
        if (!dialog.isConnected) return;
        renderCharacterHistory(content, all, { embedded: true });
        if (chat) setupChat({ dialog, tabs, pane, content, history: all, loadAll, chat, cleanup });
      } catch (error) {
        if (dialog.isConnected) content.textContent = `Could not load interaction history: ${error.message}`;
      }
    });
  }
  const body = document.createElement("div");
  body.className = "era-history-body";
  panel.append(body);
  if (!history.entries.length) text("em", "No interaction yet", body);
  let group, item;
  for (const [index, entry] of [...history.entries].reverse().entries()) {
    const key = JSON.stringify([entry.before.day, entry.before.location,
      entry.participants.map((person) => person.id).sort()]);
    if (key !== group) {
      group = key;
      item = text("section", "", body, "era-history-entry");
      const heading = text("p", `${clock(entry.before)} · ${entry.action.label} · `, item, "era-history-heading");
      text("span", entry.before.locationName || `Location ${entry.before.location}`, heading);
      const separator = text("span", " · ", heading, "notranslate");
      separator.setAttribute("translate", "no");
      text("span", entry.participants.map((person) => person.name).join(", "), heading);
    }
    const lines = entry.lines.map((line, index) => ({
      index, character: line.character, runs: attributedRuns(line, entry, history.player, hideNarrationPrefix),
    })).filter((line) => line.runs.length);
    for (const line of lines) {
      const paragraph = text("p", "", item, "era-history-text");
      for (const run of line.runs) {
        const span = text(run.thought ? "em" : "span", run.text, paragraph);
        if (/^(?:#[0-9a-f]{3}(?:[0-9a-f]{3})?|[a-z]{1,30})$/i.test(run.color)) span.style.color = run.color;
        if (run.speaker && run.color !== "#c5a3ff") span.style.color = "#bfc8ce";
      }
      const tools = lineTools?.(entry, line.index, index === history.entries.length - 1);
      if (tools) paragraph.append(tools);
    }
    if (!lines.length) text("p", "No text was printed by this command.", item);
    if (entry.choices.length) text("p", `Player inputs: ${entry.choices.join(" → ")}`, item, "era-history-text");
    const changed = changes(entry);
    if (changed.length) text("p", changed.join(" · "), item, "era-history-note");
    if (entry.truncated) text("p", "This interaction exceeded the capture limit; its text was truncated.", item, "era-history-notice");
  }
  translate(parent);
  scrollHistoryToBottom(parent);
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (tag === "button") syncChromeControllerHints(node);
  if (content !== undefined) node.textContent = content;
  return node;
}

function formatJson(value) { return typeof value === "string" ? value : JSON.stringify(value, null, 2); }

function renderDebug(container, log) {
  container.replaceChildren();
  if (!log.length) {
    container.append(element("p", "era-history-note", "Nothing has been sent to the LLM from this page yet. Requests and responses appear here; the API key is never shown."));
    return;
  }
  for (const [index, entry] of log.entries()) {
    const item = element("details", "era-llm-debug-entry");
    item.open = index === log.length - 1;
    const seconds = entry.status === "pending" ? "" : ` · ${(entry.duration / 1000).toFixed(1)}s`;
    item.append(element("summary", "", `${new Date(entry.time).toLocaleTimeString()} · ${PROVIDERS[entry.provider]?.label ?? entry.provider} · ${entry.model} · ${entry.status}${seconds}`));
    item.append(element("h3", "", `Sent: POST ${entry.url}`));
    for (const message of entry.sent.messages) {
      item.append(element("p", "era-llm-debug-role", message.role === "tool" ? `tool result (${message.name})` : message.role));
      if (message.content) item.append(element("pre", "era-llm-debug-text", message.content));
      for (const call of message.tool_calls ?? []) item.append(element("pre", "era-llm-debug-text is-tool", toolCallText(call)));
    }
    if (entry.sent.tools) item.append(element("p", "era-history-note", `Tools offered: ${entry.sent.tools.map((tool) => tool.function.name).join(", ")}`));
    const sentRaw = element("details", "era-llm-debug-raw");
    sentRaw.append(element("summary", "", "Request JSON"), element("pre", "era-llm-debug-text", formatJson(entry.sent)));
    item.append(sentRaw);
    item.append(element("h3", "", "Received"));
    if (entry.error) item.append(element("p", "era-history-notice", entry.error));
    const received = entry.received?.choices?.[0]?.message;
    if (typeof received?.content === "string" && received.content) item.append(element("pre", "era-llm-debug-text", received.content));
    for (const call of received?.tool_calls ?? []) item.append(element("pre", "era-llm-debug-text is-tool", toolCallText(call)));
    if (entry.received !== null) {
      const receivedRaw = element("details", "era-llm-debug-raw");
      receivedRaw.append(element("summary", "", "Response JSON"), element("pre", "era-llm-debug-text", formatJson(entry.received)));
      item.append(receivedRaw);
    } else if (entry.status === "pending") item.append(element("p", "era-history-note", "Waiting for the response..."));
    container.append(item);
  }
}

/**
 * The character's voice for the LLM (her kojo's description and example lines), editable: the game generates it,
 * and the player can change it and save it to disk, after which the saved version is sent instead.
 */
function voiceEditor(chat, character) {
  const section = element("section", "era-llm-voice");
  const summary = element("h3", "era-llm-voice-title", "Character voice");
  const note = element("p", "era-history-note");
  const field = (label, rows, hint) => {
    const wrapper = element("label", "era-llm-voice-field");
    const textarea = element("textarea");
    textarea.rows = rows;
    textarea.spellcheck = false;
    wrapper.append(element("span", "", label), textarea);
    if (hint) wrapper.append(element("small", "era-history-note", hint));
    return { wrapper, textarea };
  };
  const description = field("Description", 4, "Identity, traits and background from the game, followed by the character's introduction.");
  const examples = field("Example lines", 8, "One per line. Sent with every message so the model matches how the character talks.");
  const intimate = field("Example lines in intimate scenes", 6, "One per line. Used instead of the lines above during an intimate scene.");
  const save = element("button", "ui-button ui-button--primary", "Save");
  const revert = element("button", "ui-button", "Revert to generated");
  const download = element("button", "ui-button", "Download PNG card");
  for (const button of [save, revert, download]) button.type = "button";
  const status = element("span", "era-history-note");
  const actions = element("div", "era-llm-voice-actions");
  actions.append(save, revert, status);
  if (chat.downloadCard) actions.insertBefore(download, status);
  section.append(summary, note, description.wrapper, examples.wrapper, intimate.wrapper, actions);
  let settings = null;
  let loading = null;
  const lines = (textarea) => textarea.value.split("\n").map((line) => line.trim().replace(/^「([\s\S]*)」$/, "$1").trim()).filter(Boolean);
  const show = (voice) => {
    description.textarea.value = voice.description;
    examples.textarea.value = voice.examples.join("\n");
    intimate.textarea.value = voice.intimateExamples.join("\n");
  };
  const showState = () => {
    const where = settings.location ? ` to ${settings.location}` : " for this server run";
    summary.textContent = `Character voice (${settings.saved ? "edited" : "generated"})`;
    note.textContent = settings.saved
      ? `Your edited voice for ${character.name} is sent with every message (saved${where}).`
      : `Generated from ${character.name}'s kojo for the current game state. Edit and save to use your version instead (saved${where}).`;
    revert.disabled = !settings.saved;
    download.disabled = !settings.saved;
  };
  const load = () => loading ??= chat.voice().then((result) => {
    settings = result;
    show(settings.saved ?? settings.generated);
    showState();
  }, (error) => {
    loading = null;
    note.textContent = `Could not load the voice: ${error.message}`;
  });
  const store = async (voice) => {
    save.disabled = revert.disabled = download.disabled = true;
    status.textContent = "Saving…";
    try {
      await chat.saveVoice(voice);
      settings.saved = voice;
      if (!voice) show(settings.generated);
      status.textContent = voice
        ? settings.location ? `Saved to ${settings.location}.` : "Saved for this server run."
        : "Reverted to the generated voice.";
    } catch (error) {
      status.textContent = `Could not save: ${error.message}`;
    } finally {
      save.disabled = false;
      showState();
    }
  };
  save.addEventListener("click", () => {
    if (settings) void store({ description: description.textarea.value.trim(), examples: lines(examples.textarea), intimateExamples: lines(intimate.textarea) });
  });
  revert.addEventListener("click", () => { if (settings) void store(null); });
  download.addEventListener("click", async () => {
    download.disabled = true;
    try {
      const url = URL.createObjectURL(await chat.downloadCard());
      const link = element("a");
      link.href = url;
      link.download = `${character.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = "Downloaded the saved Character Card V2 PNG.";
    } catch (error) { status.textContent = `Could not download: ${error.message}`; }
    finally { showState(); }
  });
  for (const { textarea } of [description, examples, intimate]) textarea.addEventListener("input", () => { status.textContent = "Unsaved changes."; });
  return { section, load };
}

/**
 * The character's memory (her own summary of the history, sent with every prompt), editable: the LLM writes it at the
 * start of each day, or now with "Write now", and the player can change and save it.
 */
function memoryEditor(chat, character, loadAll) {
  const section = element("details", "era-llm-voice");
  const summary = element("summary", "", "Character memory");
  const note = element("p", "era-history-note");
  const wrapper = element("label", "era-llm-voice-field");
  const textarea = element("textarea");
  textarea.rows = 8;
  wrapper.append(element("span", "", "What she remembers of the player"), textarea);
  const save = element("button", "ui-button ui-button--primary", "Save");
  const write = element("button", "ui-button", "Write now");
  const clear = element("button", "ui-button", "Clear");
  for (const button of [save, write, clear]) button.type = "button";
  const status = element("span", "era-history-note");
  const actions = element("div", "era-llm-voice-actions");
  actions.append(save, write, clear, status);
  section.append(summary, note, wrapper, actions);
  let history = null, covers = null, loading = null;
  const show = () => {
    const memory = history.memory;
    textarea.value = memory?.text ?? "";
    covers = memory?.covers ?? history.entries[0]?.id ?? null;
    summary.textContent = `Character memory${memory ? ` (as of ${clock(memory)})` : " (none yet)"}`;
    note.textContent = memory
      ? `Sent with every prompt for ${character.name}. It is rewritten at the start of each day from this and what happened since.`
      : `${character.name} has no memory yet. One is written at the start of each new day, or now with Write now.`;
  };
  const load = () => loading ??= loadAll().then((result) => { history = result; show(); }, (error) => {
    loading = null;
    note.textContent = `Could not load the memory: ${error.message}`;
  });
  const busy = (on) => { save.disabled = write.disabled = clear.disabled = on; };
  const store = async (text, at) => {
    status.textContent = "Saving…";
    const { memory } = await chat.remember(text, at);
    history = { ...history, memory: memory ?? undefined };
    show();
    status.textContent = text ? "Saved." : "Cleared.";
  };
  save.addEventListener("click", async () => {
    if (!history) return;
    busy(true);
    // A memory edited by hand takes in the history up to now, like one written by the LLM.
    try { await store(textarea.value.trim(), history.entries[0]?.id ?? null); }
    catch (error) { status.textContent = `Could not save: ${error.message}`; }
    finally { busy(false); }
  });
  clear.addEventListener("click", async () => {
    if (!history) return;
    busy(true);
    try { await store("", covers); }
    catch (error) { status.textContent = `Could not clear: ${error.message}`; }
    finally { busy(false); }
  });
  write.addEventListener("click", async () => {
    if (!activeLlm()) {
      document.dispatchEvent(new Event("era-llm-configure"));
      return;
    }
    busy(true);
    status.textContent = `${character.name} is thinking back…`;
    try {
      loading = null;
      history = await loadAll();
      const memory = await chat.writeMemory(history);
      if (!memory) status.textContent = history.memory ? "Nothing new since the last memory." : `Nothing has happened with ${character.name} yet.`;
      else await store(memory.text, memory.covers);
    } catch (error) { status.textContent = `Could not write the memory: ${error.message}`; }
    finally { busy(false); }
  });
  textarea.addEventListener("input", () => { status.textContent = "Unsaved changes."; });
  section.addEventListener("toggle", () => { if (section.open) void load(); });
  return { section, load };
}

function toolCallText(call) {
  const args = call.function?.arguments;
  return `→ ${call.function?.name ?? "?"}(${typeof args === "string" ? args : JSON.stringify(args ?? {})})`;
}

/** The words of a chat line the player sent (see Runtime.chatMessage), as they would be typed again. */
function typed(text) {
  return text.split(/(\*[^*]+\*)/).map((part) => part.trim()).filter(Boolean)
    .map((part) => part.startsWith("*") ? part : part.replace(/^"([\s\S]*)"$/, "$1")).join(" ");
}

/**
 * Adds chatting with the character to a history dialog or inline panel, plus a debug tab showing the LLM traffic. Whatever
 * the player and the character say and do goes straight into the interaction history, which is redrawn as it grows.
 */
function setupChat({ dialog, tabs, pane, content, history, loadAll, chat, cleanup, inline = false }) {
  const character = history.character;
  const log = debugLog(`${chat.gameId}:${character.id}`);
  let pending = null;
  let disposed = false;
  // Dialogs defer room updates until close; inline chat refreshes after each turn.
  let changed = false;

  const form = element("form", "era-llm-composer");
  form.lang = "en";
  const status = element("p", "era-llm-status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  const textarea = inline ? chat.input : element("textarea");
  if (!inline) {
    textarea.rows = 2;
    textarea.placeholder = `Say something to ${character.name}, or *do something*… (Enter to send, Shift+Enter for a new line)`;
    textarea.setAttribute("aria-label", `Message to ${character.name}`);
  }
  const send = element("button", "ui-button ui-button--primary", "Send");
  send.type = "submit";
  const stop = element("button", "ui-button ui-button--quiet", "Cancel");
  stop.type = "button";
  stop.hidden = true;
  const actions = element("div", "era-llm-composer-actions");
  const state = element("span", "era-llm-state");
  const configure = element("button", "era-llm-configure ui-button ui-button--small", "LLM settings…");
  configure.type = "button";
  actions.append(state, configure);
  const row = element("div", "era-llm-composer-row");
  if (!inline) row.append(textarea, send, stop);
  form.append(status, row, actions);
  if (inline) dialog.append(status);
  else dialog.append(form);

  const debugPane = element("div", "era-history-pane era-llm-debug");
  debugPane.hidden = true;
  const debugLogPane = element("div");
  const voice = !inline && chat.voice && chat.saveVoice ? voiceEditor(chat, character) : null;
  const cardPane = element("div", "era-history-pane era-llm-card");
  cardPane.hidden = true;
  if (voice) {
    cardPane.append(voice.section);
    dialog.append(cardPane);
  }
  const memory = !inline && chat.remember && chat.writeMemory ? memoryEditor(chat, character, loadAll) : null;
  if (memory) debugPane.append(memory.section);
  debugPane.append(debugLogPane);
  if (!inline) dialog.append(debugPane);
  const historyTab = element("button", "era-info-tab ui-button ui-button--tab", "History & chat");
  const cardTab = element("button", "era-info-tab ui-button ui-button--tab", "Character card");
  const debugTab = element("button", "era-info-tab ui-button ui-button--tab", "LLM debug");
  for (const tab of [historyTab, cardTab, debugTab]) tab.type = "button";
  if (!inline) {
    tabs.append(historyTab);
    if (voice) tabs.append(cardTab);
    tabs.append(debugTab);
  }
  const select = (tab) => {
    pane.hidden = tab !== "history";
    form.hidden = tab !== "history";
    cardPane.hidden = tab !== "card";
    debugPane.hidden = tab !== "debug";
    historyTab.setAttribute("aria-pressed", String(tab === "history"));
    cardTab.setAttribute("aria-pressed", String(tab === "card"));
    debugTab.setAttribute("aria-pressed", String(tab === "debug"));
    if (tab === "card" && voice) {
      void voice.load();
    }
    if (tab === "debug") {
      void memory?.load();
      renderDebug(debugLogPane, log);
      debugPane.scrollTop = debugPane.scrollHeight;
    }
  };
  historyTab.addEventListener("click", () => select("history"));
  cardTab.addEventListener("click", () => select("card"));
  debugTab.addEventListener("click", () => select("debug"));
  const refreshDebug = () => {
    debugTab.textContent = `LLM debug (${log.length})`;
    if (!debugPane.hidden) renderDebug(debugLogPane, log);
  };

  const showState = () => {
    const llm = activeLlm();
    state.textContent = llm ? `${PROVIDERS[llm.provider].label} · ${llm.model}` : "No LLM set up yet: choose one in LLM settings.";
    if (changed && !inline) state.textContent += " · Close this window to see what happens in the room.";
  };
  const showStatus = (text, className = "era-history-note") => {
    status.textContent = text;
    status.className = `era-llm-status ${className}`;
    status.hidden = !text;
  };
  const onChanged = () => showState();
  document.addEventListener("era-llm-changed", onChanged);
  cleanup.push(() => document.removeEventListener("era-llm-changed", onChanged), () => pending?.abort(),
    () => { disposed = true; if (changed && !inline) void chat.refresh?.(); });

  /** Edit and Retry on the player's lines in the newest conversation: they take back that line and everything after it. */
  const lineTools = (entry, index, newest) => {
    const line = entry.lines[index];
    if (!newest || entry.action.id !== "chat" || (line.character !== null && line.character !== history.player?.id) || line.thought || pending) return undefined;
    const tools = element("span", "era-llm-message-tools");
    for (const [label, resend] of [["Edit", false], ["Retry", true]]) {
      const button = element("button", "ui-button ui-button--quiet ui-button--small", label);
      button.type = "button";
      button.title = `${resend ? "Send this message again" : "Edit this message"}: it and everything after it are removed from the history. Game changes the removed replies made stay.`;
      const prefix = `${history.player?.name ?? "Player"}: `;
      const message = line.text.startsWith(prefix) ? line.text.slice(prefix.length) : line.text;
      button.addEventListener("click", () => void rewind(entry.lines.length - index, typed(message), resend));
      tools.append(button);
    }
    return tools;
  };
  const render = () => renderCharacterHistory(content, history, {
    embedded: true, ...(inline ? { loadAll, chat, hideNarrationPrefix: true } : { lineTools }),
  });
  /** Redraws the history from the game, which has recorded what was just said or done. */
  const reload = async () => {
    if (disposed) return;
    try { history = await loadAll(); }
    catch (error) { showStatus(`Could not reload the history: ${error.message}`, "era-history-notice"); }
    if (dialog.isConnected && !disposed) render();
  };

  async function rewind(lines, message, resend) {
    if (pending || disposed) return;
    try { await chat.undo(lines); }
    catch (error) {
      showStatus(`Could not take the message back: ${error.message}`, "era-history-notice");
      return;
    }
    textarea.value = message;
    await reload();
    if (resend) void submit();
    else textarea.focus();
  }

  async function submit() {
    const message = textarea.value.trim();
    if (!message || pending || disposed) return;
    const llm = activeLlm();
    if (!llm) {
      document.dispatchEvent(new Event("era-llm-configure"));
      return;
    }
    const config = loadLlmConfig();
    let recorded = 0;
    const runTool = chat.runTool && llm.tools !== false ? async (name, args) => {
      const outcome = await chat.runTool(name, args);
      if (outcome.changed) changed = true;
      return outcome.result;
    } : undefined;
    pending = new AbortController();
    textarea.value = "";
    textarea.disabled = send.disabled = true;
    send.hidden = true;
    stop.hidden = false;
    showStatus("");
    // The history before this message is the context; the message itself is the player's turn.
    try {
      if (inline) history = await loadAll();
      if (disposed) return;
      const context = historyContext(history, config.historyChars);
      // The scene is optional: the game may not be at a command screen, and the chat still works without it.
      const scene = chat.runTool ? await chat.runTool("describe_scene", {}).then(({ result }) => result && !result.error && Object.keys(result).length ? result : undefined, () => undefined) : undefined;
      if (disposed) return;
      if (chat.record) {
        await chat.record(message);
        recorded = 1;
        await reload();
      }
      showStatus(`${character.name} is thinking…`);
      const prompt = buildMessages({
        system: systemPrompt({ character, gameTitle: chat.gameTitle, instructions: config.instructions, tools: !!runTool, scene }),
        context, scene, chat: [], message, tools: !!runTool,
        player: history.player?.name ?? scene?.player?.name ?? "Player",
      });
      const request = converse({ llm, messages: prompt, temperature: config.temperature, log, signal: pending.signal, runTool,
        toolset: toolsFor(scene), onTool: () => {
          recorded++;
          void reload();
          refreshDebug();
          showState();
        } });
      refreshDebug();
      const { content, tools } = await request;
      let spoke = tools.some((tool) => (tool.name === "say" || tool.name === "act") && !tool.result?.error);
      if (!runTool && chat.runTool) {
        // Without tool calling the reply is JSON; it goes into the room and the history the same way say and act would.
        const reply = parseReply(content);
        for (const [name, text] of [...reply.actions.map((action) => ["act", action]), ["say", reply.speech]]) {
          if (!text?.trim()) continue;
          const outcome = await chat.runTool(name, { text });
          if (outcome.changed) changed = true;
          spoke = true;
        }
      }
      await reload();
      const thought = tools.some((tool) => tool.name === "think" && !tool.result?.error);
      showStatus(spoke || handedOver(tools) ? "" : thought ? `${character.name} kept her thoughts to herself.` : `${character.name} did not reply.`);
      // The player's attempt or a scene command plays out on the game screen, which closing redraws.
      if (handedOver(tools) && !inline) dialog.close();
    } catch (error) {
      // A message nobody answered is taken back and returned to the box to try again.
      if (recorded === 1) {
        await chat.undo(1).catch(() => {});
        await reload();
      }
      if (!textarea.value) textarea.value = message;
      showStatus(error.name === "AbortError" ? "" : `No reply: ${error.message}`, "era-history-notice");
    } finally {
      pending = null;
      if (!inline) textarea.disabled = send.disabled = disposed;
      send.hidden = false;
      stop.hidden = true;
      refreshDebug();
      if (!disposed && (inline || dialog.open)) {
        render();
        if (!inline) textarea.focus();
      }
    }
    const result = { changed };
    if (inline) changed = false;
    return result;
  }

  if (!inline) {
    form.addEventListener("submit", (event) => { event.preventDefault(); void submit(); });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void submit();
      }
    });
  }
  stop.addEventListener("click", () => pending?.abort());
  configure.addEventListener("click", () => document.dispatchEvent(new Event("era-llm-configure")));
  // Keys and clicks in the composer are not game input.
  for (const type of ["click", "pointerdown", "keydown", "contextmenu"])
    form.addEventListener(type, (event) => event.stopPropagation());

  showState();
  refreshDebug();
  render();
  if (!inline) select("history");
  if (!inline) textarea.focus();
  return { send: submit };
}
