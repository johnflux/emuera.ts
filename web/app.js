const terminal = document.querySelector("#terminal");
const status = document.querySelector("#status");
const command = document.querySelector("#command");
const send = document.querySelector("#submit");
const report = document.querySelector("#compatibility");
const tooltip = document.querySelector("#game-tooltip");
let tooltipTarget = null;
const startButtons = [document.querySelector("#demo"), document.querySelector("#game")];
let runMode = "game";
let session = null;
let input = null;
let busy = false;
let currentLine = null;
let currentScreen = null;
let outputRoot = terminal;
let pendingImages = [];
let generation = 0;
const sprites = new Map();
new ResizeObserver(() => {
  if (input && !busy) lastOutputLine()?.scrollIntoView({ block: "nearest" });
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
    if (!session && !busy) message("Development reload complete. Starting a fresh bundled-game run.");
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
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}
function updateControls() {
  terminal.classList.toggle("is-waiting", !busy && input?.kind === "wait");
  command.disabled = busy || !input;
  send.disabled = !input;
  send.setAttribute("aria-disabled", String(busy || !input));
  send.textContent = input?.kind === "wait" ? "Continue" : "Send";
  command.title = !input ? "Not waiting for input" : input.singleCharacter
    ? input.kind === "integer" ? "Type one digit (no Enter needed)" : "Type one character (no Enter needed)"
    : input.kind === "integer" ? "Enter a whole number" : input.kind === "wait" ? "Press Enter to continue" : "Enter text";
  startButtons.forEach((button) => { button.setAttribute("aria-disabled", String(busy)); });
  document.querySelector("#input-form").hidden = !input;
  terminal.querySelectorAll("button.choice").forEach((button) => {
    button.disabled = !button.closest(".screen.is-active") || busy || !input || input.kind === "wait";
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
  return terminal.lastElementChild?.lastElementChild;
}
function retireScreen() {
  if (!currentScreen) return;
  hideTooltip();
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
  currentScreen.querySelectorAll("a").forEach((link) => {
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    link.tabIndex = -1;
  });
  currentScreen.querySelectorAll("[data-tooltip]").forEach((element) => { element.tabIndex = -1; });
}
function hideTooltip() {
  tooltipTarget?.removeAttribute("aria-describedby");
  tooltipTarget = null;
  tooltip.hidden = true;
  tooltip.textContent = "";
}
function describe(element, description) {
  element.classList.add("has-tooltip");
  element.dataset.tooltip = description;
  if (!element.matches("button, a[href]")) element.tabIndex = 0;
  function show() {
    if (busy || !element.closest(".screen.is-active")) return;
    hideTooltip();
    tooltipTarget = element;
    tooltip.textContent = description;
    tooltip.hidden = false;
    element.setAttribute("aria-describedby", tooltip.id);
    const anchor = element.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const margin = 12;
    tooltip.style.left = `${Math.max(margin, Math.min(anchor.left, innerWidth - box.width - margin))}px`;
    const below = anchor.bottom + 8;
    tooltip.style.top = `${Math.max(margin, Math.min(
      below + box.height <= innerHeight - margin ? below : anchor.top - box.height - 8,
      innerHeight - box.height - margin,
    ))}px`;
  }
  element.addEventListener("mouseenter", show);
  element.addEventListener("focus", show);
  element.addEventListener("mouseleave", () => {
    if (tooltipTarget === element && document.activeElement !== element) hideTooltip();
  });
  element.addEventListener("blur", () => { if (tooltipTarget === element) hideTooltip(); });
}
document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideTooltip(); });
document.addEventListener("scroll", hideTooltip, true);
window.addEventListener("resize", hideTooltip);
function line() {
  if (!currentLine) {
    currentLine = document.createElement("div");
    currentLine.className = "line";
    screen().append(currentLine);
  }
  return currentLine;
}
function applyStyle(element, style) {
  element.classList.add("output-text");
  element.classList.toggle("font-bold", !!(style.fontStyle & 1));
  element.classList.toggle("font-italic", !!(style.fontStyle & 2));
  element.classList.toggle("font-underline", !!(style.fontStyle & 4));
  if (style.color.toLowerCase() !== "#ffffff") element.style.setProperty("--output-color", style.color);
  else element.style.removeProperty("--output-color");
  if (style.background.toLowerCase() !== "#000000") element.style.setProperty("--output-background", style.background);
  else element.style.removeProperty("--output-background");
}
function applyAlignment(element, alignment) {
  for (const value of ["left", "center", "right"]) element.classList.toggle(`align-${value}`, alignment === value);
}
function applyLineStyle(element, style) {
  applyAlignment(element, style.alignment);
  if (style.background.toLowerCase() !== "#000000") element.style.setProperty("--line-background", style.background);
  else element.style.removeProperty("--line-background");
}
function choice(label, value, title = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "choice";
  button.textContent = label;
  if (title) describe(button, title);
  decorateLabel(button);
  button.addEventListener("click", () => {
    if (button.closest(".screen.is-active")) void submit(value, button);
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
    parent.append(document.createTextNode(value.slice(start, match.index)));
    const end = matches[i + 1]?.index ?? value.length;
    const label = value.slice(match.index, end).trimEnd();
    parent.append(choice(label, match[1]));
    start = match.index + label.length;
  }
  parent.append(document.createTextNode(value.slice(start)));
}
function sizeAttribute(value, fallback) {
  if (value === null) return fallback;
  // Emuera unitless image dimensions are percentages of font size, not pixels.
  if (/^\d+(?:\.\d+)?px$/.test(value)) return Math.min(4096, Number.parseFloat(value));
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.min(4096, Number(value) / 100 * Number.parseFloat(getComputedStyle(terminal).fontSize));
  throw new Error(`Unsupported image dimension: ${value}`);
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
async function image(source, token, suppliedSprite) {
  const holder = document.createElement("span");
  holder.className = "sprite";
  const name = source.getAttribute("src");
  if (!name) throw new Error("Image has no src");
  const draw = async () => {
    try {
      let promise = suppliedSprite ? Promise.resolve(suppliedSprite) : sprites.get(name);
      if (!promise) {
        promise = api(`/api/sprite?name=${encodeURIComponent(name)}`);
        sprites.set(name, promise);
      }
      const sprite = await promise;
      if (token !== generation) return;
      const img = document.createElement("img");
      img.alt = name;
      await loadImage(img, sprite.url);
      if (token !== generation) return;
      const width = sprite.width || img.naturalWidth;
      const height = sprite.height || img.naturalHeight;
      const targetHeight = sizeAttribute(source.getAttribute("height"), Number.parseFloat(getComputedStyle(terminal).fontSize));
      const targetWidth = sizeAttribute(source.getAttribute("width"), width / height * targetHeight);
      holder.style.width = `${targetWidth}px`;
      holder.style.height = `${targetHeight}px`;
      img.style.width = `${img.naturalWidth * targetWidth / width}px`;
      img.style.height = `${img.naturalHeight * targetHeight / height}px`;
      img.style.left = `${-sprite.x * targetWidth / width}px`;
      img.style.top = `${-sprite.y * targetHeight / height}px`;
      holder.append(img);
    } catch (error) {
      if (token !== generation) return;
      holder.className = "missing";
      holder.textContent = `[Image ${name}: ${error.message}]`;
      holder.closest(".line")?.classList.remove("image-line");
    }
  };
  pendingImages.push(draw());
  return holder;
}
const allowedTags = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "S", "SPAN", "NOBR", "FONT", "NONBUTTON"]);
async function renderHtml(markup, parent) {
  // Parse inertly, then rebuild an allowlisted DOM. Never attach game HTML directly.
  const documentNode = new DOMParser().parseFromString(markup, "text/html");
  if (documentNode.head.children.length)
    throw new Error(`Unsupported HTML tag: <${documentNode.head.firstElementChild.tagName.toLowerCase()}>`);
  const token = generation;
  async function copy(node, destination) {
    if (node.nodeType === Node.TEXT_NODE) { destination.append(document.createTextNode(node.textContent)); return; }
    if (!(node instanceof Element)) return;
    let element;
    if (node.tagName === "IMG") element = await image(node, token);
    else if (node.tagName === "SHAPE") {
      if (node.getAttribute("type") !== "space") throw new Error(`Unsupported HTML shape: ${node.getAttribute("type")}`);
      element = document.createElement("span");
      element.style.display = "inline-block";
      element.style.width = `${sizeAttribute(node.getAttribute("param"), 0)}px`;
    }
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
      const color = node.getAttribute("color");
      if (color && /^(?:#[0-9a-f]{6}|[a-z]+)$/i.test(color)) element.style.color = color;
    } else throw new Error(`Unsupported HTML tag: <${node.tagName.toLowerCase()}>`);
    const title = node.getAttribute("title");
    if (title && !element.dataset.tooltip) describe(element, title);
    destination.append(element);
    if (node.tagName !== "IMG") for (const child of node.childNodes) await copy(child, node.tagName === "SHAPE" ? destination : element);
  }
  for (const child of documentNode.body.childNodes) await copy(child, parent);
  parent.querySelectorAll("button.choice, .has-tooltip").forEach(decorateLabel);
}
async function render(snapshot, advanceScreen = false, fresh = false) {
  const scrollTop = terminal.scrollTop;
  const followBottom = terminal.scrollHeight - terminal.clientHeight - scrollTop < 2;
  const staged = document.createElement("div");
  // Keep a visual copy on screen while the original nodes (and their listeners)
  // are updated off-screen. Commit only after HTML and new images are ready.
  if (!fresh) {
    const visible = terminal.cloneNode(true);
    staged.append(...terminal.childNodes);
    terminal.replaceChildren(...visible.childNodes);
  }
  outputRoot = staged;
  pendingImages = [];
  terminal.setAttribute("aria-busy", "true");
  try {
    await renderSnapshot(snapshot, advanceScreen);
    await Promise.all(pendingImages);
  } finally {
    terminal.replaceChildren(...staged.childNodes);
    outputRoot = terminal;
    pendingImages = [];
    terminal.removeAttribute("aria-busy");
    updateControls();
    if (fresh || followBottom) lastOutputLine()?.scrollIntoView({ block: "nearest" });
    else terminal.scrollTop = scrollTop;
  }
  if (input) command.focus({ preventScroll: true });
}
async function renderSnapshot(snapshot, advanceScreen) {
  hideTooltip();
  document.title = snapshot.title || "TypeScript Emuera";
  const previousScreen = currentScreen;
  const previousLine = currentLine;
  if (advanceScreen) {
    retireScreen();
    currentScreen = null;
    currentLine = null;
  }
  for (const output of snapshot.output) {
    // Input echoes complete the submitted screen, including unfinished prompts.
    if (advanceScreen && output.type === "input" && previousScreen?.parentElement === outputRoot) {
      currentScreen = previousScreen;
      currentLine = previousLine;
    }
    if (output.type === "clear") {
      let remaining = output.count;
      while (remaining > 0 && outputRoot.lastElementChild) {
        const group = outputRoot.lastElementChild;
        const last = group.lastElementChild;
        if (!last) {
          group.remove();
          continue;
        }
        const lines = Number(last.dataset.logicalLines ?? 1);
        if (lines > remaining) {
          const retained = lines - remaining;
          last.dataset.logicalLines = String(retained);
          last.style.height = `${retained * Number(last.dataset.lineHeight)}px`;
          break;
        }
        last.remove();
        remaining -= lines;
        if (!group.children.length) group.remove();
      }
      currentLine = null;
      continue;
    }
    if (output.type === "title-image") {
      currentLine = null;
      const target = line();
      applyStyle(target, output.style);
      applyAlignment(target, "center");
      target.classList.add("image-line", "title-image");
      const lineHeight = Number.parseFloat(getComputedStyle(terminal).fontSize);
      target.dataset.logicalLines = String(output.lines);
      target.dataset.lineHeight = String(lineHeight);
      target.style.height = `${output.lines * lineHeight}px`;
      const source = document.createElement("span");
      source.setAttribute("src", "TW title");
      source.setAttribute("height", `${output.lines * lineHeight}px`);
      target.append(await image(source, generation, output.sprite));
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
        const fragment = document.createElement("span");
        applyStyle(fragment, output.style);
        if (output.plain) fragment.textContent = parts[i];
        else appendText(fragment, parts[i]);
        textLine.append(fragment);
      }
      if (output.newline) currentLine = null;
      continue;
    }
    const span = document.createElement("span");
    applyStyle(span, output.style);
    target.append(span);
    if (output.type === "html") {
      try {
        await renderHtml(output.text, span);
        if (!span.textContent.trim() && span.querySelector(".sprite")) target.classList.add("image-line");
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
  session = snapshot.session;
  input = snapshot.input;
  if (snapshot.error) {
    const { file, line: sourceLine, message: reason } = snapshot.error;
    message(`Stopped at ${file}:${sourceLine}: ${reason}`, true);
    currentLine = null;
    line().textContent = `ERROR ${file}:${sourceLine} - ${reason}`;
    currentLine.classList.add("missing");
    currentLine = null;
  } else message(snapshot.status === "waiting" ? `Waiting for ${input.kind} input.` : "Execution finished.");
  // Keep DOM memory bounded during repeated demo / script runs.
  const lines = [...outputRoot.querySelectorAll(".screen > .line")];
  if (lines.length > 5000) {
    for (const oldLine of lines.slice(0, lines.length - 4000)) {
      const group = oldLine.parentElement;
      oldLine.remove();
      if (!group.children.length) group.remove();
    }
    message("Older output was trimmed (4,000 displayed lines retained).");
  }
}
function showReport(visible) {
  report.hidden = !visible;
  document.querySelector("#report").setAttribute("aria-expanded", String(visible));
  startButtons[0].setAttribute("aria-pressed", String(!visible && runMode === "demo"));
  startButtons[1].setAttribute("aria-pressed", String(!visible && runMode === "game"));
}
function terminalColumns() {
  const probe = document.createElement("span");
  probe.textContent = "0".repeat(100);
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
  terminal.append(probe);
  const cellWidth = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return Math.max(20, Math.min(1000, Math.floor(terminal.clientWidth / cellWidth)));
}
async function start(mode) {
  if (busy) return;
  runMode = mode;
  showReport(false);
  hideTooltip();
  busy = true;
  input = null;
  generation++;
  updateControls();
  message(`Starting ${mode === "demo" ? "conformance demo" : "bundled game"}...`);
  currentScreen = null;
  command.value = "";
  currentLine = null;
  try {
    await document.fonts.load(`${getComputedStyle(terminal).fontSize} "BIZ UD Gothic"`);
    if (!document.fonts.check(`${getComputedStyle(terminal).fontSize} "BIZ UD Gothic"`))
      throw new Error("The bundled terminal font could not be loaded.");
    const columns = terminalColumns();
    await render(await api("/api/start", { mode, previousSession: session, columns }), false, true);
  }
  catch (error) { message(error.message, true); }
  finally { busy = false; updateControls(); if (input) command.focus({ preventScroll: true }); }
}
async function submit(value, selectedChoice = null) {
  if (busy || !input) return;
  hideTooltip();
  busy = true;
  updateControls();
  try {
    const snapshot = await api("/api/input", { session, value, columns: terminalColumns() });
    selectedChoice?.classList.add("is-selected");
    command.value = "";
    await render(snapshot, true);
  } catch (error) { message(error.message, true); }
  finally { busy = false; updateControls(); if (input) command.focus({ preventScroll: true }); }
}
terminal.addEventListener("click", (event) => {
  if (event.defaultPrevented || busy || input?.kind !== "wait") return;
  if (event.target instanceof Element && event.target.closest("button, a[href]")) return;
  const selection = getSelection();
  if (selection && !selection.isCollapsed) return;
  void submit("");
});
document.querySelector("#input-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void submit(command.value);
});
function submitCharacter() {
  if (busy || !input?.singleCharacter || !command.value) return;
  const first = Array.from(command.value)[0];
  if (input.kind === "integer" && !/^[0-9]$/.test(first)) return;
  void submit(first);
}
command.addEventListener("input", (event) => {
  if (!event.isComposing) submitCharacter();
});
command.addEventListener("compositionend", submitCharacter);
document.addEventListener("keydown", (event) => {
  if (busy || !input || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target !== command && target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
  if (event.repeat && input.singleCharacter) {
    event.preventDefault();
    return;
  }
  if (target === command) return;
  if ((event.key === "Enter" || event.key === " ") && target instanceof Element && target.closest("button, a[href]")) return;
  if (event.key === "Enter") {
    event.preventDefault();
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
startButtons[0].addEventListener("click", () => { void start("demo"); });
startButtons[1].addEventListener("click", () => { void start("game"); });
document.querySelector("#font-size").addEventListener("input", (event) => {
  document.documentElement.style.setProperty("--font-size", `${event.target.value}px`);
});
document.querySelector("#report").addEventListener("click", async () => {
  if (!report.hidden) {
    showReport(false);
    return;
  }
  try {
    const data = await api("/api/compatibility");
    report.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Bundled game: compatibility inventory";
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
void start("game");
