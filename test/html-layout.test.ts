import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

test("header identifies the running game and preserves demo and debug labels", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const showReport = source.slice(source.indexOf("function showReport("), source.indexOf("function terminalColumns("));
  const gameTitle = source.slice(source.indexOf("const gameTitle ="), source.indexOf("let session ="));
  const elements = new Map<string, { hidden: boolean; textContent: string; setAttribute(): void }>();
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, { hidden: false, textContent: "", setAttribute() {} });
    return elements.get(selector)!;
  };
  const context = {
    games: [{ id: "tw", title: "eraToho The World" }, { id: "k", title: "eraTohoK" }],
    runMode: "game", runGame: "tw", runDebug: false,
    document: { querySelector: element },
    report: element("#compatibility"), debugButton: element("#debug-toggle"),
    debugPanel: element("#debug-output"), demoButton: element("#demo"),
    startButtons: [], restartButton: element("#restart"),
  };
  const render = () => runInNewContext(`${gameTitle}\n${showReport}\nshowReport(false);`, { ...context });
  render();
  assert.equal(element("#mode").textContent, "eraToho The World");
  context.runGame = "k";
  context.runDebug = true;
  render();
  assert.equal(element("#mode").textContent, "eraTohoK · Debug");
  context.runMode = "demo";
  render();
  assert.equal(element("#mode").textContent, "Demo · Debug");
  context.runDebug = false;
  render();
  assert.equal(element("#mode").textContent, "Demo");
});

test("active title fills the terminal below the visible interpreter header", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /body:has\(\.screen\.is-active \.era-launch\) > header/);
  assert.match(css, /#terminal:has\(\.screen\.is-active \.era-launch\) \{[^}]*container-type: size;/);
  assert.match(css, /\.screen\.is-active \.era-launch \{[^}]*100cqw[^}]*100cqh[^}]*height: 100%;/);
  assert.match(css, /body:has\(\.screen\.is-active \.era-launch\) #input-form \{ display: none; \}/);
});

test("character history renders literal text and local controls without game input handlers", async () => {
  const source = await readFile(new URL("../web/interaction-history.js", import.meta.url), "utf8");
  class Element {
    children: Element[] = [];
    textContent = "";
    className = "";
    hidden = false;
    parentElement: Element | null = null;
    isConnected = true;
    focused = false;
    scrollTop = 0;
    scrollHeight = 500;
    style: { color?: string } = {};
    attributes = new Map<string, string>();
    open = false;
    listeners = new Map<string, (event: { stopPropagation(): void; preventDefault(): void }) => unknown>();
    constructor(public tag: string) {}
    append(...elements: Element[]) { for (const element of elements) { this.children.push(element); element.parentElement = this; } }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    replaceChildren() { this.children = []; }
    addEventListener(type: string, handler: (event: { stopPropagation(): void; preventDefault(): void }) => unknown) {
      const previous = this.listeners.get(type);
      this.listeners.set(type, (event) => { previous?.(event); return handler(event); });
    }
    closest(selector: string): Element | null {
      return this.className.split(" ").includes(selector.slice(1)) ? this : this.parentElement?.closest(selector) ?? null;
    }
    querySelector(selector: string): Element | null {
      for (const child of this.children) {
        if (child.className.split(" ").includes(selector.slice(1))) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    }
    replaceWith(element: Element) {
      const siblings = this.parentElement!.children;
      siblings.splice(siblings.indexOf(this), 1, element);
      element.parentElement = this.parentElement;
    }
    after(element: Element) {
      const siblings = this.parentElement!.children;
      siblings.splice(siblings.indexOf(this) + 1, 0, element);
      element.parentElement = this.parentElement;
    }
    remove() {
      const siblings = this.parentElement!.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.isConnected = false;
    }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.get("close")?.({ stopPropagation() {}, preventDefault() {} }); }
    focus() { this.focused = true; }
    set innerHTML(_value: string) { throw new Error("History must be rendered as text, not HTML"); }
  }
  const llmSource = await readFile(new URL("../web/llm.js", import.meta.url), "utf8");
  const storage = new Map<string, string>();
  const sent: Record<string, any>[] = [];
  const replies: { status: number; body: unknown }[] = [];
  const documentEvents: string[] = [];
  const module = (code: string) => code.replace(/^import [^;]+;$/gm, "").replace(/^export /gm, "");
  const { render, setup, setTranslator } = runInNewContext(`${module(llmSource)}\n${module(source)}\n({render: renderCharacterHistory, setup: setupCharacterHistory, setTranslator: setHistoryTranslator})`, {
    document: {
      createElement: (tag: string) => new Element(tag),
      addEventListener() {}, removeEventListener() {},
      dispatchEvent(event: { type: string }) { documentEvents.push(event.type); },
    },
    Event: class { constructor(public type: string) {} },
    AbortController, performance,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    },
    fetch: async (url: string, init: { body: string }) => {
      assert.equal(url, "/api/llm");
      sent.push(JSON.parse(init.body));
      const reply = replies.shift()!;
      const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
      return { ok: true, status: 200, json: async () => ({ ok: reply.status === 200, status: reply.status, statusText: reply.status === 200 ? "OK" : "Unauthorized", text }) };
    },
    requestAnimationFrame: (callback: () => void) => callback(),
  });
  const context = { day: "5", time: ["600"], location: "9", locationName: "Living room", affection: "1", trust: "2" };
  const history = {
    character: { id: "alice", name: "Alice", number: "1" }, limit: 20, notice: "Earlier interactions are unavailable.",
    entries: [{
      action: { label: "Talk" }, target: "alice", before: context, after: { ...context, affection: "3" },
      participants: [{ id: "alice", name: "Alice" }],
      lines: [{ character: "alice", text: '<img src=x onerror="bad()">Hello.' }, { character: null, text: "Narration." }],
      choices: ["A choice"], truncated: true,
    }],
  };
  const parent = new Element("div");
  const translated: Element[] = [];
  setTranslator((root: Element) => translated.push(root));
  render(parent, history);
  assert.deepEqual(translated, [parent], "rendered history is handed to the page's translation");
  const nodes = (root: Element): Element[] => [root, ...root.children.flatMap(nodes)];
  const all = nodes(parent);
  assert.equal(parent.scrollTop, parent.scrollHeight, "new history scrolls to the bottom");
  assert.ok(all.every((element) => !["button", "img", "script"].includes(element.tag)));
  const text = all.map((element) => element.textContent).join("\n");
  assert.match(text, /Alice's interaction history \(1\)/);
  assert.match(text, /Day 5, 10:00 · Talk/);
  assert.ok(text.includes(history.entries[0]!.lines[0]!.text));
  const metadata = all.find((node) => node.tag === "p" && node.className === "era-history-note")!;
  assert.equal(metadata.children.map((node) => node.textContent).join(""), "Living room · Alice");
  assert.equal(metadata.children[1]!.attributes.get("translate"), "no");
  assert.equal(metadata.children[1]!.className, "notranslate");
  assert.doesNotMatch(text, /Alice's scene|may include narration|Script \/ narration/);
  assert.match(text, /Favor\+2/);
  assert.doesNotMatch(text, /affection:|→ 3/);
  assert.equal((text.match(/Day 5, 10:00/g) ?? []).length, 1, "timestamp appears only in the entry heading");
  assert.match(text, /truncated/);
  assert.doesNotMatch(text, /Earlier interactions are unavailable|Scripted interactions|no AI requests/);
  for (const type of ["click", "pointerdown", "keydown", "contextmenu"]) {
    let stopped = false;
    parent.listeners.get(type)!({ stopPropagation() { stopped = true; }, preventDefault() {} });
    assert.equal(stopped, true, `${type} cannot reach the game's input handlers`);
  }
  const panel = parent.children[0]!;
  panel.open = false;
  panel.listeners.get("toggle")!({ stopPropagation() {}, preventDefault() {} });
  const empty = new Element("div");
  render(empty, { ...history, entries: [] });
  assert.equal(empty.children[0]!.open, false, "collapse preference survives main-screen redraws");
  const emptyBody = empty.children[0]!.children[1]!;
  assert.equal(emptyBody.children.length, 1);
  assert.equal(emptyBody.children[0]!.tag, "em");
  assert.equal(emptyBody.children[0]!.textContent, "No interaction yet");
  const colored = new Element("div");
  render(colored, { ...history, entries: [{ ...history.entries[0], lines: [{
    character: "alice", text: "Red green unsafe",
    runs: [
      { text: "<red>", color: "#ff0000" },
      { text: " green ", color: "green" },
      { text: "unsafe", color: "url(https://example.com)" },
    ],
  }] }] });
  const spans = nodes(colored).filter((node) => node.className === "era-history-text").flatMap((node) => node.children);
  assert.equal(spans[0]!.textContent, "<red>");
  assert.equal(spans[0]!.style.color, "#ff0000");
  assert.equal(spans[1]!.style.color, "green");
  assert.equal(spans[2]!.style.color, undefined);
  const padded = new Element("div");
  render(padded, { ...history, entries: [{ ...history.entries[0], lines: [{
    character: "alice", text: "\n\n  \nKana is here.\nYou realize you haven't greeted her today.\n \n",
    runs: [
      { text: "\n\n", color: "white" },
      { text: "  \nKana is here.\n", color: "#c0c0c0" },
      { text: "You realize you haven't greeted her today.\n ", color: "green" },
      { text: "\n", color: "white" },
    ],
  }] }] });
  const trimmedSpans = nodes(padded).filter((node) => node.className === "era-history-text").flatMap((node) => node.children);
  assert.equal(trimmedSpans.length, 2);
  assert.equal(trimmedSpans[0]!.textContent, "Kana is here.\n");
  assert.equal(trimmedSpans[0]!.style.color, "#c0c0c0");
  assert.equal(trimmedSpans[1]!.textContent, "You realize you haven't greeted her today.");
  assert.equal(trimmedSpans[1]!.style.color, "green");
  const whitespace = new Element("div");
  render(whitespace, { ...history, entries: [{ ...history.entries[0], lines: [{
    character: "alice", text: " \n ", runs: [{ text: " \n ", color: "white" }],
  }] }] });
  assert.equal(nodes(whitespace).filter((node) => node.className === "era-history-text").flatMap((node) => node.children).length, 0);
  const ordered = new Element("div");
  render(ordered, { ...history, entries: [
    { ...history.entries[0], action: { label: "Newest" }, before: { ...context, marks: { hate: "0", pain: "1" } },
      after: { ...context, affection: "4", trust: "1", marks: { hate: "1", pain: "1" } } },
    { ...history.entries[0], action: { label: "Oldest" }, after: context },
  ] });
  const entries = nodes(ordered).filter((node) => node.className === "era-history-entry");
  assert.match(entries[0]!.children[0]!.textContent, / · Oldest$/);
  assert.equal(entries[0]!.open, false);
  assert.match(entries[1]!.children[0]!.textContent, / · Newest$/);
  assert.equal(entries[1]!.open, true);
  assert.ok(nodes(entries[1]!).some((node) => node.textContent === "Favor+3 · Trust-1 · Hate Mark 0→1"));
  assert.ok(!nodes(entries[0]!).some((node) => /Favor|Trust/.test(node.textContent)), "omit unchanged stats");
  assert.equal(history.entries[0]!.action.label, "Talk", "rendering does not reorder the source history");
  for (const colored of [false, true]) {
    const compact = new Element("div");
    const content = "\n--------------------\nYou and the Robot Maid talk...\n\n \n「Nice weather.」\n---\n\n";
    render(compact, { ...history, entries: [{ ...history.entries[0], lines: [{
      character: "alice", text: content,
      ...(colored ? { runs: [
        { text: content.slice(0, 10), color: "red" },
        { text: content.slice(10), color: "green" },
      ] } : {}),
    }] }] });
    const paragraphs = nodes(compact).filter((node) => node.className === "era-history-text");
    const dialogue = paragraphs[0]!.children.map((node) => node.textContent).join("");
    assert.equal(dialogue, "You and the Robot Maid talk...\n「Nice weather.」");
    if (colored) assert.ok(paragraphs[0]!.children.every((node) => node.style.color === "green"));
    const note = nodes(compact).find((node) => node.tag === "p" && node.className === "era-history-note");
    assert.equal(note!.children.map((node) => node.textContent).join(""), "Living room · Alice");
    assert.ok(!nodes(compact).some((node) => node.textContent === "Alice's scene"));
  }
  for (const colored of [false, true]) {
    const intro = new Element("div");
    const content = "Alice was in the Living room.\nYou serve some tea to Alice...\n「You serve some tea to Alice...」\nAlice enjoys the tea.\n";
    render(intro, { ...history, entries: [{ ...history.entries[0], action: { id: 301, label: "Serve tea" }, lines: [{
      character: "alice", text: content,
      ...(colored ? { runs: [{ text: content, color: "green" }] } : {}),
    }] }] });
    const dialogue = nodes(intro).filter((node) => node.className === "era-history-text")[0]!;
    assert.equal(dialogue.children.map((node) => node.textContent).join(""), "「You serve some tea to Alice...」\nAlice enjoys the tea.");
    if (colored) assert.equal(dialogue.children[0]!.style.color, "green");
  }
  const card = new Element("div");
  card.className = "era-character-info";
  const tabs = new Element("div");
  tabs.className = "era-info-tabs";
  const title = new Element("div");
  title.className = "era-info-title";
  tabs.append(title);
  const info = new Element("div");
  info.className = "era-info-body";
  const historyPanel = new Element("div");
  card.append(tabs);
  card.append(info);
  card.append(historyPanel);
  let requests = 0;
  const olderPreview = `${"Older padding.\n".repeat(10)}Oldest line.\nOlder interaction.`;
  setup(historyPanel, { ...history, entries: [{ ...history.entries[0], lines: [{
    character: "alice", text: "Earlier line.\nRecent line.\nLatest line.",
    runs: [{ text: "Earlier line.\n", color: "red" }, { text: "Recent line.\nLatest line.", color: "green" }],
  }] }, { ...history.entries[0], lines: [{ character: "alice", text: "\n---\n" }] },
  { ...history.entries[0], lines: [{
    character: "alice", text: olderPreview, runs: [{ text: olderPreview, color: "blue" }],
  }] }] }, async () => { requests++; return history; });
  assert.equal(historyPanel.hidden, true);
  assert.equal(info.hidden, false);
  const localEvent = { stopPropagation() {}, preventDefault() {} };
  const preview = info.querySelector(".era-history-preview")!;
  const previewText = preview.querySelector(".era-history-preview-content")!;
  assert.equal(previewText.children.map((node) => node.textContent).join(""), `${"Older padding.\n".repeat(5)}Oldest line.\nOlder interaction.\nEarlier line.\nRecent line.\nLatest line.`);
  assert.equal(previewText.children[0]!.style.color, "blue");
  assert.equal(previewText.children[2]!.style.color, "red");
  assert.equal(previewText.children[3]!.style.color, "green");
  assert.ok(info.className.includes("era-info-with-preview"));
  preview.listeners.get("click")!(localEvent);
  assert.equal(historyPanel.hidden, false);
  assert.equal(historyPanel.scrollTop, historyPanel.scrollHeight, "opening the history tab shows the newest text");
  assert.equal(tabs.children[1]!.focused, true);
  tabs.children[1]!.listeners.get("click")!(localEvent);
  assert.equal(historyPanel.hidden, false);
  assert.equal(info.hidden, true);
  assert.equal(tabs.children[1]!.attributes.get("aria-pressed"), "true");
  const expand = nodes(historyPanel).find((node) => node.tag === "button")!;
  assert.equal(expand.textContent, "more...");
  assert.ok(!nodes(historyPanel).some((node) => /Latest \d+ interactions/.test(node.textContent)));
  await expand.listeners.get("click")!(localEvent);
  assert.equal(requests, 1, "all history is loaded only when expanded");
  const dialog = nodes(historyPanel).find((node) => node.tag === "dialog")!;
  assert.equal(dialog.open, true);
  assert.ok(nodes(dialog).filter((node) => node.className === "era-history-entry").every((node) => node.open));
  dialog.listeners.get("cancel")!(localEvent);
  assert.equal(dialog.isConnected, false);
  assert.equal(expand.focused, true);
  tabs.children[0]!.listeners.get("click")!(localEvent);
  assert.equal(info.hidden, false);
  assert.equal(historyPanel.hidden, true);
  const failure = new Element("div");
  render(failure, history, { loadAll: async () => { throw new Error("Session expired"); } });
  await nodes(failure).find((node) => node.tag === "button")!.listeners.get("click")!(localEvent);
  assert.ok(nodes(failure).some((node) => node.textContent === "Could not load interaction history: Session expired"));

  // Chatting through the configured LLM. Like the server, the fake game writes everything said and done into the
  // history at once: the player's words in quotes, speech in 「」, actions as narration and other calls in backticks.
  const settled = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)); };
  const call = (id: string, name: string, args: string) => ({ id, type: "function", function: { name, arguments: args } });
  const fakeGame = (tool: (name: string, args: Record<string, unknown>) => { result: Record<string, unknown>; changed: boolean } = () => ({ result: {}, changed: true })) => {
    const lines: { character: string | null; text: string }[] = [];
    const ran: [string, unknown][] = [];
    const chatEntry = () => ({ ...history.entries[0], id: "chat1", action: { id: "chat", label: "Conversation" }, lines: lines.map((line) => ({ ...line })), choices: [], truncated: false });
    return {
      ran, lines,
      loadAll: async () => ({ ...history, entries: lines.length ? [chatEntry(), ...history.entries] : history.entries }),
      record: async (text: string) => {
        lines.push({ character: null, text: text.split(/(\*[^*]+\*)/).filter((part) => part.trim()).map((part) => part.startsWith("*") ? part : `"${part.trim()}"`).join(" ") });
      },
      undo: async (count: number) => { lines.splice(lines.length - count); },
      runTool: async (name: string, args: Record<string, unknown>) => {
        ran.push([name, args]);
        const outcome = tool(name, args);
        if (name === "say" && !outcome.result.error) lines.push({ character: "alice", text: `「${args.text}」` });
        else if (name === "act" && !outcome.result.error) lines.push({ character: "alice", text: String(args.text) });
        else if (name !== "describe_scene") lines.push({ character: "alice", text: `\`${name}(${JSON.stringify(args)})\` → ${JSON.stringify(outcome.result)}` });
        return outcome;
      },
    };
  };
  const openChat = async (game: ReturnType<typeof fakeGame>, options: Record<string, unknown> = {}) => {
    const chatParent = new Element("div");
    const { loadAll, record, undo, runTool } = game;
    render(chatParent, history, { loadAll, chat: { gameId: "tw", gameTitle: "eraTW", record, undo, runTool, ...options } });
    await nodes(chatParent).find((node) => node.tag === "button")!.listeners.get("click")!(localEvent);
    const chatDialog = nodes(chatParent).find((node) => node.tag === "dialog")!;
    const find = (predicate: (node: Element) => boolean) => nodes(chatDialog).find(predicate)!;
    const textarea = find((node) => node.tag === "textarea") as Element & { value: string };
    const say = async (value: string) => {
      textarea.value = value;
      find((node) => node.tag === "form").listeners.get("submit")!(localEvent);
      await settled();
    };
    const shown = () => nodes(chatDialog).filter((node) => node.className === "era-history-text").map((node) => node.children.filter((child) => child.tag === "span" && !child.className).map((child) => child.textContent).join(""));
    return { chatDialog, find, textarea, say, shown, text: () => nodes(chatDialog).map((node) => node.textContent).join("\n") };
  };
  let game = fakeGame();
  let chat = await openChat(game);
  assert.equal(chat.textarea.focused, true);
  await chat.say("Hello there");
  assert.equal(sent.length, 0, "nothing is sent before an LLM is set up");
  assert.deepEqual(documentEvents, ["era-llm-configure"]);
  assert.equal(game.lines.length, 0);
  // Without tool calling, the JSON reply still goes into the room and the history through say and act.
  storage.set("era-typescript.llm", JSON.stringify({ provider: "openrouter", providers: { openrouter: { apiKey: "sk-test", model: "test/model", tools: false } } }));
  replies.push({ status: 200, body: { choices: [{ message: { content: '```json\n{"speech": "Hi!", "actions": ["Alice waves."]}\n```' } }] } });
  await chat.say("Hello there");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.provider, "openrouter");
  assert.equal(sent[0]!.endpoint, "https://openrouter.ai/api/v1");
  assert.equal(sent[0]!.apiKey, "sk-test");
  assert.equal(sent[0]!.path, "chat/completions");
  assert.equal(sent[0]!.payload.model, "test/model");
  assert.deepEqual(sent[0]!.payload.response_format, { type: "json_object" });
  const prompt = sent[0]!.payload.messages;
  assert.equal(prompt[0].role, "system");
  assert.match(prompt[0].content, /role-playing as Alice.*"eraTW"/);
  assert.match(prompt[0].content, /"speech".*"actions"/);
  assert.match(prompt[1].content, /Current situation: Day 5, 10:00 at Living room\. Alice's favor toward the player: 3; trust: 2\./);
  assert.match(prompt[1].content, /\[Day 5, 10:00 · Living room\] Talk \(present: Alice\)\n.*Hello\.\nNarration\.\nPlayer inputs: A choice\nFavor\+2/);
  assert.doesNotMatch(prompt[1].content, /Hello there/, "the new message is the player's turn, not part of the history context");
  assert.deepEqual(prompt.at(-1), { role: "user", content: "Hello there" });
  assert.equal(chat.textarea.value, "");
  assert.deepEqual(game.lines.map((line) => line.text), ['"Hello there"', "Alice waves.", "「Hi!」"]);
  assert.deepEqual(chat.shown().slice(-3), ['"Hello there"', "Alice waves.", "「Hi!」"]);
  assert.ok(!nodes(chat.chatDialog).some((node) => /era-llm-message is-|era-llm-transcript/.test(node.className)), "no separate chat transcript");
  const debugTab = chat.find((node) => node.textContent.startsWith("LLM debug"));
  assert.equal(debugTab.textContent, "LLM debug (1)");
  debugTab.listeners.get("click")!(localEvent);
  const debugPane = chat.find((node) => node.className.includes("era-llm-debug") && node.tag === "div");
  assert.equal(debugPane.hidden, false);
  const debugText = nodes(debugPane).map((node) => node.textContent).join("\n");
  assert.match(debugText, /OpenRouter · test\/model · 200 OK/);
  assert.match(debugText, /Sent: POST https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/);
  assert.match(debugText, /Hello there/);
  assert.match(debugText, /"speech": "Hi!"/);
  assert.ok(!nodes(debugPane).some((node) => node.className === "era-llm-voice"), "no voice editor without the voice API");
  assert.doesNotMatch(debugText, /sk-test/, "the API key is not shown");
  chat.chatDialog.listeners.get("cancel")!(localEvent);

  // The conversation is part of the history: a later prompt carries it as context. A failed reply is taken back.
  storage.set("era-typescript.llm", JSON.stringify({ provider: "openrouter", providers: { openrouter: { apiKey: "sk-test", model: "test/model" } } }));
  chat = await openChat(game);
  assert.deepEqual(chat.shown().slice(-3), ['"Hello there"', "Alice waves.", "「Hi!」"]);
  replies.push({ status: 401, body: { error: { message: "No auth" } } });
  await chat.say("Again");
  assert.match(sent[1]!.payload.messages[1].content, /Conversation \(present: Alice\)\n"Hello there"\nAlice waves\.\n「Hi!」/);
  assert.match(chat.text(), /No reply: 401 Unauthorized: No auth/);
  assert.equal(chat.textarea.value, "Again");
  assert.equal(game.lines.length, 3, "the unanswered message is taken back");
  // Retry takes back a message of yours and everything after it, then sends it again; Edit puts it back to change first.
  replies.push({ status: 200, body: { choices: [{ message: { content: null, tool_calls: [call("h", "say", '{"text": "Hello again!"}')] } }] } });
  replies.push({ status: 200, body: { choices: [{ message: { content: "DONE" } }] } });
  const retry = chat.find((node) => node.tag === "button" && node.textContent === "Retry");
  assert.match(retry.parentElement!.parentElement!.textContent + retry.parentElement!.parentElement!.children.map((node) => node.textContent).join(""), /"Hello there"/);
  await retry.listeners.get("click")!(localEvent);
  await settled();
  assert.deepEqual(sent.at(-2)!.payload.messages.slice(-1), [{ role: "user", content: "Hello there" }]);
  assert.doesNotMatch(sent.at(-2)!.payload.messages[1].content, /Hi!/);
  assert.deepEqual(game.lines.map((line) => line.text), ['"Hello there"', "「Hello again!」"]);
  await chat.find((node) => node.tag === "button" && node.textContent === "Edit").listeners.get("click")!(localEvent);
  await settled();
  assert.equal(chat.textarea.value, "Hello there");
  assert.equal(game.lines.length, 0);
  assert.doesNotMatch(chat.text(), /Hello again!/);
  chat.chatDialog.listeners.get("cancel")!(localEvent);

  // Tool calls run in the game and their results go back to the model until it replies; closing then redraws the room.
  let refreshed = 0;
  game = fakeGame((name) => {
    if (name === "describe_scene") return { result: { time: "07:00", me: { name: "Alice" }, othersHere: ["Bob (Human, male)"] }, changed: false };
    if (name === "say") return { result: { heard: true }, changed: true };
    return name === "change_feelings" ? { result: { favor: { before: 3, after: 13 } }, changed: true } : { result: { error: "Unknown destination" }, changed: false };
  });
  chat = await openChat(game, { refresh: async () => { refreshed++; } });
  replies.push({ status: 200, body: { choices: [{ message: { content: null, tool_calls: [call("a", "change_feelings", '{"favor": 10, "reason": "gift"}'), call("b", "move_to", '{"destination": "Moon"}')] } }] } });
  // A text reply is taken as the reply itself (here a {"speech", "actions"} object) and ends it.
  replies.push({ status: 200, body: { choices: [{ message: { content: '{"speech": "Thank you!", "actions": []}' } }] } });
  await chat.say("*hands over a gift* Here is a gift");
  await settled();
  assert.equal(JSON.stringify(game.ran), JSON.stringify([["describe_scene", {}], ["change_feelings", { favor: 10, reason: "gift" }], ["move_to", { destination: "Moon" }], ["say", { text: "Thank you!" }]]));
  const [first, second] = sent.slice(-2).map((request) => request.payload);
  assert.equal(second.messages.length, first.messages.length + 3, "nothing more is asked after a text reply");
  assert.deepEqual(first.tools.map((tool: { function: { name: string } }) => tool.function.name), ["get_character_info", "find_characters", "change_feelings", "change_mark", "change_mood", "check_consent", "player_attempts", "say", "act", "move_to", "push_down_player"]);
  assert.match(first.messages[0].content, /Talk and act only through tool calls/);
  assert.match(first.messages[0].content, /call check_consent for it and answer/);
  assert.doesNotMatch(first.messages[0].content, /"speech"/);
  assert.equal(first.response_format, undefined, "replies come through tools, so JSON mode is off");
  assert.match(first.messages[2].content, /^Current scene \("me" is you, the character you play\):\n\{"time":"07:00","me":\{"name":"Alice"\},"othersHere":\["Bob \(Human, male\)"\]\}$/);
  assert.equal(first.messages.length, 4, "earlier turns are history, not replayed messages");
  assert.deepEqual(second.messages.slice(-3).map((message: { role: string }) => message.role), ["assistant", "tool", "tool"]);
  assert.equal(JSON.stringify(second.messages.at(-2)), JSON.stringify({ role: "tool", tool_call_id: "a", name: "change_feelings", content: '{"favor":{"before":3,"after":13}}' }));
  assert.deepEqual(chat.shown().slice(-4).map((line) => line.replace(/`.*/, "`")), ['*hands over a gift* "Here is a gift"', "`", "`", "「Thank you!」"]);
  assert.match(chat.text(), /Close this window to see what happens in the room/);
  chat.find((node) => node.textContent.startsWith("LLM debug")).listeners.get("click")!(localEvent);
  const toolDebug = nodes(chat.find((node) => node.className.includes("era-llm-debug") && node.tag === "div")).map((node) => node.textContent).join("\n");
  assert.match(toolDebug, /→ change_feelings\(\{"favor": 10, "reason": "gift"\}\)/);
  assert.match(toolDebug, /tool result \(move_to\)/);
  assert.equal(refreshed, 0);
  chat.chatDialog.close();
  assert.equal(refreshed, 1, "closing after a change redraws the room");

  // A reply is a few seconds long: going past the limit drops the extra lines and ends the reply without asking again.
  game = fakeGame();
  chat = await openChat(game);
  let before = sent.length;
  replies.push({ status: 200, body: { choices: [{ message: { content: null, tool_calls: [1, 2, 3, 4].map((n) => call(`s${n}`, "say", `{"text": "Line ${n}."}`)) } }] } });
  await chat.say("Talk to me");
  await settled();
  assert.equal(sent.length, before + 1);
  assert.deepEqual(game.lines.map((line) => line.text), ['"Talk to me"', "「Line 1.」", "「Line 2.」", "「Line 3.」"]);
  assert.match(sent.at(-1)!.payload.messages[0].content, /approximately 6 seconds.*\n.*Do not invent people, places/s);
  // Calls written out as text are run as calls.
  replies.push({ status: 200, body: { choices: [{ message: { content: 'say(text: "I like you too.")\nact(text: "Alice blushes (a little).")' } }] } });
  replies.push({ status: 200, body: { choices: [{ message: { content: "DONE" } }] } });
  await chat.say("I like you");
  await settled();
  assert.deepEqual(game.lines.slice(-2).map((line) => line.text), ["「I like you too.」", "Alice blushes (a little)."]);
  assert.equal(sent.at(-1)!.payload.messages.at(-3).tool_calls.length, 2);
  // A plain-text reply goes into the history anyway: quoted speech is said and the narration around it acted.
  before = sent.length;
  replies.push({ status: 200, body: { choices: [{ message: { content: '「Indeed. We seek only to observe.」\n\n*Alice\'s smile remains.* "Why?"' } }] } });
  await chat.say("Do you want me?");
  await settled();
  assert.equal(sent.length, before + 1, "a text reply is the whole reply");
  assert.deepEqual(game.lines.slice(-3).map((line) => line.text), ["「Indeed. We seek only to observe.」", "Alice's smile remains.", "「Why?」"]);
  assert.doesNotMatch(chat.text(), /did not reply|Ignored/);
  // DONE ends a reply, including after calls written out as text.
  before = sent.length;
  replies.push({ status: 200, body: { choices: [{ message: { content: "DONE" } }] } });
  await chat.say("...");
  await settled();
  assert.equal(sent.length, before + 1);
  assert.match(chat.text(), /Alice did not reply\./);
  replies.push({ status: 200, body: { choices: [{ message: { content: 'say(text: "Bye.")\nDONE.' } }] } });
  await chat.say("Bye");
  await settled();
  assert.equal(sent.length, before + 2);
  assert.equal(game.lines.at(-1)!.text, "「Bye.」");
  assert.match(sent.at(-1)!.payload.messages[0].content, /reply with just DONE/);
  chat.chatDialog.close();

  // The character's voice is edited in the debug tab: loaded from the game, saved to disk, and reverted.
  const savedVoices: unknown[] = [];
  const generated = { description: "A demon from below.", examples: ["We think not.", "A meeting is nice."], intimateExamples: ["Our body."] };
  let voiceRequests = 0;
  chat = await openChat(fakeGame(), {
    voice: async () => { voiceRequests++; return { generated, saved: null, location: "/saves/llm-voices.json" }; },
    saveVoice: async (voice: unknown) => { savedVoices.push(voice); },
  });
  assert.equal(voiceRequests, 0, "the voice is loaded only when the debug tab is opened");
  chat.find((node) => node.textContent.startsWith("LLM debug")).listeners.get("click")!(localEvent);
  await settled();
  assert.equal(voiceRequests, 1);
  const voiceSection = chat.find((node) => node.className === "era-llm-voice");
  const voiceText = () => nodes(voiceSection).map((node) => node.textContent).join("\n");
  const [descriptionBox, examplesBox, intimateBox] = nodes(voiceSection).filter((node) => node.tag === "textarea") as (Element & { value: string })[];
  assert.equal(descriptionBox!.value, "A demon from below.");
  assert.equal(examplesBox!.value, "We think not.\nA meeting is nice.");
  assert.equal(intimateBox!.value, "Our body.");
  assert.match(voiceText(), /Character voice \(generated\)/);
  assert.match(voiceText(), /saved to \/saves\/llm-voices\.json/);
  const voiceButton = (label: string) => nodes(voiceSection).find((node) => node.tag === "button" && node.textContent === label)! as Element & { disabled: boolean };
  assert.equal(voiceButton("Revert to generated").disabled, true);
  examplesBox!.value = "「We think not.」\n\n  We shall see.  ";
  examplesBox!.listeners.get("input")!(localEvent);
  assert.match(voiceText(), /Unsaved changes\./);
  await voiceButton("Save").listeners.get("click")!(localEvent);
  await settled();
  assert.deepEqual(JSON.parse(JSON.stringify(savedVoices)), [{ description: "A demon from below.", examples: ["We think not.", "We shall see."], intimateExamples: ["Our body."] }]);
  assert.match(voiceText(), /Character voice \(edited\)/);
  assert.match(voiceText(), /Saved\./);
  assert.equal(voiceButton("Revert to generated").disabled, false);
  await voiceButton("Revert to generated").listeners.get("click")!(localEvent);
  await settled();
  assert.equal(savedVoices.at(-1), null);
  assert.equal(examplesBox!.value, "We think not.\nA meeting is nice.");
  assert.match(voiceText(), /Character voice \(generated\)/);
  chat.chatDialog.close();

  // The player's attempt is handed to the game: nothing after it runs, nothing more is asked, and the dialog closes.
  let redrawn = 0;
  game = fakeGame((name) => name === "player_attempts" ? { result: { note: "The player tries it now" }, changed: true } : { result: { heard: true }, changed: true });
  chat = await openChat(game, { refresh: async () => { redrawn++; } });
  const asked = sent.length;
  replies.push({ status: 200, body: { choices: [{ message: { content: null, tool_calls: [
    call("k1", "say", '{"text": "Oh!"}'), call("k2", "player_attempts", '{"activity": "kiss"}'), call("k3", "say", '{"text": "Too late."}')] } }] } });
  await chat.say("Can I kiss you?");
  await settled();
  assert.equal(sent.length, asked + 1);
  assert.equal(JSON.stringify(game.ran.map(([name]) => name)), JSON.stringify(["describe_scene", "say", "player_attempts"]));
  assert.equal(JSON.stringify(sent.at(-1)!.payload.tools.map((tool: { function: { name: string } }) => tool.function.name).slice(5, 7)), JSON.stringify(["check_consent", "player_attempts"]));
  assert.match(sent.at(-1)!.payload.messages[0].content, /actually tries to kiss Alice: call player_attempts\("kiss"\)/);
  assert.equal(redrawn, 1, "the dialog closes so the game plays out the attempt");
  // In an intimate scene the prompt and tools change, and a scene command is handed to the game the same way.
  game = fakeGame((name) => {
    if (name === "describe_scene") return { result: { me: { name: "Alice" }, intimateScene: { availableCommands: ["Kiss", "Caress"] }, voice: { description: "A demon from below.", examples: ["We think not."] } }, changed: false };
    return name === "scene_action" ? { result: { command: "Kiss" }, changed: true } : { result: { heard: true }, changed: true };
  });
  chat = await openChat(game, { refresh: async () => { redrawn++; } });
  replies.push({ status: 200, body: { choices: [{ message: { content: null, tool_calls: [
    call("s1", "say", '{"text": "Mm..."}'), call("s2", "scene_action", '{"command": "Kiss"}'), call("s3", "say", '{"text": "Again."}')] } }] } });
  await chat.say("Kiss me.");
  await settled();
  assert.equal(JSON.stringify(game.ran.map(([name]) => name)), JSON.stringify(["describe_scene", "say", "scene_action"]));
  const names = sent.at(-1)!.payload.tools.map((tool: { function: { name: string } }) => tool.function.name);
  assert.ok(names.includes("scene_action") && names.includes("end_scene") && !names.includes("check_consent") && !names.includes("player_attempts") && !names.includes("move_to"));
  assert.match(sent.at(-1)!.payload.messages[0].content, /middle of an intimate scene/);
  assert.match(sent.at(-1)!.payload.messages[0].content, /wants to stop or rest .*: call end_scene/);
  assert.match(sent.at(-1)!.payload.messages[0].content, /commands available now \(Kiss, Caress\)/);
  // Her kojo's description and lines come after the scene as plain text, and the instructions ask to match them.
  assert.match(sent.at(-1)!.payload.messages[0].content, /Speak the way Alice does in the example lines below/);
  const sceneMessage = sent.at(-1)!.payload.messages[2].content;
  assert.match(sceneMessage, /How the game introduces you:\nA demon from below\.\n\nExample lines you say in the game \(your voice\):\n「We think not\.」$/);
  assert.doesNotMatch(sceneMessage, /"voice"/);
  assert.equal(redrawn, 2, "the dialog closes so the game plays out the scene command");
});

test("crash reports render as text and copy with explicit clipboard error feedback", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("  if (snapshot.error) {");
  const end = source.indexOf('  } else message(snapshot.status', start);
  assert.ok(start >= 0 && end > start);
  for (const context of [undefined, {
    game: "fixture", gameVersion: "7", debug: true, jit: false,
    action: "input (string)", instruction: 'THROW <img src=x onerror="bad()">',
    instructions: 10, instructionLimit: 1000, outputCharacters: 123, outputLimit: 2_000_000,
    outputEvents: 2, deferredEvents: 1, lastLoadedSlot: "-1",
    routines: ["@INNER (test.ERB:5)"],
    server: { game: "registered", session: "session-id", step: 4, action: "input" },
  }]) {
    const lines: { textContent: string; classList: { add(value: string): void }; append(value: unknown): void }[] = [];
    const messages: string[] = [];
    let copied = "";
    let fail = false;
    let handler: (event: { stopPropagation(): void }) => Promise<void>;
    const button = {
      type: "", textContent: "",
      addEventListener(_type: string, callback: typeof handler) { handler = callback; },
    };
    const scope = {
      snapshot: { error: { file: "test.ERB", line: 8, message: "fixture crash", trace: ["caller.ERB:2"], context } },
      currentLine: null as typeof lines[number] | null,
      message: (value: string) => messages.push(value),
      document: { createElement: () => button },
      navigator: { clipboard: { async writeText(value: string) { if (fail) throw new Error("Permission denied"); copied = value; } } },
      line() {
        if (!scope.currentLine) {
          scope.currentLine = { textContent: "", classList: { add() {} }, append() {} };
          lines.push(scope.currentLine);
        }
        return scope.currentLine;
      },
    };
    runInNewContext(`${source.slice(start, end)}\n}`, scope);
    assert.equal(button.type, "button");
    assert.match(lines[0]!.textContent, /ERROR test.ERB:8 - fixture crash\n  called from caller.ERB:2/);
    if (context) {
      assert.ok(lines[0]!.textContent.includes(context.instruction));
      assert.match(lines[0]!.textContent, /Session: session-id \| Step: 4/);
      assert.match(lines[0]!.textContent, /Output: 123 \/ 2000000 serialized characters/);
      assert.match(lines[0]!.textContent, /active @INNER/);
    }
    let stopped = 0;
    await handler!({ stopPropagation() { stopped++; } });
    assert.equal(copied, lines[0]!.textContent);
    assert.equal(messages.at(-1), "Debug report copied.");
    fail = true;
    await handler!({ stopPropagation() { stopped++; } });
    assert.equal(messages.at(-1), "Could not copy debug report: Permission denied");
    assert.equal(stopped, 2);
  }
});

test("unmarked map rows protect scenery and separate labels from both translation methods", async () => {
  const source = await readFile(new URL("../web/translate.js", import.meta.url), "utf8");
  const start = source.indexOf("export function protectMapTranslation(");
  const end = source.indexOf("export function createTranslation(", start);
  const protect = runInNewContext(`${source.slice(start, end).replace("export ", "")}\nprotectMapTranslation`);
  const row = (textContent: string, marked = false) => ({
    textContent, attributes: new Map<string, string>(), classes: new Set<string>(),
    matches: () => marked,
    setAttribute(name: string, value: string) { this.attributes.set(name, value); },
    get classList() { return { add: (value: string) => this.classes.add(value) }; },
  });
  const maps = [
    row("■林　　　■14│　　│ 08 　　 07 　■"),
    row("森林林木林林林林林林林林林林林林"),
    row("　森森　　　　　　　森森"),
    row("　　　┃┃┃22→"),
    row("霊夢の部屋", true),
  ];
  const prose = [row("■博麗神社"), row("施設：【風呂】【台所】"), row("森へ移動しますか？"), row("│ 霊夢と話す │")];
  const root = { querySelectorAll: () => [...maps, ...prose] };
  protect(root);
  protect(root);
  for (const element of maps) {
    assert.equal(element.attributes.get("translate"), "no");
    assert.ok(element.classes.has("notranslate"));
  }
  for (const element of prose) assert.equal(element.attributes.has("translate"), false);
});

test("timed mouse frames are capped at 60 FPS without changing longer waits or other input timers", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("const FRAME_INTERVAL =");
  const end = source.indexOf("async function expire(", start);
  const delays: number[] = [];
  const cleared: number[] = [];
  const input = { kind: "mousekey", timeout: 5 };
  const schedule = runInNewContext(`let timedWait;\n${source.slice(start, end)}\nscheduleTimedWait`, {
    input, performance: { now: () => 0 },
    setTimeout: (_: () => void, delay: number) => { delays.push(delay); return delays.length; },
    clearTimeout: (handle: number) => cleared.push(handle), clearInterval() {},
  });
  schedule();
  assert.equal(delays[0], 1000 / 60);
  input.timeout = 100;
  schedule();
  assert.equal(delays[1], 100);
  input.kind = "wait";
  input.timeout = 5;
  schedule();
  assert.equal(delays[2], 5);
  input.kind = "integer";
  schedule();
  assert.equal(delays[3], 5);
  assert.deepEqual(cleared, [1, 2, 3]);
});

test("mouse and keyboard events reach the input queue while a timed frame is rendering", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const terminalHandlers = new Map<string, { capture: boolean; handler: (event: object) => void }[]>();
  const documentHandlers: ((event: object) => void)[] = [];
  const sent: { result: number[] }[] = [];
  const state = { busy: true, expiring: true, settling: false, hit: -1 };
  const terminal = {
    addEventListener(name: string, handler: (event: object) => void, options?: boolean) {
      const handlers = terminalHandlers.get(name) ?? [];
      handlers.push({ capture: options === true, handler });
      terminalHandlers.set(name, handlers);
    },
  };
  const start = source.indexOf("function clickToContinue(");
  const end = source.indexOf("// On the map screens", start);
  const keysStart = source.indexOf('document.addEventListener("keydown", (event) => {\n  if (document.body.classList.contains("is-home"))');
  const keysEnd = source.indexOf('  if ((busy && !expiring) || !input || event.defaultPrevented', keysStart);
  runInNewContext([
    'const input = {kind:"mousekey"}, session = "test", MOUSE_BUTTONS = [0x100000, 0x400000, 0x200000];',
    "function submitMouseKey(result) { sent.push({result}); }",
    source.slice(start, end),
    source.slice(keysStart, keysEnd), "});",
  ].join("\n"), {
    terminal, state, sent,
    get busy() { return state.busy; }, get expiring() { return state.expiring; },
    document: { body: { classList: { contains: () => false } }, addEventListener: (_: string, handler: (event: object) => void) => documentHandlers.push(handler) },
    Element: class {}, settling: () => state.settling, clientPoint: () => [10, -20],
    backgroundHit: () => state.hit, selectBackground() {}, getSelection: () => null,
  });
  const event = { button: 0, target: null, preventDefault() {}, stopImmediatePropagation() {} };
  const dispatch = (name: string, capture = false, extra = {}) => {
    for (const { handler, capture: registered } of terminalHandlers.get(name) ?? [])
      if (registered === capture) handler({ ...event, ...extra });
  };
  const exercise = () => {
    state.hit = -1;
    dispatch("click");
    state.hit = 7;
    dispatch("click", true);
    dispatch("contextmenu");
    dispatch("auxclick", false, { button: 1 });
    dispatch("wheel", false, { deltaY: -120 });
    documentHandlers[0]!({ ...event, key: "Escape", keyCode: 27 });
  };
  exercise();
  assert.deepEqual(sent.map(({ result }) => result[0]), [1, 1, 1, 1, 2, 3]);
  assert.deepEqual(sent.map(({ result }) => result[1]), [0x100000, 0x100000, 0x200000, 0x400000, 120, 27]);
  assert.equal(sent[1]!.result[4], 7);
  state.expiring = false;
  exercise();
  assert.equal(sent.length, 6);
  state.expiring = true;
  state.settling = true;
  exercise();
  assert.equal(sent.length, 6);
});

test("client dimensions, background scaling and mouse coordinates share game-pixel units", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const terminal = {
    clientWidth: 1200, clientHeight: 800, clientLeft: 2, clientTop: 3, offsetLeft: 10, offsetTop: 20,
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  };
  const handlers = new Map<string, (event: object) => void>();
  const document = {
    hidden: false, hasFocus: () => true, querySelectorAll: () => [canvas],
    addEventListener: (name: string, handler: (event: object) => void) => handlers.set(name, handler),
  };
  const canvas = { dataset: { x: 10, y: -20, width: 600, height: 400 }, style: {} as Record<string, string> };
  const layers = { back: { style: {} }, front: { style: {} } };
  let lineHeight = 38;
  const snippet = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const browser = runInNewContext([
    snippet("function imageScale(", "/** CSS pixels per Emuera pixel across"),
    snippet("function placeBackground(", "/** Shows the CBG layers"),
    snippet("function clientPoint(", "function submitMouseKey("),
    "({ clientState, placeBackground, clientPoint })",
  ].join("\n"), {
    terminal, document, backgroundLayers: layers, metrics: { lineHeight: 19 },
    getComputedStyle: () => ({ lineHeight: String(lineHeight) }),
  });
  assert.equal(JSON.stringify(browser.clientState()), JSON.stringify({ width: 600, height: 400, active: true, mouseX: 0, mouseY: 0 }));
  browser.placeBackground();
  assert.equal(canvas.style.width, "1200px");
  assert.equal(canvas.style.height, "800px");
  assert.equal(canvas.style.left, "20px");
  assert.equal(canvas.style.bottom, "40px");
  assert.equal(JSON.stringify(browser.clientPoint({ clientX: 212, clientY: 623 })), "[100,-100]");
  handlers.get("pointermove")!({ clientX: 212, clientY: 623 });
  assert.equal(browser.clientState().mouseX, 100);
  assert.equal(browser.clientState().mouseY, -100);
  lineHeight = 19;
  assert.equal(browser.clientState().width, 1200);
  assert.equal(browser.clientState().mouseX, 200);
  assert.equal(browser.clientState().mouseY, -200);
  handlers.get("pointerdown")!({ clientX: -8, clientY: 833 });
  assert.equal(browser.clientState().mouseX, -20);
  assert.equal(browser.clientState().mouseY, 10);
  handlers.get("wheel")!({ clientX: 12, clientY: 823 });
  assert.equal(browser.clientState().mouseX, 0);
  assert.equal(browser.clientState().mouseY, 0);
  browser.placeBackground();
  assert.equal(canvas.style.width, "600px");
  document.hidden = true;
  assert.equal(browser.clientState().active, false);
  document.hidden = false;
  document.hasFocus = () => false;
  assert.equal(browser.clientState().active, false);
});

test("graphics replay appends persistent rotations in world coordinates", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("async function paintOps(");
  const end = source.indexOf("/**", start);
  let matrix = [1, 0, 0, 1, 0, 0];
  const saved: number[][] = [];
  const painted: number[][] = [];
  const context = {
    save: () => saved.push(matrix.slice()),
    restore: () => { matrix = saved.pop()!; },
    getTransform: () => Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((key, i) => [key, matrix[i]])),
    setTransform: (...values: number[]) => { matrix = values; },
    transform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      const [ma, mb, mc, md, me, mf] = matrix as [number, number, number, number, number, number];
      matrix = [ma * a + mc * b, mb * a + md * b, ma * c + mc * d, mb * c + md * d, ma * e + mc * f + me, mb * e + md * f + mf];
    },
    translate: (x: number, y: number) => context.transform(1, 0, 0, 1, x, y),
    rotate: (a: number) => context.transform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0),
    fillRect: (x: number, y: number) => painted.push([
      matrix[0]! * x + matrix[2]! * y + matrix[4]!, matrix[1]! * x + matrix[3]! * y + matrix[5]!,
    ].map((value) => Math.round(value))),
  };
  const paint = runInNewContext(`${source.slice(start, end)}\npaintOps`, {
    newCanvas: () => ({ getContext: () => context }),
  });
  await paint({ width: 20, height: 20, ops: [
    { op: "rotate", angle: 90, x: 5, y: 5 },
    { op: "fill", color: "red", rect: [1, 2, 1, 1] },
    { op: "fill", color: "black", rect: [1, 2, 1, 1], absolute: true },
    { op: "rotate", angle: 90, x: 0, y: 0 },
    { op: "fill", color: "blue", rect: [1, 2, 1, 1] },
    { op: "rotate", angle: -90, x: 0, y: 0 },
    { op: "fill", color: "green", rect: [1, 2, 1, 1] },
  ] });
  assert.deepEqual(painted, [[8, 1], [1, 2], [-1, 8], [8, 1]]);
});

test("browser audio applies live volumes, repeat counts, stop/reset and autoplay retries", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("let backgroundAudio =");
  const end = source.indexOf("/** advanceScreen:", start);
  const instances: AudioMock[] = [];
  const messages: string[] = [];
  class AudioMock {
    volume = 1;
    loop = false;
    currentTime = 0;
    plays = 0;
    stops = 0;
    blocked = false;
    listeners = new Map<string, () => void>();
    constructor(public url: string) { instances.push(this); }
    play() {
      this.plays++;
      return this.blocked ? Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" })) : Promise.resolve();
    }
    pause() { this.stops++; }
    load() {}
    removeAttribute() {}
    addEventListener(name: string, handler: () => void) { this.listeners.set(name, handler); }
  }
  const browser = runInNewContext(`${source.slice(start, end)}\n({ useAudioSettings, resetAudio, retryAudio, playAudio })`, {
    Audio: AudioMock, document: { addEventListener() {} }, message: (value: string) => messages.push(value),
  });
  const settings = { soundVolume: 20, bgmVolume: 40, bgm: { id: "bg", url: "/sound/bg.ogg" }, sounds: [{ id: "s", url: "/sound/se.wav", repeat: 2 }], stopSounds: false };
  browser.useAudioSettings(settings);
  const [bgm, sound] = instances as [AudioMock, AudioMock];
  assert.equal(bgm.loop, true);
  assert.equal(bgm.volume, 0.4);
  assert.equal(sound.volume, 0.2);
  browser.useAudioSettings({ ...settings, bgmVolume: 10, soundVolume: 30, sounds: [] });
  assert.equal(instances.length, 2);
  assert.equal(bgm.volume, 0.1);
  assert.equal(sound.volume, 0.3);
  sound.listeners.get("ended")!();
  assert.equal(sound.plays, 2);
  sound.listeners.get("ended")!();
  assert.equal(sound.stops, 1);
  bgm.blocked = true;
  browser.playAudio(bgm);
  await Promise.resolve();
  assert.match(messages[0]!, /blocked.*Click/);
  bgm.blocked = false;
  browser.retryAudio();
  await Promise.resolve();
  assert.equal(bgm.plays, 3);
  browser.useAudioSettings({ ...settings, bgm: null, sounds: [], stopSounds: true });
  assert.equal(bgm.stops, 1);
  browser.useAudioSettings(settings);
  browser.resetAudio();
  assert.ok(instances.slice(2).every((audio) => audio.stops === 1));
});

test("tooltip alignment follows TOOLTIP_FORMAT and resets with custom styling", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("function useTooltipSettings(");
  const end = source.indexOf("/**", start);
  const tooltip = { style: {} as Record<string, string> };
  const useSettings = runInNewContext(`let tooltipSettings;\n${source.slice(start, end)}\nuseTooltipSettings`, { tooltip });
  for (const [format, expected] of [[0, "left"], [1, "center"], [2, "right"]] as const) {
    useSettings({ custom: true, font: "monospace", fontSize: 10, color: "#fff", background: "#000", format });
    assert.equal(tooltip.style.textAlign, expected);
    assert.equal(tooltip.style.fontSize, "10px");
  }
  useSettings({ custom: false, format: 2 });
  assert.equal(tooltip.style.textAlign, "");
  useSettings(null);
  assert.equal(tooltip.style.fontSize, "");
});

class Element {
  nodeType = 1;
  children: Element[] = [];
  parent?: Element;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  classes = new Set<string>();
  classList = { add: (name: string) => this.classes.add(name) };
  constructor(public tagName: string, private attrs = new Map<string, string>(), public textContent = "") {}
  get childNodes() { return this.children; }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string) { return this.attrs.has(name); }
  append(child: Element) { child.parent = this; this.children.push(child); }
  matches() { return false; }
  closest(): Element { return this.parent ? this.parent.closest() : this; }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap((child) => [
      ...(selector === ".html-positioned" && child.classes.has("html-positioned") ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  get width(): number {
    return Number.parseFloat(this.style.width ?? "") || this.children.reduce((sum, child) =>
      sum + child.width + Number.parseFloat(child.style.marginLeft ?? "0"), 0);
  }
  getBoundingClientRect(): { left: number } {
    if (!this.parent) return { left: 40 };
    const siblings = this.parent.children.slice(0, this.parent.children.indexOf(this));
    return { left: this.parent.getBoundingClientRect().left
      + siblings.reduce((sum, child) => sum + child.width + Number.parseFloat(child.style.marginLeft ?? "0"), 0)
      + Number.parseFloat(this.style.marginLeft ?? "0") };
  }
}
function parsed(node: DefaultTreeAdapterMap["node"]): Element {
  const result = new Element(node.nodeName.toUpperCase(),
    new Map("attrs" in node ? node.attrs.map(({ name, value }) => [name, value]) : []));
  if ("value" in node) { result.nodeType = 3; result.textContent = node.value; result.style.width = `${node.value.length * 10}px`; }
  if ("childNodes" in node) node.childNodes.forEach((child) => result.append(parsed(child)));
  return result;
}

test("HTML pos stacks unequal image layers, resets the cursor and remains stable across renders", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const functionSource = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const terminal = new Element("DIV");
  const { renderHtml, layoutHtmlPositions } = runInNewContext([
    functionSource("function sizeAttribute(", "async function loadImage("),
    functionSource("function layoutHtmlPositions(", "/**"),
    functionSource("async function renderHtml(", "// A browser's page translator"),
    "({ renderHtml, layoutHtmlPositions })",
  ].join("\n"), {
    terminal, Element, Node: { TEXT_NODE: 3 }, generation: 0,
    MutationObserver: class { observe() {} },
    metrics: { fontSize: 20 }, imageScale: () => 1.5,
    DOMParser: class { parseFromString(markup: string) { return { head: { children: [] }, body: parsed(parseFragment(markup)) }; } },
    document: { createElement: (tag: string) => new Element(tag), createTextNode: (text: string) => parsed({ nodeName: "#text", value: text, parentNode: null }) },
    allowedTags: new Set(["NOBR", "NONBUTTON", "SPAN"]),
    image: async (node: Element) => {
      const image = new Element("SPAN");
      image.style.width = `${Number(node.getAttribute("width"))}px`;
      return image;
    },
    applyClasses() {}, decorateLabel() {}, choice: () => new Element("BUTTON"),
  });

  await renderHtml("<nobr>prefix<nonbutton pos='100'><img width='90'></nonbutton><nonbutton pos='100'><img width='60'></nonbutton><button pos='100' value='7'><img width='120'></button>tail", terminal);
  const positioned = terminal.querySelectorAll(".html-positioned");
  assert.equal(positioned.length, 3);
  assert.deepEqual(positioned.map((element) => element.dataset.htmlPosition), ["30", "30", "30"]);
  const check = () => {
    layoutHtmlPositions();
    assert.deepEqual(positioned.map((element) => element.getBoundingClientRect().left), [70, 70, 70]);
    assert.equal(terminal.children[0]!.children.at(-1)!.getBoundingClientRect().left, 190);
  };
  check();
  check();
  positioned[0]!.children[0]!.style.width = "180px";
  check();
  await renderHtml("<nobr><nonbutton pos='0'><img width='10'></nonbutton><nonbutton pos='400'><img width='20'></nonbutton><nonbutton pos='-100'><img width='30'></nonbutton>", terminal);
  layoutHtmlPositions();
  assert.deepEqual(terminal.querySelectorAll(".html-positioned").slice(-3).map((element) => element.getBoundingClientRect().left),
    [40, 160, 10]);
  await assert.rejects(renderHtml("<nonbutton pos='bad'>x</nonbutton>", terminal), /Unsupported HTML position/);
});

test("translated menu labels re-align locked borders after text and wrapper mutations", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("function layoutHtmlPositions(");
  const end = source.indexOf("/**", start);
  const terminal = new Element("DIV");
  const line = new Element("DIV");
  terminal.append(line);
  const label = new Element("SPAN");
  label.style.width = "80px";
  line.append(label);
  const border = new Element("SPAN");
  border.classes.add("html-positioned");
  border.dataset.htmlPosition = "200";
  border.style.width = "10px";
  line.append(border);
  let changed: (() => void) | undefined;
  let observed: unknown;
  const frames: (() => void)[] = [];
  const layout = runInNewContext(`${source.slice(start, end)}\nlayoutHtmlPositions`, {
    terminal,
    requestAnimationFrame: (callback: () => void) => { frames.push(callback); return frames.length; },
    MutationObserver: class {
      constructor(callback: () => void) { changed = callback; }
      observe(target: unknown, options: unknown) { assert.equal(target, terminal); observed = options; }
    },
  });
  assert.equal(JSON.stringify(observed), JSON.stringify({ childList: true, characterData: true, subtree: true }));
  layout();
  assert.equal(border.getBoundingClientRect().left, 240);
  // Translators expand text and may insert wrappers after the initial render.
  label.style.width = "150px";
  assert.equal(border.getBoundingClientRect().left, 310);
  changed!();
  changed!();
  assert.equal(frames.length, 1);
  frames.shift()!();
  assert.equal(border.getBoundingClientRect().left, 240);
  label.style.width = "35px";
  changed!();
  frames.shift()!();
  assert.equal(border.getBoundingClientRect().left, 240);
  layout();
  assert.equal(border.getBoundingClientRect().left, 240);
});
