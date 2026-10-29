import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { createCanvas, Image } from "@napi-rs/canvas";
import { decodePicture, pictureColor, rasterize } from "../src/graphics.js";
import { emptyGame, indexScript, type Game } from "../src/loader.js";
import { EraError } from "../src/model.js";
import { Runtime, type Picture, type RuntimeOptions } from "../src/runtime.js";
import { FileSaveStore, MemorySaveStore } from "../src/storage.js";

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
  ] };
  const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const section = source.slice(source.indexOf("function paintPicture("), source.indexOf("/**\n * Animation sprites:"));
  const browser = vm.runInNewContext(`${section}\npaintPicture`, {
    document: { createElement: () => createCanvas(1, 1) }, paintedPictures: new Map(),
    sourceImage: async (url: string) => { const image = new Image(); image.src = url; return image; },
  }) as (picture: Picture) => Promise<ReturnType<typeof createCanvas>>;
  const server = rasterize(picture, () => { throw new Error("Unexpected resource"); });
  const client = await browser(picture);
  for (const canvas of [server, client]) {
    const ctx = canvas.getContext("2d");
    assert.equal(ctx.getImageData(4, 4, 1, 1).data[3], 255);
    assert.equal(ctx.getImageData(9, 4, 1, 1).data[3], 0);
    assert.equal(ctx.getImageData(9, 9, 1, 1).data[3], 255);
    assert.equal(ctx.getImageData(4, 1, 1, 1).data[3], 0);
  }
});
