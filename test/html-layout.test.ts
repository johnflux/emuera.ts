import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { createCanvas, loadImage } from "@napi-rs/canvas";

test("HTML renderer supports semantic headings while keeping executable tags disallowed", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const declaration = source.match(/^const allowedTags = .+;$/m)![0];
  const allowed = runInNewContext(`${declaration}\nallowedTags`) as Set<string>;
  for (let level = 1; level <= 6; level++) assert.ok(allowed.has(`H${level}`));
  for (const tag of ["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED"]) assert.ok(!allowed.has(tag));
});

test("vector clock draws exact game minutes, wraps days and rejects invalid input", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const routine = source.slice(source.indexOf("function clock("), source.indexOf("/** Hotpatch extension: <meter"));
  class Element {
    attributes = new Map<string, string>();
    children: Element[] = [];
    tooltip = "";
    className = "";
    textContent = "";
    constructor(readonly tag: string) {}
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    append(child: Element) { this.children.push(child); }
  }
  const draw = (value: string | null, title: string | null = null): Element => runInNewContext(`${routine}\nclock(node);`, {
    node: { getAttribute: (name: string) => name === "data-minutes" ? value : title },
    document: { createElement: (tag: string) => new Element(tag),
      createElementNS: (_namespace: string, tag: string) => new Element(tag) },
    describe: (element: Element, text: string) => { element.tooltip = text; },
  });
  for (const [minutes, time, hour, minute] of [
    [0, "00:00", 0, 0], [367, "06:07", 183.5, 42], [719, "11:59", 359.5, 354],
    [720, "12:00", 0, 0], [1439, "23:59", 359.5, 354], [1440, "00:00", 0, 0],
    [1807, "06:07", 183.5, 42], [-1, "23:59", 359.5, 354],
  ] as const) {
    const element = draw(String(minutes));
    assert.equal(element.attributes.get("role"), "img");
    assert.equal(element.attributes.get("aria-label"), `Game time: ${time}`);
    assert.equal(element.tooltip, `Game time: ${time}`);
    const svg = element.children[0]!;
    assert.equal(svg.attributes.get("viewBox"), "0 0 72 72");
    assert.equal(svg.attributes.get("aria-hidden"), "true");
    assert.equal(element.children.length, 1, "the artwork supplies the glass sheen");
    const parts = svg.children;
    assert.equal(parts.filter((part) => part.attributes.get("class")?.includes("era-clock-tick")).length, 60);
    assert.equal(parts.filter((part) => part.attributes.get("class")?.includes("era-clock-quarter")).length, 4);
    assert.equal(parts.filter((part) => part.attributes.get("class")?.includes("era-clock-hour-mark")).length, 12);
    for (const part of parts.filter((part) => part.attributes.get("class")?.includes("era-clock-tick"))) {
      assert.equal(part.attributes.get("y1"), "4.5");
      assert.equal(part.attributes.get("y2"), part.attributes.get("class")!.includes("era-clock-hour-mark") ? "8.5" : "7");
    }
    assert.deepEqual(parts.filter((part) => part.attributes.get("class") === "era-clock-numeral").map((part) => part.textContent),
      Array.from({ length: 12 }, (_, index) => String(index + 1)));
    for (const hand of ["era-clock-hour", "era-clock-minute"]) {
      const part = parts.find((part) => part.attributes.get("class") === hand)!;
      assert.equal(part.tag, "path");
      assert.match(part.attributes.get("d")!, /Z$/);
    }
    assert.equal(parts.find((part) => part.attributes.get("class") === "era-clock-hour")!.attributes.get("transform"), `rotate(${hour} 36 36)`);
    assert.equal(parts.find((part) => part.attributes.get("class") === "era-clock-minute")!.attributes.get("transform"), `rotate(${minute} 36 36)`);
  }
  assert.equal(draw("367", "Waking time").attributes.get("aria-label"), "Waking time: 06:07");
  for (const value of [null, "", "NaN", "Infinity", "1.5", "12px", "9007199254740992"])
    assert.throws(() => draw(value), /Unsupported clock minutes:/);
  assert.match(source, /node\.tagName === "DIV" && node\.classList\.contains\("era-clock"\) && node\.hasAttribute\("data-minutes"\)\) element = clock\(node\)/);
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.era-main-header \.era-clock \{[^}]*position: absolute; inset: 0; width: 100%; height: 100%;/);
  assert.match(css, /\.era-main-header \{[^}]*overflow: visible;/);
  assert.match(css, /\.era-sky \{[^}]*overflow: hidden; border-radius: inherit;/);
  assert.match(css, /\.era-main-header > \.era-main-when \{ order: 0; flex: 1 1 24ch;/);
  assert.match(css, /\.era-main-header > \.era-watch-control \{[^}]*width: 420px; max-width: 100%; aspect-ratio: 825 \/ 509;/);
  assert.match(css, /\.era-watch-control > \.line \{ position: static; z-index: auto;/);
  assert.match(css, /\.era-watch-control \.era-timestop-button \{ position: relative; z-index: 2; \}/);
  assert.match(css, /\.era-watch-control \.era-clock > svg \{ z-index: 0; \}/);
  assert.match(css, /\.era-watch-control > \.line:has\(\.era-timestop-button\) \{[^}]*left: 49%; top: 40\.5%; width: 37\.5%; height: 31%;/);
  assert.match(css, /\.era-clock > svg \{[^}]*left: 13\.9383%; top: 31\.4034%; width: 31\.1414%; height: 50\.4748%;/);
  assert.match(css, /\.era-clock > svg \{[^}]*transform: matrix\(\.992769, -\.00638, -\.00638, 1\.007231, 0, 0\) rotate\(8deg\); transform-origin: center;/);
  assert.match(css, /\.era-watch-control \.line button.choice.era-timestop-button, \.era-watch-control \.era-timestop-button \{[^}]*border: 0;[^}]*background: transparent; box-shadow: none;/);
  assert.match(css, /\.era-clock-tick \{[^}]*stroke-width: \.75;/);
  assert.match(css, /\.era-clock-hour-mark \{[^}]*stroke-width: 1\.15;/);
  assert.match(css, /\.era-clock::before \{[^}]*pointer-events: none;[^}]*background: url\("\.\/clock-frame\.png"\)/);
  const frame = await readFile(new URL("../web/clock-frame.png", import.meta.url));
  assert.equal(frame.readUInt32BE(16), 825);
  assert.equal(frame.readUInt32BE(20), 509);
  assert.match(css, /\.era-main-header \.era-clock \{ --clock-face: #f4e6cc;/);
  assert.match(css, /\.era-clock-numeral \{[^}]*font-family: Georgia, "Times New Roman", serif;/);
  assert.match(css, /:has\(\.era-sky-night\) \.era-clock \{[^}]*--clock-face: #211e1b;/);
  assert.match(css, /\.era-main:has\(\.era-stopped\) \.era-clock \{[^}]*--clock-face: #e2f2fc;/);
});

test("hover artwork is an additive layer that fades above the normal frame", async () => {
  const image = await loadImage(new URL("../web/clock-frame-hover.png", import.meta.url).pathname);
  assert.equal(image.width, 825);
  assert.equal(image.height, 509);
  const canvas = createCanvas(image.width, image.height), context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  const alpha = (x: number, y: number) => pixels[(y * image.width + x) * 4 + 3]!;
  assert.equal(alpha(0, 0), 0, "outer transparency");
  assert.equal(alpha(270, 100), 0, "normal crown remains visible below the hover layer");
  assert.ok(alpha(244, 288) <= 1, "hover layer leaves the dial center effectively transparent");
  const levels = new Set<number>();
  for (let y = 250; y < 320; y++) for (let x = 450; x < 650; x++) {
    assert.ok(alpha(x, y) <= 85, `no opaque white in plaque at ${x}, ${y}`);
    levels.add(alpha(x, y));
  }
  assert.ok(levels.size > 3, "texture keeps varying opacity rather than a flat fill");
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.era-main-header > \.era-watch-control \{[^}]*margin-right: -60px; margin-top: -44px; margin-bottom: -16px;/);
  assert.match(css, /\.era-watch-control > \.line:has\(\.era-timestop-button\) \{[^}]*left: 49%; top: 40\.5%; width: 37\.5%; height: 31%;/);
  assert.match(css, /\.era-watch-control::after \{[^}]*left: 45%; top: 40\.5%; width: 41\.5%; height: 31%; z-index: 0; pointer-events: none; background:/);
  assert.match(css, /\.era-watch-control:has\(\.era-timestop-button:enabled:is\(:hover, :focus-visible\)\)::after \{ filter: brightness\(1\.35\); \}/);
  assert.match(css, /\.era-watch-control \.line button\.choice\.era-timestop-button,[^}]*font-size: 1\.15em;/);
  assert.match(css, /\.era-clock::after, \.clock-overhang::after \{[^}]*background: url\("\.\/clock-frame-hover\.png"\)[^}]*opacity: 0; transition: opacity 220ms ease-in-out;/);
  assert.match(css, /\.era-watch-control:has\(\.era-timestop-button:enabled:is\(:hover, :focus-visible\)\) \.era-clock::after \{ opacity: 1; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.era-clock::after \{ transition: none; \} \}/);
  for (const state of ["era-wake-button", "era-stopped", "era-unavailable"])
    assert.ok(css.includes(`.era-watch-control:has(.${state}`), `${state} has an enamel palette`);
});

test("clock oval fits the transparent artwork's inset within six asset pixels", async () => {
  const image = await loadImage(new URL("../web/clock-frame.png", import.meta.url).pathname);
  const canvas = createCanvas(image.width, image.height), context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  const errors: number[] = [];
  for (let tick = 0; tick < 72; tick++) {
    const angle = tick * Math.PI / 36, rotation = 20.710179 * Math.PI / 180;
    const expected = 1 / Math.hypot(Math.cos(angle - rotation) / 120.151788, Math.sin(angle - rotation) / 122.491704);
    let boundary: number | undefined;
    for (let radius = 90; radius < 145; radius += .25) {
      const x = Math.round(243.449539 + Math.cos(angle) * radius);
      const y = Math.round(288.301681 + Math.sin(angle) * radius);
      const offset = (y * image.width + x) * 4;
      const colorRange = Math.max(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!)
        - Math.min(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!);
      if (pixels[offset + 3]! > 100 && colorRange > 50) { boundary = radius; break; }
    }
    assert.notEqual(boundary, undefined, `frame boundary exists at angle ${tick * 5}`);
    errors.push(Math.abs(expected - boundary!));
  }
  assert.ok(Math.max(...errors) < 6, `maximum deviation: ${Math.max(...errors)} px`);
  assert.ok(errors.reduce((sum, value) => sum + value, 0) / errors.length < 2, "mean deviation below two asset pixels");
});

test("watch crown overlays the toolbar without escaping horizontally or lingering after scrolling", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const routine = source.slice(source.indexOf("function layoutClockOverhang("), source.indexOf("function scheduleHtmlPositions("));
  const viewport = { left: 20, right: 855, top: 40 };
  const box = { left: 450, right: 654, top: 32, width: 204, height: 153.3 };
  const header = { top: 48 };
  const overlay = { hidden: true, style: {} as Record<string, string> };
  Object.assign(overlay.style, { setProperty: (name: string, value: string) => { overlay.style[name] = value; } });
  let present = true, dialog = false;
  const clock = { getBoundingClientRect: () => box, closest: () => ({ getBoundingClientRect: () => header }), getAnimations: () => [] };
  const update = () => runInNewContext(`${routine}\nlayoutClockOverhang();`, {
    terminal: { querySelector: (selector: string) => selector.includes("era-dialog") ? dialog : present ? clock : null,
      getBoundingClientRect: () => viewport },
    clockOverhang: overlay, getComputedStyle: () => ({ filter: "frost-filter", backgroundImage: 'url("clock-frame.png")', opacity: ".5" }),
  });
  update();
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.style.top, "32px");
  assert.equal(overlay.style.clipPath, "inset(0 0px 145.3px 0px)");
  assert.equal(overlay.style.filter, "frost-filter");
  assert.equal(overlay.style.backgroundImage, 'url("clock-frame.png")');
  assert.equal(overlay.style["--clock-hover-opacity"], ".5", "overhang mirrors the partially faded layer");
  box.left = 10; box.right = 214;
  update();
  assert.equal(overlay.style.clipPath, "inset(0 0px 145.3px 10px)");
  box.left = 700; box.right = 904;
  update();
  assert.equal(overlay.style.clipPath, "inset(0 49px 145.3px 0px)");
  header.top = 39;
  update();
  assert.equal(overlay.hidden, true, "scrolling the header out cannot draw the whole watch over the toolbar");
  header.top = 48; box.top = 41;
  update();
  assert.equal(overlay.hidden, true, "no overlay without an overhang");
  box.top = 32; dialog = true;
  update();
  assert.equal(overlay.hidden, true, "game dialogs suppress the crown");
  dialog = false; present = false;
  update();
  assert.equal(overlay.hidden, true, "leaving the main/wake-up screen removes the crown");
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.clock-overhang \{ position: fixed; z-index: 6; pointer-events: none;/);
  assert.match(css, /body:has\(\.menu-panel:not\(\[hidden\]\)\) \.clock-overhang \{ visibility: hidden; \}/);
  assert.match(source, /clockOverhang\.setAttribute\("aria-hidden", "true"\)/);
});

test("area artwork fixes the header height and prevents horizontal scrolling from the overhanging watch", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.era-main-header:has\(\.era-area-art\) \{ height: calc\(var\(--area-art-height, 150px\) \+ 2px\); min-height: 0; max-height:[^}]*container-type: size; overflow: clip; overflow-clip-margin: 32px;/);
  assert.match(css, /\.era-main-header:has\(\.era-area-art\) > \.era-watch-control \{ position: absolute; top: -32px; right: -37px; margin: 0; width: 300px; container-type: inline-size;/);
  assert.match(css, /\.era-main-header:has\(\.era-area-art\) \.era-watch-control \.era-timestop-button \{ padding: 2px clamp\(2px, 2cqw, 12px\); transform: translateX\(-5px\); \}/);
  assert.match(css, /#terminal:has\(\.screen\.is-active :is\(\.era-main, \.era-shop\) \.era-main-header \.era-area-art\) \{ overflow-x: hidden; \}/);
  assert.match(css, /\.era-watch-control button\.era-timestop-button::before \{ content: ""; position: absolute; inset: -8px 0; \}/);
  assert.match(css, /\.era-main-header:has\(\.era-area-art\) > \.era-main-when \{[^}]*max-height: 100%; overflow: auto;/);
});

test("header rendering has no indoor or outdoor setting in the demo or game", async () => {
  for (const file of ["web/art-demo.html", "web/art-demo.js", "web/style.css", "hotpatch/MAIN_SCREEN.ERB", "hotpatch/SLEEP_MENU.ERB"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /era-indoor|era-underground|id="setting"|values\.get\("setting"\)|nNoWeather|HOTPATCH_SKY\(/);
  }
  const main = await readFile(new URL("../hotpatch/MAIN_SCREEN.ERB", import.meta.url), "utf8");
  const sleep = await readFile(new URL("../hotpatch/SLEEP_MENU.ERB", import.meta.url), "utf8");
  assert.match(main, /^@HOTPATCH_SKY$/m);
  assert.match(main, /^CALL HOTPATCH_SKY$/m);
  assert.match(sleep, /^CALL HOTPATCH_SKY$/m);
});

test("only the Underworld left lantern has a localized randomly timed flicker", async () => {
  const source = await readFile(new URL("../web/sky.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(source, /if \(area === "9"\) \{[\s\S]*?lantern\.className = "era-cave-lantern";/);
  assert.match(source, /--lantern-flicker-duration", `\$\{flicker\.duration\}s`/);
  assert.match(source, /--lantern-flicker-pattern", flicker\.easing/);
  assert.match(source, /--lantern-flicker-delay", `\$\{-Math\.random\(\) \* flicker\.duration\}s`/);
  assert.match(css, /\.era-cave-lantern \{[^}]*left: 132px; bottom: 55px; width: 40px; height: 42px;[^}]*pointer-events: none;[^}]*z-index: 1;[^}]*mask: url\(\/underworld-lantern-mask\.png\)/);
  assert.match(css, /var\(--lantern-flicker-pattern, steps\(1\)\) infinite;/);
  const routine = source.slice(source.indexOf("export function lanternFlicker"), source.indexOf("/** Apply panorama"));
  const generate = new Function(`${routine.replace("export ", "")}; return lanternFlicker;`)();
  const patterns = [];
  for (const value of [0, .5, .999]) {
    const pattern = generate(() => value);
    assert.ok(pattern.duration >= 175 && pattern.duration <= 515);
    const stops = [...pattern.easing.matchAll(/([\d.]+) ([\d.]+)%/g)].map(match => [Number(match[1]), Number(match[2])]);
    assert.ok(Math.abs(stops[1]![1]! / 100 * pattern.duration - (10 + value * 20)) < 1e-8, "bursts wait 10–30 seconds without slowing the flashes");
    const dips = stops.filter(([opacity]) => opacity! >= .4);
    assert.equal(dips.length, 32 * (1 + Math.floor(value * 3)), "one to three dips per burst");
    assert.ok(dips.every(([opacity]) => opacity! >= .4 && opacity! <= .6), "dips leave around half the flame brightness");
    for (let i = 1; i < stops.length; i++) assert.ok(stops[i]![1]! >= stops[i - 1]![1]!);
    assert.deepEqual(stops[0], [0, 0]);
    assert.deepEqual(stops.at(-1), [0, 100]);
    patterns.push(pattern.easing);
  }
  assert.equal(new Set(patterns).size, 3, "brightness and flash counts vary with randomness");
  assert.match(css, /@keyframes era-lantern-flicker/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.era-cave-lantern \{ animation: none; opacity: 0; \}/);
});

test("Underworld bats are confined to the cavern artwork and respect reduced motion", async () => {
  const source = await readFile(new URL("../web/sky.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(source, /if \(area === "9"\) \{[^}]*bats\.className = "era-cave-bats";[^}]*bats\.setAttribute\("aria-hidden", "true"\);[^}]*i < 4[^}]*sky\.querySelector\("\.era-sky-landmark"\)\?\.append\(bats\);/);
  assert.match(css, /\.era-cave-bats \{[^}]*pointer-events: none; overflow: hidden;/);
  assert.match(css, /animation: era-bat-flight 8s ease-in-out infinite alternate/);
  assert.match(css, /animation: era-bat-wings \.32s steps\(1\) infinite;/);
  assert.match(css, /\.era-cave-bats > span::after \{[^}]*width: 3px; height: 5px;/);
  assert.match(css, /@keyframes era-bat-wings \{\s*50% \{ clip-path: polygon/);
  assert.match(css, /0% \{ transform: translate\(-65px, -32px\); \}\s*25% \{ transform: translate\(30px, 32px\); \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.era-cave-bats \{ display: none; \}\s*\.era-cave-bats > span, \.era-cave-bats > span::before \{ animation: none; \}/);
});

test("Underworld ambience follows location and retains weaker fog and storm flashes", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.era-sky\.era-area-9 \{ background: color-mix\(in srgb, #b3c5ff var\(--cave-daylight, 100%\), #090a1d\); \}/);
  assert.doesNotMatch(css, /era-cave-depth|depth-shade/);
  assert.match(css, /\.era-sky\.era-area-9 \.era-sky-view \{ background: none; \}/);
  assert.match(css, /\.era-sky\.era-area-9 \.era-sky-view::before,\s*\.era-sky\.era-area-9 \.era-sky-view::after \{ display: none; \}/);
  assert.ok(css.includes(".era-area-9 .era-sky-view > :not(.era-sky-landmark) { display: none; }"));
  assert.match(css, /\.era-sky\.era-area-9\.era-weather-fog \.era-sky-view::after \{ display: block; opacity: \.5; \}/);
  assert.match(css, /\.era-sky\.era-area-9\.era-weather-storm \.era-sky-view::after \{\s*content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none;\s*display: block; background: none; animation: era-lightning 13s -3s linear infinite; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.era-sky\.era-area-9\.era-weather-storm \.era-sky-view::after \{ animation: none; \}/);
});

test("Moon sky uses a lunar palette for day, twilight and night", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  const day = css.match(/\.era-area-10:is\(\.era-sky-dawn, \.era-sky-morning, \.era-sky-day, \.era-sky-evening\) \.era-sky-view \{([^}]+)\}/)?.[1];
  assert.ok(day);
  for (const colour of ["#242139", "#57506e", "#b6a8c6", "#302039", "#8b5d80", "#dfaaa8"])
    assert.ok(day.includes(colour), `lunar palette includes ${colour}`);
  assert.match(day, /var\(--sky-warmth, 0%\)/);
  assert.match(css, /\.era-area-10\.era-sky-night \.era-sky-view \{\s*background: linear-gradient\(#080611, #241c3d\); \}/);
  assert.match(css, /\.era-area-10:is\(\.era-sky-dawn, \.era-sky-evening\) \.era-sky-view::before \{\s*background: linear-gradient\(#080611, #241c3d\); \}/);
});

test("Moon location replaces only the nighttime orb and its weather glow with Earth", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  const rule = css.match(/\.era-area-10\.era-sky-moon \.era-sky-orb, \.era-area-10\.era-sky-moon \.era-sky-clouds::after \{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /background-image: url\(\/earth\.png\); image-rendering: pixelated;/);
  assert.match(rule, /mask-image: linear-gradient\(rgb\(0 0 0 \/ var\(--sky-darkness, 1\)\), rgb\(0 0 0 \/ var\(--sky-darkness, 1\)\)\);/);
  const earthSize = Number(rule.match(/--earth-orb-size: ([\d.]+)px;/)?.[1]);
  const moonSize = Number(css.match(/\.era-sky-moon \.era-sky-orb, \.era-sky-moon \.era-sky-clouds::after \{ width: ([\d.]+)px;/)?.[1]);
  assert.ok(Math.abs(earthSize / moonSize - 3.7) < 1e-12);
  assert.match(rule, /width: var\(--earth-orb-size\); height: var\(--earth-orb-size\);/);
  assert.match(rule, /top: calc\(var\(--sky-orb-top, 10px\) \+ 14px - var\(--earth-orb-size\) \/ 2\);/);
  const topAt = (moonTop: number) => moonTop + moonSize / 2 - earthSize / 2;
  assert.ok(topAt(10) < 0, "Earth may rise above the header");
  assert.ok(topAt(93) + earthSize > 144, "Earth may sink below the horizon without bottom clamping");
  assert.match(rule, /right: min\(var\(--sky-orb-right\), max\(0px, calc\(100% - var\(--earth-orb-size\) - 10px\)\)\);/);
  const earth = await readFile(new URL("../web/earth.png", import.meta.url));
  assert.equal(earth.readUInt32BE(16), 104);
  assert.equal(earth.readUInt32BE(20), 104);
});

test("sky follows exact game minutes with a bounded arc and warm sunrise and sunset", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const shared = await readFile(new URL("../web/sky.js", import.meta.url), "utf8");
  const routine = shared.slice(shared.indexOf("function sky("), shared.indexOf("/** Apply panorama"));
  const draw = (value: string | null, season = 1, day = 15): Map<string, string> => {
    const properties = new Map<string, string>();
    runInNewContext(`${routine}\nsky(node, element);`, {
      node: { getAttribute: (name: string) => name === "data-season" ? String(season) : name === "data-day" ? String(day) : value },
      element: {
        style: { setProperty: (name: string, value: string) => properties.set(name, value) },
        classList: { remove: () => {}, add: (phase: string) => properties.set("phase", phase),
          toggle: (_name: string, moon: boolean) => properties.set("moon", String(moon)) },
      },
    });
    return properties;
  };
  assert.ok(Math.abs(Number(draw("720").get("--sky-orbit")) - .5) < 1e-12);
  assert.equal(draw("720").get("--sky-orb-top"), "10px");
  assert.equal(draw("720").get("--sky-warmth"), "0%");
  assert.equal(draw("720").get("--cave-daylight"), "100%");
  assert.equal(draw("0").get("--cave-daylight"), "0%");
  for (let minutes = 0; minutes < 1440; minutes++) {
    const properties = draw(String(minutes));
    const top = Number.parseFloat(properties.get("--sky-orb-top")!);
    const progress = Number(properties.get("--sky-orbit"));
    assert.ok(top >= 10 && top <= 93, `on-screen vertical position at minute ${minutes}`);
    assert.ok(progress >= 0 && progress <= 1, `bounded orbit at minute ${minutes}`);
  }
  assert.equal(draw("240").get("moon"), "true", "4am is still night in spring");
  assert.equal(draw("330", 2).get("moon"), "false", "summer sunrise before 5:30");
  assert.equal(draw("390", 4).get("moon"), "true", "winter sunrise after 6:30");
  assert.equal(draw("1110", 2).get("moon"), "false", "summer sunset after 18:30");
  assert.equal(draw("1050", 4).get("moon"), "true", "winter sunset before 17:30");
  for (const season of [1, 2, 3, 4]) {
    const sunrise = Array.from({ length: 240 }, (_, index) => 240 + index)
      .find((minute) => draw(String(minute), season).get("moon") === "false")!;
    const sunset = Array.from({ length: 240 }, (_, index) => 960 + index)
      .find((minute) => draw(String(minute), season).get("moon") === "true")!;
    assert.ok(sunrise >= 270 && sunrise <= 435, "plausible sunrise at 36 N");
    assert.ok(sunset >= 1005 && sunset <= 1170, "plausible sunset at 36 N");
    assert.equal(draw(String(sunrise - 15), season).get("phase"), "era-sky-dawn");
    assert.equal(draw(String(sunset + 15), season).get("phase"), "era-sky-evening");
    assert.equal(draw(String(sunset + 31), season).get("phase"), "era-sky-night");
    for (const boundary of [sunrise, sunset]) {
      const light = Number.parseFloat(draw(String(boundary), season).get("--cave-daylight")!);
      assert.ok(light < .1, "cave depth is dark by sunrise/sunset");
    }
    assert.ok(Number.parseFloat(draw("1020", season).get("--cave-daylight")!) < Number.parseFloat(draw("900", season).get("--cave-daylight")!), "tunnel visibility decreases through the afternoon");
    const dawnVisibility = [31, 15, 1].map((before) => Number(draw(String(sunrise - before), season).get("--sky-darkness")));
    assert.equal(dawnVisibility[0], 1, "Earth is fully visible before dawn");
    assert.ok(dawnVisibility[1]! > .45 && dawnVisibility[1]! < .55, "Earth is half faded midway through dawn");
    assert.ok(dawnVisibility[2]! < 1 / 30, "Earth is almost invisible before the sunrise orb switch");
    assert.equal(draw(String(sunrise), season).get("--sky-darkness"), "0", "Earth reaches zero visibility at sunrise");
    const duskVisibility = [0, 15, 31].map((after) => Number(draw(String(sunset + after), season).get("--sky-darkness")));
    assert.ok(duskVisibility[0]! < 1 / 30, "Earth starts invisible at sunset");
    assert.ok(duskVisibility[1]! > .45 && duskVisibility[1]! < .55, "Earth fades in through dusk");
    assert.equal(duskVisibility[2], 1);
  }
  assert.notEqual(draw("360", 1, 1).get("--sky-orb-top"), draw("360", 1, 31).get("--sky-orb-top"), "day within season changes the arc");
  assert.ok(Number.parseFloat(draw("1080").get("--sky-warmth")!) > 0, "warm evening");
  assert.notEqual(draw("361").get("--sky-orb-top"), draw("360").get("--sky-orb-top"), "minute precision");
  assert.deepEqual(draw("1800"), draw("360"), "wrap days");
  assert.deepEqual(draw("-1"), draw("1439"), "wrap negative time");
  for (const value of [null, "", "NaN", "Infinity", "1.5", "12px", "9007199254740992"])
    assert.throws(() => draw(value), /Unsupported sky minutes:/);
  for (const [season, day] of [[0, 1], [5, 1], [1, 0], [1, 32], [1.5, 1]])
    assert.throws(() => draw("720", season, day), /Unsupported sky date:/);
  assert.match(source, /element\.classList\.contains\("era-sky"\) && node\.hasAttribute\("data-minutes"\)\) sky\(node, element\)/);
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /--sky-orb-right: clamp\(10px, max\(450px,[^;]*max\(10px, calc\(100% - 40px\)\)\)/);
  assert.match(css, /\.era-sky-orb, \.era-sky-clouds::after \{ position: absolute; top: min\(var\(--sky-orb-top, 10px\), max\(0px, calc\(100% - 30px\)\)\); right: var\(--sky-orb-right\);/);
  assert.match(css, /linear-gradient\(color-mix\(in srgb, #2f78c4, #493b76 var\(--sky-warmth, 0%\)\)/);
  assert.match(css, /\.era-sky-moon \.era-sky-orb, \.era-sky-moon \.era-sky-clouds::after \{[^}]*background: url\(\/moon\.svg\)[^}]*box-shadow: none;[^}]*filter: drop-shadow/);
  assert.match(css, /\.era-sky-view::before \{[^}]*opacity: var\(--sky-darkness, 0\);[^}]*background-size: 389px 173px,[^}]*251px 137px,[^}]*173px 97px/);
  assert.match(css, /\.era-area-9 \.era-sky-view > :not\(\.era-sky-landmark\) \{ display: none; \}/);
});

test("area artwork blends bad-weather days and selects undimmed seasonal night panoramas", async () => {
  const source = await readFile(new URL("../web/sky.js", import.meta.url), "utf8");
  const routine = source.slice(source.indexOf("function prepareSkyArt("));
  for (const season of ["spring", "summer", "autumn", "winter"])
    for (const palette of ["seasonal", "neutral", "both"])
    for (const phase of ["night", "dawn", "day", "evening"])
      for (const weather of ["clear", "fair", "cloudy", "rain", "storm", "fog", "snow", "blizzard"])
        for (const availability of ["complete", "missing", "partial"])
          for (const artwork of ["auto", "day", "night"]) {
              const classes = new Set(["era-sky", "era-area-0", `era-season-${season}`, `era-sky-${phase}`, `era-weather-${weather}`]);
              const properties = new Map<string, string>();
              const element = {
                dataset: { areaArt: "" },
                classList: {
                  [Symbol.iterator]: () => classes[Symbol.iterator](),
                  add: (value: string) => classes.add(value),
                  toggle: (value: string, enabled: boolean) => enabled ? classes.add(value) : classes.delete(value),
                },
                matches: (selector: string) => selector.split(", ").some((name) => classes.has(name.slice(1))),
                closest: () => null,
                style: { setProperty: (name: string, value: string) => properties.set(name, value) },
              };
              const artSeason = palette === "neutral" ? "neutral" : season;
              const set = (time: string) => Object.fromEntries(["left", "middle", "right"]
                .map((part) => [part, `/areas/0-shrine/${artSeason}-${time}-${part}.png`]));
              const nightSet = availability === "complete" ? set("night") : availability === "partial" ? { middle: set("night").middle } : undefined;
              await runInNewContext(`${routine}\nprepareSkyArt(outputRoot, manifest, sourceImage, pendingImages, artwork);`, {
                artwork,
                outputRoot: { querySelectorAll: () => [element] },
                manifest: { 0: {
                  ...(palette === "both" ? { "neutral-day": { middle: "/unused-day.png" }, "neutral-night": { middle: "/unused-night.png" } } : {}),
                  [`${artSeason}-day`]: set("day"), [`${artSeason}-night`]: nightSet,
                } },
                sourceImage: async () => ({ naturalHeight: 144, naturalWidth: 520 }),
                pendingImages: [],
              });
              const wantsNight = artwork === "auto" ? phase === "night" || phase === "dawn" : artwork === "night";
              const night = wantsNight && availability !== "missing";
              const time = night ? "night" : "day";
              assert.equal(element.dataset.areaArt, `${artSeason}-${time}`);
              assert.equal(classes.has("era-area-art-night"), night);
              const blend = !wantsNight && !["clear", "fair"].includes(weather) && availability === "complete";
              assert.equal(classes.has("era-area-art-weather"), blend);
              for (const part of ["left", "middle", "right"]) {
                assert.equal(properties.get(`--area-${part}`), night && availability === "partial" && part !== "middle"
                  ? undefined : `url("/areas/0-shrine/${artSeason}-${time}-${part}.png")`);
                assert.equal(properties.get(`--area-weather-${part}`), blend ? `url("/areas/0-shrine/${artSeason}-night-${part}.png")` : undefined);
                if (part !== "middle") assert.equal(properties.get(`--area-${part}-width`),
                  night && availability === "partial" ? undefined : "520px");
              }
  }
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.era-sky\.era-area-art-night \.era-sky-landmark \{ --landmark-tint: ; \}/);
  assert.match(css, /\.era-area-art-weather \.era-sky-landmark::after \{[^}]*opacity: var\(--area-weather-blend, 0\);[^}]*--area-weather-middle/);
  for (const [weather, opacity] of [["cloudy", ".18"], ["rain", ".32"], ["storm", ".48"], ["fog", ".18"], ["snow", ".20"], ["blizzard", ".35"]])
    assert.ok(css.includes(`.era-weather-${weather} { --area-weather-blend: ${opacity}; }`));
});

test("panorama overlap clips only the middle and applies consistently to artwork overlays", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /--area-art-overlap: 96px/);
  assert.match(css, /padding-left: min\(50%, max\(0px, calc\(var\(--area-left-width, 0px\) - var\(--area-art-overlap\)\)\)\)/);
  assert.match(css, /padding-right: min\(50%, max\(0px, calc\(var\(--area-right-width, 0px\) - var\(--area-art-overlap\)\)\)\)/);
  assert.match(css, /background-origin: border-box, border-box, content-box;\s*background-clip: border-box, border-box, content-box/);
  const demo = await readFile(new URL("../web/art-demo.html", import.meta.url), "utf8");
  assert.match(demo, /id="overlap" type="range" min="0" max="600" step="4" value="220"/);
  for (const [area, value] of [220, 88, 116, 320, 264, 168, 96, 360, 176].entries())
    assert.ok(css.includes(`.era-area-art.era-area-${area} { --area-art-overlap: ${value}px; }`));
  const source = await readFile(new URL("../web/art-demo.js", import.meta.url), "utf8");
  assert.match(source, /overlaps\.set\(overlapKey\(\), Number\(overlap\.value\)\)/);
  assert.match(source, /getComputedStyle\(scene\)\.getPropertyValue\("--area-art-overlap"\)/);
  assert.match(source, /preview\.querySelector\("\.era-sky"\)\?\.style\.setProperty\("--area-art-overlap"/);
});

test("foothill water highlights move independently and respect night and reduced motion", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.era-area-7\.era-area-art \.era-sky-land/);
  assert.match(css, /background: var\(--area-water-left\)[^;]*var\(--area-water-right\)[^;]*var\(--area-water-middle\)/);
  const skySource = await readFile(new URL("../web/sky.js", import.meta.url), "utf8");
  assert.match(skySource, /sets\["spring-day"\]\[part\]/);
  assert.match(css, /filter: url\(#era-water-highlight\); clip-path: inset\(70px 0 0\)/);
  assert.match(css, /mask-size: 24px 24px; animation: era-water-flow .65s linear infinite/);
  assert.match(css, /@keyframes era-water-flow \{ to \{ mask-position: -24px 24px; \} \}/);
  assert.match(css, /\.era-area-7\.era-area-art-night \.era-sky-land::before \{ opacity: .28; \}/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.era-area-7[^}]*animation: none; opacity: 0/);
  for (const file of ["index.html", "art-demo.html"]) {
    const html = await readFile(new URL(`../web/${file}`, import.meta.url), "utf8");
    assert.match(html, /id="era-water-highlight" color-interpolation-filters="sRGB"/);
    assert.match(html, /-8 0 8 .8 0/);
    assert.match(html, /0 2 2 0 -2/);
    assert.match(html, /<feComposite in2="SourceAlpha" operator="in"\/>/);
  }
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const alpha = (r: number, g: number, b: number) => clamp(-8 * r + 8 * b + .8) * clamp(2 * g + 2 * b - 2);
  assert.ok(alpha(.9, .95, 1) > .75, "white foam is retained, not cancelled by the colour filter");
  assert.ok(alpha(.4, .75, .9) > .75, "cyan water stays visible");
  assert.equal(alpha(.2, .4, .15), 0, "green plants stay still");
  assert.equal(alpha(.25, .3, .5), 0, "dark mountain scenery stays still");
});

test("foothill water overlays keep the original water mask in every season without animating frost", async () => {
  const source = await readFile(new URL("../web/sky.js", import.meta.url), "utf8");
  const routine = source.slice(source.indexOf("function prepareSkyArt("));
  for (const season of ["spring", "summer", "autumn", "winter"]) for (const phase of ["day", "night"]) {
    const classes = new Set(["era-sky", "era-area-7", `era-season-${season}`, `era-sky-${phase}`]);
    const properties = new Map<string, string>();
    const element = {
      dataset: { areaArt: "" },
      classList: {
        [Symbol.iterator]: () => classes[Symbol.iterator](),
        add: (value: string) => classes.add(value),
        toggle: (value: string, enabled: boolean) => enabled ? classes.add(value) : classes.delete(value),
      },
      matches: (selector: string) => selector.split(", ").some(name => classes.has(name.slice(1))),
      closest: () => null,
      style: { setProperty: (name: string, value: string) => properties.set(name, value) },
    };
    const set = (time: string) => Object.fromEntries(["left", "middle", "right"]
      .map(part => [part, `/areas/7-foothills/${season}-${time}-${part}.png`]));
    await runInNewContext(`${routine}\nprepareSkyArt(outputRoot, manifest, sourceImage, pendingImages);`, {
      outputRoot: { querySelectorAll: () => [element] },
      manifest: { 7: {
        "spring-day": Object.fromEntries(["left", "middle", "right"].map(part => [part, `/areas/7-foothills/spring-day-${part}.png`])),
        [`${season}-day`]: set("day"), [`${season}-night`]: set("night"),
      } },
      sourceImage: async () => ({ naturalHeight: 144, naturalWidth: 559 }),
      pendingImages: [],
    });
    assert.equal(element.dataset.areaArt, `${season}-${phase}`);
    for (const part of ["left", "middle", "right"]) {
      assert.equal(properties.get(`--area-water-${part}`), `url("/areas/7-foothills/spring-day-${part}.png")`);
      assert.equal(properties.get(`--area-${part}`), `url("${set(phase)[part]}")`);
    }
  }
});

test("fog overlays the full top image with half strength in the Underworld", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.era-weather-fog \.era-sky-view::after \{ content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none;[^}]*background:/);
  assert.match(css, /\.era-sky\.era-area-9\.era-weather-fog \.era-sky-view::after \{ display: block; opacity: \.5; \}/);
});

test("night cloud, fog and snow palettes are muted and a blurred orb glows above clouds", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.era-sky-moon\.era-weather-cloudy \.era-sky-clouds \{[^}]*#202b3d99/);
  assert.match(css, /\.era-sky-moon:is\(\.era-weather-snow, \.era-weather-blizzard\) \.era-sky-clouds \{ background: linear-gradient\(#28364aaa, #43536a88\); \}/);
  assert.match(css, /:is\(\.era-weather-snow, \.era-weather-blizzard\) \.era-sky-clouds \{ background: linear-gradient\(#9aa6b2aa, #c8d2dc88\); \}/);
  assert.match(css, /\.era-sky-moon\.era-weather-fog \.era-sky-clouds \{[^}]*#2c394b88/);
  assert.match(css, /\.era-sky-moon\.era-weather-fog \.era-sky-view::after \{[^}]*#35445a44/);
  assert.match(css, /:is\(\.era-weather-cloudy, \.era-weather-rain, \.era-weather-storm, \.era-weather-fog, \.era-weather-snow, \.era-weather-blizzard\) \.era-sky-clouds::after \{[^}]*content: ""; z-index: 0; pointer-events: none; opacity: \.4; filter: blur\(2px\);/);
  assert.match(css, /:is\(\.era-weather-rain, \.era-weather-fog\) \.era-sky-clouds::after \{ filter: blur\(3px\);/);
  assert.match(css, /:is\(\.era-weather-storm, \.era-weather-blizzard\) \.era-sky-clouds::after \{ opacity: \.22; filter: blur\(4px\);/);
  assert.match(css, /\.era-weather-cloudy \.era-sky-clouds \{[^}]*var\(--cloud-light\)[^}]*var\(--cloud-shade\)[^}]*var\(--cloud-sky\)/);
});

test("night panorama lights get a warm halo without blurring the scenery", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.era-area-art-night \.era-sky-landmark::before \{[^}]*pointer-events: none; opacity: \.7;[^}]*--area-left[^}]*--area-right[^}]*--area-middle/);
  assert.match(css, /filter: url\(#era-light-glow\); mix-blend-mode: screen;/);
  for (const base of [0, .25, .65, .9, 1]) {
    for (const glow of [1, .65, .25]) for (const alpha of [0, .1, .7, 1]) {
      const screened = base + alpha * glow * (1 - base);
      assert.ok(screened >= base, "the glow cannot darken any lamp channel");
    }
  }
  for (const file of ["index.html", "art-demo.html"]) {
    const html = await readFile(new URL(`../web/${file}`, import.meta.url), "utf8");
    assert.match(html, /<filter id="era-light-glow"[^>]*color-interpolation-filters="sRGB"/);
    assert.match(html, /feColorMatrix values="0 0 0 0 1 0 0 0 0 \.65 0 0 0 0 \.25 3 3 -4 0 -2"/);
    assert.match(html, /feGaussianBlur stdDeviation="2"/);
  }
});

test("title screen menu is visible and contains the artwork demo link", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/library.css", import.meta.url), "utf8"),
    readFile(new URL("../web/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<nav id="menu-panel"[^>]*>[\s\S]*<a href="\/art-demo" target="_blank" rel="noopener">Artwork demo<\/a>[\s\S]*<\/nav>/);
  assert.doesNotMatch(html, /<div class="library-toolbar">[\s\S]*Artwork demo/);
  assert.match(css, /\.is-home #mode, \.is-home #activity, \.is-home > main \{ display: none; \}/);
  assert.match(app, /menuPanel\.addEventListener\("click", \(event\) => \{ if \(event\.target\.closest\("button, a\[href\]"\)\) setMenu\(false\); \}\)/);
  assert.match(app, /menuPanel\.querySelectorAll\("button, a\[href\], input"\)/);
});

test("rain and blizzards use layered precipitation with seamless motion and reduced-motion support", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  for (const weather of ["rain", "blizzard"]) {
    assert.ok(css.includes(`.era-weather-${weather} .era-sky-fall::before`));
    assert.ok(css.includes(`.era-weather-${weather} .era-sky-fall::after`));
  }
  assert.ok(css.includes("--fall-speed: .8s; --fall-travel: 0px 83px;"));
  assert.match(css, /background-size: 43px 31px; --fall-speed: \.24s; --fall-travel: -129px 31px/);
  assert.match(css, /background-size: 67px 47px; --fall-speed: \.2s; --fall-travel: -201px 47px/);
  assert.doesNotMatch(css, /era-snow-gust|era-snow-descent/);
  assert.match(css, /\.era-weather-blizzard \.era-sky-fall \{ z-index: 1;[^}]*linear-gradient\(#bccedd90, #d6e3eda6\)/);
  assert.match(css, /\.era-sky-moon\.era-weather-blizzard \.era-sky-fall \{[^}]*linear-gradient\(#42556b90, #63798fa6\)/);
  assert.match(css, /@keyframes era-precipitation \{ to \{ background-position: var\(--fall-travel\); \} \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.era-sky-fall, \.era-sky-fall::before, \.era-sky-fall::after \{ animation: none !important; \} \}/);
});

test("storms use denser layered rain, staggered wind gusts and gentle lightning", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.era-weather-storm \.era-sky-fall::before \{[^}]*background-size: 71px 61px;[^}]*--fall-speed: \.45s;[^}]*era-rain-gust 17s/);
  assert.match(css, /\.era-weather-storm \.era-sky-fall::after \{[^}]*background-size: 107px 89px;[^}]*--fall-speed: \.32s;[^}]*era-rain-gust 23s -7s/);
  assert.match(css, /39% \{ transform: skewX\(9deg\); \}/);
  assert.match(css, /17% \{ transform: skewX\(-27deg\); \}/);
  assert.match(css, /\.era-weather-storm \.era-sky-fall \{[^}]*animation: era-lightning 13s linear infinite/);
  assert.match(css, /74%, 76% \{ background-color: #b9d4f538; \}/);
  assert.match(css, /\.era-weather-storm \.era-sky-clouds::before \{[^}]*opacity: 0;[^}]*clip-path: polygon\([^}]*animation: era-lightning-bolt 13s/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.era-weather-storm \.era-sky-clouds::before \{ animation: none; \} \}/);
});

test("blizzard veil stays static and lightning uses a thin forked silhouette", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /snow-curtain/);
  assert.match(css, /48% 58%, 32% 60%, 59% 32%, 81% 63%, 63% 31%, 44% 30%, 62% 0/);
});

test("terminal hides only the horizontal scrollbar without disabling overflow or logical width", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /#terminal::-webkit-scrollbar \{ height: 0; \}/);
  assert.match(css, /#terminal \{[^}]*overflow: auto;/);
  assert.match(css, /#terminal > \* \{[^}]*min-width: var\(--logical-width, 0\);/);
});

test("settings panel uses a responsive two-column form without clipping its controls", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /#settings \{[^}]*max-height: min\(60vh, 480px\);[^}]*overflow: auto;/);
  assert.match(css, /#settings-form \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 600px\).*#settings-form \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /#settings-form input\[type="text"\] \{[^}]*width: 100%;[^}]*min-width: 0;/);
});

test("main and wakeup screens fill the terminal height including its top padding", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /#terminal:has\(\.screen\.is-active \.era-main\), #terminal:has\(\.screen\.is-active \.era-shop\) \{ container-type: size; \}/);
  assert.match(css, /#terminal:has\(\.screen\.is-active :is\(\.era-main, \.era-shop\)\) > \.screen\.is-active \{ min-width: 0; \}/);
  assert.match(css, /\.screen\.is-active :is\(\.era-main, \.era-shop\) \{ min-height: calc\(100cqh \+ 4px\); \}/);
  assert.match(css, /\.era-main \{[^}]*margin: 4px 0;/);
  assert.match(css, /\.era-shop \{[^}]*margin: 4px 0;/);
});

test("LLM configuration keeps provider controls in a responsive scrollable dialog with clear setup status", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/style.css", import.meta.url), "utf8"),
  ]);
  const elements = (node: DefaultTreeAdapterMap["node"]): DefaultTreeAdapterMap["element"][] => {
    const children = "childNodes" in node ? node.childNodes.flatMap(elements) : [];
    return "tagName" in node ? [node, ...children] : children;
  };
  const attr = (node: DefaultTreeAdapterMap["element"], name: string) => node.attrs.find((attribute) => attribute.name === name)?.value;
  const dialog = elements(parseFragment(html)).find((node) => attr(node, "id") === "llm-config")!;
  const nodes = elements(dialog);
  const byId = (id: string) => nodes.find((node) => attr(node, "id") === id)!;
  const hasClass = (node: DefaultTreeAdapterMap["element"], name: string) => attr(node, "class")?.split(" ").includes(name);
  assert.equal(dialog.tagName, "dialog");
  assert.equal(attr(dialog, "aria-labelledby"), "llm-config-title");
  assert.equal(attr(dialog, "aria-describedby"), "llm-config-description");
  assert.ok(byId("llm-config-title"));
  assert.ok(byId("llm-config-description"));
  const form = nodes.find((node) => node.tagName === "form")!;
  assert.equal(attr(form, "method"), "dialog");
  const controls = nodes.filter((node) => ["input", "select", "textarea"].includes(node.tagName));
  assert.deepEqual(controls.map((node) => attr(node, "name")), [
    "provider", "endpoint", "apiKey", "model", "jsonMode", "tools",
    "temperature", "historyChars", "instructions", "encounters", "memories", "gossip",
  ]);
  assert.deepEqual(elements(byId("llm-provider")).filter((node) => node.tagName === "option").map((node) => attr(node, "value")), ["openai", "openrouter", "local"]);
  for (const id of ["llm-endpoint", "llm-model"]) assert.equal(attr(byId(id), "required"), "");
  assert.equal(attr(byId("llm-endpoint"), "type"), "url");
  assert.equal(attr(byId("llm-key"), "type"), "password");
  assert.equal(attr(byId("llm-key"), "autocomplete"), "off");
  assert.equal(attr(byId("llm-key"), "required"), undefined, "local providers still allow an optional key");
  assert.equal(attr(byId("llm-model"), "list"), "llm-models");
  assert.equal(byId("llm-models").tagName, "datalist");
  for (const id of ["llm-provider", "llm-endpoint", "llm-key", "llm-model", "llm-temperature", "llm-history-chars", "llm-instructions"]) {
    assert.ok(nodes.some((node) => node.tagName === "label" && attr(node, "for") === id));
  }
  const buttons = nodes.filter((node) => node.tagName === "button");
  assert.equal(attr(buttons.find((node) => hasClass(node, "llm-reset-endpoint"))!, "type"), "button");
  assert.equal(attr(buttons.find((node) => hasClass(node, "llm-load-models"))!, "type"), "button");
  assert.equal(attr(buttons.find((node) => attr(node, "value") === "cancel")!, "formnovalidate"), "");
  assert.ok(buttons.some((node) => attr(node, "value") === "save"));
  assert.equal(nodes.filter((node) => node.tagName === "fieldset").length, 3);
  const status = nodes.find((node) => hasClass(node, "llm-config-status"))!;
  assert.equal(attr(status, "role"), "status");
  assert.equal(attr(status, "aria-atomic"), "true");
  assert.equal(attr(byId("llm-config-hint"), "aria-live"), "polite");
  assert.equal(attr(byId("llm-endpoint"), "aria-describedby"), "llm-config-hint");
  assert.match(html, /including the API key, are stored unencrypted in this browser only/);
  assert.match(html, /Loading models does not verify chat or tool support/);
  assert.match(css, /\.llm-config \{[^}]*max-height: calc\(100dvh - 32px\);[^}]*overflow: auto;/);
  assert.match(css, /\.llm-config > form \{[^}]*max-height: inherit;/);
  assert.match(css, /\.llm-config-body \{[^}]*min-height: 0;[^}]*overflow: auto;/);
  assert.match(css, /\.llm-config-actions \{[^}]*flex-shrink: 0;/);
  assert.match(css, /\.llm-config-fields \{[^}]*grid-template-columns: minmax\(0, 130px\) minmax\(0, 1fr\);/);
  assert.match(css, /@media \(max-width: 600px\) \{[^]*?\.llm-config-fields \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.llm-config-row \{[^}]*flex-wrap: wrap;[^}]*min-width: 0;/);
  assert.match(css, /\.llm-config-fields input[^}]*min-width: 0;/);
  assert.match(css, /\.llm-config :is\(input, select, textarea, button\):focus-visible \{ outline: 2px solid #69c9b5;/);
});

test("action headers reserve filter-row height without preventing wrapping", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.era-actions-header \{[^}]*flex-wrap: wrap;/);
  assert.match(css, /\.era-actions-header \{[^}]*align-items: center;/);
  assert.match(css, /\.era-actions-header \{[^}]*min-height: max\(22px, calc\(1lh \+ 6px\)\);/);
});

test("last command is a placeholder, never input data, and defaults and waits take precedence", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const updateControls = source.slice(source.indexOf("function updateControls("), source.indexOf("function screen("));
  const field = { value: "", placeholder: "", disabled: false, title: "" };
  const element = { classList: { toggle() {} }, setAttribute() {} };
  let chatHost: object | null = null;
  const routing = source.slice(source.indexOf("function mainChatInput("), source.indexOf("async function submit("));
  const context = {
    terminal: { ...element, querySelectorAll: () => [], querySelector: () => chatHost },
    command: field, send: { ...element, disabled: false, textContent: "" },
    document: { querySelector: () => ({ hidden: false }) },
    startButtons: [], restartButton: element,
    busy: false, expiring: false,
    input: { kind: "integer", defaultValue: undefined as string | undefined },
    lastCommand: "Last Command: Time Stop",
  };
  const update = () => runInNewContext(`${routing}\n${updateControls}\nupdateControls();`, context);
  update();
  assert.equal(field.placeholder, "Last Command: Time Stop");
  assert.equal(field.value, "", "the hint cannot be accidentally submitted");
  field.value = "312";
  update();
  assert.equal(field.value, "312", "typing survives UI refreshes; the browser hides its placeholder");
  context.input.defaultValue = "7";
  update();
  assert.equal(field.placeholder, 'Enter for "7"');
  context.input.kind = "wait";
  update();
  assert.equal(field.placeholder, "");
  context.input.kind = "integer";
  context.input.defaultValue = undefined;
  context.lastCommand = "";
  update();
  assert.equal(field.placeholder, "", "new screens clear old hints");
  chatHost = {};
  update();
  assert.equal(field.placeholder, "Command number, or say something…");
  assert.match(field.title, /command number.*text to speak/);
  context.input.kind = "string";
  update();
  assert.equal(field.title, "Enter text", "game text prompts keep their original meaning");
  assert.match(source, /lastCommand = snapshot\.lastCommand \?\? "";/);
  const patch = await readFile(new URL("../hotpatch/MAIN_SCREEN_COMMANDS.ERB", import.meta.url), "utf8");
  assert.doesNotMatch(patch, /PRINTFORML <Last (?:Training )?Command:/);
});

test("header identifies the running game and preserves demo and debug labels", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const showReport = source.slice(source.indexOf("function showReport("), source.indexOf("function terminalColumns("));
  const gameTitle = source.slice(source.indexOf("const gameTitle ="), source.indexOf("let session ="));
  const elements = new Map<string, { hidden: boolean; textContent: string; setAttribute(): void }>();
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, { hidden: false, textContent: "", setAttribute() {} });
    return elements.get(selector)!;
  };
  const context = {
    games: [{ id: "tw", title: "eraToho The World" }, { id: "k", title: "eraTohoK" }],
    runMode: "game", runGame: "tw", runDebug: false,
    document: { querySelector: element },
    report: element("#compatibility"), debugButton: element("#debug-toggle"),
    debugPanel: element("#debug-output"), demoButton: element("#demo"),
    startButtons: [], restartButton: element("#restart"),
  };
  const render = () => runInNewContext(`${gameTitle}\n${showReport}\nshowReport(false);`, { ...context });
  render();
  assert.equal(element("#mode").textContent, "eraToho The World");
  context.runGame = "k";
  context.runDebug = true;
  render();
  assert.equal(element("#mode").textContent, "eraTohoK · Debug");
  context.runMode = "demo";
  render();
  assert.equal(element("#mode").textContent, "Demo · Debug");
  context.runDebug = false;
  render();
  assert.equal(element("#mode").textContent, "Demo");
});

test("active title fills the terminal below the visible interpreter header", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /body:has\(\.screen\.is-active \.era-launch\) > header/);
  assert.match(css, /#terminal:has\(\.screen\.is-active \.era-launch\) \{[^}]*container-type: size;/);
  assert.match(css, /\.screen\.is-active \.era-launch \{[^}]*100cqw[^}]*100cqh[^}]*height: 100%;/);
  assert.match(css, /body:has\(\.screen\.is-active \.era-launch\) #input-form \{ display: none; \}/);
});

test("room overlays reserve no layout height and chat follows every responsive main layout", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(css, /\.era-room-stage \.era-scene \{[^}]*position: absolute;[^}]*top: 2em;[^}]*pointer-events: none;/);
  assert.match(css, /\.era-room-stage \.era-occupant > \.line:has\(\.era-occupant-label\)[^{]*\{[^}]*position: absolute;[^}]*bottom: 4px;/);
  assert.match(css, /\.era-room-stage \.line button\.choice\.era-occupant-label \{[^}]*border: 0;[^}]*background: transparent;/);
  assert.ok(css.includes('"center sidebar" "actions sidebar" "counters sidebar"'));
  assert.ok(css.includes('"center" "actions" "sidebar"'));
  assert.match(css, /\.era-main-chat \{ grid-column: 1 \/ -1;/);
  assert.doesNotMatch(css, /"chat sidebar"|"chat"/);
  assert.match(css, /\.era-room-stage \.era-occupant-list \{[^}]*flex: none;[^}]*height: 216px;/);
  assert.match(css, /\.era-room-stage \.era-occupant-caged > \.era-occupant-text \{ position: static; \}/);
  assert.doesNotMatch(css, /\.era-room-stage \{[^}]*min-height:/);
  assert.doesNotMatch(css, /era-history-preview|era-info-with-preview/);
  assert.match(css, /\.era-room-stage > \.era-occupants \{[^}]*margin-top: auto;/);
  assert.match(css, /\.era-info-face \{[^}]*width: 76px; height: 76px; overflow: visible;/);
  assert.match(css, /\.era-info-body \{[^}]*padding: 12px 4px 4px; border: 0;/);
  assert.match(css, /\.era-main-header:has\(\.era-area-art\) \.era-watch-control \.era-timestop-button \{[^}]*transform: translateX\(-5px\);/);
  assert.match(css, /\.era-main:not\(:has\(\.era-counters\)\) \{\s*grid-template-rows: auto auto 1fr auto;\s*grid-template-areas: "header header" "center sidebar" "actions sidebar" "last last";/);
  assert.match(css, /\.era-info-face \.sprite-clip \{[^}]*scale\(1\.1\);[^}]*transform-origin: center bottom;/);
  assert.match(css, /\.era-info-body \.era-look \{ margin-top: auto; font: inherit;/);
  assert.match(css, /\.era-main-chat \{[^}]*align-self: stretch;[^}]*min-height: calc\(5 \* 14px \* 1\.25 \+ 26px\);/);
  assert.match(css, /\.era-main-chat \{ --era-history-size: 14px; \}/);
  assert.match(css, /\.era-history-body \{[^}]*padding: 0;/);
  assert.match(css, /\.era-history-more-overlay \{ position: sticky; top: 0; height: 0;/);
  assert.match(css, /\.era-history-more \{ position: absolute; top: 0; right: 0;/);
  assert.match(css, /\.era-main-chat > \.era-history-pane \{[^}]*contain: size; overflow: auto;/);
  assert.match(css, /\.era-main-actions \{ display: flex; flex-wrap: wrap;/);
  assert.match(css, /\.era-main-actions > \.era-actions-group \{ flex: 0 1 auto;/);
  assert.match(css, /\.era-main > \.era-main-actions \{ align-self: stretch; \}/);
  assert.match(css, /\.era-main:has\(\.era-main-chat\) \{ grid-template-rows: auto 1fr auto auto auto; \}/);
  assert.match(css, /\.era-main:has\(\.era-main-chat\):not\(:has\(\.era-counters\)\) \{ grid-template-rows: auto 1fr auto auto; \}/);
  assert.match(css, /\.era-character:has\(\.era-main-chat\) \{ grid-template-rows: auto 1fr; \}/);
  assert.match(css, /\.era-player-management \.era-actions-group span:has\(> \.era-guard-control\) \{ display: contents; \}/);
  assert.match(css, /\.era-player-management \.era-actions-group :is\(\.print-cell, \.era-guard-control\) \{ display: block; flex: 1 1 100%; \}/);
  assert.match(css, /button\.choice:is\(\.era-see-more, \.era-info-more\) \{[^}]*border: 0; border-radius: 0;/);
  assert.match(css, /\.era-main-sidebar > \.era-main-right \{ flex: 1; \}/);
  assert.match(css, /\.era-main-sidebar > \.era-main-left \{ flex: none; \}/);
  assert.match(css, /\.era-main-left > \.era-stats \{ flex: none; \}/);
  assert.match(css, /\.era-player-actions \{[^}]*margin-top: auto;/);
  assert.match(css, /\.era-main \.era-player :is\(\.print-cell, \.era-guard-control\),\s*\.era-main \.era-player \.line button\.choice:is\(\.era-player-control, \.era-chip-button, \.era-toggle\) \{[^}]*padding: 6px 10px;[^}]*border-radius: 4px;/);
  const patch = await readFile(new URL("../hotpatch/MAIN_SCREEN.ERB", import.meta.url), "utf8");
  assert.doesNotMatch(patch, /era-interaction-history/);
  assert.doesNotMatch(patch, /era-info-tabs|era-info-title/);
  const app = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  assert.match(app, /for \(const selector of \["\.era-main-left", "\.era-main-right"\]\)/,
    "character Stats precedes Player in sidebar reading and display order");
});

test("shared main-screen input routes text to chat without changing other game prompts", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("function mainChatInput(");
  const end = source.indexOf("async function submit(", start);
  const route = runInNewContext(`${source.slice(start, end)}\nroutesToCharacter`);
  const mainRequest = { kind: "integer" };
  for (const value of ["Hello", "*waves*", "300 hello", "1.5"]) {
    assert.equal(route(value, null, mainRequest, {}), true, value);
  }
  for (const value of ["300", " 300 ", "-9300", "+300", "0", "", "  "]) {
    assert.equal(route(value, null, mainRequest, {}), false, value);
  }
  for (const request of [{ kind: "string" }, { kind: "wait" }, { kind: "mousekey" },
    { kind: "integer", singleCharacter: true }, { kind: "integer", blocking: true }, null]) {
    assert.equal(route("Hello", null, request, {}), false);
  }
  assert.equal(route("Hello", {}, mainRequest, {}), false, "clicking a choice always remains game input");
  assert.equal(route("Hello", null, mainRequest, null), false, "no selected character means no chat routing");
});

test("character history renders literal text and local controls without game input handlers", async () => {
  const source = await readFile(new URL("../web/interaction-history.js", import.meta.url), "utf8");
  class Element {
    children: Element[] = [];
    textContent = "";
    className = "";
    hidden = false;
    disabled = false;
    parentElement: Element | null = null;
    isConnected = true;
    focused = false;
    scrollTop = 0;
    scrollHeight = 500;
    style: { color?: string } = {};
    attributes = new Map<string, string>();
    open = false;
    listeners = new Map<string, (event: { stopPropagation(): void; preventDefault(): void }) => unknown>();
    constructor(public tag: string) {}
    append(...elements: Element[]) { for (const element of elements) { this.children.push(element); element.parentElement = this; } }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    replaceChildren() { this.children = []; }
    addEventListener(type: string, handler: (event: { stopPropagation(): void; preventDefault(): void }) => unknown) {
      const previous = this.listeners.get(type);
      this.listeners.set(type, (event) => { previous?.(event); return handler(event); });
    }
    closest(selector: string): Element | null {
      return this.className.split(" ").includes(selector.slice(1)) ? this : this.parentElement?.closest(selector) ?? null;
    }
    querySelector(selector: string): Element | null {
      for (const child of this.children) {
        if (child.className.split(" ").includes(selector.slice(1))) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    }
    querySelectorAll(selector: string): Element[] {
      return this.children.flatMap((child) => [
        ...(selector.split(", ").some((part) => part.startsWith(".")
          ? child.className.split(" ").includes(part.slice(1)) : child.tag === part) ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    }
    replaceWith(element: Element) {
      const siblings = this.parentElement!.children;
      siblings.splice(siblings.indexOf(this), 1, element);
      element.parentElement = this.parentElement;
    }
    after(element: Element) {
      const siblings = this.parentElement!.children;
      siblings.splice(siblings.indexOf(this) + 1, 0, element);
      element.parentElement = this.parentElement;
    }
    remove() {
      const siblings = this.parentElement!.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.isConnected = false;
    }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.get("close")?.({ stopPropagation() {}, preventDefault() {} }); }
    focus() { this.focused = true; }
    set innerHTML(_value: string) { throw new Error("History must be rendered as text, not HTML"); }
  }
  const llmSource = await readFile(new URL("../web/llm.js", import.meta.url), "utf8");
  const storage = new Map<string, string>();
  const sent: Record<string, any>[] = [];
  const replies: { status: number; body: unknown }[] = [];
  const documentEvents: string[] = [];
  const observers: { callback: () => void; disconnected: boolean; observed: Element[] }[] = [];
  const module = (code: string) => code.replace(/^import [^;]+;$/gm, "").replace(/^export /gm, "");
  const { render, setupInline, sendInline, dispose, setTranslator } = runInNewContext(`${module(llmSource)}\n${module(source)}\n({render: renderCharacterHistory, setupInline: setupInlineChat, sendInline: sendInlineChat, dispose: disposeCharacterChats, setTranslator: setHistoryTranslator})`, {
    speechQuotes: (await import("../web/translate.js")).speechQuotes,
    document: {
      createElement: (tag: string) => new Element(tag),
      addEventListener() {}, removeEventListener() {},
      dispatchEvent(event: { type: string }) { documentEvents.push(event.type); },
    },
    Event: class { constructor(public type: string) {} },
    AbortController, performance,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    },
    fetch: async (url: string, init: { body: string }) => {
      assert.equal(url, "/api/llm");
      sent.push(JSON.parse(init.body));
      const reply = replies.shift()!;
      const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
      return { ok: true, status: 200, json: async () => ({ ok: reply.status === 200, status: reply.status, statusText: reply.status === 200 ? "OK" : "Unauthorized", text }) };
    },
    requestAnimationFrame: (callback: () => void) => callback(),
    ResizeObserver: class {
      disconnected = false;
      observed: Element[] = [];
      constructor(public callback: () => void) { observers.push(this); }
      observe(target: Element) { this.observed.push(target); }
      disconnect() { this.disconnected = true; }
    },
  });
  const context = { day: "5", time: ["600"], location: "9", locationName: "Living room", affection: "1", trust: "2" };
  const history = {
    character: { id: "alice", name: "Alice", number: "1" }, limit: 20, notice: "Earlier interactions are unavailable.",
    entries: [{
      action: { label: "Talk" }, target: "alice", before: context, after: { ...context, affection: "3" },
      participants: [{ id: "alice", name: "Alice" }],
      lines: [{ character: "alice", text: '<img src=x onerror="bad()">Hello.' }, { character: null, text: "Narration." }],
      choices: ["A choice"], truncated: true,
    }],
  };
  const parent = new Element("div");
  const translated: Element[] = [];
  setTranslator((root: Element) => translated.push(root));
  render(parent, history);
  assert.deepEqual(translated, [parent], "rendered history is handed to the page's translation");
  const nodes = (root: Element): Element[] => [root, ...root.children.flatMap(nodes)];
  const all = nodes(parent);
  assert.equal(parent.scrollTop, parent.scrollHeight, "new history scrolls to the bottom");
  assert.ok(all.every((element) => !["button", "img", "script"].includes(element.tag)));
  const text = all.map((element) => element.textContent).join("\n");
  assert.match(text, /Alice's interaction history \(1\)/);
  assert.match(text, /Day 5, 10:00 · Talk/);
  assert.ok(text.includes(history.entries[0]!.lines[0]!.text));
  const metadata = all.find((node) => node.tag === "p" && node.className === "era-history-heading")!;
  assert.equal(metadata.children.map((node) => node.textContent).join(""), "Living room · Alice");
  assert.equal(metadata.children[1]!.attributes.get("translate"), "no");
  assert.equal(metadata.children[1]!.className, "notranslate");
  assert.doesNotMatch(text, /Alice's scene|may include narration|Script \/ narration/);
  assert.match(text, /Favor\+2/);
  assert.doesNotMatch(text, /affection:|→ 3/);
  assert.equal((text.match(/Day 5, 10:00/g) ?? []).length, 1, "timestamp appears only in the entry heading");
  assert.match(text, /truncated/);
  assert.doesNotMatch(text, /Earlier interactions are unavailable|Scripted interactions|no AI requests/);
  for (const type of ["click", "pointerdown", "keydown", "contextmenu"]) {
    let stopped = false;
    parent.listeners.get(type)!({ stopPropagation() { stopped = true; }, preventDefault() {} });
    assert.equal(stopped, true, `${type} cannot reach the game's input handlers`);
  }
  const panel = parent.children[0]!;
  panel.open = false;
  panel.listeners.get("toggle")!({ stopPropagation() {}, preventDefault() {} });
  const empty = new Element("div");
  render(empty, { ...history, entries: [] });
  assert.equal(empty.children[0]!.open, false, "collapse preference survives main-screen redraws");
  const emptyBody = empty.children[0]!.children[1]!;
  assert.equal(emptyBody.children.length, 1);
  assert.equal(emptyBody.children[0]!.tag, "em");
  assert.equal(emptyBody.children[0]!.textContent, "No interaction yet");
  const colored = new Element("div");
  render(colored, { ...history, entries: [{ ...history.entries[0], lines: [{
    character: "alice", text: "Red green unsafe",
    runs: [
      { text: "<red>", color: "#ff0000" },
      { text: " green ", color: "green" },
      { text: "unsafe", color: "url(https://example.com)" },
    ],
  }] }] });
  const spans = nodes(colored).filter((node) => node.className === "era-history-text").flatMap((node) => node.children);
  assert.equal(spans[0]!.textContent, "Narration to Player: <red>");
  assert.equal(spans[0]!.style.color, "#ff0000");
  assert.equal(spans[1]!.style.color, "green");
  assert.equal(spans[2]!.style.color, undefined);
  const padded = new Element("div");
  render(padded, { ...history, entries: [{ ...history.entries[0], lines: [{
    character: "alice", text: "\n\n  \nKana is here.\nYou realize you haven't greeted her today.\n \n",
    runs: [
      { text: "\n\n", color: "white" },
      { text: "  \nKana is here.\n", color: "#c0c0c0" },
      { text: "You realize you haven't greeted her today.\n ", color: "green" },
      { text: "\n", color: "white" },
    ],
  }] }] });
  const trimmedSpans = nodes(padded).filter((node) => node.className === "era-history-text").flatMap((node) => node.children);
  assert.equal(trimmedSpans.length, 2);
  assert.equal(trimmedSpans[0]!.textContent, "Narration to Player: Kana is here.\n");
  assert.equal(trimmedSpans[0]!.style.color, "#c0c0c0");
  assert.equal(trimmedSpans[1]!.textContent, "Narration to Player: You realize you haven't greeted her today.");
  assert.equal(trimmedSpans[1]!.style.color, "green");
  const toolHistory = new Element("div");
  const calls = "find_characters(Reimi|Reimu|Rei) → 19 found\nget_character_info(Reimu) → Hakurei Reimu";
  render(toolHistory, { ...history, entries: [{ ...history.entries[0], lines: [{
    character: "alice", text: calls, runs: [{ text: calls.slice(0, 12), color: "blue" },
      { text: calls.slice(12), color: "green" }],
  }] }] });
  assert.equal(nodes(toolHistory).filter((node) => node.className === "era-history-text")
    .flatMap((node) => node.children).map((node) => node.textContent).join(""), calls,
    "formatted tool calls are not narration, even when split across colored runs");
  const whitespace = new Element("div");
  render(whitespace, { ...history, entries: [{ ...history.entries[0], lines: [{
    character: "alice", text: " \n ", runs: [{ text: " \n ", color: "white" }],
  }] }] });
  assert.equal(nodes(whitespace).filter((node) => node.className === "era-history-text").flatMap((node) => node.children).length, 0);
  const ordered = new Element("div");
  render(ordered, { ...history, entries: [
    { ...history.entries[0], action: { label: "Newest" }, before: { ...context, marks: { hate: "0", pain: "1" } },
      after: { ...context, affection: "4", trust: "1", marks: { hate: "1", pain: "1" } } },
    { ...history.entries[0], action: { label: "Oldest" }, after: context },
  ] });
  const entries = nodes(ordered).filter((node) => node.className === "era-history-entry");
  assert.equal(entries.length, 1, "consecutive interactions with the same day, room and people share a heading");
  assert.match(entries[0]!.children[0]!.textContent, / · Oldest · $/);
  assert.equal(entries[0]!.tag, "section", "day headings cannot collapse the history");
  assert.ok(nodes(entries[0]!).some((node) => node.textContent === "Favor+3 · Trust-1 · Hate Mark 0→1"));
  assert.equal(history.entries[0]!.action.label, "Talk", "rendering does not reorder the source history");
  const separated = new Element("div");
  render(separated, { ...history, entries: [
    { ...history.entries[0], before: { ...context, day: "6" } },
    { ...history.entries[0], participants: [{ id: "bob", name: "Bob" }] },
    { ...history.entries[0], before: { ...context, location: "10", locationName: "Veranda" } },
    history.entries[0],
  ] });
  assert.equal(nodes(separated).filter((node) => node.className === "era-history-heading").length, 4,
    "a new day, room or set of people starts a new heading");
  const styled = new Element("div");
  render(styled, { ...history, player: { id: "p", name: "Player" }, entries: [{
    ...history.entries[0], choices: [], lines: [
      { character: "alice", text: 'Alice: “Good morning.”', runs: [
        { text: "Ali", color: "green" }, { text: 'ce: “Good morning.”', color: "green" },
      ] },
      { character: "p", text: 'Player: "Hello!"' },
    ],
  }] });
  const speech = nodes(styled).filter((node) => node.className === "era-history-text");
  assert.equal(speech[0]!.children.map((node) => node.textContent).join(""), "Alice: 「Good morning.」");
  assert.equal(speech[0]!.children[0]!.style.color, "#bfc8ce");
  assert.equal(speech[0]!.children.at(-1)!.style.color, "green");
  assert.equal(speech[1]!.children.map((node) => node.textContent).join(""), "Player: 「Hello!」");
  assert.ok(speech[1]!.children.every((node) => node.style.color === "#c5a3ff"), "player speech uses existing lavender");
  const legacyActions = new Element("div");
  render(legacyActions, { ...history, entries: [{ ...history.entries[0], choices: [],
    action: { id: "chat", label: "Conversation" }, lines: [
      { character: "alice", text: "She tilts her head." },
      { character: "alice", text: "Alice: She adjusts her apron." },
      { character: "alice", text: "Kana: She waves." },
    ],
  }] });
  assert.deepEqual(nodes(legacyActions).filter((node) => node.className === "era-history-text")
    .map((node) => node.children.map((child) => child.textContent).join("")),
  ["Alice: She tilts her head.", "Alice: She adjusts her apron.", "Kana: She waves."],
  "older actions get an actor label without duplicating or overriding explicit labels");
  for (const colored of [false, true]) {
    const compact = new Element("div");
    const content = "\n--------------------\nYou and the Robot Maid talk...\n\n \n「Nice weather.」\n---\n\n";
    render(compact, { ...history, entries: [{ ...history.entries[0], lines: [{
      character: "alice", text: content,
      ...(colored ? { runs: [
        { text: content.slice(0, 10), color: "red" },
        { text: content.slice(10), color: "green" },
      ] } : {}),
    }] }] });
    const paragraphs = nodes(compact).filter((node) => node.className === "era-history-text");
    const dialogue = paragraphs[0]!.children.map((node) => node.textContent).join("");
    assert.equal(dialogue, "Narration to Player: You and the Robot Maid talk...\nAlice: 「Nice weather.」");
    if (colored) {
      assert.equal(paragraphs[0]!.children.find((node) => node.textContent === "Alice: ")!.style.color, "#bfc8ce");
      assert.equal(paragraphs[0]!.children.at(-1)!.style.color, "green");
    }
    const note = nodes(compact).find((node) => node.tag === "p" && node.className === "era-history-heading");
    assert.equal(note!.children.map((node) => node.textContent).join(""), "Living room · Alice");
    assert.ok(!nodes(compact).some((node) => node.textContent === "Alice's scene"));
  }
  for (const colored of [false, true]) {
    const intro = new Element("div");
    const content = "Alice was in the Living room.\nYou serve some tea to Alice...\n「You serve some tea to Alice...」\nAlice enjoys the tea.\n";
    render(intro, { ...history, entries: [{ ...history.entries[0], action: { id: 301, label: "Serve tea" }, lines: [{
      character: "alice", text: content,
      ...(colored ? { runs: [{ text: content, color: "green" }] } : {}),
    }] }] });
    const dialogue = nodes(intro).filter((node) => node.className === "era-history-text")[0]!;
    assert.equal(dialogue.children.map((node) => node.textContent).join(""), "Alice: 「You serve some tea to Alice...」\nNarration to Player: Alice enjoys the tea.");
    if (colored) {
      assert.equal(dialogue.children[0]!.style.color, "#bfc8ce");
      assert.equal(dialogue.children[1]!.style.color, "green");
    }
  }
  const noticeHistory = new Element("div");
  render(noticeHistory, { ...history, entries: [{ ...history.entries[0], source: "state",
    action: { id: "reaction", label: "Reaction" }, lines: [{
      character: "alice", text: "Alice notices that Player is suddenly there.",
    }] }] });
  assert.equal(nodes(noticeHistory).find((node) => node.className === "era-history-text")!.children
    .map((node) => node.textContent).join(""),
    "Narration to Alice: Alice notices that Player is suddenly there.");
  assert.ok(nodes(noticeHistory).find((node) => node.className === "era-history-text")!.children
    .every((node) => node.style.color === "#c5a3ff"), "observer notices use lavender, including older saved events");
  const privateHistory = new Element("div");
  render(privateHistory, { ...history, entries: [{ ...history.entries[0], lines: [{
    character: "alice", text: "Alice (thought): I find this suspicious.", thought: true,
    runs: [{ text: "Alice (thought): I find this suspicious.", color: "green" }],
  }] }] });
  const thoughtText = nodes(privateHistory).find((node) => node.className === "era-history-text")!;
  assert.equal(thoughtText.children[0]!.tag, "em", "private thoughts are italic, not spoken dialogue");
  assert.equal(thoughtText.children[0]!.style.color, "green");
  assert.equal(thoughtText.children[0]!.textContent, "Alice (thought): I find this suspicious.");
  const overheard = new Element("div");
  render(overheard, { ...history, entries: [{ ...history.entries[0],
    action: { id: "chat", label: "Conversation" }, choices: [], lines: [
      { character: "kana", text: "Kana: 「Happy New Year, Reimu!」" },
      { character: "kana", text: "Kana waves." },
    ],
  }] });
  assert.deepEqual(nodes(overheard).filter((node) => node.className === "era-history-text")
    .map((node) => node.children.map((child) => child.textContent).join("")),
  ["Kana: 「Happy New Year, Reimu!」", "Kana waves."], "overheard LLM speech and actions never acquire a game-narration prefix");
  const dialogueOnly = new Element("div");
  render(dialogueOnly, { ...history, entries: [{ ...history.entries[0], lines: [{
    character: "alice", text: "You enter the room.\n「Hello!」\nYou sit down.",
  }] }] }, { embedded: true, hideNarrationPrefix: true });
  assert.equal(nodes(dialogueOnly).find((node) => node.className === "era-history-text")!.children
    .map((node) => node.textContent).join(""), "You enter the room.\nAlice: 「Hello!」\nYou sit down.", "inline history hides only narration prefixes, not narration text");
  const prefixedNarration = new Element("div");
  render(prefixedNarration, { ...history, entries: [{ ...history.entries[0], lines: [{
    character: null, text: "Narration to Player: ●You wish Alice a happy New Year.",
    runs: [{ text: "Narration to ", color: "gray" }, { text: "Player: ●You wish Alice a happy New Year.", color: "green" }],
  }] }] }, { embedded: true, hideNarrationPrefix: true });
  const visibleNarration = nodes(prefixedNarration).find((node) => node.className === "era-history-text")!;
  assert.equal(visibleNarration.children.map((node) => node.textContent).join(""), "●You wish Alice a happy New Year.");
  assert.equal(visibleNarration.children[0]!.style.color, "green");
  const historyPanel = new Element("div");
  let requests = 0;
  render(historyPanel, history, { embedded: true, loadAll: async () => { requests++; return history; } });
  const localEvent = { stopPropagation() {}, preventDefault() {} };
  const expand = nodes(historyPanel).find((node) => node.tag === "button")!;
  assert.equal(expand.textContent, "more...");
  assert.ok(!nodes(historyPanel).some((node) => /Latest \d+ interactions/.test(node.textContent)));
  await expand.listeners.get("click")!(localEvent);
  assert.equal(requests, 1, "all history is loaded only when expanded");
  const dialog = nodes(historyPanel).find((node) => node.tag === "dialog")!;
  assert.equal(dialog.open, true);
  assert.ok(nodes(dialog).filter((node) => node.className === "era-history-entry").every((node) => node.tag === "section"));
  dialog.listeners.get("cancel")!(localEvent);
  assert.equal(dialog.isConnected, false);
  assert.equal(expand.focused, true);
  const failure = new Element("div");
  render(failure, history, { loadAll: async () => { throw new Error("Session expired"); } });
  await nodes(failure).find((node) => node.tag === "button")!.listeners.get("click")!(localEvent);
  assert.ok(nodes(failure).some((node) => node.textContent === "Could not load interaction history: Session expired"));

  // Chatting through the configured LLM. Like the server, the fake game writes everything said and done into the
  // history at once: the player's words in quotes, speech in 「」, actions as narration and other calls in backticks.
  const settled = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)); };
  const call = (id: string, name: string, args: string) => ({ id, type: "function", function: { name, arguments: args } });
  const fakeGame = (tool: (name: string, args: Record<string, unknown>) => { result: Record<string, unknown>; changed: boolean } = () => ({ result: {}, changed: true })) => {
    const lines: { character: string | null; text: string }[] = [];
    const ran: [string, unknown][] = [];
    const chatEntry = () => ({ ...history.entries[0], id: "chat1", action: { id: "chat", label: "Conversation" }, lines: lines.map((line) => ({ ...line })), choices: [], truncated: false });
    return {
      ran, lines,
      loadAll: async () => ({ ...history, entries: lines.length ? [chatEntry(), ...history.entries] : history.entries }),
      record: async (text: string) => {
        lines.push({ character: null, text: text.split(/(\*[^*]+\*)/).filter((part) => part.trim()).map((part) => part.startsWith("*") ? part : `"${part.trim()}"`).join(" ") });
      },
      undo: async (count: number) => { lines.splice(lines.length - count); },
      runTool: async (name: string, args: Record<string, unknown>) => {
        ran.push([name, args]);
        const outcome = tool(name, args);
        if (name === "say" && !outcome.result.error) lines.push({ character: "alice", text: `「${args.text}」` });
        else if (name === "act" && !outcome.result.error) lines.push({ character: "alice", text: String(args.text) });
        else if (name !== "describe_scene") lines.push({ character: "alice", text: `\`${name}(${JSON.stringify(args)})\` → ${JSON.stringify(outcome.result)}` });
        return outcome;
      },
    };
  };
  const openChat = async (game: ReturnType<typeof fakeGame>, options: Record<string, unknown> = {}) => {
    const chatParent = new Element("div");
    const { loadAll, record, undo, runTool } = game;
    render(chatParent, history, { loadAll, chat: { gameId: "tw", gameTitle: "eraTW", record, undo, runTool, ...options } });
    await nodes(chatParent).find((node) => node.tag === "button")!.listeners.get("click")!(localEvent);
    const chatDialog = nodes(chatParent).find((node) => node.tag === "dialog")!;
    const find = (predicate: (node: Element) => boolean) => nodes(chatDialog).find(predicate)!;
    const textarea = find((node) => node.tag === "textarea") as Element & { value: string };
    const say = async (value: string) => {
      textarea.value = value;
      find((node) => node.tag === "form").listeners.get("submit")!(localEvent);
      await settled();
    };
    const shown = () => nodes(chatDialog).filter((node) => node.className.split(/\s+/).includes("era-history-text")).map((node) => node.children.filter((child) => child.tag === "span" && !child.className).map((child) => child.textContent).join(""));
    return { chatDialog, find, textarea, say, shown, text: () => nodes(chatDialog).map((node) => node.textContent).join("\n") };
  };
  let game = fakeGame();
  let chat = await openChat(game);
  assert.equal(chat.textarea.focused, true);
  await chat.say("Hello there");
  assert.equal(sent.length, 0, "nothing is sent before an LLM is set up");
  assert.deepEqual(documentEvents, ["era-llm-configure"]);
  assert.equal(game.lines.length, 0);
  // Without tool calling, the JSON reply still goes into the room and the history through say and act.
  storage.set("era-typescript.llm", JSON.stringify({ provider: "openrouter", providers: { openrouter: { apiKey: "sk-test", model: "test/model", tools: false } } }));
  replies.push({ status: 200, body: { choices: [{ message: { content: '```json\n{"speech": "Hi!", "actions": ["Alice waves."]}\n```' } }] } });
  await chat.say("Hello there");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.provider, "openrouter");
  assert.equal(sent[0]!.endpoint, "https://openrouter.ai/api/v1");
  assert.equal(sent[0]!.apiKey, "sk-test");
  assert.equal(sent[0]!.path, "chat/completions");
  assert.equal(sent[0]!.payload.model, "test/model");
  assert.deepEqual(sent[0]!.payload.response_format, { type: "json_object" });
  const prompt = sent[0]!.payload.messages;
  assert.equal(prompt[0].role, "system");
  assert.match(prompt[0].content, /role-playing as Alice.*"eraTW"/);
  assert.match(prompt[0].content, /"speech".*"actions"/);
  assert.match(prompt[1].content, /Current situation: Day 5, 10:00 at Living room\. Alice's favor toward the player: 3; trust: 2\./);
  assert.match(prompt[1].content, /\[Day 5, 10:00 · Living room\] Talk \(present: Alice\)\n.*Hello\.\nNarration to Player: Narration\.\nPlayer inputs: A choice\nFavor\+2/);
  assert.doesNotMatch(prompt[1].content, /Hello there/, "the new message is the player's turn, not part of the history context");
  assert.deepEqual(prompt.at(-1), { role: "user", content: "Player: Hello there" });
  assert.equal(chat.textarea.value, "");
  assert.deepEqual(game.lines.map((line) => line.text), ['"Hello there"', "Alice waves.", "「Hi!」"]);
  assert.deepEqual(chat.shown().slice(-3), ['Player: 「Hello there」', "Alice: Alice waves.", "Alice: 「Hi!」"]);
  assert.ok(!nodes(chat.chatDialog).some((node) => /era-llm-message is-|era-llm-transcript/.test(node.className)), "no separate chat transcript");
  const debugTab = chat.find((node) => node.textContent.startsWith("LLM debug"));
  assert.equal(debugTab.textContent, "LLM debug (1)");
  debugTab.listeners.get("click")!(localEvent);
  const debugPane = chat.find((node) => node.className.includes("era-llm-debug") && node.tag === "div");
  assert.equal(debugPane.hidden, false);
  const debugText = nodes(debugPane).map((node) => node.textContent).join("\n");
  assert.match(debugText, /OpenRouter · test\/model · 200 OK/);
  assert.match(debugText, /Sent: POST https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/);
  assert.match(debugText, /Hello there/);
  assert.match(debugText, /"speech": "Hi!"/);
  assert.ok(!nodes(debugPane).some((node) => node.className === "era-llm-voice"), "no voice editor without the voice API");
  assert.doesNotMatch(debugText, /sk-test/, "the API key is not shown");
  chat.chatDialog.listeners.get("cancel")!(localEvent);

  // The conversation is part of the history: a later prompt carries it as context. A failed reply is taken back.
  storage.set("era-typescript.llm", JSON.stringify({ provider: "openrouter", providers: { openrouter: { apiKey: "sk-test", model: "test/model" } } }));
  chat = await openChat(game);
  assert.deepEqual(chat.shown().slice(-3), ['Player: 「Hello there」', "Alice: Alice waves.", "Alice: 「Hi!」"]);
  replies.push({ status: 401, body: { error: { message: "No auth" } } });
  await chat.say("Again");
  assert.match(sent[1]!.payload.messages[1].content, /Conversation \(present: Alice\)\nPlayer: 「Hello there」\nAlice: Alice waves\.\nAlice: 「Hi!」/);
  assert.match(chat.text(), /No reply: 401 Unauthorized: No auth/);
  assert.equal(chat.textarea.value, "Again");
  assert.equal(game.lines.length, 3, "the unanswered message is taken back");
  // Retry takes back a message of yours and everything after it, then sends it again; Edit puts it back to change first.
  replies.push({ status: 200, body: { choices: [{ message: { content: null, tool_calls: [call("h", "say", '{"text": "Hello again!"}')] } }] } });
  replies.push({ status: 200, body: { choices: [{ message: { content: "DONE" } }] } });
  const retry = chat.find((node) => node.tag === "button" && node.textContent === "Retry");
  assert.match(retry.parentElement!.parentElement!.textContent + retry.parentElement!.parentElement!.children.map((node) => node.textContent).join(""), /「Hello there」/);
  await retry.listeners.get("click")!(localEvent);
  await settled();
  assert.deepEqual(sent.at(-2)!.payload.messages.slice(-1), [{ role: "user", content: "Player: Hello there" }]);
  assert.doesNotMatch(sent.at(-2)!.payload.messages[1].content, /Hi!/);
  assert.deepEqual(game.lines.map((line) => line.text), ['"Hello there"', "「Hello again!」"]);
  await chat.find((node) => node.tag === "button" && node.textContent === "Edit").listeners.get("click")!(localEvent);
  await settled();
  assert.equal(chat.textarea.value, "Hello there");
  assert.equal(game.lines.length, 0);
  assert.doesNotMatch(chat.text(), /Hello again!/);
  chat.chatDialog.listeners.get("cancel")!(localEvent);

  const namedGame = fakeGame();
  namedGame.lines.push({ character: "player-id", text: 'Alex: "I saw something odd."' });
  namedGame.lines.push({ character: "alice", text: "「What did you see?」" });
  const originalHistory = namedGame.loadAll;
  namedGame.loadAll = async () => ({
    ...await originalHistory(),
    player: { id: "player-id", name: "Alex", number: "0" },
  });
  const namedChat = await openChat(namedGame);
  await namedChat.find((node) => node.tag === "button" && node.textContent === "Edit").listeners.get("click")!(localEvent);
  await settled();
  assert.equal(namedChat.textarea.value, "I saw something odd.", "Edit strips the actual player-name prefix");
  assert.equal(namedGame.lines.length, 0);
  namedChat.chatDialog.listeners.get("cancel")!(localEvent);

  // Tool calls run in the game and their results go back to the model until it replies; closing then redraws the room.
  let refreshed = 0;
  game = fakeGame((name) => {
    if (name === "describe_scene") return { result: { time: "07:00", me: { name: "Alice" }, othersHere: ["Bob (Human, male)"] }, changed: false };
    if (name === "say") return { result: { heard: true }, changed: true };
    return name === "change_feelings" ? { result: { favor: { before: 3, after: 13 } }, changed: true } : { result: { error: "Unknown destination" }, changed: false };
  });
  chat = await openChat(game, { refresh: async () => { refreshed++; } });
  replies.push({ status: 200, body: { choices: [{ message: { content: null, tool_calls: [call("a", "change_feelings", '{"favor": 10, "reason": "gift"}'), call("b", "move_to", '{"destination": "Moon"}')] } }] } });
  // A text reply is taken as the reply itself (here a {"speech", "actions"} object) and ends it.
  replies.push({ status: 200, body: { choices: [{ message: { content: '{"speech": "Thank you!", "actions": []}' } }] } });
  await chat.say("*hands over a gift* Here is a gift");
  await settled();
  assert.equal(JSON.stringify(game.ran), JSON.stringify([["describe_scene", {}], ["change_feelings", { favor: 10, reason: "gift" }], ["move_to", { destination: "Moon" }], ["say", { text: "Thank you!" }]]));
  const [first, second] = sent.slice(-2).map((request) => request.payload);
  assert.equal(second.messages.length, first.messages.length + 3, "nothing more is asked after a text reply");
  assert.deepEqual(first.tools.map((tool: { function: { name: string } }) => tool.function.name), ["get_character_info", "find_characters", "change_feelings", "change_mark", "change_mood", "check_consent", "player_attempts", "say", "act", "think", "move_to", "push_down_player"]);
  assert.match(first.messages[0].content, /Talk and act only through tool calls/);
  assert.match(first.messages[0].content, /call check_consent for it and answer/);
  assert.doesNotMatch(first.messages[0].content, /"speech"/);
  assert.equal(first.response_format, undefined, "replies come through tools, so JSON mode is off");
  assert.match(first.messages[2].content, /^Current scene \("me" is you, the character you play\):\n\{"time":"07:00","me":\{"name":"Alice"\},"othersHere":\["Bob \(Human, male\)"\]\}$/);
  assert.equal(first.messages.length, 4, "earlier turns are history, not replayed messages");
  assert.deepEqual(second.messages.slice(-3).map((message: { role: string }) => message.role), ["assistant", "tool", "tool"]);
  assert.equal(JSON.stringify(second.messages.at(-2)), JSON.stringify({ role: "tool", tool_call_id: "a", name: "change_feelings", content: '{"favor":{"before":3,"after":13}}' }));
  assert.deepEqual(chat.shown().slice(-4).map((line) => line.replace(/`.*/, "`")), ['Player: *hands over a gift* "Here is a gift"', "`", "`", "Alice: 「Thank you!」"]);
  assert.match(chat.text(), /Close this window to see what happens in the room/);
  chat.find((node) => node.textContent.startsWith("LLM debug")).listeners.get("click")!(localEvent);
  const toolDebug = nodes(chat.find((node) => node.className.includes("era-llm-debug") && node.tag === "div")).map((node) => node.textContent).join("\n");
  assert.match(toolDebug, /→ change_feelings\(\{"favor": 10, "reason": "gift"\}\)/);
  assert.match(toolDebug, /tool result \(move_to\)/);
  assert.equal(refreshed, 0);
  chat.chatDialog.close();
  assert.equal(refreshed, 1, "closing after a change redraws the room");

  // A reply is a few seconds long: going past the limit drops the extra lines and ends the reply without asking again.
  game = fakeGame();
  chat = await openChat(game);
  let before = sent.length;
  replies.push({ status: 200, body: { choices: [{ message: { content: null, tool_calls: [1, 2, 3, 4].map((n) => call(`s${n}`, "say", `{"text": "Line ${n}."}`)) } }] } });
  await chat.say("Talk to me");
  await settled();
  assert.equal(sent.length, before + 1);
  assert.deepEqual(game.lines.map((line) => line.text), ['"Talk to me"', "「Line 1.」", "「Line 2.」"]);
  assert.match(sent.at(-1)!.payload.messages[0].content, /approximately 6 seconds.*\n.*Do not invent people, places/s);
  // Calls written out as text are run as calls.
  replies.push({ status: 200, body: { choices: [{ message: { content: 'say(text: "I like you too.")\nact(text: "Alice blushes (a little).")' } }] } });
  replies.push({ status: 200, body: { choices: [{ message: { content: "DONE" } }] } });
  await chat.say("I like you");
  await settled();
  assert.deepEqual(game.lines.slice(-2).map((line) => line.text), ["「I like you too.」", "Alice blushes (a little)."]);
  assert.equal(sent.at(-1)!.payload.messages.at(-3).tool_calls.length, 2);
  // A plain-text reply goes into the history anyway: quoted speech is said and the narration around it acted.
  before = sent.length;
  replies.push({ status: 200, body: { choices: [{ message: { content: '「Indeed. We seek only to observe.」\n\n*Alice\'s smile remains.* "Why?"' } }] } });
  await chat.say("Do you want me?");
  await settled();
  assert.equal(sent.length, before + 1, "a text reply is the whole reply");
  assert.deepEqual(game.lines.slice(-3).map((line) => line.text), ["「Indeed. We seek only to observe.」", "Alice's smile remains.", "「Why?」"]);
  assert.doesNotMatch(chat.text(), /did not reply|Ignored/);
  // DONE ends a reply, including after calls written out as text.
  before = sent.length;
  replies.push({ status: 200, body: { choices: [{ message: { content: "DONE" } }] } });
  await chat.say("...");
  await settled();
  assert.equal(sent.length, before + 1);
  assert.match(chat.text(), /Alice did not reply\./);
  replies.push({ status: 200, body: { choices: [{ message: { content: 'say(text: "Bye.")\nDONE.' } }] } });
  await chat.say("Bye");
  await settled();
  assert.equal(sent.length, before + 2);
  assert.equal(game.lines.at(-1)!.text, "「Bye.」");
  assert.match(sent.at(-1)!.payload.messages[0].content, /reply with just DONE/);
  chat.chatDialog.close();

  // The character card has its own tab: loaded from the game, saved to disk, and reverted.
  const savedVoices: unknown[] = [];
  const generated = { description: "A demon from below.", examples: ["We think not.", "A meeting is nice."], intimateExamples: ["Our body."] };
  let voiceRequests = 0;
  chat = await openChat(fakeGame(), {
    voice: async () => { voiceRequests++; return { generated, saved: null, location: "/saves/llm-voices.json" }; },
    saveVoice: async (voice: unknown) => { savedVoices.push(voice); },
  });
  assert.equal(voiceRequests, 0, "the voice is loaded only when the character card tab is opened");
  chat.find((node) => node.textContent.startsWith("LLM debug")).listeners.get("click")!(localEvent);
  await settled();
  assert.equal(voiceRequests, 0, "debug no longer loads the character card");
  const cardTab = chat.find((node) => node.tag === "button" && node.textContent === "Character card");
  cardTab.listeners.get("click")!(localEvent);
  await settled();
  assert.equal(voiceRequests, 1);
  const cardPane = chat.find((node) => node.className.includes("era-llm-card"));
  assert.equal(cardPane.hidden, false);
  assert.equal(cardTab.attributes.get("aria-pressed"), "true");
  assert.equal(chat.find((node) => node.className.includes("era-llm-debug") && node.tag === "div").hidden, true);
  const voiceSection = chat.find((node) => node.className === "era-llm-voice");
  assert.equal(voiceSection.tag, "section", "the editor is always expanded");
  const voiceText = () => nodes(voiceSection).map((node) => node.textContent).join("\n");
  const [descriptionBox, examplesBox, intimateBox] = nodes(voiceSection).filter((node) => node.tag === "textarea") as (Element & { value: string })[];
  assert.equal(descriptionBox!.value, "A demon from below.");
  assert.equal(examplesBox!.value, "We think not.\nA meeting is nice.");
  assert.equal(intimateBox!.value, "Our body.");
  assert.match(voiceText(), /Character voice \(generated\)/);
  assert.match(voiceText(), /saved to \/saves\/llm-voices\.json/);
  const voiceButton = (label: string) => nodes(voiceSection).find((node) => node.tag === "button" && node.textContent === label)! as Element & { disabled: boolean };
  assert.equal(voiceButton("Revert to generated").disabled, true);
  examplesBox!.value = "「We think not.」\n\n  We shall see.  ";
  examplesBox!.listeners.get("input")!(localEvent);
  assert.match(voiceText(), /Unsaved changes\./);
  await voiceButton("Save").listeners.get("click")!(localEvent);
  await settled();
  assert.deepEqual(JSON.parse(JSON.stringify(savedVoices)), [{ description: "A demon from below.", examples: ["We think not.", "We shall see."], intimateExamples: ["Our body."] }]);
  assert.match(voiceText(), /Character voice \(edited\)/);
  assert.match(voiceText(), /Saved to \/saves\/llm-voices\.json\./);
  assert.equal(voiceButton("Revert to generated").disabled, false);
  await voiceButton("Revert to generated").listeners.get("click")!(localEvent);
  await settled();
  assert.equal(savedVoices.at(-1), null);
  assert.equal(examplesBox!.value, "We think not.\nA meeting is nice.");
  assert.match(voiceText(), /Character voice \(generated\)/);
  chat.find((node) => node.tag === "button" && node.textContent === "History & chat").listeners.get("click")!(localEvent);
  assert.equal(cardPane.hidden, true);
  cardTab.listeners.get("click")!(localEvent);
  await settled();
  assert.equal(voiceRequests, 1, "returning to the card preserves the existing editor");
  chat.chatDialog.close();

  // The player's attempt is handed to the game: nothing after it runs, nothing more is asked, and the dialog closes.
  let redrawn = 0;
  game = fakeGame((name) => name === "player_attempts" ? { result: { note: "The player tries it now" }, changed: true } : { result: { heard: true }, changed: true });
  chat = await openChat(game, { refresh: async () => { redrawn++; } });
  const asked = sent.length;
  replies.push({ status: 200, body: { choices: [{ message: { content: null, tool_calls: [
    call("k1", "say", '{"text": "Oh!"}'), call("k2", "player_attempts", '{"activity": "kiss"}'), call("k3", "say", '{"text": "Too late."}')] } }] } });
  await chat.say("Can I kiss you?");
  await settled();
  assert.equal(sent.length, asked + 1);
  assert.equal(JSON.stringify(game.ran.map(([name]) => name)), JSON.stringify(["describe_scene", "say", "player_attempts"]));
  assert.equal(JSON.stringify(sent.at(-1)!.payload.tools.map((tool: { function: { name: string } }) => tool.function.name).slice(5, 7)), JSON.stringify(["check_consent", "player_attempts"]));
  assert.match(sent.at(-1)!.payload.messages[0].content, /actually tries to kiss Alice: call player_attempts\("kiss"\)/);
  assert.equal(redrawn, 1, "the dialog closes so the game plays out the attempt");
  // In an intimate scene the prompt and tools change, and a scene command is handed to the game the same way.
  game = fakeGame((name) => {
    if (name === "describe_scene") return { result: { me: { name: "Alice" }, intimateScene: { availableCommands: ["Kiss", "Caress"] }, voice: { description: "A demon from below.", examples: ["We think not."] } }, changed: false };
    return name === "scene_action" ? { result: { command: "Kiss" }, changed: true } : { result: { heard: true }, changed: true };
  });
  chat = await openChat(game, { refresh: async () => { redrawn++; } });
  replies.push({ status: 200, body: { choices: [{ message: { content: null, tool_calls: [
    call("s1", "say", '{"text": "Mm..."}'), call("s2", "scene_action", '{"command": "Kiss"}'), call("s3", "say", '{"text": "Again."}')] } }] } });
  await chat.say("Kiss me.");
  await settled();
  assert.equal(JSON.stringify(game.ran.map(([name]) => name)), JSON.stringify(["describe_scene", "say", "scene_action"]));
  const names = sent.at(-1)!.payload.tools.map((tool: { function: { name: string } }) => tool.function.name);
  assert.ok(names.includes("scene_action") && names.includes("end_scene") && !names.includes("check_consent") && !names.includes("player_attempts") && !names.includes("move_to"));
  assert.match(sent.at(-1)!.payload.messages[0].content, /middle of an intimate scene/);
  assert.match(sent.at(-1)!.payload.messages[0].content, /wants to stop or rest .*: call end_scene/);
  assert.match(sent.at(-1)!.payload.messages[0].content, /commands available now \(Kiss, Caress\)/);
  // Her kojo's description and lines come after the scene as plain text, and the instructions ask to match them.
  assert.match(sent.at(-1)!.payload.messages[0].content, /Speak the way Alice does in the example lines below/);
  const sceneMessage = sent.at(-1)!.payload.messages[2].content;
  assert.match(sceneMessage, /How the game introduces you:\nA demon from below\.\n\nExample lines you say in the game \(your voice\):\n「We think not\.」$/);
  assert.doesNotMatch(sceneMessage, /"voice"/);
  assert.equal(redrawn, 2, "the dialog closes so the game plays out the scene command");

  const main = new Element("div");
  main.className = "era-main";
  const inlineParent = new Element("div");
  inlineParent.className = "era-character";
  main.append(inlineParent);
  const inlineGame = fakeGame();
  let inlineLoads = 0;
  let inlineRefreshes = 0;
  const inlineTextarea = new Element("input") as Element & { value: string };
  const inlineOptions = { ...inlineGame, input: inlineTextarea };
  const inputContainer = new Element("form");
  inputContainer.append(inlineTextarea);
  const loadInline = async () => { inlineLoads++; return inlineGame.loadAll(); };
  setupInline(inlineParent, history, loadInline, inlineOptions);
  setupInline(inlineParent, history, loadInline, inlineOptions);
  assert.equal(main.querySelectorAll(".era-main-chat").length, 1, "one bottom chat per main screen");
  assert.equal(inlineLoads, 0, "mounting the main screen does not fetch all history");
  const inlineHost = main.querySelector(".era-main-chat")!;
  assert.equal(inlineHost.parentElement, inlineParent, "history is embedded inside the room panel");
  assert.equal(inlineHost.querySelectorAll("button").length, 1, "inline history has an open-dialog button");
  assert.equal(inlineHost.querySelectorAll("textarea, form, input").length, 0, "inline history has no composer");
  assert.ok(nodes(inlineHost).some((node) => node.textContent === "Narration."), "inline history retains game narration text");
  assert.ok(!nodes(inlineHost).some((node) => node.textContent.includes("Narration to Player:")), "inline history hides only the narration prefix");
  const inlinePane = inlineHost.querySelector(".era-history-pane")!;
  inlinePane.scrollTop = 0;
  observers[0]!.callback();
  assert.equal(inlinePane.scrollTop, inlinePane.scrollHeight, "resizing after layout scrolls the actual history pane to the bottom");
  await inlineHost.querySelectorAll("button")[0]!.listeners.get("click")!(localEvent);
  const inlineDialog = nodes(inlineHost).find((node) => node.tag === "dialog")!;
  assert.equal(inlineDialog.open, true, "inline history opens the full history dialog");
  assert.ok(nodes(inlineDialog).some((node) => node.textContent.includes("Narration.")), "the dialog retains game narration");
  inlineDialog.close();
  assert.equal(inlineTextarea.parentElement, inputContainer, "chat never moves the shared command input out of its form");
  assert.equal(inlineTextarea.focused, false, "mounting chat does not steal focus or scroll past the room");
  const inlineSubmit = async (value: string) => {
    inlineTextarea.value = value;
    const result = await sendInline(inlineHost);
    if (result?.changed) inlineRefreshes++;
    await settled();
  };
  replies.push({ status: 200, body: { choices: [{ message: { content: '「Hello from the room.」' } }] } });
  await inlineSubmit("Hello");
  assert.ok(inlineLoads >= 3, "sending loads full history, then reloads recorded messages and replies");
  assert.equal(inlineRefreshes, 1, "inline game changes refresh the room without closing a dialog");
  assert.ok(nodes(inlineHost).some((node) => node.textContent.includes("Hello from the room.")));
  assert.equal(inlineTextarea.focused, false, "shared input focus is managed by the main screen");
  assert.ok(!nodes(inlineHost).some((node) => /Close this window/.test(node.textContent)));

  // Game handoffs refresh inline instead of trying to close a non-dialog host.
  replies.push({ status: 200, body: { choices: [{ message: { content: null, tool_calls: [
    call("inline-attempt", "player_attempts", '{"action": "wave"}'),
  ] } }] } });
  await inlineSubmit("*waves*");
  assert.equal(inlineRefreshes, 2);
  assert.equal(inlineHost.isConnected, true);
  dispose(main);
  dispose(main);
  assert.equal(observers[0]!.disconnected, true, "retiring inline history stops its layout observer");
  const sentBeforeDisposal = sent.length;
  await inlineSubmit("No longer active");
  assert.equal(sent.length, sentBeforeDisposal, "retired screens cannot send more chat requests");
  assert.equal(inlineRefreshes, 2, "disposing inline chat does not trigger a second room refresh");

  const pendingMain = new Element("div");
  pendingMain.className = "era-main";
  const pendingParent = new Element("div");
  pendingParent.className = "era-character";
  pendingMain.append(pendingParent);
  let releaseHistory!: (value: typeof history) => void;
  setupInline(pendingParent, history, () => new Promise((resolve) => { releaseHistory = resolve; }), inlineOptions);
  const pendingTextarea = inlineTextarea;
  pendingTextarea.value = "Leaving before history loads";
  const pendingRequest = sendInline(pendingMain.querySelector(".era-main-chat")!);
  dispose(pendingMain);
  releaseHistory(history);
  await pendingRequest;
  await settled();
  assert.equal(sent.length, sentBeforeDisposal, "leaving during history loading cancels submission");
  assert.equal(pendingTextarea.disabled, true, "async completion cannot re-enable a retired composer");

  const failedMain = new Element("div");
  failedMain.className = "era-main";
  const failedParent = new Element("div");
  failedParent.className = "era-character";
  failedMain.append(failedParent);
  setupInline(failedParent, history, async () => { throw new Error("History unavailable"); }, inlineOptions);
  const failedTextarea = inlineTextarea;
  failedTextarea.value = "Try again later";
  await sendInline(failedMain.querySelector(".era-main-chat")!);
  await settled();
  assert.equal(sent.length, sentBeforeDisposal, "failed context loading never sends an incomplete prompt");
  assert.equal(failedTextarea.value, "Try again later");
  assert.ok(nodes(failedMain).some((node) => node.textContent === "No reply: History unavailable"));
  dispose(failedMain);
});

test("history speech quotes normalize without changing apostrophes, HTML or tool arguments", async () => {
  const { speechQuotes } = await import("../web/translate.js");
  assert.equal(speechQuotes('"Hello!"\nRuukoto: “It’s New Year’s Day.”'), "「Hello!」\nRuukoto: 「It’s New Year’s Day.」");
  assert.equal(speechQuotes('  "Welcome."'), "  「Welcome.」");
  for (const text of ['<img src=x onerror="bad()">Hello.', '`say({"text":"Hello"})`',
    'change_feelings(player, favor +2) ("a gift")', "Ruukoto: 「Already normalized.」"]) {
    assert.equal(speechQuotes(text), text);
  }
});

test("LLM reply boundaries stop at movement and prevent repeated emotional rewards", async () => {
  const source = await readFile(new URL("../web/llm.js", import.meta.url), "utf8");
  const responses: { content?: string; tool_calls?: unknown[] }[] = [];
  let requests = 0;
  const { converse, systemPrompt } = runInNewContext(`${source.replace(/^export /gm, "")}
    request = async () => { countRequest(); return responses.shift(); };
    ({ converse, systemPrompt })`, { responses, countRequest: () => { requests++; } });
  const call = (name: string, args: Record<string, unknown> = {}) => ({
    id: name, type: "function", function: { name, arguments: JSON.stringify(args) },
  });
  const run = async (failed = new Set<string>()) => {
    const executed: string[] = [];
    const result = await converse({
      llm: { tools: true }, messages: [], log: [],
      runTool: async (name: string) => {
        executed.push(name);
        return failed.has(name) ? { error: "Could not do that" } : { ok: true };
      },
    });
    return { executed, result };
  };
  responses.push({ tool_calls: [call("say", { text: "See you." }), call("move_to", { destination: "Veranda" }),
    call("say", { text: "Actually I came back." }), call("change_feelings", { favor: 50 })] });
  assert.deepEqual((await run()).executed, ["say", "move_to"], "nothing after a successful move runs, even in the same batch");
  assert.equal(requests, 1, "movement never asks the model for another round");
  responses.push({ tool_calls: [call("move_to", { destination: "Missing" })] },
    { tool_calls: [call("say", { text: "I cannot go there." })], content: "DONE" });
  assert.deepEqual((await run(new Set(["move_to"]))).executed, ["move_to", "say"], "a failed move permits a reply");
  for (const name of ["change_feelings", "change_mood", "change_mark", "think"]) {
    const before = requests;
    responses.push({ tool_calls: [call(name), call(name), call("say", { text: "Hello." })] });
    const { executed, result } = await run();
    assert.deepEqual(executed, [name, "say"], `${name} only runs once, without suppressing the actual reply`);
    assert.match(result.tools[1].result.error, /only once per reply/);
    assert.equal(requests, before + 1, "repeated state changes end the turn");
  }
  responses.push({ tool_calls: [call("say", { text: "One." }), call("say", { text: "Two." }), call("say", { text: "Three." })] });
  assert.deepEqual((await run()).executed, ["say", "say"]);
  const before = requests;
  for (let i = 0; i < 4; i++) responses.push({ tool_calls: [call("get_character_info", { character: "Alice" })] });
  assert.equal((await run()).executed.length, 4);
  assert.equal(requests, before + 4, "lookup loops have a four-round ceiling");
  const prompt = systemPrompt({ character: { name: "Alice" }, gameTitle: "eraTW", tools: true });
  assert.match(prompt, /ordinary small talk is not evidence of intimacy or love/);
  assert.match(prompt, /Your own words, gestures and thoughts are not reasons to reward the player again/);
});

test("crash reports render as text and copy with explicit clipboard error feedback", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("  if (snapshot.error) {");
  const end = source.indexOf('  } else message(snapshot.status', start);
  assert.ok(start >= 0 && end > start);
  for (const context of [undefined, {
    game: "fixture", gameVersion: "7", debug: true, jit: false,
    action: "input (string)", instruction: 'THROW <img src=x onerror="bad()">',
    instructions: 10, instructionLimit: 1000, outputCharacters: 123, outputLimit: 2_000_000,
    outputEvents: 2, deferredEvents: 1, lastLoadedSlot: "-1",
    routines: ["@INNER (test.ERB:5)"],
    server: { game: "registered", session: "session-id", step: 4, action: "input" },
  }]) {
    const lines: { textContent: string; classList: { add(value: string): void }; append(value: unknown): void }[] = [];
    const messages: string[] = [];
    let copied = "";
    let fail = false;
    let handler: (event: { stopPropagation(): void }) => Promise<void>;
    const button = {
      type: "", textContent: "",
      addEventListener(_type: string, callback: typeof handler) { handler = callback; },
    };
    const scope = {
      snapshot: { error: { file: "test.ERB", line: 8, message: "fixture crash", trace: ["caller.ERB:2"], context } },
      currentLine: null as typeof lines[number] | null,
      message: (value: string) => messages.push(value),
      document: { createElement: () => button },
      navigator: { clipboard: { async writeText(value: string) { if (fail) throw new Error("Permission denied"); copied = value; } } },
      line() {
        if (!scope.currentLine) {
          scope.currentLine = { textContent: "", classList: { add() {} }, append() {} };
          lines.push(scope.currentLine);
        }
        return scope.currentLine;
      },
    };
    runInNewContext(`${source.slice(start, end)}\n}`, scope);
    assert.equal(button.type, "button");
    assert.match(lines[0]!.textContent, /ERROR test.ERB:8 - fixture crash\n  called from caller.ERB:2/);
    if (context) {
      assert.ok(lines[0]!.textContent.includes(context.instruction));
      assert.match(lines[0]!.textContent, /Session: session-id \| Step: 4/);
      assert.match(lines[0]!.textContent, /Output: 123 \/ 2000000 serialized characters/);
      assert.match(lines[0]!.textContent, /active @INNER/);
    }
    let stopped = 0;
    await handler!({ stopPropagation() { stopped++; } });
    assert.equal(copied, lines[0]!.textContent);
    assert.equal(messages.at(-1), "Debug report copied.");
    fail = true;
    await handler!({ stopPropagation() { stopped++; } });
    assert.equal(messages.at(-1), "Could not copy debug report: Permission denied");
    assert.equal(stopped, 2);
  }
});

test("unmarked map rows protect scenery and separate labels from both translation methods", async () => {
  const source = await readFile(new URL("../web/translate.js", import.meta.url), "utf8");
  const start = source.indexOf("export function protectMapTranslation(");
  const end = source.indexOf("export function createTranslation(", start);
  const protect = runInNewContext(`${source.slice(start, end).replace("export ", "")}\nprotectMapTranslation`);
  const row = (textContent: string, marked = false) => ({
    textContent, attributes: new Map<string, string>(), classes: new Set<string>(),
    matches: () => marked,
    setAttribute(name: string, value: string) { this.attributes.set(name, value); },
    get classList() { return { add: (value: string) => this.classes.add(value) }; },
  });
  const maps = [
    row("■林　　　■14│　　│ 08 　　 07 　■"),
    row("森林林木林林林林林林林林林林林林"),
    row("　森森　　　　　　　森森"),
    row("　　　┃┃┃22→"),
    row("霊夢の部屋", true),
  ];
  const prose = [row("■博麗神社"), row("施設：【風呂】【台所】"), row("森へ移動しますか？"), row("│ 霊夢と話す │")];
  const root = { querySelectorAll: () => [...maps, ...prose] };
  protect(root);
  protect(root);
  for (const element of maps) {
    assert.equal(element.attributes.get("translate"), "no");
    assert.ok(element.classes.has("notranslate"));
  }
  for (const element of prose) assert.equal(element.attributes.has("translate"), false);
});

test("timed mouse frames are capped at 60 FPS without changing longer waits or other input timers", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("const FRAME_INTERVAL =");
  const end = source.indexOf("async function expire(", start);
  const delays: number[] = [];
  const cleared: number[] = [];
  const input = { kind: "mousekey", timeout: 5 };
  const schedule = runInNewContext(`let timedWait;\n${source.slice(start, end)}\nscheduleTimedWait`, {
    input, performance: { now: () => 0 },
    setTimeout: (_: () => void, delay: number) => { delays.push(delay); return delays.length; },
    clearTimeout: (handle: number) => cleared.push(handle), clearInterval() {},
  });
  schedule();
  assert.equal(delays[0], 1000 / 60);
  input.timeout = 100;
  schedule();
  assert.equal(delays[1], 100);
  input.kind = "wait";
  input.timeout = 5;
  schedule();
  assert.equal(delays[2], 5);
  input.kind = "integer";
  schedule();
  assert.equal(delays[3], 5);
  assert.deepEqual(cleared, [1, 2, 3]);
});

test("mouse and keyboard events reach the input queue while a timed frame is rendering", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const terminalHandlers = new Map<string, { capture: boolean; handler: (event: object) => void }[]>();
  const documentHandlers: ((event: object) => void)[] = [];
  const sent: { result: number[] }[] = [];
  const state = { busy: true, expiring: true, settling: false, hit: -1 };
  const terminal = {
    addEventListener(name: string, handler: (event: object) => void, options?: boolean) {
      const handlers = terminalHandlers.get(name) ?? [];
      handlers.push({ capture: options === true, handler });
      terminalHandlers.set(name, handlers);
    },
  };
  const start = source.indexOf("function clickToContinue(");
  const end = source.indexOf("// On the map screens", start);
  const keysStart = source.indexOf('document.addEventListener("keydown", (event) => {\n  if (document.body.classList.contains("is-home"))');
  const keysEnd = source.indexOf('  if ((busy && !expiring) || !input || event.defaultPrevented', keysStart);
  runInNewContext([
    'const input = {kind:"mousekey"}, session = "test", MOUSE_BUTTONS = [0x100000, 0x400000, 0x200000];',
    "function submitMouseKey(result) { sent.push({result}); }",
    source.slice(start, end),
    source.slice(keysStart, keysEnd), "});",
  ].join("\n"), {
    terminal, state, sent,
    get busy() { return state.busy; }, get expiring() { return state.expiring; },
    document: { body: { classList: { contains: () => false } }, addEventListener: (_: string, handler: (event: object) => void) => documentHandlers.push(handler) },
    Element: class {}, settling: () => state.settling, clientPoint: () => [10, -20],
    backgroundHit: () => state.hit, selectBackground() {}, getSelection: () => null,
  });
  const event = { button: 0, target: null, preventDefault() {}, stopImmediatePropagation() {} };
  const dispatch = (name: string, capture = false, extra = {}) => {
    for (const { handler, capture: registered } of terminalHandlers.get(name) ?? [])
      if (registered === capture) handler({ ...event, ...extra });
  };
  const exercise = () => {
    state.hit = -1;
    dispatch("click");
    state.hit = 7;
    dispatch("click", true);
    dispatch("contextmenu");
    dispatch("auxclick", false, { button: 1 });
    dispatch("wheel", false, { deltaY: -120 });
    documentHandlers[0]!({ ...event, key: "Escape", keyCode: 27 });
  };
  exercise();
  assert.deepEqual(sent.map(({ result }) => result[0]), [1, 1, 1, 1, 2, 3]);
  assert.deepEqual(sent.map(({ result }) => result[1]), [0x100000, 0x100000, 0x200000, 0x400000, 120, 27]);
  assert.equal(sent[1]!.result[4], 7);
  state.expiring = false;
  exercise();
  assert.equal(sent.length, 6);
  state.expiring = true;
  state.settling = true;
  exercise();
  assert.equal(sent.length, 6);
});

test("client dimensions, background scaling and mouse coordinates share game-pixel units", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const terminal = {
    clientWidth: 1200, clientHeight: 800, clientLeft: 2, clientTop: 3, offsetLeft: 10, offsetTop: 20,
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  };
  const handlers = new Map<string, (event: object) => void>();
  const document = {
    hidden: false, hasFocus: () => true, querySelectorAll: () => [canvas],
    addEventListener: (name: string, handler: (event: object) => void) => handlers.set(name, handler),
  };
  const canvas = { dataset: { x: 10, y: -20, width: 600, height: 400 }, style: {} as Record<string, string> };
  const layers = { back: { style: {} }, front: { style: {} } };
  let lineHeight = 38;
  const snippet = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const browser = runInNewContext([
    snippet("function imageScale(", "/** CSS pixels per Emuera pixel across"),
    snippet("function placeBackground(", "/** Shows the CBG layers"),
    snippet("function clientPoint(", "function submitMouseKey("),
    "({ clientState, placeBackground, clientPoint })",
  ].join("\n"), {
    terminal, document, backgroundLayers: layers, metrics: { lineHeight: 19 },
    getComputedStyle: () => ({ lineHeight: String(lineHeight) }),
  });
  assert.equal(JSON.stringify(browser.clientState()), JSON.stringify({ width: 600, height: 400, active: true, mouseX: 0, mouseY: 0 }));
  browser.placeBackground();
  assert.equal(canvas.style.width, "1200px");
  assert.equal(canvas.style.height, "800px");
  assert.equal(canvas.style.left, "20px");
  assert.equal(canvas.style.bottom, "40px");
  assert.equal(JSON.stringify(browser.clientPoint({ clientX: 212, clientY: 623 })), "[100,-100]");
  handlers.get("pointermove")!({ clientX: 212, clientY: 623 });
  assert.equal(browser.clientState().mouseX, 100);
  assert.equal(browser.clientState().mouseY, -100);
  lineHeight = 19;
  assert.equal(browser.clientState().width, 1200);
  assert.equal(browser.clientState().mouseX, 200);
  assert.equal(browser.clientState().mouseY, -200);
  handlers.get("pointerdown")!({ clientX: -8, clientY: 833 });
  assert.equal(browser.clientState().mouseX, -20);
  assert.equal(browser.clientState().mouseY, 10);
  handlers.get("wheel")!({ clientX: 12, clientY: 823 });
  assert.equal(browser.clientState().mouseX, 0);
  assert.equal(browser.clientState().mouseY, 0);
  browser.placeBackground();
  assert.equal(canvas.style.width, "600px");
  document.hidden = true;
  assert.equal(browser.clientState().active, false);
  document.hidden = false;
  document.hasFocus = () => false;
  assert.equal(browser.clientState().active, false);
});

test("graphics replay appends persistent rotations in world coordinates", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("async function paintOps(");
  const end = source.indexOf("/**", start);
  let matrix = [1, 0, 0, 1, 0, 0];
  const saved: number[][] = [];
  const painted: number[][] = [];
  const context = {
    save: () => saved.push(matrix.slice()),
    restore: () => { matrix = saved.pop()!; },
    getTransform: () => Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((key, i) => [key, matrix[i]])),
    setTransform: (...values: number[]) => { matrix = values; },
    transform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      const [ma, mb, mc, md, me, mf] = matrix as [number, number, number, number, number, number];
      matrix = [ma * a + mc * b, mb * a + md * b, ma * c + mc * d, mb * c + md * d, ma * e + mc * f + me, mb * e + md * f + mf];
    },
    translate: (x: number, y: number) => context.transform(1, 0, 0, 1, x, y),
    rotate: (a: number) => context.transform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0),
    fillRect: (x: number, y: number) => painted.push([
      matrix[0]! * x + matrix[2]! * y + matrix[4]!, matrix[1]! * x + matrix[3]! * y + matrix[5]!,
    ].map((value) => Math.round(value))),
  };
  const paint = runInNewContext(`${source.slice(start, end)}\npaintOps`, {
    newCanvas: () => ({ getContext: () => context }),
  });
  await paint({ width: 20, height: 20, ops: [
    { op: "rotate", angle: 90, x: 5, y: 5 },
    { op: "fill", color: "red", rect: [1, 2, 1, 1] },
    { op: "fill", color: "black", rect: [1, 2, 1, 1], absolute: true },
    { op: "rotate", angle: 90, x: 0, y: 0 },
    { op: "fill", color: "blue", rect: [1, 2, 1, 1] },
    { op: "rotate", angle: -90, x: 0, y: 0 },
    { op: "fill", color: "green", rect: [1, 2, 1, 1] },
  ] });
  assert.deepEqual(painted, [[8, 1], [1, 2], [-1, 8], [8, 1]]);
});

test("browser audio applies live volumes, repeat counts, stop/reset and autoplay retries", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("let backgroundAudio =");
  const end = source.indexOf("/** advanceScreen:", start);
  const instances: AudioMock[] = [];
  const messages: string[] = [];
  class AudioMock {
    volume = 1;
    loop = false;
    currentTime = 0;
    plays = 0;
    stops = 0;
    blocked = false;
    listeners = new Map<string, () => void>();
    constructor(public url: string) { instances.push(this); }
    play() {
      this.plays++;
      return this.blocked ? Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" })) : Promise.resolve();
    }
    pause() { this.stops++; }
    load() {}
    removeAttribute() {}
    addEventListener(name: string, handler: () => void) { this.listeners.set(name, handler); }
  }
  const browser = runInNewContext(`${source.slice(start, end)}\n({ useAudioSettings, resetAudio, retryAudio, playAudio })`, {
    Audio: AudioMock, document: { addEventListener() {} }, message: (value: string) => messages.push(value),
  });
  const settings = { soundVolume: 20, bgmVolume: 40, bgm: { id: "bg", url: "/sound/bg.ogg" }, sounds: [{ id: "s", url: "/sound/se.wav", repeat: 2 }], stopSounds: false };
  browser.useAudioSettings(settings);
  const [bgm, sound] = instances as [AudioMock, AudioMock];
  assert.equal(bgm.loop, true);
  assert.equal(bgm.volume, 0.4);
  assert.equal(sound.volume, 0.2);
  browser.useAudioSettings({ ...settings, bgmVolume: 10, soundVolume: 30, sounds: [] });
  assert.equal(instances.length, 2);
  assert.equal(bgm.volume, 0.1);
  assert.equal(sound.volume, 0.3);
  sound.listeners.get("ended")!();
  assert.equal(sound.plays, 2);
  sound.listeners.get("ended")!();
  assert.equal(sound.stops, 1);
  bgm.blocked = true;
  browser.playAudio(bgm);
  await Promise.resolve();
  assert.match(messages[0]!, /blocked.*Click/);
  bgm.blocked = false;
  browser.retryAudio();
  await Promise.resolve();
  assert.equal(bgm.plays, 3);
  browser.useAudioSettings({ ...settings, bgm: null, sounds: [], stopSounds: true });
  assert.equal(bgm.stops, 1);
  browser.useAudioSettings(settings);
  browser.resetAudio();
  assert.ok(instances.slice(2).every((audio) => audio.stops === 1));
});

test("tooltip alignment follows TOOLTIP_FORMAT and resets with custom styling", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("function useTooltipSettings(");
  const end = source.indexOf("/**", start);
  const tooltip = { style: {} as Record<string, string> };
  const useSettings = runInNewContext(`let tooltipSettings;\n${source.slice(start, end)}\nuseTooltipSettings`, { tooltip });
  for (const [format, expected] of [[0, "left"], [1, "center"], [2, "right"]] as const) {
    useSettings({ custom: true, font: "monospace", fontSize: 10, color: "#fff", background: "#000", format });
    assert.equal(tooltip.style.textAlign, expected);
    assert.equal(tooltip.style.fontSize, "10px");
  }
  useSettings({ custom: false, format: 2 });
  assert.equal(tooltip.style.textAlign, "");
  useSettings(null);
  assert.equal(tooltip.style.fontSize, "");
});

class Element {
  nodeType = 1;
  children: Element[] = [];
  parent?: Element;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  classes = new Set<string>();
  classList = { add: (name: string) => this.classes.add(name) };
  constructor(public tagName: string, private attrs = new Map<string, string>(), public textContent = "") {}
  get childNodes() { return this.children; }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string) { return this.attrs.has(name); }
  append(child: Element) { child.parent = this; this.children.push(child); }
  matches() { return false; }
  closest(): Element { return this.parent ? this.parent.closest() : this; }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap((child) => [
      ...(selector === ".html-positioned" && child.classes.has("html-positioned") ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  get width(): number {
    return Number.parseFloat(this.style.width ?? "") || this.children.reduce((sum, child) =>
      sum + child.width + Number.parseFloat(child.style.marginLeft ?? "0"), 0);
  }
  getBoundingClientRect(): { left: number } {
    if (!this.parent) return { left: 40 };
    const siblings = this.parent.children.slice(0, this.parent.children.indexOf(this));
    return { left: this.parent.getBoundingClientRect().left
      + siblings.reduce((sum, child) => sum + child.width + Number.parseFloat(child.style.marginLeft ?? "0"), 0)
      + Number.parseFloat(this.style.marginLeft ?? "0") };
  }
}
function parsed(node: DefaultTreeAdapterMap["node"]): Element {
  const result = new Element(node.nodeName.toUpperCase(),
    new Map("attrs" in node ? node.attrs.map(({ name, value }) => [name, value]) : []));
  if ("value" in node) { result.nodeType = 3; result.textContent = node.value; result.style.width = `${node.value.length * 10}px`; }
  if ("childNodes" in node) node.childNodes.forEach((child) => result.append(parsed(child)));
  return result;
}

test("HTML pos stacks unequal image layers, resets the cursor and remains stable across renders", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const functionSource = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const terminal = new Element("DIV");
  const { renderHtml, layoutHtmlPositions } = runInNewContext([
    functionSource("function sizeAttribute(", "async function loadImage("),
    functionSource("function layoutHtmlPositions(", "/**"),
    functionSource("async function renderHtml(", "// A browser's page translator"),
    "({ renderHtml, layoutHtmlPositions })",
  ].join("\n"), {
    terminal, Element, Node: { TEXT_NODE: 3 }, generation: 0,
    MutationObserver: class { observe() {} },
    metrics: { fontSize: 20 }, imageScale: () => 1.5,
    DOMParser: class { parseFromString(markup: string) { return { head: { children: [] }, body: parsed(parseFragment(markup)) }; } },
    document: { createElement: (tag: string) => new Element(tag), createTextNode: (text: string) => parsed({ nodeName: "#text", value: text, parentNode: null }) },
    allowedTags: new Set(["NOBR", "NONBUTTON", "SPAN"]),
    image: async (node: Element) => {
      const image = new Element("SPAN");
      image.style.width = `${Number(node.getAttribute("width"))}px`;
      return image;
    },
    applyClasses() {}, decorateLabel() {}, choice: () => new Element("BUTTON"),
  });

  await renderHtml("<nobr>prefix<nonbutton pos='100'><img width='90'></nonbutton><nonbutton pos='100'><img width='60'></nonbutton><button pos='100' value='7'><img width='120'></button>tail", terminal);
  const positioned = terminal.querySelectorAll(".html-positioned");
  assert.equal(positioned.length, 3);
  assert.deepEqual(positioned.map((element) => element.dataset.htmlPosition), ["30", "30", "30"]);
  const check = () => {
    layoutHtmlPositions();
    assert.deepEqual(positioned.map((element) => element.getBoundingClientRect().left), [70, 70, 70]);
    assert.equal(terminal.children[0]!.children.at(-1)!.getBoundingClientRect().left, 190);
  };
  check();
  check();
  positioned[0]!.children[0]!.style.width = "180px";
  check();
  await renderHtml("<nobr><nonbutton pos='0'><img width='10'></nonbutton><nonbutton pos='400'><img width='20'></nonbutton><nonbutton pos='-100'><img width='30'></nonbutton>", terminal);
  layoutHtmlPositions();
  assert.deepEqual(terminal.querySelectorAll(".html-positioned").slice(-3).map((element) => element.getBoundingClientRect().left),
    [40, 160, 10]);
  await assert.rejects(renderHtml("<nonbutton pos='bad'>x</nonbutton>", terminal), /Unsupported HTML position/);
});

test("translated menu labels re-align locked borders after text and wrapper mutations", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("function layoutHtmlPositions(");
  const end = source.indexOf("/**", start);
  const terminal = new Element("DIV");
  const line = new Element("DIV");
  terminal.append(line);
  const label = new Element("SPAN");
  label.style.width = "80px";
  line.append(label);
  const border = new Element("SPAN");
  border.classes.add("html-positioned");
  border.dataset.htmlPosition = "200";
  border.style.width = "10px";
  line.append(border);
  let changed: (() => void) | undefined;
  let observed: unknown;
  const frames: (() => void)[] = [];
  const layout = runInNewContext(`${source.slice(start, end)}\nlayoutHtmlPositions`, {
    terminal,
    requestAnimationFrame: (callback: () => void) => { frames.push(callback); return frames.length; },
    MutationObserver: class {
      constructor(callback: () => void) { changed = callback; }
      observe(target: unknown, options: unknown) { assert.equal(target, terminal); observed = options; }
    },
  });
  assert.equal(JSON.stringify(observed), JSON.stringify({ childList: true, characterData: true, subtree: true }));
  layout();
  assert.equal(border.getBoundingClientRect().left, 240);
  // Translators expand text and may insert wrappers after the initial render.
  label.style.width = "150px";
  assert.equal(border.getBoundingClientRect().left, 310);
  changed!();
  changed!();
  assert.equal(frames.length, 1);
  frames.shift()!();
  assert.equal(border.getBoundingClientRect().left, 240);
  label.style.width = "35px";
  changed!();
  frames.shift()!();
  assert.equal(border.getBoundingClientRect().left, 240);
  layout();
  assert.equal(border.getBoundingClientRect().left, 240);
});
