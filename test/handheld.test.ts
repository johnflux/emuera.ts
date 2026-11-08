import { styleSource } from "./style-source.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { once } from "node:events";
import { createApp } from "../src/server.js";

const source = readFileSync(new URL("../web/controls.js", import.meta.url), "utf8").replace(/^export /gm, "")
  + "\n" + readFileSync(new URL("../web/handheld.js", import.meta.url), "utf8").replace(/^import .+;\n/gm, "").replace(/^export /gm, "");

test("server serves handheld module and stylesheet with their correct content types", async () => {
  const app = createApp([]);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  try {
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    for (const [asset, contentType] of [["handheld.js", "javascript"], ["handheld.css", "text/css"]]) {
      const response = await fetch(`http://127.0.0.1:${address.port}/${asset}`);
      assert.equal(response.status, 200);
      assert.ok(response.headers.get("content-type")?.includes(contentType!));
      const path = asset.endsWith(".css") ? `../web/generated/${asset}` : `../web/${asset}`;
      assert.equal(await response.text(), readFileSync(new URL(path, import.meta.url), "utf8"));
    }
  } finally {
    await new Promise<void>((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});

test("handheld layout defaults on for Deck or touch and preserves explicit preferences", () => {
  for (const { deck, saved, expected, coarse = false, touchPoints = 0 } of [
    { deck: false, saved: null, expected: false },
    { deck: true, saved: null, expected: true },
    { deck: true, saved: "0", expected: false },
    { deck: false, saved: "1", expected: true },
    { deck: false, saved: null, coarse: true, expected: true },
    { deck: false, saved: null, touchPoints: 5, expected: true },
    { deck: false, saved: "0", coarse: true, touchPoints: 5, expected: false },
    { deck: true, saved: "0", coarse: true, expected: false },
  ]) {
    let click = () => {};
    let stored = saved;
    let applied = false;
    let checked = false;
    let changes = 0;
    const setup = runInNewContext(`${source}\nsetupHandheld`, {
      eraDesktop: { handheld: deck },
      navigator: { maxTouchPoints: touchPoints },
      matchMedia: (query: string) => {
        assert.equal(query, "(any-pointer: coarse)");
        return { matches: coarse };
      },
      localStorage: {
        getItem: () => stored,
        setItem(key: string, value: string) {
          assert.equal(key, "era-typescript.handheld");
          stored = value;
        },
        removeItem: () => { stored = null; },
      },
      document: {
        body: { classList: { toggle: (_name: string, value: boolean) => { applied = value; } } },
        querySelector: () => ({
          set checked(value: boolean) { checked = value; },
          addEventListener: (_name: string, handler: () => void) => { click = handler; },
        }),
      },
    });
    const layout = setup(() => { changes++; });
    assert.equal(layout.enabled(), expected);
    assert.equal(applied, expected);
    assert.equal(checked, expected);
    click();
    assert.equal(layout.enabled(), !expected);
    assert.equal(applied, !expected);
    assert.equal(stored, expected ? "0" : "1");
    assert.equal(changes, 1);
    layout.reset();
    assert.equal(stored, null);
    assert.equal(layout.enabled(), deck || coarse || touchPoints > 0);
    assert.equal(checked, layout.enabled());
    assert.equal(changes, 2);
  }
});

test("directional navigation follows rows and columns and stops at the edge", () => {
  const next = runInNewContext(`${source}\ndirectionalTarget`);
  const grid = [{ left: 0, top: 0 }, { left: 80, top: 0 }, { left: 0, top: 60 }, { left: 80, top: 60 }]
    .map((rect) => ({ ...rect, width: 40, height: 40 }));
  assert.equal(next(grid, 0, "ArrowRight"), 1);
  assert.equal(next(grid, 0, "ArrowDown"), 2);
  assert.equal(next(grid, 3, "ArrowUp"), 1);
  assert.equal(next(grid, 3, "ArrowLeft"), 2);
  assert.equal(next(grid, 0, "ArrowLeft"), -1);
  assert.equal(next(grid, -1, "ArrowDown"), 0);
  assert.equal(next(grid, -1, "ArrowUp"), 3);
});

test("unequal-width demo choices follow their visual row instead of diagonal centers", () => {
  const next = runInNewContext(`${source}\ndirectionalTarget`);
  const rects = [
    { left: 12, top: 279, width: 240 }, { left: 252, top: 279, width: 160 },
    { left: 412, top: 279, width: 390 }, { left: 802, top: 279, width: 220 },
    { left: 12, top: 315, width: 250 }, { left: 262, top: 315, width: 340 },
    { left: 602, top: 315, width: 270 }, { left: 872, top: 315, width: 270 },
    { left: 12, top: 351, width: 80 },
  ].map((rect) => ({ ...rect, height: 36 }));
  for (const row of [[0, 1, 2, 3], [4, 5, 6, 7]]) {
    for (let index = 0; index < row.length; index++) {
      assert.equal(next(rects, row[index], "ArrowLeft"), row[index - 1] ?? -1);
      assert.equal(next(rects, row[index], "ArrowRight"), row[index + 1] ?? -1);
    }
  }
  assert.equal(next(rects, 0, "ArrowDown"), 4);
  assert.equal(next(rects, 1, "ArrowDown"), 5);
  assert.equal(next(rects, 2, "ArrowDown"), 5);
  assert.equal(next(rects, 3, "ArrowDown"), 6);
  assert.equal(next(rects, 4, "ArrowUp"), 0);
  assert.equal(next(rects, 6, "ArrowDown"), 8);
  assert.equal(next(rects, 8, "ArrowRight"), 5);
});

test("vertical navigation stays in its column before considering another panel", () => {
  const next = runInNewContext(`${source}\ndirectionalTarget`);
  const rects = [
    { left: 0, top: 0, width: 60, height: 36 },
    { left: 200, top: 40, width: 100, height: 36 },
    { left: 0, top: 100, width: 60, height: 36 },
  ];
  assert.equal(next(rects, 0, "ArrowDown"), 2);
  assert.equal(next(rects, 2, "ArrowUp"), 0);
  assert.equal(next(rects, 1, "ArrowDown"), 2);
});

test("Achievements moves down to Music Collection instead of Automatic Item Use", () => {
  const next = runInNewContext(`${source}\ndirectionalTarget`);
  const rects = [
    { left: 52, top: 228, width: 310, height: 42 },
    { left: 1196, top: 279, width: 406, height: 43 },
    { left: 52, top: 319, width: 373, height: 42 },
    { left: 438, top: 319, width: 356, height: 42 },
    { left: 52, top: 371, width: 373, height: 42 },
  ];
  assert.equal(next(rects, 0, "ArrowDown"), 2);
  assert.equal(next(rects, 2, "ArrowUp"), 0);
  assert.equal(next(rects, 2, "ArrowDown"), 4);
  assert.equal(next(rects, 2, "ArrowRight"), 3);
});

test("left-biased vertical navigation selects Save below Locations Table", () => {
  const next = runInNewContext(`${source}\ndirectionalTarget`);
  const rects = [
    { left: 1440, top: 359, width: 280, height: 34 },
    { left: 1440, top: 431, width: 140, height: 34 },
    { left: 1592, top: 431, width: 142, height: 34 },
    { left: 1744, top: 431, width: 168, height: 34 },
    { left: 12, top: 710, width: 1850, height: 36 },
  ];
  assert.equal(next(rects, 0, "ArrowDown"), 1);
  assert.equal(next(rects, 3, "ArrowDown"), 4);
});

test("Items can move right into the sidebar and Rest moves down within Activities", () => {
  const next = runInNewContext(`${source}\ndirectionalTarget`);
  const rects = [
    { left: 16, top: 450, width: 95, height: 30 },
    { left: 682, top: 450, width: 103, height: 30 },
    { left: 16, top: 487, width: 184, height: 30 },
    { left: 210, top: 487, width: 213, height: 30 },
    { left: 971, top: 482, width: 267, height: 34 },
    { left: 971, top: 524, width: 130, height: 34 },
  ];
  assert.equal(next(rects, 0, "ArrowDown"), 2);
  assert.equal(next(rects, 1, "ArrowRight"), 4);
  assert.equal(next(rects, 4, "ArrowLeft"), 3);
});

test("number decoration preserves numeric-only controls and wraps only the button's command value", () => {
  for (const [text, value, expected, surroundingLabel] of [
    ["Locations Table [412]", "412", "[412]"],
    ["[150]", "150", null],
    ["Music [2] Collection [106]", "106", "[106]"],
    ["Room [12]", "13", null],
    ["Text choice", "hello", null],
    ["[300]", "300", "[300]", "Conversation [300]"],
  ]) {
    const node = { textContent: text };
    let wrapped: string | null = null;
    let numberOnly = false;
    let accessibleLabel = "";
    let start = 0, end = 0;
    const decorate = runInNewContext(`${source}\ndecorateCommandNumbers`, {
      NodeFilter: { SHOW_TEXT: 4 },
      document: {
        createTreeWalker: () => ({
          currentNode: node,
          nextNode: (() => { let visited = false; return () => { if (visited) return false; visited = true; return true; }; })(),
        }),
        createElement: () => ({
          className: "",
          append: (text: string) => { wrapped = text; },
        }),
        createRange: () => ({
          setStart: (_node: unknown, offset: number) => { start = offset; },
          setEnd: (_node: unknown, offset: number) => { end = offset; },
          extractContents: () => text!.slice(start, end),
          insertNode: () => {},
        }),
      },
    });
    const element = {
      matches: () => true,
      closest: () => surroundingLabel ? { textContent: surroundingLabel } : null,
      querySelector: () => null,
      textContent: text,
      dataset: { value },
      classList: { add: (name: string) => { assert.equal(name, "command-number-only"); numberOnly = true; } },
      setAttribute: (name: string, value: string) => { assert.equal(name, "aria-label"); accessibleLabel = value; },
    };
    decorate(element);
    assert.equal(wrapped, expected);
    assert.equal(element.textContent, text);
    assert.equal(element.dataset.value, value);
    assert.equal(numberOnly, !!surroundingLabel && expected !== null);
    if (numberOnly) assert.equal(accessibleLabel, "Conversation");
  }
});

test("hidden number-only action buttons cover their labeled tile without taking layout space", () => {
  const css = styleSource("handheld");
  const rule = "button.choice.command-number-only { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; margin: 0; padding: 0; border-radius: inherit; }";
  assert.ok(css.includes(`.is-handheld .era-actions-group ${rule}`));
  assert.ok(css.includes(`  .era-actions-group ${rule}`));
  assert.ok(css.includes(".is-handheld .era-actions-group .print-cell:has(.command-number-only) { display: inline-flex; align-items: center; min-height: var(--compact-choice-min-height); box-sizing: border-box; }"));
  assert.ok(css.includes(".era-actions-group .print-cell:has(.command-number-only) { display: inline-flex; align-items: center; min-height: var(--compact-choice-min-height); box-sizing: border-box; }"));
});

test("number-only controls use one tile focus outline in desktop and handheld layouts", () => {
  const css = styleSource("handheld");
  assert.ok(css.includes(".line .print-cell button.choice.command-number-only:focus-visible { outline: none; }"));
  assert.ok(css.includes(".line .print-cell:has(button.choice.command-number-only:focus-visible) { outline: 2px solid #8ddaff; outline-offset: 2px; }"));
});

test("navigation measures the labeled tile rather than its right-aligned numeric button", () => {
  const measure = runInNewContext(`${source}\nnavigationRect`);
  const tile = { left: 32, top: 222, width: 190, height: 60 };
  const result = measure({
    closest: () => ({ getBoundingClientRect: () => tile }),
    getBoundingClientRect: () => ({ left: 132, top: 238, width: 72, height: 32 }),
  });
  assert.equal(JSON.stringify(result), JSON.stringify(tile));
  const next = runInNewContext(`${source}\ndirectionalTarget`);
  assert.equal(next([
    result,
    { left: 32, top: 297, width: 366, height: 60 },
    { left: 12, top: 740, width: 1800, height: 36 },
  ], 0, "ArrowDown"), 1);
});

test("command numbers hide on handheld, at 1280 by 800 or smaller, or with touch input", () => {
  const css = styleSource("handheld");
  assert.match(css, /\.is-handheld \.command-number \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 1280px\) and \(max-height: 800px\), \(any-pointer: coarse\) \{\s*\.command-number \{ display: none; \}/);
});

test("tooltip underlines hide in handheld and touch layouts without removing choice underlines", () => {
  const css = styleSource("handheld");
  assert.match(css, /\.is-handheld \.has-tooltip \.interactive-label \{ text-decoration-line: none; \}/);
  assert.match(css, /@media \(any-pointer: coarse\) \{\s*\.has-tooltip \.interactive-label \{ text-decoration-line: none; \}/);
  const desktop = styleSource("style");
  assert.match(desktop, /\.has-tooltip \.interactive-label \{[^}]*text-decoration-style: dashed;/);
  assert.match(desktop, /\.choice \.interactive-label \{ text-decoration: underline;/);
});

test("UI chrome shares centered button layout and controller badge geometry", () => {
  const css = styleSource("style");
  assert.match(css, /--button-color: currentColor;/);
  assert.match(css, /button, a\.game-primary, \.line button\.choice:is\(\.era-chip-button, \.era-star, \.era-dialog-close, \.era-cycle-toggle\), \.era-chip-button \{[^}]*display: inline-flex; align-items: center; justify-content: center; gap: var\(--button-gap/);
  assert.match(css, /\.line button\.choice \{ display: inline-block;/);
  assert.match(css, /button\[hidden\][^{]*\.line button\.choice\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.era-move-back:enabled:not\(\.is-stale\)::after,\s*\.has-controller[^}]*button\.era-dialog-close:enabled\)::after \{[^}]*flex: 0 0 auto; align-self: center;[^}]*width: 1\.4em; height: 1\.4em; margin: 0;/);
  assert.doesNotMatch(styleSource("handheld"), /era-move-back.*::after/);
});

test("launch version leaves room for the burger menu", () => {
  const css = styleSource("style");
  assert.match(css, /\.era-launch-version \{[^}]*right: 41px;[^}]*max-width: calc\(100% - 41px\);/);
});

test("compact-height gameplay positions the artwork watch at minus 20 pixels", () => {
  const css = styleSource("handheld");
  assert.match(css, /@media \(max-height: 800px\) \{\s*body:not\(\.is-home\) :is\(\.era-main, \.era-shop\) \.era-main-header:has\(\.era-area-art\) > \.era-watch-control \{ top: -20px; \}/);
  assert.match(css, /\.era-watch-control \{ right: 0; \}/);
});

test("compact home screens bound their height and scroll long cards instead of the whole screen", () => {
  const css = styleSource("handheld");
  assert.match(css, /\.is-handheld \.screen\.is-active \.era-shop \{ height: max\(540px, calc\(100cqh - 8px\)\); min-height: 0;/);
  assert.match(css, /\.era-shop > :is\(\.era-shop-home, \.era-shop-menu, \.era-shop-system\) \{ min-height: 0; overflow: auto;/);
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  assert.match(app, /terminal\.scrollLeft = fresh \|\| steps\.some\(\(\{ advanceScreen \}\) => advanceScreen\)[\s\S]*\.screen\.is-active \.era-layout/);
});

test("compact gameplay errors appear at the top without covering the menu button", () => {
  const css = styleSource("handheld");
  assert.match(css, /body:not\(\.is-home\) > header > #status\.error \{[^}]*position: fixed; top: 8px; bottom: auto; left: 8px; right: 56px;/);
});

test("handheld command input stays compact without bottom panel padding", () => {
  const css = styleSource("handheld");
  assert.match(css, /\.is-handheld main \{ padding: 0; \}/);
  assert.match(css, /\.is-handheld #input-form :is\(input, button\) \{ min-height: 0; \}/);
});

test("main and game-output focus do not outline the whole content panel", () => {
  const css = styleSource("handheld");
  assert.ok(css.includes(":is(main, #terminal):focus { outline: none; }"));
  assert.match(css, /:is\(button, a\[href\], input, select, textarea\):focus-visible \{\s*outline: 2px solid #8ddaff;/);
});

test("text-only pauses and processing preserve an invisible command-row spacer but GUI screens collapse it", () => {
  const css = styleSource("style");
  assert.ok(css.includes("body.is-busy main:not(:has(.screen.is-active :is(.era-main, .era-shop, .era-dialog, .era-launch))) > #input-form[hidden],\n"));
  assert.ok(css.includes("main:has(> #terminal.is-waiting):not(:has(.screen.is-active :is(.era-main, .era-shop, .era-dialog, .era-launch))) > #input-form[hidden] { display: flex; visibility: hidden; }"));
  assert.match(css, /#input-form\[hidden\] \{ display: none; \}/);
});

test("action tile controls remain vertically centered when their command numbers are hidden", () => {
  const css = styleSource("style");
  assert.match(css, /\.era-actions-group \.print-cell \.choice \{ vertical-align: middle; \}/);
  const handheld = styleSource("handheld");
  assert.match(handheld, /\.is-handheld \.era-actions-group \.print-cell:has\(\.command-number-only\) \{ display: inline-flex; align-items: center;/);
  assert.doesNotMatch(handheld, /era-guard-control/);
});

test("the empty room prefers the portrait height without taking space needed by actions", () => {
  const css = styleSource("handheld");
  assert.match(css, /\.is-handheld \.era-room-stage \.era-occupant-list:has\(\.era-alone-message\) \{ height: var\(--era-occupant-height\); min-height: 120px; max-height: var\(--era-occupant-height\); \}/);
  assert.match(css, /\.is-handheld \.screen\.is-active \.era-main \{[^}]*grid-template-rows: auto minmax\(0, max-content\) minmax\(min-content, 1fr\) auto auto; \}/);
  assert.match(css, /\.is-handheld \.screen\.is-active \.era-main:not\(:has\(\.era-counters\)\) \{ grid-template-rows: auto minmax\(0, max-content\) minmax\(min-content, 1fr\) auto; \}/);
  assert.match(css, /\.is-handheld \.era-alone \.era-room-stage \{ flex: 1 1 auto; min-height: 0; overflow: visible; \}/);
  assert.match(css, /\.is-handheld \.era-room-stage \.era-occupant-list:has\(\.era-alone-message\) \{ flex: 1 1 auto; \}/);
});

test("compact gameplay hides interaction history, shrinks watch text, and keeps action headings inline", () => {
  const css = styleSource("handheld");
  assert.match(css, /\.is-handheld \.era-main-chat \{ display: none; \}/);
  assert.match(css, /\.is-handheld \.era-watch-control \.era-timestop-button \{ font-size: 19px; \}/);
  assert.match(css, /\.is-handheld \.era-actions-group > \.line > span:has\(> \.era-actions-title\) \{ flex-basis: auto; \}/);
  const compact = css.slice(css.indexOf("@media (max-width: 1280px) and (max-height: 800px) {"));
  assert.match(compact, /\.era-main-chat \{ display: none; \}/);
  assert.match(compact, /\.era-watch-control \.era-timestop-button \{ font-size: 19px; \}/);
  assert.match(compact, /\.era-actions-group > \.line > span:has\(> \.era-actions-title\) \{ flex-basis: auto; \}/);
});

test("compact save pickers remove outer gutters and relationship actions use equal-height flat buttons", () => {
  const css = styleSource("handheld");
  assert.ok(css.includes('body:not(.is-home) #terminal:has(.screen.is-active :is(.era-main, .era-shop, .era-dialog)) { padding: 0; scrollbar-gutter: auto; }'));
  assert.match(css, /\.is-handheld \.era-relationship \.line \.era-relationship-select \{ height: var\(--compact-relationship-button-height\); min-height: var\(--compact-relationship-button-height\);[^}]*background: #493040;/);
  assert.match(css, /\.era-relationship \.line \.era-relationship-select:is\(:disabled, span\) \{ background: #23232b;/);
  assert.ok(css.includes('.has-controller .screen.is-active .era-relationship:popover-open .line button.choice.era-relationship-select:focus { filter: none; outline: 2px solid #8ddaff; outline-offset: 2px; }'));
});

test("compact main and wake-up screens retain their horizontal gutters", () => {
  const css = styleSource("handheld");
  const reset = css.indexOf("body:not(.is-home) #terminal:has(.screen.is-active :is(.era-main, .era-shop, .era-dialog))");
  const gutter = "body:not(.is-home) #terminal:has(.screen.is-active :is(.era-main, .era-shop)) { padding-inline: 12px; }";
  assert.ok(css.indexOf(gutter) > reset, "main/wake-up gutters must override the compact dialog padding reset");
});

test("render decorates command numbers after buttons have their surrounding labels", () => {
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  assert.match(app, /outputRoot\.querySelectorAll\("button\.choice"\)\.forEach\(decorateCommandNumbers\);\s*markTarget/);
});

test("compact room uses content height instead of reserving hidden chat space", () => {
  const css = styleSource("handheld");
  assert.match(css, /\.is-handheld \.screen\.is-active \.era-main \{[^}]*grid-template-rows: auto minmax\(0, max-content\) minmax\(min-content, 1fr\) auto auto;/);
  assert.match(css, /\.is-handheld \.era-character:has\(\.era-main-chat\) \{ grid-template-rows: auto; \}/);
});

test("room occupant names are white with a dark outline and summary portraits fit their frame", () => {
  const css = styleSource("style");
  assert.match(css, /\.era-room-stage \.era-occupant \.era-occupant-text \.era-occupant-name \{ color: #fff; \}/);
  assert.match(css, /\.era-room-stage \.era-occupant-text, \.era-room-stage \.era-occupant-label \{ text-shadow: -1px -1px 0 #000,/);
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  assert.match(app, /await image\(node,[\s\S]*?!!destination\.closest\("\.era-info-head \.era-info-face"\)\)/);
});

test("command bar only hides in handheld mode and preserves free text and amount prompts", () => {
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const start = app.indexOf("  const inlineSetup =");
  const end = app.indexOf("  command.placeholder =", start);
  assert.ok(start > 0 && end > start);
  for (const { input, setup, main = false, llm = false, expected } of [
    { input: null, setup: false, expected: true },
    { input: { kind: "integer", buttonValues: ["0", "1"] }, setup: false, expected: true },
    { input: { kind: "string", buttonValues: ["MAP1", "Back"] }, setup: false, expected: true },
    { input: { kind: "integer" }, setup: true, expected: true },
    { input: { kind: "integer" }, setup: false, expected: false },
    { input: { kind: "string" }, setup: true, expected: false },
    { input: { kind: "wait" }, setup: true, expected: true },
    { input: { kind: "mousekey" }, setup: false, expected: true },
    { input: { kind: "integer" }, setup: false, main: true, expected: true },
    { input: { kind: "integer" }, setup: false, main: true, llm: true, expected: true },
    { input: { kind: "string" }, setup: false, main: true, expected: false },
    { input: { kind: "wait" }, setup: false, main: true, expected: true },
  ]) {
    const form = { hidden: false };
    for (const enabled of [true, false, true]) {
      runInNewContext(app.slice(start, end), {
        handheld: { enabled: () => enabled },
        input,
        activeLlm: () => llm ? {} : null,
        terminal: { querySelector: (selector: string) => {
          assert.equal(selector, ".screen.is-active .era-main, .screen.is-active .era-shop");
          return main ? {} : null;
        } },
        lastOutputLine: () => ({ closest: (selector: string) => {
          if (selector === ".screen.is-active .era-setup:not(.era-setup-editor)") return setup ? {} : null;
          assert.fail(`Unexpected selector: ${selector}`);
        } }),
        document: { querySelector: () => form },
      });
      assert.equal(form.hidden, enabled && expected, JSON.stringify({ input, setup, main, enabled }));
    }
  }
});

test("handheld changes immediately refresh display settings and command visibility", () => {
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const start = app.indexOf("const handheld = setupHandheld(");
  const end = app.indexOf("const keyboardNavigation =", start);
  assert.ok(start > 0 && end > start);
  let onChange = () => {};
  const refreshed: string[] = [];
  runInNewContext(app.slice(start, end), {
    setupHandheld: (callback: () => void) => { onChange = callback; },
    applySettings: () => { refreshed.push("settings"); },
    updateControls: () => { refreshed.push("controls"); },
  });
  onChange();
  assert.deepEqual(refreshed, ["settings", "controls"]);
});

test("title screen only hides the command bar in handheld mode", () => {
  const css = styleSource("style");
  assert.match(css, /body\.is-handheld:has\(\.screen\.is-active \.era-launch\) #input-form \{ display: none; \}/);
  assert.doesNotMatch(css, /body:has\(\.screen\.is-active \.era-launch\) #input-form \{ display: none; \}/);
});

test("small screens hide LLM configuration and the opener blocks all entry points", () => {
  const css = styleSource("handheld");
  assert.match(css, /@media \(max-width: 1280px\) and \(max-height: 800px\) \{\s*#llm-toggle, \.era-llm-configure \{ display: none; \}/);
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const wiring = app.slice(app.indexOf("const llmConfig ="), app.indexOf("function showLlmState"));
  let matches = true, opened = 0, closed = 0, changed = () => {};
  const errors: string[] = [];
  const dialog = { open: false, close: () => { closed++; dialog.open = false; } };
  const open = runInNewContext(`${wiring}\nopenLlmConfig`, {
    document: { querySelector: () => dialog },
    setupLlmConfig: () => () => { opened++; dialog.open = true; },
    matchMedia: (query: string) => {
      assert.equal(query, "(max-width: 1280px) and (max-height: 800px)");
      return {
        get matches() { return matches; },
        addEventListener: (_type: string, callback: () => void) => { changed = callback; },
      };
    },
    message: (text: string, error: boolean) => { assert.equal(error, true); errors.push(text); },
  });
  open();
  assert.equal(opened, 0);
  assert.match(errors[0]!, /LLM configuration requires/);
  matches = false;
  open();
  assert.equal(opened, 1);
  matches = true;
  changed();
  assert.equal(closed, 1);
  assert.equal(dialog.open, false);
});

function navigationHarness() {
  type Control = {
    tabIndex: number; hidden: boolean; editable: boolean; visible: boolean; scrolled: boolean;
    saveSlot: boolean; page: string; tabGroup: string; dataset: { value: string };
    classList: { contains(name: string): boolean; add(name: string): void; remove(...names: string[]): void };
    click(): void;
    matches(selector: string): boolean;
    closest(selector: string): unknown;
    focus(): void;
    scrollIntoView(): void;
    getClientRects(): number[];
    getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  };
  const handlers = new Map<string, (event: ReturnType<typeof event>) => void>();
  const state = { activeElement: null as Control | null, allowed: true, home: false, modal: false, closed: false, touch: false, handheld: false,
    nestedClosed: false, title: false };
  function control(left: number, top: number, editable = false): Control {
    const classes = new Set<string>();
    return {
      classList: { contains: name => classes.has(name), add: name => { classes.add(name); }, remove: (...names) => { names.forEach(name => classes.delete(name)); } },
      click() {},
      tabIndex: 0, hidden: false, editable, visible: true, scrolled: false, saveSlot: false, page: "", tabGroup: "", dataset: { value: "" },
      matches(selector) { return selector.includes("input") ? this.editable : selector === ".era-load .era-save-slot" ? this.saveSlot : selector === this.page; },
      closest(selector) {
        if (selector === ".era-launch-actions button.choice:enabled") return state.title && !this.editable ? this : null;
        if (selector === ".era-page-prev, .era-page-next") return this.page ? this : null;
        if (selector === "button[data-value]") return this;
        if (selector === this.tabGroup) return this;
        if (selector.includes("input")) return this.editable ? this : null;
        if (selector.includes("[hidden]")) return this.hidden ? this : null;
        return null;
      },
      focus() { state.activeElement = this; },
      scrollIntoView() { this.scrolled = true; },
      getClientRects() { return this.visible ? [1] : []; },
      getBoundingClientRect() { return { left, top, width: 40, height: 40 }; },
    };
  }
  const items = [control(0, 0), control(60, 0), control(0, 60), control(60, 60)];
  const root = {
    querySelectorAll: () => items,
    querySelector: (selector: string) => selector === ".era-launch-actions" && state.title ? root : null,
    closest: () => state.home ? null : root,
  };
  const command = control(0, 180, true);
  const terminal = {
    querySelector: (selector: string) => selector === ".screen.is-active" ? root : null,
    focus: () => { state.activeElement = null; },
  };
  const menu = { hidden: true };
  const document = {
    get activeElement() { return state.activeElement; },
    body: { classList: { contains: (name: string) => name === "is-handheld" ? state.handheld : state.home } },
    querySelector(selector: string) {
      if (selector === "dialog[open]") return state.modal ? {
        ...root, close: () => { state.closed = true; state.modal = false; },
      } : null;
      if (selector === "#menu-panel") return menu;
      if (selector === "#library") return root;
      return null;
    },
    addEventListener(name: string, handler: (event: ReturnType<typeof event>) => void) { handlers.set(name, handler); },
  };
  const setup = runInNewContext(`${source}\nsetupKeyboardNavigation`, {
    matchMedia: () => ({ matches: state.touch }),
    document, getComputedStyle: () => ({ visibility: "visible", display: "block" }),
  });
  const navigation = setup({ terminal, command, canNavigate: () => state.allowed });
  function event(key: string, target = state.activeElement ?? items[0]!) {
    return {
      key, target, defaultPrevented: false, isComposing: false, ctrlKey: false,
      metaKey: false, altKey: false, shiftKey: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
  }
  function key(name: string, target?: Control) {
    const input = event(name, target);
    handlers.get("keydown")!(input);
    return input;
  }
  return { state, items, command, navigation, key, handlers, event };
}

test("arrows focus visible choices, preserve keyboard mode after a command, and reach the input below them", () => {
  const { state, items, command, navigation, key } = navigationHarness();
  assert.equal(key("ArrowRight").defaultPrevented, true);
  assert.equal(state.activeElement, items[0]);
  key("ArrowRight");
  assert.equal(state.activeElement, items[1]);
  assert.equal(items[1]!.scrolled, true);
  items[0]!.hidden = true;
  items[2]!.visible = false;
  navigation.focusInput();
  assert.equal(state.activeElement, items[1]);
  key("ArrowDown");
  assert.equal(state.activeElement, items[3]);
  key("ArrowDown");
  assert.equal(state.activeElement, command);
});

test("hidden command input focuses a visible choice instead and stays out of arrow navigation", () => {
  const { state, items, command, navigation, key } = navigationHarness();
  command.hidden = true;
  navigation.focusInput();
  assert.equal(state.activeElement, items[0]);
  key("ArrowDown");
  assert.equal(state.activeElement, items[2]);
  key("ArrowDown");
  assert.equal(state.activeElement, items[2]);
});

test("title starts without a focused choice but keeps deliberate keyboard focus", () => {
  const { state, items, command, navigation, key } = navigationHarness();
  state.title = true;
  command.hidden = true;
  navigation.focusInput();
  assert.equal(state.activeElement, null);
  navigation.focusInput();
  assert.equal(state.activeElement, null);
  key("ArrowDown");
  assert.equal(state.activeElement, items[0]);
  navigation.focusInput();
  assert.equal(state.activeElement, items[0]);
  key("ArrowDown");
  assert.equal(state.activeElement, items[2]);
});

test("a newly visible input prompt takes focus instead of returning to choices", () => {
  const { state, command, navigation, key } = navigationHarness();
  command.hidden = true;
  navigation.focusInput();
  key("ArrowRight");
  command.hidden = false;
  navigation.focusInput();
  assert.equal(state.activeElement, command);
});

test("paging preserves the activated previous or next control across redraws", () => {
  for (const page of [".era-page-prev", ".era-page-next"]) {
    const { state, command, items, navigation, handlers, event } = navigationHarness();
    command.hidden = true;
    items[1]!.saveSlot = true;
    items[3]!.page = page;
    handlers.get("click")!(event("", items[3]));
    state.activeElement = null;
    navigation.focusInput();
    assert.equal(state.activeElement, items[3]);
    navigation.focusInput();
    assert.equal(state.activeElement, items[3], "subsequent completion focus does not undo restoration");
  }
});

test("load dialog focuses its first selectable save rather than Close, with an empty-page fallback", () => {
  const { state, items, command, navigation } = navigationHarness();
  command.hidden = true;
  items[1]!.saveSlot = true;
  items[2]!.saveSlot = true;
  navigation.focusInput();
  assert.equal(state.activeElement, items[1]);
  items[1]!.visible = false;
  navigation.focusInput();
  assert.equal(state.activeElement, items[2]);
  items[2]!.hidden = true;
  navigation.focusInput();
  assert.equal(state.activeElement, items[0]);
});

test("redrawn setup, sheet and map tabs retain focus, but other commands clear the preference", () => {
  for (const group of [".era-start-tabs", ".era-player-tabs", ".era-sheet-pages", ".era-sheet-subpages", ".era-move-tabs"]) {
    const { state, items, command, navigation, handlers, event } = navigationHarness();
    command.hidden = true;
    items[2]!.tabGroup = group;
    items[2]!.dataset.value = "101";
    handlers.get("click")!(event("", items[2]));
    state.activeElement = null;
    navigation.focusInput();
    assert.equal(state.activeElement, items[2]);
    navigation.focusInput();
    assert.equal(state.activeElement, items[2]);
    handlers.get("click")!(event("", items[1]));
    navigation.focusInput();
    assert.equal(state.activeElement, items[0]);
  }
});

test("touch command input uses Up for focus navigation rather than history, while Left stays native", () => {
  const { state, command, items, key } = navigationHarness();
  state.touch = true;
  command.focus();
  assert.equal(key("ArrowUp", command).defaultPrevented, true);
  assert.equal(state.activeElement, items[2]);
  command.focus();
  assert.equal(key("ArrowLeft", command).defaultPrevented, false);
});

test("handheld command input navigates on Up and Down even without a touch pointer", () => {
  const { state, command, items, key } = navigationHarness();
  state.handheld = true;
  command.focus();
  assert.equal(key("ArrowUp", command).defaultPrevented, true);
  assert.equal(state.activeElement, items[2]);
  assert.equal(key("ArrowDown").defaultPrevented, true);
  assert.equal(state.activeElement, command);
  assert.equal(key("ArrowLeft", command).defaultPrevented, false);
});

test("editable arrows and Enter keep native handling; Escape exits game input", () => {
  const { state, items, command, key } = navigationHarness();
  command.focus();
  for (const arrow of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
    assert.equal(key(arrow, command).defaultPrevented, false);
  }
  assert.equal(key("Enter", items[0]).defaultPrevented, false);
  assert.equal(key("Escape", command).defaultPrevented, true);
  assert.equal(state.activeElement, null);
  key("ArrowDown");
  assert.equal(state.activeElement, items[0]);
});

test("directional focus passes editable controls until activated and Back leaves editing first", () => {
  const { state, items, key, handlers, event } = navigationHarness();
  const field = items[1]!;
  field.editable = true;
  state.modal = true;
  items[0]!.focus();
  key("ArrowRight");
  assert.equal(state.activeElement, field);
  assert.equal(field.classList.contains("is-control-navigation"), true);
  assert.equal(key("x").defaultPrevented, true);
  const paste = event("insertFromPaste", field);
  handlers.get("beforeinput")!(paste);
  assert.equal(paste.defaultPrevented, true);
  key("ArrowDown");
  assert.equal(state.activeElement, items[3]);
  key("ArrowUp");
  assert.equal(state.activeElement, field);
  assert.equal(key("Enter").defaultPrevented, true);
  assert.equal(field.classList.contains("is-control-editing"), true);
  assert.equal(key("ArrowLeft").defaultPrevented, false);
  assert.equal(key("Escape").stopped, true);
  assert.equal(state.closed, false);
  assert.equal(field.classList.contains("is-control-navigation"), true);
  key("ArrowLeft");
  assert.equal(state.activeElement, items[0]);
  key("Escape");
  assert.equal(state.closed, true);
});

test("clicks and Tab departure restore native input editing", () => {
  const { state, items, key, handlers, event } = navigationHarness();
  const field = items[1]!;
  field.editable = true;
  items[0]!.focus();
  key("ArrowRight");
  assert.equal(state.activeElement, field);
  assert.equal(key("Tab").defaultPrevented, false);
  handlers.get("focusout")!(event("focusout", field));
  assert.equal(field.classList.contains("is-control-navigation"), false);
  key("ArrowLeft");
  assert.equal(state.activeElement, field);
  field.classList.add("is-control-navigation");
  handlers.get("pointerdown")!(event("pointerdown", field));
  assert.equal(key("ArrowLeft", field).defaultPrevented, false);
  assert.equal(field.classList.contains("is-control-navigation"), false);
});

test("game navigation does not intercept busy/raw-input keys but library navigation remains available", () => {
  const { state, items, key } = navigationHarness();
  state.allowed = false;
  assert.equal(key("ArrowDown").defaultPrevented, false);
  state.home = true;
  assert.equal(key("ArrowDown").defaultPrevented, true);
  assert.equal(state.activeElement, items[0]);
});

test("Escape cancels native dialogs without submitting a game command", () => {
  const { state, command, key } = navigationHarness();
  state.modal = true;
  const result = key("Escape", command);
  assert.equal(result.defaultPrevented, true);
  assert.equal(result.stopped, true);
  assert.equal(state.closed, true);
});

test("nested configuration dialogs receive Escape before the underlying Settings dialog", () => {
  const { state, command, key } = navigationHarness();
  state.modal = true;
  command.focus();
  const originalClosest = command.closest;
  command.closest = (selector) => selector === "dialog[open]"
    ? { close: () => { state.nestedClosed = true; } } : originalClosest.call(command, selector);
  const result = key("Escape", command);
  assert.equal(result.defaultPrevented, true);
  assert.equal(state.nestedClosed, true);
  assert.equal(state.closed, false);
});

test("render completion does not steal focus from an open controller or settings dialog", () => {
  const { state, command, navigation, items } = navigationHarness();
  items[2]!.focus();
  state.modal = true;
  navigation.focusInput();
  assert.equal(state.activeElement, items[2]);
  state.modal = false;
  navigation.focusInput();
  assert.equal(state.activeElement, command);
});

test("composition and modified arrows are not intercepted", () => {
  const { handlers, event } = navigationHarness();
  for (const modifier of ["isComposing", "ctrlKey", "metaKey", "altKey", "shiftKey"] as const) {
    const input = event("ArrowDown");
    input[modifier] = true;
    handlers.get("keydown")!(input);
    assert.equal(input.defaultPrevented, false);
  }
});
