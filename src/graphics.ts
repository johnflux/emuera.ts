import { createCanvas, ImageData, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { Transformer } from "@napi-rs/image";
import type { Picture } from "./runtime.js";

type Rect = [number, number, number, number];
export type ImageSource = (url: string) => Buffer;
export class InvalidGraphicsImage extends Error {}

export function decodePicture(bytes: Buffer): Picture {
  let image: ReturnType<Transformer["metadataSync"]>;
  try { image = new Transformer(bytes).metadataSync(); }
  catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "InvalidArg" || error.code === "GenericFailure"))
      throw new InvalidGraphicsImage(error.message);
    throw error;
  }
  if (!image.width || !image.height || image.width > 8192 || image.height > 8192)
    throw new InvalidGraphicsImage("Invalid graphics image size");
  const rect: Rect = [0, 0, image.width, image.height];
  return { width: image.width, height: image.height, ops: [
    { op: "image", url: `data:image/png;base64,${bytes.toString("base64")}`, src: rect, dest: rect },
  ] };
}

function imagePixels(url: string, resolve: ImageSource): { width: number; height: number; rgba: Uint8ClampedArray } {
  const bytes = url.startsWith("data:image/") ? Buffer.from(url.slice(url.indexOf(",") + 1), "base64") : resolve(url);
  const decoder = new Transformer(bytes);
  const { width, height } = decoder.metadataSync();
  if (!width || !height || width > 8192 || height > 8192) throw new Error("Invalid graphics image size");
  // Canvas Image.decode is asynchronous, but ERB expressions and SaveStore reads are synchronous.
  const pixels = decoder.opacity(1).rawPixelsSync();
  const depth = pixels.length / (width * height * 4);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i++)
    rgba[i] = depth === 1 ? pixels[i]! : depth === 2 ? Math.round(pixels.readUInt16LE(i * 2) / 257) : Math.round(pixels.readFloatLE(i * 4) * 255);
  return { width, height, rgba };
}

function image(url: string, resolve: ImageSource): Canvas {
  const { width, height, rgba } = imagePixels(url, resolve);
  const result = createCanvas(width, height);
  result.getContext("2d").putImageData(new ImageData(rgba, width, height), 0, 0);
  return result;
}

function colorMatrix(canvas: Canvas, matrix: number[][]): void {
  const context = canvas.getContext("2d"), data = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let p = 0; p < data.data.length; p += 4) {
    const rgba = Array.from(data.data.subarray(p, p + 4), (v) => v / 255);
    for (let j = 0; j < 4; j++)
      data.data[p + j] = Math.round(255 * Math.min(1, Math.max(0,
        rgba.reduce((sum, channel, i) => sum + channel * matrix[i]![j]!, matrix[4]![j]!))));
  }
  context.putImageData(data, 0, 0);
}

function draw(context: SKRSContext2D, source: Canvas, src: Rect, dest: Rect, matrix?: number[][]): void {
  let [sx, sy, sw, sh] = src, [dx, dy, dw, dh] = dest, flipX = false, flipY = false;
  if (!sw || !sh || !dw || !dh) return;
  if (sw < 0) { sx += sw; sw = -sw; flipX = !flipX; }
  if (sh < 0) { sy += sh; sh = -sh; flipY = !flipY; }
  if (dw < 0) { dx += dw; dw = -dw; flipX = !flipX; }
  if (dh < 0) { dy += dh; dh = -dh; flipY = !flipY; }
  const layer = matrix ? createCanvas(dw, dh) : undefined;
  const target = layer?.getContext("2d") ?? context;
  target.save();
  target.translate((layer ? 0 : dx) + (flipX ? dw : 0), (layer ? 0 : dy) + (flipY ? dh : 0));
  target.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  target.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);
  target.restore();
  if (layer) {
    colorMatrix(layer, matrix!);
    context.drawImage(layer, dx, dy);
  }
}

/** GDI+ dash lengths are multiples of pen width, unlike Canvas's pixel lengths. */
export function dashPattern(style: number, width: number): number[] {
  return ([[], [3, 1], [1, 1], [3, 1, 1, 1], [3, 1, 1, 1, 1, 1]][style] ?? []).map((n) => n * width);
}

export function rasterize(picture: Picture, resolve: ImageSource): Canvas {
  const canvas = createCanvas(picture.width, picture.height), context = canvas.getContext("2d");
  for (const op of picture.ops) {
    switch (op.op) {
      case "rotate": {
        const previous = context.getTransform();
        context.resetTransform();
        context.translate(op.x, op.y);
        context.rotate(op.angle * Math.PI / 180);
        context.translate(-op.x, -op.y);
        context.transform(previous.a, previous.b, previous.c, previous.d, previous.e, previous.f);
        break;
      }
      case "fill": {
        if (op.absolute) { context.save(); context.resetTransform(); }
        if (op.replace) context.clearRect(...op.rect);
        context.fillStyle = op.color;
        context.fillRect(...op.rect);
        if (op.absolute) context.restore();
        break;
      }
      case "line":
        if (op.dashStyle === 5) break;
        context.strokeStyle = op.color;
        context.lineWidth = op.width;
        context.setLineDash(dashPattern(op.dashStyle ?? 0, op.width));
        context.lineCap = op.dashCap === 2 ? "round" : "butt";
        context.beginPath();
        context.moveTo(...op.from);
        context.lineTo(...op.to);
        context.stroke();
        break;
      case "text": {
        const { name, size, style } = op.font;
        context.font = `${style & 2 ? "italic " : ""}${style & 1 ? "bold " : ""}${size}px ${JSON.stringify(name)}, monospace`;
        context.textBaseline = "top";
        context.fillStyle = op.color;
        op.text.split(/\r?\n/).forEach((line, index) => {
          const y = op.y + index * size;
          context.fillText(line, op.x, y);
          const width = context.measureText(line).width;
          if (style & 4) context.fillRect(op.x, y + size / 2, width, Math.max(1, size / 16));
          if (style & 8) context.fillRect(op.x, y + size - 1, width, Math.max(1, size / 16));
        });
        break;
      }
      case "mask": {
        const source = rasterize(op.source, resolve), mask = rasterize(op.mask, resolve);
        const destination = context.getImageData(op.x, op.y, source.width, source.height);
        const s = source.getContext("2d").getImageData(0, 0, source.width, source.height).data;
        const m = mask.getContext("2d").getImageData(0, 0, source.width, source.height).data;
        for (let p = 0; p < destination.data.length; p += 4) {
          const weight = m[p + 2]!;
          if (!weight) continue;
          for (let c = 0; c < 4; c++)
            destination.data[p + c] = weight === 255 ? s[p + c]! : (s[p + c]! * (weight + 1) + destination.data[p + c]! * (255 - weight)) >> 8;
        }
        context.putImageData(destination, op.x, op.y);
        break;
      }
      case "image": draw(context, image(op.url, resolve), op.src, op.dest, op.matrix); break;
      case "graphics": draw(context, rasterize(op.source, resolve), op.src, op.dest, op.matrix); break;
    }
  }
  return canvas;
}

export function pictureColor(picture: Picture | undefined, x: number, y: number, resolve: ImageSource): bigint {
  if (!picture || x < 0 || y < 0 || x >= picture.width || y >= picture.height) return -1n;
  const [r, g, b, a] = sample(picture, x, y, resolve, new Map()) ??
    rasterize(picture, resolve).getContext("2d").getImageData(x, y, 1, 1).data;
  return BigInt((a! * 0x1000000 + r! * 0x10000 + g! * 0x100 + b!) >>> 0);
}

export function resourceColor(url: string, x: number, y: number, resolve: ImageSource): bigint {
  const { width, height, rgba } = imagePixels(url, resolve);
  if (x < 0 || y < 0 || x >= width || y >= height) return 0x00ffffffn;
  const p = (y * width + x) * 4;
  return BigInt((rgba[p + 3]! * 0x1000000 + rgba[p]! * 0x10000 + rgba[p + 1]! * 0x100 + rgba[p + 2]!) >>> 0);
}

type RGBA = [number, number, number, number];
type Images = Map<string, ReturnType<typeof imagePixels>>;
function blend(destination: RGBA, source: RGBA): RGBA {
  if (!source[3]) return destination;
  if (source[3] === 255 || !destination[3]) return source;
  const a = source[3] + destination[3] * (1 - source[3] / 255);
  return [0, 1, 2].map((c) => Math.round((source[c]! * source[3] + destination[c]! * destination[3] * (1 - source[3] / 255)) / a))
    .concat(Math.round(a)) as RGBA;
}

/** Preserve straight ARGB for pixel operations: Canvas's premultiplication loses low-alpha RGB. */
function sample(picture: Picture, x: number, y: number, resolve: ImageSource, images: Images): RGBA | undefined {
  let pixel: RGBA = [0, 0, 0, 0], transformed = false;
  for (const op of picture.ops) {
    if (op.op === "rotate") { transformed = true; continue; }
    if (op.op === "fill") {
      if (transformed && !op.absolute) return undefined;
      const [rx, ry, rw, rh] = op.rect;
      if (x < Math.min(rx, rx + rw) || x >= Math.max(rx, rx + rw) || y < Math.min(ry, ry + rh) || y >= Math.max(ry, ry + rh)) continue;
      const match = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(op.color);
      if (!match) return undefined;
      const color: RGBA = [Number(match[1]), Number(match[2]), Number(match[3]), Math.round(Number(match[4]) * 255)];
      pixel = op.replace ? color : blend(pixel, color);
    } else if (op.op === "image" || op.op === "graphics") {
      if (transformed || op.matrix) return undefined;
      const [dx, dy, dw, dh] = op.dest, [sx, sy, sw, sh] = op.src;
      if (dw !== sw || dh !== sh || dw <= 0 || dh <= 0) return undefined;
      if (x < dx || x >= dx + dw || y < dy || y >= dy + dh) continue;
      const px = x - dx + sx, py = y - dy + sy;
      let color: RGBA | undefined;
      if (op.op === "graphics") {
        if (px < 0 || py < 0 || px >= op.source.width || py >= op.source.height) continue;
        color = sample(op.source, px, py, resolve, images);
      } else {
        let decoded = images.get(op.url);
        if (!decoded) { decoded = imagePixels(op.url, resolve); images.set(op.url, decoded); }
        if (px < 0 || py < 0 || px >= decoded.width || py >= decoded.height) continue;
        color = Array.from(decoded.rgba.subarray((py * decoded.width + px) * 4, (py * decoded.width + px) * 4 + 4)) as RGBA;
      }
      if (!color) return undefined;
      pixel = blend(pixel, color);
    } else return undefined;
  }
  return pixel;
}

export function encodePicture(picture: Picture, resolve: ImageSource): Buffer {
  const data = rasterize(picture, resolve).getContext("2d").getImageData(0, 0, picture.width, picture.height).data;
  const images: Images = new Map();
  for (let y = 0; y < picture.height; y++)
    for (let x = 0; x < picture.width; x++) {
      const exact = sample(picture, x, y, resolve, images);
      if (exact) data.set(exact, (y * picture.width + x) * 4);
    }
  return Transformer.fromRgbaPixels(data, picture.width, picture.height).pngSync();
}
