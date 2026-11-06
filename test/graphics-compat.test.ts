import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { createCanvas, Image } from "@napi-rs/canvas";
import { compactPicture, decodePicture, pictureColor, PixelCache, rasterize } from "../src/graphics.js";
import { emptyGame, indexScript, type Game } from "../src/loader.js";
import { EraError } from "../src/model.js";
import { Runtime, type Picture, type RuntimeOptions } from "../src/runtime.js";
import { FileSaveStore, MemorySaveStore } from "../src/storage.js";
import { cached, LruCache } from "../web/cache.js";

function run(source: string, options: RuntimeOptions = {}, configure?: (game: Game) => void) {
  const game = emptyGame();
  configure?.(game);
  indexScript(game, `@SYSTEM_TITLE\n${source}\nQUIT`, "graphics-independent.erb");
  const result = new Runtime(game, 50_000, options).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  return result.output.flatMap((line) => "text" in line ? [line.text] : []);
}

test("native-verified graphics reads unsigned ARGB, clipping and live sprite crops in both modes", () => {
  for (const jit of [false, true]) {
    const lines = run(`GCREATE 21, 12, 12
PRINTFORML PIX {GGETCOLOR(21, 0, 0)} {GGETCOLOR(99, 0, 0)} {GGETCOLOR(21, 12, 0)}
GSETCOLOR 21, 0xFF123456, 2, 3
PRINTFORML PIX {GGETCOLOR(21, 2, 3)} {GSETCOLOR(21, 0xFF000000, 20, 20)}
GSETBRUSH 21, 0xFF00AACC
GFILLRECTANGLE 21, 4, 4, 3, 2
PRINTFORML FILL {GGETCOLOR(21, 5, 5)} {GGETCOLOR(21, 7, 5)}
SPRITECREATE "P", 21, 2, 3, 8, 8
SPRITESETPOS "P", 5, 5
PRINTFORML SPR {SPRITEGETCOLOR("P", 0, 0)} {SPRITEGETCOLOR("P", -1, 0)} {SPRITEGETCOLOR("none", 0, 0)}
PRINTFORML DASH {GDASHSTYLE(21, 1, 0)} {GDASHSTYLE(99, 1, 0)}
GSETCOLOR 21, 0xFFABCDEF, 2, 3
PRINTFORML LIVE {SPRITEGETCOLOR("P", 0, 0)} {GGETCOLOR(21, 0, -1)}
GSETCOLOR 21, 0x01123456, 1, 1
GSETCOLOR 21, 0x00123456, 2, 1
PRINTFORML ALPHA {GGETCOLOR(21, 1, 1)} {GGETCOLOR(21, 2, 1)}
PRINTFORML ALPHASAVE {GSAVE(21, 28)} {GLOAD(23, 28)} {GGETCOLOR(23, 1, 1)} {GGETCOLOR(23, 2, 1)}
GDASHSTYLE 21, 2, 2
PRINTFORML CBG {CBGSETG(21, 0, 0, 1)} {CBGCLEAR()}`, { jit });
    assert.deepEqual(lines, [
      "PIX 0 -1 -1", "PIX 4279383126 0", "FILL 4278233804 0",
      "SPR 4279383126 -1 -1", "DASH 1 0", "LIVE 4289449455 -1",
      "ALPHA 17970262 1193046", "ALPHASAVE 1 1 17970262 0", "CBG 1 1",
    ]);
  }
});

test("graphics save real PNGs, survive runtime and file-store recreation, and refuse invalid loads", () => {
  const directory = path.resolve(`.graphics-test-${randomUUID()}`);
  mkdirSync(directory);
  try {
    for (const saves of [new MemorySaveStore(), new FileSaveStore(directory)]) {
      assert.deepEqual(run(`GCREATE 3, 7, 5
GSETCOLOR 3, 0xFF305070, 4, 2
PRINTFORML SAVE {GSAVE(3, 42)} {GSAVE(3, -1)} {GSAVE(3, 2147483648)} {GSAVE(99, 42)}
PRINTFORML LOAD {GLOAD(4, 42)} {GLOAD(4, 42)} {GGETCOLOR(4, 4, 2)}`, { saves }),
      ["SAVE 1 0 0 0", "LOAD 1 0 4281356400"]);
      const bytes = saves.read("img0042.png");
      assert.ok(Buffer.isBuffer(bytes));
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(decodePicture(bytes).height, 5);
      const restored = saves instanceof FileSaveStore ? new FileSaveStore(directory) : saves;
      assert.deepEqual(run(`PRINTFORML RELOAD {GLOAD(8, 42)} {GWIDTH(8)} {GHEIGHT(8)} {GGETCOLOR(8, 4, 2)}
PRINTFORML MISSING {GLOAD(9, 43)} {GCREATED(9)}`, { saves: restored }),
      ["RELOAD 1 7 5 4281356400", "MISSING 0 0"]);
      saves.write("img0043.png", Buffer.from("not an image"));
      assert.deepEqual(run("PRINTFORML BAD {GLOAD(9, 43)} {GCREATED(9)}", { saves }), ["BAD 0 0"]);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("readback replays copied pictures independently, resource images, rotations and masks", () => {
  const directory = path.resolve(`.graphics-test-${randomUUID()}`);
  mkdirSync(path.join(directory, "resources"), { recursive: true });
  const sample = createCanvas(4, 4), context = sample.getContext("2d");
  context.fillStyle = "#ff8040";
  context.fillRect(0, 0, 4, 4);
  writeFileSync(path.join(directory, "resources", "sample.png"), sample.toBuffer("image/png"));
  try {
    assert.deepEqual(run(`GCREATEFROMFILE 1, "sample.png"
PRINTFORML IMAGE {GGETCOLOR(1, 1, 2)}
PRINTFORML RESOURCE {SPRITEGETCOLOR("FILE", 0, 0)} {SPRITEGETCOLOR("FILE", 2, 0)}
GCREATE 2, 8, 8
GDRAWG 2, 1, 2, 2, 4, 4, 0, 0, 4, 4
GCLEAR 1, 0
PRINTFORML COPY {GGETCOLOR(2, 3, 3)} {GGETCOLOR(1, 1, 1)}
SPRITECREATE "CROP", 2, 2, 2, 2, 2
PRINTFORML CROP {SPRITEGETCOLOR("CROP", 1, 1)}`, {}, (game) => {
      game.root = directory;
      game.sprites.set("FILE", { file: "sample.png", x: 1, y: 1, width: 2, height: 2 });
    }), ["IMAGE 4294934592", "RESOURCE 4294934592 -1", "COPY 4294934592 0", "CROP 4294934592"]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  const red: Picture = { width: 4, height: 4, ops: [{ op: "fill", color: "#ff0000", rect: [0, 0, 4, 4] }] };
  const mask: Picture = { width: 4, height: 4, ops: [{ op: "fill", color: "#0000ff", rect: [0, 0, 2, 4] }] };
  const picture: Picture = { width: 8, height: 8, ops: [{ op: "mask", source: red, mask, x: 2, y: 1 }] };
  const noImages = () => { throw new Error("Unexpected resource"); };
  assert.equal(pictureColor(picture, 2, 2, noImages), 0xffff0000n);
  assert.equal(pictureColor(picture, 5, 2, noImages), 0n);
  const rotated: Picture = { width: 8, height: 8, ops: [
    { op: "rotate", angle: 90, x: 4, y: 4 },
    { op: "fill", color: "#0000ff", rect: [1, 1, 2, 2] },
    { op: "fill", color: "#00ff00", rect: [0, 0, 1, 1], replace: true, absolute: true },
  ] };
  assert.equal(pictureColor(rotated, 5, 1, noImages), 0xff0000ffn);
  assert.equal(pictureColor(rotated, 0, 0, noImages), 0xff00ff00n);
});

test("graphics persistence does not hide unexpected storage errors behind a missing-image return", () => {
  for (const command of ["GSAVE 1, 0", "GLOAD 2, 0"]) {
    const game = emptyGame();
    indexScript(game, `@SYSTEM_TITLE\nGCREATE 1, 2, 2\n${command}`, "storage-errors.erb");
    class BrokenSaveStore extends MemorySaveStore {
      override read(): never { throw new EraError("storage read failed"); }
      override write(): never { throw new EraError("storage write failed"); }
    }
    const snapshot = new Runtime(game, 50_000, { saves: new BrokenSaveStore() }).start();
    assert.equal(snapshot.status, "error");
    assert.match(snapshot.error!.message, /storage (read|write) failed/);
  }
});

test("browser and server paint pen-width-scaled dashed lines rather than solid fallbacks", async () => {
  const picture: Picture = { width: 48, height: 12, ops: [
    { op: "line", color: "#ff0000", width: 2, from: [2, 4], to: [42, 4], dashStyle: 1, dashCap: 0 },
    { op: "line", color: "#00ff00", width: 2, from: [2, 9], to: [42, 9] },
    { op: "line", color: "#0000ff", width: 2, from: [2, 1], to: [42, 1], dashStyle: 5 },
    { op: "pixels", colors: { [4 * 48 + 4]: 0, [1 * 48 + 4]: 0xff00ffff } },
  ] };
  const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const section = source.slice(source.indexOf("function paintPicture("), source.indexOf("/**\n * Animation sprites:"));
  const browser = vm.runInNewContext(`${section}\npaintPicture`, {
    document: { createElement: () => createCanvas(1, 1) }, cached, paintedPictures: new LruCache(32 * 1024 * 1024, 128),
    sourceImage: async (url: string) => { const image = new Image(); image.src = url; return image; },
  }) as (picture: Picture) => Promise<ReturnType<typeof createCanvas>>;
  const server = rasterize(picture, () => { throw new Error("Unexpected resource"); });
  const client = await browser(picture);
  for (const canvas of [server, client]) {
    const ctx = canvas.getContext("2d");
    assert.equal(ctx.getImageData(4, 4, 1, 1).data[3], 0);
    assert.equal(ctx.getImageData(9, 4, 1, 1).data[3], 0);
    assert.equal(ctx.getImageData(9, 9, 1, 1).data[3], 255);
    assert.deepEqual([...ctx.getImageData(4, 1, 1, 1).data], [0, 255, 255, 255]);
  }
});

test("pixel scans decode each resource once and compact writes preserve copied pictures", () => {
  const image = createCanvas(256, 256);
  image.getContext("2d").fillRect(0, 0, 256, 256);
  const bytes = image.toBuffer("image/png");
  let reads = 0;
  const resolve = () => { reads++; return bytes; };
  const picture: Picture = { width: 256, height: 256, ops: [
    { op: "image", url: "/resource.png", src: [0, 0, 256, 256], dest: [0, 0, 256, 256] },
  ] };
  const cache = new PixelCache();
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) assert.equal(pictureColor(picture, x, y, resolve, cache), 0xff000000n);
  assert.equal(reads, 1);
  assert.deepEqual(run(`GCREATE 1, 10, 10
GSETCOLOR 1, 0x01123456, 1, 1
GCREATE 2, 10, 10
GDRAWG 2, 1, 0, 0, 10, 10, 0, 0, 10, 10
GSETCOLOR 1, 0, 1, 1
PRINTFORML COPY {GGETCOLOR(2, 1, 1)} LIVE {GGETCOLOR(1, 1, 1)}`), ["COPY 17970262 LIVE 0"]);
});

test("matrix readback reuses the rasterized base while pixel batches grow and invalidates after drawing", () => {
  const image = createCanvas(32, 32);
  image.getContext("2d").fillRect(0, 0, 32, 32);
  const bytes = image.toBuffer("image/png");
  let reads = 0;
  const resolve = () => { reads++; return bytes; };
  const picture: Picture = { width: 32, height: 32, ops: [
    { op: "image", url: "/matrix.png", src: [0, 0, 32, 32], dest: [0, 0, 32, 32],
      matrix: [[1, 0, 0, 0, 0], [0, 1, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 1, 0], [0, 0, 0, 0, 1]] },
  ] };
  const cache = new PixelCache();
  const colors: Record<number, number> = {};
  picture.ops.push({ op: "pixels", colors });
  for (let x = 0; x < 32; x++) {
    assert.equal(pictureColor(picture, x, 0, resolve, cache), 0xff000000n);
    colors[x] = 0;
    assert.equal(pictureColor(picture, x, 0, resolve, cache), 0n);
  }
  assert.equal(reads, 1);
  picture.ops.push({ op: "fill", color: "rgba(255, 0, 0, 1)", rect: [0, 0, 1, 1], replace: true });
  assert.equal(pictureColor(picture, 0, 0, resolve, cache), 0xffff0000n);
  assert.equal(reads, 2);
});

const twOutline = new URL("../GAMES/anon-tw-anon-tw_eng-modding/ERB/ステータス表示関連/縁取り.ERB", import.meta.url);
for (const jit of [false, true]) test(`AnonTW's original image-border routine stays within the serialized output limit (JIT ${jit})`, { skip: !existsSync(twOutline) }, () => {
  const game = emptyGame();
  indexScript(game, readFileSync(twOutline, "utf8"), "tw-outline.erb");
  indexScript(game, `@GET_EMPTY_G(WIDTH, HEIGHT)
#FUNCTION
#DIM WIDTH
#DIM HEIGHT
#DIM INDEX
FOR INDEX, 2, 100
 IF !GCREATED(INDEX)
  GCREATE INDEX, WIDTH, HEIGHT
  RETURNF INDEX
 ENDIF
NEXT
THROW No free graphics
@SYSTEM_TITLE
GCREATE 1, 256, 256
GSETBRUSH 1, 0x01123456
GFILLRECTANGLE 1, 0, 0, 256, 256
GSETCOLOR 1, 0xFFFFFFFF, 128, 128
SPRITECREATE "TEST", 1
LOCAL = OUTLINE_SPR("TEST", 0x88FFFF00)
PRINTFORML CENTER {GGETCOLOR(LOCAL, 128, 128)} CLEAR {GGETCOLOR(LOCAL, 0, 0)}
SPRITECREATE "OUTLINED", LOCAL
HTML_PRINT "<img src='OUTLINED'>"
CBGSETG LOCAL, 0, 0, 1
QUIT`, "outline-regression.erb");
  const started = performance.now();
  const snapshot = new Runtime(game, 5_000_000, { jit }).start();
  assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
  assert.ok(performance.now() - started < 5000, "256x256 image border must finish within five seconds");
  assert.match(JSON.stringify(snapshot.output), /CENTER 4294967295 CLEAR 0/);
  assert.ok(JSON.stringify(snapshot.output).length < 2_000_000, "HTML_PRINT must include the sprite without exceeding its budget");
  const html = snapshot.output.find((line) => line.type === "html");
  assert.ok(html && "sprites" in html && html.sprites?.OUTLINED);
  assert.equal(pictureColor(html.sprites.OUTLINED.picture, 128, 128, () => { throw new Error("Unexpected resource"); }), 0xffffffffn);
  const graphics = snapshot.cbg![0]!.picture!;
  const count = (picture: Picture): number => picture.ops.reduce((n, op) =>
    n + 1 + (op.op === "graphics" ? count(op.source) : op.op === "mask" ? count(op.source) + count(op.mask) : 0), 0);
  assert.ok(count(graphics) < 100, "Pixel cleanup must not generate 65,536 fill operations");
});

test("large graphics snapshots preserve pixels, copies and drawing transforms", () => {
  const resolve = () => { throw new Error("Unexpected resource"); };
  const small: Picture = { width: 2, height: 2, ops: [
    { op: "fill", color: "rgba(255, 0, 0, 1)", rect: [0, 0, 2, 2] },
  ] };
  assert.equal(compactPicture(small, resolve), small, "small pictures keep their paint operations");
  const colors: Record<number, number> = Object.fromEntries(Array.from({ length: 128 * 128 }, (_, i) => [i, 0xff123456]));
  colors[0] = 0x01123456;
  colors[1] = 0;
  const large: Picture = { width: 128, height: 128, ops: [{ op: "pixels", colors }] };
  assert.ok(JSON.stringify(large).length > 64 * 1024);
  const compact = compactPicture(large, resolve);
  assert.ok(JSON.stringify(compact).length < 64 * 1024);
  assert.equal(compact.ops[0]?.op, "image");
  for (const [x, color] of [[0, 0x01123456n], [1, 0n], [2, 0xff123456n]] as const)
    assert.equal(pictureColor(compact, x, 0, resolve), color);
  colors[2] = 0;
  assert.equal(pictureColor(compact, 2, 0, resolve), 0xff123456n, "later pixel writes do not change captured PNGs");
  assert.equal(large.ops[0]?.op, "pixels", "compaction does not change the live canvas");

  for (const jit of [false, true]) {
    const game = emptyGame();
    indexScript(game, `@SYSTEM_TITLE
GCREATE 1, 8, 8
GCLEAR 1, 0xFFFF0000
REPEAT 16
 GDRAWG 1, 1, 0, 0, 8, 8, 0, 0, 8, 8
REND
SPRITECREATE "COPY", 1
HTML_PRINT "<img src='COPY'>"
GCLEAR 1, 0xFF0000FF
PRINTFORML LIVE {GGETCOLOR(1, 0, 0)}
GCREATE 2, 8, 8
GDRAWGWITHROTATE 2, 1, 90, 4, 4
REPEAT 800
 GFILLRECTANGLE 2, 0, 0, 0, 0
REND
SPRITECREATE "ROTATED", 2
HTML_PRINT "<img src='ROTATED'>"
GSETBRUSH 2, 0xFF00FF00
GFILLRECTANGLE 2, 1, 1, 1, 1
PRINTFORML TRANSFORM {GGETCOLOR(2, 6, 1)} {GGETCOLOR(2, 1, 1)}
QUIT`, "compact-copies.erb");
    const snapshot = new Runtime(game, 50_000, { jit }).start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.ok(JSON.stringify(snapshot.output).length < 2_000_000);
    assert.match(JSON.stringify(snapshot.output), /LIVE 4278190335/);
    assert.match(JSON.stringify(snapshot.output), /TRANSFORM 4278255360 4278190335/);
    const html = snapshot.output.find((line) => line.type === "html");
    assert.ok(html && "sprites" in html && html.sprites?.COPY);
    assert.equal(pictureColor(html.sprites.COPY.picture, 0, 0, resolve), 0xffff0000n);
  }
});
