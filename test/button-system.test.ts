import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { GAME_BUTTON_SAMPLES } from "../src/button-samples.js";
import { styleSource } from "./style-source.js";

test("shared game buttons use baseline alignment and compact spacing", () => {
  const css = styleSource("style");
  assert.match(css, /button\.choice\.era-button \{[^}]*align-items: baseline;[^}]*gap: \.2em;[^}]*padding: 4px 9px;/);
});

test("every explicit game button style has a catalog fixture", async () => {
  const css = (await Promise.all(["_button-variants.scss", "_radio.scss"].map(file =>
    readFile(new URL(`../styles/game/${file}`, import.meta.url), "utf8")))).join("\n");
  const helper = await readFile(new URL("../src/component-demo.ts", import.meta.url), "utf8");
  const fixtures = GAME_BUTTON_SAMPLES.map(sample => sample.html).join("\n") + helper;
  const helperClasses = new Set(["era-button", "era-button-block", "era-button-primary", "era-button-list", "era-button-suffix", "era-config-label",
    "era-radio-name", "era-radio-description"]);
  for (const match of css.matchAll(/\.((?:era-)[a-zA-Z0-9_-]+)/g))
    assert.ok(helperClasses.has(match[1]!) || fixtures.includes(match[1]!), `Missing button fixture: ${match[1]}`);
});

test("game panels do not declare button appearance or inherited button themes", async () => {
  const directory = new URL("../styles/game/", import.meta.url);
  const files = await readdir(directory);
  const buttonClasses = new Set(["choice", ...GAME_BUTTON_SAMPLES.flatMap(sample =>
    sample.html.match(/^<[^>]*class=['"]([^'"]*)/)?.[1]?.split(/\s+/).find(name => name.startsWith("era-")) ?? [])]);
  const control = new RegExp(`\\bbutton\\b|\\.(?:${[...buttonClasses].join("|")})(?![\\w-])`);
  const violations: string[] = [];
  const visual = /(?:^|;)\s*(?:padding(?:-[a-z]+)?|border(?:-[a-z]+)?|background(?:-[a-z]+)?|color|font(?:-[a-z]+)?|text-align|text-shadow|box-shadow|--button-[a-z-]+|--relationship-button[a-z-]*)\s*:/;
  for (const file of files.filter(file => file.endsWith(".scss") && !["_button-variants.scss", "_radio.scss"].includes(file))) {
    const css = (await readFile(new URL(file, directory), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1]!.trim(), body = match[2]!;
      if (control.test(selector) && visual.test(body)) {
        // A panel may style itself in response to a button state; it may not style the control.
        const withoutConditions = selector.replace(/:has\([^{}]*\)/g, "");
        if (control.test(withoutConditions))
          violations.push(`${file}: move button appearance to the explicit variant stylesheet: ${selector}`);
      }
      assert.doesNotMatch(body, /--(?:button-[a-z-]+|relationship-button[a-z-]*)\s*:/, `${file}: inherited button theme`);
    }
  }
  assert.deepEqual(violations, []);
  assert.doesNotMatch(styleSource("style"), /\.era-(?:main|player|move-side|inventory|launch-actions)\s+[^{}]*button[^{}]*\{\s*(?:padding|border|background|color|font)/);
});
