import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { COMPONENT_SAMPLES, componentGame, isComponentSample, startComponent } from "../src/component-demo.js";
import { GAME_ROOT, applyHotpatches, emptyGame, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime } from "../src/runtime.js";

test("button catalog calls the production helper and leaves the original game unchanged", async () => {
  const game = emptyGame();
  const [commands, attributes, headings] = await Promise.all([
    readFile(new URL("../hotpatch/MAIN_SCREEN_COMMANDS.ERB", import.meta.url), "utf8"),
    readFile(new URL("../hotpatch/INFO_PALAM.ERB", import.meta.url), "utf8"),
    readFile(new URL("../hotpatch/SECTION_HEADING.ERB", import.meta.url), "utf8"),
  ]);
  indexScript(game, commands.slice(commands.indexOf("@HOTPATCH_BUTTON(")), "<production-buttons>");
  indexScript(game, attributes.slice(attributes.indexOf("@HOTPATCH_ATTRIBUTE(")), "<production-attributes>");
  indexScript(game, headings, "<production-headings>");
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
  for (const direction of ["give", "receive", "both"])
    assert.match(html, new RegExp(`era-button era-action-${direction}`));
  assert.doesNotMatch(html, /title='Production HOTPATCH_BUTTON'/);
  assert.match(html, /era-component-path/);
  assert.match(html, /era-section-title era-section-heading/);
  assert.match(html, /<code>\.era-button<\/code>/);
  assert.match(html, /\[data-suffix=&quot;›&quot;\]/);
  assert.doesNotMatch(html, /era-component-state/);
  assert.doesNotMatch(html, /ui-button/);
  assert.match(html, /class='era-radio' role='radio' aria-checked='false'/);
  assert.match(html, /class='era-radio era-current' role='radio' aria-checked='true'/);
  assert.match(html, /role='radiogroup' aria-label='Home example'/);
  assert.match(html, /value='9102'[^>]*aria-disabled='true'/);
  assert.match(html, /<code>\.choice<\/code>/);
  for (const component of ["era-actions-header", "era-actions-collection", "era-actions-panel"])
    assert.match(html, new RegExp(`<code>\\.${component}</code>`));
  assert.doesNotMatch(html, /class='era-main'/);
  const nativeChoices = snapshot.output.filter(item => item.type === "text" && item.text.includes("Choice "));
  assert.equal(nativeChoices.length, 8);
  assert.ok(nativeChoices.every(item => "newline" in item && !item.newline));
  const selected = runtime.input("9101");
  assert.equal(selected.error, null);
  const selectedHtml = selected.output.flatMap(item => item.type === "html" ? [item.text] : []).join("");
  assert.match(selectedHtml, /value='9101' class='era-radio era-current' role='radio' aria-checked='true'/);
  assert.match(selectedHtml, /value='9100' class='era-radio' role='radio' aria-checked='false'/);
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
    main: /era-actions-collection/,
    alone: /era-actions-collection/,
    "time-stopped": /era-actions-collection/,
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
    if (sample === "main" || sample === "time-stopped") {
      let category = "";
      let previousDirection = -1;
      for (const item of snapshot.output) {
        if (item.type !== "html") continue;
        const heading = item.text.match(/class='era-actions-title'>([^<]+)</);
        if (heading) { category = heading[1]!; previousDirection = -1; }
        if (item.text.includes("class='era-action-direction-group'")) {
          assert.equal(category, "Intimate", "only Intimate has direction subgroups");
        }
        const label = item.text.match(/class='era-action-group-label'>([^<]+)</);
        if (label) {
          const direction = ["Give", "Receive"].indexOf(label[1]!);
          assert.ok(direction > previousDirection, "subgroups follow Give, Receive, Both order");
          previousDirection = direction;
        }
      }
    }
    const boxes: string[] = [];
    for (const item of snapshot.output) {
      if (item.type !== "html") continue;
      if (item.text.startsWith("<era-open ")) {
        const classes = /class='([^']+)'/.exec(item.text)?.[1];
        assert.ok(classes, `${sample}: opening marker needs classes`);
        if (["era-main-header", "era-main-left", "era-main-center", "era-main-right"].includes(classes)
          && sample !== "sleep")
          assert.equal(boxes.at(-1), "era-layout era-main", `${sample}: ${classes} must remain inside main`);
        boxes.push(classes);
      } else if (item.text === "<era-close>") {
        assert.ok(boxes.length, `${sample}: closing marker needs an open container`);
        boxes.pop();
      }
    }
    assert.deepEqual(boxes, [], `${sample}: all production layout containers must close before input`);
  }
  assert.equal(game.routines.get("SYSTEM_TITLE"), originalTitle);
});

test("radio helper escapes labels and descriptions and exposes selected and unavailable states", async () => {
  const game = emptyGame();
  const source = await readFile(new URL("../hotpatch/MAIN_SCREEN_COMMANDS.ERB", import.meta.url), "utf8");
  indexScript(game, source.slice(source.indexOf("@HOTPATCH_RADIO(")), "<production-radios>");
  indexScript(game, `@SYSTEM_TITLE
HTML_PRINT HOTPATCH_RADIO(12, "<Home> & away", 1, "<b>Not markup</b>", 0)
INPUT`, "<radio-test>");
  const snapshot = new Runtime(game).start();
  assert.equal(snapshot.error, null);
  const html = snapshot.output.flatMap(item => item.type === "html" ? [item.text] : []).join("");
  assert.match(html, /role='radio' aria-checked='true' aria-disabled='true'/);
  assert.match(html, /&lt;Home&gt; &amp; away/);
  assert.match(html, /&lt;b&gt;Not markup&lt;\/b&gt;/);
  assert.doesNotMatch(html, /aria-pressed|<b>/);
});
