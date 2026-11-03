import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { decodePng, encodePng, prepareAreaArt, snapToGrid, type Picture } from "../src/area-art.js";

/** A picture of the given size with an opaque rectangle (each pixel's red channel its x) and nothing elsewhere. */
function picture(width: number, height: number, box: { left: number; top: number; right: number; bottom: number }): Picture {
  const data = new Uint8Array(width * height * 4);
  for (let y = box.top; y <= box.bottom; y++) for (let x = box.left; x <= box.right; x++) data.set([x, 10, 20, 255], (y * width + x) * 4);
  return { width, height, data };
}

test("PNG pictures survive encoding and decoding", () => {
  const original = picture(7, 5, { left: 1, top: 2, right: 5, bottom: 4 });
  assert.deepEqual(decodePng(encodePng(original)), original);
});

for (const [area, width] of [["1-temple", 571], ["2-village", 463], ["3-mansion", 532], ["4-bamboo", 480], ["5-forest", 439], ["6-netherworld", 532], ["7-foothills", 559], ["8-summit", 539], ["9-underworld", 432], ["10-moon", 339]] as const)
test(`${area} panoramas have aligned transparent day/night artwork and appropriate lighting`, async () => {
  const root = new URL(`../web/areas/${area}/`, import.meta.url);
  const season = ["6-netherworld", "9-underworld", "10-moon"].includes(area) ? "neutral" : "spring";
  for (const part of ["left", "middle", "right"]) {
    const day = decodePng(await readFile(new URL(`${season}-day-${part}.png`, root)));
    const night = decodePng(await readFile(new URL(`${season}-night-${part}.png`, root)));
    const expectedWidth = area === "9-underworld" ? { left: 360, middle: 294, right: 596 }[part]
      : area === "10-moon" ? { left: 339, middle: 277, right: 384 }[part]
      : area === "7-foothills" && part === "middle" ? 511 : width;
    assert.equal(day.width, expectedWidth);
    assert.equal(day.height, 144);
    assert.equal(night.width, day.width);
    assert.equal(night.height, day.height);
    let clear = 0, bottom = 0, dayLight = 0, nightLight = 0;
    for (let i = 0; i < day.data.length; i += 4) {
      const x = (i / 4) % day.width;
      const join = (area === "7-foothills" && (part === "left" ? x >= day.width - 96
        : part === "right" ? x < 96 : x < 48))
        || (area === "8-summit" && (part === "left" ? x >= day.width - 64 : part === "right" && x < 64))
        || (area === "10-moon" && (part === "left" ? x >= day.width - 32 : x < (part === "right" ? 32 : 24)))
        || (area === "9-underworld" && (part === "left" ? x >= day.width - 48 : part === "right" && x < 48));
      if (!join && area !== "9-underworld") assert.ok(day.data[i + 3] === 0 || day.data[i + 3] === 255, "faint alpha residue is removed");
      assert.equal(night.data[i + 3], day.data[i + 3], "night and weather blends stay aligned");
      if (!day.data[i + 3]) { clear++; continue; }
      dayLight += day.data[i]! + day.data[i + 1]! + day.data[i + 2]!;
      nightLight += night.data[i]! + night.data[i + 1]! + night.data[i + 2]!;
    }
    if (area !== "9-underworld") assert.ok(clear / (day.width * day.height) > .3, `${part} leaves transparent sky`);
    assert.ok(nightLight / dayLight > .2 && nightLight / dayLight < .6, `${part} legible night palette`);
    for (let x = 0; x < day.width; x++) if (day.data[(143 * day.width + x) * 4 + 3]) bottom++;
    assert.ok(bottom / day.width > .9, `${part} ground reaches the baseline`);
    if (area === "9-underworld") {
      let ceiling = 0;
      for (let x = 0; x < day.width; x++) {
        let rock = 0;
        for (let y = 0; y < 40; y++)
          if (day.data[(y * day.width + x) * 4 + 3] === 255) rock++;
        if (rock >= 3) ceiling++;
      }
      assert.ok(ceiling >= day.width - 48, `${part} retains the painted cavern ceiling outside the joining fade`);
      assert.ok(day.data[(60 * day.width + day.width - 60) * 4 + 3]! > 0, "painted cavern depth retains coverage");
    } else assert.equal(day.data[(10 * day.width + day.width - 30) * 4 + 3], 0);
    const lights = area === "1-temple"
      ? part === "right" ? [[194, 91, 217, 106], [276, 91, 299, 106]]
        : part === "left" ? [[133, 95, 143, 103]] : []
      : area === "2-village"
        ? part === "right" ? [[135, 113, 143, 123], [218, 113, 225, 123], [281, 117, 296, 130]] : []
        : area === "3-mansion" && part === "right" ? [[303, 65, 316, 78], [238, 90, 245, 97]]
          : area === "5-forest" && part === "right" ? [[206, 99, 213, 108]]
            : area === "6-netherworld" && part === "right" ? [[348, 87, 378, 105]]
              : area === "7-foothills" && part === "right" ? [[401, 72, 408, 83]]
                : area === "9-underworld" ? part === "left" ? [[140, 55, 160, 80]]
                  : part === "right" ? [[201, 67, 233, 91], [149, 93, 167, 109]] : []
                  : area === "10-moon" ? part === "left" ? [[75, 80, 90, 102], [175, 80, 190, 102]]
                    : part === "right" ? [[150, 68, 201, 88], [110, 85, 128, 106], [232, 85, 250, 106]] : [] : [];
    for (const [left, top, right, bottom] of lights) {
      let warm = 0;
      for (let y = top!; y < bottom!; y++) for (let x = left!; x < right!; x++) {
        const i = (y * night.width + x) * 4;
        if (night.data[i + 3] && night.data[i]! > 150 && night.data[i]! > night.data[i + 2]! * 1.5) warm++;
      }
      assert.ok(warm > 2, `${part} warm light`);
    }
  }
});

test("Underworld depth is translucent while foreground stays opaque and joins stay aligned", async () => {
  for (const phase of ["day", "night"]) for (const part of ["left", "middle", "right"]) {
    const art = decodePng(await readFile(new URL(`../web/areas/9-underworld/neutral-${phase}-${part}.png`, import.meta.url)));
    let translucent = 0;
    for (let y = 0; y < art.height; y++) for (let x = 0; x < art.width; x++) {
      const distance = part === "left" ? art.width - 1 - x : part === "right" ? x : 48;
      const t = Math.min(1, distance / 47);
      const alpha = art.data[(y * art.width + x) * 4 + 3]!;
      const joinAlpha = Math.round(255 * t * t * (3 - 2 * t));
      assert.ok(alpha <= joinAlpha && alpha >= Math.round(joinAlpha * .35) - 1);
      const doorway = part === "left" && x > 58 && x < 91 && y > 42 && y < 99;
      if (y <= 35 || y >= 120 || (part === "left" && x <= 220 && !doorway)
        || (part === "right" && x >= 65)
        || art.data[(y * art.width + x) * 4]! > 80)
        assert.equal(alpha, joinAlpha, "foreground and architecture alpha is unchanged");
      else if (alpha < joinAlpha && distance >= 48) translucent++;
    }
    if (part !== "right") assert.ok(translucent > 1000, "distant tunnels transmit the background");
    if (part === "middle") {
      const pixel = (85 * art.width + 160) * 4;
      const alpha = art.data[pixel + 3]! / 255;
      const nightBackground = [9, 10, 29];
      const dayBackground = [179, 197, 255];
      for (let c = 0; c < 3; c++) {
        assert.equal(art.data[pixel + c], nightBackground[c], "deep tunnel has the exact night background colour");
        const nightComposite = art.data[pixel + c]! * alpha + nightBackground[c]! * (1 - alpha);
        assert.equal(Math.round(nightComposite), nightBackground[c], "tunnel detail vanishes into the night background");
        const dayComposite = art.data[pixel + c]! * alpha + dayBackground[c]! * (1 - alpha);
        assert.ok(Math.abs(dayComposite - [111, 122, 169][c]!) < 12, "midday fog retains a pale blue-lavender colour");
      }
      let difference = 0;
      for (let y = 0; y < art.height; y++) for (let c = 0; c < 4; c++)
        difference += Math.abs(art.data[y * art.width * 4 + c]! - art.data[(y * art.width + art.width - 1) * 4 + c]!);
      assert.ok(difference / (art.height * 4) < 10, "repeating ceiling and floor have a softened seam");
    }
  }
});

test("Underworld doorway depth is subtle while palace and far-right shading stay opaque", async () => {
  for (const part of ["left", "right"]) {
    const day = decodePng(await readFile(new URL(`../web/areas/9-underworld/neutral-day-${part}.png`, import.meta.url)));
    const night = decodePng(await readFile(new URL(`../web/areas/9-underworld/neutral-night-${part}.png`, import.meta.url)));
    const samples = part === "left" ? [[65, 65], [70, 80]] : [];
    for (const [x, y] of samples) {
      const i = (y! * day.width + x!) * 4;
      for (const art of [day, night]) {
        assert.deepEqual([...art.data.slice(i, i + 3)], [9, 10, 29], "side depth matches the night background");
        const alpha = art.data[i + 3]! / 255;
        assert.ok(alpha > .8 && alpha < .97, "side transparency remains subtler than the central tunnels");
        assert.ok(Math.round(29 * alpha + 255 * (1 - alpha)) > 40, "side depth responds to daytime and storm light");
      }
      if (part === "right") for (const [x, y] of [[300, 55], [480, 80], [550, 70]]) {
        const i = (y! * day.width + x!) * 4;
        assert.equal(day.data[i + 3], 255);
        assert.equal(night.data[i + 3], 255);
        assert.notDeepEqual([...day.data.slice(i, i + 3)], [9, 10, 29], "original painted shading is retained");
      }
      assert.equal(day.data[i + 3], night.data[i + 3]);
    }
    const lights = part === "left" ? [[150, 60]] : [[210, 80], [270, 105]];
    for (const [x, y] of lights) {
      const i = (y! * day.width + x!) * 4;
      assert.equal(day.data[i + 3], 255);
      assert.equal(night.data[i + 3], 255);
    }
  }
});

test("Moon ground joins are continuous and its horizon has no saturated matte fringe", async () => {
  for (const phase of ["day", "night"]) for (const part of ["left", "middle", "right"]) {
    const art = decodePng(await readFile(new URL(`../web/areas/10-moon/neutral-${phase}-${part}.png`, import.meta.url)));
    for (let y = 116; y < art.height; y++) for (let x = 0; x < art.width; x++) {
      const distance = part === "left" ? art.width - 1 - x : part === "right" ? x : 32;
      const t = Math.min(1, distance / 31);
      assert.equal(art.data[(y * art.width + x) * 4 + 3], Math.round(255 * t * t * (3 - 2 * t)), "ground is opaque except at feathered joins");
    }
    for (let i = 0; i < art.data.length; i += 4) {
      if (!art.data[i + 3]) continue;
      const r = art.data[i]!, g = art.data[i + 1]!, b = art.data[i + 2]!;
      assert.ok(!(b > 150 && b > r * 1.6 && b > g * 1.5), "no blue matte");
      assert.ok(!(r > 150 && b > 150 && g < Math.min(r, b) * .65), "no magenta matte");
    }
    if (part === "middle") {
      let difference = 0;
      for (let y = 0; y < art.height; y++) for (let c = 0; c < 4; c++)
        difference += Math.abs(art.data[(y * art.width) * 4 + c]! - art.data[(y * art.width + art.width - 1) * 4 + c]!);
      assert.ok(difference / (art.height * 4) < 4, "repeated tile has no abrupt colour/alpha jump");
    }
  }
});

test("foothill middle retains complete original cherry crowns without erased patches", async () => {
  const art = decodePng(await readFile(new URL("../web/areas/7-foothills/spring-day-middle.png", import.meta.url)));
  for (const [left, right] of [[115, 185], [355, 425]]) {
    let blossoms = 0;
    for (let y = 65; y < 115; y++) for (let x = left!; x < right!; x++) {
      const i = (y * art.width + x) * 4;
      if (art.data[i + 3] && art.data[i]! > 160 && art.data[i + 2]! > 110 && art.data[i]! > art.data[i + 1]! * 1.15) blossoms++;
    }
    assert.ok(blossoms > 150, "original cherry canopy is intact");
  }
});

test("foothill end panels blend into the middle without a hard vertical cut", async () => {
  for (const time of ["day", "night"]) for (const part of ["left", "right"]) {
    const art = decodePng(await readFile(new URL(`../web/areas/7-foothills/spring-${time}-${part}.png`, import.meta.url)));
    const edge = part === "left" ? art.width - 1 : 0;
    for (let y = 0; y < art.height; y++) assert.equal(art.data[(y * art.width + edge) * 4 + 3], 0);
    const inward = part === "left" ? art.width - 49 : 48;
    const alpha = art.data[(143 * art.width + inward) * 4 + 3]!;
    assert.ok(alpha > 100 && alpha < 160, "ground feathers gradually through the joining region");
  }
});

for (const area of ["4-bamboo", "5-forest"])
test(`${area} foliage has no neon green matte residue`, async () => {
  for (const part of ["left", "middle", "right"]) {
    const art = decodePng(await readFile(new URL(`../web/areas/${area}/spring-day-${part}.png`, import.meta.url)));
    for (let i = 0; i < art.data.length; i += 4) {
      if (!art.data[i + 3]) continue;
      const r = art.data[i]!, g = art.data[i + 1]!, b = art.data[i + 2]!;
      assert.ok(!(g > 175 && g > r * 2.2 && g > b * 2.2), `${part} clean foliage edge`);
    }
  }
});

test("imported summer artwork has clean sky, aligned ground and softened joins", async () => {
  const root = new URL("../web/areas/0-shrine/", import.meta.url);
  for (const time of ["day", "night"]) {
    for (const [part, width] of [["left", 480], ["middle", 481], ["right", 524]] as const) {
      const art = decodePng(await readFile(new URL(`summer-${time}-${part}.png`, root)));
      assert.equal(art.width, width);
      assert.equal(art.height, 144);
      let clear = 0, bottom = 0, green = 0;
      for (let i = 0; i < art.data.length; i += 4) {
        const x = (i / 4) % width;
        const tapered = part === "left" ? x >= width - 64 : part === "right" ? x < 64 : x >= width - 48;
        if (!tapered) assert.ok(art.data[i + 3] === 0 || art.data[i + 3] === 255, "sky away from the join stays clean");
        if (!art.data[i + 3]) { clear++; continue; }
        if (art.data[i + 1]! > art.data[i]! * 1.15 && art.data[i + 1]! > art.data[i + 2]!) green++;
      }
      assert.ok(clear / (width * 144) > .3, `${time}/${part} clear sky`);
      assert.ok(green > 500, `${time}/${part} green summer foliage`);
      for (let x = 0; x < width; x++) if (art.data[(143 * width + x) * 4 + 3]) bottom++;
      assert.ok(bottom / width > .9, `${time}/${part} ground reaches the baseline`);
      assert.equal(art.data[(10 * width + 450) * 4 + 3], 0);
      if (part !== "middle") {
        const edge = part === "left" ? width - 1 : 0;
        for (let y = 0; y < 144; y++) assert.equal(art.data[(y * width + edge) * 4 + 3], 0, "side joins reveal the backdrop");
      } else {
        let difference = 0;
        for (let y = 0; y < 144; y++) for (let channel = 0; channel < 4; channel++)
          difference += Math.abs(art.data[(y * width) * 4 + channel]! - art.data[(y * width + width - 1) * 4 + channel]!);
        assert.ok(difference / (144 * 4) < 12, "tile boundary has no abrupt colour/alpha jump");
      }
    }
  }
});

test("imported autumn artwork has a transparent sky, aligned ground and warm fall foliage", async () => {
  const root = new URL("../web/areas/0-shrine/", import.meta.url);
  for (const time of ["day", "night"]) for (const part of ["left", "middle", "right"]) {
    const art = decodePng(await readFile(new URL(`autumn-${time}-${part}.png`, root)));
    assert.equal(art.width, 520);
    assert.equal(art.height, 144);
    let clear = 0, bottom = 0, warm = 0;
    for (let i = 0; i < art.data.length; i += 4) {
      assert.ok(art.data[i + 3] === 0 || art.data[i + 3] === 255, "hard alpha preserves pixel edges");
      if (!art.data[i + 3]) { clear++; continue; }
      assert.ok(Math.min(art.data[i]!, art.data[i + 1]!, art.data[i + 2]!) < 221, "white background is removed");
      if (art.data[i]! > art.data[i + 1]! * 1.3 && art.data[i + 1]! > art.data[i + 2]! * 1.3) warm++;
    }
    assert.ok(clear / (art.width * art.height) > .3, `${time}/${part} leaves room for the sky`);
    assert.ok(warm > 300, `${time}/${part} retains orange/red leaves`);
    for (let x = 0; x < art.width; x++) if (art.data[((143 * art.width + x) * 4) + 3]) bottom++;
    assert.ok(bottom / art.width > .9, `${time}/${part} ground reaches the baseline`);
    assert.equal(art.data[(10 * art.width + 400) * 4 + 3], 0);
  }
});

test("imported winter artwork is resized, ground-aligned and free of faint sky residue", async () => {
  const root = new URL("../web/areas/0-shrine/", import.meta.url);
  for (const time of ["day", "night"]) {
    for (const [part, width] of [["left", 500], ["middle", 501], ["right", 501]] as const) {
      const winter = decodePng(await readFile(new URL(`winter-${time}-${part}.png`, root)));
      assert.equal(winter.width, width);
      assert.equal(winter.height, 144);
      let clear = 0, bottom = 0;
      for (let i = 3; i < winter.data.length; i += 4) {
        assert.ok(winter.data[i] === 0 || winter.data[i] === 255, "hard alpha removes faint background residue");
        if (!winter.data[i]) clear++;
      }
      assert.ok(clear / (width * 144) > .3, `${part} leaves room for the sky`);
      for (let x = 0; x < width; x++) if (winter.data[((143 * width + x) * 4) + 3]) bottom++;
      assert.ok(bottom / width > .5, `${part} ground reaches the common baseline`);
      const sky = (10 * width + 400) * 4;
      assert.equal(winter.data[sky + 3], 0, `${part} clear upper sky`);
    }
    const right = decodePng(await readFile(new URL(`winter-${time}-right.png`, root)));
    for (const [name, x0, y0, x1, y1] of [["torii", 65, 45, 160, 65], ["roof", 175, 65, 270, 90]] as const) {
      let snow = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * right.width + x) * 4;
        if (right.data[i + 3] && right.data[i + 1]! > (time === "day" ? 190 : 90)
          && right.data[i + 2]! >= right.data[i]!) snow++;
      }
      assert.ok(snow > 30, `${time} snow visible on ${name}`);
    }
  }
});

test("shrine night panoramas preserve each season's geometry and transparency with darker moonlit palettes", async () => {
  const root = new URL("../web/areas/0-shrine/", import.meta.url);
  for (const season of ["spring", "summer", "autumn", "winter"]) {
    for (const part of ["left", "middle", "right"]) {
      const day = decodePng(await readFile(new URL(`${season}-day-${part}.png`, root)));
      const night = decodePng(await readFile(new URL(`${season}-night-${part}.png`, root)));
      assert.equal(night.width, day.width);
      assert.equal(night.height, day.height);
      let dayLight = 0, nightLight = 0;
      for (let i = 0; i < day.data.length; i += 4) {
        assert.equal(night.data[i + 3], day.data[i + 3], `${season}/${part} alpha at ${i / 4}`);
        if (!day.data[i + 3]) continue;
        dayLight += .2126 * day.data[i]! + .7152 * day.data[i + 1]! + .0722 * day.data[i + 2]!;
        nightLight += .2126 * night.data[i]! + .7152 * night.data[i + 1]! + .0722 * night.data[i + 2]!;
      }
      assert.ok(nightLight / dayLight > .2 && nightLight / dayLight < .6, `${season}/${part} is darker but legible`);
      if (part === "right" && season === "spring") {
        const lantern = (75 * night.width + 92) * 4;
        assert.ok(night.data[lantern]! > 150 && night.data[lantern]! > night.data[lantern + 2]! * 2,
          `${season} keeps the lantern warmly lit`);
      }
      if (part === "right" && ["summer", "autumn", "winter"].includes(season)) {
        let warm = 0;
        for (let i = 0; i < night.data.length; i += 4)
          if (night.data[i + 3] && night.data[i]! > 150 && night.data[i]! > night.data[i + 2]! * 1.5) warm++;
        assert.ok(warm > 10, `${season} shrine windows remain warmly lit`);
      }
    }
  }
});

test("PNG decoding undoes every row filter and expands RGB to RGBA", () => {
  // Two RGB rows of two pixels: Sub, then Paeth.
  const rows = [1, 10, 20, 30, 5, 5, 5, 4, 1, 1, 1, 2, 2, 2];
  const head = Buffer.alloc(13);
  head.writeUInt32BE(2, 0); head.writeUInt32BE(2, 4); head[8] = 8; head[9] = 2;
  const chunk = (type: string, body: Buffer) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0); out.write(type, 4, "latin1"); body.copy(out, 8);
    return out;
  };
  const file = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head),
    chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
  assert.deepEqual([...decodePng(file).data], [10, 20, 30, 255, 15, 25, 35, 255, 11, 21, 31, 255, 17, 27, 37, 255]);
});

test("pixel art is snapped to one pixel per block, with hard alpha", () => {
  const big = picture(8, 4, { left: 0, top: 0, right: 3, bottom: 3 });
  big.data[3] = 40; // one stray translucent pixel does not change its block
  big.data.set([0, 0, 0, 30], (0 * 8 + 6) * 4); // faint noise in an empty block is dropped
  const small = snapToGrid(big, 4);
  assert.equal(small.width, 2);
  assert.equal(small.height, 1);
  assert.deepEqual([...small.data], [2, 10, 20, 255, 0, 0, 0, 0]);
});

test("area pictures share a height and stand on their bottom edges", () => {
  const art = prepareAreaArt({
    left: picture(40, 40, { left: 0, top: 8, right: 27, bottom: 31 }),
    middle: picture(40, 40, { left: 0, top: 20, right: 39, bottom: 35 }),
    right: picture(40, 40, { left: 8, top: 4, right: 35, bottom: 23 }),
  }, 4);
  assert.deepEqual([art.left.width, art.middle.width, art.right.width], [7, 10, 7]);
  assert.deepEqual([art.left.height, art.middle.height, art.right.height], [6, 6, 6]);
  const alpha = (p: Picture, x: number, y: number) => p.data[(y * p.width + x) * 4 + 3];
  assert.equal(alpha(art.left, 0, 0), 255);
  assert.equal(alpha(art.left, 0, 5), 255);
  assert.equal(alpha(art.right, 0, 0), 0);
  assert.equal(alpha(art.right, 0, 1), 255);
  assert.equal(alpha(art.middle, 0, 1), 0);
  assert.equal(alpha(art.middle, 0, 2), 255);
});
