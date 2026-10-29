import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadGame } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";
import { EraError } from "../src/model.js";

const translatedRoot = fileURLToPath(new URL("./fixtures/anchor-translated-index/", import.meta.url));
const plainRoot = fileURLToPath(new URL("./fixtures/anchor-plain-index/", import.meta.url));
const output = (snapshot: ReturnType<Runtime["start"]>) =>
  snapshot.output.filter((item) => item.type === "text").map((item) => item.text);

test("Anchor *_TR names translate FORM reads and resolve as CSV indices only when enabled", async () => {
  const game = await loadGame(translatedRoot, { anchorTranslation: true });
  assert.equal(game.names.get("ABL")?.get("TECHNIQUE"), 1);
  assert.equal(game.names.get("ABL")?.get("BARRAGE "), 2);
  assert.equal(game.names.get("ABL")?.has("WRONG"), false);
  assert.deepEqual(game.diagnostics, []);

  for (const jit of [false, true]) {
    const snapshot = new Runtime(game, 50_000, { jit }).start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(output(snapshot), ["NAME=[Technique]", "VALUE=42"]);
  }
});

test("Anchor translation files do not affect ordinary EE games and detection can be overridden", async () => {
  const plain = await loadGame(translatedRoot);
  assert.equal(plain.translations.size, 0);
  assert.equal(plain.names.get("ABL")?.has("TECHNIQUE"), false);
  const root = await mkdtemp(path.join(tmpdir(), "era-anchor-detection-"));
  try {
    await cp(translatedRoot, root, { recursive: true });
    // Detection only: this marker is never executed.
    await writeFile(path.join(root, "Emuera-Anchor.exe"), "");
    assert.equal((await loadGame(root)).translations.get("ABL")?.get("技巧"), "Technique");
    assert.equal((await loadGame(root, { anchorTranslation: false })).translations.size, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Anchor rejects malformed and duplicate translation rows with source diagnostics like the native loader", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-anchor-invalid-"));
  try {
    await cp(translatedRoot, root, { recursive: true });
    for (const [source, message, line] of [
      ["技巧,Technique\ninvalid,has,too,many,commas", /exactly one comma/, 2],
      ["技巧,Technique\n技巧,Duplicate", /Duplicate Anchor translation/, 2],
      ["{not alone\n技巧,Technique", /can't hold anything else/, 1],
      ["{\n技巧,Technique", /without a '}'/, 1],
      ["}", /without a '{'/, 1],
    ] as const) {
      await writeFile(path.join(root, "CSV/Abl_TR.csv"), source);
      await assert.rejects(loadGame(root, { anchorTranslation: true }), (error: unknown) =>
        error instanceof EraError && message.test(error.message) && error.source?.line === line
        && error.source.file === path.join("CSV", "Abl_TR.csv"));
      assert.equal((await loadGame(root)).translations.size, 0);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("translated CSV symbols are not registered without an Anchor *_TR file", async () => {
  const game = await loadGame(plainRoot);
  assert.equal(game.names.get("ABL")?.has("TECHNIQUE"), false);
  assert.equal(game.translations.has("ABL"), false);
  for (const jit of [false, true]) {
    const snapshot = new Runtime(game, 50_000, { jit }).start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(output(snapshot), ["1 -1"]);
  }
});
