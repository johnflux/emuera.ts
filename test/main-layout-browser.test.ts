import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compactPicture } from "../src/graphics.js";
import { emptyGame } from "../src/loader.js";
import { createApp } from "../src/server.js";

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
  const profile = await mkdtemp(join(tmpdir(), "era-graphics-csp-"));
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

test("clock plaque labels fit at desktop and handheld font sizes", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [style, handheld] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/handheld.css", import.meta.url), "utf8"),
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
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${handheld}
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
  const profile = await mkdtemp(join(tmpdir(), "era-clock-layout-"));
  try {
    for (const [mode, size] of [["desktop", "1440,1000"], ["compact", "1200,700"], ["is-handheld", "1440,1000"]] as const) {
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
        if (mode !== "desktop" && /-(time-stop|resume)$/.test(result.name))
          assert.ok(parseFloat(result.gap) > 0, `${mode} ${result.name}: existing spacing remains unchanged`);
        if (mode !== "desktop") assert.equal(result.font, "19px", `${mode} ${result.name}: font remains unchanged`);
      }
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

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

test("room names have no pressed-button box while other pressed controls keep it", { skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH" }, async () => {
  const [style, handheld] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/handheld.css", import.meta.url), "utf8"),
  ]);
  const html = `<!doctype html><style>${style}\n${handheld}</style><body class="MODE">
    <div class="screen is-active">
      <div class="era-room-stage"><div class="era-occupant"><div class="line">
        <button class="choice era-occupant-label" aria-pressed="true"><span class="era-occupant-text"><span class="era-occupant-name">Kana</span><span class="era-occupant-state">Favor 6 <span class="era-feel era-feel-friend">Friend</span></span></span></button>
        <button class="choice era-occupant-label" aria-pressed="false"><span class="era-occupant-text"><span class="era-occupant-name">Reimu</span><span class="era-occupant-state">Favor 0</span></span></button>
      </div></div></div>
      <button id="control" aria-pressed="true">Other control</button>
    </div><script>
      const names = [...document.querySelectorAll(".era-occupant-label")].map(button => {
        const style = getComputedStyle(button);
        return { border: style.borderWidth, shadow: style.boxShadow, background: style.backgroundColor };
      });
      const shadows = [...document.querySelectorAll(".era-occupant-name, .era-occupant-state, .era-feel")]
        .map(element => getComputedStyle(element).textShadow);
      document.body.textContent = JSON.stringify({ names, shadows, control: getComputedStyle(document.querySelector("#control")).boxShadow });
    </script>`;
  const profile = await mkdtemp(join(tmpdir(), "era-room-labels-"));
  try {
    for (const mode of ["desktop", "is-handheld"]) {
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
  const [style, handheld] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/handheld.css", import.meta.url), "utf8"),
  ]);
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${handheld}
    .fixture { width: 900px; margin: 20px; }
    </style><body class="MODE has-controller"><div class="screen is-active"><div class="era-main fixture">
    <div class="era-card era-main-actions"><div class="line"><div class="era-card-title era-actions-header">
    <span>Interact with Kana</span><span class="era-toggles"><label class="checkbox-control era-toggle">Petting</label>
    <label class="checkbox-control era-toggle">Housekeeping</label>
    <button class="choice era-repeat" aria-label="Repeat last action"></button></span>
    </div></div></div></div></div><script>
    const button = document.querySelector(".era-repeat"), card = button.closest(".era-card");
    const rect = button.getBoundingClientRect(), edge = card.getBoundingClientRect();
    const css = getComputedStyle(button), hint = getComputedStyle(button, "::after");
    const hintContent = hint.content, hintSize = hint.width;
    const normalImage = css.backgroundImage;
    button.focus();
    const focusImage = getComputedStyle(button).backgroundImage;
    button.blur();
    button.classList.add("is-pending");
    button.disabled = true;
    const pendingImage = getComputedStyle(button).backgroundImage;
    button.classList.replace("is-pending", "is-selected");
    const selectedImage = getComputedStyle(button).backgroundImage;
    const busyHint = getComputedStyle(button, "::after").content;
    document.body.classList.remove("has-controller");
    const offHint = getComputedStyle(button, "::after").content;
    document.body.textContent = JSON.stringify({ right: edge.right - rect.right, top: rect.top - edge.top,
      width: rect.width, height: rect.height, normalImage, focusImage, pendingImage, selectedImage,
      radius: css.borderTopRightRadius, hint: hintContent, hintSize, busyHint, offHint });
    </script>`;
  const profile = await mkdtemp(join(tmpdir(), "era-repeat-corner-"));
  try {
    for (const mode of ["desktop", "is-handheld"]) {
      const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, "--window-size=1440,1000", "--dump-dom"];
      if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");
      args.push(`data:text/html;base64,${Buffer.from(html.replace("MODE", mode)).toString("base64")}`);
      const { stdout } = await execute(browser!, args, { maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
      const match = stdout.match(/<body[^>]*>([\s\S]*?)<\/body>/);
      assert.ok(match);
      const result = JSON.parse(match[1]) as { right: number; top: number; width: number; height: number; normalImage: string; focusImage: string; pendingImage: string; selectedImage: string; radius: string; hint: string; hintSize: string; busyHint: string; offHint: string };
      assert.ok(Math.abs(result.right - 1) < 1, `${mode}: right corner ${JSON.stringify(result)}`);
      assert.ok(Math.abs(result.top - 1) < 1, `${mode}: top corner ${JSON.stringify(result)}`);
      assert.equal(result.width, 40, `${mode}: image button width`);
      assert.equal(result.height, 40, `${mode}: image button height`);
      assert.match(result.normalImage, /\/repeat\.webp/);
      for (const image of [result.focusImage, result.pendingImage, result.selectedImage]) {
        assert.match(image, /\/repeat-active\.webp/, `${mode}: interactive artwork`);
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
  const [style, handheld] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/handheld.css", import.meta.url), "utf8"),
  ]);
  const portrait = (size: number) => `<div class="era-occupant"><div class="era-portrait"><div class="line"><span><button class="choice"><span class="sprite" style="width:${size}px"><span class="sprite-clip" style="width:${size}px;height:${size}px"><canvas width="512" height="512" style="width:${size}px;height:${size}px"></canvas></span></span></button></span></div></div></div>`;
  const fixtures = [[150], [283.5], [150, 360], []].map(sizes => `
    <div class="fixture" data-case="${sizes.join(",") || "empty"}">
      <div class="era-room-stage"><div class="era-occupants"><div class="era-occupant-list">
        ${sizes.length ? sizes.map(portrait).join("") : '<div class="era-alone-message">Nobody here</div>'}
      </div></div></div>
    </div>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${handheld}</style><body class="MODE">
    <div class="screen is-active">${fixtures}</div><script>
      const results = [...document.querySelectorAll(".fixture")].map(f => {
        const list = f.querySelector(".era-occupant-list").getBoundingClientRect();
        const portraits = [...f.querySelectorAll(".sprite-clip")].map(e => e.getBoundingClientRect());
        return { name: f.dataset.case, height: list.height,
          fits: portraits.every(r => r.top >= list.top - 1 && r.bottom <= list.bottom + 1) };
      });
      document.body.textContent = JSON.stringify(results);
    </script>`;
  const profile = await mkdtemp(join(tmpdir(), "era-portrait-layout-"));
  try {
    for (const mode of ["desktop", "is-handheld"]) {
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
  const [style, handheld] = await Promise.all([
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/handheld.css", import.meta.url), "utf8"),
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
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${handheld}</style><body>${fixtures}<script>
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
  const profile = await mkdtemp(join(tmpdir(), "era-history-priority-"));
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
          ${history ? '<section class="era-main-chat"><div class="era-history-pane"><div class="era-history-body"><p>Interaction history</p><p>Second line</p><p>Third line</p><p>Fourth line</p></div></div></section>' : ""}
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
