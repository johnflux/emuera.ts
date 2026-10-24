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
let timedWait = null;
let expiring = false;
let queuedSubmit = null;
let currentLine = null;
let currentScreen = null;
let outputRoot = terminal;
let pendingImages = [];
let generation = 0;
const sprites = new Map();
const SETTINGS_KEY = "era-typescript.settings";
/** Emuera's configured font size and line height (emuera.config), the units game image layouts are written in. */
let metrics = { fontSize: 18, lineHeight: 19 };
let gameDefaults = { foreground: "#c0c0c0", background: "#000000", selection: "#ffff00", font: "ＭＳ ゴシック" };
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
    gameDefaults = { ...gameDefaults, ...runtime.display };
    if (runtime.metrics) metrics = runtime.metrics;
    settings = { ...gameDefaults, ...savedSettings() };
    applySettings();
  } catch { /* the development watcher reports connection errors */ }
})();
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
  document.querySelector("#input-form").hidden = !input;
  terminal.querySelectorAll("button.choice").forEach((button) => {
    button.disabled = !button.closest(".screen.is-active") || button.classList.contains("is-stale") || (busy && !expiring) || !input || input.kind === "wait" || !!input.blocking;
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
  currentScreen = group;
  currentLine = null;
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
function choice(label, value, title = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "choice";
  button.dataset.value = value;
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
/** CSS pixels per Emuera pixel: the game lays images out against its configured line height, so map that onto ours. */
function imageScale() {
  const style = getComputedStyle(terminal);
  const lineHeight = Number.parseFloat(style.lineHeight);
  return (Number.isFinite(lineHeight) ? lineHeight : Number.parseFloat(style.fontSize) * 1.25) / metrics.lineHeight;
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
    if (op.op === "fill") {
      const [x, y, width, height] = op.rect;
      if (op.replace) context.clearRect(x, y, width, height);
      context.fillStyle = op.color;
      context.fillRect(x, y, width, height);
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
async function image(source, token, suppliedSprite, scale = imageScale()) {
  const holder = document.createElement("span");
  holder.className = "sprite";
  const clip = document.createElement("span");
  clip.className = "sprite-clip";
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
      // img is the whole source (sheet or painted canvas); sprite.x/y/width/height crop it.
      let img, naturalWidth, naturalHeight, layers = [];
      if (sprite.frames?.length) {
        // An animation: every frame is a picture of the sprite's size, stacked and shown in turn.
        layers = await Promise.all(sprite.frames.map((frame) => pictureCopy(frame.picture)));
        if (token !== generation) return;
        [img] = layers;
        [naturalWidth, naturalHeight] = [img.width, img.height];
      } else if (sprite.picture) {
        // A runtime-made sprite (SPRITECREATE), or an animation that has no frames yet.
        img = await pictureCopy(sprite.picture);
        if (token !== generation) return;
        [naturalWidth, naturalHeight] = [img.width, img.height];
      } else {
        img = document.createElement("img");
        img.alt = name;
        await loadImage(img, sprite.url);
        [naturalWidth, naturalHeight] = [img.naturalWidth, img.naturalHeight];
      }
      if (token !== generation) return;
      const width = sprite.width || naturalWidth;
      const height = sprite.height || naturalHeight;
      const signedHeight = sizeAttribute(source.getAttribute("height") || null, metrics.fontSize * scale, scale) || metrics.fontSize * scale;
      const signedWidth = sizeAttribute(source.getAttribute("width") || null, 0, scale) || width / height * Math.abs(signedHeight);
      // Negative sizes flip the picture in place.
      const targetHeight = Math.abs(signedHeight), targetWidth = Math.abs(signedWidth);
      holder.style.width = `${targetWidth}px`;
      Object.assign(clip.style, { top: `${sizeAttribute(source.getAttribute("ypos"), 0, scale)}px`, width: `${targetWidth}px`, height: `${targetHeight}px` });
      if (signedWidth < 0 || signedHeight < 0) clip.style.transform = `scale(${Math.sign(signedWidth)}, ${Math.sign(signedHeight)})`;
      holder.append(clip);
      for (const layer of layers.length ? layers : [img]) {
        layer.style.width = `${naturalWidth * targetWidth / width}px`;
        layer.style.height = `${naturalHeight * targetHeight / height}px`;
        layer.style.left = `${-sprite.x * targetWidth / width}px`;
        layer.style.top = `${-sprite.y * targetHeight / height}px`;
        clip.append(layer);
      }
      animate(name, holder, layers, sprite.frames?.map((frame) => frame.delay) ?? [], token);
    } catch (error) {
      if (token !== generation) return;
      holder.className = "missing";
      holder.textContent = `[Image ${name}: ${error.message}]`;
    }
  };
  pendingImages.push(draw());
  return holder;
}
const allowedTags = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "S", "SPAN", "NOBR", "FONT", "NONBUTTON"]);
async function renderHtml(markup, parent, sprites) {
  // Parse inertly, then rebuild an allowlisted DOM. Never attach game HTML directly.
  const documentNode = new DOMParser().parseFromString(markup, "text/html");
  if (documentNode.head.children.length)
    throw new Error(`Unsupported HTML tag: <${documentNode.head.firstElementChild.tagName.toLowerCase()}>`);
  const token = generation;
  async function copy(node, destination) {
    if (node.nodeType === Node.TEXT_NODE) { destination.append(document.createTextNode(node.textContent)); return; }
    if (!(node instanceof Element)) return;
    let element;
    if (node.tagName === "IMG") element = await image(node, token, sprites?.[node.getAttribute("src")]);
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
      const color = node.getAttribute("color");
      if (color && /^(?:#[0-9a-f]{6}|[a-z]+)$/i.test(color)) {
        element.style.color = color;
        markTextColor(element, color);
      }
    } else throw new Error(`Unsupported HTML tag: <${node.tagName.toLowerCase()}>`);
    const title = node.getAttribute("title");
    if (title && !element.dataset.tooltip) describe(element, title);
    destination.append(element);
    if (node.tagName !== "IMG") for (const child of node.childNodes) await copy(child, node.tagName === "SHAPE" ? destination : element);
  }
  for (const child of documentNode.body.childNodes) await copy(child, parent);
  parent.querySelectorAll("button.choice, .has-tooltip").forEach(decorateLabel);
}
async function render(snapshot, advanceScreen = false, fresh = false, keepFocus = false) {
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
    scheduleTimedWait();
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
    const snapshot = await api("/api/timeout", { session, columns: terminalColumns(), display: displaySettings() });
    if (current === generation) await render(snapshot, false, false, true);
  } catch (error) { message(error.message, true); }
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
async function renderSnapshot(snapshot, advanceScreen) {
  hideTooltip();
  document.title = snapshot.title || "Emuera.ts";
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
      let reachedHistory = false;
      while (remaining > 0 && outputRoot.lastElementChild) {
        const group = outputRoot.lastElementChild;
        const last = group.lastElementChild;
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
        last.remove();
        remaining -= lines;
        if (!group.children.length) group.remove();
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
        if (output.single) textLine.classList.add("single-line");
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
  const revived = outputRoot.querySelectorAll(".screen.is-active button.choice.is-revived");
  if (revived.length && outputRoot.querySelector(".screen.is-active button.choice:not(.is-revived)"))
    revived.forEach((button) => { button.classList.replace("is-revived", "is-stale"); });
  session = snapshot.session;
  input = snapshot.input;
  if (snapshot.error) {
    const { file, line: sourceLine, message: reason, trace = [] } = snapshot.error;
    message(`Stopped at ${file}:${sourceLine}: ${reason}`, true);
    currentLine = null;
    line().textContent = `ERROR ${file}:${sourceLine} - ${reason}${trace.map((caller) => `\n  called from ${caller}`).join("")}`;
    currentLine.classList.add("missing");
    currentLine = null;
  } else message(snapshot.status !== "waiting" ? "Execution finished."
    : input.kind === "wait" ? "Click or press Enter to continue." : `Waiting for ${input.kind} input.`);
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
  const mode = document.querySelector("#mode");
  mode.hidden = !runMode;
  mode.textContent = runMode === "demo" ? "Demo" : "Game";
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
/**
 * A click (or Enter) made while a step is running continues the next wait, so clicking ahead isn't lost.
 * Only one is kept, and it is dropped if the step ends anywhere other than a click-to-continue wait.
 */
let continueQueued = false;
function queueContinue() {
  continueQueued = true;
  message("Will continue when ready...");
}
function runQueuedContinue() {
  const queued = continueQueued;
  continueQueued = false;
  if (queued && !busy && input?.kind === "wait" && !input.blocking) void submit("");
}
async function start(mode) {
  if (busy) return;
  continueQueued = false;
  runMode = mode;
  showReport(false);
  hideTooltip();
  busy = true;
  input = null;
  clearTimedWait();
  generation++;
  updateControls();
  message(`Starting ${mode === "demo" ? "conformance demo" : "bundled game"}...`);
  beginActivity();
  currentScreen = null;
  command.value = "";
  currentLine = null;
  try {
    await settingsLoaded;
    await document.fonts.load(`${getComputedStyle(terminal).fontSize} "BIZ UD Gothic"`);
    if (!document.fonts.check(`${getComputedStyle(terminal).fontSize} "BIZ UD Gothic"`))
      throw new Error("The bundled terminal font could not be loaded.");
    const columns = terminalColumns();
    const snapshot = await api("/api/start", { mode, previousSession: session, columns, display: displaySettings() });
    activityResponded();
    await render(snapshot, false, true);
  }
  catch (error) { message(error.message, true); }
  finally { busy = false; endActivity(); updateControls(); if (input) command.focus({ preventScroll: true }); runQueuedContinue(); }
}
async function submit(value, selectedChoice = null) {
  // Input made while an animation frame is loading is sent once that frame is shown.
  if (expiring) { queuedSubmit = { value, choice: selectedChoice?.dataset.value }; return; }
  if (busy || !input || input.blocking) return;
  hideTooltip();
  busy = true;
  // Typed input that matches a visible choice highlights that choice too.
  const pending = selectedChoice ?? (value === "" ? null : [...terminal.querySelectorAll(".screen.is-active button.choice")]
    .find((button) => button.dataset.value === value) ?? null);
  pending?.classList.add("is-pending");
  message(input.kind === "wait" ? "Continuing..." : `Sending ${JSON.stringify(pending?.textContent.replace(/\s+/g, " ").trim() || value)}...`);
  beginActivity();
  updateControls();
  try {
    const snapshot = await api("/api/input", { session, value, columns: terminalColumns(), display: displaySettings() });
    activityResponded();
    selectedChoice?.classList.add("is-selected");
    command.value = "";
    await render(snapshot, true);
  } catch (error) { message(error.message, true); }
  finally {
    busy = false;
    pending?.classList.remove("is-pending");
    endActivity();
    updateControls();
    if (input) command.focus({ preventScroll: true });
    runQueuedContinue();
  }
}
terminal.addEventListener("click", (event) => {
  if (event.defaultPrevented) return;
  if (event.target instanceof Element && event.target.closest("button, a[href]")) return;
  const selection = getSelection();
  if (selection && !selection.isCollapsed) return;
  if (busy && !expiring) { if (session) queueContinue(); return; }
  if (input?.kind !== "wait") return;
  void submit("");
});
document.querySelector("#input-form").addEventListener("submit", (event) => {
  event.preventDefault();
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
  if (busy && !expiring && session && event.key === "Enter" && !event.repeat && !event.isComposing && !event.defaultPrevented
    && !(event.target instanceof Element && event.target.closest("input:not(#command), textarea, select, button, a[href], .menu"))) {
    event.preventDefault();
    queueContinue();
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
startButtons[0].addEventListener("click", () => { void start("demo"); });
startButtons[1].addEventListener("click", () => { void start("game"); });
document.querySelector("#font-size").addEventListener("input", (event) => {
  updateSetting("fontSize", Number(event.target.value));
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
