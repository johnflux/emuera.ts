/**
 * Translates the game's remaining Japanese text in place with the browser's on-device
 * Translator API (Chrome/Edge 138+). Text never leaves the machine. A page translator such as
 * Chrome's Translate button only translates a page once, so it misses output printed later;
 * this runs after every render instead. The original text is kept so translation can be undone.
 */
const STORAGE_KEY = "era-typescript.translate";
const JAPANESE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/;
// Map art is laid out one character per cell and its numbered rooms are matched by text.
const SKIP = ".era-map-art, .era-map-picture, script, style, textarea, [translate='no']";
// Text art drawn with box and block characters (maps printed outside the map panels).
const ART = /[\u2500-\u257f∴]/;

/** Protect complete text-art rows, including labels printed in separate colored spans. */
export function protectMapTranslation(root) {
  for (const element of root.querySelectorAll(".era-map-art, .era-map-picture, .line")) {
    const text = element.textContent;
    const structure = text.match(/[\u2500-\u259f\u25a0\u25a1]/g);
    if (!element.matches(".era-map-art, .era-map-picture")
      && (structure?.length ?? 0) < 3 && !/[森林木]{3}|[森林木]{2}.*[森林木]{2}/.test(text)) continue;
    element.setAttribute("translate", "no");
    element.classList.add("notranslate");
  }
}

export function createTranslation({ onChange = () => {} } = {}) {
  const originals = new WeakMap();
  const cache = new Map();
  const roots = new Set();
  let translator = null;
  let state = "off";
  let detail = "";
  let starting = null;
  let gestureWait = null;

  const supported = () => "Translator" in globalThis;
  const target = () => {
    const language = (navigator.language || "en").split("-")[0].toLowerCase();
    return language === "ja" ? "en" : language;
  };
  function enabled() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved === "on";
    return supported() && !(navigator.language || "").toLowerCase().startsWith("ja");
  }
  function set(next, info = "") {
    state = next;
    detail = info;
    onChange({ state, detail, enabled: enabled(), supported: supported(), language: target() });
  }

  async function create(language) {
    translator = await Translator.create({
      sourceLanguage: "ja",
      targetLanguage: language,
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => set("downloading", `${Math.round(event.loaded * 100)}%`));
      },
    });
    set("ready");
    for (const root of roots) translateTree(root);
  }
  // Downloading a language model needs a user gesture; the next click or key press starts it.
  function createOnGesture(language) {
    if (gestureWait) return;
    set("waiting", "click or press a key to download the translation model");
    gestureWait = () => {
      removeEventListener("pointerdown", gestureWait, true);
      removeEventListener("keydown", gestureWait, true);
      gestureWait = null;
      if (!enabled() || translator) return;
      set("downloading");
      create(language).catch((error) => set("unavailable", error.message));
    };
    addEventListener("pointerdown", gestureWait, true);
    addEventListener("keydown", gestureWait, true);
  }
  function start() {
    if (translator || starting || !enabled()) return;
    if (!supported()) { set("unavailable", "this browser has no on-device Translator"); return; }
    const language = target();
    set("starting");
    starting = (async () => {
      try {
        // Some embedded Chromium builds expose the API but never answer.
        const availability = await Promise.race([
          Translator.availability({ sourceLanguage: "ja", targetLanguage: language }),
          new Promise((resolve) => setTimeout(resolve, 15000, "timeout")),
        ]);
        if (availability === "timeout") return set("unavailable", "the browser's Translator did not respond");
        if (!enabled()) return set("off");
        if (availability === "unavailable") return set("unavailable", `Japanese to ${language} is not supported`);
        if (availability === "available" || navigator.userActivation?.isActive) await create(language);
        else createOnGesture(language);
      } catch (error) {
        if (error?.name === "NotAllowedError") createOnGesture(language);
        else set("unavailable", error.message);
      } finally {
        starting = null;
      }
    })();
  }

  function lookup(original) {
    let entry = cache.get(original);
    if (!entry) {
      entry = { text: null, promise: translator.translate(original).then((text) => (entry.text = text)) };
      entry.promise.catch(() => cache.delete(original));
      cache.set(original, entry);
    }
    return entry;
  }
  function apply(node, original) {
    const [, lead, body, trail] = original.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const entry = lookup(body);
    const write = (text) => { if (originals.get(node) === original && node.data === original) node.data = lead + text + trail; };
    if (entry.text !== null) write(entry.text);
    else entry.promise.then(write, () => originals.delete(node));
  }
  /** Translates Japanese text under root now and, once a model is ready, keeps doing so on every call. */
  function translateTree(root) {
    roots.add(root);
    protectMapTranslation(root);
    if (!enabled()) return;
    if (!translator) { start(); return; }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => !originals.has(node) && JAPANESE.test(node.data) && !ART.test(node.data) && !node.parentElement?.closest(SKIP)
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      originals.set(node, node.data);
      apply(node, node.data);
    }
  }
  function restore(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const original = originals.get(node);
      if (original === undefined) continue;
      originals.delete(node);
      node.data = original;
    }
  }
  /** A translation of text if one is ready; otherwise the text, with onReady called once it is translated. */
  function text(value, onReady) {
    if (!translator || !enabled() || !JAPANESE.test(value)) return value;
    const entry = lookup(value);
    if (entry.text !== null) return entry.text;
    entry.promise.then(onReady, () => {});
    return value;
  }
  function setEnabled(on) {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    if (on) {
      set(translator ? "ready" : "off");
      for (const root of roots) translateTree(root);
    } else {
      for (const root of roots) restore(root);
      set("off");
    }
  }

  return { enabled, setEnabled, translateTree, text, status: () => ({ state, detail, enabled: enabled(), supported: supported(), language: target() }) };
}
