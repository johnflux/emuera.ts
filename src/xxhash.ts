const P1 = 0x9e3779b1, P2 = 0x85ebca77, P3 = 0xc2b2ae3d, P4 = 0x27d4eb2f, P5 = 0x165667b1;
const rotate = (value: number, bits: number): number => (value << bits | value >>> (32 - bits)) >>> 0;
const round = (accumulator: number, value: number): number => Math.imul(rotate((accumulator + Math.imul(value, P2)) >>> 0, 13), P1) >>> 0;

/** xxHash32 with seed 0, over the UTF-8 bytes used by HASH_XXH32. */
export function xxhash32(source: string): number {
  const bytes = new TextEncoder().encode(source);
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0, hash: number;
  if (bytes.length >= 16) {
    let a = (P1 + P2) >>> 0, b = P2, c = 0, d = (-P1) >>> 0;
    while (offset <= bytes.length - 16) {
      a = round(a, data.getUint32(offset, true));
      b = round(b, data.getUint32(offset + 4, true));
      c = round(c, data.getUint32(offset + 8, true));
      d = round(d, data.getUint32(offset + 12, true));
      offset += 16;
    }
    hash = (rotate(a, 1) + rotate(b, 7) + rotate(c, 12) + rotate(d, 18)) >>> 0;
  } else hash = P5;
  hash = (hash + bytes.length) >>> 0;
  while (offset <= bytes.length - 4) {
    hash = Math.imul(rotate((hash + Math.imul(data.getUint32(offset, true), P3)) >>> 0, 17), P4) >>> 0;
    offset += 4;
  }
  while (offset < bytes.length) {
    hash = Math.imul(rotate((hash + Math.imul(bytes[offset++]!, P5)) >>> 0, 11), P1) >>> 0;
  }
  hash = Math.imul(hash ^ hash >>> 15, P2);
  hash = Math.imul(hash ^ hash >>> 13, P3);
  return (hash ^ hash >>> 16) >>> 0;
}
