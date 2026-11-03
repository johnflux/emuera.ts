import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadGame, readText } from "../src/loader.js";
import { EraError } from "../src/model.js";

test("batched loading preserves header, routine, event and character precedence across batches", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-loader-order-"));
  try {
    await Promise.all(["ERB", "CSV"].map(dir => mkdir(path.join(root, dir))));
    for (let i = 0; i < 24; i++) {
      await writeFile(path.join(root, "ERB", `${String(i).padStart(2, "0")}.ERH`), `#DEFINE FEATURE_${i} ${i}`);
    }
    for (let i = 0; i < 40; i++) {
      const number = String(i).padStart(2, "0");
      await writeFile(path.join(root, "ERB", `${number}.ERB`), `@SHARED
[IF FEATURE_23]
PRINTL ${i}
[ELSE]
THROW headers not loaded
[ENDIF]
@EVENTSHOP
PRINTL ${i}`);
      await writeFile(path.join(root, "CSV", `Chara${number}.csv`), `番号,0\n名前,character${i}`);
    }
    const game = await loadGame(root);
    assert.equal(game.scriptFiles, 64);
    assert.equal(game.macros.get("FEATURE_23"), "23");
    assert.equal(game.routines.get("SHARED")?.[0]?.lines[0]?.text, "PRINTL 0");
    assert.deepEqual(game.routines.get("EVENTSHOP")?.map(routine => routine.lines[0]?.text),
      Array.from({ length: 40 }, (_, i) => `PRINTL ${i}`));
    assert.deepEqual(game.characters.get(0)?.rows, [["番号", "0"], ["名前", "character0"]]);
    assert.equal(game.diagnostics.filter(item => /already defined/.test(item.message)).length, 39);
    assert.equal(game.diagnostics.filter(item => /Duplicate character number/.test(item.message)).length, 39);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("read-ahead reports earlier parse errors before later decode failures and still ignores disabled translations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-loader-errors-"));
  try {
    await Promise.all(["ERB", "CSV"].map(dir => mkdir(path.join(root, dir))));
    await writeFile(path.join(root, "ERB", "00.erb"), "@SYSTEM_TITLE\n}");
    await writeFile(path.join(root, "ERB", "01.erb"), Buffer.from([0x82]));
    await writeFile(path.join(root, "CSV", "Abl_TR.csv"), Buffer.from([0x82]));
    await assert.rejects(loadGame(root), (error: unknown) =>
      error instanceof EraError && /Unmatched multiline/.test(error.message)
      && error.source?.file === path.join("ERB", "00.erb") && error.source.line === 2);
    await writeFile(path.join(root, "ERB", "00.erb"), "@SYSTEM_TITLE\nINPUT");
    await assert.rejects(loadGame(root), TypeError);
    await writeFile(path.join(root, "ERB", "01.erb"), "@HELPER\nRETURN");
    assert.equal((await loadGame(root)).translations.size, 0);
    await assert.rejects(loadGame(root, { anchorTranslation: true }), TypeError);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reused text decoders keep mixed encodings and invalid files isolated", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-loader-encoding-"));
  try {
    const fixtures = [
      ["legacy", Buffer.from([0x82, 0xa0]), "\u3042"],
      ["utf8", Buffer.from("\uFEFFhello \u3042"), "hello \u3042"],
      ["utf16", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("wide \u3042", "utf16le")]), "wide \u3042"],
      ["empty", Buffer.alloc(0), ""],
    ] as const;
    for (const [name, bytes] of fixtures) await writeFile(path.join(root, name), bytes);
    const invalid = path.join(root, "invalid");
    await writeFile(invalid, Buffer.from([0x82]));
    for (let i = 0; i < 3; i++) {
      await assert.rejects(readText(invalid), TypeError);
      assert.deepEqual(await Promise.all(fixtures.map(([name]) => readText(path.join(root, name)))),
        fixtures.map(([, , text]) => text));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
