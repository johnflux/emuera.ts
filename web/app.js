const terminal = document.querySelector("#terminal");
const status = document.querySelector("#status");
const command = document.querySelector("#command");
const send = document.querySelector("#submit");
const report = document.querySelector("#compatibility");
const startButtons = [document.querySelector("#demo"), document.querySelector("#game")];
let session = null;
let input = null;
let busy = false;
let currentLine = null;
let generation = 0;
const sprites = new Map();

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
    message("Development reload complete. Active sessions were reset; start a new run.");
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
  command.disabled = busy || !input;
  send.disabled = busy || !input;
  send.textContent = input?.kind === "wait" ? "Continue" : "Send";
  command.placeholder = !input ? "Not waiting for input" : input.kind === "integer" ? "Enter a whole number" : input.kind === "wait" ? "Press Enter to continue" : "Enter text";
  startButtons.forEach((button) => { button.disabled = busy; });
  terminal.querySelectorAll("button.choice").forEach((button) => { button.disabled = busy || !input || input.kind === "wait"; });
}
function line() {
  if (!currentLine) {
    currentLine = document.createElement("div");
    currentLine.className = "line";
    terminal.append(currentLine);
  }
  return currentLine;
}
function applyStyle(element, style) {
  element.style.color = style.color;
  element.style.backgroundColor = style.background;
  element.style.textAlign = style.alignment;
  element.style.fontWeight = style.fontStyle & 1 ? "bold" : "normal";
  element.style.fontStyle = style.fontStyle & 2 ? "italic" : "normal";
  element.style.textDecoration = style.fontStyle & 4 ? "underline" : "none";
}
function choice(label, value, title = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "choice";
  button.textContent = label;
  button.title = title;
  button.addEventListener("click", () => { void submit(value); });
  return button;
}
function appendText(parent, value) {
  // Conventional numeric menu markers are input choices, not executable markup.
  const pattern = /\[(-?\d+)\]/g;
  let start = 0;
  for (const match of value.matchAll(pattern)) {
    parent.append(document.createTextNode(value.slice(start, match.index)));
    parent.append(choice(match[0], match[1]));
    start = match.index + match[0].length;
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
      img.src = sprite.url;
      await img.decode();
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
  void draw();
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
    else if (node.tagName === "BUTTON") {
      const value = node.getAttribute("value");
      if (value !== null) element = choice(node.textContent, value, node.getAttribute("title") ?? "");
      else { element = document.createElement("span"); element.textContent = node.textContent; }
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
      const title = node.getAttribute("title");
      if (title) element.title = title;
    } else throw new Error(`Unsupported HTML tag: <${node.tagName.toLowerCase()}>`);
    destination.append(element);
    if (!["IMG", "BUTTON"].includes(node.tagName)) for (const child of node.childNodes) await copy(child, element);
  }
  for (const child of documentNode.body.childNodes) await copy(child, parent);
}
async function render(snapshot) {
  document.title = snapshot.title || "TypeScript Emuera";
  for (const output of snapshot.output) {
    if (output.type === "clear") {
      let remaining = output.count;
      while (remaining > 0 && terminal.lastElementChild) {
        const last = terminal.lastElementChild;
        const lines = Number(last.dataset.logicalLines ?? 1);
        if (lines > remaining) {
          const retained = lines - remaining;
          last.dataset.logicalLines = String(retained);
          last.style.height = `${retained * Number(last.dataset.lineHeight)}px`;
          break;
        }
        last.remove();
        remaining -= lines;
      }
      currentLine = null;
      continue;
    }
    if (output.type === "title-image") {
      currentLine = null;
      const target = line();
      applyStyle(target, output.style);
      target.classList.add("image-line");
      target.style.textAlign = "center";
      target.style.overflow = "hidden";
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
    applyStyle(target, output.style);
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
    else {
      const parts = output.text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i) {
          currentLine = null;
          applyStyle(line(), output.style);
        }
        const fragment = document.createElement("span");
        applyStyle(fragment, output.style);
        appendText(fragment, parts[i]);
        (i ? line() : span).append(fragment);
      }
    }
    if (output.newline) currentLine = null;
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
  if (terminal.children.length > 5000) {
    while (terminal.children.length > 4000) terminal.firstElementChild.remove();
    message("Older output was trimmed (4,000 displayed lines retained).");
  }
  updateControls();
  terminal.lastElementChild?.scrollIntoView({ block: "nearest" });
  if (input) command.focus({ preventScroll: true });
}
async function start(mode) {
  if (busy) return;
  busy = true;
  input = null;
  generation++;
  updateControls();
  message(`Starting ${mode === "demo" ? "conformance demo" : "bundled game"}...`);
  terminal.replaceChildren();
  currentLine = null;
  try {
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(100);
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    terminal.append(probe);
    const cellWidth = probe.getBoundingClientRect().width / 100;
    probe.remove();
    const columns = Math.max(20, Math.min(1000, Math.floor(terminal.clientWidth / cellWidth)));
    await render(await api("/api/start", { mode, previousSession: session, columns }));
  }
  catch (error) { message(error.message, true); }
  finally { busy = false; updateControls(); }
}
async function submit(value) {
  if (busy || !input) return;
  busy = true;
  updateControls();
  try {
    const snapshot = await api("/api/input", { session, value });
    command.value = "";
    await render(snapshot);
  } catch (error) { message(error.message, true); }
  finally { busy = false; updateControls(); if (input) command.focus({ preventScroll: true }); }
}
document.querySelector("#input-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void submit(command.value);
});
startButtons[0].addEventListener("click", () => { void start("demo"); });
startButtons[1].addEventListener("click", () => { void start("game"); });
document.querySelector("#font-size").addEventListener("input", (event) => {
  document.documentElement.style.setProperty("--font-size", `${event.target.value}px`);
});
document.querySelector("#report").addEventListener("click", async () => {
  if (!report.hidden) { report.hidden = true; return; }
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
    report.hidden = false;
    report.scrollIntoView({ block: "start" });
  } catch (error) { message(error.message, true); }
});
