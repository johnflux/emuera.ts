let expanded = true;
let selectedTab = "info";

function scrollHistoryToBottom(parent) {
  requestAnimationFrame(() => {
    for (const element of [parent, parent.querySelector(".era-history-body"), parent.closest(".era-history-dialog")]) {
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

export function renderCharacterHistory(parent, history, { loadAll, embedded = false, expandAll = false } = {}) {
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
      const close = text("button", "Close", header);
      close.type = "button";
      close.addEventListener("click", () => dialog.close());
      dialog.addEventListener("close", () => { dialog.remove(); open.focus(); });
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); dialog.close(); });
      const content = text("div", "Loading history...", dialog);
      dialog.showModal();
      try {
        const all = await loadAll();
        if (dialog.isConnected) renderCharacterHistory(content, all, { embedded: true, expandAll: true });
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
    text("summary", `${entry.action.label} · ${clock(entry.before)}`, item);
    const lines = entry.lines.map((line) => ({
      character: line.character, runs: compactRuns(line.runs ?? [{ text: line.text }], entry),
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
    }
    if (!lines.length) text("p", "No text was printed by this command.", item);
    if (entry.choices.length) text("p", `Player inputs: ${entry.choices.join(" → ")}`, item, "era-history-text");
    const changes = [];
    for (const [field, label] of [["affection", "Favor"], ["trust", "Trust"]]) {
      const delta = BigInt(entry.after[field]) - BigInt(entry.before[field]);
      if (delta !== 0n) changes.push(`${label}${delta > 0n ? "+" : ""}${delta}`);
    }
    if (changes.length) text("p", changes.join(" · "), item, "era-history-note");
    if (entry.truncated) text("p", "This interaction exceeded the capture limit; its text was truncated.", item, "era-history-notice");
  }
  scrollHistoryToBottom(parent);
}

export function setupCharacterHistory(parent, history, loadAll) {
  const card = parent.closest(".era-character-info");
  const tabs = card?.querySelector(".era-info-tabs");
  const title = tabs?.querySelector(".era-info-title");
  const info = card?.querySelector(".era-info-body");
  if (!tabs || !title || !info) {
    renderCharacterHistory(parent, history, { loadAll });
    return;
  }
  renderCharacterHistory(parent, history, { loadAll, embedded: true });
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
    }
  }
  select(selectedTab);
}
