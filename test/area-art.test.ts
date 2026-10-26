import assert from "node:assert/strict";
import { test } from "node:test";
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
