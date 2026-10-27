import { gzipSync, gunzipSync } from "node:zlib";
import { EraError } from "./model.js";
import type { GlobalData, SaveData } from "./variables.js";

const HEADER = Buffer.from([0x89, 0x45, 0x52, 0x41, 13, 10, 26, 10]);
const ZIP_HEADER = Buffer.from([0x89, 0x45, 0x52, 0x41, 0x5a, 0x49, 0x50, 10]);
const MAX_BYTES = 256 * 1024 * 1024;

export interface SaveLayout { name: string; string: boolean; dimensions: number[]; character: boolean }
export interface SavedContainers {
  maps: Record<string, [string, string][]>;
  xmls: Record<string, string>;
  dts: Record<string, [string, string]>;
}
export interface SaveMetadata {
  code: string;
  gameVersion: string;
  layout: SaveLayout[];
  compressed?: boolean;
}
export interface NativeSave {
  type: 0 | 1 | 3;
  code: string;
  gameVersion: string;
  text: string;
  data: SaveData;
  characters: GlobalData[];
  containers: SavedContainers;
}

class Reader {
  offset = 0;
  constructor(readonly data: Buffer) {}
  take(size: number): Buffer {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.data.length - this.offset)
      throw new EraError("Truncated Emuera save");
    const bytes = this.data.subarray(this.offset, this.offset + size);
    this.offset += size;
    return bytes;
  }
  byte(): number { return this.take(1)[0]!; }
  int32(): number { return this.take(4).readInt32LE(); }
  int64(): bigint { return this.take(8).readBigInt64LE(); }
  count(value: bigint, maximum = MAX_BYTES): number {
    if (value < 0n || value > BigInt(maximum)) throw new EraError("Invalid Emuera save count");
    return Number(value);
  }
  string(): string {
    let length = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      const byte = this.byte();
      length += (byte & 127) * 2 ** shift;
      if (byte < 128) {
        if (length % 2) throw new EraError("Invalid Emuera UTF-16 string");
        return this.take(length).toString("utf16le");
      }
    }
    throw new EraError("Invalid Emuera string length");
  }
  integer(marker = this.byte()): bigint {
    if (marker <= 0xcf) return BigInt(marker);
    if (marker === 0xd0) return BigInt(this.take(2).readInt16LE());
    if (marker === 0xd1) return BigInt(this.int32());
    if (marker === 0xd2) return this.int64();
    throw new EraError(`Invalid Emuera integer marker: ${marker}`);
  }
  variable(type: number): Record<string, string> {
    const string = (type & 0x10) !== 0, rank = type & 15;
    if (type !== rank && type !== 0x10 + rank || rank > 3)
      throw new EraError(`Unsupported Emuera variable type: ${type}`);
    const values: Record<string, string> = Object.create(null);
    if (!rank) {
      values[""] = string ? this.string() : String(this.integer());
      return values;
    }
    const dimensions = Array.from({ length: rank }, () => this.count(BigInt(this.int32()), 0x7fffffff));
    const indices = dimensions.map(() => 0);
    while (true) {
      const marker = this.byte();
      if (marker === 0xff) return values;
      if ((marker >= 0xe0 && marker <= 0xe1) || (marker >= 0xf0 && marker <= 0xf2)) {
        const skip = marker >= 0xf0;
        const level = skip ? marker - 0xf0 : marker - 0xe0 + 1;
        const axis = rank - 1 - level;
        if (axis < 0) throw new EraError("Invalid Emuera array separator");
        const count = skip ? this.count(this.integer(), 0x7fffffff) : 1;
        indices[axis]! += count;
        for (let i = axis + 1; i < rank; i++) indices[i] = 0;
        if (indices.some((n, i) => n > dimensions[i]!)) throw new EraError("Emuera array run exceeds its dimensions");
        continue;
      }
      if (indices.some((n, i) => n >= dimensions[i]!)) throw new EraError("Emuera array value exceeds its dimensions");
      if (string && marker !== 0xd8) throw new EraError("Invalid Emuera string array marker");
      const value = string ? this.string() : String(this.integer(marker));
      if (value !== (string ? "" : "0")) values[indices.join(":")] = value;
      indices[rank - 1]!++;
    }
  }
  variables(end: number, scalarIndex: boolean): GlobalData {
    const variables: GlobalData = Object.create(null);
    while (true) {
      const type = this.byte();
      if (type === end) return variables;
      if (type === 0xfd) continue;
      if (type === 0xfe || type === 0xff) throw new EraError("Unexpected Emuera save section ending");
      const name = this.string().toUpperCase();
      const values = this.variable(type);
      if (scalarIndex && "" in values) { values["0"] = values[""]!; delete values[""]; }
      variables[name] = values;
    }
  }
}

/** Emuera's 1808 binary format, including its gzip wrapper and EM container tail. */
export function readNativeSave(source: Buffer): NativeSave {
  const header = new Reader(source);
  const signature = header.take(8);
  if (!signature.equals(HEADER) && !signature.equals(ZIP_HEADER)) throw new EraError("Unsupported Emuera save format (expected binary 1808)");
  if (header.int32() !== 1808) throw new EraError("Unsupported Emuera binary save version");
  const extra = header.count(BigInt(header.int32()), Math.floor(source.length / 4));
  header.take(extra * 4);
  const payload = source.subarray(header.offset);
  const reader = new Reader(signature.equals(ZIP_HEADER) ? gunzipSync(payload, { maxOutputLength: MAX_BYTES }) : payload);
  const type = reader.byte();
  if (type !== 0 && type !== 1 && type !== 3) throw new EraError(`Unsupported Emuera save file type: ${type}`);
  const code = String(reader.int64()), gameVersion = String(reader.int64()), text = reader.string();
  const characters: GlobalData[] = [];
  if (type !== 1) {
    const count = reader.count(reader.int64(), reader.data.length);
    for (let i = 0; i < count; i++) characters.push(reader.variables(0xfe, false));
  }
  const variables = reader.variables(0xff, true);
  if (type === 3 && Object.keys(variables).length) throw new EraError("Unexpected variables in Emuera character save");
  for (const [i, character] of characters.entries())
    for (const [name, values] of Object.entries(character)) {
      const target = variables[name] ??= Object.create(null);
      for (const [address, value] of Object.entries(values)) target[address ? `${i}:${address}` : String(i)] = value;
    }
  const containers: SavedContainers = { maps: Object.create(null), xmls: Object.create(null), dts: Object.create(null) };
  if (reader.offset < reader.data.length) {
    while (true) {
      const kind = reader.byte();
      if (kind === 0xff) break;
      const name = reader.string();
      if (kind === 0x20) {
        const count = reader.count(BigInt(reader.int32()), reader.data.length);
        containers.maps[name] = Array.from({ length: count }, () => [reader.string(), reader.string()]);
      } else if (kind === 0x21) containers.xmls[name] = reader.string();
      else if (kind === 0x22) containers.dts[name] = [reader.string(), reader.string()];
      else throw new EraError(`Unsupported Emuera save extension: ${kind}`);
    }
  }
  if (reader.offset !== reader.data.length) throw new EraError("Unexpected trailing Emuera save data");
  return { type, code, gameVersion, text, data: { characters: characters.length, variables }, characters, containers };
}

class Writer {
  private chunks: Buffer[] = [];
  bytes(value: Buffer): void { this.chunks.push(value); }
  byte(value: number): void { this.bytes(Buffer.from([value])); }
  int32(value: number): void { const bytes = Buffer.alloc(4); bytes.writeInt32LE(value); this.bytes(bytes); }
  int64(value: bigint): void { const bytes = Buffer.alloc(8); bytes.writeBigInt64LE(value); this.bytes(bytes); }
  integer(value: bigint): void {
    if (value >= 0n && value <= 0xcfn) this.byte(Number(value));
    else if (value >= -32768n && value <= 32767n) {
      this.byte(0xd0);
      const bytes = Buffer.alloc(2); bytes.writeInt16LE(Number(value)); this.bytes(bytes);
    } else if (value >= -2147483648n && value <= 2147483647n) { this.byte(0xd1); this.int32(Number(value)); }
    else { this.byte(0xd2); this.int64(value); }
  }
  string(value: string): void {
    const bytes = Buffer.from(value, "utf16le");
    let length = bytes.length;
    while (length >= 128) { this.byte((length % 128) | 128); length = Math.floor(length / 128); }
    this.byte(length);
    this.bytes(bytes);
  }
  variable(layout: SaveLayout, values: Record<string, string>): void {
    const rank = layout.dimensions.length;
    if (rank > 3) throw new EraError(`Unsupported saved variable rank: ${layout.name}`);
    this.byte((layout.string ? 0x10 : 0) + rank);
    this.string(layout.name);
    const value = (raw: string) => {
      if (layout.string) { if (rank) this.byte(0xd8); this.string(raw); }
      else this.integer(BigInt(raw));
    };
    if (!rank) { value(values[""] ?? (layout.string ? "" : "0")); return; }
    for (const dimension of layout.dimensions) this.int32(dimension);
    const entries = Object.entries(values).filter(([, raw]) => raw !== (layout.string ? "" : "0"))
      .map(([address, raw]) => ({ indices: address.split(":").map(Number), raw }));
    for (const entry of entries)
      if (entry.indices.length !== rank || entry.indices.some((n, i) => !Number.isSafeInteger(n) || n < 0 || n >= layout.dimensions[i]!))
        throw new EraError(`Invalid saved address: ${layout.name}`);
    const write = (depth: number, subset: typeof entries): void => {
      const groups = new Map<number, typeof entries>();
      for (const entry of subset) {
        const index = entry.indices[depth]!;
        let group = groups.get(index);
        if (!group) groups.set(index, group = []);
        group.push(entry);
      }
      let next = 0;
      for (const [index, group] of [...groups].sort(([a], [b]) => a - b)) {
        if (index > next) { this.byte(0xf0 + rank - depth - 1); this.integer(BigInt(index - next)); }
        if (depth === rank - 1) value(group[0]!.raw);
        else write(depth + 1, group);
        next = index + 1;
      }
      this.byte(depth === 0 ? 0xff : 0xe0 + rank - depth - 1);
    };
    write(0, entries);
  }
  finish(): Buffer { return Buffer.concat(this.chunks); }
}

export function writeNativeSave(record: NativeSave, metadata: SaveMetadata): Buffer {
  const writer = new Writer();
  writer.byte(record.type);
  writer.int64(BigInt(record.code));
  writer.int64(BigInt(record.gameVersion));
  writer.string(record.text);
  if (record.type !== 1) {
    writer.int64(BigInt(record.characters.length));
    for (const character of record.characters) {
      for (const layout of metadata.layout.filter((item) => item.character))
        writer.variable(layout, character[layout.name] ?? {});
      writer.byte(0xfe);
    }
  }
  if (record.type !== 3)
    for (const layout of metadata.layout.filter((item) => !item.character))
      writer.variable(layout, record.data.variables[layout.name] ?? {});
  writer.byte(0xff);
  if (record.type !== 3) {
    for (const [name, entries] of Object.entries(record.containers.maps)) {
      writer.byte(0x20); writer.string(name); writer.int32(entries.length);
      for (const [key, value] of entries) { writer.string(key); writer.string(value); }
    }
    for (const [name, xml] of Object.entries(record.containers.xmls)) { writer.byte(0x21); writer.string(name); writer.string(xml); }
    for (const [name, [schema, rows]] of Object.entries(record.containers.dts)) {
      writer.byte(0x22); writer.string(name); writer.string(schema); writer.string(rows);
    }
    writer.byte(0xff);
  }
  const header = new Writer();
  header.bytes(metadata.compressed ? ZIP_HEADER : HEADER);
  header.int32(1808);
  header.int32(0);
  const payload = writer.finish();
  return Buffer.concat([header.finish(), metadata.compressed ? gzipSync(payload) : payload]);
}
