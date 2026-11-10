import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { GAME_ROOT, applyHotpatches, emptyGame, indexScript, loadGame } from "../src/loader.js";
import { createApp } from "../src/server.js";

const browser = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
  .find((path): path is string => !!path && existsSync(path));

test("catalog uses production rendering and context-independent buttons at wide and narrow sizes", {
  skip: !browser || !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const app = createApp([{ id: "tw", title: "eraTW", game }], true);
  const server = createServer((request, response) => {
    if (request.url !== "/component-probe") { app.emit("request", request, response); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><style>iframe{width:1000px;height:900px}</style>
      <iframe id="catalog" src="/components#main"></iframe><iframe id="game" src="/?demo"></iframe>
      <pre id="result"></pre><script>
      let stage = "catalog shell";
      let result;
      const pause = () => new Promise(resolve => setTimeout(resolve, 100));
      function ready(doc, selector) {
        const button = doc?.querySelector(selector);
        return button && !button.disabled && !doc.body.classList.contains("is-busy") ? button : null;
      }
      async function until(read) {
        for (let n = 0; n < 180; n++) { const value = read(); if (value) return value; await pause(); }
        throw new Error("Preview did not become ready: " + stage);
      }
      const style = el => {
        const s = getComputedStyle(el);
        return {font:s.fontFamily,size:s.fontSize,background:s.backgroundColor,border:s.border,
          radius:s.borderRadius,padding:s.padding,align:s.textAlign,justify:s.justifyContent};
      };
      (async () => {
        const catalog = await until(() => document.querySelector("#catalog").contentDocument?.querySelector("#game-preview"));
        stage = "catalog main";
        const preview = await until(() => ready(catalog.contentDocument, ".era-actions-collection button.era-button"));
        const gameFrame = document.querySelector("#game");
        stage = "normal demo menu";
        const menu = await until(() => ready(gameFrame.contentDocument, "button.choice[data-value='8']"));
        menu.click();
        stage = "normal scene menu";
        const scene = await until(() => ready(gameFrame.contentDocument, ".screen.is-active button.choice[data-value='3']"));
        scene.click();
        stage = "normal main";
        const normal = await until(() => {
          const doc = gameFrame.contentDocument;
          if (doc.querySelector("#terminal.is-waiting")) doc.querySelector("#terminal").click();
          return ready(doc, ".screen.is-active .era-actions-collection button.era-button");
        });
        await catalog.contentDocument.fonts.ready;
        await gameFrame.contentDocument.fonts.ready;
        result = {preview:style(preview),normal:style(normal),
          renderer:catalog.contentDocument.querySelector("script[src='/app.js']") !== null,
          bizFont:catalog.contentDocument.fonts.check('16px "BIZ UD Gothic"'),
          active:preview.closest(".screen").classList.contains("is-active"),
          terminalFont:catalog.contentDocument.documentElement.style.getPropertyValue("--terminal-font"),
          cards:catalog.contentDocument.querySelectorAll(".era-main .era-card").length,
          statusHeight:catalog.contentDocument.querySelector("#status").getBoundingClientRect().height,
          terminalHeight:catalog.contentDocument.querySelector("#terminal").getBoundingClientRect().height};
        const host = catalog.ownerDocument;
        host.querySelector("#preview-size").value = "narrow";
        host.querySelector("#preview-size").dispatchEvent(new Event("change"));
        await pause();
        result.width = catalog.getBoundingClientRect().width;
        result.buttonFits = preview.getBoundingClientRect().right <= catalog.contentWindow.innerWidth;
        const previousDocument = catalog.contentDocument;
        host.querySelector("a[data-sample='buttons']").click();
        stage = "button variants";
        const button = await until(() => catalog.contentDocument !== previousDocument
          && ready(catalog.contentDocument, ".era-button-block"));
        result.variantFont = style(button).font;
        result.variants = catalog.contentDocument.querySelectorAll(".screen.is-active .era-helper-samples .era-button").length;
        result.gameSamples = catalog.contentDocument.querySelectorAll(".era-button-sample").length;
        const atlasDoc = catalog.contentDocument;
        result.noStateLabels = !atlasDoc.querySelector(".era-component-state");
        result.repeatEmpty = atlasDoc.querySelector(".era-repeat").textContent === "";
        result.continueEnabled = !atlasDoc.querySelector(".era-title-continue").disabled;
        result.noImageErrors = !atlasDoc.querySelector("#terminal").textContent.includes("Unknown sprite:");
        stage = "radio group";
        const radioGroup = () => atlasDoc.querySelector('[role="radiogroup"][aria-label="Home example"]');
        const firstRadio = radioGroup().querySelector('[data-value="9100"]');
        result.radioInitial = firstRadio.getAttribute("aria-checked") === "true" && firstRadio.tabIndex === 0
          && !firstRadio.hasAttribute("aria-pressed") && radioGroup().querySelector('[data-value="9102"]').disabled;
        firstRadio.focus();
        firstRadio.dispatchEvent(new atlasDoc.defaultView.KeyboardEvent("keydown",
          {key:"ArrowRight",bubbles:true,cancelable:true}));
        await until(() => ready(atlasDoc, '[data-value="9101"][aria-checked="true"]'));
        result.radioChanged = radioGroup().querySelector('[data-value="9101"]').tabIndex === 0
          && radioGroup().querySelector('[data-value="9100"]').getAttribute("aria-checked") === "false";
        result.radioLayout = [...radioGroup().querySelectorAll(".era-radio")].every(radio =>
          radio.getBoundingClientRect().width >= radioGroup().getBoundingClientRect().width - 1
          && radio.scrollWidth <= radio.clientWidth + 1);
        const toneControls = [...atlasDoc.querySelectorAll("button[class*='era-button-tone-']")];
        const toneStyle = atlasDoc.createElement("style");
        toneStyle.textContent = [...atlasDoc.styleSheets].flatMap(sheet => [...sheet.cssRules].map(rule => rule.cssText))
          .join("\\n").replaceAll(":hover", ".tone-hover");
        atlasDoc.head.append(toneStyle);
        result.toneHovers = toneControls.map(control => {
          const before = getComputedStyle(control).backgroundImage;
          control.classList.add("tone-hover");
          const after = getComputedStyle(control).backgroundImage;
          control.classList.remove("tone-hover");
          return {before, after};
        });
        toneStyle.remove();
        atlasDoc.activeElement?.blur();
        const contexts = atlasDoc.createElement("div");
        atlasDoc.querySelector(".screen.is-active").append(contexts);
        result.contextFailures = [];
        for (const original of atlasDoc.querySelectorAll(".era-button-sample button.choice")) {
          for (const context of ["line", "era-main", "era-player", "era-move-side", "era-inventory-tools", "era-setup", "era-launch-actions"]) {
            contexts.className = context;
            const root = original.closest(".era-command-tile") ?? original;
            const clone = root.cloneNode(true);
            contexts.replaceChildren(clone);
            const control = clone instanceof catalog.contentWindow.HTMLButtonElement ? clone : clone.querySelector("button");
            if (JSON.stringify(style(original)) !== JSON.stringify(style(control)) && result.contextFailures.length < 10)
              result.contextFailures.push({button:original.className,context,original:style(original),clone:style(control)});
          }
        }
        contexts.remove();
        const savedHints = atlasDoc.defaultView.localStorage.getItem("era-typescript.controller-hints");
        host.querySelector("#preview-disabled").checked = true;
        host.querySelector("#preview-disabled").dispatchEvent(new Event("change"));
        const probeStyle = atlasDoc.createElement("style");
        probeStyle.textContent = [...atlasDoc.styleSheets].flatMap(sheet => [...sheet.cssRules].map(rule => rule.cssText))
          .join("\\n").replaceAll(":hover", ".catalog-hover").replaceAll(":focus-visible", ".catalog-focus")
          + "\\n.era-button-sample * { transition: none !important; }";
        atlasDoc.head.append(probeStyle);
        result.disabledFailures = [];
        const disabled = [...atlasDoc.querySelectorAll(".era-button-sample button:disabled")];
        result.disabledCount = disabled.length;
        const appearance = control => {
          const css = getComputedStyle(control);
          return JSON.stringify([css.background, css.color, css.border, css.filter, css.opacity, css.outline,
            css.textDecoration, getComputedStyle(control, "::before").filter,
            getComputedStyle(control, "::after").content,
            ...[...control.children].map(child => getComputedStyle(child).color)]);
        };
        for (const control of disabled) {
          const before = appearance(control);
          let clicks = 0;
          control.addEventListener("click", () => clicks++);
          control.click();
          control.classList.add("catalog-hover", "catalog-focus");
          const unchanged = appearance(control) === before;
          control.classList.remove("catalog-hover", "catalog-focus");
          if (!control.disabled || clicks || !unchanged || parseFloat(getComputedStyle(control).opacity) > .5)
            result.disabledFailures.push({classes:control.className,disabled:control.disabled,clicks,unchanged});
        }
        probeStyle.remove();
        host.querySelector("#preview-disabled").checked = false;
        host.querySelector("#preview-disabled").dispatchEvent(new Event("change"));
        result.reenabled = !!ready(atlasDoc, ".era-helper-samples button");
        const suffix = atlasDoc.querySelector("button[data-suffix='›']");
        result.controllerHints = [".era-repeat", ".era-timestop-button", ".era-move-back"]
          .map(selector => atlasDoc.querySelector(selector).dataset.controllerHint);
        result.metadata = {
          number: suffix.querySelectorAll(".command-number").length === 1,
          hidden: suffix.querySelector(".command-number").getAttribute("aria-hidden") === "true",
          suffix: suffix.querySelector(".era-button-suffix").textContent,
          noNestedNumberLabel: !suffix.querySelector(".command-number .interactive-label"),
          classes: suffix.className,
        };
        host.querySelector("#preview-controller-hints").checked = true;
        host.querySelector("#preview-controller-hints").dispatchEvent(new Event("change"));
        result.numbersHidden = getComputedStyle(suffix.querySelector(".command-number")).display === "none"
          && suffix.classList.contains("has-controller-hint");
        host.querySelector("#preview-controller-hints").checked = false;
        host.querySelector("#preview-controller-hints").dispatchEvent(new Event("change"));
        result.numbersRestored = getComputedStyle(suffix.querySelector(".command-number")).display !== "none";
        result.preferencesUnchanged = atlasDoc.defaultView.localStorage.getItem("era-typescript.controller-hints") === savedHints;
        const gameDoc = gameFrame.contentDocument;
        for (let n = 0; n < 3 && !gameDoc.body.classList.contains("has-controller"); n++)
          gameDoc.querySelector("#controller-hints-toggle").click();
        result.gameNumbersHidden = getComputedStyle(gameDoc.querySelector(".screen.is-active .command-number")).display === "none";
        host.querySelector("#preview-size").value = "deck";
        host.querySelector("#preview-size").dispatchEvent(new Event("change"));
        const buttonDocument = catalog.contentDocument;
        host.querySelector("a[data-sample='map']").click();
        stage = "map places";
        await until(() => catalog.contentDocument !== buttonDocument
          && ready(catalog.contentDocument, ".era-move-place-list button.era-move-place"));
        const mapDoc = catalog.contentDocument;
        await mapDoc.fonts.ready;
        const side = mapDoc.querySelector(".era-move-side");
        const mapBody = mapDoc.querySelector(".era-move-body");
        const places = [...side.querySelectorAll("button.era-move-place")];
        result.map = {
          sharedTabs: [...mapDoc.querySelectorAll(".era-move-tabs .era-move-tab")].every(tab =>
            tab.classList.contains("era-sheet-page")
              && tab.classList.contains("era-current") === tab.classList.contains("era-move-current")),
          returnButton:!!side.querySelector(".era-move-return"),
          exitButton:!!side.querySelector(".era-move-exit"),
          nearby:!!side.querySelector(".era-move-nearby"),
          more:!!side.querySelector(".era-move-more"),
          aligned:places.every(place => getComputedStyle(place).justifyContent === "flex-start"
            && getComputedStyle(place).textAlign === "left"
            && place.querySelector(".era-move-num").getBoundingClientRect().left
              - place.getBoundingClientRect().left < 12),
        };
        const isolated = mapDoc.createElement("div");
        isolated.className = "line";
        mapDoc.querySelector(".screen.is-active").append(isolated);
        result.map.independent = places.every(place => {
          const clone = place.cloneNode(true);
          isolated.replaceChildren(clone);
          return JSON.stringify(style(place)) === JSON.stringify(style(clone));
        });
        isolated.remove();
        result.map.layouts = [];
        for (const viewportSize of ["deck", "desktop"]) {
          host.querySelector("#preview-size").value = viewportSize;
          host.querySelector("#preview-size").dispatchEvent(new Event("change"));
          if (viewportSize === "desktop") catalog.style.width = "1600px";
          await pause();
          const width = side.getBoundingClientRect().width;
          const names = [...side.querySelectorAll(".era-move-place-name")];
          const contents = names.map(name => name.innerHTML);
          names.forEach(name => name.textContent = "Room");
          await pause();
          const shortWidth = side.getBoundingClientRect().width;
          names.forEach((name, index) => name.innerHTML = contents[index]);
          await pause();
          result.map.layouts.push({viewportSize,width,shortWidth,
            bodyWidth:mapBody.getBoundingClientRect().width,
            overflow:side.scrollWidth > side.clientWidth + 1,
            sideBySide:side.getBoundingClientRect().left >= mapDoc.querySelector(".era-move-map").getBoundingClientRect().right});
        }
        host.querySelector("#preview-size").value = "narrow";
        host.querySelector("#preview-size").dispatchEvent(new Event("change"));
        catalog.style.width = "";
        await pause();
        result.map.narrowStacked = side.getBoundingClientRect().top
          >= mapDoc.querySelector(".era-move-map").getBoundingClientRect().bottom;
        result.map.narrowOverflow = mapBody.scrollWidth > mapBody.clientWidth + 1;
        stage = "map back to main";
        const back = await until(() => ready(mapDoc, ".screen.is-active .era-move-back"));
        back.click();
        result.map.backWorks = !!await until(() => {
          if (mapDoc.querySelector("#terminal.is-waiting")) mapDoc.querySelector("#terminal").click();
          const decline = [...mapDoc.querySelectorAll(".screen.is-active button.choice:enabled")]
            .find(control => control.textContent.trim() === "[Decline]");
          if (decline && !mapDoc.body.classList.contains("is-busy")) decline.click();
          result.map.backState = {
            busy: mapDoc.body.classList.contains("is-busy"),
            terminal: mapDoc.querySelector("#terminal").className,
            choices: [...mapDoc.querySelectorAll(".screen.is-active button.choice")]
              .map(control => [control.dataset.value, control.disabled, control.textContent]),
            status: mapDoc.querySelector("#status").textContent,
          };
          return ready(mapDoc, ".screen.is-active .era-actions-collection button.era-button");
        });
        host.querySelector("a[data-sample='chrome']").click();
        await until(() => !host.querySelector("#chrome-buttons").hidden);
        result.chromeSamples = host.querySelectorAll("#chrome-buttons .ui-button-sample").length;
        result.chromeVisible = !host.querySelector("#chrome-buttons").hidden;
        host.querySelector("#preview-disabled").checked = true;
        host.querySelector("#preview-disabled").dispatchEvent(new Event("change"));
        const chromeStyle = host.createElement("style");
        chromeStyle.textContent = [...host.styleSheets].flatMap(sheet => [...sheet.cssRules].map(rule => rule.cssText))
          .join("\\n").replaceAll(":hover", ".catalog-hover").replaceAll(":focus-visible", ".catalog-focus")
          .replaceAll("@media (hover: hover)", "@media all")
          + "\\n.ui-button { transition: none !important; }";
        host.head.append(chromeStyle);
        result.chromeDisabledFailures = [];
        const chromeDisabled = [...host.querySelectorAll("#chrome-buttons .ui-button:is(:disabled, [aria-disabled='true'])")];
        result.chromeDisabledCount = chromeDisabled.length;
        for (const control of chromeDisabled) {
          const before = appearance(control);
          let clicks = 0;
          if (control.tagName === "BUTTON") {
            control.addEventListener("click", () => clicks++);
            control.click();
          }
          control.classList.add("catalog-hover", "catalog-focus");
          const unchanged = appearance(control) === before;
          control.classList.remove("catalog-hover", "catalog-focus");
          if (clicks || !unchanged || parseFloat(getComputedStyle(control).opacity) > .5
            || control.tagName === "BUTTON" && !control.disabled || control.tagName === "A" && control.hasAttribute("href"))
            result.chromeDisabledFailures.push({classes:control.className,clicks,unchanged});
        }
        chromeStyle.remove();
        host.querySelector("#preview-disabled").checked = false;
        host.querySelector("#preview-disabled").dispatchEvent(new Event("change"));
        result.chromeRestored = [...host.querySelectorAll("#chrome-buttons button.ui-button")].every(control => !control.disabled)
          && [...host.querySelectorAll("#chrome-buttons a.ui-button")].every(control => control.hasAttribute("href"));
        host.querySelector("#preview-controller-hints").checked = true;
        host.querySelector("#preview-controller-hints").dispatchEvent(new Event("change"));
        result.chromeHints = [...host.querySelectorAll("#chrome-buttons .ui-button")].every(control => control.classList.contains("has-controller"));
        document.querySelector("#result").textContent = JSON.stringify(result);
      })().catch(error => document.querySelector("#result").textContent = JSON.stringify({...result,error:error.message}));
      </script>`);
  });
  const profile = await mkdtemp(join(process.cwd(), ".era-components-browser-"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const { stdout } = await promisify(execFile)(browser!, [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-networking",
      `--user-data-dir=${profile}`, "--dump-dom", "--virtual-time-budget=45000",
      `http://127.0.0.1:${address.port}/component-probe`,
    ], { timeout: 90000, maxBuffer: 2_000_000 });
    const encoded = stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
    assert.ok(encoded, stdout.slice(0, 2000));
    const result = JSON.parse(encoded.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.deepEqual(result.preview, result.normal, "component rendering must match real gameplay");
    assert.match(result.preview.font, /BIZ UD Gothic.*monospace/);
    assert.equal(result.variantFont, result.preview.font);
    assert.equal(result.renderer, true);
    assert.equal(result.bizFont, true);
    assert.equal(result.active, true);
    assert.ok(result.cards > 0);
    assert.ok(result.statusHeight < 40, "status must not consume the game viewport");
    assert.ok(result.terminalHeight > 850, "the renderer must receive the full preview height");
    assert.equal(result.width, 640);
    assert.equal(result.buttonFits, true);
    assert.equal(result.variants, 4);
    assert.equal(result.noStateLabels, true);
    assert.equal(result.repeatEmpty, true);
    assert.equal(result.continueEnabled, true);
    assert.equal(result.noImageErrors, true);
    assert.equal(result.radioInitial, true);
    assert.equal(result.radioChanged, true);
    assert.equal(result.radioLayout, true);
    assert.equal(new Set(result.toneHovers.map(tone => tone.after)).size, 7);
    assert.ok(result.toneHovers.every(tone => tone.before !== tone.after));
    assert.equal(result.reenabled, true);
    assert.equal(result.numbersHidden, true);
    assert.equal(result.numbersRestored, true);
    assert.equal(result.gameNumbersHidden, true);
    assert.equal(result.preferencesUnchanged, true);
    assert.equal(result.chromeRestored, true);
    assert.equal(result.chromeHints, true);
    assert.ok(result.gameSamples > 60);
    assert.deepEqual(result.contextFailures, [], "catalogued buttons must not acquire styles from parent panels");
    assert.ok(result.disabledCount > 60, "all applicable button variants expose a disabled example");
    assert.deepEqual(result.disabledFailures, [], "disabled examples must be muted, inert, and unaffected by hover/focus");
    assert.deepEqual(result.metadata, { number: true, hidden: true, suffix: "›", noNestedNumberLabel: true,
      classes: "choice era-button era-button-block" });
    assert.deepEqual(result.controllerHints, ["X", "Y", "B"]);
    assert.ok(result.chromeSamples > 10);
    assert.equal(result.chromeVisible, true);
    assert.equal(result.chromeDisabledCount, result.chromeSamples, "every catalogued app control is disabled");
    assert.deepEqual(result.chromeDisabledFailures, [], "disabled app controls must be inert, muted, and unaffected by hover/focus");
    assert.equal(result.map.returnButton, true);
    assert.equal(result.map.sharedTabs, true);
    assert.equal(result.map.exitButton, true);
    assert.equal(result.map.nearby, true);
    assert.equal(result.map.more, true);
    assert.equal(result.map.aligned, true, "all Places controls must start at the left padding");
    assert.equal(result.map.independent, true, "Places buttons must look identical outside the map panel");
    for (const layout of result.map.layouts) {
      assert.equal(layout.sideBySide, true, JSON.stringify(layout));
      assert.ok(layout.width <= layout.bodyWidth * .4 + 1, JSON.stringify(layout));
      assert.ok(layout.shortWidth < layout.width - 30, "sidebar must shrink with its content: " + JSON.stringify(layout));
      assert.equal(layout.overflow, false, JSON.stringify(layout));
    }
    assert.equal(result.map.narrowStacked, true);
    assert.equal(result.map.narrowOverflow, false);
    assert.equal(result.map.backWorks, true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app.closeAllConnections();
    await rm(profile, { recursive: true, force: true });
  }
});

test("calendar character lists wrap horizontally in the production renderer", {
  skip: !browser || !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const fixture = emptyGame(game.root);
  indexScript(fixture, `@SYSTEM_TITLE
FOR LOCAL, 0, 14
  ADDCHARA LOCAL
  CFLAG:LOCAL:信頼度 = 100
NEXT
MASTER = 0
TARGET = 1
DAY = 94
DAY:2 = 4
DAY:3 = 1
FLAG:1007 = 1
CALL CALENDAR
QUIT
@CHARA_HOLIDAY(ARG, ARG:1)
#FUNCTION
RETURNF 0
@ESTRUS_CATEGORY(ARG, ARG:1)
#FUNCTIONS
RETURNF "危険日"`, "<calendar-browser-fixture>");
  for (const [name, routines] of fixture.routines) game.routines.set(name, routines);
  const app = createApp([{ id: "tw", title: "eraTW", game }], true);
  const server = createServer((request, response) => {
    if (request.url !== "/calendar-probe") { app.emit("request", request, response); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><style>iframe{width:1440px;height:900px;border:0}</style>
      <iframe id="calendar" src="/?game=tw"></iframe><pre id="result"></pre><script>
      const pause = () => new Promise(resolve => setTimeout(resolve, 100));
      let stage = "opening calendar";
      async function until(read) {
        for (let n = 0; n < 180; n++) { const value = read(); if (value) return value; await pause(); }
        throw new Error("Calendar preview did not become ready: " + stage);
      }
      (async () => {
        const frame = document.querySelector("#calendar");
        const doc = await until(() => {
          const doc = frame.contentDocument;
          return doc?.querySelector(".era-calendar:popover-open .era-calendar-person:enabled")
            && !doc.body.classList.contains("is-busy") && doc;
        });
        await doc.fonts.ready;
        const layouts = [];
        for (const view of ["Work", "Fertility"]) {
          if (view === "Fertility") {
            stage = "fertility view";
            doc.querySelector(".era-calendar button[data-value='901']").click();
            await until(() => !doc.body.classList.contains("is-busy")
              && doc.querySelector(".era-calendar .era-current[data-value='901']"));
          }
          for (const width of [1440, 1200, 640, 390]) {
            frame.style.width = width + "px";
            await pause();
            const dialog = doc.querySelector(".era-calendar:popover-open");
            const people = dialog.querySelector(".era-calendar-people");
            const dayContentStyle = frame.contentWindow.getComputedStyle(dialog.querySelector(".era-calendar-day-content"));
            const buttons = [...people.querySelectorAll("button")];
            const bounds = people.getBoundingClientRect();
            layouts.push({view, width, display:frame.contentWindow.getComputedStyle(people).display,
              dayPadding:dayContentStyle.padding, dayRowGap:dayContentStyle.rowGap, dayColumnGap:dayContentStyle.columnGap,
              count:buttons.length,
              sameRow:Math.abs(buttons[0].getBoundingClientRect().top - buttons[1].getBoundingClientRect().top) < 1,
              fits:buttons.every(button => button.getBoundingClientRect().right <= bounds.right + 1),
              maxDayHeight:Math.max(...[...dialog.querySelectorAll(".era-calendar-day")]
                .map(day => day.getBoundingClientRect().height)),
              overflow:dialog.querySelector(".era-inventory-body").scrollWidth
                > dialog.querySelector(".era-inventory-body").clientWidth + 1});
          }
        }
        const entries = [...doc.querySelector(".era-calendar-people").querySelectorAll(".era-calendar-person-entry")];
        const fertilityGrouped = entries.length === 13 && entries.every(entry =>
          entry.querySelectorAll("button").length === 1 && entry.textContent.includes("♥"));
        stage = "character detail";
        doc.querySelector(".era-calendar-person").click();
        const detail = await until(() => !doc.body.classList.contains("is-busy")
          && doc.querySelector(".era-calendar-detail"));
        const firstAvatar = !!detail.querySelector(".era-info-face .sprite-clip");
        stage = "returning to week";
        detail.querySelector("button").click();
        await until(() => !doc.body.classList.contains("is-busy") && doc.querySelector(".era-calendar-people"));
        stage = "sprite character detail";
        doc.querySelector(".era-calendar-person[data-value='2']").click();
        const spriteDetail = await until(() => !doc.body.classList.contains("is-busy")
          && doc.querySelector(".era-calendar-detail .era-info-face .sprite-clip"));
        const face = spriteDetail.closest(".era-info-face");
        const sprite = face.querySelector(".sprite-clip");
        const avatarLayouts = [];
        for (const width of [1440, 390]) {
          frame.style.width = width + "px";
          await pause();
          const bounds = face.getBoundingClientRect();
          const name = face.nextElementSibling.getBoundingClientRect();
          const detail = face.closest(".era-calendar-detail");
          avatarLayouts.push({width, faceWidth:bounds.width, faceHeight:bounds.height,
            besideName:name.left >= bounds.right,
            spriteHeight:sprite.getBoundingClientRect().height,
            fits:detail.scrollWidth <= detail.clientWidth + 1});
        }
        document.querySelector("#result").textContent = JSON.stringify({
          layouts, fertilityGrouped, detailWorks:true, firstAvatar, avatarLayouts});
      })().catch(error => {
        const doc = document.querySelector("#calendar").contentDocument;
        document.querySelector("#result").textContent = JSON.stringify({error:error.message,
          status:doc?.querySelector("#status")?.textContent,
          choices:[...doc?.querySelectorAll(".screen.is-active button.choice") ?? []]
            .map(button => [button.dataset.value, button.disabled, button.textContent]),
          terminal:doc?.querySelector("#terminal")?.textContent.slice(-1000)});
      });
      </script>`);
  });
  const profile = await mkdtemp(join(process.cwd(), ".era-calendar-browser-"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const { stdout } = await promisify(execFile)(browser!, [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-networking",
      `--user-data-dir=${profile}`, "--window-size=1600,1000", "--dump-dom", "--virtual-time-budget=30000",
      `http://127.0.0.1:${address.port}/calendar-probe`,
    ], { timeout: 60000, maxBuffer: 2_000_000 });
    const encoded = stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
    assert.ok(encoded, stdout.slice(0, 2000));
    const result = JSON.parse(encoded.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
    assert.equal(result.error, undefined, JSON.stringify(result));
    for (const layout of result.layouts) {
      assert.ok(layout.count >= 3, "exercise a populated work schedule");
      assert.equal(layout.display, "flex", JSON.stringify(layout));
      assert.equal(layout.dayPadding, "6px 9px", JSON.stringify(layout));
      assert.equal(layout.dayRowGap, "2px", JSON.stringify(layout));
      assert.equal(layout.dayColumnGap, "5px", JSON.stringify(layout));
      assert.equal(layout.sameRow, true, JSON.stringify(layout));
      assert.equal(layout.fits, true, JSON.stringify(layout));
      assert.equal(layout.overflow, false, JSON.stringify(layout));
      assert.ok(layout.maxDayHeight < (layout.width < 600 ? 400 : 240), JSON.stringify(layout));
    }
    assert.equal(result.detailWorks, true);
    assert.equal(result.fertilityGrouped, true, "fertility hearts must wrap together with their character names");
    assert.equal(result.firstAvatar, true, "character details show the shared boxed head avatar");
    for (const layout of result.avatarLayouts) {
      assert.equal(layout.faceWidth, 76, JSON.stringify(layout));
      assert.equal(layout.faceHeight, 76, JSON.stringify(layout));
      assert.equal(layout.besideName, true, JSON.stringify(layout));
      assert.ok(layout.spriteHeight >= 74, JSON.stringify(layout));
      assert.equal(layout.fits, true, JSON.stringify(layout));
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app.closeAllConnections();
    await rm(profile, { recursive: true, force: true });
  }
});
