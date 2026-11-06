import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../web/interaction-history.js", import.meta.url), "utf8")
  .replace(/^import .+;\n/gm, "").replace(/^export /gm, "");

test("character history defaults off for Steam but respects saved choices on every platform", () => {
  for (const { steam, saved, expected } of [
    { steam: false, saved: null, expected: true },
    { steam: true, saved: null, expected: false },
    { steam: false, saved: "0", expected: false },
    { steam: true, saved: "1", expected: true },
  ]) {
    let stored = saved;
    let pressed = "";
    let click = () => {};
    let changes = 0;
    const api = runInNewContext(`${source}\n({characterHistoryEnabled, setupCharacterHistoryToggle})`, {
      eraDesktop: { steam },
      localStorage: {
        getItem: () => stored,
        setItem(key: string, value: string) {
          assert.equal(key, "era-typescript.character-history");
          stored = value;
        },
      },
      document: {
        querySelector: () => ({
          setAttribute: (_name: string, value: string) => { pressed = value; },
          addEventListener: (_name: string, listener: () => void) => { click = listener; },
        }),
      },
    });
    assert.equal(api.characterHistoryEnabled(), expected);
    api.setupCharacterHistoryToggle(() => { changes++; });
    assert.equal(pressed, String(expected));
    click();
    assert.equal(api.characterHistoryEnabled(), !expected);
    assert.equal(stored, expected ? "0" : "1");
    assert.equal(changes, 1);
  }
});

test("disabling history disposes and removes panels; enabling recreates from the existing history", () => {
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const start = app.indexOf("function showCharacterHistory(");
  const end = app.indexOf("function showReport(", start);
  assert.ok(start >= 0 && end > start);
  let enabled = false;
  let disposed = 0;
  let removed = 0;
  let created = 0;
  const history = { character: { id: 7 } };
  const parent = {};
  const host = { remove: () => { removed++; } };
  const root = { querySelectorAll: (selector: string) => selector === ".era-main-chat" ? [host] : [parent] };
  const show = runInNewContext(`${app.slice(start, end)}\nshowCharacterHistory`, {
    terminal: root, outputRoot: root,
    characterHistoryEnabled: () => enabled,
    disposeCharacterChats: (target: unknown) => { assert.equal(target, root); disposed++; },
    setupInlineChat: (target: unknown, supplied: unknown) => {
      assert.equal(target, parent);
      assert.equal(supplied, history);
      created++;
    },
    command: {}, runGame: "tw", runMode: "game", gameTitle: () => "TW", refreshScreen: () => {},
  });
  show(history);
  assert.equal(disposed, 1);
  assert.equal(removed, 1);
  assert.equal(created, 0);
  enabled = true;
  show(history);
  assert.equal(created, 1);
  assert.equal(disposed, 1);
  show(null);
  assert.equal(created, 1);
});
