import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { parseFragment } from "parse5";
// @ts-ignore Browser fixture module is also consumed by the catalog.
import { chromeButtonSamples } from "../web/chrome-button-samples.js";

const buttonVariants = [
  "primary", "danger", "quiet", "small", "large", "tab", "menu-item", "icon", "continue", "send",
].map(name => `ui-button--${name}`);
const productionSamples = readdirSync("web").filter(name => /\.(?:html|js)$/.test(name) && name !== "chrome-button-samples.js")
  .flatMap(name => {
    const source = readFileSync(`web/${name}`, "utf8");
    const classes = [...new Set([...source.matchAll(/["']([\w -]*\bui-button(?: +[\w-]+)*)["']/g)].map(match => match[1]!))];
    return classes.map(classes => ({
      name: `Production / ${name} / ${classes}`,
      html: `<button class="${classes}" type="button">Example action</button>`,
    }));
  });

test("production chrome buttons only compose the shared variants", () => {
  assert.ok(productionSamples.length > 20);
  for (const { name, html } of productionSamples) {
    for (const variant of html.match(/ui-button--[\w-]+/g) ?? []) {
      assert.ok(buttonVariants.includes(variant), `${name}: screen-specific or unknown ${variant}`);
    }
  }
  const styles = readFileSync("styles/shared/_chrome-buttons.scss", "utf8");
  assert.deepEqual([...new Set(styles.match(/ui-button--[\w-]+/g))].sort(), [...buttonVariants].sort());
});

test("Send dims only while waiting for non-wait input with an empty command", () => {
  const source = readFileSync("web/app.js", "utf8");
  const helper = source.slice(source.indexOf("function updateSendAppearance("), source.indexOf("function updateControls("));
  for (const [kind, value, busy, expected] of [
    ["integer", "", false, true], ["string", "", false, true],
    ["integer", "4", false, false], ["string", " ", false, false],
    ["wait", "", false, false], ["integer", "", true, false],
    [null, "", false, false],
  ] as const) {
    const send = { dataset: { empty: "" } };
    runInNewContext(`${helper}\nupdateSendAppearance();`, {
      send, command: { value }, busy, input: kind ? { kind } : null,
    });
    assert.equal(send.dataset.empty, String(expected));
  }
  const styles = readFileSync("styles/shared/_chrome-buttons.scss", "utf8");
  assert.match(styles, /\.ui-button--small \{[^}]*min-height: 26px/);
  assert.match(styles, /\.ui-button--send\[data-empty="true"\] \{ opacity: \.3; transition-delay: 0s, 0s, 0s, 120ms/);
});

test("every chrome button variant has a self-contained catalog fixture", () => {
  const styles = readFileSync("styles/shared/_chrome-buttons.scss", "utf8");
  const variants = [...new Set(styles.match(/ui-button--[\w-]+/g))];
  const samples = chromeButtonSamples as { name: string; html: string }[];
  assert.equal(new Set(samples.map((sample) => sample.name)).size, samples.length);
  for (const variant of variants) assert.ok(samples.some(({ html }) => html.includes(variant)), `Missing ${variant}`);
  for (const sample of samples) {
    const fragment = parseFragment(sample.html);
    assert.equal(fragment.childNodes.length, 1, sample.name);
    const control = fragment.childNodes[0] as any;
    assert.ok(["button", "a"].includes(control.tagName), sample.name);
    assert.ok(control.attrs.find((attr: any) => attr.name === "class")?.value.split(" ").includes("ui-button"), sample.name);
  }
  assert.doesNotMatch(styles, /(?:#[\w-]+|\.(?:menu-panel|llm-config|library|settings-actions|era-llm[\w-]*))\s+(?:button|\.ui-button)/);
});

test("app and library containers no longer supply button appearance", () => {
  for (const path of ["styles/library.scss", "styles/app/_llm-settings.scss", "styles/game/_main-occupants.scss", "styles/game/_main-history.scss", "styles/app/_diagnostics-settings.scss"]) {
    const styles = readFileSync(path, "utf8");
    for (const [, selector, declarations] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/(?:\.library-tabs|\.library-starter|\.llm-config|\.era-llm[\w-]*|\.era-history-tabs)[^{}]*\bbutton/.test(selector!)) {
        assert.doesNotMatch(declarations!, /(?:--button-[\w-]+|font(?:-[\w-]+)?|color|background(?:-[\w-]+)?|border(?:-[\w-]+)?|padding(?:-[\w-]+)?|outline(?:-[\w-]+)?|box-shadow)\s*:/, `${path}: ${selector}`);
      }
    }
    if (path.endsWith("_diagnostics-settings.scss")) assert.doesNotMatch(styles, /\bbutton\b/);
  }
});

const browser = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((path): path is string => !!path && existsSync(path));

test("chrome fixtures cover modifier states and keep their appearance without app ancestors", {
  skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH",
}, async () => {
  const styles = (await Promise.all(["style", "library", "responsive"].map((name) =>
    readFile(`web/generated/${name}.css`, "utf8")))).join("\n");
  const chromeStyles = readFileSync("styles/shared/_chrome-buttons.scss", "utf8");
  const selectors = [...chromeStyles.matchAll(/([^{}]+)\{/g)]
    .map((match) => match[1]!.trim()).filter((selector) => selector.startsWith(".ui-button"));
  // Headless windows can lose document focus to parallel browser tests. Exercise the
  // same focus declarations deterministically while separately checking native focus ownership.
  const focusStyles = styles.replace(/:focus-visible\b/g, ':is(:focus-visible, [data-fixture-focus-visible])')
    .replace(/:focus(?![\w-])/g, ':is(:focus, [data-fixture-focus])');
  const html = `<!doctype html><meta charset="utf-8"><style>${focusStyles}
    body { height:auto; } .fixture-parent { font:italic 31px/3 serif; color:red; }
    .ui-button { transition:none; animation:none; }
    .fixture-parent, .fixture-neutral { display:block; width:700px; }
    </style><body><script>
    const samples = ${JSON.stringify([...chromeButtonSamples, ...productionSamples])};
    const selectors = ${JSON.stringify(selectors)};
    const properties = ["backgroundImage","backgroundColor","color","borderTopColor","borderTopWidth",
      "borderTopStyle","borderTopLeftRadius","paddingTop","paddingRight","paddingBottom","paddingLeft",
      "fontFamily","fontSize","fontWeight","lineHeight","minHeight","opacity","outlineStyle","outlineColor"];
    const snapshot = element => {
      const style = getComputedStyle(element);
      const result = Object.fromEntries(properties.map(property => [property,style[property]]));
      result.after = getComputedStyle(element,"::after").content;
      return result;
    };
    const controls = [], failures = [], uncovered = [];
    const coarse = matchMedia("(pointer: coarse) and (max-width: 900px)").matches;
    let typography;
    for (const sample of samples) {
      const neutral = document.createElement("div");
      neutral.className = "fixture-neutral";
      neutral.innerHTML = sample.html;
      const nested = document.createElement("div");
      nested.className = "fixture-parent library-tabs menu-panel settings-actions llm-config confirm-actions era-history-toolbar";
      nested.innerHTML = sample.html;
      document.body.append(neutral,nested);
      const first = neutral.firstElementChild, second = nested.firstElementChild;
      controls.push(first);
      const icon = first.querySelector("svg");
      if (icon) {
        const buttonBounds = first.getBoundingClientRect(), iconBounds = icon.getBoundingClientRect();
        for (const [position, size] of [["left", "width"], ["top", "height"]]) {
          const offset = Math.abs(buttonBounds[position] + buttonBounds[size] / 2 - iconBounds[position] - iconBounds[size] / 2);
          if (offset > .5) failures.push({name:sample.name,reason:"icon is not centered",position,offset});
        }
      }
      const appearance = snapshot(first);
      const label = ["fontFamily", "fontSize", "fontWeight", "lineHeight"].map(property => appearance[property]);
      typography ??= label;
      if (JSON.stringify(label) !== JSON.stringify(typography)) {
        failures.push({name:sample.name,reason:"inconsistent label typography",label,typography});
      }
      if (appearance.fontSize !== "13px" || appearance.fontWeight !== "550") {
        failures.push({name:sample.name,reason:"unexpected label size or weight",label});
      }
      if (coarse && parseFloat(appearance.minHeight) < 44) {
        failures.push({name:sample.name,reason:"touch target below 44px",minHeight:appearance.minHeight});
      }
      for (const state of ["normal","focus","disabled"]) {
        // Disabling the last-focused control can retain native focus until Chrome processes blur.
        first.blur();
        second.blur();
        if (state === "disabled") { first.disabled = true; second.disabled = true; }
        const focusable = !first.disabled && first.getClientRects().length > 0;
        if (state === "focus" && focusable) {
          first.focus({preventScroll:true});
          first.setAttribute("data-fixture-focus","");
          first.setAttribute("data-fixture-focus-visible","");
        }
        const beforeFocus = document.activeElement === first;
        const before = snapshot(first);
        first.blur();
        first.removeAttribute("data-fixture-focus");
        first.removeAttribute("data-fixture-focus-visible");
        if (state === "focus" && focusable) {
          second.focus({preventScroll:true});
          second.setAttribute("data-fixture-focus","");
          second.setAttribute("data-fixture-focus-visible","");
        }
        const afterFocus = document.activeElement === second;
        const after = snapshot(second);
        if (beforeFocus !== afterFocus) {
          failures.push({name:sample.name,state,reason:"unequal native focus states",beforeFocus,afterFocus});
        }
        if (state === "focus" && focusable && !beforeFocus) {
          failures.push({name:sample.name,state,reason:"focusable fixture did not acquire focus"});
        }
        second.blur();
        second.removeAttribute("data-fixture-focus");
        second.removeAttribute("data-fixture-focus-visible");
        const differences = Object.keys(before).filter(property => before[property] !== after[property])
          .map(property => ({property,before:before[property],after:after[property]}));
        if (differences.length) failures.push({name:sample.name,state,differences});
        if (state === "disabled") { first.disabled = sample.html.includes(" disabled"); second.disabled = first.disabled; }
      }
      if (getComputedStyle(first).position === "absolute") failures.push({name:sample.name,reason:"fixture overlaps catalog"});
    }
    const compare = (firstName, secondName) => {
      const first = controls[samples.findIndex(sample => sample.name === firstName)];
      const second = controls[samples.findIndex(sample => sample.name === secondName)];
      if (JSON.stringify(snapshot(first)) !== JSON.stringify(snapshot(second))) {
        failures.push({reason:"equivalent controls differ",firstName,secondName});
      }
    };
    compare("Default", "Navigation link");
    compare("Menu item", "Menu navigation link");
    compare("Selected tab", "Pressed tab");
    const splitSelectors = value => {
      let depth = 0, start = 0;
      const parts = [];
      for (let i = 0; i < value.length; i++) {
        if (value[i] === "(") depth++;
        if (value[i] === ")") depth--;
        if (value[i] === "," && depth === 0) { parts.push(value.slice(start,i)); start = i+1; }
      }
      parts.push(value.slice(start));
      return parts;
    };
    for (const rule of selectors) for (const selector of splitSelectors(rule)) {
      const testSelector = selector.trim().replace(/::(?:before|after)/g,"")
        .replace(/:is\\(:hover, :focus-visible\\)/g,"").replace(/:(?:hover|focus-visible|focus)(?![\\w-])/g,"");
      const alternatives = value => {
        const group = value.match(/:is\\(([^()]*)\\)/);
        return group ? splitSelectors(group[1]).flatMap(part =>
          alternatives(value.replace(group[0],part.trim()))) : [value];
      };
      for (const alternative of alternatives(testSelector)) {
        if (!controls.some(control => control.matches(alternative) || control.querySelector(alternative))) uncovered.push(alternative);
      }
    }
    document.body.innerHTML = "<pre id='result'>" + JSON.stringify({failures,uncovered,coarse}) + "</pre>";
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-chrome-fixtures-"));
  try {
    const page = join(profile, "fixtures.html");
    await writeFile(page, html);
    for (const coarse of [false, true]) {
      const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`,
        coarse ? "--window-size=640,800" : "--window-size=1200,900", "--dump-dom", pathToFileURL(page).href];
      if (coarse) args.unshift("--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=0,availableHoverTypes=0");
      if (process.platform === "linux") args.unshift("--no-sandbox");
      const { stdout } = await promisify(execFile)(browser!, args, { maxBuffer: 4 * 1024 * 1024, timeout: 30000 });
      const match = stdout.match(/<pre id="result">([^]*?)<\/pre>/);
      assert.ok(match, stdout.slice(-4000));
      const result = JSON.parse(match[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
      assert.equal(result.coarse, coarse, "Browser did not use the requested pointer/viewport");
      assert.deepEqual(result.uncovered, [], "CSS modifier states missing fixtures");
      assert.deepEqual(result.failures, [], "Chrome appearance, typography, or touch targets differ");
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});
