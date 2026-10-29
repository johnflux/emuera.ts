import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createApp } from "../src/server.js";
import { discoverGames, emptyGame, gameDirectory, indexScript, loadGame, readText } from "../src/loader.js";
import { EraError } from "../src/model.js";

test("HTTP crash reports carry execution context and development breadcrumbs exclude input values", async () => {
  const script = `
    import { once } from "node:events";
    import { createApp } from ${JSON.stringify(new URL("../src/server.ts", import.meta.url).href)};
    import { emptyGame, indexScript } from ${JSON.stringify(new URL("../src/loader.ts", import.meta.url).href)};
    const game = emptyGame("/fixtures/crash-report");
    indexScript(game, "@SYSTEM_TITLE\\nWAIT\\nTINPUT 100, 0\\nINPUTS\\nTHROW fixture crash", "crash.ERB");
    const app = createApp(game, process.argv[1] === "true");
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    try {
      const base = "http://127.0.0.1:" + app.address().port;
      const post = async (route, data) => {
        const response = await fetch(base + route, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      };
      let state = await post("/api/start", { mode: "game" });
      await post("/api/prefetch", { session: state.session });
      state = await post("/api/input", { session: state.session, value: "" });
      state = await post("/api/timeout", { session: state.session });
      state = await post("/api/input", { session: state.session, value: "private-player-input" });
      console.log(JSON.stringify(state));
    } finally { app.closeAllConnections(); app.close(); }
  `;
  for (const development of [false, true]) {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script, String(development)]);
    const result = JSON.parse(stdout);
    assert.equal(result.status, "error");
    assert.equal(result.error.context.action, "input (string)");
    assert.equal(result.error.context.game, "crash-report");
    assert.equal(result.error.context.server.game, "game");
    assert.equal(result.error.context.server.session, result.session);
    assert.equal(result.error.context.server.step, result.step);
    assert.equal(result.error.context.server.action, "input");
    assert.equal(JSON.stringify(result.error).includes("private-player-input"), false);
    const breadcrumbs = stderr.split("\n").filter((line) => line.startsWith("[era execution] "))
      .map((line) => JSON.parse(line.slice("[era execution] ".length)));
    assert.equal(breadcrumbs.length, development ? 5 : 0);
    if (development) {
      assert.deepEqual(breadcrumbs.map((entry) => entry.action), ["start", "prefetch", "input (wait)", "timeout (integer)", "input (string)"]);
      assert.deepEqual(breadcrumbs.map((entry) => entry.step), [0, 1, 1, 2, 3]);
      for (const entry of breadcrumbs) {
        assert.equal(entry.session, result.session);
        assert.equal(entry.game, "game");
        assert.ok(entry.pid > 0 && entry.heapUsedMiB > 0 && entry.heapTotalMiB > 0 && entry.rssMiB > 0);
      }
    }
    assert.equal(stderr.includes("private-player-input"), false);
  }
});

test("lowercase and mixed-case folders work through discovery, loading and resource serving", async () => {
  const games = await mkdtemp(path.join(tmpdir(), "era-folder-case-"));
  try {
    for (const [name, erb, csv, resources, sound] of [
      ["lower", "erb", "csv", "resources", "sound"], ["mixed", "ErB", "CsV", "Resources", "Sound"],
    ] as const) {
      const root = path.join(games, name);
      await Promise.all([erb, csv, resources, sound].map((dir) => mkdir(path.join(root, dir), { recursive: true })));
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6foAAAAASUVORK5CYII=", "base64");
      await Promise.all([
        writeFile(path.join(root, erb, "title.erb"), `@SYSTEM_TITLE
PRINTFORML {SPRITEWIDTH("PIXEL")} {GCREATEFROMFILE(1, "pixel.png")} {GWIDTH(1)}
PLAYBGM "theme.ogg"
INPUT`),
        writeFile(path.join(root, csv, "Flag.csv"), "0,score"),
        writeFile(path.join(root, csv, "_default.config"), "フォントサイズ:20"),
        writeFile(path.join(root, resources, "sprites.csv"), "PIXEL,pixel.png"),
        writeFile(path.join(root, resources, "pixel.png"), png),
        writeFile(path.join(root, sound, "theme.ogg"), "audio fixture"),
      ]);
      assert.equal(gameDirectory(root, "ERB"), path.join(root, erb));
      assert.equal(gameDirectory(root, "CSV"), path.join(root, csv));
      assert.equal(gameDirectory(root, "resources"), path.join(root, resources));
      const game = await loadGame(root);
      assert.equal(game.names.get("FLAG")?.get("SCORE"), 0);
      assert.equal(game.config.get("フォントサイズ"), "20");
      const app = createApp(game);
      try {
        app.listen(0, "127.0.0.1");
        await once(app, "listening");
        const address = app.address();
        assert.ok(address && typeof address !== "string");
        const base = `http://127.0.0.1:${address.port}`;
        const run = await (await fetch(base + "/api/start", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "game" }),
        })).json();
        assert.equal(run.status, "waiting", JSON.stringify(run.error));
        assert.equal(run.output.filter((item: { type: string }) => item.type === "text")[0].text, "1 1 1");
        const sprite = await (await fetch(base + "/api/sprite?name=PIXEL")).json();
        assert.equal((await fetch(base + sprite.url)).status, 200);
        assert.equal(await (await fetch(base + run.audio.bgm.url)).text(), "audio fixture");
      } finally {
        if (app.listening) await new Promise<void>((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
      }
    }
    assert.deepEqual(discoverGames(games, []).map((game) => game.id), ["lower", "mixed"]);
  } finally { await rm(games, { recursive: true, force: true }); }
});

test("browser client state reaches start, input, timeout and prefetched continuations", async () => {
  const game = emptyGame();
  indexScript(game, `@SYSTEM_TITLE
PRINTFORML {CLIENTWIDTH()} {CLIENTHEIGHT()} {ISACTIVE()} {MOUSEX()} {MOUSEY()}
INPUT
PRINTFORML {CLIENTWIDTH()} {CLIENTHEIGHT()} {ISACTIVE()} {MOUSEX()} {MOUSEY()}
AWAIT 1
PRINTFORML {CLIENTWIDTH()} {CLIENTHEIGHT()} {ISACTIVE()} {MOUSEX()} {MOUSEY()}
WAIT
PRINTFORML {CLIENTWIDTH()} {CLIENTHEIGHT()} {ISACTIVE()} {MOUSEX()} {MOUSEY()}
RETURN`, "client.ERB");
  const app = createApp(game);
  try {
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (route: string, data: unknown) => fetch(base + route, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    const invalid = [null, [], {}, "bad", { width: -1, height: 1, active: true },
      { width: 1.5, height: 1, active: true }, { width: 1, height: 65536, active: true },
      { width: 1, height: 1, active: "yes" },
      ...[null, "1", 1.5, -2147483649, 2147483648].flatMap((position) =>
        ["mouseX", "mouseY"].map((axis) => ({ width: 1, height: 1, active: true, [axis]: position })))];
    for (const client of invalid)
      assert.equal((await post("/api/start", { mode: "game", client })).status, 400);
    const start = await (await post("/api/start", { mode: "game", client: { width: 1200, height: 800, active: true, mouseX: 120, mouseY: -45 } })).json();
    const session = start.session;
    assert.equal(start.output[0].text, "1200 800 1 120 -45");
    for (const client of invalid) {
      for (const route of ["/api/input", "/api/timeout", "/api/prefetch"])
        assert.equal((await post(route, { session, value: "0", client })).status, 400, route);
    }
    const input = await (await post("/api/input", { session, value: "0", client: { width: 900, height: 600, active: false, mouseX: -10, mouseY: 20 } })).json();
    assert.equal(input.output.at(-1).text, "900 600 0 -10 20");
    const timeout = await (await post("/api/timeout", { session, client: { width: 800, height: 500, active: true } })).json();
    assert.equal(timeout.output.at(-1).text, "800 500 1 0 0");
    assert.equal((await (await post("/api/prefetch", { session, client: { width: 700, height: 400, active: false, mouseX: 35, mouseY: -70 } })).json()).prefetched, true);
    const continued = await (await post("/api/input", { session, value: "" })).json();
    assert.equal(continued.output.at(-1).text, "700 400 0 35 -70");
  } finally {
    if (app.listening) await new Promise<void>((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});

test("local sound routes enforce file confinement and resume keeps audio state without replaying effects", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-audio-server-"));
  const game = emptyGame(root);
  indexScript(game, `@SYSTEM_TITLE
SETBGMVOLUME 40
SETSOUNDVOLUME 20
PLAYBGM "theme.ogg"
PLAYSOUND "theme.ogg", 3
INPUT`, "audio.ERB");
  const app = createApp([{ id: "audio", title: "Audio", game }]);
  try {
    await mkdir(path.join(root, "sound"));
    await writeFile(path.join(root, "sound", "theme.ogg"), "fixture");
    await writeFile(path.join(root, "sound", "private.txt"), "not audio");
    await writeFile(path.join(root, "outside.ogg"), "outside");
    await symlink(path.join(root, "outside.ogg"), path.join(root, "sound", "escape.ogg"));
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (route: string, data: unknown) => fetch(base + route, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    const run = await (await post("/api/start", { mode: "game", game: "audio" })).json();
    assert.equal(run.status, "waiting", JSON.stringify(run.error));
    assert.equal(run.audio.bgmVolume, 40);
    assert.equal(run.audio.sounds[0].repeat, 3);
    const sound = await fetch(base + run.audio.bgm.url);
    assert.equal(sound.status, 200);
    assert.equal(sound.headers.get("content-type"), "audio/ogg");
    assert.equal(await sound.text(), "fixture");
    assert.equal((await fetch(base + "/games/audio/sound/theme.ogg")).status, 200);
    for (const filename of ["private.txt", "escape.ogg", "..%2foutside.ogg"]) {
      assert.equal((await fetch(base + "/sound/" + filename)).status, 403, filename);
    }
    assert.equal((await fetch(base + "/sound/missing.wav")).status, 404);
    const resumed = await (await post("/api/resume", { session: run.session })).json();
    assert.deepEqual(resumed.audio, { ...run.audio, sounds: [], stopSounds: true });
  } finally {
    if (app.listening) await new Promise<void>((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("games are discovered in GAMES folders directly or one level down, after the known ones", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "era-games-"));
  try {
    for (const root of ["Known/Known-master", "era Two", "Nested/inner", "Nested/other", "Era-Two", "Empty/none"]) {
      await mkdir(path.join(dir, root, "ERB"), { recursive: true });
      if (!root.startsWith("Empty")) await mkdir(path.join(dir, root, "CSV"), { recursive: true });
    }
    const known = [{ id: "k", title: "Known", root: path.join(dir, "Known/Known-master") }];
    assert.deepEqual(discoverGames(dir, known), [
      known[0],
      { id: "era-two", title: "Era-Two", root: path.join(dir, "Era-Two") },
      { id: "nested", title: "Nested", root: path.join(dir, "Nested/inner") },
      { id: "era-two-2", title: "era Two", root: path.join(dir, "era Two") },
    ]);
    assert.deepEqual(discoverGames(path.join(dir, "missing"), known), known);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("loader decodes legacy files and indexes CSV, sprites, headers and scripts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-loader-"));
  try {
    await Promise.all(["ERB", "CSV", "resources"].map((dir) => mkdir(path.join(root, dir))));
    await Promise.all([
      writeFile(path.join(root, "ERB", "start.ERB"), "@SYSTEM_TITLE\n[IF FEATURE]\nPRINTL hello\n[ELSE]\nTHROW header not loaded\n[ENDIF]"),
      writeFile(path.join(root, "ERB", "vars.ERH"), "#DIM CONST EXAMPLE = 4\n#DEFINE FEATURE 0"),
      writeFile(path.join(root, "ERB", "Custom.ERD"), "0,first\n2,second"),
      writeFile(path.join(root, "CSV", "Flag.csv"), "0,zero\n7,score"),
      writeFile(path.join(root, "CSV", "_Replace.csv"), "お金の単位, coins\n単位の位置, 後"),
      writeFile(path.join(root, "resources", "images.csv"), [
        "TEST,picture.png,1,2,30,40",
        "TEST,other.png,0,0,1,1",
        "TYPO,picture.png,1,2,30,40]",
        "MOVING,ANIME,20,10",
        "MOVING,picture.png,0,0,20,10,1,2,400",
        "MOVING,picture.png,20,0,20,10",
        "EMPTY,ANIME,5,5",
        "BADANIME,ANIME,0,5",
        "NOEXT,picture",
      ].join("\n")),
      writeFile(path.join(root, "legacy.txt"), Buffer.from([0x82, 0xa0])),
      writeFile(path.join(root, "utf16.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hello", "utf16le")])),
    ]);
    const game = await loadGame(root);
    assert.equal(game.scriptFiles, 2);
    assert.equal(game.names.get("FLAG")?.get("SCORE"), 7);
    assert.equal(game.names.get("CUSTOM")?.get("SECOND"), 2);
    assert.deepEqual(game.money, { label: "coins", first: false });
    assert.equal(game.sprites.get("TEST")?.width, 30);
    // Emuera keeps the first definition and treats an unparseable rectangle as the whole image.
    assert.equal(game.sprites.get("TEST")?.file, "picture.png");
    assert.deepEqual({ ...game.sprites.get("TYPO") }, { file: "picture.png", x: 0, y: 0, width: 0, height: 0 });
    assert.deepEqual(game.sprites.get("MOVING")?.animation?.frames.map((frame) => [frame.x, frame.offsetX ?? 0, frame.delay]), [[0, 1, 400], [20, 0, 1000]]);
    assert.deepEqual(game.sprites.get("EMPTY")?.animation?.frames, []);
    assert.equal(game.sprites.has("BADANIME"), false);
    assert.deepEqual(game.diagnostics.map((diagnostic) => diagnostic.message).sort(),
      ["Invalid animation sprite size: BADANIME", "Resource image has no file extension: NOEXT", "Sprite name already used: TEST"]);
    assert.deepEqual(game.routines.get("SYSTEM_TITLE")![0]!.lines.map((line) => line.text), ["PRINTL hello"]);
    assert.equal(await readText(path.join(root, "legacy.txt")), "\u3042");
    assert.equal(await readText(path.join(root, "utf16.txt")), "hello");
    await writeFile(path.join(root, "ERB", "Custom.ERD"), "bad,second");
    await assert.rejects(loadGame(root), /Invalid ERD index definition/);
  } finally { await rm(root, { recursive: true }); }
});
test("ERD tables allow unnamed indices while rejecting invalid numeric indices", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-erd-"));
  try {
    await Promise.all(["ERB", "CSV"].map((dir) => mkdir(path.join(root, dir))));
    const file = path.join(root, "ERB", "Custom.ERD");
    await writeFile(file, "\uFEFF; Reserved indices\n0,first\n1,\n2\n3, ; unused\n4,second\n");
    const game = await loadGame(root);
    assert.deepEqual([...game.names.get("CUSTOM")!], [["FIRST", 0], ["SECOND", 4]]);
    assert.deepEqual(game.diagnostics, []);
    for (const row of ["bad,second", "bad,", "-1,", "1.5,", "9007199254740992,", ",second", ","]) {
      await writeFile(file, row);
      await assert.rejects(loadGame(root), /Invalid ERD index definition/, row);
    }
  } finally { await rm(root, { recursive: true }); }
});
test("character CSV multiline blocks become single fields and unknown-field diagnostics retain source lines", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-character-csv-"));
  try {
    await Promise.all(["ERB", "CSV"].map((dir) => mkdir(path.join(root, dir))));
    await writeFile(path.join(root, "CSV", "Chara1.csv"), [
      "番号,1", "名前,Example", "{", "CSTR,0,", "first", "second", "}",
      "UNKNOWN,0,ignored", "CSTR,1,after",
    ].join("\n"));
    const game = await loadGame(root);
    assert.deepEqual(game.characters.get(1)?.rows, [
      ["番号", "1"], ["名前", "Example"], ["CSTR", "0", "first second"],
      ["UNKNOWN", "0", "ignored"], ["CSTR", "1", "after"],
    ]);
    assert.deepEqual(game.diagnostics, [{
      file: "CSV/Chara1.csv", line: 8,
      message: 'Unknown character CSV field "UNKNOWN"; this row is ignored',
    }]);
    await writeFile(path.join(root, "CSV", "Chara1.csv"), "番号,1\n{\nCSTR,0,x");
    await assert.rejects(loadGame(root), (error: unknown) =>
      error instanceof EraError && error.message === "Unclosed multiline statement"
      && error.source?.file === "CSV/Chara1.csv" && error.source.line === 2);
  } finally { await rm(root, { recursive: true }); }
});
test("HTTP UI, isolated sessions, real image bytes, sprite metadata, errors and traversal protection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-http-"));
  const game = emptyGame(root);
  indexScript(game, "@SYSTEM_TITLE\nINPUT\nPRINTFORML {RESULT}\nDRAWLINE", "fixture.ERB");
  const app = createApp(game);
  try {
    await mkdir(path.join(root, "resources"));
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6foAAAAASUVORK5CYII=", "base64");
    await writeFile(path.join(root, "resources", "pixel.png"), png);
    await writeFile(path.join(root, "private.png"), png);
    await symlink(path.join(root, "private.png"), path.join(root, "resources", "escape.png"));
    game.sprites.set("PIXEL", { file: "pixel.png", x: 0, y: 0, width: 1, height: 1 });
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (route: string, data: unknown, headers = {}) => fetch(base + route, {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data),
    });
    const page = await fetch(base);
    assert.match(await page.text(), /id="game"[^>]*>eraToho The World</);
    assert.match(page.headers.get("content-security-policy")!, /script-src 'self'/);
    assert.equal((await fetch(base + "/rooms/shrine.svg")).status, 404);
    for (const season of ["spring", "summer", "autumn", "winter"]) {
      const decoration = await fetch(base + `/decoration/deco_corner_flower_${season}.png`);
      assert.equal(decoration.status, 200);
      assert.equal(decoration.headers.get("content-type"), "image/png");
      const bytes = Buffer.from(await decoration.arrayBuffer());
      assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    }
    assert.equal((await fetch(base + "/decoration/deco_corner_flower_unknown.png")).status, 404);
    const font = await fetch(base + "/fonts/BIZUDGothic-Regular.ttf");
    assert.equal(font.status, 200);
    assert.equal(font.headers.get("content-type"), "font/ttf");
    const fontBytes = Buffer.from(await font.arrayBuffer());
    assert.equal(fontBytes.readUInt32BE(0), 0x00010000);
    const license = await fetch(base + "/fonts/OFL.txt");
    assert.equal(license.status, 200);
    assert.match(await license.text(), /SIL OPEN FONT LICENSE/);
    assert.equal((await fetch(base + "/fonts/not-a-font.ttf")).status, 404);
    const area = await fetch(base + "/areas/0-shrine.svg");
    assert.equal(area.status, 200);
    assert.equal(area.headers.get("content-type"), "image/svg+xml");
    assert.match(await area.text(), /^<svg /);
    assert.equal((await fetch(base + "/areas/99-nowhere.svg")).status, 404);
    const areas = await (await fetch(base + "/api/areas")).json();
    assert.match(areas["0"]["spring-day"].middle, /^\/areas\/0-shrine\/spring-day-middle\.png\?v=\d+$/);
    const areaPicture = await fetch(base + areas["0"]["spring-day"].left);
    assert.equal(areaPicture.status, 200);
    assert.equal(areaPicture.headers.get("content-type"), "image/png");
    assert.equal((await fetch(base + "/areas/0-shrine/monsoon-day-left.png")).status, 404);
    assert.equal((await fetch(base + "/areas/0-shrine/..%2f..%2fapp.js")).status, 404);
    const maps = await fetch(base + "/api/maps");
    assert.equal(maps.status, 200);
    assert.equal(typeof await maps.json(), "object");
    assert.equal((await fetch(base + "/maps/not-a-map.webp")).status, 404);
    assert.equal((await fetch(base + "/maps/..%2fapp.js")).status, 404);
    const runtimeInfo = await (await fetch(base + "/api/runtime")).json();
    assert.equal(runtimeInfo.development, false);
    assert.equal(typeof runtimeInfo.instance, "string");
    assert.equal((await (await fetch(base + "/api/runtime")).json()).instance, runtimeInfo.instance);
    assert.deepEqual(runtimeInfo.display, { foreground: "#c0c0c0", background: "#000000", selection: "#ffff00", font: "ＭＳ ゴシック" });
    for (const display of ["#fff", { foreground: "red" }, { font: 'a"b' }, { unknown: "#000000" }])
      assert.equal((await post("/api/start", { mode: "game", display })).status, 400);
    const session = await (await post("/api/start", { mode: "game" })).json();
    assert.equal(session.status, "waiting");
    assert.equal((await post("/api/input", { session: session.session, value: "bad" })).status, 400);
    assert.equal((await post("/api/timeout", { session: session.session })).status, 400);
    for (const columns of [0, 1001, 1.5, "120"]) {
      assert.equal((await post("/api/input", { session: session.session, value: "17", columns })).status, 400);
    }
    assert.equal(session.step, 1);
    const restored = await (await post("/api/resume", { session: session.session })).json();
    assert.equal(restored.mode, "game");
    assert.equal(restored.step, 1);
    assert.deepEqual(restored.history.map((entry: { advance: string }) => entry.advance), ["start"]);
    assert.deepEqual(restored.history[0].snapshot.input, session.input);
    assert.equal((await post("/api/input", { session: session.session, step: 0, value: "17" })).status, 409);
    assert.equal((await post("/api/resume", { session: "missing" })).status, 404);
    assert.equal((await post("/api/resume", {})).status, 400);
    const resumed = await (await post("/api/input", { session: session.session, step: 1, value: "17", columns: 90, display: { foreground: "#ABCDEF" } })).json();
    assert.equal(resumed.status, "halted");
    assert.equal(resumed.step, 2);
    assert.equal(resumed.output[0].text, "17");
    assert.equal(resumed.output[0].style.color, "#abcdef");
    assert.equal(resumed.output[2].text, "-".repeat(90));
    assert.equal((await post("/api/input", { session: session.session, value: "0" })).status, 404);
    assert.equal((await post("/api/resume", { session: session.session })).status, 404);
    const sprite = await (await fetch(base + "/api/sprite?name=pixel")).json();
    assert.equal(sprite.url, "/resources/pixel.png");
    const image = await fetch(base + sprite.url);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    assert.equal((await fetch(base + "/resources/..%2fprivate.png")).status, 403);
    assert.equal((await fetch(base + "/resources/escape.png")).status, 403);
    assert.equal((await fetch(base + "/resources/not-found.png")).status, 404);
    assert.equal((await post("/api/start", { mode: "game" }, { Origin: "http://other.example" })).status, 403);
    assert.equal((await fetch(base + "/api/compatibility")).status, 200);
    assert.equal((await post("/api/start", { mode: "unknown" })).status, 400);
    for (const columns of [0, 1001, 1.5, "120"]) {
      assert.equal((await post("/api/start", { mode: "game", columns })).status, 400);
    }
    const demo = await (await post("/api/start", { mode: "demo" })).json();
    assert.equal(demo.status, "waiting", JSON.stringify(demo.error));
    const arithmetic = await (await post("/api/input", { session: demo.session, value: "1" })).json();
    assert.ok(arithmetic.output.some((item: { text?: string }) => item.text === "Result from CALL: 42"));
    const singleDigit = await (await post("/api/input", { session: demo.session, value: "3" })).json();
    assert.deepEqual(singleDigit.input, { kind: "integer", singleCharacter: true });
    const singleText = await (await post("/api/input", { session: demo.session, value: "7" })).json();
    assert.ok(singleText.output.some((item: { text?: string }) => item.text === "Received digit: 7"));
    assert.deepEqual(singleText.input, { kind: "string", singleCharacter: true });
    const menu = await (await post("/api/input", { session: demo.session, value: "x" })).json();
    assert.ok(menu.output.some((item: { text?: string }) => item.text === "Received character: x"));
    assert.deepEqual(menu.input, { kind: "integer" });
    const demoRun = await (await post("/api/resume", { session: demo.session })).json();
    assert.equal(demoRun.mode, "demo");
    assert.equal(demoRun.step, 5);
    assert.deepEqual(demoRun.history.map((entry: { advance: string }) => entry.advance), ["start", "input", "input", "input", "input"]);
    assert.deepEqual(demoRun.history.at(-1).snapshot.output, menu.output);
  } finally {
    if (app.listening) await new Promise<void>((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true });
  }
});
test("several games: menu catalogue, per-game runs, sprites, resources and compatibility", async () => {
  const roots = await Promise.all(["era-first-", "era-second-"].map((prefix) => mkdtemp(path.join(tmpdir(), prefix))));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6foAAAAASUVORK5CYII=", "base64");
  const [first, second] = roots.map((root, i) => {
    const game = emptyGame(root);
    indexScript(game, `@SYSTEM_TITLE\nPRINTL game ${i + 1}\nINPUT`, "fixture.ERB");
    game.sprites.set("PIXEL", { file: `pixel${i + 1}.png`, x: 0, y: 0, width: 1, height: 1 });
    game.config.set("文字色", i ? "0,255,0" : "255,0,0");
    return game;
  });
  const app = createApp([{ id: "one", title: "First", game: first! }, { id: "two", title: "Second", game: second! }]);
  try {
    await Promise.all(roots.map(async (root, i) => {
      await mkdir(path.join(root, "resources"));
      await writeFile(path.join(root, "resources", `pixel${i + 1}.png`), png);
    }));
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (route: string, data: unknown) => fetch(base + route, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    const info = await (await fetch(base + "/api/runtime")).json();
    assert.deepEqual(info.games.map((game: { id: string; title: string; display: { foreground: string } }) => [game.id, game.title, game.display.foreground]),
      [["one", "First", "#ff0000"], ["two", "Second", "#00ff00"]]);
    assert.deepEqual(info.display, info.games[0].display);
    const text = (snapshot: { output: { text?: string }[] }) => snapshot.output.map((item) => item.text).join("");
    const defaultRun = await (await post("/api/start", { mode: "game" })).json();
    assert.equal(text(defaultRun), "game 1");
    const run = await (await post("/api/start", { mode: "game", game: "two" })).json();
    assert.equal(text(run), "game 2");
    const restored = await (await post("/api/resume", { session: run.session })).json();
    assert.deepEqual([restored.mode, restored.game], ["game", "two"]);
    assert.equal((await post("/api/start", { mode: "game", game: "three" })).status, 404);
    const sprite = await (await fetch(base + "/api/sprite?name=pixel&game=two")).json();
    assert.equal(sprite.url, "/games/two/resources/pixel2.png");
    assert.deepEqual(Buffer.from(await (await fetch(base + sprite.url)).arrayBuffer()), png);
    assert.equal((await (await fetch(base + "/api/sprite?name=pixel")).json()).url, "/resources/pixel1.png");
    assert.equal((await fetch(base + "/resources/pixel2.png")).status, 404);
    assert.equal((await fetch(base + "/games/two/resources/pixel1.png")).status, 404);
    assert.equal((await fetch(base + "/games/three/resources/pixel1.png")).status, 404);
    assert.equal((await fetch(base + "/api/compatibility?game=two")).status, 200);
    assert.equal((await fetch(base + "/api/compatibility?game=three")).status, 404);
    assert.equal((await post("/api/start", { mode: "game", game: "two", debug: "yes" })).status, 400);
    const debugRun = await (await post("/api/start", { mode: "game", game: "two", debug: true })).json();
    assert.equal(text(debugRun), "game 2");
    assert.equal((await (await post("/api/resume", { session: debugRun.session })).json()).debug, true);
    assert.equal(restored.debug, false);
    assert.equal(second!.debug, undefined);
  } finally {
    if (app.listening) await new Promise<void>((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
    await Promise.all(roots.map((root) => rm(root, { recursive: true })));
  }
});
test("development runtime metadata changes across server instances", async () => {
  const first = createApp(emptyGame(), true);
  const second = createApp(emptyGame(), true);
  try {
    const info = async (app: ReturnType<typeof createApp>) => {
      app.listen(0, "127.0.0.1");
      await once(app, "listening");
      const address = app.address();
      assert.ok(address && typeof address !== "string");
      return (await fetch(`http://127.0.0.1:${address.port}/api/runtime`)).json();
    };
    const [a, b] = await Promise.all([info(first), info(second)]);
    assert.equal(a.development, true);
    assert.equal(b.development, true);
    assert.notEqual(a.instance, b.instance);
  } finally {
    await Promise.all([first, second].map((app) => new Promise<void>((resolve, reject) => {
      if (!app.listening) { resolve(); return; }
      app.close((error) => error ? reject(error) : resolve());
    })));
  }
});
