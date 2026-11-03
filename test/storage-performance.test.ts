import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { FileSaveStore, gameSaveDirectory } from "../src/storage.js";

test("exact save paths avoid directory scans for reads, updates and removals", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "era-save-path-"));
  await mkdir(path.join(root, "sav"));
  const directory = path.join(root, "sav");
  await writeFile(path.join(directory, "history.json"), "original");
  const scan = t.mock.method(fs, "readdirSync");
  syncBuiltinESMExports();
  try {
    const saves = new FileSaveStore(directory);
    assert.equal(saves.read("history.json"), "original");
    saves.write("history.json", "updated");
    assert.equal(saves.read("history.json"), "updated");
    saves.remove("history.json");
    assert.equal(scan.mock.callCount(), 0);
    assert.equal(saves.read("missing.json"), null);
    assert.equal(scan.mock.callCount(), 1, "only missing exact paths trigger case-insensitive lookup");
  } finally {
    scan.mock.restore();
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});

test("missing exact paths retain case-insensitive fallback and missing directories can be created", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-save-case-"));
  try {
    const saves = new FileSaveStore(path.join(root, "new"));
    await mkdir(path.join(root, "SAV"));
    assert.equal(gameSaveDirectory(root, new Map([["UseSaveFolder", "YES"]])), path.join(root, "SAV"));
    saves.write("HISTORY.JSON", "original");
    assert.equal(saves.read("history.json"), "original");
    saves.write("history.json", "updated");
    assert.equal(saves.read("HISTORY.JSON"), "updated");
    assert.equal(saves.list().length, 1);
    saves.remove("history.json");
    assert.equal(saves.read("HISTORY.JSON"), null);
    assert.throws(() => saves.read("../escape"), /Invalid save file name/);
    await writeFile(path.join(root, "not-directory"), "");
    assert.throws(() => new FileSaveStore(path.join(root, "not-directory")).read("file.json"), /Cannot read save file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
