import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const resetSource = source.slice(source.indexOf("async function resetSettings()"),
  source.indexOf('document.querySelector("#settings-reset").addEventListener'));

function harness({ debug = false, busy = false, confirm = true } = {}) {
  const defaults = { font: "Game Font", foreground: "#c0c0c0", background: "#000000", selection: "#ffff00" };
  const storage = new Map([
    ["settings", JSON.stringify({ font: "Game Fon", fontSize: 24 })],
    ["auto", "0"], ["debug", "1"], ["llm", "saved credentials"],
  ]);
  const output = { clipboard: true, local: true, endpoint: "http://localhost:9999/v1", model: "my-model", language: "French" };
  const calls: string[] = [];
  const errors: string[] = [];
  const state = {
    gameDefaults: defaults, settings: { ...defaults, font: "Game Fon", fontSize: 24 },
    session: "active", input: {}, runDebug: debug, busy, runMode: "game", runGame: "tw",
    SETTINGS_KEY: "settings", AUTO_ADVANCE_KEY: "auto", DEBUG_KEY: "debug",
    localStorage: { removeItem: (key: string) => { storage.delete(key); } },
    controllerMenu: { reset: () => calls.push("controller") },
    autoAdvanceToggle: { checked: true },
    autoAdvance: { update: () => calls.push("auto") },
    characterHistory: { reset: () => calls.push("history") },
    outputTools: { configure: (values: Partial<typeof output>) => { Object.assign(output, values); } },
    translation: { setEnabled: (value: unknown) => { assert.equal(value, undefined); calls.push("translation"); } },
    debugButton: { checked: debug }, debugPanel: { hidden: !debug },
    applySettings: (force: boolean) => { assert.equal(force, true); calls.push("display"); },
    start: async (_mode: string, _game: string, enabled: boolean) => { assert.equal(enabled, false); calls.push("restart"); },
    confirmAction: async () => { calls.push("confirm"); return confirm; },
    runName: () => "Game",
    message: (text: string) => errors.push(text),
  };
  const reset = runInNewContext(`${resetSource}\nresetSettings`, state);
  return { reset, state, storage, output, calls, errors };
}

test("Reset all restores display settings without erasing model configuration", async () => {
  const h = harness();
  await h.reset();
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.settings)), h.state.gameDefaults);
  assert.equal("fontSize" in h.state.settings, false);
  assert.equal(h.storage.has("settings"), false);
  assert.equal(h.storage.has("auto"), false);
  assert.equal(h.storage.has("debug"), false);
  assert.equal(h.storage.get("llm"), "saved credentials");
  assert.deepEqual(h.output, { clipboard: false, local: false, endpoint: "http://localhost:9999/v1", model: "my-model", language: "French" });
  assert.equal(h.state.autoAdvanceToggle.checked, false);
  assert.equal(h.state.debugButton.checked, false);
  assert.deepEqual(h.calls, ["controller", "auto", "history", "translation", "display"]);
});

test("Reset all confirms debug restart before changing anything and respects cancellation", async () => {
  const cancelled = harness({ debug: true, confirm: false });
  const before = [...cancelled.storage];
  await cancelled.reset();
  assert.deepEqual([...cancelled.storage], before);
  assert.equal(cancelled.output.local, true);
  assert.deepEqual(cancelled.calls, ["confirm"]);
  const accepted = harness({ debug: true });
  await accepted.reset();
  assert.equal(accepted.calls[0], "confirm");
  assert.equal(accepted.calls.at(-1), "restart");
});

test("Reset all refuses to restart a busy debug run without partially resetting settings", async () => {
  const h = harness({ debug: true, busy: true });
  await h.reset();
  assert.equal(h.storage.has("settings"), true);
  assert.equal(h.output.local, true);
  assert.deepEqual(h.calls, []);
  assert.match(h.errors[0]!, /Wait for the current command/);
});

test("built-in translation reset returns to browser/language defaults", () => {
  const translationSource = readFileSync(new URL("../web/translate.js", import.meta.url), "utf8")
    .replace(/^import .+;\n/gm, "").replace(/^export /gm, "");
  for (const [supported, language, expected] of [
    [true, "en-US", true], [true, "ja-JP", false], [false, "en-US", false],
  ] as const) {
    let stored: string | null = expected ? "off" : "on";
    let notified: boolean | undefined;
    const context = {
      ...(supported ? { Translator: {} } : {}),
      navigator: { language }, LruCache: class {},
      localStorage: {
        getItem: () => stored,
        setItem: (_key: string, value: string) => { stored = value; },
        removeItem: () => { stored = null; },
      },
    };
    const create = runInNewContext(`${translationSource}\ncreateTranslation`, context);
    const translation = create({ onChange: ({ enabled }: { enabled: boolean }) => { notified = enabled; } });
    translation.setEnabled(undefined);
    assert.equal(stored, null);
    assert.equal(translation.enabled(), expected);
    assert.equal(notified, expected);
  }
});

test("reset display refreshes even a focused damaged font field", () => {
  const applySource = source.slice(source.indexOf("function applySettings("), source.indexOf("function updateSetting("));
  const fields = {
    font: { value: "Game Fon" }, foreground: { value: "" }, background: { value: "" }, selection: { value: "" },
  };
  const properties = new Map<string, string>();
  const apply = runInNewContext(`${applySource}\napplySettings`, {
    settings: { font: "Game Font", foreground: "#c0c0c0", background: "#000000", selection: "#ffff00" },
    document: {
      activeElement: fields.font,
      documentElement: { style: { setProperty: (name: string, value: string) => properties.set(name, value) } },
      querySelector: () => ({ elements: fields }),
    },
    terminalColumns() {}, fitMoveMaps() {},
  });
  apply();
  assert.equal(fields.font.value, "Game Fon", "ordinary updates preserve typing");
  apply(true);
  assert.equal(fields.font.value, "Game Font");
  assert.equal(properties.has("--font-size"), false);
});

test("saved display settings ignore obsolete font size and persist only supported fields", () => {
  const start = source.indexOf("function savedSettings()");
  const end = source.indexOf("function displaySettings()", start);
  let stored = JSON.stringify({ font: "Game Font", fontSize: 24, foreground: "#abcdef", arbitrary: "ignored" });
  const load = runInNewContext(`${source.slice(start, end)}\nsavedSettings`, {
    SETTINGS_KEY: "settings", localStorage: { getItem: () => stored },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(load())), { font: "Game Font", foreground: "#abcdef" });
  for (const value of ["null", "[]", "invalid", '{"font":12,"fontSize":20}']) {
    stored = value;
    assert.deepEqual(JSON.parse(JSON.stringify(load())), {});
  }
});
