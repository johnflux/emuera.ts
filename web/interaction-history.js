import { activeLlm, buildMessages, converse, debugLog, handedOver, loadLlmConfig, parseReply, PROVIDERS, systemPrompt, toolsFor } from "./llm.js";

let expanded = true;
let selectedTab = "info";

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

function compactRuns(runs, entry) {
  const content = runs.map((run) => run.text).join("");
  const result = [];
  const append = (text, color) => {
    const last = result.at(-1);
    if (last && last.color === color) last.text += text;
    else result.push({ text, color });
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
    const start = match.index + match[0].length - match[0].trimStart().length;
    const end = match.index + match[0].trimEnd().length;
    if (result.length) append("\n", result.at(-1).color);
    let offset = 0;
    for (const run of runs) {
      const text = run.text.slice(Math.max(0, start - offset), Math.max(0, end - offset));
      offset += run.text.length;
      if (text) append(text, run.color);
    }
  }
  return result;
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

function entryText(entry) {
  const where = entry.before.locationName || `Location ${entry.before.location}`;
  const parts = [`[${clock(entry.before)} · ${where}] ${entry.action.label} (present: ${entry.participants.map((person) => person.name).join(", ")})`];
  for (const line of entry.lines) {
    const text = compactRuns(line.runs ?? [{ text: line.text }], entry).map((run) => run.text).join("");
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
    const block = entryText(entry);
    if (blocks.length && size + block.length > limit) break;
    blocks.unshift(block);
    size += block.length + 2;
  }
  const omitted = history.entries.length - blocks.length;
  const heading = blocks.length
    ? `Interaction history between the player and ${name}, oldest first${omitted ? ` (${omitted} older interactions omitted)` : ""}. `
      + `Lines starting with someone else's name ("Name: ...") are what that person said or did where ${name} could hear and see it:`
    : `There is no interaction history between the player and ${name} yet.`;
  return [situation, heading, blocks.join("\n\n")].filter(Boolean).join("\n\n");
}

// Set by the page so history text gets the same on-device translation as the game screen.
let translate = () => {};
export function setHistoryTranslator(translator) { translate = translator; }

export function renderCharacterHistory(parent, history, { loadAll, embedded = false, expandAll = false, chat, lineTools } = {}) {
  parent.replaceChildren();
  // Reading history must never submit a choice or advance a click-to-continue wait.
  for (const type of ["click", "pointerdown", "keydown", "contextmenu"])
    parent.addEventListener(type, (event) => event.stopPropagation());
  const text = (tag, content, container, className) => {
    const element = document.createElement(tag);
    element.textContent = content;
    if (className) element.className = className;
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
    const open = text("button", "more...", panel, "era-history-more");
    open.type = "button";
    open.setAttribute("aria-label", "View all interaction history");
    open.addEventListener("click", async () => {
      const dialog = document.createElement("dialog");
      dialog.className = "era-history-dialog";
      parent.append(dialog);
      const header = text("div", "", dialog, "era-history-toolbar");
      text("h2", `${history.character.name}'s interaction history`, header);
      const tabs = text("div", "", header, "era-history-tabs");
      const close = text("button", "Close", header);
      close.type = "button";
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
        renderCharacterHistory(content, all, { embedded: true, expandAll: true });
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
  for (const [index, entry] of [...history.entries].reverse().entries()) {
    const item = document.createElement("details");
    item.className = "era-history-entry";
    item.open = expandAll || index === history.entries.length - 1;
    body.append(item);
    text("summary", `${clock(entry.before)} · ${entry.action.label}`, item);
    const lines = entry.lines.map((line, index) => ({
      index, character: line.character, runs: compactRuns(line.runs ?? [{ text: line.text }], entry),
    })).filter((line) => line.runs.length);
    const note = text("p", "", item, "era-history-note");
    text("span", entry.before.locationName || `Location ${entry.before.location}`, note);
    const separator = text("span", " · ", note, "notranslate");
    separator.setAttribute("translate", "no");
    text("span", entry.participants.map((person) => person.name).join(", "), note);
    for (const line of lines) {
      const paragraph = text("p", "", item, "era-history-text");
      for (const run of line.runs) {
        const span = text("span", run.text, paragraph);
        if (/^(?:#[0-9a-f]{3}(?:[0-9a-f]{3})?|[a-z]{1,30})$/i.test(run.color)) span.style.color = run.color;
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

export function setupCharacterHistory(parent, history, loadAll, chat) {
  const card = parent.closest(".era-character-info");
  const tabs = card?.querySelector(".era-info-tabs");
  const title = tabs?.querySelector(".era-info-title");
  const info = card?.querySelector(".era-info-body");
  if (!tabs || !title || !info) {
    renderCharacterHistory(parent, history, { loadAll, chat });
    return;
  }
  renderCharacterHistory(parent, history, { loadAll, embedded: true, chat });
  const infoTab = document.createElement("button");
  infoTab.type = "button";
  infoTab.className = "era-info-tab";
  infoTab.textContent = "Character Info";
  title.replaceWith(infoTab);
  const historyTab = document.createElement("button");
  historyTab.type = "button";
  historyTab.className = "era-info-tab";
  historyTab.textContent = "Interaction History";
  infoTab.after(historyTab);
  function select(name) {
    selectedTab = name;
    info.hidden = name !== "info";
    parent.hidden = name !== "history";
    infoTab.setAttribute("aria-pressed", String(name === "info"));
    historyTab.setAttribute("aria-pressed", String(name === "history"));
    if (name === "history") scrollHistoryToBottom(parent);
  }
  for (const [tab, name] of [[infoTab, "info"], [historyTab, "history"]]) {
    for (const type of ["click", "pointerdown", "keydown", "contextmenu"])
      tab.addEventListener(type, (event) => event.stopPropagation());
    tab.addEventListener("click", () => select(name));
  }
  if (history.entries.length) {
    const runs = [...history.entries].reverse().flatMap((entry) => entry.lines.flatMap((line) => {
      const compact = compactRuns(line.runs ?? [{ text: line.text }], entry);
      return compact.length ? [...compact, { text: "\n" }] : [];
    }));
    const content = runs.map((run) => run.text).join("").trimEnd();
    const start = content.split("\n").slice(0, -10).reduce((length, line) => length + line.length + 1, 0);
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "era-history-preview";
    preview.setAttribute("aria-label", "View recent interactions in Interaction History");
    const previewText = document.createElement("span");
    previewText.className = "era-history-preview-content";
    const viewport = document.createElement("span");
    viewport.className = "era-history-preview-viewport";
    viewport.append(previewText);
    preview.append(viewport);
    let offset = 0;
    for (const run of runs) {
      const value = run.text.slice(Math.max(0, start - offset), Math.max(0, content.length - offset));
      offset += run.text.length;
      if (!value) continue;
      const span = document.createElement("span");
      span.textContent = value;
      if (/^(?:#[0-9a-f]{3}(?:[0-9a-f]{3})?|[a-z]{1,30})$/i.test(run.color)) span.style.color = run.color;
      previewText.append(span);
    }
    if (content) {
      for (const type of ["click", "pointerdown", "keydown", "contextmenu"])
        preview.addEventListener(type, (event) => event.stopPropagation());
      preview.addEventListener("click", () => { select("history"); historyTab.focus(); });
      const space = document.createElement("div");
      space.className = "era-history-preview-space";
      space.append(preview);
      info.append(space);
      info.className += " era-info-with-preview";
      translate(previewText);
    }
  }
  select(selectedTab);
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
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
  const section = element("details", "era-llm-voice");
  const summary = element("summary", "", "Character voice");
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
  const description = field("Description", 4, "How the game introduces the character.");
  const examples = field("Example lines", 8, "One per line. Sent with every message so the model matches how the character talks.");
  const intimate = field("Example lines in intimate scenes", 6, "One per line. Used instead of the lines above during an intimate scene.");
  const save = element("button", "", "Save");
  const revert = element("button", "", "Revert to generated");
  for (const button of [save, revert]) button.type = "button";
  const status = element("span", "era-history-note");
  const actions = element("div", "era-llm-voice-actions");
  actions.append(save, revert, status);
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
    save.disabled = revert.disabled = true;
    status.textContent = "Saving…";
    try {
      await chat.saveVoice(voice);
      settings.saved = voice;
      if (!voice) show(settings.generated);
      status.textContent = voice ? "Saved." : "Reverted to the generated voice.";
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
  for (const { textarea } of [description, examples, intimate]) textarea.addEventListener("input", () => { status.textContent = "Unsaved changes."; });
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
 * Adds chatting with the character to the full-history dialog, plus a debug tab showing the LLM traffic. Whatever
 * the player and the character say and do goes straight into the interaction history, which is redrawn as it grows.
 */
function setupChat({ dialog, tabs, pane, content, history, loadAll, chat, cleanup }) {
  const character = history.character;
  const log = debugLog(`${chat.gameId}:${character.id}`);
  let pending = null;
  // Set once a tool changes the game; closing the dialog then redraws the room so its effects show.
  let changed = false;

  const form = element("form", "era-llm-composer");
  form.lang = "en";
  const status = element("p", "era-llm-status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  const textarea = element("textarea");
  textarea.rows = 2;
  textarea.placeholder = `Say something to ${character.name}, or *do something*… (Enter to send, Shift+Enter for a new line)`;
  textarea.setAttribute("aria-label", `Message to ${character.name}`);
  const send = element("button", "", "Send");
  send.type = "submit";
  const stop = element("button", "", "Cancel");
  stop.type = "button";
  stop.hidden = true;
  const actions = element("div", "era-llm-composer-actions");
  const state = element("span", "era-llm-state");
  const configure = element("button", "", "LLM settings…");
  configure.type = "button";
  actions.append(state, configure);
  const row = element("div", "era-llm-composer-row");
  row.append(textarea, send, stop);
  form.append(status, row, actions);
  dialog.append(form);

  const debugPane = element("div", "era-history-pane era-llm-debug");
  debugPane.hidden = true;
  const debugLogPane = element("div");
  const voice = chat.voice && chat.saveVoice ? voiceEditor(chat, character) : null;
  if (voice) debugPane.append(voice.section);
  debugPane.append(debugLogPane);
  dialog.append(debugPane);
  const historyTab = element("button", "era-info-tab", "History & chat");
  const debugTab = element("button", "era-info-tab", "LLM debug");
  for (const tab of [historyTab, debugTab]) tab.type = "button";
  tabs.append(historyTab, debugTab);
  const select = (debug) => {
    pane.hidden = debug;
    form.hidden = debug;
    debugPane.hidden = !debug;
    historyTab.setAttribute("aria-pressed", String(!debug));
    debugTab.setAttribute("aria-pressed", String(debug));
    if (debug) {
      void voice?.load();
      renderDebug(debugLogPane, log);
      debugPane.scrollTop = debugPane.scrollHeight;
    }
  };
  historyTab.addEventListener("click", () => select(false));
  debugTab.addEventListener("click", () => select(true));
  const refreshDebug = () => {
    debugTab.textContent = `LLM debug (${log.length})`;
    if (!debugPane.hidden) renderDebug(debugLogPane, log);
  };

  const showState = () => {
    const llm = activeLlm();
    state.textContent = llm ? `${PROVIDERS[llm.provider].label} · ${llm.model}` : "No LLM set up yet: choose one in LLM settings.";
    if (changed) state.textContent += " · Close this window to see what happens in the room.";
  };
  const showStatus = (text, className = "era-history-note") => {
    status.textContent = text;
    status.className = `era-llm-status ${className}`;
    status.hidden = !text;
  };
  const onChanged = () => showState();
  document.addEventListener("era-llm-changed", onChanged);
  cleanup.push(() => document.removeEventListener("era-llm-changed", onChanged), () => pending?.abort(),
    () => { if (changed) void chat.refresh?.(); });

  /** Edit and Retry on the player's lines in the newest conversation: they take back that line and everything after it. */
  const lineTools = (entry, index, newest) => {
    const line = entry.lines[index];
    if (!newest || entry.action.id !== "chat" || line.character !== null || pending) return undefined;
    const tools = element("span", "era-llm-message-tools");
    for (const [label, resend] of [["Edit", false], ["Retry", true]]) {
      const button = element("button", "", label);
      button.type = "button";
      button.title = `${resend ? "Send this message again" : "Edit this message"}: it and everything after it are removed from the history. Game changes the removed replies made stay.`;
      button.addEventListener("click", () => void rewind(entry.lines.length - index, typed(line.text), resend));
      tools.append(button);
    }
    return tools;
  };
  const render = () => renderCharacterHistory(content, history, { embedded: true, expandAll: true, lineTools });
  /** Redraws the history from the game, which has recorded what was just said or done. */
  const reload = async () => {
    try { history = await loadAll(); }
    catch (error) { showStatus(`Could not reload the history: ${error.message}`, "era-history-notice"); }
    if (dialog.isConnected) render();
  };

  async function rewind(lines, message, resend) {
    if (pending) return;
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
    if (!message || pending) return;
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
    const context = historyContext(history, config.historyChars);
    try {
      // The scene is optional: the game may not be at a command screen, and the chat still works without it.
      const scene = chat.runTool ? await chat.runTool("describe_scene", {}).then(({ result }) => result && !result.error && Object.keys(result).length ? result : undefined, () => undefined) : undefined;
      if (chat.record) {
        await chat.record(message);
        recorded = 1;
        await reload();
      }
      showStatus(`${character.name} is thinking…`);
      const prompt = buildMessages({
        system: systemPrompt({ character, gameTitle: chat.gameTitle, instructions: config.instructions, tools: !!runTool, scene }),
        context, scene, chat: [], message, tools: !!runTool,
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
      showStatus(spoke || handedOver(tools) ? "" : `${character.name} did not reply.`);
      // The player's attempt or a scene command plays out on the game screen, which closing redraws.
      if (handedOver(tools)) dialog.close();
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
      textarea.disabled = send.disabled = false;
      send.hidden = false;
      stop.hidden = true;
      refreshDebug();
      if (dialog.open) {
        render();
        textarea.focus();
      }
    }
  }

  form.addEventListener("submit", (event) => { event.preventDefault(); void submit(); });
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submit();
    }
  });
  stop.addEventListener("click", () => pending?.abort());
  configure.addEventListener("click", () => document.dispatchEvent(new Event("era-llm-configure")));
  // Keys and clicks in the composer are not game input.
  for (const type of ["click", "pointerdown", "keydown", "contextmenu"])
    form.addEventListener(type, (event) => event.stopPropagation());

  showState();
  refreshDebug();
  render();
  select(false);
  textarea.focus();
}
