import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
const browser = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
].find((path): path is string => !!path && existsSync(path));

test("Continue waits keep disabled active portraits bright but still dim history and unavailable choices", {
  skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH",
}, async () => {
  const style = await readFile(new URL("../web/generated/style.css", import.meta.url), "utf8");
  const html = `<!doctype html><style>${style}</style><body>
    <main id="terminal" class="is-waiting">
      <div class="screen is-active">
        <button id="portrait" class="choice" disabled><span class="sprite"><span class="sprite-clip">Portrait</span></span></button>
        <button id="unavailable" class="choice" disabled aria-disabled="true">Unavailable</button>
        <button id="stale" class="choice is-stale" disabled>Stale</button>
      </div>
      <div id="history" class="screen is-history">History</div>
    </main><script>
      const appearance = id => {
        const css = getComputedStyle(document.getElementById(id));
        return {opacity: Number(css.opacity), filter: css.filter};
      };
      const result = Object.fromEntries(["portrait", "unavailable", "stale", "history"].map(id => [id, appearance(id)]));
      result.disabled = document.getElementById("portrait").disabled;
      document.getElementById("terminal").classList.remove("is-waiting");
      result.afterWait = appearance("portrait");
      document.body.innerHTML = "<pre id='result'>" + JSON.stringify(result) + "</pre>";
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-wait-appearance-"));
  try {
    const fixture = join(profile, "wait.html");
    await writeFile(fixture, html);
    const { stdout } = await execute(browser!, ["--headless", "--disable-gpu", "--no-first-run",
      `--user-data-dir=${profile}`, "--dump-dom", pathToFileURL(fixture).href],
      { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
    const match = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);
    assert.ok(match);
    const result = JSON.parse(match[1]);
    assert.deepEqual(result.portrait, { opacity: 1, filter: "none" });
    assert.equal(result.disabled, true);
    for (const id of ["unavailable", "stale", "history", "afterWait"]) {
      assert.ok(result[id].opacity < 1, `${id} stays dimmed`);
      assert.equal(result[id].filter, "grayscale(1)", `${id} stays desaturated`);
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("item IDs and quantities stay unbroken in wide and compact dialogs and legacy prompts have no controller badge", {
  skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH",
}, async () => {
  const [style, controls, controller] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/controls.js", import.meta.url), "utf8"),
    readFile(new URL("../web/controller-menu.js", import.meta.url), "utf8"),
  ]);
  const html = `<!doctype html><style>${style}</style><body>
    <input id="controller-hints-toggle" type="checkbox"><span id="controller-hints-label"></span>
    <dialog id="controller-menu"><div class="controller-menu-actions">
      <button>Restart</button><button>Library</button><button>Settings</button><button>Exit</button>
    </div><button id="controller-menu-close">Close</button></dialog>
    <main id="terminal"><div class="screen is-active">
      <button id="legacy" class="choice">[Yes]</button>
      <button id="gui" class="choice era-chip-button">Yes</button>
      <button id="other" class="choice" style="display:flex;width:60px;white-space:normal;overflow-wrap:anywhere">
        <span class="command-number">[12345]</span><span>Long button label</span>
      </button>
      <div popover="manual" class="era-dialog era-inventory"><div class="era-inventory-body">
        <div class="era-inventory-grid">${Array.from({ length: 8 }, (_, index) => `
          <div class="line"><button class="choice era-inventory-item era-inventory-use">
            <span class="era-inventory-name">Heavy Load [Le Deluge] Purification Drug</span>
            <span class="era-inventory-quantity">${index % 2 ? "999" : "73"}</span>
            <span class="command-number">[103${index}]</span>
          </button></div>`).join("")}</div></div></div>
    </div></main><script>
      ${controls.replace(/^export /gm, "")}
      ${controller.replace(/^import .+;\n/gm, "").replace(/^export /gm, "")}
      window.requestAnimationFrame = () => 0;
      setupControllerMenu({restart() {}, library() {}, settings() {}, exit() {},
        canRestart: () => true, canExit: true, onError: error => { throw error; }});
      setPreviewControllerHints(true);
      const legacy = document.getElementById("legacy"), gui = document.getElementById("gui");
      legacy.focus();
      const legacyBadge = getComputedStyle(legacy, "::after").content;
      const legacyFocus = legacy.classList.contains("controller-focus");
      gui.focus();
      const guiHint = gui.classList.contains("has-controller-hint") && gui.classList.contains("controller-focus");
      setPreviewControllerHints(false);
      const dialog = document.querySelector(".era-inventory");
      dialog.showPopover();
      const result = { legacyBadge, legacyFocus, guiHint, layouts: [] };
      for (const width of [null, "360px"]) {
        if (width) dialog.style.width = width;
        const rows = [...dialog.querySelectorAll(".era-inventory-use")];
        result.layouts.push({width:dialog.getBoundingClientRect().width,
          rows:rows.map(row => {
            const name = row.querySelector(".era-inventory-name");
            return {wraps:name.getBoundingClientRect().height > parseFloat(getComputedStyle(name).lineHeight) + 1,
              fits:row.scrollWidth <= row.clientWidth + 1,
              numbers:[...row.querySelectorAll(".command-number, .era-inventory-quantity")].map(number => {
                const range = document.createRange();
                range.selectNodeContents(number);
                return {lines:range.getClientRects().length, flexShrink:getComputedStyle(number).flexShrink};
              })};
          })});
      }
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("#other .command-number"));
      result.otherLines = range.getClientRects().length;
      document.body.innerHTML = "<pre id='result'>" + JSON.stringify(result) + "</pre>";
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-inventory-layout-"));
  try {
    const fixture = join(profile, "items.html");
    await writeFile(fixture, html);
    const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`,
      "--window-size=1600,1000", "--dump-dom", pathToFileURL(fixture).href];
    if (process.platform === "linux") args.unshift("--no-sandbox");
    const { stdout } = await execute(browser!, args, { maxBuffer: 4 * 1024 * 1024, timeout: 20000 });
    const match = stdout.match(/<pre id="result">([^]*?)<\/pre>/);
    assert.ok(match?.[1], stdout.slice(-4000));
    const result = JSON.parse(match[1]);
    assert.equal(result.legacyBadge, "none");
    assert.equal(result.legacyFocus, false);
    assert.equal(result.guiHint, true);
    assert.equal(result.otherLines, 1);
    assert.ok(result.layouts[0].width >= 1400, "wide dialog uses the increased width");
    for (const layout of result.layouts) {
      assert.ok(layout.rows.some((row: { wraps: boolean }) => row.wraps), "long item names still wrap");
      for (const row of layout.rows) {
        assert.equal(row.fits, true);
        for (const number of row.numbers) {
          assert.equal(number.lines, 1, "IDs and quantities occupy exactly one line");
          assert.equal(number.flexShrink, "0");
        }
      }
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("controller hint checkbox keeps native checkmark in sync after each three-state click", {
  skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH",
}, async () => {
  const [controls, controller] = await Promise.all([
    readFile(new URL("../web/controls.js", import.meta.url), "utf8"),
    readFile(new URL("../web/controller-menu.js", import.meta.url), "utf8"),
  ]);
  const html = `<!doctype html><meta charset="utf-8"><body>
    <label><input id="controller-hints-toggle" type="checkbox"><span id="controller-hints-label"></span></label>
    <dialog id="controller-menu"><div class="controller-menu-actions">
      <button>Restart</button><button>Library</button><button>Settings</button><button>Exit</button>
    </div><button id="controller-menu-close">Close</button></dialog>
    <pre id="result"></pre><script>
    ${controls.replace(/^export /gm, "")}
    ${controller.replace(/^import .+;\n/gm, "").replace(/^export /gm, "")}
    localStorage.removeItem("era-typescript.controller-hints");
    localStorage.removeItem("era-typescript.force-controller");
    window.requestAnimationFrame = () => 0;
    setupControllerMenu({restart() {}, library() {}, settings() {}, exit() {},
      canRestart: () => true, canExit: true, onError: error => { throw error; }});
    const input = document.getElementById("controller-hints-toggle");
    const states = [];
    function snapshot() {
      states.push({checked:input.checked, mixed:input.indeterminate,
        active:input.dataset.active, label:document.getElementById("controller-hints-label").textContent,
        saved:localStorage.getItem("era-typescript.controller-hints")});
    }
    snapshot();
    for (let i = 0; i < 6; i++) { input.click(); snapshot(); }
    document.getElementById("result").textContent = JSON.stringify(states);
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-checkbox-cycle-"));
  try {
    const page = join(profile, "checkbox.html");
    await writeFile(page, html);
    const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`,
      "--dump-dom", pathToFileURL(page).href];
    if (process.platform === "linux") args.unshift("--no-sandbox");
    const { stdout } = await execute(browser!, args, { maxBuffer: 2 * 1024 * 1024, timeout: 20000 });
    const match = stdout.match(/<pre id="result">([^]*?)<\/pre>/);
    assert.ok(match?.[1], stdout.slice(-4000));
    const states = JSON.parse(match[1]);
    const auto = {checked:false, mixed:true, active:"false", label:"Controller mode: Auto (Off)", saved:"auto"};
    const on = {checked:true, mixed:false, active:"true", label:"Controller mode: On", saved:"on"};
    const off = {checked:false, mixed:false, active:"false", label:"Controller mode: Off", saved:"off"};
    assert.deepEqual(states, [{...auto, saved:null}, on, off, auto, on, off, auto]);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("shared dialog inputs separate navigation and editing for keyboard, controller and pointer", {
  skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH",
}, async () => {
  const [controls, navigation, style] = await Promise.all([
    readFile(new URL("../web/controls.js", import.meta.url), "utf8"),
    readFile(new URL("../web/navigation.js", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
  ]);
  const html = `<!doctype html><style>${style}
    #fields { display:grid; grid-template-columns:repeat(4, 120px); gap:20px; }
    #fields > * { width:120px; height:40px; }
    </style><body><main id="terminal"></main><input id="command" hidden>
    <dialog id="fixture"><div id="fields"><button id="first">First</button>
    <input id="text" value="Font"><input id="color" type="color" value="#123456">
    <input id="range" type="range" min="10" max="20" step="2" value="14">
    <button id="last">Last</button><textarea id="multiline"></textarea></div></dialog><script>
      ${controls.replace(/^export /gm, "")}
      ${navigation.replace(/^import .+;\n/gm, "").replace(/^export /gm, "")}
      const fixture = document.getElementById("fixture");
      const text = document.getElementById("text"), color = document.getElementById("color");
      const range = document.getElementById("range"), multiline = document.getElementById("multiline");
      setupKeyboardNavigation({terminal:document.getElementById("terminal"),
        command:document.getElementById("command"), canNavigate:()=>true});
      fixture.showModal();
      document.getElementById("first").focus();
      const trace = [];
      let textCommits = 0;
      text.addEventListener("keydown", event => { if (event.key === "Enter") textCommits++; });
      const key = key => {
        const event = new KeyboardEvent("keydown", {key, bubbles:true, cancelable:true});
        document.activeElement.dispatchEvent(event);
        return event.defaultPrevented;
      };
      for (let i = 0; i < 3; i++) { key("ArrowRight"); trace.push(document.activeElement.id); }
      const unchanged = [text.value, color.value, range.value];
      key("ArrowLeft"); key("ArrowLeft"); key("Enter");
      const textEditing = text.classList.contains("is-control-editing");
      const nativeCaret = !key("ArrowLeft");
      text.value = "New Font";
      key("Enter");
      const committed = text.value === "New Font" && text.classList.contains("is-control-navigation");
      key("ArrowRight");
      let pickerClicks = 0;
      color.click = () => pickerClicks++;
      const colorActivated = activateNavigationControl(color);
      key("Escape");
      const colorBack = fixture.open && color.classList.contains("is-control-navigation");
      key("ArrowRight");
      const rangeBefore = range.value;
      activateNavigationControl(range);
      const events = [];
      range.addEventListener("input", () => events.push("input:" + range.value));
      range.addEventListener("change", () => events.push("change:" + range.value));
      adjustControllerRange(range, "ArrowRight");
      adjustControllerRange(range, "ArrowUp");
      adjustControllerRange(range, "ArrowRight");
      adjustControllerRange(range, "ArrowRight");
      const rangeAfter = range.value;
      key("Escape");
      const rangeBack = fixture.open && range.classList.contains("is-control-navigation");
      key("ArrowLeft");
      text.focus();
      const tabNative = !key("ArrowLeft");
      navigateControl(text);
      text.dispatchEvent(new Event("pointerdown", {bubbles:true}));
      const pointerNative = !key("ArrowLeft") && !text.classList.contains("is-control-navigation");
      multiline.focus(); navigateControl(multiline); key("Enter");
      const multilineNative = !key("Enter");
      key("Escape");
      const firstBackOpen = fixture.open;
      key("Escape");
      document.body.innerHTML = "<pre id='result'>" + JSON.stringify({
        trace, unchanged, textEditing, nativeCaret, committed, textCommits, pickerClicks, colorActivated, colorBack,
        rangeBefore, rangeAfter, events, rangeBack, tabNative, pointerNative, multilineNative,
        firstBackOpen, closed:!fixture.open
      }) + "</pre>";
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-control-navigation-"));
  try {
    const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`,
      "--window-size=1200,700", "--dump-dom", `data:text/html;base64,${Buffer.from(html).toString("base64")}`];
    if (process.platform === "linux") args.unshift("--no-sandbox");
    const { stdout } = await execute(browser!, args, { maxBuffer: 4 * 1024 * 1024, timeout: 20000 });
    const match = stdout.match(/<pre id="result">([^]*?)<\/pre>/);
    assert.ok(match, stdout.slice(-4000));
    const result = JSON.parse(match[1]!);
    assert.deepEqual(result.trace, ["text", "color", "range"]);
    assert.deepEqual(result.unchanged, ["Font", "#123456", "14"]);
    for (const name of ["textEditing", "nativeCaret", "committed", "colorActivated", "colorBack",
      "rangeBack", "tabNative", "pointerNative", "multilineNative", "firstBackOpen", "closed"]) {
      assert.equal(result[name], true, name + ": " + JSON.stringify(result));
    }
    assert.equal(result.pickerClicks, 1);
    assert.equal(result.textCommits, 1, "activation must not submit, but editing Enter must reach existing field handlers");
    assert.equal(result.rangeBefore, "14");
    assert.equal(result.rangeAfter, "20");
    assert.deepEqual(result.events, ["input:16", "change:16", "input:18", "change:18", "input:20", "change:20"]);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("compact settings retain font selection without font size or display mode controls", {
  skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH",
}, async () => {
  const [index, style, responsive] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/responsive.css", import.meta.url), "utf8"),
  ]);
  const dialog = index.slice(index.indexOf('<dialog id="settings"'), index.indexOf('<dialog id="art-demo"'));
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${responsive}</style>
    <body>${dialog}<script>
      const settings = document.getElementById("settings");
      settings.showModal();
      const name = settings.querySelector("input[name=font]").closest("label").getBoundingClientRect();
      const reset = settings.querySelector("#settings-reset").getBoundingClientRect();
      const close = settings.querySelector("#settings-close").getBoundingClientRect();
      const result = { fontVisible: name.width > 0, obsoleteControls: !!settings.querySelector("#font-size, #handheld-toggle"),
        scroll: settings.scrollHeight, client: settings.clientHeight, viewport: innerHeight,
        resetTop: reset.top, closeTop: close.top, resetRight: reset.right, closeLeft: close.left,
        resetHeight: reset.height, resetText: settings.querySelector("#settings-reset").textContent,
        headerReset: settings.querySelector(".dialog-heading").contains(settings.querySelector("#settings-reset")) };
      document.body.innerHTML = "<pre id='result'>" + JSON.stringify(result) + "</pre>";
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-settings-"));
  try {
    const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`,
      "--window-size=1280,800", "--dump-dom", `data:text/html;base64,${Buffer.from(html).toString("base64")}`];
    if (process.platform === "linux") args.unshift("--no-sandbox");
    const measure = async () => {
      const { stdout } = await execute(browser!, args, { maxBuffer: 4 * 1024 * 1024, timeout: 20000 });
      const match = stdout.match(/<pre id="result">([^]*?)<\/pre>/);
      assert.ok(match, stdout);
      return JSON.parse(match[1]);
    };
    let result = await measure();
    if (result.viewport !== 800) {
      // Chrome's window size includes platform-dependent browser chrome.
      args[args.findIndex(arg => arg.startsWith("--window-size="))] = `--window-size=1280,${1600 - result.viewport}`;
      result = await measure();
    }
    assert.equal(result.viewport, 800);
    assert.equal(result.fontVisible, true);
    assert.equal(result.obsoleteControls, false);
    assert.ok(result.scroll <= result.client, JSON.stringify(result));
    assert.equal(result.headerReset, true);
    assert.equal(result.resetText, "Reset all");
    assert.equal(result.resetTop, result.closeTop);
    assert.ok(result.resetRight < result.closeLeft);
    assert.ok(result.resetHeight >= 36);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("reviving a checkbox restores only its native input as a tab stop", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("function reviveScreen(");
  const end = source.indexOf("const SCROLLBACK_LINES", start);
  let tabIndex: number | null = -1;
  const label = {
    matches: (selector: string) => selector.includes(".checkbox-control"),
    removeAttribute(name: string) { assert.equal(name, "tabindex"); tabIndex = null; },
    set tabIndex(value: number) { tabIndex = value; },
  };
  const group = {
    classList: { replace() {} },
    querySelectorAll: (selector: string) => selector === "[data-tooltip]" ? [label] : [],
  };
  const revive = runInNewContext(`${source.slice(start, end)}\nreviveScreen`, {
    restoreHistoryScreen() {}, currentScreen: null, currentLine: null,
  });
  revive(group);
  assert.equal(tabIndex, null, "the label must not duplicate its input's tab stop");
});

test("native game checkboxes share clear styling and preserve runtime state on activation", {
  skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH",
}, async () => {
  const [controls, style, responsive] = await Promise.all([
    readFile(new URL("../web/controls.js", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/responsive.css", import.meta.url), "utf8"),
  ]);
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${responsive}</style>
    <body><section class="screen is-active"><div class="line" id="controls"></div></section>
    <button class="ui-button ui-button--quiet ui-button--continue" id="continue-hint" type="button" hidden>Click to continue</button><script>
      ${controls.replace(/^export /gm, "")}
      let calls = 0;
      const unchecked = createCheckbox(false, () => calls++);
      const checked = createCheckbox(true, () => calls++);
      const mixed = createCheckbox("mixed", () => calls++);
      for (const [label, text] of [[unchecked, "Auto-Clean"], [checked, "Petting"]]) {
        label.classList.add("choice", "era-toggle");
        label.querySelector("span").textContent = text;
        document.getElementById("controls").append(label);
      }
      checked.classList.add("era-kind-petting");
      mixed.querySelector("span").textContent = "Auto-moan: Yes (Ahegao)";
      document.getElementById("controls").append(mixed);
      const mixedBefore = choiceControl(mixed).indeterminate;
      mixed.click();
      const mixedAfter = choiceControl(mixed).indeterminate;
      calls = 0;
      const appearance = label => {
        const style = getComputedStyle(label);
        return { border: style.borderColor, background: style.backgroundColor,
          before: style.content, height: label.getBoundingClientRect().height };
      };
      const off = appearance(unchecked), on = appearance(checked);
      setCheckboxState(choiceControl(mixed), "mixed", false);
      const autoOff = appearance(mixed);
      setCheckboxState(choiceControl(mixed), "mixed", true);
      const autoOn = appearance(mixed);
      setCheckboxState(choiceControl(mixed), false);
      const cycleOff = appearance(mixed);
      unchecked.click();
      checked.click();
      const activated = calls;
      const states = [choiceControl(unchecked).checked, choiceControl(checked).checked];
      choiceControl(unchecked).disabled = true;
      unchecked.click();
      const disabledCalls = calls;
      const clone = checked.cloneNode(true);
      const clonedState = choiceControl(clone).checked;
      const compactHeight = appearance(checked).height;
      const hint = document.getElementById("continue-hint");
      const hiddenHint = getComputedStyle(hint).display;
      hint.hidden = false;
      const hintStyle = getComputedStyle(hint);
      const visibleHint = { color: hintStyle.color, fontStyle: hintStyle.fontStyle, display: hintStyle.display, text: hint.textContent, animation: hintStyle.animationName, duration: hintStyle.animationDuration };
      const hoverRules = [];
      for (const rule of document.styleSheets[0].cssRules) {
        if (rule.media?.mediaText !== "(hover: hover)") continue;
        for (const child of rule.cssRules) hoverRules.push(child.selectorText);
      }
      document.body.innerHTML = "<pre id='result'>" + JSON.stringify({
        off, on, activated, states, disabledCalls, clonedState, compactHeight,
        hiddenHint, visibleHint,
        mixedBefore, mixedAfter,
        autoOff, autoOn, cycleOff,
        hoverGuards: { checkbox: hoverRules.includes(".checkbox-control:has(> input:enabled):hover"),
          button: hoverRules.some(selector => selector?.includes(".ui-button") && selector.includes(":hover")) },
        nestedButtons: checked.querySelectorAll("button").length
      }) + "</pre>";
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-checkboxes-"));
  try {
    const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`,
      "--window-size=1200,700", "--dump-dom", `data:text/html;base64,${Buffer.from(html).toString("base64")}`];
    if (process.platform === "linux") args.unshift("--no-sandbox");
    const { stdout } = await execute(browser!, args, { maxBuffer: 4 * 1024 * 1024, timeout: 20000 });
    const match = stdout.match(/<pre id="result">([^]*?)<\/pre>/);
    assert.ok(match, stdout);
    const result = JSON.parse(match[1]);
    assert.equal(result.hoverGuards.checkbox, true);
    assert.equal(result.hoverGuards.button, true);
    assert.notEqual(result.off.border, result.on.border);
    assert.notEqual(result.off.background, result.on.background);
    assert.equal(result.autoOff.border, result.off.border);
    assert.equal(result.autoOff.background, result.off.background);
    assert.equal(result.cycleOff.border, result.off.border);
    assert.equal(result.cycleOff.background, result.off.background);
    assert.notEqual(result.autoOn.border, result.autoOff.border);
    assert.notEqual(result.autoOn.background, result.autoOff.background);
    assert.equal(result.on.border, "rgb(192, 96, 154)");
    assert.equal(result.activated, 2, "label activation sends one command per checkbox");
    assert.deepEqual(result.states, [false, true], "preventDefault keeps authoritative state");
    assert.equal(result.disabledCalls, 2, "disabled checkboxes send no command");
    assert.equal(result.clonedState, true, "render staging clones keep the check");
    assert.equal(result.nestedButtons, 0);
    assert.equal(result.mixedBefore, true);
    assert.equal(result.mixedAfter, true, "a rejected cycle keeps the indeterminate state");
    assert.ok(result.compactHeight > 0, `compact checkbox height: ${result.compactHeight}`);
    assert.equal(result.hiddenHint, "none");
    assert.equal(result.visibleHint.display, "flex");
    assert.equal(result.visibleHint.color, "rgb(155, 167, 184)");
    assert.equal(result.visibleHint.fontStyle, "normal");
    assert.equal(result.visibleHint.text, "Click to continue");
    assert.equal(result.visibleHint.animation, "continue-hint-pulse");
    assert.equal(result.visibleHint.duration, "2.4s");
    const { stdout: reducedOutput } = await execute(browser!, [
      ...args.slice(0, -1), "--force-prefers-reduced-motion", args.at(-1)!,
    ], { maxBuffer: 4 * 1024 * 1024, timeout: 20000 });
    const reducedMatch = reducedOutput.match(/<pre id="result">([^]*?)<\/pre>/);
    assert.ok(reducedMatch, reducedOutput);
    assert.equal(JSON.parse(reducedMatch[1]).visibleHint.animation, "none");
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});
