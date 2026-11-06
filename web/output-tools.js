const STORAGE_KEY = "era-typescript.output-tools";
const DEFAULTS = { clipboard: false, local: false, endpoint: "http://127.0.0.1:1234/v1", model: "", language: "English" };

export function gameOutputText(outputs) {
  let text = "";
  for (const output of outputs) {
    if (output.type === "clear") {
      if (!output.count) continue;
      const lines = (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
      const kept = lines.slice(0, Math.max(0, lines.length - output.count));
      text = kept.length ? kept.join("\n") + "\n" : "";
    } else if (["text", "button", "html"].includes(output.type)) {
      let value = output.text;
      if (output.type === "html") {
        const html = new DOMParser().parseFromString(value, "text/html");
        html.querySelectorAll("script, style, [translate='no'], .era-map-art, .era-map-picture").forEach((node) => node.remove());
        html.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
        html.querySelectorAll("p, div, tr, li").forEach((node) => node.append("\n"));
        value = html.body.textContent;
      }
      text += value + (output.newline ? "\n" : "");
    }
  }
  return text.trim();
}

export function createOutputTools({ writeClipboard, translate, onChange = () => {} }) {
  let config = { ...DEFAULTS };
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { config = { ...config, ...JSON.parse(saved) }; }
    catch (error) { onChange({ error: `Could not load text tools settings: ${error.message}` }); }
  }
  let latest = "";
  let generation = 0;
  let controller;
  let timer;
  let clipboardQueue = Promise.resolve();
  const notify = (state) => onChange({ config: { ...config }, ...state });
  async function run(text, version) {
    if (config.clipboard) {
      clipboardQueue = clipboardQueue.then(async () => {
        if (version !== generation || !config.clipboard) return;
        try { await writeClipboard(text); }
        catch {}
      });
    }
    if (!config.local) return;
    controller = new AbortController();
    const signal = controller.signal;
    notify({ translating: true, text: "" });
    try {
      const chunks = [];
      for (let start = 0; start < text.length; start += 6000) chunks.push(text.slice(start, start + 6000));
      let result = "";
      for (const chunk of chunks) {
        const translated = await translate({ ...config, text: chunk, signal });
        if (signal.aborted || version !== generation) return;
        result += (result ? "\n" : "") + translated;
        notify({ translating: true, text: result });
      }
      notify({ translating: false, text: result });
    } catch (error) {
      if (!signal.aborted && version === generation) notify({ translating: false, error: `Translation failed: ${error.message}` });
    }
  }
  function publish(text) {
    latest = text;
    generation++;
    controller?.abort();
    clearTimeout(timer);
    if (!text) { notify({ text: "", translating: false }); return; }
    if (config.clipboard || config.local) {
      const version = generation;
      timer = setTimeout(() => { void run(text, version); }, 150);
    }
  }
  function configure(values) {
    config = { ...config, ...values };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    notify({ text: "", translating: false });
    publish(latest);
  }
  return { publish, configure, config: () => ({ ...config }) };
}
