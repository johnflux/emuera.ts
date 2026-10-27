import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyGame, indexScript } from "../src/loader.js";
import { patchTitleImage } from "../src/render-patches.js";
import type { Output, Snapshot, Style } from "../src/runtime.js";

const style: Style = { color: "#fff", background: "#000", alignment: "left", fontStyle: 0 };
test("Blue Resort Discord button becomes a direct new-tab link without mutating runtime output", () => {
  const game = emptyGame();
  indexScript(game, '@SYSTEM_TITLE\nCALLSHARP LAUNCH_BROWSER("https://discord.gg/zCWzA8kbgp")', "title.ERB");
  const snapshot: Snapshot = { status: "waiting", input: { kind: "integer" }, error: null, title: "", target: 0,
    output: [{ type: "button", text: "[100] Discord Server (Opens browser)", value: "100", style }] };
  const original = structuredClone(snapshot);
  const patched = patchTitleImage(game, snapshot);
  assert.deepEqual(patched.output, [{ type: "html", text: '<a href="https://discord.gg/zCWzA8kbgp" target="_blank" rel="noopener noreferrer">[100] Discord Server</a>', newline: false, style }]);
  assert.deepEqual(snapshot, original);
  assert.deepEqual(patchTitleImage(emptyGame(), snapshot), snapshot);
});
function fixture() {
  const game = emptyGame();
  const output: Output[] = [];
  for (let i = 0; i < 35; i++) {
    const name = `TW_title${String(i).padStart(3, "0")}`;
    game.sprites.set(name.toUpperCase(), { file: "title.webp", x: 0, y: i * 16, width: 1041, height: 16 });
    output.push({ type: "html", text: `<p align='center'><img src='${name}'></p>`, newline: true, style: { ...style } });
  }
  const snapshot: Snapshot = { status: "waiting", input: { kind: "integer" }, error: null, title: "title", output };
  return { game, snapshot };
}
test("title presentation becomes one cropped image without modifying runtime output or metadata", () => {
  const { game, snapshot } = fixture();
  const original = structuredClone(snapshot);
  const patched = patchTitleImage(game, snapshot);
  assert.equal(patched.output.length, 1);
  const image = patched.output[0]!;
  assert.equal(image.type, "title-image");
  if (image.type !== "title-image") assert.fail();
  assert.equal(image.lines, 35);
  assert.deepEqual(image.sprite, { file: "title.webp", x: 0, y: 0, width: 1041, height: 560, url: "/resources/title.webp" });
  assert.deepEqual(snapshot, original);
  assert.deepEqual(patched.input, snapshot.input);
  assert.equal(patched.status, snapshot.status);
});
test("partial, reordered, altered, mixed-content and styled title sequences are not patched", () => {
  for (const change of [
    (s: Snapshot) => { s.output.pop(); },
    (s: Snapshot) => { s.output.reverse(); },
    (s: Snapshot) => { s.output[3] = { type: "text", text: "intervening", newline: true, style }; },
    (s: Snapshot) => { const item = s.output[3]!; if (item.type === "html") item.text += "text"; },
    (s: Snapshot) => { const item = s.output[3]!; if (item.type === "html") item.text = "<img src='TW_title003'><img src='TW_title004'>"; },
    (s: Snapshot) => { const item = s.output[3]!; if (item.type === "html") item.newline = false; },
    (s: Snapshot) => { const item = s.output[3]!; if (item.type === "html") item.style.color = "#f00"; },
    (s: Snapshot) => { s.output.unshift({ type: "text", text: "unfinished", newline: false, style }); },
  ]) {
    const { game, snapshot } = fixture();
    change(snapshot);
    assert.deepEqual(patchTitleImage(game, snapshot).output, snapshot.output);
  }
});
test("resource changes disable optimization and surrounding text/clear events stay intact", () => {
  const { game, snapshot } = fixture();
  game.sprites.get("TW_TITLE004")!.y++;
  assert.deepEqual(patchTitleImage(game, snapshot).output, snapshot.output);
  game.sprites.get("TW_TITLE004")!.y--;
  const text: Output = { type: "text", text: "before", newline: true, style };
  const clear: Output = { type: "clear", count: 4 };
  snapshot.output.unshift(text);
  snapshot.output.push(clear);
  assert.deepEqual(patchTitleImage(game, snapshot).output.map((item) => item.type), ["text", "title-image", "clear"]);
});
