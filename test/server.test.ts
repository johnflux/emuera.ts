import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createApp } from "../src/server.js";
import { emptyGame, indexScript, loadGame, readText } from "../src/loader.js";

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
    assert.match(await page.text(), /id="game"[^>]*>Bundled game</);
    assert.match(page.headers.get("content-security-policy")!, /script-src 'self'/);
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
    const resumed = await (await post("/api/input", { session: session.session, value: "17", columns: 90, display: { foreground: "#ABCDEF" } })).json();
    assert.equal(resumed.status, "halted");
    assert.equal(resumed.output[0].text, "17");
    assert.equal(resumed.output[0].style.color, "#abcdef");
    assert.equal(resumed.output[2].text, "-".repeat(90));
    assert.equal((await post("/api/input", { session: session.session, value: "0" })).status, 404);
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
  } finally {
    if (app.listening) await new Promise<void>((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true });
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
