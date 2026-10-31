import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { EraError } from "./model.js";
import { editableVoice, type EditableVoice, type VoiceIdentity, type VoiceStore } from "./character-voice.js";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const KEYWORD = Buffer.from("chara\0", "ascii");

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunks(png: Buffer): { type: string; data: Buffer; raw: Buffer }[] {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new EraError("Character card is not a PNG");
  const result = [];
  let at = 8;
  while (at < png.length) {
    if (at + 12 > png.length) throw new EraError("Truncated character card PNG");
    const length = png.readUInt32BE(at), end = at + 12 + length;
    if (end > png.length) throw new EraError("Truncated character card PNG chunk");
    const type = png.toString("ascii", at + 4, at + 8);
    if (crc32(png.subarray(at + 4, end - 4)) !== png.readUInt32BE(end - 4))
      throw new EraError(`Invalid character card PNG checksum: ${type}`);
    result.push({ type, data: png.subarray(at + 8, end - 4), raw: png.subarray(at, end) });
    at = end;
    if (type === "IEND") break;
  }
  if (at !== png.length || result[0]?.type !== "IHDR" || result.at(-1)?.type !== "IEND")
    throw new EraError("Invalid character card PNG structure");
  return result;
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function metadata(png: Buffer): Record<string, unknown> | undefined {
  const text = chunks(png).find((chunk) => chunk.type === "tEXt" && chunk.data.subarray(0, KEYWORD.length).equals(KEYWORD));
  if (!text) return undefined;
  try {
    const card = object(JSON.parse(Buffer.from(text.data.subarray(KEYWORD.length).toString("ascii"), "base64").toString("utf8")));
    if (!card || card.spec !== "chara_card_v2" || !object(card.data)) throw new Error("Expected Character Card V2");
    return card;
  } catch (error) {
    throw new EraError(`Invalid character card metadata: ${error instanceof Error ? error.message : String(error)}`);
  }
}
export function cardVoice(png: Buffer): EditableVoice {
  const card = metadata(png);
  if (!card) throw new EraError("PNG has no character card metadata");
  const data = object(card.data)!;
  const extensions = object(data.extensions);
  const voice = editableVoice(extensions?.["emuera.ts"]);
  if (!voice) throw new EraError("Character card has no valid emuera.ts voice extension");
  return voice;
}
export function writeCard(png: Buffer, no: number, name: string, voice: EditableVoice): Buffer {
  const previous = metadata(png);
  const oldData = object(previous?.data);
  const data = {
    name, personality: "", scenario: "", first_mes: "",
    creator_notes: "", system_prompt: "", post_history_instructions: "", alternate_greetings: [],
    tags: [], creator: "emuera.ts", character_version: "1.0",
    ...oldData,
    description: voice.description,
    mes_example: voice.examples.map((line) => `<START>\n{{char}}: ${line}`).join("\n"),
    extensions: { ...object(oldData?.extensions), "emuera.ts": { ...voice, number: no } },
  };
  const text = Buffer.concat([KEYWORD, Buffer.from(Buffer.from(JSON.stringify({
    ...previous, spec: "chara_card_v2", spec_version: "2.0", data,
  }), "utf8").toString("base64"), "ascii")]);
  const chunk = Buffer.alloc(text.length + 12);
  chunk.writeUInt32BE(text.length);
  chunk.write("tEXt", 4, "ascii");
  text.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  const parts = chunks(png).filter((part) => !(part.type === "tEXt" && part.data.subarray(0, KEYWORD.length).equals(KEYWORD)));
  return Buffer.concat([SIGNATURE, ...parts.flatMap((part) => part.type === "IEND" ? [chunk, part.raw] : [part.raw])]);
}

/** One V2 PNG per character NO, outside the game directory. Old JSON voices migrate on first use. */
export class CardVoiceStore implements VoiceStore {
  constructor(readonly location: string, private legacy?: VoiceStore) {}
  locationFor(no: number): string {
    if (!Number.isSafeInteger(no) || no < 0) throw new EraError("Invalid character card number");
    return path.join(this.location, `${no}.png`);
  }
  card(no: number): Buffer | null {
    try { return readFileSync(this.locationFor(no)); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw new EraError(`Cannot read character card: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  load(no: number, identity?: VoiceIdentity): EditableVoice | null {
    const png = this.card(no);
    if (png) return cardVoice(png);
    const old = this.legacy?.load(no);
    if (!old) return null;
    this.save(no, old, identity);
    return old;
  }
  save(no: number, voice: EditableVoice | null, identity?: VoiceIdentity): void {
    const file = this.locationFor(no);
    if (!voice) {
      if (this.legacy?.load(no)) this.legacy.save(no, null);
      try { unlinkSync(file); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
          throw new EraError(`Cannot remove character card: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    const previous = this.card(no);
    if (!previous && !identity) throw new EraError("A character name and portrait are required to create a card");
    const png = writeCard(previous ?? identity!.portrait(), no, identity?.name ?? String(no), voice);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      mkdirSync(this.location, { recursive: true });
      writeFileSync(temporary, png, { flag: "wx" });
      renameSync(temporary, file);
    } catch (error) {
      throw new EraError(`Cannot save character card: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      try { unlinkSync(temporary); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
    if (this.legacy?.load(no)) this.legacy.save(no, null);
  }
}
