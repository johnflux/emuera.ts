import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { emptyGame, GAME_ROOT, indexScript, loadGame } from "../src/loader.js";
import { Runtime, GAME_INSTRUCTION_LIMIT, type Snapshot } from "../src/runtime.js";
import { readNativeSave, writeNativeSave, type NativeSave, type SaveLayout, type SaveMetadata } from "../src/save-format.js";
import { createApp } from "../src/server.js";
import { FileGlobalStore, FileSaveStore, gameSaveDirectory, MemoryGlobalStore, MemorySaveStore, StagedStores } from "../src/storage.js";

// Independently specified 1808 file: one character (NO=42, NAME="A"), FLAG:3=Int64.MinValue.
const FIXTURE = Buffer.from(
  "894552410d0a1a0a1007000000000000" +
  "0007000000000000000c000000000000000873006c006f0074000100000000000000" +
  "00044e004f002a10084e0041004d004500024100fe" +
  "010846004c004100470006000000f003d20000000000000080ffff",
  "hex",
);
const LAYOUT: SaveLayout[] = [
  { name: "NO", string: false, dimensions: [], character: true },
  { name: "NAME", string: true, dimensions: [], character: true },
  { name: "FLAG", string: false, dimensions: [6], character: false },
];
const METADATA: SaveMetadata = { code: "7", gameVersion: "12", layout: LAYOUT };

function printed(snapshot: Snapshot): string {
  return snapshot.output.filter((item) => item.type === "text").map((item) => item.text).join("\n");
}
function script(source: string, headers = "") {
  const game = emptyGame();
  if (headers) indexScript(game, headers, "save.ERH", true);
  indexScript(game, source, "save.ERB");
  return game;
}

test("reads an independently specified Emuera binary save and writes the same wire format", () => {
  const record = readNativeSave(FIXTURE);
  assert.equal(record.code, "7");
  assert.equal(record.gameVersion, "12");
  assert.equal(record.text, "slot");
  assert.equal(record.data.characters, 1);
  assert.equal(record.data.variables.NO?.["0"], "42");
  assert.equal(record.data.variables.NAME?.["0"], "A");
  assert.equal(record.data.variables.FLAG?.["3"], "-9223372036854775808");
  assert.deepEqual(writeNativeSave(record, METADATA), Buffer.concat([FIXTURE, Buffer.from([0xff])]));
  const zipped = Buffer.concat([Buffer.from("894552415a49500a1007000000000000", "hex"), gzipSync(FIXTURE.subarray(16))]);
  assert.deepEqual(readNativeSave(zipped), record);
  assert.deepEqual(readNativeSave(writeNativeSave(record, { ...METADATA, compressed: true })), record);
});

test("round-trips sparse 1D/2D/3D arrays, integer encodings, UTF-16 strings and EM containers", () => {
  const layout: SaveLayout[] = [
    { name: "NUMBERS", string: false, dimensions: [12], character: false },
    { name: "GRID", string: false, dimensions: [4, 5], character: false },
    { name: "CUBE", string: false, dimensions: [5, 6, 7], character: false },
    ...[1, 2, 3].map((rank) => ({ name: `STRINGS${rank}`, string: true, dimensions: Array(rank).fill(5), character: false })),
  ];
  const numbers = ["1", "207", "208", "-1", "-32768", "32767", "-32769", "32768", "-2147483648", "2147483647", "-9223372036854775808", "9223372036854775807"];
  const variables = {
    NUMBERS: Object.fromEntries(numbers.map((value, i) => [i, value])),
    GRID: { "1:2": "41", "3:4": "-9" },
    CUBE: { "1:2:3": "8", "1:5:0": "-2", "4:4:6": "1000" },
    STRINGS1: { "3": "日本語😀".repeat(50) },
    STRINGS2: { "2:4": "123" },
    STRINGS3: { "1:2:3": "line\nbreak", "3:0:1": "text" },
  };
  const containers = { maps: { m: [["key", "value"]] as [string, string][] }, xmls: { x: "<root/>" }, dts: { t: ["schema", "rows"] as [string, string] } };
  const record: NativeSave = { type: 0, code: "1", gameVersion: "2", text: "memo", data: { characters: 0, variables }, characters: [], containers };
  for (const compressed of [false, true]) {
    const decoded = readNativeSave(writeNativeSave(record, { ...METADATA, layout, compressed }));
    assert.deepEqual(JSON.parse(JSON.stringify(decoded)), record);
  }
});

test("rejects truncation, invalid dimensions, malformed runs, unsupported formats and trailing data", () => {
  for (let length = 0; length < FIXTURE.length; length++)
    assert.throws(() => readNativeSave(FIXTURE.subarray(0, length)), undefined, `length ${length}`);
  assert.throws(() => readNativeSave(Buffer.from('{"version":1}')), /Truncated|Unsupported/);
  const badVersion = Buffer.from(FIXTURE); badVersion.writeInt32LE(1809, 8);
  assert.throws(() => readNativeSave(badVersion), /version/);
  const badRun = Buffer.from(FIXTURE); badRun[badRun.indexOf(Buffer.from([0xf0, 3])) + 1] = 7;
  assert.throws(() => readNativeSave(badRun), /exceeds/);
  const badDimension = Buffer.from(FIXTURE);
  badDimension.writeInt32LE(-1, badDimension.indexOf(Buffer.from("46004c0041004700", "hex")) + 8);
  assert.throws(() => readNativeSave(badDimension), /count/);
  assert.throws(() => readNativeSave(Buffer.concat([FIXTURE, Buffer.from([0xff, 1])])), /trailing/);
});

test("native CHKDATA states, LOADDATA, DELDATA and character data use native filenames", () => {
  const saves = new MemorySaveStore();
  saves.write("save00.sav", FIXTURE);
  const game = script(`@SYSTEM_TITLE
CHKDATA 0
PRINTFORML {RESULT} %RESULTS%
LOADDATA 0
@EVENTLOAD
PRINTFORML {CHARANUM} {NO:0} %NAME:0% {FLAG:3}
SAVECHARA "テスト", "character", 0
LOADCHARA "テスト"
PRINTFORML {CHARANUM} %NAME:1%
DELDATA 0
CHKDATA 0
PRINTFORML {RESULT}
QUIT`);
  game.tables.set("GAMEBASE", new Map([[0, ["コード", "7"]]]));
  const result = new Runtime(game, 50_000, { saves }).start();
  assert.equal(result.status, "halted", JSON.stringify(result.error));
  assert.equal(printed(result), "0 slot\n1 42 A -9223372036854775808\n2 A\n1");
  assert.deepEqual(saves.list(), ["chara_テスト.dat"]);
  const chara = saves.read("chara_テスト.dat");
  assert.ok(Buffer.isBuffer(chara));
  assert.equal(readNativeSave(chara).type, 3);

  const check = (bytes: Buffer) => {
    saves.write("save00.sav", bytes);
    const game = script("@SYSTEM_TITLE\nCHKDATA 0\nPRINTFORML {RESULT}");
    game.tables.set("GAMEBASE", new Map([[0, ["コード", "7"]], [1, ["バージョン", "12"]]]));
    return printed(new Runtime(game, 50_000, { saves }).start());
  };
  assert.equal(check(FIXTURE), "0");
  const otherGame = Buffer.from(FIXTURE); otherGame.writeBigInt64LE(8n, 17);
  assert.equal(check(otherGame), "2");
  const otherVersion = Buffer.from(FIXTURE); otherVersion.writeBigInt64LE(11n, 25);
  assert.equal(check(otherVersion), "3");
  assert.equal(check(Buffer.from("invalid")), "4");
});

test("file stores honor SAV casing, native global data, dat character files and staged binary writes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-native-stores-"));
  try {
    await mkdir(path.join(root, "SAV"));
    const config = new Map([["セーブデータをSAVフォルダ内に作成する", "YES"]]);
    assert.equal(gameSaveDirectory(root, config), path.join(root, "SAV"));
    assert.equal(gameSaveDirectory(root, new Map()), root);
    const saves = new FileSaveStore(gameSaveDirectory(root, config), path.join(root, "dat"));
    const globals = new FileGlobalStore(path.join(root, "SAV", "global.sav"));
    const staged = new StagedStores(saves, globals);
    staged.stage();
    staged.saves.write("save00.sav", FIXTURE);
    staged.store.save({ GLOBAL: { "1": "42" } }, { ...METADATA, layout: [{ name: "GLOBAL", string: false, dimensions: [3], character: false }] });
    assert.equal(saves.read("save00.sav"), null);
    assert.deepEqual(staged.saves.read("save00.sav"), FIXTURE);
    staged.commit();
    assert.deepEqual(saves.read("save00.sav"), FIXTURE);
    assert.equal(globals.load("7")?.GLOBAL?.["1"], "42");
    assert.throws(() => globals.load("8"), /another game/);
    assert.throws(() => globals.load("0"), /another game/);
    saves.write("chara_テスト.dat", FIXTURE);
    assert.deepEqual(await readFile(path.join(root, "dat", "chara_テスト.dat")), FIXTURE);
    await writeFile(path.join(root, "SAV", "SAVE01.SAV"), FIXTURE);
    assert.deepEqual(saves.read("save01.sav"), FIXTURE);
    saves.remove("save01.sav");
    assert.equal(saves.read("SAVE01.SAV"), null);
    for (const name of ["../save.sav", "/tmp/save.sav", "chara_../escape.dat", "a\\b.dat"])
      assert.throws(() => saves.write(name, FIXTURE), /Invalid save file name/);
    assert.ok(saves.list().includes("chara_テスト.dat"));
    staged.stage();
    staged.saves.write("save02.sav", FIXTURE);
    staged.discard();
    assert.equal(saves.read("save02.sav"), null);
    assert.equal((await readdir(path.join(root, "SAV"))).some((name) => name.endsWith(".tmp")), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("server discovers native saves and persists new saves in Emuera's configured directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-native-http-"));
  let app: ReturnType<typeof createApp> | undefined;
  try {
    await mkdir(path.join(root, "SAV"));
    await writeFile(path.join(root, "SAV", "save00.sav"), FIXTURE);
    const game = script(`@SYSTEM_TITLE
LOADGLOBAL
CHKDATA 0
PRINTFORML existing={RESULT}
LOADDATA 0
@EVENTLOAD
PRINTFORML loaded={CHARANUM} %NAME:0%
GLOBAL:1 = 77
SAVEGLOBAL
SAVECHARA "hero", "hero", 0
SAVEDATA 300, "autosave"
QUIT`);
    game.root = root;
    game.tables.set("GAMEBASE", new Map([[0, ["コード", "7"]]]));
    game.config.set("セーブデータをSAVフォルダ内に作成する", "YES");
    game.config.set("セーブデータを圧縮して保存する", "YES");
    app = createApp(game);
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/start`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "game" }),
    });
    const snapshot = await response.json() as Snapshot;
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.equal(printed(snapshot), "existing=0\nloaded=1 A");
    const save = await readFile(path.join(root, "SAV", "save300.sav"));
    assert.equal(save.subarray(1, 8).toString(), "ERAZIP\n");
    assert.equal(readNativeSave(save).text, "autosave");
    assert.equal(readNativeSave(await readFile(path.join(root, "SAV", "global.sav"))).data.variables.GLOBAL?.["1"], "77");
    assert.equal(readNativeSave(await readFile(path.join(root, "dat", "chara_hero.dat"))).type, 3);
    assert.deepEqual(await readFile(path.join(root, "SAV", "save00.sav")), FIXTURE, "loading did not change the original");
    assert.equal(existsSync(path.join(root, ".era-typescript")), false);
  } finally {
    if (app?.listening) await new Promise<void>((resolve, reject) => app!.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("bundled Emuera saves decode and reach the actual game's gameplay input without changing disk files",
  { skip: !existsSync(path.join(GAME_ROOT, "sav", "save00.sav")) }, async () => {
    const saves = new MemorySaveStore();
    for (const name of ["save00.sav", "save99.sav", "save300.sav"]) {
      const bytes = readFileSync(path.join(GAME_ROOT, "sav", name));
      const record = readNativeSave(bytes);
      assert.equal(record.type, 0);
      assert.ok(record.data.characters > 0);
      saves.write(name, bytes);
    }
    const global = readNativeSave(readFileSync(path.join(GAME_ROOT, "sav", "global.sav")));
    assert.equal(global.type, 1);
    const game = await loadGame();
    const store = new MemoryGlobalStore();
    store.save(global.data.variables);
    indexScript(game, "@TEST_NATIVE_LOAD\nLOADGLOBAL\nLOADDATA 0", "native-test.ERB");
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { saves, store });
    let snapshot = runtime.start("TEST_NATIVE_LOAD");
    assert.notEqual(snapshot.status, "error", JSON.stringify(snapshot.error));
    assert.ok(snapshot.output.length > 0);
    for (let waits = 0; waits < 30 && snapshot.status === "waiting" && snapshot.input?.kind === "wait"; waits++)
      snapshot = snapshot.input.blocking ? runtime.timeout() : runtime.input("");
    assert.equal(snapshot.status, "waiting", JSON.stringify(snapshot.error));
    assert.equal(snapshot.input?.kind, "integer");
  });
