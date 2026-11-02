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

test("summer and autumn panoramas retain full spring foliage and transparency with distinct palettes", async () => {
  for (const part of ["left", "middle", "right"]) {
    const root = new URL("../web/areas/0-shrine/", import.meta.url);
    const spring = decodePng(await readFile(new URL(`spring-day-${part}.png`, root)));
    const variants = [spring.data];
    for (const season of ["summer", "autumn"]) {
      const variant = decodePng(await readFile(new URL(`${season}-day-${part}.png`, root)));
      assert.equal(variant.width, spring.width);
      assert.equal(variant.height, spring.height);
      let changed = 0, visible = 0;
      for (let i = 0; i < spring.data.length; i += 4) {
        assert.equal(variant.data[i + 3], spring.data[i + 3], `${season}/${part} alpha at ${i / 4}`);
        if (!spring.data[i + 3]) continue;
        visible++;
        if (variant.data[i] !== spring.data[i] || variant.data[i + 1] !== spring.data[i + 1] || variant.data[i + 2] !== spring.data[i + 2]) changed++;
      }
      assert.ok(changed / visible > .1, `${season}/${part} visibly changes the palette`);
      for (const previous of variants) assert.notDeepEqual(variant.data, previous);
      variants.push(variant.data);
    }
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
      if (part === "right" && season !== "winter") {
        const lantern = (75 * night.width + 92) * 4;
        assert.ok(night.data[lantern]! > 150 && night.data[lantern]! > night.data[lantern + 2]! * 2,
          `${season} keeps the lantern warmly lit`);
      }
      if (part === "right" && season === "winter") {
        let warm = 0;
        for (let i = 0; i < night.data.length; i += 4)
          if (night.data[i + 3] && night.data[i]! > 150 && night.data[i]! > night.data[i + 2]! * 1.5) warm++;
        assert.ok(warm > 10, "winter shrine windows remain warmly lit");
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
