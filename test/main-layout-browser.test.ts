import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

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
  gaps: number[];
};

test("compact button sizes share tokens without changing desktop or sprite controls", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [style, handheld] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/handheld.css", import.meta.url), "utf8"),
  ]);
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${handheld}</style>
    <body class="MODE">
      <div class="screen is-active" style="font: 12px/1.25 sans-serif">
        <div class="era-actions-group"><div class="line">
          <span class="print-cell" id="tile">Move<button class="choice command-number-only"><span class="command-number">400</span></button></span>
          <span class="era-guard-control" id="number-guard">Guard<button class="choice command-number-only"><span class="command-number">1</span></button></span>
          <span class="print-cell" id="multiline" style="width: 80px">A long action label that wraps across multiple lines<button class="choice command-number-only"><span class="command-number">2</span></button></span>
          <span class="era-guard-control" id="guard"><button class="choice">Relationship</button></span>
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
        const overlay = { position: numberStyle.position, covers: ["top", "right", "bottom", "left"].every(edge => Math.abs(tile[edge] - button[edge]) <= 1.1), numberDisplay: getComputedStyle(number.firstElementChild).display };
        document.documentElement.style.setProperty("--compact-choice-min-height", "48px");
        document.documentElement.style.setProperty("--handheld-chrome-min-height", "52px");
        document.documentElement.style.setProperty("--compact-relationship-button-height", "64px");
        document.body.textContent = JSON.stringify({ initial, updated: snapshot(), overlay });
      </script>`;
  type Item = { minHeight: string; height: number; display: string; position: string };
  type Result = { initial: Record<string, Item>; updated: Record<string, Item>; overlay: { position: string; covers: boolean; numberDisplay: string } };
  const profile = await mkdtemp(join(tmpdir(), "era-buttons-"));
  try {
    for (const [mode, size] of [["desktop", "1440,1000"], ["compact", "1200,700"], ["is-handheld", "1440,1000"]] as const) {
      const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, `--window-size=${size}`, "--dump-dom"];
      if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
      args.push(`data:text/html;base64,${Buffer.from(html.replace("MODE", mode)).toString("base64")}`);
      const { stdout } = await execute(browser!, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
      const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
      assert.ok(match, `${mode}: browser returned button measurements`);
      const { initial, updated, overlay } = JSON.parse(match[1]) as Result;
      const compact = mode !== "desktop";
      for (const id of ["tile", "number-guard"]) {
        assert.equal(initial[id].minHeight, compact ? "36px" : "auto", `${mode}: ${id} initial minimum`);
        assert.equal(updated[id].minHeight, compact ? "48px" : "auto", `${mode}: ${id} updated minimum`);
        if (compact) assert.equal(updated[id].height, 48, `${mode}: ${id} follows the shared size`);
      }
      assert.equal(overlay.position, compact ? "absolute" : "static", `${mode}: number button position`);
      assert.equal(overlay.numberDisplay, compact ? "none" : "inline", `${mode}: command number visibility`);
      if (compact) assert.ok(overlay.covers, `${mode}: number button covers its tile`);
      assert.ok(updated.multiline.height > 48, `${mode}: long labels can grow beyond the minimum height`);
      assert.equal(initial.guard.minHeight, mode === "is-handheld" ? "36px" : "auto");
      assert.equal(updated.guard.minHeight, mode === "is-handheld" ? "48px" : "auto");
      assert.equal(initial.choice.minHeight, mode === "is-handheld" ? "36px" : "auto");
      assert.equal(updated.choice.minHeight, mode === "is-handheld" ? "48px" : "auto");
      assert.equal(updated.sprite.minHeight, initial.sprite.minHeight);
      assert.equal(initial.save.minHeight, compact ? "36px" : "23px");
      assert.equal(updated.save.minHeight, compact ? "48px" : "23px");
      if (compact) {
        assert.equal(initial.relationship.height, 56);
        assert.equal(updated.relationship.height, 64);
      }
      if (mode === "is-handheld") {
        for (const id of ["settings", "dialog"]) {
          assert.equal(initial[id].minHeight, "44px");
          assert.equal(updated[id].minHeight, "52px");
        }
      }
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("main screen distributes space and spaces player controls consistently", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [style, handheld] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/handheld.css", import.meta.url), "utf8"),
  ]);
  const room = (occupied: boolean, history: boolean, crowded: boolean, counters: boolean) => `
    <div id="terminal" style="width: 1180px; height: ${crowded ? 600 : 720}px; font-size: 20px; line-height: 1.25">
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
          ${history ? '<section class="era-main-chat"><div class="era-history-pane"><div>Interaction history</div></div></section>' : ""}
        </div></div>
        <div class="era-card era-main-actions"><div class="line">Interact</div>
          ${Array.from({ length: crowded ? 8 : 2 }, () => '<div class="line" style="height:45px">Action row</div>').join("")}
        </div>
        <div class="era-main-sidebar"><div class="era-main-right"><div class="era-card era-player">
          <div class="line">Player</div>
          <div class="line"><div class="era-player-actions"><button class="choice era-player-control">Inventory</button></div></div>
          <div class="era-player-management"><div class="era-actions-group">
            <div class="line"><span class="print-cell">Move<button class="choice command-number-only">400</button></span><span class="print-cell">Go Out<button class="choice command-number-only">405</button></span><span class="print-cell">Lock The Door<button class="choice command-number-only">991</button></span></div>
            <div class="line"><span><div class="era-toggles era-auto-toggles"><button class="choice era-toggle">Auto-TSP Movement</button><button class="choice era-toggle">Auto-Clean</button><button class="choice era-toggle">Pushdown Guard</button></div></span></div>
          </div><div class="era-settings"><div class="line"><button class="choice era-chip-button">Config</button></div></div></div>
        </div></div></div>
        ${counters ? '<div class="era-card era-counters" style="height:35px">Counters</div>' : ""}
      </div></div>
    </div>`;
  const cases = [false, true].flatMap(occupied => [false, true].flatMap(history =>
    [false, true].flatMap(crowded => [false, true].map(counters => ({ occupied, history, crowded, counters })))));
  const markup = cases.map(({ occupied, history, crowded, counters }) =>
    `<div class="fixture">${room(occupied, history, crowded, counters)}</div>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${handheld}</style>
    <body class="MODE">${markup}
    <script>
      const results = [...document.querySelectorAll(".fixture")].map(fixture => {
        const get = selector => fixture.querySelector(selector);
        const rect = selector => get(selector).getBoundingClientRect();
        const actions = get(".era-main-actions"), center = get(".era-main-center");
        const inventory = rect(".era-player-control");
        const tiles = [...fixture.querySelectorAll(".era-player-management .print-cell")].map(e => e.getBoundingClientRect());
        const toggles = [...fixture.querySelectorAll(".era-auto-toggles .era-toggle")].map(e => e.getBoundingClientRect());
        const config = rect(".era-chip-button");
        return {
          room: rect(".era-occupant-list").height, roomVisible: center.clientHeight, roomScroll: center.scrollHeight,
          actions: actions.getBoundingClientRect().height, actionsClient: actions.clientHeight, actionsScroll: actions.scrollHeight,
          actionsSpare: actions.getBoundingClientRect().bottom - actions.lastElementChild.getBoundingClientRect().bottom,
          grid: getComputedStyle(get(".era-main")).gridTemplateRows,
          detail: [rect(".era-character").height, rect(".era-room-stage").height, rect(".era-occupants").height, rect(".era-place").height],
          historyDisplay: get(".era-main-chat") ? getComputedStyle(get(".era-main-chat")).display : "absent",
          historyHeight: get(".era-main-chat") ? rect(".era-main-chat").height : 0,
          gaps: [tiles[0].top - inventory.bottom, tiles[2].top - tiles[0].bottom,
            toggles[0].top - tiles[2].bottom, toggles[2].top - toggles[0].bottom, config.top - toggles[2].bottom]
        };
      });

      document.body.textContent = JSON.stringify(results);
    </script>`;
  const profile = await mkdtemp(join(tmpdir(), "era-layout-"));
  try {
    for (const [mode, size] of [["desktop", "1440,900"], ["is-handheld", "1200,700"]] as const) {
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
        assert.equal(result.historyDisplay === "none", mode === "is-handheld" && history, `${label}: history visibility`);
        if (history && mode === "desktop")
          assert.ok(result.historyHeight >= 113, `${label}: visible history should have space for five lines`);
        if (!crowded)
          assert.ok(Math.abs(result.room - 216) < 1, `${label}: room should reach portrait height: ${JSON.stringify(result)}`);
        if (mode === "is-handheld" && crowded) {
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
  const [style, handheld] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/handheld.css", import.meta.url), "utf8"),
  ]);
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${handheld}</style><body>
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
  const profile = await mkdtemp(join(tmpdir(), "era-sky-layout-"));
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

test("stats scroll independently while player controls retain space", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [style, handheld] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/handheld.css", import.meta.url), "utf8"),
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
            <div class="line"><button class="choice era-player-control">Inventory</button></div>
            <div class="line"><button class="choice era-chip-button">Config</button></div>
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
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${handheld}</style><body class="MODE">
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
        return { name: f.dataset.case, sidebarClient: sidebar.clientHeight, sidebarScroll: sidebar.scrollHeight,
          sidebarBefore: before, sidebarAfterStats, sidebarScrolled: sidebar.scrollTop,
          playerHeight: player.getBoundingClientRect().height, statsFocused, configBottomBefore,
          configBottom: config.getBoundingClientRect().bottom - sidebar.getBoundingClientRect().top,
          statsClient: stats?.clientHeight, statsScroll: stats?.scrollHeight, statsTop: stats?.scrollTop,
          statsOverflow: stats && getComputedStyle(stats).overflowY };
      });
      document.body.textContent = JSON.stringify(results);
    </script>`;
  const profile = await mkdtemp(join(tmpdir(), "era-sidebar-layout-"));
  try {
    for (const [mode, size] of [["desktop", "1440,900"], ["is-handheld", "1200,700"]] as const) {
      const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, `--window-size=${size}`, "--dump-dom"];
      if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
      args.push(`data:text/html;base64,${Buffer.from(html.replace("MODE", mode)).toString("base64")}`);
      const { stdout } = await execute(browser!, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
      const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
      assert.ok(match);
      const results = JSON.parse(match[1]) as Array<{
        name: string; sidebarClient: number; sidebarScroll: number; sidebarBefore: number; sidebarAfterStats: number;
        sidebarScrolled: number; playerHeight: number; configBottom: number; configBottomBefore: number; statsFocused: boolean;
        statsClient?: number; statsScroll?: number; statsTop?: number; statsOverflow?: string;
      }>;
      const wide = results.find(result => result.name === "wide")!;
      assert.equal(wide.statsOverflow, "auto", mode);
      assert.ok(wide.statsScroll! > wide.statsClient!, `${mode}: stats overflow within their own card`);
      assert.ok(wide.statsTop! > 0, `${mode}: stats reach lower rows`);
      assert.equal(wide.statsFocused, true, `${mode}: stats can receive keyboard focus`);
      assert.equal(wide.sidebarBefore, wide.sidebarAfterStats, `${mode}: scrolling stats does not scroll player`);
      assert.ok(wide.configBottomBefore <= wide.sidebarClient + 1, `${mode}: player controls remain visible: ${JSON.stringify(wide)}`);
      assert.ok(wide.playerHeight < wide.sidebarClient - 80, `${mode}: player does not consume stats space`);
      const short = results.find(result => result.name === "short-stats")!;
      assert.equal(short.statsScroll, short.statsClient, `${mode}: short stats do not overflow`);
      assert.ok(short.statsClient! > 80, `${mode}: stats fill spare sidebar space`);
      assert.ok(Math.abs(short.playerHeight - wide.playerHeight) <= 1, `${mode}: spare space does not expand player`);
      const large = results.find(result => result.name === "large-player")!;
      assert.ok(large.sidebarScroll > large.sidebarClient, `${mode}: oversized player remains reachable by sidebar scrolling`);
      assert.ok(large.sidebarScrolled > 0 && large.configBottom <= large.sidebarClient + 1,
        `${mode}: sidebar scrolling reaches the last player control`);
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
