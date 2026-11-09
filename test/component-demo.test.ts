import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { COMPONENT_SAMPLES, componentGame, isComponentSample, startComponent } from "../src/component-demo.js";
import { GAME_ROOT, applyHotpatches, emptyGame, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime } from "../src/runtime.js";

test("button catalog calls the production helper and leaves the original game unchanged", async () => {
  const game = emptyGame();
  const [commands, attributes] = await Promise.all([
    readFile(new URL("../hotpatch/MAIN_SCREEN_COMMANDS.ERB", import.meta.url), "utf8"),
    readFile(new URL("../hotpatch/INFO_PALAM.ERB", import.meta.url), "utf8"),
  ]);
  indexScript(game, commands.slice(commands.indexOf("@HOTPATCH_BUTTON(")), "<production-buttons>");
  indexScript(game, attributes.slice(attributes.indexOf("@HOTPATCH_ATTRIBUTE(")), "<production-attributes>");
  indexScript(game, `@SYSTEM_TITLE
PRINTL Original title`, "<original>");
  const title = game.routines.get("SYSTEM_TITLE");
  const preview = componentGame(game, "buttons");
  const runtime = new Runtime(preview);
  const snapshot = startComponent(runtime, "buttons");
  assert.equal(snapshot.error, null);
  assert.equal(snapshot.status, "waiting");
  const html = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
  for (const variant of ["block", "primary", "list"])
    assert.ok(html.includes(`era-button-${variant} `), variant);
  for (const value of [100, 102, 103])
    assert.equal((html.match(new RegExp(`value='${value}'`, "g")) ?? []).length, 1, "helper variants are not repeated for disabled states");
  assert.match(html, /data-command-number='100'/);
  assert.doesNotMatch(html, /title='Production HOTPATCH_BUTTON'/);
  assert.match(html, /era-component-path/);
  assert.match(html, /<code>\.era-button<\/code>/);
  assert.match(html, /\[data-suffix=&quot;›&quot;\]/);
  assert.doesNotMatch(html, /era-component-state/);
  assert.doesNotMatch(html, /ui-button/);
  assert.equal(game.routines.get("SYSTEM_TITLE"), title);
  assert.notEqual(preview.routines, game.routines);
  assert.equal(runtime.input("100").status, "waiting", "clicking redisplays the fixture");
  assert.throws(() => componentGame(emptyGame(), "buttons"), /requires eraTW/);
  assert.equal(isComponentSample("unknown"), false);
  assert.equal(isComponentSample(null), false);
});

test("all game catalog scenes render their actual production surfaces", { skip: !existsSync(GAME_ROOT) }, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const originalTitle = game.routines.get("SYSTEM_TITLE");
  const expected: Record<string, RegExp> = {
    buttons: /era-button-block/,
    main: /era-main-actions/,
    alone: /era-main-actions/,
    "time-stopped": /era-main-actions/,
    sleep: /era-layout era-shop/,
    inventory: /era-dialog era-inventory/,
    sheet: /era-dialog era-sheet/,
    calendar: /era-dialog era-calendar/,
    map: /era-card era-move-side/,
    relationships: /era-chip-button/,
  };
  for (const sample of COMPONENT_SAMPLES) {
    const snapshot = startComponent(new Runtime(componentGame(game, sample), GAME_INSTRUCTION_LIMIT), sample);
    assert.equal(snapshot.status, "waiting", sample);
    assert.equal(snapshot.error, null, sample);
    const html = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
    assert.match(html, expected[sample]!, sample);
  }
  assert.equal(game.routines.get("SYSTEM_TITLE"), originalTitle);
});
