/**
 * Imports a set of main-screen header pictures for an area (see docs/hotpatches.md, "Area pictures"):
 *
 *   npm run area-art -- <area dir> <season> <day|night> <left.png> <middle.png> <right.png> [--block <px>]
 *
 * e.g. `npm run area-art -- 0-shrine spring day left.png middle.png right.png`. The pictures are pixel art drawn
 * large (each art pixel a block of about --block screen pixels, 4 by default), so each is snapped back to its own
 * pixel grid (one colour per block, the median; alpha either fully on or off), the three are cropped to a common
 * height standing on the same ground line (their bottom edges), the left and right ones trimmed to their content,
 * and written as web/areas/<area dir>/<season>-<day|night>-<left|middle|right>.png. The browser shows them at one
 * art pixel per CSS pixel, scaled with nearest-neighbour. The middle one is tiled, so keep its width a multiple of
 * the block size.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync, inflateSync } from "node:zlib";

export interface Picture { width: number; height: number; data: Uint8Array }

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decodes an 8-bit, non-interlaced RGB, RGBA, grey or grey+alpha PNG to RGBA. */
export function decodePng(file: Uint8Array): Picture {
  const buffer = Buffer.from(file);
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("Not a PNG file");
  let width = 0, height = 0, colorType = 0;
  const idat: Buffer[] = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString("latin1", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); colorType = body[9]!;
      if (body[8] !== 8 || body[12] !== 0 || ![0, 2, 4, 6].includes(colorType))
        throw new Error("Only 8-bit, non-interlaced grey, RGB or RGBA PNGs are supported");
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]!;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!, line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride, above = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[row + x - channels]! : 0, b = y ? pixels[above + x]! : 0;
      const c = x >= channels && y ? pixels[above + x - channels]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`Bad PNG filter ${filter}`);
      pixels[row + x] = (line[x]! + predictor) & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const source = pixels.subarray(i * channels, (i + 1) * channels);
    const grey = channels < 3;
    data[i * 4] = source[0]!;
    data[i * 4 + 1] = grey ? source[0]! : source[1]!;
    data[i * 4 + 2] = grey ? source[0]! : source[2]!;
    data[i * 4 + 3] = channels === 2 ? source[1]! : channels === 4 ? source[3]! : 255;
  }
  return { width, height, data };
}

/** Encodes RGBA pixels as a PNG. */
export function encodePng({ width, height, data }: Picture): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** One pixel per block×block square: the median of each channel, with the alpha made fully on or off. */
export function snapToGrid(picture: Picture, block: number): Picture {
  const width = Math.floor(picture.width / block), height = Math.floor(picture.height / block);
  const data = new Uint8Array(width * height * 4);
  const values: number[][] = [[], [], [], []];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    for (const list of values) list.length = 0;
    for (let dy = 0; dy < block; dy++) for (let dx = 0; dx < block; dx++) {
      const i = ((y * block + dy) * picture.width + x * block + dx) * 4;
      for (let c = 0; c < 4; c++) values[c]!.push(picture.data[i + c]!);
    }
    const median = values.map((list) => list.sort((a, b) => a - b)[list.length >> 1]!);
    const o = (y * width + x) * 4;
    if (median[3]! >= 128) data.set([median[0]!, median[1]!, median[2]!, 255], o);
  }
  return { width, height, data };
}

/** The smallest rectangle holding every visible pixel. */
export function contentBounds({ width, height, data }: Picture) {
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < 0) throw new Error("The picture is empty");
  return { left, right, top, bottom };
}

/** Copies the given rectangle; rows above the picture come out transparent. */
export function crop(picture: Picture, left: number, top: number, width: number, height: number): Picture {
  const data = new Uint8Array(width * height * 4);
  for (let y = Math.max(0, -top); y < height; y++) {
    const from = ((top + y) * picture.width + left) * 4;
    data.set(picture.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { width, height, data };
}

/** Snaps the three parts to the art's pixel grid and crops them to a shared height above a shared ground line. */
export function prepareAreaArt(parts: { left: Picture; middle: Picture; right: Picture }, block: number) {
  const snapped = Object.fromEntries(Object.entries(parts).map(([name, picture]) => [name, snapToGrid(picture, block)])) as typeof parts;
  const bounds = Object.fromEntries(Object.entries(snapped).map(([name, picture]) => [name, contentBounds(picture)])) as Record<keyof typeof parts, ReturnType<typeof contentBounds>>;
  const height = Math.max(...Object.values(bounds).map((box) => box.bottom - box.top + 1));
  const part = (name: keyof typeof parts, whole: boolean) => {
    const box = bounds[name], left = whole ? 0 : box.left, width = whole ? snapped[name].width : box.right - box.left + 1;
    return crop(snapped[name], left, box.bottom - height + 1, width, height);
  };
  return { left: part("left", false), middle: part("middle", true), right: part("right", false) };
}

const SEASONS = ["spring", "summer", "autumn", "winter"];

async function main(args: string[]): Promise<void> {
  let block = 4;
  const blockAt = args.indexOf("--block");
  if (blockAt >= 0) {
    block = Number(args[blockAt + 1]);
    args.splice(blockAt, 2);
  }
  const [area, season, phase, ...files] = args;
  if (!area || !/^\d+-[a-z]+$/.test(area) || !SEASONS.includes(season!) || !["day", "night"].includes(phase!)
    || files.length !== 3 || !Number.isInteger(block) || block < 1) {
    console.error("Usage: npm run area-art -- <area dir, e.g. 0-shrine> <spring|summer|autumn|winter> <day|night> <left.png> <middle.png> <right.png> [--block <px>]");
    process.exitCode = 2;
    return;
  }
  const [left, middle, right] = await Promise.all(files.map(async (file) => decodePng(await readFile(file))));
  if (middle!.width % block) console.warn(`Warning: the middle picture's width (${middle!.width}) is not a multiple of ${block}; it may not tile seamlessly.`);
  const art = prepareAreaArt({ left: left!, middle: middle!, right: right! }, block);
  const directory = fileURLToPath(new URL(`../web/areas/${area}/`, import.meta.url));
  await mkdir(directory, { recursive: true });
  for (const [name, picture] of Object.entries(art)) {
    const file = path.join(directory, `${season}-${phase}-${name}.png`);
    await writeFile(file, encodePng(picture));
    console.log(`${path.relative(process.cwd(), file)}: ${picture.width}×${picture.height}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
