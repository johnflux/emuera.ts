import { createTranslation } from "./translate.js";
import { createLibrary } from "./library.js";

const terminal = document.querySelector("#terminal");
const status = document.querySelector("#status");
const command = document.querySelector("#command");
const send = document.querySelector("#submit");
const report = document.querySelector("#compatibility");
const tooltip = document.querySelector("#game-tooltip");
let tooltipTarget = null;
const translation = createTranslation({ onChange: (status) => showTranslation(status) });
const demoButton = document.querySelector("#demo");
/** The menu's run buttons: the demo, then one per game (#game is the default game's; see showGames()). */
const startButtons = [demoButton, document.querySelector("#game")];
const restartButton = document.querySelector("#restart");
/** The games the server offers ({ id, title, display, metrics }, from /api/runtime); the first is the default. */
let games = [];
let runMode = "game";
/** The game the current run plays; the demo runs on the default game. */
let runGame = null;
/** Whether the current run is in Emuera's debug mode; new runs use the saved preference. */
let runDebug = false;
const DEBUG_KEY = "era-typescript.debug";
const debugPreferred = () => localStorage.getItem(DEBUG_KEY) === "1";
const debugButton = document.querySelector("#debug-toggle");
const debugPanel = document.querySelector("#debug-output");
const debugLog = document.querySelector("#debug-log");
/** Appends a snapshot's debug window text (DEBUGPRINT), after emptying it for DEBUGCLEAR. */
function showDebugOutput(snapshot) {
  if (snapshot.debugClear) debugLog.textContent = "";
  if (!snapshot.debug) return;
  const atEnd = debugLog.scrollTop + debugLog.clientHeight >= debugLog.scrollHeight - 4;
  debugLog.append(snapshot.debug);
  if (debugLog.textContent.length > 200_000) debugLog.textContent = debugLog.textContent.slice(-100_000);
  if (atEnd) debugLog.scrollTop = debugLog.scrollHeight;
}
const gameTitle = (id) => (games.find((game) => game.id === id) ?? games[0])?.title ?? "Game";
let session = null;
/** Steps the server has delivered for this session; sent with input so a stale duplicate tab is refused. */
let step = 0;
// The running session survives a page reload through this tab's sessionStorage (see resume()).
const RUN_KEY = "era-typescript.run";
function savedRun() {
  try {
    const run = JSON.parse(sessionStorage.getItem(RUN_KEY) ?? "null");
    return typeof run?.session === "string" && (run.mode === "game" || run.mode === "demo")
      && (run.game === undefined || typeof run.game === "string") ? run : null;
  } catch { return null; }
}
/** The address names the current game (?game=k, or ?demo), so reloads and dev hot reloads keep to it. */
function urlRun() {
  const params = new URLSearchParams(location.search);
  if (params.has("demo")) return { mode: "demo" };
  const game = params.get("game");
  return game ? { mode: "game", game } : null;
}
function showRunInUrl() {
  const url = new URL(location.href);
  url.searchParams.delete("game");
  url.searchParams.delete("demo");
  if (runMode === "demo") url.searchParams.set("demo", "");
  else if (runGame) url.searchParams.set("game", runGame);
  window.history.replaceState(window.history.state, "", url.href.replace(/([?&]demo)=(?=&|#|$)/, "$1"));
}
function rememberRun() {
  if (session && input) sessionStorage.setItem(RUN_KEY, JSON.stringify({ session, mode: runMode, game: runGame }));
  else sessionStorage.removeItem(RUN_KEY);
}
let input = null;
let busy = false;
let timedWait = null;
let expiring = false;
let queuedSubmit = null;
let currentLine = null;
let currentScreen = null;
// Screens finished by a click-to-continue wait. They stay active (not greyed) while the dialogue continues, and
// retire together once a step stops at a real input, so a new menu is shown against greyed history.
let continuedScreens = [];
let outputRoot = terminal;
let pendingImages = [];
let generation = 0;
const sprites = new Map();
const SETTINGS_KEY = "era-typescript.settings";
/** Emuera's configured font size and line height (emuera.config), the units game image layouts are written in. */
let metrics = { fontSize: 18, lineHeight: 19, columns: 20 };
const BASE_DEFAULTS = { foreground: "#c0c0c0", background: "#000000", selection: "#ffff00", font: "ＭＳ ゴシック" };
let gameDefaults = { ...BASE_DEFAULTS };
let settings = { ...gameDefaults };
function savedSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") ?? {}; } catch { return {}; }
}
function displaySettings() {
  const { foreground, background, selection, font } = settings;
  return { foreground, background, selection, font };
}
function applySettings() {
  const root = document.documentElement.style;
  root.setProperty("--terminal-foreground", settings.foreground);
  root.setProperty("--terminal-background", settings.background);
  root.setProperty("--selection-color", settings.selection);
  const font = settings.font && !/["\\;{}<>]/.test(settings.font) ? `"${settings.font}", ` : "";
  root.setProperty("--terminal-font", `${font}"BIZ UD Gothic", "MS Gothic", "ＭＳ ゴシック", monospace`);
  if (settings.fontSize) {
    root.setProperty("--font-size", `${settings.fontSize}px`);
    document.querySelector("#font-size").value = String(settings.fontSize);
  }
  const form = document.querySelector("#settings-form");
  for (const name of ["foreground", "background", "selection", "font"])
    if (form.elements[name] !== document.activeElement) form.elements[name].value = settings[name];
  terminalColumns();
}
function updateSetting(name, value) {
  const saved = savedSettings();
  if (value === undefined || value === gameDefaults[name]) delete saved[name];
  else saved[name] = value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved));
  settings = { ...gameDefaults, ...saved };
  applySettings();
}
const settingsLoaded = (async () => {
  settings = { ...gameDefaults, ...savedSettings() };
  applySettings();
  try {
    const runtime = await api("/api/runtime");
    games = runtime.games ?? [];
    showGames();
    if (games.length) useGameDisplay(games[0].id);
    await document.fonts.ready;
    terminalColumns();
  } catch (error) { message(`Could not load game settings: ${error.message}`, true); }
})();
/** Emuera's colors, font and layout metrics come from each game's emuera.config; the player's settings override them. */
function useGameDisplay(id) {
  const game = games.find((entry) => entry.id === id) ?? games[0];
  if (!game) return;
  gameDefaults = { ...BASE_DEFAULTS, ...game.display };
  if (game.metrics) metrics = game.metrics;
  // Emuera spaces lines by the configured line height; images that span lines are laid out against it.
  document.documentElement.style.setProperty("--line-height", String(Math.min(3, Math.max(1, metrics.lineHeight / metrics.fontSize))));
  settings = { ...gameDefaults, ...savedSettings() };
  applySettings();
}
/** Lists the server's games in the menu's Run section, in catalogue order. */
function showGames() {
  for (const button of startButtons.splice(2)) button.remove();
  const [first, ...others] = games;
  const button = startButtons[1];
  button.hidden = !first;
  if (!first) return;
  button.dataset.game = first.id;
  button.textContent = first.title;
  let last = button;
  for (const game of others) {
    const extra = document.createElement("button");
    extra.dataset.game = game.id;
    extra.setAttribute("aria-pressed", "false");
    extra.textContent = game.title;
    last.after(extra);
    last = extra;
    startButtons.push(extra);
    extra.addEventListener("click", () => { void chooseRun("game", game.id); });
  }
}
new ResizeObserver(() => {
  placeBackground();
  scheduleHtmlPositions();
  // scrollIntoView would also scroll an open dialog's body to its end.
  if (input && !busy && !terminal.querySelector(".era-dialog:popover-open")) lastOutputLine()?.scrollIntoView({ block: "nearest" });
}).observe(terminal);

async function watchDevelopment() {
  let runtime;
  try { runtime = await api("/api/runtime"); }
  catch (error) {
    message(`Cannot check development reload status: ${error.message}. Retrying...`, true);
    setTimeout(() => { void watchDevelopment(); }, 1500);
    return;
  }
  if (!runtime.development) return;
  if (sessionStorage.getItem("era-dev-reloaded")) {
    sessionStorage.removeItem("era-dev-reloaded");
    if (!session && !busy) message("Development reload complete. Starting a fresh run.");
  }
  let disconnected = false;
  async function poll() {
    try {
      const next = await api("/api/runtime");
      if (next.instance !== runtime.instance) {
        sessionStorage.setItem("era-dev-reloaded", "1");
        location.reload();
        return;
      }
      if (disconnected) {
        disconnected = false;
        message("Development server reconnected.");
      }
    } catch (error) {
      if (!disconnected) message(`Development server disconnected (${error.message}); waiting for restart...`, true);
      disconnected = true;
    }
    setTimeout(() => { void poll(); }, 1000);
  }
  setTimeout(() => { void poll(); }, 1000);
}
void watchDevelopment();

function message(value, error = false) {
  status.textContent = value;
  status.classList.toggle("error", error);
}
async function api(url, data) {
  const response = await fetch(url, data === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error ?? `HTTP ${response.status}`), { status: response.status });
  return result;
}
// Activity feedback: the cursor changes at once; the progress bar and timer fade in
// (style.css) only if the step is slow, so fast steps don't flicker.
const activityChip = document.querySelector("#activity");
const activity = { start: 0, response: 0, delay: null, tick: null };
function seconds(ms) { return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`; }
function beginActivity() {
  clearTimeout(activity.delay);
  clearInterval(activity.tick);
  activity.start = performance.now();
  activity.response = 0;
  document.body.classList.add("is-busy");
  // The previous duration stays (fading out via CSS) until the running display starts.
  activity.delay = setTimeout(() => {
    document.body.classList.add("is-busy-visible");
    activityChip.classList.remove("is-done", "is-slow");
    activityChip.removeAttribute("title");
    activityChip.hidden = false;
    const update = () => {
      activityChip.textContent = `${activity.response ? "Rendering" : "Running"} ${seconds(performance.now() - activity.start)}`;
    };
    update();
    activity.tick = setInterval(update, 100);
  }, 120);
}
// Marks the end of the server step, so the summary can separate script time from render time.
function activityResponded() { activity.response = performance.now(); }
function endActivity() {
  clearTimeout(activity.delay);
  clearInterval(activity.tick);
  document.body.classList.remove("is-busy", "is-busy-visible");
  if (!activity.start) return;
  const end = performance.now();
  const total = end - activity.start;
  const script = (activity.response || end) - activity.start;
  activity.start = 0;
  activityChip.hidden = false;
  activityChip.classList.add("is-done");
  activityChip.classList.toggle("is-slow", total >= 1000);
  activityChip.textContent = seconds(total);
  activityChip.title = `Last step took ${seconds(total)}: script ${seconds(script)}, render ${seconds(total - script)}`;
}
function updateControls() {
  terminal.classList.toggle("is-waiting", !busy && input?.kind === "wait");
  // Timer refreshes keep the field enabled so typing and focus survive animation frames.
  command.disabled = (busy && !expiring) || !input || !!input.blocking;
  send.disabled = !input;
  send.setAttribute("aria-disabled", String(busy || !input));
  send.textContent = input?.kind === "wait" ? "Continue" : "Send";
  command.title = !input ? "Not waiting for input" : input.singleCharacter
    ? input.kind === "integer" ? "Type one digit (no Enter needed)" : "Type one character (no Enter needed)"
    : input.kind === "integer" ? "Enter a whole number" : input.kind === "wait" ? "Press Enter to continue" : "Enter text";
  startButtons.forEach((button) => { button.setAttribute("aria-disabled", String(busy)); });
  restartButton.setAttribute("aria-disabled", String(busy));
  document.querySelector("#input-form").hidden = !input || input.kind === "mousekey";
  command.placeholder = input?.defaultValue !== undefined && input.kind !== "wait" ? `Enter for ${JSON.stringify(input.defaultValue)}` : "";
  terminal.querySelectorAll("button.choice").forEach((button) => {
    const value = input?.kind === "integer" && /^-?\d+$/.test(button.dataset.value) ? BigInt(button.dataset.value).toString() : button.dataset.value;
    button.disabled = !button.closest(".screen.is-active") || button.classList.contains("is-stale") || (busy && !expiring) || !input || input.kind === "wait" || !!input.blocking
      || !!input.buttonValues && !input.buttonValues.includes(value);
  });
}
function screen() {
  if (currentScreen?.parentElement !== outputRoot) {
    currentScreen = document.createElement("div");
    currentScreen.className = "screen is-active";
    outputRoot.append(currentScreen);
  }
  return currentScreen;
}
function lastOutputLine() {
  const lines = terminal.lastElementChild?.querySelectorAll(".line:not(.era-marker)");
  return lines?.[lines.length - 1];
}
function retireScreen(screen = currentScreen) {
  if (!screen) return;
  hideTooltip();
  const currentScreen = screen;
  currentScreen.classList.replace("is-active", "is-history");
  const selected = currentScreen.querySelector(".choice.is-selected");
  if (selected) {
    // Dim sibling subtrees, not the selected button's ancestors: ancestor
    // opacity would also dim the selected button and cannot be undone on it.
    function dimSiblings(parent) {
      for (const child of [...parent.childNodes]) {
        if (child === selected) continue;
        if (child instanceof Element) {
          if (child.contains(selected)) dimSiblings(child);
          else child.classList.add("history-dimmed");
        } else if (child.nodeType === Node.TEXT_NODE && child.textContent) {
          const span = document.createElement("span");
          span.className = "history-dimmed";
          child.replaceWith(span);
          span.append(child);
        }
      }
    }
    dimSiblings(currentScreen);
  }
  currentScreen.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  currentScreen.querySelectorAll("a[href]").forEach((link) => {
    link.dataset.href = link.getAttribute("href");
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    link.tabIndex = -1;
  });
  currentScreen.querySelectorAll("[data-tooltip]").forEach((element) => { element.tabIndex = -1; });
}
// Undo retireScreen when CLEARLINE removes the output that followed a screen, so
// its choices are usable again. Emuera keeps old buttons valid until new ones are
// printed; choices that exist now are marked so later new choices can retire them.
function reviveScreen(group) {
  group.classList.replace("is-history", "is-active");
  group.querySelectorAll(".history-dimmed").forEach((element) => { element.classList.remove("history-dimmed"); });
  group.querySelectorAll(".choice.is-selected").forEach((button) => { button.classList.remove("is-selected"); });
  group.querySelectorAll("a[data-href]").forEach((link) => {
    link.setAttribute("href", link.dataset.href);
    delete link.dataset.href;
    link.removeAttribute("aria-disabled");
    link.removeAttribute("tabindex");
  });
  group.querySelectorAll("[data-tooltip]").forEach((element) => {
    if (element.matches("button, a[href]")) element.removeAttribute("tabindex");
    else element.tabIndex = 0;
  });
  group.querySelectorAll("button.choice").forEach((button) => { button.classList.add("is-revived"); });
  group.querySelectorAll(".line").forEach((line) => { line.classList.add("is-revived-line"); });
  currentScreen = group;
  currentLine = null;
}
// Once a revived screen's choices go stale (new choices were printed after them), its leading output that is wholly
// from before the revival moves to a history screen of its own, so it looks and behaves like any older screen.
function splitStaleOutput() {
  for (const group of outputRoot.querySelectorAll(".screen.is-active")) {
    const stale = [];
    for (const child of group.children) {
      const lines = child.matches(".line") ? [child] : [...child.querySelectorAll(".line")];
      if (!lines.length || !lines.every((line) => line.classList.contains("is-revived-line"))) break;
      stale.push(child);
    }
    group.querySelectorAll(".is-revived-line").forEach((line) => { line.classList.remove("is-revived-line"); });
    if (!stale.length) continue;
    const history = document.createElement("div");
    history.className = "screen is-active";
    history.append(...stale);
    group.before(history);
    retireScreen(history);
  }
}
function hideTooltip() {
  clearTimeout(tooltipDelay);
  clearTimeout(tooltipDuration);
  tooltipTarget?.removeAttribute("aria-describedby");
  tooltipTarget = null;
  tooltip.hidden = true;
  if (tooltip.matches(":popover-open")) tooltip.hidePopover();
  tooltip.textContent = "";
}
let tooltipDelay;
let tooltipDuration;
let tooltipSettings = null;
function useTooltipSettings(settings) {
  tooltipSettings = settings;
  const custom = settings?.custom;
  Object.assign(tooltip.style, {
    fontFamily: custom && settings.font ? settings.font : "",
    fontSize: custom ? `${settings.fontSize}px` : "",
    color: custom ? settings.color : "", backgroundColor: custom ? settings.background : "",
    textAlign: custom && settings.format !== undefined ? ["left", "center", "right"][settings.format] : "",
  });
}
/** An element's box including any pictures inside it, which overflow their zero-height line. */
function visibleBox(element) {
  let { left, top, right, bottom } = element.getBoundingClientRect();
  for (const clip of element.querySelectorAll(".sprite-clip")) {
    const box = clip.getBoundingClientRect();
    left = Math.min(left, box.left); top = Math.min(top, box.top);
    right = Math.max(right, box.right); bottom = Math.max(bottom, box.bottom);
  }
  return { left, top, right, bottom };
}
function describe(element, description) {
  // Emuera.EM/EE show a literal "<br>" in tooltip text as a line break (and interpret no other markup there).
  description = description.replaceAll("<br>", "\n");
  element.classList.add("has-tooltip");
  element.dataset.tooltip = description;
  if (!element.matches("button, a[href]")) element.tabIndex = 0;
  function show() {
    if (busy || !element.closest(".screen.is-active, .cbg-layer") || element.matches(".is-stale")) return;
    if (element.closest(".era-occupant-list") && element.querySelector(".sprite")) return;
    hideTooltip();
    tooltipTarget = element;
    // Each line is translated on its own so line breaks survive translation.
    const lines = description.split("\n");
    const translated = () => lines.map((line) => translation.text(line, () => { if (tooltipTarget === element) tooltip.textContent = translated(); })).join("\n");
    tooltip.textContent = translated();
    tooltip.hidden = false;
    // In the top layer, so it shows above an open dialog.
    if (tooltip.popover && !tooltip.matches(":popover-open")) tooltip.showPopover();
    element.setAttribute("aria-describedby", tooltip.id);
    const anchor = visibleBox(element);
    const box = tooltip.getBoundingClientRect();
    const margin = 12;
    tooltip.style.left = `${Math.max(margin, Math.min(anchor.left, innerWidth - box.width - margin))}px`;
    const below = anchor.bottom + 8;
    tooltip.style.top = `${Math.max(margin, Math.min(
      below + box.height <= innerHeight - margin ? below : anchor.top - box.height - 8,
      innerHeight - box.height - margin,
    ))}px`;
    if (tooltipSettings?.duration > 0) tooltipDuration = setTimeout(hideTooltip, tooltipSettings.duration);
  }
  element.addEventListener("mouseenter", () => {
    clearTimeout(tooltipDelay);
    if (tooltipSettings?.delay > 0) tooltipDelay = setTimeout(show, tooltipSettings.delay);
    else show();
  });
  element.addEventListener("focus", show);
  element.addEventListener("mouseleave", () => {
    clearTimeout(tooltipDelay);
    if (tooltipTarget === element && document.activeElement !== element) hideTooltip();
  });
  element.addEventListener("blur", () => { if (tooltipTarget === element) hideTooltip(); });
}
document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideTooltip(); });
let inventoryQuery = "";
function filterInventory(dialog) {
  const query = inventoryQuery.trim().toLowerCase();
  const items = dialog.querySelectorAll(".era-inventory-item");
  let visible = 0;
  for (const item of items) {
    const matches = item.querySelector(".era-inventory-name").textContent.toLowerCase().includes(query);
    item.closest(".line").hidden = !matches;
    if (matches) visible++;
  }
  const count = dialog.querySelector(".era-inventory-count");
  count.setAttribute("role", "status");
  count.textContent = query ? `${visible} of ${items.length} item types` : `${items.length} item type${items.length === 1 ? "" : "s"}`;
  const empty = dialog.querySelector(".era-inventory-empty");
  empty.closest(".line").hidden = visible !== 0;
  empty.textContent = items.length ? "No items match your filter." : "No items in this category.";
}
function syncInventory(dialog) {
  const host = dialog.querySelector(".era-inventory-filter");
  if (!host) return;
  let filter = host.querySelector("input");
  if (!filter) {
    filter = document.createElement("input");
    filter.type = "search";
    filter.className = "era-inventory-search";
    filter.placeholder = "Filter items...";
    filter.setAttribute("aria-label", "Filter inventory by name");
    filter.autocomplete = "off";
    host.append(filter);
  }
  filter.value = inventoryQuery;
  filterInventory(dialog);
}
document.addEventListener("input", (event) => {
  const filter = event.target;
  if (!(filter instanceof HTMLInputElement) || !filter.matches(".era-inventory-search")) return;
  const dialog = filter.closest(".screen.is-active .era-inventory");
  if (!dialog) return;
  inventoryQuery = filter.value;
  hideTooltip();
  filterInventory(dialog);
});
/**
 * Hotpatch extension: era-dialog boxes use the top layer while their screen is active, without changing line counts.
 * Escape or a click outside the panel presses its .era-dialog-close button.
 */
function syncDialogs() {
  if (!terminal.querySelector(".screen.is-active .era-inventory")) inventoryQuery = "";
  for (const dialog of terminal.querySelectorAll(".era-dialog")) {
    if (!dialog.popover) dialog.popover = "manual";
    const open = !!dialog.closest(".screen.is-active");
    if (open && dialog.classList.contains("era-inventory")) syncInventory(dialog);
    if (open === dialog.matches(":popover-open")) continue;
    if (open) dialog.showPopover();
    else dialog.hidePopover();
  }
}
function dialogClose(dialog) {
  return dialog.querySelector(".era-dialog-close:enabled");
}
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const dialog = outputRoot.querySelector(".screen.is-active .era-dialog:popover-open");
  const close = dialog && dialogClose(dialog);
  if (!close) return;
  event.preventDefault();
  close.click();
});
// Backdrop clicks target the root element rather than the popover.
document.addEventListener("click", (event) => {
  if (!event.detail || event.target !== document.documentElement || settling()) return;
  const dialog = outputRoot.querySelector(".screen.is-active .era-dialog:popover-open");
  if (dialog) dialogClose(dialog)?.click();
});
document.addEventListener("scroll", hideTooltip, true);
window.addEventListener("resize", hideTooltip);
function line() {
  if (!currentLine) {
    currentLine = document.createElement("div");
    currentLine.className = "line";
    container().append(currentLine);
  }
  return currentLine;
}
/**
 * Hotpatch extension (not Emuera HTML): an HTML_PRINT of only <era-open class='era-…'> opens a box that takes the
 * following lines until a matching <era-close>, so a patched screen can be laid out in panels. Boxes nest inside the
 * screen in output order, so CLEARLINE still removes the last lines printed. Each marker is a hidden line because
 * the runtime counts every HTML_PRINT as one.
 */
const boxMarker = /^\s*<era-(open|close)(?:\s+class\s*=\s*(?:'([^']*)'|"([^"]*)"))?\s*\/?>\s*$/i;
// A line ending in a run of one rule character (DRAWLINE, or a "□ Title □-----" heading padded to the width) is
// clipped rather than wrapped when it is wider than its box, e.g. after the window was made narrower.
const ruleTail = /([-─━═=＝～~_])\1{9,}$/u;
/** The innermost box still open in the current screen, or the screen. */
function container() {
  let parent = screen();
  for (let last = parent.lastElementChild; last?.classList.contains("era-box") && !last.dataset.closed; last = parent.lastElementChild)
    parent = last;
  return parent;
}
function boxLine(parent, closing, shared) {
  const marker = document.createElement("div");
  marker.className = closing ? "line era-marker era-close-line" : "line era-marker";
  // HTML_PRINT ends an unfinished line, so a marker after PRINT text shares that text's logical line.
  if (shared) marker.dataset.logicalLines = "0";
  parent.append(marker);
}
function openBox(classes, shared) {
  currentLine = null;
  const names = classes.split(/\s+/).filter((name) => /^era-[a-z0-9-]+$/.test(name));
  // A layout starts afresh: one left open by a restarted function (RESTART) must not swallow it.
  if (names.includes("era-layout"))
    for (let box = container(); box.classList.contains("era-box"); box = box.parentElement) box.dataset.closed = "forced";
  const box = document.createElement("div");
  box.classList.add("era-box", ...names);
  container().append(box);
  boxLine(box, false, shared);
}
function closeBox(shared) {
  currentLine = null;
  const box = container();
  boxLine(box, true, shared);
  if (box.classList.contains("era-box")) box.dataset.closed = "closed";
}
/** Removes a line and any boxes it leaves empty; removing a box's closing marker reopens it. */
function removeLine(element) {
  const parent = element.parentElement;
  if (element.classList.contains("era-close-line")) delete parent.dataset.closed;
  element.remove();
  for (let box = parent; box?.classList.contains("era-box") && !box.querySelector(".line"); ) {
    const up = box.parentElement;
    box.remove();
    box = up;
  }
}
const colorContext = document.createElement("canvas").getContext("2d");
function markTextColor(element, color) {
  element.classList.add("has-text-color");
  colorContext.fillStyle = "#000000";
  colorContext.fillStyle = color;
  const hex = /^#([0-9a-f]{6})$/i.exec(colorContext.fillStyle);
  const channels = hex ? hex[1].match(/../g).map((channel) => Number.parseInt(channel, 16)) : [0, 0, 0];
  const chromatic = Math.max(...channels) - Math.min(...channels) > 24;
  element.classList.toggle("text-color-chromatic", chromatic);
  element.classList.toggle("text-color-neutral", !chromatic);
}
function applyStyle(element, style) {
  element.classList.add("output-text");
  element.classList.toggle("font-bold", !!(style.fontStyle & 1));
  element.classList.toggle("font-italic", !!(style.fontStyle & 2));
  element.classList.toggle("font-strikeout", !!(style.fontStyle & 4));
  element.classList.toggle("font-underline", !!(style.fontStyle & 8));
  markTextColor(element, style.color);
  if (style.color.toLowerCase() !== settings.foreground) element.style.setProperty("--output-color", style.color);
  else element.style.removeProperty("--output-color");
  if (style.background.toLowerCase() !== settings.background) element.style.setProperty("--output-background", style.background);
  else element.style.removeProperty("--output-background");
  applyFont(element, style.font);
}
function applyFont(element, font) {
  // Requested fonts fall back to the bundled terminal font when unavailable.
  if (font && !/["\\;{}<>]/.test(font)) element.style.fontFamily = `"${font}", var(--terminal-font)`;
  else element.style.removeProperty("font-family");
}
function applyAlignment(element, alignment) {
  for (const value of ["left", "center", "right"]) element.classList.toggle(`align-${value}`, alignment === value);
}
function applyLineStyle(element, style) {
  applyAlignment(element, style.alignment);
  if (style.background.toLowerCase() !== settings.background) element.style.setProperty("--line-background", style.background);
  else element.style.removeProperty("--line-background");
}
/**
 * When clicking through dialogue reaches a real input, the next click or bare Enter may already be on its way, and
 * would land on whichever choice is now under the pointer (or submit a default value). Those are ignored for a moment.
 * 400ms covers a typical click-through rhythm (clicks ~150-300ms apart) plus the ~250ms it takes to notice the
 * screen has changed, without delaying a deliberate choice, which takes longer to read and aim at.
 */
const SETTLE_MS = 400;
let settleUntil = 0;
let settleTimer = null;
function settle() {
  settleUntil = performance.now() + SETTLE_MS;
  terminal.classList.add("is-settling");
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => terminal.classList.remove("is-settling"), SETTLE_MS);
}
function settling() { return performance.now() < settleUntil; }
function choice(label, value, title = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "choice";
  button.dataset.value = value;
  button.textContent = label;
  if (title) describe(button, title);
  decorateLabel(button);
  button.addEventListener("click", (event) => {
    // detail is 0 for keyboard activation, which is deliberate.
    if (event.detail > 0 && settling()) return;
    if (!button.closest(".screen.is-active")) return;
    if (input?.kind === "mousekey") {
      // RESULT:5 is an integer button's value; a string button sets RESULTS instead.
      const numeric = /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value));
      void submitMouseKey([1, MOUSE_BUTTONS[0], ...clientPoint(event), -1, numeric ? Number(value) : 0], numeric ? undefined : value, button);
    } else void submit(value, button);
  });
  return button;
}
function decorateLabel(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.parentElement.closest(".interactive-label")) nodes.push(walker.currentNode);
  }
  let inBrackets = false;
  for (const node of nodes) {
    const fragment = document.createDocumentFragment();
    for (const part of node.textContent.split(/([\[\]])/)) {
      if (part === "[") inBrackets = true;
      if (part === "]") inBrackets = false;
      const match = /^(\s*)(.*?)(\s*)$/s.exec(part);
      if (!match || !match[2] || part === "[" || part === "]" || !inBrackets && !element.classList.contains("has-tooltip")) {
        fragment.append(document.createTextNode(part));
        continue;
      }
      const label = document.createElement("span");
      label.className = "interactive-label";
      label.textContent = match[2];
      fragment.append(document.createTextNode(match[1]), label, document.createTextNode(match[3]));
    }
    node.replaceWith(fragment);
  }
}
function appendText(parent, value) {
  // Conventional numeric menu markers are input choices, not executable markup.
  const pattern = /\[[ \t]*(-?\d+)[ \t]*\]/g;
  const matches = [...value.matchAll(pattern)];
  let start = 0;
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    appendCells(parent, value.slice(start, match.index));
    const end = matches[i + 1]?.index ?? value.length;
    const label = value.slice(match.index, end).trimEnd();
    parent.append(choice(label, match[1]));
    start = match.index + label.length;
  }
  appendCells(parent, value.slice(start));
}
/**
 * Block elements (▀▄█…) and the corner triangles ◢◣◤◥ aren't in Shift-JIS, so Emuera counts them as one column and
 * MS Gothic draws them half-width. Our fonts draw them wider, which would push bars (and sliders) out of their columns.
 * Blocks are clipped to a column; triangles are squeezed so they keep their shape.
 */
function appendCells(parent, value) {
  let start = 0;
  for (const match of value.matchAll(/[\u2580-\u259F]+|[\u25E2-\u25E5]+/g)) {
    parent.append(document.createTextNode(value.slice(start, match.index)));
    const cells = document.createElement("span");
    cells.style.width = `${match[0].length}ch`;
    if (match[0] >= "\u25E2") {
      // Spaces carry the line's strikeout at its usual height while the glyphs are scaled over them.
      cells.className = "half-cells squeezed";
      cells.textContent = " ".repeat(match[0].length);
      const glyphs = document.createElement("span");
      glyphs.textContent = match[0];
      cells.append(glyphs);
    } else {
      cells.className = "half-cells";
      cells.textContent = match[0];
    }
    parent.append(cells);
    start = match.index + match[0].length;
  }
  parent.append(document.createTextNode(value.slice(start)));
}
/** CSS pixels per Emuera pixel: the game lays images out against its configured line height, so map that onto ours. */
function imageScale() {
  const style = getComputedStyle(terminal);
  const lineHeight = Number.parseFloat(style.lineHeight);
  return (Number.isFinite(lineHeight) ? lineHeight : Number.parseFloat(style.fontSize) * 1.25) / metrics.lineHeight;
}
/** Use the same game-pixel coordinates as CBG placement and mouse hit testing. */
function clientState() {
  const scale = imageScale();
  return {
    width: Math.max(0, Math.floor(terminal.clientWidth / scale)),
    height: Math.max(0, Math.floor(terminal.clientHeight / scale)),
    active: !document.hidden && document.hasFocus(),
  };
}
/** CSS pixels per Emuera pixel across the line: a column is half the configured font size wide in Emuera. */
function columnScale() {
  const width = Number.parseFloat(getComputedStyle(terminal).getPropertyValue("--logical-width"));
  const columns = Math.max(20, Math.min(1000, metrics.columns));
  return Number.isFinite(width) && width > 0 ? width / (columns * metrics.fontSize / 2) : imageScale();
}
function sizeAttribute(value, fallback, scale) {
  if (value === null) return fallback;
  // Emuera unitless image dimensions are percentages of the configured font size, not pixels.
  const match = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(value.trim());
  if (!match) throw new Error(`Unsupported image dimension: ${value}`);
  const size = (match[2] ? Number(match[1]) : Number(match[1]) * metrics.fontSize / 100) * scale;
  return Math.max(-4096, Math.min(4096, size));
}
async function loadImage(img, url) {
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("The source image could not be loaded."));
    img.src = url;
  });
  // Browsers may defer decode() indefinitely while the document is hidden.
  // Loaded images are sufficient there: no partially decoded frame is visible.
  if (document.hidden) return;
  let onVisibilityChange;
  const hidden = new Promise((resolve) => {
    onVisibilityChange = () => { if (document.hidden) resolve(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
  });
  try { await Promise.race([img.decode(), hidden]); }
  finally { document.removeEventListener("visibilitychange", onVisibilityChange); }
}
const sourceImages = new Map();
function sourceImage(url) {
  let promise = sourceImages.get(url);
  if (!promise) {
    const img = new Image();
    promise = loadImage(img, url).then(() => img);
    promise.catch(() => sourceImages.delete(url));
    sourceImages.set(url, promise);
  }
  return promise;
}
const paintedPictures = new Map();
/** Paints a runtime graphics display list (GCREATE/GDRAWSPRITE/GDRAWG...) onto a canvas. */
function paintPicture(picture) {
  const cacheKey = JSON.stringify(picture);
  let promise = paintedPictures.get(cacheKey);
  if (!promise) {
    promise = paintOps(picture);
    promise.catch(() => paintedPictures.delete(cacheKey));
    if (paintedPictures.size > 200) paintedPictures.delete(paintedPictures.keys().next().value);
    paintedPictures.set(cacheKey, promise);
  }
  return promise;
}
function newCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.abs(width));
  canvas.height = Math.max(1, Math.abs(height));
  return canvas;
}
/** GDI+ ColorMatrix on unpremultiplied RGBA: out[j] = sum(in[i] * m[i][j]) + m[4][j]. */
function applyColorMatrix(canvas, m) {
  const context = canvas.getContext("2d");
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i] / 255, g = p[i + 1] / 255, b = p[i + 2] / 255, a = p[i + 3] / 255;
    for (let j = 0; j < 4; j++)
      p[i + j] = Math.round(255 * Math.min(1, Math.max(0, r * m[0][j] + g * m[1][j] + b * m[2][j] + a * m[3][j] + m[4][j])));
  }
  context.putImageData(data, 0, 0);
}
/** Draws src rect of image into dest rect; negative sizes mirror like GDI+. */
function drawRect(context, image, [sx, sy, sw, sh], [dx, dy, dw, dh], matrix) {
  if (!sw || !sh || !dw || !dh) return;
  let flipX = false, flipY = false;
  if (sw < 0) { sx += sw; sw = -sw; flipX = !flipX; }
  if (sh < 0) { sy += sh; sh = -sh; flipY = !flipY; }
  if (dw < 0) { dx += dw; dw = -dw; flipX = !flipX; }
  if (dh < 0) { dy += dh; dh = -dh; flipY = !flipY; }
  let target = context, ox = dx, oy = dy;
  let layer;
  if (matrix) {
    layer = newCanvas(dw, dh);
    target = layer.getContext("2d");
    ox = 0; oy = 0;
  }
  target.save();
  target.translate(ox + (flipX ? dw : 0), oy + (flipY ? dh : 0));
  target.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  target.drawImage(image, sx, sy, sw, sh, 0, 0, dw, dh);
  target.restore();
  if (layer) {
    applyColorMatrix(layer, matrix);
    context.drawImage(layer, dx, dy);
  }
}
async function paintOps(picture) {
  const canvas = newCanvas(picture.width, picture.height);
  const context = canvas.getContext("2d");
  const images = await Promise.all(picture.ops.map((op) =>
    op.op === "image" ? sourceImage(op.url)
      : op.op === "graphics" ? paintPicture(op.source)
      : op.op === "mask" ? Promise.all([paintPicture(op.source), paintPicture(op.mask)])
      : null));
  picture.ops.forEach((op, i) => {
    if (op.op === "rotate") {
      // GDI+ MatrixOrder.Append: rotate the existing transform in world coordinates.
      const previous = context.getTransform();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.translate(op.x, op.y);
      context.rotate(op.angle * Math.PI / 180);
      context.translate(-op.x, -op.y);
      context.transform(previous.a, previous.b, previous.c, previous.d, previous.e, previous.f);
    } else if (op.op === "fill") {
      if (op.absolute) { context.save(); context.setTransform(1, 0, 0, 1, 0, 0); }
      const [x, y, width, height] = op.rect;
      if (op.replace) context.clearRect(x, y, width, height);
      context.fillStyle = op.color;
      context.fillRect(x, y, width, height);
      if (op.absolute) context.restore();
    } else if (op.op === "line") {
      context.strokeStyle = op.color;
      context.lineWidth = op.width;
      context.beginPath();
      context.moveTo(...op.from);
      context.lineTo(...op.to);
      context.stroke();
    } else if (op.op === "text") {
      const { name, size, style } = op.font;
      context.font = `${style & 2 ? "italic " : ""}${style & 1 ? "bold " : ""}${size}px ${JSON.stringify(name)}, monospace`;
      context.textBaseline = "top";
      context.fillStyle = op.color;
      op.text.split(/\r?\n/).forEach((line, index) => {
        const y = op.y + index * size;
        context.fillText(line, op.x, y);
        const width = context.measureText(line).width;
        if (style & 4) context.fillRect(op.x, y + size / 2, width, Math.max(1, size / 16));
        if (style & 8) context.fillRect(op.x, y + size - 1, width, Math.max(1, size / 16));
      });
    } else if (op.op === "mask") {
      // Emuera GDrawGWithMask: blend source over destination by the mask's blue channel.
      const [source, mask] = images[i];
      const { width, height } = source;
      const destination = context.getImageData(op.x, op.y, width, height);
      const s = source.getContext("2d").getImageData(0, 0, width, height).data;
      const m = mask.getContext("2d").getImageData(0, 0, width, height).data;
      const d = destination.data;
      for (let p = 0; p < d.length; p += 4) {
        const weight = m[p + 2];
        if (weight === 0) continue;
        for (let c = 0; c < 4; c++) d[p + c] = weight === 255 ? s[p + c] : (s[p + c] * (weight + 1) + d[p + c] * (255 - weight)) >> 8;
      }
      context.putImageData(destination, op.x, op.y);
    } else drawRect(context, images[i], op.src, op.dest, op.matrix);
  });
  return canvas;
}
/**
 * Animation sprites: like Emuera's SpriteAnime, each sprite name has one clock that starts the
 * first time it is shown and loops over the summed frame delays; every copy on screen shows
 * the frame for the current time. One requestAnimationFrame loop drives all of them.
 */
const animationClocks = new Map();
const animations = new Set();
let animationLoop = 0;
/** Emuera GetCurrentFrame: the first frame whose cumulative delay reaches the elapsed time. */
function animationFrameIndex(delays, total, start, now) {
  let elapsed = Math.floor(now - start) % total;
  for (let i = 0; i < delays.length; i++) {
    elapsed -= delays[i];
    if (elapsed <= 0) return i;
  }
  return delays.length - 1;
}
function tickAnimations(now) {
  for (const animation of animations) {
    const { holder, layers, delays, total, start, token } = animation;
    if (token !== generation || (animation.shown && !holder.isConnected)) { animations.delete(animation); continue; }
    animation.shown ||= holder.isConnected;
    const index = animationFrameIndex(delays, total, start, now);
    if (index === animation.index) continue;
    layers[animation.index].hidden = true;
    layers[index].hidden = false;
    animation.index = index;
  }
  animationLoop = animations.size ? requestAnimationFrame(tickAnimations) : 0;
}
function animate(name, holder, layers, delays, token) {
  const total = delays.reduce((sum, delay) => sum + delay, 0);
  if (layers.length < 2 || total <= 0) return;
  let start = animationClocks.get(name);
  if (start === undefined) animationClocks.set(name, start = performance.now());
  const index = animationFrameIndex(delays, total, start, performance.now());
  layers.forEach((layer, i) => { layer.hidden = i !== index; });
  animations.add({ holder, layers, delays, total, start, token, index, shown: false });
  animationLoop ||= requestAnimationFrame(tickAnimations);
}
const backgroundLayers = { back: document.querySelector("#cbg-back"), front: document.querySelector("#cbg-front") };
let backgroundVersion = 0;
let backgroundMap = null;
let backgroundMapVersion = 0;
let backgroundButtons = [];
let selectedBackground = -1;
async function showBackgroundMap(picture) {
  const version = ++backgroundMapVersion;
  backgroundMap = null;
  try {
    const canvas = picture ? await paintPicture(picture) : null;
    if (version === backgroundMapVersion) backgroundMap = canvas;
  } catch (error) { message(`Could not draw the background hit map: ${error.message}`, true); }
}
function backgroundHit(event) {
  if (!backgroundMap) return -1;
  const [x, y] = clientPoint(event);
  const top = backgroundMap.height + y;
  if (x < 0 || top < 0 || x >= backgroundMap.width || top >= backgroundMap.height) return -1;
  const [r, g, b, a] = backgroundMap.getContext("2d").getImageData(x, top, 1, 1).data;
  return a === 255 ? (r << 16) | (g << 8) | b : -1;
}
function selectBackground(value) {
  if (value === selectedBackground) return;
  selectedBackground = value;
  hideTooltip();
  for (const { canvas, hover, buttonValue } of backgroundButtons) {
    const selected = value >= 0 && value === buttonValue;
    if (hover) { canvas.hidden = selected; hover.hidden = !selected; }
    if (selected) canvas.dispatchEvent(new Event("mouseenter"));
  }
}
/** Puts the CBG layers over the terminal's visible box (Emuera's client area, without the scrollbar). */
function placeBackground() {
  for (const layer of Object.values(backgroundLayers)) {
    Object.assign(layer.style, {
      left: `${terminal.offsetLeft + terminal.clientLeft}px`, top: `${terminal.offsetTop + terminal.clientTop}px`,
      width: `${terminal.clientWidth}px`, height: `${terminal.clientHeight}px`,
    });
  }
  const scale = imageScale();
  for (const canvas of document.querySelectorAll(".cbg-layer canvas")) {
    const { x, y, width, height } = canvas.dataset;
    Object.assign(canvas.style, { left: `${x * scale}px`, bottom: `${-y * scale}px`, width: `${width * scale}px`, height: `${height * scale}px` });
  }
}
/** Shows the CBG layers (back to front; z > 0 behind the text, z < 0 in front), replacing the previous ones. */
async function showBackground(layers) {
  const version = ++backgroundVersion;
  let canvases;
  try {
    canvases = await Promise.all(layers.map(async (layer) => {
      const canvas = await pictureCopy(layer.picture);
      Object.assign(canvas.dataset, { x: layer.x, y: layer.y, width: layer.picture.width, height: layer.picture.height });
      const hover = layer.hover ? await pictureCopy(layer.hover) : null;
      if (hover) {
        Object.assign(hover.dataset, { x: layer.x, y: layer.y, width: layer.hover.width, height: layer.hover.height });
        hover.hidden = true;
      }
      if (layer.tooltip) describe(canvas, layer.tooltip);
      return { canvas, hover, buttonValue: layer.buttonValue, front: layer.z < 0 };
    }));
  } catch (error) {
    message(`Could not draw a background picture: ${error.message}`, true);
    return;
  }
  if (version !== backgroundVersion) return;
  backgroundButtons = canvases;
  selectedBackground = -1;
  backgroundLayers.back.replaceChildren(...canvases.filter((entry) => !entry.front).flatMap((entry) => entry.hover ? [entry.canvas, entry.hover] : [entry.canvas]));
  backgroundLayers.front.replaceChildren(...canvases.filter((entry) => entry.front).flatMap((entry) => entry.hover ? [entry.canvas, entry.hover] : [entry.canvas]));
  terminal.classList.toggle("has-cbg-back", backgroundLayers.back.childElementCount > 0);
  placeBackground();
}
/** A private copy of a painted picture: the painted canvas is cached and shared. */
async function pictureCopy(picture) {
  const painted = await paintPicture(picture);
  const copy = newCanvas(painted.width, painted.height);
  copy.getContext("2d").drawImage(painted, 0, 0);
  return copy;
}
/**
 * Emuera draws an image from the top of its line (offset by ypos) without changing the line's height; scripts print
 * blank lines to make room. So the holder only takes the image's width and the picture overflows downwards.
 */
async function image(source, token, suppliedSprite, scale = imageScale(), suppliedHover) {
  const holder = document.createElement("span");
  holder.className = "sprite";
  const name = source.getAttribute("src");
  if (!name) throw new Error("Image has no src");
  holder.dataset.src = name;
  const hover = source.getAttribute("srcb");
  // Builds one clipped picture; src and srcb (the mouse-over picture) share the img's size and ypos.
  const clipFor = async (name, supplied) => {
    const cacheKey = `${runGame}\n${name}`;
    let promise = supplied ? Promise.resolve(supplied) : sprites.get(cacheKey);
    if (!promise) {
      promise = api(`/api/sprite?name=${encodeURIComponent(name)}${runGame ? `&game=${encodeURIComponent(runGame)}` : ""}`);
      sprites.set(cacheKey, promise);
    }
    const sprite = await promise;
    if (token !== generation) return undefined;
    // img is the whole source (sheet or painted canvas); sprite.x/y/width/height crop it.
    let img, naturalWidth, naturalHeight, layers = [];
    if (sprite.frames?.length) {
      // An animation: every frame is a picture of the sprite's size, stacked and shown in turn.
      layers = await Promise.all(sprite.frames.map((frame) => pictureCopy(frame.picture)));
      [img] = layers;
      [naturalWidth, naturalHeight] = [img.width, img.height];
    } else if (sprite.picture) {
      // A runtime-made sprite (SPRITECREATE), or an animation that has no frames yet.
      img = await pictureCopy(sprite.picture);
      [naturalWidth, naturalHeight] = [img.width, img.height];
    } else {
      img = document.createElement("img");
      img.alt = name;
      await loadImage(img, sprite.url);
      [naturalWidth, naturalHeight] = [img.naturalWidth, img.naturalHeight];
    }
    if (token !== generation) return undefined;
    const width = sprite.width || naturalWidth;
    const height = sprite.height || naturalHeight;
    const signedHeight = sizeAttribute(source.getAttribute("height") || null, metrics.fontSize * scale, scale) || metrics.fontSize * scale;
    const signedWidth = sizeAttribute(source.getAttribute("width") || null, 0, scale) || width / height * Math.abs(signedHeight);
    // Negative sizes flip the picture in place.
    const targetHeight = Math.abs(signedHeight), targetWidth = Math.abs(signedWidth);
    const clip = document.createElement("span");
    clip.className = "sprite-clip";
    Object.assign(clip.style, { top: `${sizeAttribute(source.getAttribute("ypos"), 0, scale)}px`, width: `${targetWidth}px`, height: `${targetHeight}px` });
    if (signedWidth < 0 || signedHeight < 0) clip.style.transform = `scale(${Math.sign(signedWidth)}, ${Math.sign(signedHeight)})`;
    for (const layer of layers.length ? layers : [img]) {
      layer.style.width = `${naturalWidth * targetWidth / width}px`;
      layer.style.height = `${naturalHeight * targetHeight / height}px`;
      layer.style.left = `${-sprite.x * targetWidth / width}px`;
      layer.style.top = `${-sprite.y * targetHeight / height}px`;
      clip.append(layer);
    }
    return { clip, layers, targetWidth, delays: sprite.frames?.map((frame) => frame.delay) ?? [] };
  };
  const draw = async () => {
    try {
      const [main, over] = await Promise.all([clipFor(name, suppliedSprite), hover ? clipFor(hover, suppliedHover) : undefined]);
      if (!main || token !== generation) return;
      holder.style.width = `${main.targetWidth}px`;
      holder.append(main.clip);
      animate(name, holder, main.layers, main.delays, token);
      if (over) {
        // Shown instead of src while the pointer is over the enclosing button (CSS), as Emuera does.
        over.clip.classList.add("sprite-hover");
        main.clip.classList.add("sprite-normal");
        holder.append(over.clip);
        animate(hover, holder, over.layers, over.delays, token);
      }
    } catch (error) {
      if (token !== generation) return;
      holder.className = "missing";
      holder.textContent = `[Image ${name}: ${error.message}]`;
    }
  };
  pendingImages.push(draw());
  return holder;
}
/**
 * Hotpatch extension: area pictures. The main screen's sky (hotpatch/MAIN_SCREEN.ERB, HOTPATCH_SKY) names its area,
 * season and hour in its classes. When web/areas/<area>-<name>/<season>-<day|night>-*.png exist (src/area-art.ts),
 * they replace the area's SVG landmark: left and right ends over the middle one repeated along the header, one art
 * pixel per CSS pixel, the header growing to their height. Dawn and night use the night pictures, or the day ones
 * dimmed when there are none.
 */
let areaManifest;
async function prepareAreaArt() {
  const skies = [...outputRoot.querySelectorAll(".era-sky[class*='era-area-']:not([data-area-art])")];
  if (!skies.length) return;
  areaManifest ??= api("/api/areas").catch((error) => { console.warn("Area pictures unavailable:", error); return {}; });
  const manifest = await areaManifest;
  for (const sky of skies) {
    sky.dataset.areaArt = "";
    const area = [...sky.classList].find((name) => /^era-area-\d+$/.test(name))?.slice("era-area-".length);
    const season = [...sky.classList].find((name) => name.startsWith("era-season-"))?.slice("era-season-".length);
    const night = sky.matches(".era-sky-night, .era-sky-dawn");
    const sets = manifest[area] ?? {};
    const lit = night && sets[`${season}-night`]?.middle;
    const set = lit ? sets[`${season}-night`] : sets[`${season}-day`];
    if (!set?.middle) continue;
    sky.dataset.areaArt = `${season}-${lit ? "night" : "day"}`;
    sky.classList.add("era-area-art");
    sky.classList.toggle("era-area-art-night", Boolean(lit));
    const header = sky.closest(".era-main-header") ?? sky;
    for (const part of ["left", "middle", "right"]) {
      if (!set[part]) continue;
      sky.style.setProperty(`--area-${part}`, `url("${set[part]}")`);
      const img = new Image();
      pendingImages.push(loadImage(img, set[part]).then(() => {
        if (part === "middle") header.style.setProperty("--area-art-height", `${img.naturalHeight}px`);
      }, (error) => console.warn(`Area picture ${set[part]}:`, error)));
    }
  }
}
/**
 * Hotpatch extension: map pictures. The map renderers (hotpatch/MOVE_MAP.ERB) wrap a text map in
 * <era-open class='era-map-art era-map-key-<key>'>. When web/maps/<key>.<ext> exists, the text map is swapped for the
 * picture and its room buttons are laid over it, each where its number sits in the text map (the picture is taken to
 * cover the text map's area), unless web/maps/<key>.json places it: { "width": px, "rooms": { "<number>": [[x%, y%], …] } }.
 * Listing a number there replaces all its automatic positions; [] hides it.
 */
const MAP_TEXT_KEY = "era-typescript.mapText";
let mapManifest = {};
/** Marks new, complete map boxes; the ones with a picture stay hidden while it loads, to be laid out once shown. */
async function prepareMapPictures() {
  const boxes = [...outputRoot.querySelectorAll(".era-map-art:not([data-map])")].filter((box) => box.dataset.closed);
  if (!boxes.length) return;
  // Fetched afresh for each new map so pictures dropped into web/maps show up without reloading.
  try { mapManifest = await api("/api/maps"); } catch (error) { console.warn("Map pictures unavailable:", error); }
  for (const box of boxes) {
    const name = [...box.classList].find((name) => name.startsWith("era-map-key-"))?.slice("era-map-key-".length) ?? "";
    box.dataset.map = name;
    const entry = mapManifest[name];
    if (!entry?.image) continue;
    box.classList.add("era-map-pending");
    const img = document.createElement("img");
    img.alt = `Map (${name})`;
    box.mapPicture = { img, entry };
    pendingImages.push(loadImage(img, entry.image).catch((error) => { box.mapPicture.error = `${entry.image}: ${error.message}`; }));
  }
}
/** Lays the room buttons over each pending map's picture, measuring where they sit in the (hidden) text map. */
function layoutMapPictures() {
  for (const box of terminal.querySelectorAll(".era-map-art.era-map-pending")) {
    box.classList.remove("era-map-pending");
    const { img, entry, error } = box.mapPicture;
    const rows = [...box.children].filter((child) => child.matches(".line:not(.era-marker)"));
    if (error) {
      const note = document.createElement("div");
      note.className = "missing";
      note.textContent = `[Map picture ${error}]`;
      box.append(note);
      continue;
    }
    if (!rows.length) continue;
    const area = box.getBoundingClientRect();
    const top = rows[0].getBoundingClientRect().top, height = rows.at(-1).getBoundingClientRect().bottom - top;
    const picture = document.createElement("div");
    picture.className = "era-map-picture";
    const layout = entry.layout && typeof entry.layout === "object" ? entry.layout : {};
    picture.style.width = `${Number(layout.width) > 0 ? Number(layout.width) : box.offsetWidth}px`;
    picture.append(img);
    const problems = entry.error ? [entry.error] : [];
    const placed = new Set();
    const badge = (button, x, y) => {
      const label = button.textContent.trim().replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
      const copy = choice(label, button.dataset.value, button.dataset.tooltip ?? "");
      copy.classList.add("era-map-room");
      const inked = [...button.querySelectorAll("*")].find((node) => node.textContent.trim());
      copy.style.color = getComputedStyle(inked ?? button).color;
      copy.style.left = `${x}%`;
      copy.style.top = `${y}%`;
      picture.append(copy);
    };
    for (const button of box.querySelectorAll(".line button.choice")) {
      const value = button.dataset.value;
      const fixed = layout.rooms?.[value];
      if (Array.isArray(fixed)) {
        if (placed.has(value)) continue;
        placed.add(value);
        for (const position of fixed)
          if (Array.isArray(position) && position.length === 2 && position.every(Number.isFinite)) badge(button, position[0], position[1]);
          else problems.push(`web/maps/${box.dataset.map}.json: rooms["${value}"] needs [x%, y%] pairs`);
        continue;
      }
      const at = button.getBoundingClientRect();
      badge(button, (at.left + at.width / 2 - area.left) / area.width * 100, (at.top + at.height / 2 - top) / height * 100);
    }
    if (problems.length) {
      const note = document.createElement("div");
      note.className = "missing";
      note.textContent = `[${problems.join("; ")}]`;
      picture.append(note);
    }
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "era-map-switch";
    const show = (text) => {
      box.classList.toggle("is-picture", !text);
      toggle.textContent = text ? "Picture" : "Text map";
      toggle.title = text ? "Show the map's picture" : "Show the game's text map";
    };
    toggle.addEventListener("click", () => {
      const text = box.classList.contains("is-picture");
      if (text) localStorage.setItem(MAP_TEXT_KEY, "1"); else localStorage.removeItem(MAP_TEXT_KEY);
      show(text);
    });
    box.append(picture, toggle);
    show(localStorage.getItem(MAP_TEXT_KEY) === "1");
  }
}
const allowedTags = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "S", "SPAN", "NOBR", "FONT", "NONBUTTON", "DIV"]);
/** A locked HTML position resets the cursor from the line's left edge, including when it moves backwards. */
function layoutHtmlPositions() {
  for (const element of terminal.querySelectorAll(".html-positioned")) {
    const origin = element.closest(".subarea, .line");
    element.style.marginLeft = "0px";
    const offset = element.getBoundingClientRect().left - origin.getBoundingClientRect().left;
    element.style.marginLeft = `${Number(element.dataset.htmlPosition) - offset}px`;
  }
}
let htmlPositionsFrame = 0;
function scheduleHtmlPositions() {
  if (htmlPositionsFrame) return;
  htmlPositionsFrame = requestAnimationFrame(() => {
    htmlPositionsFrame = 0;
    layoutHtmlPositions();
  });
}
// Both on-device translation and browser page translators can change widths after rendering.
new MutationObserver(scheduleHtmlPositions).observe(terminal, { childList: true, characterData: true, subtree: true });
/**
 * Hotpatch extension (not Emuera HTML): era-* classes are styled by style.css; other class names are ignored so
 * game markup can't pick up the client's own classes.
 */
function applyClasses(element, node) {
  for (const name of (node.getAttribute("class") ?? "").split(/\s+/)) if (/^era-[a-z0-9-]+$/.test(name)) element.classList.add(name);
}
/** Hotpatch extension: <meter value max [min]> is a bar filled to (value - min) / (max - min). */
function meter(node) {
  const number = (name, fallback) => {
    const value = Number(node.getAttribute(name) ?? fallback);
    if (!Number.isFinite(value)) throw new Error(`Unsupported meter ${name}: ${node.getAttribute(name)}`);
    return value;
  };
  const min = number("min", 0), max = number("max", 1), value = number("value", 0);
  const element = document.createElement("span");
  element.className = "era-meter";
  element.setAttribute("role", "meter");
  element.setAttribute("aria-valuemin", String(min));
  element.setAttribute("aria-valuemax", String(max));
  element.setAttribute("aria-valuenow", String(value));
  const fill = document.createElement("span");
  fill.style.width = `${max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) * 100 : 0}%`;
  element.append(fill);
  return element;
}
/**
 * Emuera EM+EE <div> sub-area: drawn at the current print position, offset by xpos/ypos, without taking room in the
 * line (scripts print blank lines to make room, as for images). Sizes are px or percentages of the font size.
 * Games lay sub-areas out against the window width, so they and their images use the column scale: the layout then
 * spans the same columns as in Emuera even though our lines are taller.
 */
const subareaAttributes = ["width", "height", "xpos", "ypos", "size", "rect", "depth", "color", "display", "margin", "padding", "border", "bcolor", "radius"];
function subarea(node, scale) {
  const size = (value) => sizeAttribute(value, 0, scale);
  const list = (name, count = 4) => {
    const value = node.getAttribute(name);
    if (value === null) return null;
    const parts = value.split(",");
    if (parts.length > count) throw new Error(`Unsupported div ${name}: ${value}`);
    return parts.map((part) => size(part));
  };
  const box = (name) => list(name)?.map((part) => `${Math.max(0, part)}px`).join(" ");
  const rect = list("rect"), pair = list("size", 2);
  const [x, y, width, height] = rect?.length === 4 ? rect : [
    size(node.getAttribute("xpos")), size(node.getAttribute("ypos")),
    pair?.[0] ?? size(node.getAttribute("width")), pair?.[1] ?? size(node.getAttribute("height")),
  ];
  const anchor = document.createElement("span");
  anchor.className = "subarea-anchor";
  const area = document.createElement("div");
  area.className = "subarea";
  const absolute = node.getAttribute("display")?.toLowerCase() === "absolute";
  if (absolute) anchor.classList.add("subarea-fixed");
  Object.assign(area.style, {
    left: `${x}px`, [absolute ? "bottom" : "top"]: `${y}px`, width: `${Math.max(0, width)}px`, height: `${Math.max(0, height)}px`,
    margin: box("margin") ?? "", padding: box("padding") ?? "", borderWidth: box("border") ?? "", borderRadius: box("radius") ?? "",
  });
  const depth = Number(node.getAttribute("depth") ?? 0);
  if (Number.isFinite(depth) && depth) area.style.zIndex = String(-Math.trunc(depth));
  const colour = /^(?:#[0-9a-f]{6}|[a-z]+)$/i;
  const background = node.getAttribute("color");
  if (background && colour.test(background)) area.style.background = background;
  const borderColours = node.getAttribute("bcolor")?.split(",").map((part) => part.trim());
  if (borderColours?.length && borderColours.length <= 4 && borderColours.every((part) => colour.test(part))) area.style.borderColor = borderColours.join(" ");
  anchor.append(area);
  anchor.subareaContent = area;
  return anchor;
}
async function renderHtml(markup, parent, sprites) {
  // Parse inertly, then rebuild an allowlisted DOM. Never attach game HTML directly.
  // The explicit <body> keeps leading spaces, which the parser otherwise drops before the body starts (Emuera keeps them).
  const documentNode = new DOMParser().parseFromString(`<body>${markup}`, "text/html");
  if (documentNode.head.children.length)
    throw new Error(`Unsupported HTML tag: <${documentNode.head.firstElementChild.tagName.toLowerCase()}>`);
  const token = generation;
  async function copy(node, destination, scale) {
    if (node.nodeType === Node.TEXT_NODE) { destination.append(document.createTextNode(node.textContent)); return; }
    if (!(node instanceof Element)) return;
    let element;
    if (node.tagName === "IMG") element = await image(node, token, sprites?.[node.getAttribute("src")], scale, sprites?.[node.getAttribute("srcb")]);
    else if (node.tagName === "SHAPE") {
      const type = node.getAttribute("type")?.toLowerCase();
      const fontSize = Number.parseFloat(getComputedStyle(terminal).fontSize);
      const params = (node.getAttribute("param") ?? "").split(",").map((part) => {
        const match = /^\s*(-?\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(part);
        if (!match) throw new Error(`Unsupported shape parameter: ${part}`);
        return Math.max(-4096, Math.min(4096, match[2] ? Number(match[1]) : Number(match[1]) * fontSize / 100));
      });
      element = document.createElement("span");
      element.style.display = "inline-block";
      if (type === "space" && params.length === 1) element.style.width = `${Math.max(0, params[0])}px`;
      else if (type === "rect" && (params.length === 1 && params[0] > 0 || params.length === 4 && params[0] >= 0 && params[2] > 0 && params[3] > 0)) {
        // Emuera ConsoleRectangleShapePart: x, y, width, height from the line top; one value is a full-height bar.
        const [x, y, width, height] = params.length === 1 ? [0, 0, params[0], fontSize] : params;
        element.className = "shape-rect";
        element.style.width = `${x + width}px`;
        const fill = document.createElement("span");
        Object.assign(fill.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${Math.max(1, height)}px` });
        const color = node.getAttribute("color");
        if (color && /^#[0-9a-f]{6}$/i.test(color)) fill.style.background = color;
        element.append(fill);
      } else throw new Error(`Unsupported HTML shape: ${type} ${node.getAttribute("param")}`);
    }
    else if (node.tagName === "METER") element = meter(node);
    else if (node.tagName === "DIV" && subareaAttributes.some((name) => node.hasAttribute(name))) element = subarea(node, scale = columnScale());
    else if (node.tagName === "BUTTON") {
      const value = node.getAttribute("value");
      if (value !== null) element = choice("", value, node.getAttribute("title") ?? "");
      else element = document.createElement("span");
    } else if (node.tagName === "A") {
      const href = node.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) throw new Error(`Unsupported link target: ${href}`);
      const url = new URL(href);
      if (url.username || url.password) throw new Error("Links containing credentials are not allowed");
      element = document.createElement("a");
      element.href = url.href;
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    } else if (allowedTags.has(node.tagName)) {
      element = document.createElement(["NOBR", "FONT", "NONBUTTON"].includes(node.tagName) ? "span" : node.tagName.toLowerCase());
      if (node.tagName === "NOBR") element.style.whiteSpace = "nowrap";
      const alignment = node.getAttribute("align")?.toLowerCase();
      if (["left", "center", "right"].includes(alignment)) element.style.textAlign = alignment;
      const face = node.getAttribute("face");
      if (face) applyFont(element, face);
      const color = node.getAttribute("color")?.replace(/^#0x([0-9a-f]{6})$/i, "#$1");
      if (color && /^(?:#[0-9a-f]{6}|[a-z]+)$/i.test(color)) {
        element.style.color = color;
        markTextColor(element, color);
      }
    } else throw new Error(`Unsupported HTML tag: <${node.tagName.toLowerCase()}>`);
    if (["BUTTON", "NONBUTTON"].includes(node.tagName) && node.hasAttribute("pos")) {
      const position = node.getAttribute("pos").trim();
      if (!/^-?\d+$/.test(position)) throw new Error(`Unsupported HTML position: ${position}`);
      element.classList.add("html-positioned");
      element.dataset.htmlPosition = String(sizeAttribute(position, 0, scale ?? imageScale()));
    }
    applyClasses(element, node);
    if (element.matches(".era-occupant-label, .era-guard-toggle"))
      element.setAttribute("aria-pressed", String(node.getAttribute("aria-pressed") === "true"));
    // Hotpatch extension: data-room links a non-button element to the map's room buttons with that value.
    const room = node.getAttribute("data-room");
    if (room !== null && /^-?\d+$/.test(room)) element.dataset.room = room;
    const title = node.getAttribute("title");
    if (title && !element.dataset.tooltip) describe(element, title);
    destination.append(element);
    if (node.tagName !== "IMG" && node.tagName !== "METER") for (const child of node.childNodes) await copy(child, node.tagName === "SHAPE" ? destination : element.subareaContent ?? element, scale);
  }
  for (const child of documentNode.body.childNodes) await copy(child, parent, undefined);
  parent.querySelectorAll("button.choice, .has-tooltip").forEach(decorateLabel);
}
// A browser's page translator (Chrome/Edge mark <html> with translated-ltr/-rtl and wrap
// translated text in <font>, which our renderer never emits) only notices nodes added
// to the live page, so while one is active updates are rendered in place.
function pageTranslated() {
  return /\btranslated-(ltr|rtl)\b/.test(document.documentElement.className) || terminal.querySelector("font") !== null;
}
function render(snapshot, advanceScreen = false, fresh = false, keepFocus = false, toBottom = fresh) {
  return renderSteps([{ snapshot, advanceScreen }], fresh, keepFocus, toBottom);
}
/** Renders steps in order and shows the result at once; several steps rebuild a reloaded run's output. */
async function renderSteps(steps, fresh = false, keepFocus = false, toBottom = fresh) {
  const clickingThrough = input?.kind === "wait";
  const scrollTop = terminal.scrollTop;
  const followBottom = toBottom || terminal.scrollHeight - terminal.clientHeight - scrollTop < 2;
  const live = pageTranslated();
  const staged = live ? terminal : document.createElement("div");
  if (live && fresh) terminal.replaceChildren();
  // Keep a visual copy on screen while the original nodes (and their listeners)
  // are updated off-screen. Commit only after HTML and new images are ready.
  if (!fresh && !live) {
    const visible = terminal.cloneNode(true);
    // Cloned canvases are blank; copy their pixels so pictures don't blink out while the update is prepared.
    const originals = terminal.querySelectorAll("canvas");
    visible.querySelectorAll("canvas").forEach((copy, i) => {
      if (originals[i].width && originals[i].height) copy.getContext("2d").drawImage(originals[i], 0, 0);
    });
    staged.append(...terminal.childNodes);
    terminal.replaceChildren(...visible.childNodes);
    syncDialogs();
  }
  outputRoot = staged;
  pendingImages = [];
  terminal.setAttribute("aria-busy", "true");
  try {
    for (const { snapshot, advanceScreen } of steps) await renderSnapshot(snapshot, advanceScreen);
    await Promise.all(pendingImages);
  } finally {
    if (!live) terminal.replaceChildren(...staged.childNodes);
    outputRoot = terminal;
    pendingImages = [];
    syncDialogs();
    layoutHtmlPositions();
    layoutMapPictures();
    revealSelectedOccupants();
    markMapLabels();
    translation.translateTree(terminal);
    terminal.removeAttribute("aria-busy");
    updateControls();
    if (followBottom) terminal.scrollTop = terminal.scrollHeight;
    else terminal.scrollTop = scrollTop;
    scheduleTimedWait();
    if (clickingThrough && input && input.kind !== "wait") settle();
  }
  if (input && !keepFocus) command.focus({ preventScroll: true });
}
// TINPUT/TWAIT timers run in the browser; expiry asks the runtime to apply the timeout.
function clearTimedWait() {
  if (!timedWait) return;
  clearTimeout(timedWait.handle);
  clearInterval(timedWait.tick);
  timedWait = null;
}
function scheduleTimedWait() {
  clearTimedWait();
  if (!input?.timeout) return;
  const deadline = performance.now() + input.timeout;
  const counter = input.countdown ? lastOutputLine() : null;
  const tick = counter && setInterval(() => {
    counter.textContent = `残り ${Math.max(0, Math.floor((deadline - performance.now()) / 100)) / 10}`;
  }, 100);
  timedWait = { handle: setTimeout(() => { void expire(); }, input.timeout), tick };
}
async function expire() {
  const current = generation;
  if (busy) {
    // An input is in flight; if it is rejected, the wait is still pending.
    timedWait = { handle: setTimeout(() => { void expire(); }, 50), tick: timedWait?.tick };
    return;
  }
  clearTimedWait();
  busy = true;
  expiring = true;
  try {
    const snapshot = await api("/api/timeout", { session, step, columns: terminalColumns(), display: displaySettings(), client: clientState() });
    if (current === generation) await render(snapshot, false, false, true);
  } catch (error) { if (!staleTab(error)) message(error.message, true); }
  finally {
    busy = false;
    expiring = false;
    updateControls();
    const queued = queuedSubmit;
    queuedSubmit = null;
    if (queued) {
      const selected = queued.choice === undefined ? null : [...terminal.querySelectorAll(".screen.is-active button.choice")]
        .find((button) => button.dataset.value === queued.choice) ?? null;
      void submit(queued.value, selected);
    }
  }
}
/**
 * The game only recolours the selected character's name. Its picture buttons send 1000 + character index
 * (IMAGE.ERB, USERCOM.ERB), so the picture of the current TARGET is marked for styling.
 */
const TARGET_BUTTON_BASE = 1000;
function markTarget(target) {
  for (const button of outputRoot.querySelectorAll("button.choice:is(.is-target, .is-not-target)"))
    button.classList.remove("is-target", "is-not-target");
  if (!Number.isInteger(target) || target < 0) return;
  const value = String(TARGET_BUTTON_BASE + target);
  const pictures = [...outputRoot.querySelectorAll(".screen.is-active button.choice:has(.sprite)")]
    .filter((button) => Math.floor(Number(button.dataset.value) / TARGET_BUTTON_BASE) === 1
      && (!button.closest(".era-occupants") || button.closest(".era-portrait")));
  // Layered pictures (effects drawn over the body) are further buttons with the same value; mark only the base.
  const selected = pictures.find((button) => button.dataset.value === value);
  if (!selected) return;
  selected.classList.add("is-target");
  // Other characters' pictures (all their layers) are dimmed so the selection stands out.
  for (const button of pictures) if (button.dataset.value !== value) button.classList.add("is-not-target");
}
function revealSelectedOccupants() {
  for (const occupant of terminal.querySelectorAll('.screen.is-active .era-occupant:has(.era-occupant-label[aria-pressed="true"])')) {
    const lineup = occupant.closest(".era-occupant-list");
    lineup.scrollLeft += occupant.getBoundingClientRect().left - lineup.getBoundingClientRect().left
      - Math.max(0, (lineup.clientWidth - occupant.offsetWidth) / 2);
  }
}
let backgroundAudio = null;
const soundAudio = new Set();
const blockedAudio = new Set();
function stopAudio(element) {
  element.pause();
  element.removeAttribute("src");
  element.load();
  soundAudio.delete(element);
  blockedAudio.delete(element);
}
function playAudio(element) {
  element.play().catch((error) => {
    if (backgroundAudio?.element !== element && !soundAudio.has(element)) return;
    if (error.name === "NotAllowedError") {
      if (!blockedAudio.has(element)) message("Audio is blocked by the browser. Click or press a key to enable playback.", true);
      blockedAudio.add(element);
    } else message(`Could not play audio: ${error.message}`, true);
  });
}
function retryAudio() {
  for (const element of blockedAudio) playAudio(element);
  blockedAudio.clear();
}
document.addEventListener("pointerdown", retryAudio);
document.addEventListener("keydown", retryAudio);
function resetAudio() {
  if (backgroundAudio) stopAudio(backgroundAudio.element);
  backgroundAudio = null;
  for (const element of soundAudio) stopAudio(element);
}
function useAudioSettings(settings) {
  if (settings.stopSounds) for (const element of soundAudio) stopAudio(element);
  if (backgroundAudio?.id !== settings.bgm?.id) {
    if (backgroundAudio) stopAudio(backgroundAudio.element);
    backgroundAudio = null;
    if (settings.bgm) {
      const element = new Audio(settings.bgm.url);
      element.loop = true;
      element.volume = settings.bgmVolume / 100;
      backgroundAudio = { id: settings.bgm.id, element };
      element.addEventListener("error", () => {
        if (backgroundAudio?.element === element) message(`Could not load background audio: ${settings.bgm.url}`, true);
      });
      playAudio(element);
    }
  }
  if (backgroundAudio) backgroundAudio.element.volume = settings.bgmVolume / 100;
  for (const element of soundAudio) element.volume = settings.soundVolume / 100;
  for (const track of settings.sounds) {
    if (soundAudio.size >= 10) stopAudio(soundAudio.values().next().value);
    const element = new Audio(track.url);
    element.volume = settings.soundVolume / 100;
    soundAudio.add(element);
    let remaining = track.repeat;
    element.addEventListener("ended", () => {
      if (!soundAudio.has(element)) return;
      if (--remaining > 0) { element.currentTime = 0; playAudio(element); }
      else stopAudio(element);
    });
    element.addEventListener("error", () => {
      if (!soundAudio.has(element)) return;
      message(`Could not load sound: ${track.url}`, true);
      stopAudio(element);
    });
    playAudio(element);
  }
}
/** advanceScreen: true after a submitted input (retires the screen), "continue" after a click-to-continue wait. */
async function renderSnapshot(snapshot, advanceScreen) {
  hideTooltip();
  document.title = snapshot.title || "Emuera.ts";
  showDebugOutput(snapshot);
  await Promise.all([
    snapshot.cbg ? showBackground(snapshot.cbg) : undefined,
    snapshot.cbgMap !== undefined ? showBackgroundMap(snapshot.cbgMap) : undefined,
  ]);
  if (snapshot.tooltip) useTooltipSettings(snapshot.tooltip);
  if (snapshot.audio) useAudioSettings(snapshot.audio);
  if (snapshot.textbox !== undefined) command.value = snapshot.textbox;
  const previousScreen = currentScreen;
  const previousLine = currentLine;
  if (advanceScreen === "continue") {
    // An unfinished line keeps printing into its screen; otherwise the continued output starts a new screen.
    if (currentScreen && !currentLine) {
      continuedScreens.push(currentScreen);
      currentScreen = null;
    }
  } else if (advanceScreen) {
    retireScreen();
    currentScreen = null;
    currentLine = null;
  }
  for (const output of snapshot.output) {
    if (output.browserLaunch) {
      const { id, url } = output.browserLaunch;
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
        throw new Error("Unsupported browser launch URL");
      const key = `era-browser-launch:${id}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.open(parsed.href, "_blank", "noopener,noreferrer");
      }
    }
    // Input echoes complete the submitted screen, including unfinished prompts.
    if (advanceScreen && output.type === "input" && previousScreen?.parentElement === outputRoot) {
      currentScreen = previousScreen;
      currentLine = previousLine;
    }
    if (output.type === "clear") {
      let remaining = output.count;
      let reachedHistory = false;
      while (remaining > 0 && outputRoot.lastElementChild) {
        const group = outputRoot.lastElementChild;
        const last = [...group.querySelectorAll(".line")].at(-1);
        if (!last) {
          group.remove();
          continue;
        }
        if (group.classList.contains("is-history")) reachedHistory = true;
        const lines = Number(last.dataset.logicalLines ?? 1);
        if (lines > remaining) {
          const retained = lines - remaining;
          last.dataset.logicalLines = String(retained);
          last.style.height = `${retained * Number(last.dataset.lineHeight)}px`;
          break;
        }
        removeLine(last);
        remaining -= lines;
        if (!group.querySelector(".line")) group.remove();
      }
      currentLine = null;
      const last = outputRoot.lastElementChild;
      if (reachedHistory && last?.classList.contains("is-history")) reviveScreen(last);
      continue;
    }
    if (output.type === "title-image") {
      currentLine = null;
      const target = line();
      applyStyle(target, output.style);
      applyAlignment(target, "center");
      target.classList.add("title-image");
      const lineHeight = Number.parseFloat(getComputedStyle(terminal).fontSize);
      target.dataset.logicalLines = String(output.lines);
      target.dataset.lineHeight = String(lineHeight);
      target.style.height = `${output.lines * lineHeight}px`;
      const source = document.createElement("span");
      source.setAttribute("src", "TW title");
      source.setAttribute("height", `${output.lines * lineHeight}px`);
      target.append(await image(source, generation, output.sprite, 1));
      currentLine = null;
      continue;
    }
    const target = line();
    applyLineStyle(target, output.style);
    if (output.type === "text") {
      const parts = output.text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i) currentLine = null;
        const textLine = line();
        applyLineStyle(textLine, output.style);
        if (output.single || ruleTail.test(parts[i])) textLine.classList.add("single-line");
        const fragment = document.createElement("span");
        applyStyle(fragment, output.style);
        if (!parts[i].trim()) fragment.classList.add("is-empty");
        // A PRINTC button item is padded to a fixed width and wraps only as a whole, so a row of them lines up like a grid.
        if (output.cell) fragment.classList.add("print-cell");
        if (output.plain) fragment.textContent = parts[i];
        else appendText(fragment, parts[i]);
        textLine.append(fragment);
      }
      if (output.newline) currentLine = null;
      continue;
    }
    const marker = output.type === "html" && boxMarker.exec(output.text);
    if (marker) {
      const shared = target.childNodes.length > 0;
      if (!shared) target.remove();
      if (marker[1].toLowerCase() === "open") openBox(marker[2] ?? marker[3] ?? "", shared);
      else closeBox(shared);
      continue;
    }
    const span = document.createElement("span");
    applyStyle(span, output.style);
    target.append(span);
    if (output.type === "html") {
      try {
        await renderHtml(output.text, span, output.sprites);
      }
      catch (error) {
        span.className = "missing";
        span.textContent = `[HTML renderer: ${error.message}]`;
      }
    } else if (output.type === "button") span.append(choice(output.text, output.value));
    else if (output.type === "input") span.textContent = output.text;
    if (output.newline) currentLine = null;
    if (advanceScreen && output.type === "input") {
      retireScreen();
      currentScreen = null;
      currentLine = null;
    }
  }
  if (snapshot.status !== "waiting" || snapshot.input?.kind !== "wait") {
    for (const screen of continuedScreens) if (screen !== currentScreen && screen.parentElement === outputRoot) retireScreen(screen);
    continuedScreens = [];
  }
  markTarget(snapshot.target);
  await prepareMapPictures();
  await prepareAreaArt();
  const revived = outputRoot.querySelectorAll(".screen.is-active button.choice.is-revived");
  if (revived.length && outputRoot.querySelector(".screen.is-active button.choice:not(.is-revived)")) {
    revived.forEach((button) => { button.classList.replace("is-revived", "is-stale"); });
    splitStaleOutput();
  }
  session = snapshot.session;
  input = snapshot.input;
  if (snapshot.step !== undefined) step = snapshot.step;
  rememberRun();
  if (snapshot.error) {
    const { file, line: sourceLine, message: reason, trace = [] } = snapshot.error;
    message(`Stopped at ${file}:${sourceLine}: ${reason}`, true);
    currentLine = null;
    line().textContent = `ERROR ${file}:${sourceLine} - ${reason}${trace.map((caller) => `\n  called from ${caller}`).join("")}`;
    currentLine.classList.add("missing");
    currentLine = null;
  } else message(snapshot.status !== "waiting" ? "Execution finished."
    : input.kind === "wait" ? "Click or press Enter to continue."
    : input.kind === "mousekey" ? "Click, scroll or press a key." : `Waiting for ${input.kind} input.`);
  // Keep DOM memory bounded during repeated demo / script runs.
  const lines = [...outputRoot.querySelectorAll(".screen .line")];
  if (lines.length > 5000) {
    for (const oldLine of lines.slice(0, lines.length - 4000)) {
      const group = oldLine.closest(".screen");
      removeLine(oldLine);
      if (!group.querySelector(".line")) group.remove();
    }
    message("Older output was trimmed (4,000 displayed lines retained).");
  }
}
function showReport(visible) {
  report.hidden = !visible;
  const mode = document.querySelector("#mode");
  mode.hidden = !runMode;
  mode.textContent = (runMode === "demo" ? "Demo" : "Game") + (runDebug ? " · Debug" : "");
  debugButton.setAttribute("aria-pressed", String(runDebug));
  debugPanel.hidden = !runDebug;
  document.querySelector("#report").setAttribute("aria-expanded", String(visible));
  demoButton.setAttribute("aria-pressed", String(!visible && runMode === "demo"));
  for (const button of startButtons.slice(1))
    button.setAttribute("aria-pressed", String(!visible && runMode === "game" && (button.dataset.game ?? "") === (runGame ?? "")));
  restartButton.textContent = runMode === "demo" ? "Restart demo…" : "Restart game…";
}
function terminalColumns() {
  const probe = document.createElement("span");
  probe.textContent = "0".repeat(100);
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;min-width:0";
  terminal.append(probe);
  const cellWidth = probe.getBoundingClientRect().width / 100;
  probe.remove();
  // The game's configured window width is the narrowest layout; a thinner browser scrolls sideways instead.
  const minimum = Math.max(20, Math.min(1000, metrics.columns));
  terminal.style.setProperty("--logical-width", `${Math.ceil(minimum * cellWidth)}px`);
  // The scrollbar sits in main's right padding (see --scrollbar-width in style.css).
  terminal.style.setProperty("--scrollbar-width", `${terminal.offsetWidth - terminal.clientWidth}px`);
  const style = getComputedStyle(terminal);
  const width = terminal.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
  return Math.max(minimum, Math.min(1000, Math.floor(width / cellWidth)));
}
/**
 * A click (or Enter) made while a step is running continues the next wait, so clicking ahead isn't lost.
 * Only one is kept, and it is dropped if the step ends anywhere other than a click-to-continue wait.
 */
let continueQueued = false;
let skipRequested = false;
let skipRunning = false;
function queueContinue() {
  continueQueued = true;
  message("Will continue when ready...");
}
function skipText() {
  skipRequested = true;
  continueQueued = false;
  void continueSkipping();
}
async function continueSkipping() {
  if (skipRunning) return;
  skipRunning = true;
  try {
    while (skipRequested && input?.kind === "wait" && !busy) {
      const previousStep = step;
      await submit("");
      if (step === previousStep) {
        skipRequested = false;
        break;
      }
    }
    if (input?.kind !== "wait") skipRequested = false;
  } finally {
    skipRunning = false;
    if (skipRequested && !busy && input?.kind === "wait") void continueSkipping();
  }
}
function runQueuedContinue() {
  if (skipRequested) { void continueSkipping(); return; }
  const queued = continueQueued;
  continueQueued = false;
  if (busy || input?.kind !== "wait" || input.blocking) return;
  if (queued) void submit("");
  else if (input.timeout == null) {
    // Let the server run the next step while the player reads, so the click is answered at once.
    void fetch("/api/prefetch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session, client: clientState() }) }).catch(() => {});
  }
}
/** Waits for the settings and the terminal font, which terminal measurements depend on. */
async function terminalReady() {
  await settingsLoaded;
  await document.fonts.load(`${getComputedStyle(terminal).fontSize} "BIZ UD Gothic"`);
  if (!document.fonts.check(`${getComputedStyle(terminal).fontSize} "BIZ UD Gothic"`))
    throw new Error("The bundled terminal font could not be loaded.");
}
/** Clears the run's client state before a new or resumed run is shown. */
function resetRun() {
  resetAudio();
  continueQueued = false;
  skipRequested = false;
  hideTooltip();
  busy = true;
  input = null;
  clearTimedWait();
  generation++;
  updateControls();
  beginActivity();
  currentScreen = null;
  continuedScreens = [];
  command.value = "";
  currentLine = null;
  void showBackground([]);
  void showBackgroundMap(null);
  useTooltipSettings(null);
}
async function start(mode, game = runGame, debug = debugPreferred()) {
  if (busy) return;
  library.hide();
  runMode = mode;
  runDebug = debug;
  debugLog.textContent = "";
  resetRun();
  try {
    await settingsLoaded;
    runGame = mode === "game" && games.some((entry) => entry.id === game) ? game : games[0]?.id ?? null;
    showReport(false);
    message(`Starting ${runName(mode, runGame)}${debug ? " in debug mode" : ""}...`);
    useGameDisplay(runGame);
    showRunInUrl();
    await terminalReady();
    const columns = terminalColumns();
    const snapshot = await api("/api/start", { mode, game: runGame ?? undefined, debug, previousSession: session, columns, display: displaySettings(), client: clientState() });
    activityResponded();
    await render(snapshot, false, true);
  }
  catch (error) { message(error.message, true); }
  finally { busy = false; endActivity(); updateControls(); if (input) command.focus({ preventScroll: true }); runQueuedContinue(); }
}
/**
 * Reattaches to a session still running on the server (after a page reload, or when another tab moved it on) by
 * replaying the steps it has shown. Returns false if the session is gone, e.g. expired or the server restarted.
 */
async function resume(id) {
  if (busy) return false;
  library.hide();
  resetRun();
  message("Restoring the current run...");
  let restored = false;
  try {
    await terminalReady();
    const data = await api("/api/resume", { session: id });
    activityResponded();
    runMode = data.mode;
    runGame = data.game ?? games[0]?.id ?? null;
    runDebug = !!data.debug;
    debugLog.textContent = "";
    useGameDisplay(runGame);
    showRunInUrl();
    showReport(false);
    const advance = { start: false, timeout: false, continue: "continue", input: true };
    await renderSteps(data.history.map(({ advance: how, snapshot }, i) =>
      ({ snapshot: { ...snapshot, session: id, audio: undefined }, advanceScreen: i === 0 ? false : advance[how] })), true);
    // The trimmed history may have lost the step that set them.
    await Promise.all([showBackground(data.cbg ?? []), showBackgroundMap(data.cbgMap ?? null)]);
    useTooltipSettings(data.tooltip ?? null);
    if (data.audio) useAudioSettings(data.audio);
    command.value = data.textbox ?? "";
    step = data.step;
    restored = true;
  } catch (error) {
    if (error.status !== 404) message(`Could not restore the current run: ${error.message}`, true);
  } finally {
    busy = false;
    endActivity();
    updateControls();
    if (input) command.focus({ preventScroll: true });
    if (restored) runQueuedContinue();
  }
  return restored;
}
/** A 409 means a duplicate of this tab continued the run; catch up with it instead of reporting an error. */
function staleTab(error) {
  if (error.status !== 409) return false;
  const id = session;
  // After the caller's finally block has cleared busy.
  setTimeout(() => { void resume(id).then((ok) => { if (ok) message("This run was continued in another tab; caught up with it."); }); });
  return true;
}
async function submit(value, selectedChoice = null) {
  // Input made while an animation frame is loading is sent once that frame is shown.
  if (expiring) { queuedSubmit = { value, choice: selectedChoice?.dataset.value }; return; }
  if (busy || !input || input.blocking) return;
  hideTooltip();
  busy = true;
  const waiting = input.kind === "wait";
  // Typed input that matches a visible choice highlights that choice too.
  const pending = selectedChoice ?? (value === "" ? null : [...terminal.querySelectorAll(".screen.is-active button.choice")]
    .find((button) => button.dataset.value === value) ?? null);
  pending?.classList.add("is-pending");
  message(input.kind === "wait" ? "Continuing..." : input.kind === "mousekey" ? "Sending input..." : `Sending ${JSON.stringify(pending?.textContent.replace(/\s+/g, " ").trim() || value)}...`);
  beginActivity();
  updateControls();
  try {
    const snapshot = await api("/api/input", { session, step, value, columns: terminalColumns(), display: displaySettings(), client: clientState() });
    activityResponded();
    selectedChoice?.classList.add("is-selected");
    command.value = "";
    // Anything the player sends (typed or clicked) jumps to the newest output.
    await render(snapshot, waiting ? "continue" : true, false, false, true);
  } catch (error) { if (!staleTab(error)) message(error.message, true); }
  finally {
    busy = false;
    pending?.classList.remove("is-pending");
    endActivity();
    updateControls();
    if (input) command.focus({ preventScroll: true });
    if (skipRequested) void continueSkipping();
    runQueuedContinue();
  }
}
/** Emuera's MouseButtons values for the left, middle and right buttons (event.button 0, 1, 2). */
const MOUSE_BUTTONS = [0x100000, 0x400000, 0x200000];
/** A pointer position in Emuera client pixels: from the client area's bottom-left, so y is negative. */
function clientPoint(event) {
  const rect = terminal.getBoundingClientRect();
  const scale = imageScale();
  if (event.detail === 0 && event.clientX === 0 && event.clientY === 0) return [0, 0];
  return [Math.round((event.clientX - rect.left - terminal.clientLeft) / scale), Math.round((event.clientY - (rect.top + terminal.clientTop + terminal.clientHeight)) / scale)];
}
/** Answers INPUTMOUSEKEY with RESULT:0-5 (and RESULTS for a string button). */
function submitMouseKey(result, results, button = null) {
  if (input?.kind !== "mousekey") return;
  void submit(JSON.stringify(results === undefined ? { result } : { result, results }), button);
}
function clickToContinue(event) {
  if (input?.kind === "mousekey" && event) {
    if ((!busy || expiring) && !settling()) submitMouseKey([1, MOUSE_BUTTONS[event.button] ?? MOUSE_BUTTONS[0], ...clientPoint(event), -1, 0]);
    return;
  }
  if (busy && !expiring) { if (session) queueContinue(); return; }
  if (input?.kind !== "wait") return;
  void submit("");
}
// A click continues unless it was a drag that selected text. Selection state alone can't decide: a double click
// leaves a word selected, and clicks inside an existing selection keep it, so later clicks would never count.
const DRAG_DISTANCE = 4;
let press = null;
terminal.addEventListener("pointerdown", (event) => {
  press = event.button === 0 ? {
    x: event.clientX,
    y: event.clientY,
    // Browsers dispatch no click at all for disabled buttons (every choice while waiting, and those on older
    // screens), so a press and release on the same disabled button counts as a click on the terminal.
    disabled: event.target instanceof Element ? event.target.closest("button:disabled") : null,
  } : null;
});
function dragged(event) {
  return !!press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_DISTANCE;
}
// macOS counts clicks at the same spot within the system double-click interval as double/triple clicks, which
// select a word or line. While a click would continue, skip that selection and drop any earlier one.
terminal.addEventListener("mousedown", (event) => {
  if (event.detail > 1 && event.button === 0 && ((busy && !expiring) || input?.kind === "wait")) {
    event.preventDefault();
    getSelection()?.removeAllRanges();
  }
});
terminal.addEventListener("click", (event) => {
  if (event.defaultPrevented) return;
  const label = event.target instanceof Element ? event.target.closest(".screen.is-active .era-map-label") : null;
  const labelled = label && labelButtons.get(label);
  if (labelled) {
    if (!dragged(event) && !labelled.disabled && !settling()) labelled.click();
    return;
  }
  if (event.target instanceof Element && event.target.closest("button, a[href]")) return;
  const selection = getSelection();
  if (selection && !selection.isCollapsed) {
    if (dragged(event)) return;
    if ((busy && !expiring) || input?.kind === "wait") selection.removeAllRanges();
  }
  clickToContinue(event);
});
terminal.addEventListener("pointermove", (event) => selectBackground(backgroundHit(event)));
terminal.addEventListener("pointerleave", () => selectBackground(-1));
terminal.addEventListener("click", (event) => {
  const value = backgroundHit(event);
  if (value < 0 || input?.kind !== "mousekey") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if ((!busy || expiring) && !settling()) submitMouseKey([1, MOUSE_BUTTONS[event.button] ?? MOUSE_BUTTONS[0], ...clientPoint(event), value, 0]);
}, true);
terminal.addEventListener("contextmenu", (event) => {
  if (event.target instanceof Element && event.target.closest("a[href]")) return;
  event.preventDefault();
  if (input?.kind === "mousekey") {
    if ((!busy || expiring) && !settling()) submitMouseKey([1, MOUSE_BUTTONS[2], ...clientPoint(event), backgroundHit(event), 0]);
  } else if (input?.kind === "wait") skipText();
});
terminal.addEventListener("auxclick", (event) => {
  if (input?.kind === "mousekey" && event.button === 1 && (!busy || expiring) && !settling()) submitMouseKey([1, MOUSE_BUTTONS[1], ...clientPoint(event), backgroundHit(event), 0]);
});
// While INPUTMOUSEKEY waits the wheel is input (one notch of 120 per event, up positive), not scrolling.
terminal.addEventListener("wheel", (event) => {
  if (input?.kind !== "mousekey" || event.ctrlKey || !event.deltaY) return;
  event.preventDefault();
  if ((!busy || expiring) && !settling()) submitMouseKey([2, event.deltaY < 0 ? 120 : -120, ...clientPoint(event)]);
}, { passive: false });
terminal.addEventListener("pointerup", (event) => {
  const pressed = press?.disabled;
  if (!pressed || event.button !== 0 || dragged(event) || !(event.target instanceof Element) || event.target.closest("button:disabled") !== pressed) return;
  clickToContinue(event);
});
// On the map screens a room's number on the map, its label beside it, its legend entry, its "Walk to" entry and
// "You are here" are separate elements for the same room; pointing at (or focusing) one highlights the others.
const roomLinkTarget = "button.choice, [data-room]";
function roomOf(element) { return element.dataset.value ?? element.dataset.room; }
function linkRooms(target) {
  const element = target instanceof Element ? target.closest(roomLinkTarget) : null;
  const scope = element?.closest(".screen.is-active .era-move");
  const value = scope && !element.closest(".era-move-tabs, .era-move-header") ? roomOf(element) : undefined;
  terminal.querySelectorAll(".is-linked").forEach((other) => other.classList.remove("is-linked"));
  if (value === undefined) return;
  const matches = [...scope.querySelectorAll(roomLinkTarget)].filter((other) => roomOf(other) === value && !other.closest(".era-move-tabs, .era-move-header"));
  if (matches.length > 1) matches.forEach((other) => other.classList.add("is-linked"));
}
terminal.addEventListener("pointerover", (event) => linkRooms(event.target));
terminal.addEventListener("pointerleave", () => linkRooms(null));
terminal.addEventListener("focusin", (event) => linkRooms(event.target));
terminal.addEventListener("focusout", (event) => linkRooms(event.relatedTarget));
// Maps print a room's name after its number ("16：Worn-out Hut") one character at a time, outside the button.
// Mark that text as the room's label so it highlights with the room and clicking it presses the number.
const labelButtons = new WeakMap();
function markMapLabels() {
  for (const button of terminal.querySelectorAll(".screen.is-active .era-map-art button.choice:not([data-labelled])")) {
    button.dataset.labelled = "";
    const run = [];
    let started = false;
    for (let node = button.nextElementSibling; node && !node.matches("button"); node = node.nextElementSibling) {
      const text = node.textContent;
      if (!started) {
        if (!/^[：:]$/.test(text)) break;
        started = true;
      } else if (/^[\u2500-\u257f|｜　]$/.test(text) || (text === " " && node.nextElementSibling?.textContent === " ")) break;
      run.push(node);
    }
    while (run.length && /^\s*$/.test(run.at(-1).textContent)) run.pop();
    if (run.length < 2) continue;
    for (const node of run) {
      node.classList.add("era-map-label");
      node.dataset.room = button.dataset.value;
      labelButtons.set(node, button);
    }
  }
}
document.querySelector("#input-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (command.value === "" && settling()) return;
  void submit(command.value);
});
function submitCharacter() {
  if ((busy && !expiring) || !input?.singleCharacter || !command.value) return;
  const first = Array.from(command.value)[0];
  if (input.kind === "integer" && !/^[0-9]$/.test(first)) return;
  void submit(first);
}
command.addEventListener("input", (event) => {
  if (!event.isComposing) submitCharacter();
});
command.addEventListener("compositionend", submitCharacter);
document.addEventListener("keydown", (event) => {
  if (document.body.classList.contains("is-home")) return;
  if (busy && !expiring && session && event.key === "Enter" && !event.repeat && !event.isComposing && !event.defaultPrevented
    && !(event.target instanceof Element && event.target.closest("input:not(#command), textarea, select, button, a[href], .menu"))) {
    event.preventDefault();
    queueContinue();
    return;
  }
  if (input?.kind === "mousekey" && !event.defaultPrevented && !event.isComposing && !event.metaKey && !event.ctrlKey
    && !["Shift", "Control", "Alt", "Meta", "Tab"].includes(event.key) && event.keyCode
    && !(event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), .menu, dialog"))
    && !((event.key === "Enter" || event.key === " ") && event.target instanceof Element && event.target.closest("button, a[href]"))) {
    // RESULT:1 is the Windows key code (keyCode); RESULT:2 adds Shift 0x10000 and Alt 0x40000.
    event.preventDefault();
    if ((!busy || expiring) && !settling()) submitMouseKey([3, event.keyCode, event.keyCode | (event.shiftKey ? 0x10000 : 0) | (event.altKey ? 0x40000 : 0)]);
    return;
  }
  if ((busy && !expiring) || !input || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target !== command && target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), .menu")) return;
  if (event.repeat && input.singleCharacter) {
    event.preventDefault();
    return;
  }
  if (target === command) return;
  if ((event.key === "Enter" || event.key === " ") && target instanceof Element && target.closest("button, a[href]")) return;
  if (event.key === "Enter") {
    event.preventDefault();
    if (command.value === "" && settling()) return;
    void submit(command.value);
  } else if (Array.from(event.key).length === 1) {
    event.preventDefault();
    command.focus({ preventScroll: true });
    command.setRangeText(event.key, command.selectionStart, command.selectionEnd, "end");
    command.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    command.focus({ preventScroll: true });
  }
});
const menuToggle = document.querySelector("#menu-toggle");
const menuPanel = document.querySelector("#menu-panel");
function setMenu(open, { restoreFocus = false } = {}) {
  menuPanel.hidden = !open;
  menuToggle.setAttribute("aria-expanded", String(open));
  if (open) menuPanel.querySelector("button")?.focus({ preventScroll: true });
  else if (restoreFocus) menuToggle.focus({ preventScroll: true });
}
menuToggle.addEventListener("click", () => setMenu(menuPanel.hidden));
// Choosing an action closes the menu; the font slider keeps it open so it can be dragged.
menuPanel.addEventListener("click", (event) => { if (event.target.closest("button")) setMenu(false); });
menuPanel.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  if (event.target.matches("input[type=range]")) return;
  const items = [...menuPanel.querySelectorAll("button, input")];
  const next = items.indexOf(event.target) + (event.key === "ArrowDown" ? 1 : -1);
  event.preventDefault();
  items[(next + items.length) % items.length].focus();
});
document.addEventListener("pointerdown", (event) => {
  if (!menuPanel.hidden && !event.target.closest(".menu")) setMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !menuPanel.hidden) {
    event.preventDefault();
    event.stopImmediatePropagation();
    setMenu(false, { restoreFocus: true });
  }
}, true);
const confirmation = document.querySelector("#confirm");
/** Asks with the confirmation dialog; resolves true only if the action button was chosen. */
function confirmAction(title, text, action) {
  confirmation.querySelector("#confirm-title").textContent = title;
  confirmation.querySelector("#confirm-text").textContent = text;
  confirmation.querySelector("#confirm-ok").textContent = action;
  confirmation.returnValue = "";
  confirmation.showModal();
  return new Promise((resolve) => {
    confirmation.addEventListener("close", () => {
      resolve(confirmation.returnValue === "ok");
      if (input) command.focus({ preventScroll: true });
    }, { once: true });
  });
}
// A click on the backdrop (outside the dialog box) cancels.
confirmation.addEventListener("click", (event) => { if (event.target === confirmation) confirmation.close(); });
// Escape cancels natively, but some embedded browsers (VS Code's) swallow it before the dialog sees it.
confirmation.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  confirmation.close();
});
function runName(mode, game) { return mode === "demo" ? "the conformance demo" : gameTitle(game); }
/** Starting a run discards one in progress, so that is confirmed first. */
async function chooseRun(mode, game = games[0]?.id) {
  if (busy) return;
  const active = !!(session && input);
  const same = mode === runMode && (mode === "demo" || game === runGame);
  if (active && same && !report.hidden) { showReport(false); return; }
  if (active && !await confirmAction(same ? `Restart ${runName(mode, game)}?` : `Switch to ${runName(mode, game)}?`,
    `Progress in the current run of ${runName(runMode, runGame)} that has not been saved in the game will be lost.`,
    same ? "Restart" : "Switch")) return;
  void start(mode, game);
}
demoButton.addEventListener("click", () => { void chooseRun("demo"); });
startButtons[1].addEventListener("click", () => { void chooseRun("game", games[0]?.id); });
restartButton.addEventListener("click", () => { void chooseRun(runMode, runGame); });
// Debug mode changes what the game loads ([IF_DEBUG]), so switching it restarts the run.
debugButton.addEventListener("click", async () => {
  if (busy) return;
  const debug = !runDebug;
  if (session && input && !await confirmAction(debug ? "Turn on debug mode?" : "Turn off debug mode?",
    `${runName(runMode, runGame)} restarts${debug ? " in Emuera's debug mode" : ""}. Progress in the current run that has not been saved in the game will be lost.`,
    "Restart")) return;
  localStorage.setItem(DEBUG_KEY, debug ? "1" : "0");
  void start(runMode, runGame, debug);
});
document.querySelector("#debug-clear").addEventListener("click", () => { debugLog.textContent = ""; });
document.querySelector("#debug-minimize").addEventListener("click", (event) => {
  debugLog.hidden = !debugLog.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!debugLog.hidden));
  event.currentTarget.textContent = debugLog.hidden ? "Expand" : "Minimize";
});
document.querySelector("#font-size").addEventListener("input", (event) => {
  updateSetting("fontSize", Number(event.target.value));
});
const translateToggle = document.querySelector("#translate-toggle");
const translateState = document.querySelector("#translate-state");
function showTranslation({ state, detail, enabled, supported }) {
  translateToggle.setAttribute("aria-pressed", String(enabled));
  translateToggle.disabled = !supported;
  const labels = { starting: "starting", waiting: "click to download", downloading: `downloading ${detail}`, unavailable: "unavailable" };
  translateState.textContent = !supported ? "(needs Chrome or Edge)" : enabled && labels[state] ? `(${labels[state].trim()})` : "";
  translateToggle.title = detail && state !== "downloading" ? `Translate Japanese: ${detail}` : "Translate the game's Japanese text on this device as it is printed";
}
showTranslation(translation.status());
translateToggle.addEventListener("click", () => {
  translation.setEnabled(!translation.enabled());
  translation.translateTree(terminal);
});
const settingsPanel = document.querySelector("#settings");
document.querySelector("#settings-toggle").addEventListener("click", (event) => {
  settingsPanel.hidden = !settingsPanel.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!settingsPanel.hidden));
  if (!settingsPanel.hidden) settingsPanel.scrollIntoView({ block: "nearest" });
});
document.querySelector("#settings-form").addEventListener("input", (event) => {
  const { name, value } = event.target;
  if (name === "font" && /["\\;{}<>]/.test(value)) return;
  if (name) updateSetting(name, name === "font" ? value.trim() || undefined : value.toLowerCase());
});
document.querySelector("#settings-reset").addEventListener("click", () => {
  const fontSize = savedSettings().fontSize;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(fontSize ? { fontSize } : {}));
  settings = { ...gameDefaults, fontSize };
  applySettings();
});
document.querySelector("#report").addEventListener("click", async () => {
  if (!report.hidden) {
    showReport(false);
    return;
  }
  try {
    const data = await api(`/api/compatibility${runGame ? `?game=${encodeURIComponent(runGame)}` : ""}`);
    report.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = `${gameTitle(runGame)}: compatibility inventory`;
    const summary = document.createElement("p");
    summary.textContent = `${data.scriptFiles} scripts / ${data.functions} functions / ${data.csvTables} CSV tables / ${data.sprites} sprites`;
    const note = document.createElement("p");
    note.textContent = data.note;
    const table = document.createElement("table");
    const header = document.createElement("tr");
    for (const value of ["Unsupported feature", "Occurrences", "Example source locations"]) {
      const cell = document.createElement("th"); cell.textContent = value; header.append(cell);
    }
    table.append(header);
    for (const gap of data.gaps) {
      const row = document.createElement("tr");
      for (const value of [gap.feature, String(gap.count), gap.examples.map((example) => `${example.file}:${example.line}`).join("\n")]) {
        const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
      }
      table.append(row);
    }
    const diagnostics = document.createElement("pre");
    diagnostics.textContent = `Loader diagnostics: ${data.diagnosticCount}\n` + data.diagnostics.map((d) => `${d.file}:${d.line}: ${d.message}`).join("\n");
    report.append(heading, summary, note, table, diagnostics);
    showReport(true);
    report.scrollIntoView({ block: "start" });
  } catch (error) { message(error.message, true); }
});
const library = createLibrary({
  api, launch: (id) => { void chooseRun("game", id); }, confirmAction,
  gamesChanged: async () => {
    const runtime = await api("/api/runtime");
    games = runtime.games ?? [];
    showGames();
  },
});
document.querySelector("#library-toggle").addEventListener("click", async () => {
  if (busy) return;
  if (session && input && !await confirmAction("Return to your library?",
    "Progress that has not been saved in the game will be lost.", "Return to library")) return;
  try {
    if (session) await api("/api/stop", { session });
    resetAudio();
    clearTimedWait();
    generation++;
    input = null;
    session = null;
    sessionStorage.removeItem(RUN_KEY);
    const url = new URL(location.href);
    url.searchParams.delete("game");
    url.searchParams.delete("demo");
    window.history.replaceState(window.history.state, "", url);
    updateControls();
    await library.show();
    document.querySelector("#installed-tab").focus();
  } catch (error) { message(error.message, true); }
});
// Fresh visits open the library; explicit game links and reloads retain the existing run behavior.
void (async () => {
  await settingsLoaded;
  const requested = urlRun();
  let saved = savedRun();
  // An address naming a different game than this tab's run (edited or pasted) starts that game instead.
  if (saved && requested && (requested.mode !== saved.mode || (requested.mode === "game" && requested.game !== (saved.game ?? games[0]?.id)))) saved = null;
  if (saved && await resume(saved.session)) return;
  if (!requested && !saved) { await library.show(); return; }
  if (requested?.mode !== "demo" && !games.length) { await library.show(); return; }
  await start(requested?.mode ?? saved?.mode ?? "game", requested?.game ?? saved?.game);
  if (saved && session) message(`The previous run had ended or expired (or the server restarted), so a new run started. ${status.textContent}`);
})();
