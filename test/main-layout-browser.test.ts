import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compactPicture } from "../src/graphics.js";
import { emptyGame, indexScript } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";
import { createApp } from "../src/server.js";

const execute = promisify(execFile);
const navigationSource = await readFile(new URL("../web/navigation.js", import.meta.url), "utf8");
const commandDecoration = navigationSource.slice(navigationSource.indexOf("export function decorateCommandNumbers("),
  navigationSource.indexOf("export function directionalTarget(")).replace(/^export /gm, "");
const decorateButtons = `${commandDecoration}
  document.querySelectorAll("button.choice").forEach(button => {
    button.dataset.value ??= button.getAttribute("value");
    decorateCommandNumbers(button);
  });`;
const browser = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
].find((path): path is string => !!path && existsSync(path));

test("scene chatter hides empty diamond lines without dropping logical output or non-text content", {
  skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH",
}, async () => {
  const [source, style] = await Promise.all([
    readFile(new URL("../web/app.js", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
  ]);
  const helper = source.slice(source.indexOf("function syncSceneLines("), source.indexOf("function mainChatInput("));
  assert.match(source, /for \(const scene of outputRoot\.querySelectorAll\("\.screen\.is-active \.era-scene"\)\) syncSceneLines\(scene\);/);
  const html = `<!doctype html><meta charset="utf-8"><style>${style}</style><body>
    <div class="screen is-active"><div class="era-room-stage">
      <div class="era-box era-scene" data-closed="closed">
        <div class="line era-marker"></div>
        <div class="line"><span class="output-text">◆</span><span class="output-text is-empty"></span></div>
        <div class="line"><span> ◆ </span><span>   </span></div>
        <div class="line"><span> </span></div>
        <div class="line"><span>◆</span><span>You hear the radio crackling...</span></div>
        <div class="line"><span>◆</span><button class="choice"></button></div>
        <div class="line"><span>◆</span><canvas width="1" height="1"></canvas></div>
        <div class="line era-marker era-close-line"></div>
      </div>
      <div class="era-box era-scene" id="empty">
        <div class="line era-marker"></div><div class="line"><span>◆</span></div>
        <div class="line era-marker era-close-line"></div>
      </div>
    </div><div class="line" id="outside"><span>◆</span></div></div><script>
      ${helper}
      document.querySelectorAll(".era-scene").forEach(syncSceneLines);
      const scene = document.querySelector(".era-scene");
      const lines = [...scene.querySelectorAll(".line")];
      const hidden = lines.map(line => getComputedStyle(line).display === "none");
      const retained = lines.length === 8 && scene.dataset.closed === "closed";
      const emptyHidden = getComputedStyle(document.querySelector("#empty")).display === "none";
      const outsideVisible = getComputedStyle(document.querySelector("#outside")).display !== "none";
      lines[1].append(document.createTextNode("Later text"));
      syncSceneLines(scene);
      const resumed = !lines[1].hidden && getComputedStyle(lines[1]).display !== "none";
      const spaced = lines[4].textContent === "◆ You hear the radio crackling..."
        && lines[1].textContent === "◆ Later text";
      const inline = document.createElement("div");
      inline.className = "line";
      inline.innerHTML = "<span>◆Inline text</span>";
      scene.append(inline);
      const alreadySpaced = document.createElement("div");
      alreadySpaced.className = "line";
      alreadySpaced.textContent = "◆ Already spaced";
      scene.append(alreadySpaced);
      syncSceneLines(scene);
      syncSceneLines(scene);
      const spacingStable = inline.textContent === "◆ Inline text"
        && alreadySpaced.textContent === "◆ Already spaced"
        && lines[4].textContent === "◆ You hear the radio crackling...";
      document.body.textContent = JSON.stringify({hidden, retained, emptyHidden, outsideVisible, resumed, spaced, spacingStable});
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-scene-lines-"));
  try {
    const { stdout } = await execute(browser!, ["--headless", "--disable-gpu", "--no-first-run",
      `--user-data-dir=${profile}`, "--dump-dom", `data:text/html;base64,${Buffer.from(html).toString("base64")}`],
      { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
    const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
    assert.ok(match);
    assert.deepEqual(JSON.parse(match[1]), {
      hidden: [true, true, true, true, false, false, false, true],
      retained: true, emptyHidden: true, outsideVisible: true, resumed: true, spaced: true, spacingStable: true,
    });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("inventory and item-use rows share responsive scrolling, quantities and live filtering", {
  skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH",
}, async () => {
  const [source, patch, attributes, style] = await Promise.all([
    readFile(new URL("../web/app.js", import.meta.url), "utf8"),
    readFile(new URL("../hotpatch/ITEM_LIST.ERB", import.meta.url), "utf8"),
    readFile(new URL("../hotpatch/INFO_PALAM.ERB", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
  ]);
  const filter = source.slice(source.indexOf('let inventoryQuery = "";'), source.indexOf("/**", source.indexOf("function syncInventory(")));
  const game = emptyGame();
  indexScript(game, attributes.slice(attributes.indexOf("@HOTPATCH_ATTRIBUTE(")), "<attributes>");
  indexScript(game, patch.slice(patch.indexOf("@HOTPATCH_INVENTORY_ITEM("), patch.indexOf("@COM490\n")), "<rows>");
  indexScript(game, `@SYSTEM_TITLE
FOR LOCAL, 0, 40
ITEM:LOCAL = LOCAL + 1
HTML_PRINT HOTPATCH_INVENTORY_ITEM(LOCAL, 1)
NEXT
BINPUT
@ITEMNAME_TR(ARG)
#FUNCTIONS
RETURNF @"Energy drink {ARG} with a long item name"
@ITEM_EXPLANATION(ARG)
#FUNCTIONS
RETURNF "Restores energy."`, "<rows-fixture>");
  const snapshot = new Runtime(game).start();
  assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
  const rows = snapshot.output.flatMap(item => item.type === "html" ?
    [`<div class="line"><span>${item.text.replace("class='era-inventory-item", "class='choice era-inventory-item")}</span></div>`] : []).join("");
  const html = `<!doctype html><style>${style}</style><body><div class="screen is-active">
    <div class="era-dialog era-inventory era-item-use" popover>
      <div class="line"><div class="era-inventory-header"><div class="era-inventory-heading">
        <span class="era-inventory-title">Items</span><button class="choice era-dialog-close">Close</button></div></div></div>
      <div class="era-inventory-body"><div class="era-inventory-grid">${rows}</div>
        <div class="line"><div class="era-inventory-empty">No items in this category.</div></div></div>
      <div class="line"><div class="era-inventory-footer"><span class="era-inventory-filter"></span>
        <span class="era-inventory-count"></span><button class="choice era-chip-button">Return</button></div></div>
    </div></div><script>
    ${decorateButtons}
    const hideTooltip = () => {};
    ${filter}
    const dialog = document.querySelector(".era-inventory");
    dialog.showPopover();
    syncInventory(dialog);
    const body = dialog.querySelector(".era-inventory-body");
    const first = dialog.querySelector(".era-inventory-item");
    let clicked = null;
    first.addEventListener("click", () => clicked = first.getAttribute("value"));
    first.click();
    const bounds = first.getBoundingClientRect(), quantity = first.querySelector(".era-inventory-quantity").getBoundingClientRect();
    const layout = {scrolls:body.scrollHeight > body.clientHeight,
      fits:body.scrollWidth <= body.clientWidth + 1 && dialog.getBoundingClientRect().right <= innerWidth,
      quantityAtRight:Math.abs(bounds.right - quantity.right) <= 3,
      wholeRow:Math.abs(bounds.width - first.closest(".line").getBoundingClientRect().width) <= 1};
    const input = dialog.querySelector("input");
    input.value = " ENERGY DRINK 39 ";
    input.dispatchEvent(new Event("input", {bubbles:true}));
    const count = dialog.querySelector(".era-inventory-count").textContent;
    const matches = [...dialog.querySelectorAll(".era-inventory-item")].filter(item => !item.closest(".line").hidden).length;
    input.value = "missing";
    input.dispatchEvent(new Event("input", {bubbles:true}));
    const empty = dialog.querySelector(".era-inventory-empty");
    const noMatch = !empty.closest(".line").hidden && empty.textContent === "No items match your filter.";
    dialog.classList.remove("era-item-use");
    syncInventory(dialog);
    const sharedQuery = input.value === "missing";
    input.value = "";
    input.dispatchEvent(new Event("input", {bubbles:true}));
    document.body.textContent = JSON.stringify({...layout, clicked, count, matches, noMatch, sharedQuery,
      reset:dialog.querySelector(".era-inventory-count").textContent === "40 item types" && empty.closest(".line").hidden});
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-inventory-rows-"));
  try {
    for (const size of ["1280,900", "390,720"]) {
      const { stdout } = await execute(browser!, ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`,
        `--window-size=${size}`, "--dump-dom", `data:text/html;base64,${Buffer.from(html).toString("base64")}`],
        { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
      const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
      assert.ok(match);
      assert.deepEqual(JSON.parse(match[1]), {scrolls:true, fits:true, quantityAtRight:true, wholeRow:true,
        clicked:"0", count:"1 of 40 item types", matches:1, noMatch:true, sharedQuery:true, reset:true}, size);
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("Config editors preserve printed choice rows and require explicit full-width list buttons", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [source, attributes] = await Promise.all([
    readFile(new URL("../hotpatch/MAIN_SCREEN_COMMANDS.ERB", import.meta.url), "utf8"),
    readFile(new URL("../hotpatch/INFO_PALAM.ERB", import.meta.url), "utf8"),
  ]);
  const game = emptyGame();
  indexScript(game, attributes.slice(attributes.indexOf("@HOTPATCH_ATTRIBUTE(")), "<attributes>");
  indexScript(game, source.slice(source.indexOf("@HOTPATCH_BUTTON(")), "<buttons>");
  indexScript(game, `@SYSTEM_TITLE
HTML_PRINT "<era-open class='era-dialog era-setup era-config era-setup-editor'>"
HTML_PRINT "<era-open class='era-inventory-body era-setup-body'>"
CALL PICK_CHARACTER
HTML_PRINT "<era-close>"
HTML_PRINT "<era-close>"
INPUT
@PICK_CHARACTER
#DIM FIRST_LINE
FIRST_LINE = LINECOUNT
$REPRINT
CLEARLINE LINECOUNT - FIRST_LINE
FOR LOCAL, 0, 8
  PRINTFORM [{LOCAL,3}] Character {LOCAL}
  SIF (LOCAL + 1) % 4 == 0
    PRINTL
NEXT
PRINTBUTTON "[8] Inline button", 8
PRINTBUTTON "[9] Another button", 9
PRINTL
PRINTL [10] Single native choice: No
HTML_PRINT HOTPATCH_BUTTON("Explicit setting", 11, "", "list", "", "On", "Inline help")
INPUT
CALL EDIT_CHARACTER
GOTO REPRINT
@EDIT_CHARACTER
LOCAL:1 = RESULT
GCREATE 1, 720, 720
SPRITECREATE "debug-portrait", 1, 0, 0, 720, 720
HTML_PRINT "<img src='debug-portrait' width='180px' height='180px'>"
FOR LOCAL, 0, 12
  PRINTL
NEXT
PRINTFORML Chosen {LOCAL:1}
PRINT [99] Back
INPUT`, "<config-editor-fixture>");
  const app = createApp([{ id: "fixture", title: "Config choices", game }], true);
  const server = createServer((request, response) => {
    if (request.url !== "/config-probe") { app.emit("request", request, response); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><iframe id="game" src="/?game=fixture" style="width:1280px;height:800px"></iframe>
      <pre id="result"></pre><script>
      const frame = document.querySelector("#game");
      const pause = () => new Promise(resolve => setTimeout(resolve, 100));
      async function until(read) {
        for (let i = 0; i < 180; i++) { const value = read(); if (value) return value; await pause(); }
        throw new Error("Config fixture did not become ready");
      }
      (async () => {
        const doc = await until(() => {
          const doc = frame.contentDocument;
          return doc?.querySelector(".era-config button[data-value='0']:enabled")
            && !doc.body.classList.contains("is-busy") && doc;
        });
        await doc.fonts.ready;
        const button = value => doc.querySelector(".era-config button[data-value='" + value + "']");
        const rect = value => button(value).getBoundingClientRect();
        const result = {
          paddedNumber: button(0).querySelector(".command-number").textContent === "[  0]"
            && frame.contentWindow.getComputedStyle(button(0).querySelector(".command-number")).whiteSpace === "pre",
          nativeTextAlign: frame.contentWindow.getComputedStyle(button(10)).textAlign,
          numberOpacity: frame.contentWindow.getComputedStyle(button(0).querySelector(".command-number")).opacity,
          rows: [0, 4].every(start => [1, 2, 3].every(offset =>
            Math.abs(rect(start).top - rect(start + offset).top) < 1
            && rect(start + offset).left > rect(start + offset - 1).left)),
          newline: rect(4).top >= rect(0).bottom,
          printButtonsInline: Math.abs(rect(8).top - rect(9).top) < 1 && rect(9).left > rect(8).left,
          native: [...Array(11).keys()].every(value => !button(value).classList.contains("era-button-list")),
          singleLabel: button(10).textContent,
          explicitList: button(11).classList.contains("era-button-list"),
          fullWidth: Math.abs(rect(11).width - button(11).closest(".line").getBoundingClientRect().width) < 1,
          help: button(11).querySelector(".era-config-help").textContent
        };
        const coloredOutput = button(0).closest(".output-text");
        coloredOutput.style.setProperty("--output-color", "#ffff00");
        result.coloredNumberOpacity = frame.contentWindow.getComputedStyle(button(0).querySelector(".command-number")).opacity;
        coloredOutput.style.removeProperty("--output-color");
        button(2).click();
        await until(() => !doc.body.classList.contains("is-busy") && doc.querySelector("#terminal").textContent.includes("Chosen 2"));
        result.clicked = true;
        const back = await until(() => doc.querySelector(".screen.is-active button[data-value='99']:enabled"));
        result.editorInDialog = !!back.closest(".era-config");
        const portrait = doc.querySelector(".screen.is-active .sprite-clip");
        const runtime = await fetch("/api/runtime").then(response => response.json());
        const scale = parseFloat(frame.contentWindow.getComputedStyle(doc.querySelector("#terminal")).lineHeight)
          / runtime.metrics.lineHeight;
        const portraitRect = portrait.getBoundingClientRect();
        result.requestedImageSize = Math.abs(portraitRect.width - 180 * scale) < 1
          && Math.abs(portraitRect.height - 180 * scale) < 1;
        const caption = [...doc.querySelectorAll(".screen.is-active .line")].find(line => line.textContent.includes("Chosen 2"));
        result.portraitAboveText = !!portrait && caption.getBoundingClientRect().top >= portrait.getBoundingClientRect().bottom;
        result.blankLinesVisible = [...doc.querySelectorAll(".era-config .line")]
          .filter(line => line.querySelector(":scope > .is-empty:only-child"))
          .every(line => line.getBoundingClientRect().height > 0);
        back.click();
        await until(() => !doc.body.classList.contains("is-busy")
          && doc.querySelector(".screen.is-active button[data-value='0']:enabled"));
        const returned = doc.querySelector(".screen.is-active button[data-value='0']");
        result.returnedInDialog = !!returned.closest(".era-config:popover-open");
        result.preservesSpaces = frame.contentWindow.getComputedStyle(returned.closest(".line")).whiteSpace === "pre-wrap";
        result.returnedRows = [1, 2, 3].every(value => {
          const next = doc.querySelector(".screen.is-active button[data-value='" + value + "']");
          return Math.abs(next.getBoundingClientRect().top - returned.getBoundingClientRect().top) < 1;
        });
        document.querySelector("#result").textContent = JSON.stringify(result);
      })().catch(error => document.querySelector("#result").textContent = JSON.stringify({error:error.message}));
      </script>`);
  });
  const profile = await mkdtemp(join(process.cwd(), ".era-config-submenus-"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const { stdout } = await execute(browser!, ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`,
      "--window-size=1440,900", "--virtual-time-budget=30000", "--dump-dom", `http://127.0.0.1:${address.port}/config-probe`],
      { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
    const match = stdout.match(/<pre id="result">([^<]+)<\/pre>/);
    assert.ok(match, stdout.slice(0, 2000));
    assert.deepEqual(JSON.parse(match[1]!.replaceAll("&quot;", '"').replaceAll("&amp;", "&")), {
      paddedNumber: true, nativeTextAlign: "left", numberOpacity: "0.65", coloredNumberOpacity: "1",
      rows: true, newline: true, printButtonsInline: true, native: true,
      singleLabel: "[10] Single native choice: No", explicitList: true, fullWidth: true, help: "Inline help", clicked: true,
      editorInDialog: true, returnedInDialog: true, preservesSpaces: true, returnedRows: true,
      portraitAboveText: true, blankLinesVisible: true, requestedImageSize: true,
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    app.closeAllConnections();
    await rm(profile, { recursive: true, force: true });
  }
});

test("config list buttons are borderless single-column rows with right-hand help", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [source, attributes, style] = await Promise.all([
    readFile(new URL("../hotpatch/MAIN_SCREEN_COMMANDS.ERB", import.meta.url), "utf8"),
    readFile(new URL("../hotpatch/INFO_PALAM.ERB", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
  ]);
  const game = emptyGame();
  indexScript(game, attributes.slice(attributes.indexOf("@HOTPATCH_ATTRIBUTE(")), "<attributes>");
  indexScript(game, source.slice(source.indexOf("@HOTPATCH_BUTTON(")), "<buttons>");
  indexScript(game, `@SYSTEM_TITLE
HTML_PRINT HOTPATCH_BUTTON("Setting <one>", 1, "It's help", "list", "", "On", "Helpful <text>")
HTML_PRINT HOTPATCH_BUTTON("Setting two", 2, "", "list", "era-config-hidden", "Off", "More help", 0)
HTML_PRINT HOTPATCH_BUTTON("Setting three", 123, "", "list", "", "On", "More help")
HTML_PRINT HOTPATCH_BUTTON("Long answer", 4, "", "list", "", "A considerably longer answer than twenty-three characters", "Help")
HTML_PRINT HOTPATCH_BUTTON("Disabled setting", 5, "", "list", "", " No ", "Help")
BINPUT`, "<list-fixture>");
  const snapshot = new Runtime(game).start();
  assert.equal(snapshot.error, null);
  const markup = snapshot.output.flatMap(item => item.type === "html" ?
    [`<div class="line"><span class="output-text">${item.text.replace("class='era-button", "class='choice era-button")}</span></div>`] : []).join("");
  assert.match(markup, /data-command-number='1'/);
  assert.match(markup, /era-config-label'>Setting &lt;one&gt;/);
  assert.doesNotMatch(markup, /class='command-number'/);
  assert.match(markup, /Helpful &lt;text&gt;/);
  assert.match(markup, /aria-disabled='true'/);
  const html = `<!doctype html><style>${style}</style><body><div class="screen is-active"><div class="era-dialog era-setup era-config" popover>
    <div class="era-config-grid">${markup}</div></div></div><script>${decorateButtons}
    document.querySelector(".era-config").showPopover();
    const buttons = [...document.querySelectorAll("button")];
    const first = buttons[0], second = buttons[1], css = getComputedStyle(first);
    const label = first.querySelector(".era-config-label").getBoundingClientRect();
    const help = first.querySelector(".era-config-help").getBoundingClientRect();
    const state = first.querySelector(".era-config-state").getBoundingClientRect();
    const probe = document.createElement("span");
    probe.style.cssText = "display:block;width:85ch;grid-column:1";
    first.append(probe);
    const minimumWidth = probe.getBoundingClientRect().width;
    probe.remove();
    const number = first.querySelector(".command-number");
    const numberProbe = document.createElement("span");
    numberProbe.style.cssText = "display:inline-block;width:5ch";
    number.append(numberProbe);
    const fiveCh = numberProbe.getBoundingClientRect().width;
    numberProbe.remove();
    const labelText = document.createRange();
    labelText.selectNode(first.querySelector(".era-config-label").firstChild);
    const numberAligned = Math.abs(number.getBoundingClientRect().width - fiveCh) < 1
      && Math.abs(buttons[2].querySelector(".command-number").getBoundingClientRect().width - fiveCh) < 1
      && getComputedStyle(number).textAlign === "right";
    const numberGap = Math.abs(labelText.getBoundingClientRect().left - number.getBoundingClientRect().right - fiveCh / 5) < 1;
    const thirdTop = buttons[2].getBoundingClientRect().top;
    const hidden = getComputedStyle(second).visibility === "hidden";
    second.classList.remove("era-config-hidden");
    const grid = document.querySelector(".era-config-grid");
    const initialWidth = first.querySelector(".era-config-setting").getBoundingClientRect().width;
    grid.style.width = "2400px";
    const grows = first.querySelector(".era-config-setting").getBoundingClientRect().width > initialWidth;
    grid.style.width = "500px";
    const narrowHelp = first.querySelector(".era-config-help").getBoundingClientRect();
    const narrowSetting = first.querySelector(".era-config-setting").getBoundingClientRect();
    const stacks = narrowHelp.top >= narrowSetting.bottom && first.scrollWidth <= first.clientWidth + 1;
    grid.style.width = "";
    document.body.textContent = JSON.stringify({border:css.borderWidth, padding:css.padding, background:css.backgroundColor,
      sameColumn:first.getBoundingClientRect().left === second.getBoundingClientRect().left,
      below:second.getBoundingClientRect().top >= first.getBoundingClientRect().bottom,
      right:help.left > label.right, sameRow:Math.abs(help.top - label.top) < 10,
      minimumSetting:initialWidth >= minimumWidth - 1,
      unrestrictedState:getComputedStyle(first.querySelector(".era-config-state")).minWidth === "auto" &&
        getComputedStyle(first.querySelector(".era-config-state")).maxWidth === "none",
      grows, stacks, numberAligned, numberGap,
      dimmedNo:getComputedStyle(buttons[4].querySelector(".era-config-state")).opacity === "0.5",
      dimmedLabel:getComputedStyle(buttons[4].querySelector(".era-config-label")).opacity === "0.5",
      normalHelp:getComputedStyle(buttons[4].querySelector(".era-config-help")).opacity === "1",
      dimmedOff:getComputedStyle(second.querySelector(".era-config-state")).opacity === "0.5",
      normalOn:getComputedStyle(first.querySelector(".era-config-state")).opacity === "1",
      growingState:buttons[3].querySelector(".era-config-state").getBoundingClientRect().width > state.width,
      helpGap:Math.abs(help.left - state.right - 16) < 1,
      hidden, stable:buttons[2].getBoundingClientRect().top === thirdTop,
      fullWidth:document.querySelector(".era-config").getBoundingClientRect().width >= innerWidth - 24});
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-config-list-"));
  try {
    const { stdout } = await execute(browser!, ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`,
      "--window-size=1440,900", "--dump-dom", `data:text/html;base64,${Buffer.from(html).toString("base64")}`],
      { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
    const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
    assert.ok(match);
    assert.deepEqual(JSON.parse(match[1]), { border: "0px", padding: "0px", background: "rgba(0, 0, 0, 0)",
      sameColumn: true, below: true, right: true, sameRow: true, minimumSetting: true, unrestrictedState: true,
      grows: true, stacks: true, numberAligned: true, numberGap: true, growingState: true, dimmedNo: true, dimmedLabel: true, normalHelp: true, dimmedOff: true, normalOn: true,
      helpGap: true, hidden: true, stable: true, fullWidth: true });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("shared sidebar buttons place muted numbers after labels and hide them consistently", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [source, attributes, style, responsive] = await Promise.all([
    readFile(new URL("../hotpatch/MAIN_SCREEN_COMMANDS.ERB", import.meta.url), "utf8"),
    readFile(new URL("../hotpatch/INFO_PALAM.ERB", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/responsive.css", import.meta.url), "utf8"),
  ]);
  const game = emptyGame();
  indexScript(game, attributes.slice(attributes.indexOf("@HOTPATCH_ATTRIBUTE(")), "<attribute-helper>");
  indexScript(game, source.slice(source.indexOf("@HOTPATCH_BUTTON(")), "<button-helper>");
  indexScript(game, source.slice(source.indexOf("@HOTPATCH_PRINT_COM("), source.indexOf("@HOTPATCH_ACTION_KIND(")), "<command-helper>");
  indexScript(game, `@SYSTEM_TITLE
HTML_PRINT "<era-open class='era-actions-group'>"
HTML_PRINT HOTPATCH_BUTTON("Move", 400, "", "block", "era-travel-button")
HTML_PRINT HOTPATCH_BUTTON("Go Out", 405, "", "block", "era-travel-button")
HTML_PRINT "<era-close>"
HTML_PRINT "<era-open class='era-settings'>"
HTML_PRINT HOTPATCH_BUTTON("Config", 809, "", "block")
HTML_PRINT "<era-close>"
CALL HOTPATCH_PRINT_COM(352)
HTML_PRINT HOTPATCH_BUTTON("A&B <test>", -12, "It's <safe>", "default", "custom")
HTML_PRINT HOTPATCH_BUTTON("Inventory", 805, "", "block", "", "", "", 1, "›")
BINPUT`, "<button-fixture>");
  const snapshot = new Runtime(game).start();
  assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
  assert.deepEqual(snapshot.input?.buttonValues, ["400", "405", "809", "352", "-12", "805"]);
  const buttons = snapshot.output.flatMap(item => item.type === "html" ? [item.text] : []).join("");
  assert.match(buttons, /A&amp;B &lt;test&gt;/);
  assert.match(buttons, /title='It&#39;s &lt;safe&gt;'/);
  assert.match(buttons, /data-command-number='805' data-suffix='›'/);
  assert.match(buttons, /<button value='352' class='era-button [^>]*data-command-number='352'[^>]*>Relationship\.\.\.<\/button>/);
  assert.doesNotMatch(buttons, /era-guard-control|print-cell/);
  assert.doesNotMatch(source, /<button value='352'/);
  for (const [label, value] of [["Move", 400], ["Go Out", 405], ["Config", 809]] as const) {
    assert.match(source, new RegExp(`HOTPATCH_BUTTON\\("${label}", ${value},`));
    assert.match(buttons, new RegExp(`data-command-number='${value}'[^>]*>${label}</button>`));
  }
  const markup = snapshot.output.flatMap(item => {
    if (item.type !== "html") return [];
    if (item.text.startsWith("<era-open")) return [item.text.replace("<era-open", "<div")];
    if (item.text === "<era-close>") return ["</div>"];
    return [`<div class="line"><span class="output-text">${item.text.replaceAll("class='era-button", "class='choice era-button")}</span></div>`];
  }).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${responsive}</style>
    <body class="MODE"><div class="screen is-active"><div class="era-main"><div class="era-player">
    <div class="era-player-management" style="width:360px;font-size:20px">${markup}</div>
    </div></div></div><script>${decorateButtons}
      const results = [...document.querySelectorAll(".era-button")].map(button => {
        const number = button.querySelector(".command-number"), rect = button.getBoundingClientRect();
        const label = document.createRange(); label.selectNodeContents(button.firstChild);
        const labelRect = label.getBoundingClientRect(), numberRect = number.getBoundingClientRect();
        return { value: button.getAttribute("value"), text: button.textContent, width: rect.width,
          top: rect.top, left: rect.left, right: rect.right, textAlign: getComputedStyle(button).textAlign,
          font: parseFloat(getComputedStyle(button).fontSize), numberFont: parseFloat(getComputedStyle(number).fontSize),
          numberColor: getComputedStyle(number).color, numberDisplay: getComputedStyle(number).display,
          display: getComputedStyle(button).display, numberMargin: getComputedStyle(number).marginLeft,
          numberGap: numberRect.left - labelRect.right,
          numberAfterLabel: numberRect.left >= labelRect.right };
      });
      // dump-dom has no active window; exercise both pseudo-state cascades with equivalent classes.
      const style = document.querySelector("style");
      style.textContent = style.textContent.replaceAll(":hover", ".test-hover").replaceAll(":focus-visible", ".test-focus");
      const highlightColors = ["test-hover", "test-focus"].flatMap(state =>
        [...document.querySelectorAll(".era-button")].map(button => {
          const labelBefore = getComputedStyle(button).color;
          button.classList.add(state);
          const result = { state, labelBefore, labelAfter: getComputedStyle(button).color,
            numberAfter: getComputedStyle(button.querySelector(".command-number")).color };
          button.classList.remove(state);
          return result;
        }));
      document.body.textContent = JSON.stringify({ results, highlightColors });
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-numbered-buttons-"));
  try {
    for (const [mode, size, hidden] of [["desktop", "1440,1000", false], ["compact", "1200,700", false]] as const) {
      const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, `--window-size=${size}`, "--dump-dom"];
      if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
      args.push(`data:text/html;base64,${Buffer.from(html.replace("MODE", mode)).toString("base64")}`);
      const { stdout } = await execute(browser!, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
      const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
      assert.ok(match);
      const measured = JSON.parse(match[1]) as { results: Array<{
        value: string; text: string; width: number; top: number; left: number; right: number;
        textAlign: string; font: number; numberFont: number; numberColor: string; numberDisplay: string; numberAfterLabel: boolean;
        display: string; numberMargin: string; numberGap: number;
      }>; highlightColors: Array<{ state: string; labelBefore: string; labelAfter: string; numberAfter: string }> };
      const { results, highlightColors } = measured;
      for (const colors of highlightColors) {
        assert.equal(colors.labelAfter, colors.labelBefore, `${colors.state} preserves the label color`);
        assert.equal(colors.numberAfter, "rgb(255, 255, 0)", "only the command number turns yellow");
      }
      for (const button of results) {
        assert.equal(button.textAlign, "left");
        assert.equal(button.numberFont / button.font, .8);
        assert.equal(button.numberColor, "rgb(183, 213, 226)");
        assert.equal(button.numberDisplay === "none", hidden, `${mode} ${size}: ${button.text}`);
        if (!hidden) assert.equal(button.numberAfterLabel, true, button.text);
      }
      const [move, goOut, config] = results;
      const inventory = results.find(button => button.value === "805")!;
      assert.equal(inventory.display, "inline-flex", "Inventory uses the same layout as other standard buttons");
      assert.equal(inventory.numberMargin, results[0]!.numberMargin, "Inventory shares standard command-number spacing");
      if (!hidden) assert.ok(inventory.numberGap > 0, "the number is separated from the label");
      assert.equal(move.top, goOut.top, "travel buttons stay side by side");
      assert.ok(goOut.left >= move.right, "travel buttons do not overlap");
      assert.ok(config.top > move.top);
      assert.equal(config.width, 360, "Config retains its full-width click target");
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

type Measurements = {
  room: number;
  roomVisible: number;
  roomScroll: number;
  actions: number;
  actionsClient: number;
  actionsScroll: number;
  actionsSpare: number;
  grid: string;
  detail: number[];
  historyDisplay: string;
  historyHeight: number;
  historyPaneHeight: number;
  historyLineHeight: number;
  historyScrollable: boolean;
  historyWithStatusHeight: number;
  historyForcedHeight: number;
  gaps: number[];
};

test("browser renders compacted runtime graphics under the server content security policy", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const app = createApp(emptyGame());
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  const profile = await mkdtemp(join(process.cwd(), ".era-graphics-csp-"));
  let fixture: ReturnType<typeof createServer> | undefined;
  try {
    const policy = (await fetch(`http://127.0.0.1:${address.port}/`)).headers.get("content-security-policy");
    assert.ok(policy);
    const colors = Object.fromEntries(Array.from({ length: 128 * 128 }, (_, i) => [i, 0xff123456]));
    const compact = compactPicture({ width: 128, height: 128, ops: [{ op: "pixels", colors }] },
      () => { throw new Error("Unexpected resource"); });
    assert.ok(compact.ops[0]?.op === "image" && compact.ops[0].url.startsWith("data:image/png;base64,"));
    const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
    const start = source.indexOf("async function loadImage(");
    const end = source.indexOf("/**\n * Animation sprites:", start);
    assert.ok(start >= 0 && end > start);
    const cache = await readFile(new URL("../web/cache.js", import.meta.url), "utf8");
    const script = `${cache.replaceAll("export ", "")}\n${source.slice(start, end)}
      const picture = ${JSON.stringify({ width: 128, height: 128, ops: [
        { op: "graphics", source: compact, src: [0, 0, 128, 128], dest: [0, 0, 128, 128] },
      ] })};
      paintPicture(picture).then(canvas => {
        document.body.textContent = JSON.stringify([...canvas.getContext("2d").getImageData(0, 0, 1, 1).data]);
      }, error => { document.body.textContent = "ERROR: " + error.message; });`;
    fixture = createServer((request, response) => {
      response.setHeader("Content-Security-Policy", policy);
      if (request.url === "/test.js") {
        response.writeHead(200, { "Content-Type": "text/javascript" });
        response.end(script);
      } else {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end('<!doctype html><body>pending<script src="/test.js"></script></body>');
      }
    });
    fixture.listen(0, "127.0.0.1");
    await once(fixture, "listening");
    const fixtureAddress = fixture.address();
    assert.ok(fixtureAddress && typeof fixtureAddress !== "string");
    const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`,
      "--virtual-time-budget=3000", "--dump-dom", `http://127.0.0.1:${fixtureAddress.port}/`];
    if (process.platform === "linux" && process.getuid?.() === 0) args.unshift("--no-sandbox");
    const { stdout } = await execute(browser!, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
    assert.match(stdout, /<body>\[18,52,86,255\]<\/body>/);
  } finally {
    if (fixture) {
      fixture.closeAllConnections();
      await new Promise<void>((resolve, reject) => fixture!.close(error => error ? reject(error) : resolve()));
    }
    app.closeAllConnections();
    await new Promise<void>((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});

test("clock plaque labels fit at desktop and compact viewport sizes", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [style, responsive] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/responsive.css", import.meta.url), "utf8"),
  ]);
  const font = pathToFileURL(fileURLToPath(new URL("../web/fonts/BIZUDGothic-Regular.ttf", import.meta.url))).href;
  const states = [
    { name: "time-stop", label: "Time Stop", extra: "<span class='era-timestop-gauge'><span class='era-meter'><span></span></span><span class='era-timestop-tsp'>TSP 123 / 456</span></span>" },
    { name: "resume", label: "Resume", extra: "<span class='era-timestop-gauge'><span class='era-meter'><span></span></span><span class='era-timestop-tsp'>TSP 123 / 456</span></span>" },
    { name: "unavailable", label: "Time Stop", extra: "<span class='era-sub'>Not possible now</span><span class='era-timestop-gauge'><span class='era-meter'><span></span></span><span class='era-timestop-tsp'>TSP 123 / 456</span></span>" },
    { name: "wake", label: "Wake Up", extra: "<span class='era-sub'>Start the day at 06:00</span>" },
  ];
  const fixtures = [false, true].flatMap(art => [16, 20, 24].flatMap(size => states.map(state => `
    <div class="fixture" data-case="${art ? "art" : "plain"}-${size}-${state.name}" style="font-size:${size}px">
      <div class="${state.name === "wake" ? "era-shop" : "era-main"}"><div class="era-main-header">
        ${art ? "<div class='era-area-art'></div>" : ""}
        <div class="era-watch-control"><div class="line"><div class="era-clock"></div></div>
          <div class="line"><div class="era-timestop">
            <${state.name === "unavailable" ? "span" : "button"} class="${state.name === "unavailable" ? "era-unavailable" : "choice"} era-timestop-button${state.name === "wake" ? " era-wake-button" : ""}">${state.label}${state.extra}</${state.name === "unavailable" ? "span" : "button"}>
          </div></div>
        </div>
      </div></div>
    </div>`))).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${responsive}
    @font-face { font-family: "BIZ UD Gothic"; src: url("${font}"); }
    .fixture { width: 1000px; font-family: "BIZ UD Gothic", monospace; line-height: 1.25; }
    </style><body class="MODE"><div class="screen is-active">${fixtures}</div><script>
      document.fonts.ready.then(() => {
        const results = [...document.querySelectorAll(".fixture")].map(f => {
          const button = f.querySelector(".era-timestop-button"), plaque = button.closest(".line");
          const range = document.createRange(); range.selectNodeContents(button.firstChild);
          const rects = [...range.getClientRects()], bounds = plaque.getBoundingClientRect();
          const contents = [...rects, ...[...button.children].map(child => child.getBoundingClientRect())];
          const gauge = button.querySelector(".era-timestop-gauge");
          return { name: f.dataset.case, font: getComputedStyle(button).fontSize, gap: getComputedStyle(button).rowGap, rects: rects.length,
            labelGaugeGap: gauge ? gauge.getBoundingClientRect().top - rects[0].bottom : null,
            fits: contents.every(r => r.left >= bounds.left - 1 && r.right <= bounds.right + 1 && r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1) };
        });
        document.body.textContent = JSON.stringify(results);
      });
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-clock-layout-"));
  try {
    for (const [mode, size] of [["desktop", "1440,1000"], ["compact", "1200,700"]] as const) {
      const fixture = join(profile, `${mode}.html`);
      await writeFile(fixture, html.replace("MODE", mode));
      const args = ["--headless", "--disable-gpu", "--no-first-run", "--allow-file-access-from-files",
        `--user-data-dir=${profile}`, `--window-size=${size}`, "--virtual-time-budget=3000", "--dump-dom", pathToFileURL(fixture).href];
      if (process.platform === "linux" && process.getuid?.() === 0) args.unshift("--no-sandbox");
      const { stdout } = await execute(browser!, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
      const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
      assert.ok(match);
      const results = JSON.parse(match[1]) as Array<{ name: string; font: string; gap: string; rects: number; fits: boolean; labelGaugeGap: number | null }>;
      for (const result of results) {
        assert.equal(result.rects, 1, `${mode} ${result.name}: label stays on one line: ${JSON.stringify(result)}`);
        if (mode === "desktop") assert.equal(result.fits, true, `${mode} ${result.name}: content fits plaque: ${JSON.stringify(result)}`);
        if (mode === "desktop" && /-(time-stop|resume)$/.test(result.name))
          assert.ok(result.labelGaugeGap !== null && result.labelGaugeGap <= 8, `${mode} ${result.name}: label sits close to gauge: ${JSON.stringify(result)}`);
        assert.equal(result.gap, "0px", `${mode} ${result.name}: shared clock spacing`);
        if (mode !== "desktop") assert.equal(result.font, "19px", `${mode} ${result.name}: font remains unchanged`);
      }
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("compact button sizes share tokens without changing desktop or sprite controls", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [style, responsive] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/responsive.css", import.meta.url), "utf8"),
  ]);
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${responsive}</style>
    <body class="MODE">
      <div class="screen is-active" style="font: 12px/1.25 sans-serif">
        <div class="era-actions-group"><div class="line">
          <span class="print-cell era-command-tile" id="tile">Move<button class="choice command-number-only"><span class="command-number">400</span></button></span>
          <span class="print-cell era-command-tile" id="number-guard">Guard<button class="choice command-number-only"><span class="command-number">1</span></button></span>
          <span class="print-cell era-command-tile" id="multiline" style="width: 80px">A long action label that wraps across multiple lines<button class="choice command-number-only"><span class="command-number">2</span></button></span>
          <button class="choice era-button era-button" id="guard">Relationship<span class="command-number">[352]</span></button>
          <button class="choice" id="choice">Choice</button>
          <button class="choice" id="sprite"><span class="sprite"></span></button>
        </div></div>
        <div class="era-load"><div class="era-save-list"><div class="line"><button class="choice era-save-slot" id="save">Save</button></div></div></div>
        <div class="era-relationship"><div class="line"><button class="choice era-relationship-select" id="relationship">Select</button></div></div>
      </div>
      <div class="settings-actions"><button id="settings">Settings</button></div>
      <div class="dialog-heading"><button id="dialog">Close</button></div>
      <script>
        const measure = id => {
          const element = document.getElementById(id), css = getComputedStyle(element), rect = element.getBoundingClientRect();
          return { minHeight: css.minHeight, height: rect.height, display: css.display, position: css.position };
        };
        const snapshot = () => Object.fromEntries(["tile", "number-guard", "multiline", "guard", "choice", "sprite", "save", "relationship", "settings", "dialog"].map(id => [id, measure(id)]));
        const initial = snapshot();
        const number = document.querySelector("#tile button");
        const numberStyle = getComputedStyle(number), tile = document.getElementById("tile").getBoundingClientRect(), button = number.getBoundingClientRect();
        const overlay = { position: numberStyle.position, marginLeft: numberStyle.marginLeft, covers: ["top", "right", "bottom", "left"].every(edge => Math.abs(tile[edge] - button[edge]) <= 1.1), numberDisplay: getComputedStyle(number.firstElementChild).display };
        document.documentElement.style.setProperty("--compact-choice-min-height", "48px");
        document.documentElement.style.setProperty("--compact-relationship-button-height", "64px");
        const updated = snapshot();
        number.classList.add("has-controller-hint", "controller-focus");
        number.dataset.controllerHint = "A";
        number.focus();
        const focus = { control: getComputedStyle(number).outlineStyle,
          tile: getComputedStyle(document.getElementById("tile")).outlineStyle };
        document.body.textContent = JSON.stringify({ initial, updated, overlay, focus });
      </script>`;
  type Item = { minHeight: string; height: number; display: string; position: string };
  type Result = { initial: Record<string, Item>; updated: Record<string, Item>; overlay: { position: string; marginLeft: string; covers: boolean; numberDisplay: string }; focus: { control: string; tile: string } };
  const profile = await mkdtemp(join(process.cwd(), ".era-buttons-"));
  try {
    for (const [mode, size] of [["desktop", "1440,1000"], ["compact", "1200,700"]] as const) {
      const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, `--window-size=${size}`, "--dump-dom"];
      if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
      args.push(`data:text/html;base64,${Buffer.from(html.replace("MODE", mode)).toString("base64")}`);
      const { stdout } = await execute(browser!, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
      const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
      assert.ok(match, `${mode}: browser returned button measurements`);
      const { initial, updated, overlay, focus } = JSON.parse(match[1]) as Result;
      assert.equal(focus.control, "none", `${mode}: controller focus does not add a second tile outline`);
      assert.equal(focus.tile, "solid", `${mode}: the complete action tile retains its focus outline`);
      const compact = mode !== "desktop";
      for (const id of ["tile", "number-guard"]) {
        assert.equal(initial[id].minHeight, compact ? "36px" : "auto", `${mode}: ${id} initial minimum`);
        assert.equal(updated[id].minHeight, compact ? "48px" : "auto", `${mode}: ${id} updated minimum`);
        if (compact) assert.equal(updated[id].height, 48, `${mode}: ${id} follows the shared size`);
      }
      assert.equal(overlay.position, compact ? "absolute" : "static", `${mode}: number button position`);
      assert.equal(overlay.marginLeft, "0px", `${mode}: command button has no internal left offset`);
      assert.equal(overlay.numberDisplay, "inline", `${mode}: viewport alone does not hide command numbers`);
      if (compact) assert.ok(overlay.covers, `${mode}: number button covers its tile`);
      assert.ok(updated.multiline.height > 48, `${mode}: long labels can grow beyond the minimum height`);
      assert.equal(updated.guard.minHeight, initial.guard.minHeight);
      assert.equal(updated.choice.minHeight, initial.choice.minHeight);
      assert.equal(updated.sprite.minHeight, initial.sprite.minHeight);
      assert.equal(initial.save.minHeight, compact ? "36px" : "28px");
      assert.equal(updated.save.minHeight, compact ? "48px" : "28px");
      if (compact) {
        assert.equal(initial.relationship.height, 56);
        assert.equal(updated.relationship.height, 64);
      }
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("room names have no pressed-button box while other pressed controls keep it", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [style, responsive] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/responsive.css", import.meta.url), "utf8"),
  ]);
  const html = `<!doctype html><style>${style}\n${responsive}</style><body class="MODE">
    <div class="screen is-active">
      <div class="era-room-stage"><div class="era-occupant"><div class="line">
        <button class="choice era-occupant-label" aria-pressed="true"><span class="era-occupant-text"><span class="era-occupant-name">Kana</span><span class="era-occupant-state">Favor 6 <span class="era-feel era-feel-friend">Friend</span></span></span></button>
        <button class="choice era-occupant-label" aria-pressed="false"><span class="era-occupant-text"><span class="era-occupant-name">Reimu</span><span class="era-occupant-state">Favor 0</span></span></button>
      </div></div></div>
      <button id="control" class="ui-button" aria-pressed="true">Other control</button>
    </div><script>
      const names = [...document.querySelectorAll(".era-occupant-label")].map(button => {
        const style = getComputedStyle(button);
        return { border: style.borderWidth, shadow: style.boxShadow, background: style.backgroundColor };
      });
      const shadows = [...document.querySelectorAll(".era-occupant-name, .era-occupant-state, .era-feel")]
        .map(element => getComputedStyle(element).textShadow);
      document.body.textContent = JSON.stringify({ names, shadows, control: getComputedStyle(document.querySelector("#control")).boxShadow });
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-room-labels-"));
  try {
    for (const mode of ["desktop"]) {
      const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, "--dump-dom"];
      if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
      args.push(`data:text/html;base64,${Buffer.from(html.replace("MODE", mode)).toString("base64")}`);
      const { stdout } = await execute(browser!, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
      const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
      assert.ok(match);
      const result = JSON.parse(match[1]) as {
        names: Array<{ border: string; shadow: string; background: string }>;
        shadows: string[];
        control: string;
      };
      assert.equal(result.names.length, 2);
      for (const name of result.names) {
        assert.deepEqual(name, { border: "0px", shadow: "none", background: "rgba(0, 0, 0, 0)" }, mode);
      }
      assert.notEqual(result.control, "none", `${mode}: other pressed buttons retain their highlight`);
      assert.equal(result.shadows.length, 5);
      for (const shadow of result.shadows) {
        assert.ok(shadow.includes("rgb(0, 0, 0) -1px -1px 0px"), `${mode}: black outline above/left`);
        assert.ok(shadow.includes("rgb(0, 0, 0) 1px 1px 0px"), `${mode}: black outline below/right`);
        assert.equal(shadow.split("rgb(").length - 1, 9, `${mode}: full outline and drop shadow`);
      }
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("repeat button fits the action card corner and displays an X hint", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [style, responsive] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/responsive.css", import.meta.url), "utf8"),
  ]);
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${responsive}
    .fixture { width: 900px; margin: 20px; }
    </style><body class="MODE has-controller"><div class="screen is-active"><div class="era-main fixture">
    <div class="era-card era-main-actions"><div class="line"><div class="era-card-title era-actions-header">
    <span>Interact with Kana</span><span class="era-toggles"><label class="checkbox-control era-toggle">Petting</label>
    <label class="checkbox-control era-toggle">Housekeeping</label>
    <button class="choice era-repeat has-controller-hint" data-controller-hint="X" aria-label="Repeat last action"></button></span>
    </div></div></div></div></div><script>
    const button = document.querySelector(".era-repeat"), card = button.closest(".era-card");
    const rect = button.getBoundingClientRect(), edge = card.getBoundingClientRect();
    const css = getComputedStyle(button), hint = getComputedStyle(button, "::after");
    const hintContent = hint.content, hintSize = hint.width;
    const normalImage = css.backgroundImage;
    button.blur();
    button.classList.add("is-pending");
    button.disabled = true;
    const pendingImage = getComputedStyle(button).backgroundImage;
    button.classList.replace("is-pending", "is-selected");
    const selectedImage = getComputedStyle(button).backgroundImage;
    const busyHint = getComputedStyle(button, "::after").content;
    document.body.classList.remove("has-controller");
    button.classList.remove("has-controller-hint");
    const offHint = getComputedStyle(button, "::after").content;
    document.body.textContent = JSON.stringify({ right: edge.right - rect.right, top: rect.top - edge.top,
      width: rect.width, height: rect.height, normalImage, pendingImage, selectedImage,
      radius: css.borderTopRightRadius, hint: hintContent, hintSize, busyHint, offHint });
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-repeat-corner-"));
  try {
    for (const mode of ["desktop"]) {
      const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, "--window-size=1440,1000", "--dump-dom"];
      if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
      args.push(`data:text/html;base64,${Buffer.from(html.replace("MODE", mode)).toString("base64")}`);
      const { stdout } = await execute(browser!, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
      const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
      assert.ok(match);
      const result = JSON.parse(match[1]) as { right: number; top: number; width: number; height: number; normalImage: string; pendingImage: string; selectedImage: string; radius: string; hint: string; hintSize: string; busyHint: string; offHint: string };
      assert.ok(Math.abs(result.right - 1) < 1, `${mode}: right corner ${JSON.stringify(result)}`);
      assert.ok(Math.abs(result.top - 1) < 1, `${mode}: top corner ${JSON.stringify(result)}`);
      assert.equal(result.width, 40, `${mode}: image button width`);
      assert.equal(result.height, 40, `${mode}: image button height`);
      assert.match(result.normalImage, /\/repeat\.webp/);
      assert.match(style, /button\.choice\.era-repeat:enabled:is\(:hover, :focus, :active\)/);
      for (const image of [result.pendingImage, result.selectedImage]) {
        assert.match(image, /\/repeat-active\.webp/, `${mode}: interactive artwork ${JSON.stringify(result)}`);
      }
      assert.equal(result.radius, "6px");
      assert.equal(result.hint, '"X"');
      assert.equal(result.busyHint, '"X"', `${mode}: hint remains visible while busy`);
      assert.equal(result.offHint, "none", `${mode}: hints disabled`);
      assert.ok(Math.abs(parseFloat(result.hintSize) - 16.8) < .01);
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("room height follows rendered portraits without clipping", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [style, responsive] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/responsive.css", import.meta.url), "utf8"),
  ]);
  const portrait = (size: number) => `<div class="era-occupant"><div class="era-portrait"><div class="line"><span><button class="choice"><span class="sprite" style="width:${size}px"><span class="sprite-clip" style="width:${size}px;height:${size}px"><canvas width="512" height="512" style="width:${size}px;height:${size}px"></canvas></span></span></button></span></div></div></div>`;
  const fixtures = [[150], [283.5], [150, 360], []].map(sizes => `
    <div class="fixture" data-case="${sizes.join(",") || "empty"}">
      <div class="era-room-stage"><div class="era-occupants"><div class="era-occupant-list">
        ${sizes.length ? sizes.map(portrait).join("") : '<div class="era-alone-message">Nobody here</div>'}
      </div></div></div>
    </div>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${responsive}</style><body class="MODE">
    <div class="screen is-active">${fixtures}</div><script>
      const results = [...document.querySelectorAll(".fixture")].map(f => {
        const list = f.querySelector(".era-occupant-list").getBoundingClientRect();
        const portraits = [...f.querySelectorAll(".sprite-clip")].map(e => e.getBoundingClientRect());
        return { name: f.dataset.case, height: list.height,
          fits: portraits.every(r => r.top >= list.top - 1 && r.bottom <= list.bottom + 1) };
      });
      document.body.textContent = JSON.stringify(results);
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-portrait-layout-"));
  try {
    for (const mode of ["desktop"]) {
      const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, "--window-size=1440,1000", "--dump-dom"];
      if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
      args.push(`data:text/html;base64,${Buffer.from(html.replace("MODE", mode)).toString("base64")}`);
      const { stdout } = await execute(browser!, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
      const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
      assert.ok(match);
      const results = JSON.parse(match[1]) as Array<{ name: string; height: number; fits: boolean }>;
      for (const result of results) {
        const expected = result.name === "empty" ? 216 : Math.max(...result.name.split(",").map(Number));
        assert.ok(result.fits, `${mode} ${result.name}: full portrait fits`);
        assert.ok(Math.abs(result.height - expected) < 4, `${mode} ${result.name}: room height follows portrait: ${JSON.stringify(result)}`);
      }
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("history takes remaining height after actions at each layout width", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [style, responsive] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/responsive.css", import.meta.url), "utf8"),
  ]);
  const fixtures = [700, 900, 1180].flatMap(width => [false, true].map(counters => `
    <div class="fixture" data-case="${width}-${counters}">
      <div id="terminal" style="width:${width}px;height:1000px">
        <div class="screen is-active"><div class="era-main">
          <div class="era-main-header" style="height:100px"></div>
          <div class="era-main-center"><div class="era-card era-character">
            <div class="era-room-stage" style="min-height:180px"></div>
            <div class="era-character-info" style="min-height:100px"></div>
            <section class="era-main-chat"><div class="era-history-pane"><div class="era-history-body">
              ${"<p>History line</p>".repeat(50)}
            </div></div></section>
          </div></div>
          <div class="era-card era-main-actions"><div class="line" style="height:80px"></div></div>
          <div class="era-main-sidebar"><div style="height:100px"></div></div>
          ${counters ? '<div class="era-card era-counters" style="height:30px"></div>' : ""}
        </div></div>
      </div>
    </div>`)).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${responsive}</style><body>${fixtures}<script>
    const results = [...document.querySelectorAll(".fixture")].map(fixture => {
      const pane = fixture.querySelector(".era-history-pane"), actions = fixture.querySelector(".era-main-actions");
      const terminal = fixture.querySelector("#terminal"), line = actions.firstElementChild;
      const measure = () => ({ history: pane.getBoundingClientRect().height, actions: actions.getBoundingClientRect().height });
      const initial = measure();
      line.style.height = "160px";
      const expandedActions = measure();
      terminal.style.height = "1100px";
      const expandedTerminal = measure();
      return { name: fixture.dataset.case, initial, expandedActions, expandedTerminal };
    });
    document.body.textContent = JSON.stringify(results);
  </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-history-priority-"));
  try {
    const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, "--window-size=1440,1000", "--dump-dom"];
    if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
    args.push(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
    const { stdout } = await execute(browser!, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
    const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
    assert.ok(match);
    const results = JSON.parse(match[1]) as Array<{ name: string; initial: { history: number; actions: number };
      expandedActions: { history: number; actions: number }; expandedTerminal: { history: number; actions: number } }>;
    assert.equal(results.length, 6);
    for (const { name, initial, expandedActions, expandedTerminal } of results) {
      assert.ok(Math.abs(expandedActions.actions - initial.actions - 80) < 1, `${name}: actions get their requested height`);
      assert.ok(Math.abs(initial.history - expandedActions.history - 80) < 1, `${name}: history yields to growing actions`);
      assert.ok(Math.abs(expandedTerminal.history - expandedActions.history - 100) < 1, `${name}: history takes additional available space`);
      assert.ok(Math.abs(expandedTerminal.actions - expandedActions.actions) < 1, `${name}: actions don't grow without content`);
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("main screen distributes space and spaces player controls consistently", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [style, responsive] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/responsive.css", import.meta.url), "utf8"),
  ]);
  const room = (occupied: boolean, history: boolean, crowded: boolean, counters: boolean) => `
    <div id="terminal" style="width: 1180px; height: ${crowded ? 600 : 720}px; font-size: 16px; line-height: 1.25">
      <div class="screen is-active"><div class="era-main">
        <div class="era-main-header" style="height: 130px">Header</div>
        <div class="era-main-center"><div class="era-card era-character${occupied ? "" : " era-alone"}">
          <div class="era-room-stage"><div class="line"><div class="era-place">Room</div></div>
            <div class="era-occupants"><div class="era-occupant-list">
              ${occupied ? '<div class="era-occupant"><div style="width:180px;height:216px">Character</div></div>' :
                '<div class="line"><span><div class="era-alone-message"><span class="era-alone-mark"></span><span class="era-alone-title">Nobody else is here</span><span class="era-alone-hint">Move or go out to find someone.</span></div></span></div>'}
            </div></div>
          </div>
          ${occupied ? '<div class="era-character-info"><div class="era-info-body">Character information</div></div>' : ""}
          ${history ? '<section class="era-main-chat"><div class="era-history-pane"><div class="era-history-body"><p>Interaction history</p><p>Second line</p><p>Third line</p><p>Fourth line</p></div></div></section>' : ""}
        </div></div>
        <div class="era-card era-main-actions"><div class="line">Interact</div>
          ${Array.from({ length: crowded ? 8 : 2 }, () => '<div class="line" style="height:45px">Action row</div>').join("")}
        </div>
        <div class="era-main-sidebar"><div class="era-main-right"><div class="era-card era-player">
          <div class="line">Player</div>
          <div class="line"><div class="era-player-actions"><button class="choice era-button era-button-block">Inventory</button></div></div>
          <div class="era-player-management"><div class="era-actions-group">
            <div class="line"><button class="choice era-button era-button-block era-travel-button">Move</button><button class="choice era-button era-button-block era-travel-button">Go Out</button><button class="choice era-button era-button-block">Lock The Door</button></div>
            <div class="line"><span><div class="era-toggles era-auto-toggles"><label class="checkbox-control era-toggle"><input type="checkbox">Auto-TSP Movement</label><label class="checkbox-control era-toggle"><input type="checkbox">Auto-Clean</label><label class="checkbox-control era-toggle"><input type="checkbox">Pushdown Guard</label></div></span></div>
          </div><div class="era-settings"><div class="line"><button class="choice era-button era-button-block">Config</button></div></div></div>
        </div></div></div>
        ${counters ? '<div class="era-card era-counters" style="height:35px">Counters</div>' : ""}
      </div></div>
    </div>`;
  const cases = [false, true].flatMap(occupied => [false, true].flatMap(history =>
    [false, true].flatMap(crowded => [false, true].map(counters => ({ occupied, history, crowded, counters })))));
  const markup = cases.map(({ occupied, history, crowded, counters }) =>
    `<div class="fixture">${room(occupied, history, crowded, counters)}</div>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${responsive}</style>
    <body class="MODE">${markup}
    <script>
      const results = [...document.querySelectorAll(".fixture")].map(fixture => {
        const get = selector => fixture.querySelector(selector);
        const rect = selector => get(selector).getBoundingClientRect();
        const actions = get(".era-main-actions"), center = get(".era-main-center");
        const inventory = rect(".era-button-block");
        const tiles = [...fixture.querySelectorAll(".era-player-management .era-button-block")].map(e => e.getBoundingClientRect());
        const toggles = [...fixture.querySelectorAll(".era-auto-toggles .era-toggle")].map(e => e.getBoundingClientRect());
        const config = rect(".era-settings .era-button-block");
        const result = {
          room: rect(".era-occupant-list").height, roomVisible: center.clientHeight, roomScroll: center.scrollHeight,
          actions: actions.getBoundingClientRect().height, actionsClient: actions.clientHeight, actionsScroll: actions.scrollHeight,
          actionsSpare: actions.getBoundingClientRect().bottom - actions.lastElementChild.getBoundingClientRect().bottom,
          grid: getComputedStyle(get(".era-main")).gridTemplateRows,
          detail: [rect(".era-character").height, rect(".era-room-stage").height, rect(".era-occupants").height, rect(".era-place").height],
          historyDisplay: get(".era-main-chat") ? getComputedStyle(get(".era-main-chat")).display : "absent",
          historyHeight: get(".era-main-chat") ? rect(".era-main-chat").height : 0,
          historyPaneHeight: get(".era-history-pane") ? rect(".era-history-pane").height : 0,
          historyLineHeight: get(".era-history-body") ? parseFloat(getComputedStyle(get(".era-history-body")).lineHeight) : 0,
          historyScrollable: get(".era-history-pane") ? get(".era-history-pane").scrollHeight > get(".era-history-pane").clientHeight : false,
          historyWithStatusHeight: 0,
          historyForcedHeight: 0,
          gaps: [tiles[0].top - inventory.bottom, tiles[2].top - tiles[0].bottom,
            toggles[0].top - tiles[2].bottom, toggles[2].top - toggles[0].bottom, config.top - toggles[2].bottom]
        };
        if (get(".era-main-chat")) {
          const status = document.createElement("p");
          status.className = "era-llm-status";
          status.textContent = "Waiting for a response";
          get(".era-main-chat").append(status);
          result.historyWithStatusHeight = rect(".era-history-pane").height;
          status.remove();
          get(".era-character").style.minHeight = "700px";
          result.historyForcedHeight = rect(".era-history-pane").height;
        }
        return result;
      });

      document.body.textContent = JSON.stringify(results);
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-layout-"));
  try {
    for (const [mode, size] of [["desktop", "1440,900"], ["compact", "1200,700"]] as const) {
      const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, `--window-size=${size}`, "--dump-dom"];
      if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
      args.push(`data:text/html;base64,${Buffer.from(html.replace("MODE", mode)).toString("base64")}`);
      const { stdout } = await execute(browser!, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
      const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
      assert.ok(match, `${mode}: browser returned layout measurements`);
      const results = JSON.parse(match[1]) as Measurements[];
      assert.equal(results.length, cases.length, `${mode}: every layout case was measured`);
      for (const [index, result] of results.entries()) {
        const { occupied, history, crowded, counters } = cases[index];
        const label = `${mode}, occupied=${occupied}, history=${history}, crowded=${crowded}, counters=${counters}`;
        assert.ok(result.actionsScroll <= result.actionsClient + 1, `${label}: actions should fit without scrolling`);
        if (result.roomScroll > result.roomVisible + 1)
          assert.ok(result.actionsSpare <= 20, `${label}: room scrolls despite ${result.actionsSpare}px unused under actions`);
        assert.equal(result.historyDisplay === "none", mode === "compact" && history, `${label}: history visibility`);
        if (history && mode === "desktop") {
          assert.ok(result.historyPaneHeight >= 3 * result.historyLineHeight - 0.1, `${label}: history fits three lines`);
          assert.ok(result.actionsSpare <= 20, `${label}: actions don't take unused space from history: ${JSON.stringify(result)}`);
          if (crowded) {
            assert.ok(result.historyHeight <= 3 * result.historyLineHeight + 1, `${label}: crowded actions take priority over history growth: ${JSON.stringify(result)}`);
            assert.ok(result.historyScrollable, `${label}: longer history remains scrollable`);
          } else {
            assert.ok(result.historyPaneHeight > 3 * result.historyLineHeight + 1, `${label}: history grows when actions don't need the space: ${JSON.stringify(result)}`);
          }
          assert.ok(result.historyWithStatusHeight >= 3 * result.historyLineHeight - 0.1, `${label}: status does not reduce history below three lines`);
          assert.ok(result.historyForcedHeight > result.historyPaneHeight + 1, `${label}: history grows when the room has excess space`);
        }
        if (!crowded)
          assert.ok(Math.abs(result.room - 216) < 1, `${label}: room should reach portrait height: ${JSON.stringify(result)}`);
        if (mode === "compact" && crowded) {
          if (occupied)
            assert.ok(result.roomScroll > result.roomVisible, `${label}: occupied room should scroll rather than crush actions`);
          else
            assert.ok(result.room < 216, `${label}: empty room should yield space to actions`);
        }
        for (const gap of result.gaps)
          assert.ok(Math.abs(gap - 6) < 1, `${label}: expected 6px between player controls, got ${gap}`);
      }
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("sky dialog fits its contents and keeps the panorama visible while narration scrolls", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [style, responsive] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/responsive.css", import.meta.url), "utf8"),
  ]);
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${responsive}</style><body>
    <div class="screen is-active"><div class="era-box era-dialog era-sky-dialog" popover="manual">
      <div class="line"><div class="era-inventory-header"><div class="era-inventory-heading">
        <span class="era-inventory-title">Gaze at the sky</span><button class="choice era-dialog-close era-wait-continue">Continue</button>
      </div></div></div>
      <div class="era-box era-main-header"><div class="line"><span><div class="era-sky era-sky-day"><span class="era-sky-view"></span></div></span></div></div>
      <div class="era-box era-sky-narration"><div class="line">A clear sky.</div></div>
    </div></div><script>
      const dialog = document.querySelector(".era-sky-dialog"), narration = document.querySelector(".era-sky-narration");
      dialog.showPopover();
      const scene = document.querySelector(".era-sky").getBoundingClientRect();
      const button = document.querySelector(".era-wait-continue").getBoundingClientRect();
      const initialHeight = dialog.getBoundingClientRect().height;
      narration.firstChild.style.height = "120px";
      const mediumHeight = dialog.getBoundingClientRect().height;
      narration.firstChild.style.height = "1200px";
      const result = { initialHeight, mediumHeight, sceneHeight: scene.height, overlaps: button.bottom > scene.top,
        dialogHeight: dialog.getBoundingClientRect().height, viewportHeight: innerHeight,
        scrollable: narration.scrollHeight > narration.clientHeight };
      document.body.textContent = JSON.stringify(result);
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-sky-layout-"));
  try {
    const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, "--window-size=1200,700", "--dump-dom"];
    if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
    args.push(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
    const { stdout } = await execute(browser!, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
    const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
    assert.ok(match);
    const result = JSON.parse(match[1]) as { initialHeight: number; mediumHeight: number; sceneHeight: number; overlaps: boolean; dialogHeight: number; viewportHeight: number; scrollable: boolean };
    assert.ok(result.initialHeight >= 500, "dialog reserves space for narration");
    assert.equal(result.initialHeight, result.mediumHeight, "dialog height does not change as narration grows");
    assert.equal(result.initialHeight, result.dialogHeight, "overflowing narration does not grow the dialog");
    assert.equal(result.sceneHeight, 150);
    assert.equal(result.overlaps, false, "the continue control does not cover the panorama");
    assert.ok(result.dialogHeight <= result.viewportHeight);
    assert.equal(result.scrollable, true, "long narration scrolls without shrinking the panorama");
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("stats scroll when constrained while sidebar overflow belongs to the terminal", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [style, responsive] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/responsive.css", import.meta.url), "utf8"),
  ]);
  const fixture = (name: string, width: number, stats: boolean, playerHeight: number) => `
    <div class="fixture" data-case="${name}"><div id="terminal" style="width:${width}px;height:650px;font-size:20px;line-height:1.25">
      <div class="screen is-active"><div class="era-main">
        <div class="era-main-header" style="height:130px">Header</div>
        <div class="era-main-center"><div class="era-card" style="height:200px">Room</div></div>
        <div class="era-main-actions era-card"><div class="line">Actions</div></div>
        <div class="era-main-sidebar">
          <div class="era-main-left">${stats ? `<div class="era-card era-stats" tabindex="0">
            <div class="line"><div class="era-card-title">Character's Stats</div></div>
            <div class="line"><div class="era-palam-grid">${Array.from({ length: name === "short-stats" ? 2 : 28 }, (_, i) =>
              `<div class="era-palam-item">Stat ${i + 1}</div>`).join("")}</div></div></div>` : ""}</div>
          <div class="era-main-right"><div class="era-card era-player"><div style="height:${playerHeight}px">Player information</div>
            <div class="line"><button class="choice era-button-block">Inventory</button></div>
            <div class="era-player-management"><div class="era-actions-group"><div class="line"><button class="choice era-button era-button-block">Move</button></div></div>
              <div class="line"><span class="output-text"><div class="era-auto-toggles"><button class="choice era-toggle">Auto-TSP Movement</button></div></span></div>
              <div class="era-settings"><div class="line"><button class="choice era-chip-button">Config</button></div></div></div>
          </div></div>
        </div>
      </div></div>
    </div></div>`;
  const cases = [
    { name: "wide", width: 1180, stats: true, playerHeight: 180 },
    { name: "short-stats", width: 1180, stats: true, playerHeight: 180 },
    { name: "large-player", width: 1180, stats: true, playerHeight: 700 },
    { name: "no-stats", width: 1180, stats: false, playerHeight: 180 },
    { name: "stacked", width: 650, stats: true, playerHeight: 180 },
  ];
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${responsive}</style><body class="MODE">
    ${cases.map(({ name, width, stats, playerHeight }) => fixture(name, width, stats, playerHeight)).join("")}
    <script>
      const results = [...document.querySelectorAll(".fixture")].map(f => {
        const sidebar = f.querySelector(".era-main-sidebar"), player = f.querySelector(".era-player");
        const stats = f.querySelector(".era-stats"), config = f.querySelector(".era-chip-button");
        const before = sidebar.scrollTop;
        if (stats) { stats.focus({ preventScroll: true }); stats.scrollTop = stats.scrollHeight; }
        const statsFocused = document.activeElement === stats;
        const sidebarAfterStats = sidebar.scrollTop;
        const configBottomBefore = config.getBoundingClientRect().bottom - sidebar.getBoundingClientRect().top;
        sidebar.scrollTop = sidebar.scrollHeight;
        const terminal = f.querySelector("#terminal");
        terminal.scrollTop = terminal.scrollHeight;
        return { name: f.dataset.case, sidebarClient: sidebar.clientHeight, sidebarScroll: sidebar.scrollHeight,
          sidebarBefore: before, sidebarAfterStats, sidebarScrolled: sidebar.scrollTop,
          sidebarOverflow: getComputedStyle(sidebar).overflowY, terminalScrolled: terminal.scrollTop,
          playerHeight: player.getBoundingClientRect().height, statsFocused, configBottomBefore,
          configBottom: config.getBoundingClientRect().bottom - sidebar.getBoundingClientRect().top,
          statsClient: stats?.clientHeight, statsScroll: stats?.scrollHeight, statsTop: stats?.scrollTop,
          statsOverflow: stats && getComputedStyle(stats).overflowY,
          leftDisplay: getComputedStyle(f.querySelector(".era-main-left")).display,
          scrollChain: getComputedStyle(sidebar).overscrollBehaviorY,
          toggleGap: f.querySelector(".era-auto-toggles").getBoundingClientRect().top -
            f.querySelector(".era-player-management .era-actions-group").getBoundingClientRect().bottom };
      });
      document.body.textContent = JSON.stringify(results);
    </script>`;
  const profile = await mkdtemp(join(process.cwd(), ".era-sidebar-layout-"));
  try {
    for (const [mode, size] of [["desktop", "1440,900"], ["compact", "1200,700"]] as const) {
      const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, `--window-size=${size}`, "--dump-dom"];
      if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
      args.push(`data:text/html;base64,${Buffer.from(html.replace("MODE", mode)).toString("base64")}`);
      const { stdout } = await execute(browser!, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
      const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
      assert.ok(match);
      const results = JSON.parse(match[1]) as Array<{
        name: string; sidebarClient: number; sidebarScroll: number; sidebarBefore: number; sidebarAfterStats: number;
        sidebarScrolled: number; sidebarOverflow: string; terminalScrolled: number;
        playerHeight: number; configBottom: number; configBottomBefore: number; statsFocused: boolean;
        statsClient?: number; statsScroll?: number; statsTop?: number; statsOverflow?: string; leftDisplay: string; scrollChain: string; toggleGap: number;
      }>;
      const wide = results.find(result => result.name === "wide")!;
      for (const result of results) {
        assert.equal(result.sidebarOverflow, "visible", `${mode}/${result.name}: sidebar is not a scroll container`);
        assert.equal(result.sidebarScrolled, 0, `${mode}/${result.name}: sidebar cannot scroll`);
      }
      assert.equal(wide.statsOverflow, "auto", mode);
      assert.ok(wide.statsScroll! > wide.statsClient!, `${mode}: tall stats overflow independently`);
      assert.ok(wide.statsTop! > 0, `${mode}: stats can scroll`);
      assert.ok(wide.statsFocused, `${mode}: stats remain keyboard accessible`);
      assert.equal(wide.leftDisplay, "contents");
      assert.equal(wide.scrollChain, "auto");
      assert.equal(wide.sidebarBefore, wide.sidebarAfterStats, `${mode}: scrolling stats does not scroll player`);
      const short = results.find(result => result.name === "short-stats")!;
      assert.equal(short.statsScroll, short.statsClient, `${mode}: short stats do not overflow`);
      assert.ok(short.statsClient! < wide.statsClient!, `${mode}: short stats take less space`);
      assert.ok(short.playerHeight >= wide.playerHeight, `${mode}: spare space expands player`);
      assert.ok(short.toggleGap > wide.toggleGap, `${mode}: extra player height goes above Auto-TSP`);
      const large = results.find(result => result.name === "large-player")!;
      assert.ok(large.sidebarScroll > large.sidebarClient, `${mode}: oversized player overflows the sidebar`);
      assert.ok(large.terminalScrolled > 0, `${mode}: terminal scrolling reaches oversized player`);
      const noStats = results.find(result => result.name === "no-stats")!;
      assert.ok(noStats.configBottomBefore <= noStats.sidebarClient + 1, `${mode}: player is visible without stats`);
      const stacked = results.find(result => result.name === "stacked")!;
      assert.notEqual(stacked.statsOverflow, "auto", `${mode}: narrow stacked layout retains normal page flow`);
      assert.equal(stacked.statsScroll, stacked.statsClient, `${mode}: stacked stats are not clipped`);
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});
