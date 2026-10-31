import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { Transformer } from "@napi-rs/image";
import { CardVoiceStore, cardVoice, writeCard } from "../src/character-card.js";
import { FileVoiceStore } from "../src/character-voice.js";

const voice = { description: "Jealous of ordinary happiness.", examples: ["I'm listening."], intimateExamples: ["Stay with me."] };
function portrait() {
  const canvas = createCanvas(32, 48);
  canvas.getContext("2d").fillRect(0, 0, 32, 48);
  return canvas.toBuffer("image/png");
}
function externalCard(png: Buffer) {
  const keyword = png.indexOf(Buffer.from("chara\0"));
  const end = keyword + png.readUInt32BE(keyword - 8);
  return JSON.parse(Buffer.from(png.subarray(keyword + 6, end).toString("ascii"), "base64").toString("utf8"));
}

test("PNG character cards expose standard V2 fields and preserve both voice example sets", () => {
  const image = portrait(), png = writeCard(image, 60, "Parsee", voice);
  const card = externalCard(png);
  assert.equal(card.spec, "chara_card_v2");
  assert.equal(card.spec_version, "2.0");
  assert.equal(card.data.name, "Parsee");
  assert.equal(card.data.description, voice.description);
  assert.equal(card.data.mes_example, "<START>\n{{char}}: I'm listening.");
  assert.ok(!card.data.mes_example.includes(voice.intimateExamples[0]!));
  assert.deepEqual(card.data.extensions["emuera.ts"], { ...voice, number: 60 });
  assert.deepEqual(cardVoice(png), voice);
  assert.deepEqual(new Transformer(png).rawPixelsSync(), new Transformer(image).rawPixelsSync());
  const revised = writeCard(png, 60, "Parsee", { ...voice, description: "Revised." });
  assert.equal(cardVoice(revised).description, "Revised.");
  assert.equal(externalCard(revised).data.name, "Parsee");
  assert.deepEqual(new Transformer(revised).rawPixelsSync(), new Transformer(image).rawPixelsSync());
});

test("card stores migrate legacy JSON voices, persist PNG edits and revert without resurrecting the old voice", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "era-cards-"));
  try {
    const legacy = new FileVoiceStore(path.join(directory, "GAMES", "sav", "llm-voices.json"));
    legacy.save(60, voice);
    legacy.save(1, { ...voice, description: "Another character." });
    const location = path.join(directory, "character-cards", "tw");
    const store = new CardVoiceStore(location, legacy);
    let renders = 0;
    const identity = { name: "Parsee", portrait: () => { renders++; return portrait(); } };
    assert.equal(store.load(2, identity), null);
    assert.deepEqual(store.load(60, identity), voice);
    assert.equal(renders, 1);
    assert.equal(legacy.load(60), null);
    assert.equal(legacy.load(1)?.description, "Another character.");
    assert.equal(store.locationFor(60), path.join(location, "60.png"));
    assert.deepEqual(cardVoice(await readFile(store.locationFor(60))), voice);
    assert.deepEqual(new CardVoiceStore(location).load(60), voice);
    store.save(60, { ...voice, description: "Edited." }, identity);
    assert.equal(renders, 1, "edits keep the original portrait");
    assert.equal(store.load(60)?.description, "Edited.");
    assert.throws(() => store.locationFor(-1), /Invalid character card number/);
    store.save(60, null);
    assert.equal(store.load(60, identity), null);
    assert.equal(store.card(60), null);
    assert.throws(() => store.save(60, voice), /name and portrait/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("invalid card data is surfaced and failed portrait migration keeps the original sheet", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "era-cards-invalid-"));
  try {
    const store = new CardVoiceStore(directory);
    await writeFile(store.locationFor(60), Buffer.from("not a PNG"));
    assert.throws(() => store.load(60), /not a PNG/);
    const corrupt = writeCard(portrait(), 60, "Parsee", voice);
    corrupt[corrupt.length - 1] ^= 1;
    await writeFile(store.locationFor(60), corrupt);
    assert.throws(() => store.load(60), /checksum/);
    const legacy = new FileVoiceStore(path.join(directory, "legacy.json"));
    legacy.save(1, voice);
    const migration = new CardVoiceStore(path.join(directory, "new"), legacy);
    assert.throws(() => migration.load(1, { name: "Reimu", portrait: () => { throw new Error("No portrait"); } }), /No portrait/);
    assert.deepEqual(legacy.load(1), voice);
    assert.equal(migration.card(1), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
