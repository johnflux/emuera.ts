import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { crc32 } from "node:zlib";
import { downloadArchive, extractArchive } from "../src/archive.js";
import { GAME_CATALOG, installGame } from "../src/library.js";

function zip(entries: { name: string; content?: string; mode?: number; size?: number; method?: number }[]): Buffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.from(entry.content ?? "");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(entry.method ?? 0, 8);
    header.writeUInt32LE(crc32(content), 14);
    header.writeUInt32LE(content.length, 18);
    header.writeUInt32LE(entry.size ?? content.length, 22);
    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(0x0314, 4);
    header.copy(directory, 6, 4, 30);
    directory.writeUInt32LE(((entry.mode ?? 0o100644) * 65536) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    local.push(header, name, content);
    offset += header.length + name.length + content.length;
  }
  const centralData = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralData, end]);
}

test("ZIP installation downloads, safely extracts, and flattens archive wrapper folders without Git", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-zip-install-"));
  const content = zip([
    { name: "release/ERB/title.erb", content: "@SYSTEM_TITLE\nPRINTL From ZIP\nINPUT" },
    { name: "release/CSV/Flag.csv", content: "0,example" },
    { name: "release/resources/portrait.txt", content: "image fixture" },
    { name: "release/.gitattributes", content: "*.png filter=lfs diff=lfs merge=lfs -text\n" },
  ]);
  const server = createServer((request, response) => {
    assert.equal(request.headers["sec-fetch-mode"], "same-origin");
    response.end(request.url === "/missing.zip" ? zip([{ name: "README.txt", content: "Not a game" }]) : content);
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    for (const id of ["tw", "eranas"]) {
      const game = GAME_CATALOG.find((game) => game.id === id)!;
      assert.ok(game.archive);
      await installGame({ ...game, archive: `http://127.0.0.1:${address.port}/${id}.zip` }, path.join(root, "GAMES"));
      const installed = path.join(root, "GAMES", game.folder);
      assert.match(await readFile(path.join(installed, "ERB", "title.erb"), "utf8"), /From ZIP/);
      assert.equal(await readFile(path.join(installed, "CSV", "Flag.csv"), "utf8"), "0,example");
      assert.equal(await readFile(path.join(installed, "resources", "portrait.txt"), "utf8"), "image fixture");
    }
    const tw = GAME_CATALOG.find((game) => game.id === "tw")!;
    await assert.rejects(installGame({ ...tw, archive: `http://127.0.0.1:${address.port}/missing.zip` }, path.join(root, "OtherGames")), /Expected one game/);
    assert.deepEqual((await readdir(root)).sort(), ["GAMES", "OtherGames"]);
    assert.deepEqual(await readdir(path.join(root, "OtherGames")), []);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("ZIP extraction refuses traversal, links, special files, duplicate paths, corrupt input, and excessive sizes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-zip-invalid-"));
  try {
    const cases = [
      { entries: [{ name: "../outside.txt", content: "escape" }], error: /invalid relative path|Unsafe ZIP path/ },
      { entries: [{ name: "/absolute.txt" }], error: /absolute path|outside the game folder/ },
      { entries: [{ name: "C:/windows.txt" }], error: /absolute path|Unsafe ZIP path/ },
      { entries: [{ name: "dir\\windows.txt" }], error: /invalid characters|Unsafe ZIP path/ },
      { entries: [{ name: "link", content: "../outside", mode: 0o120777 }], error: /links and special files/ },
      { entries: [{ name: "device", mode: 0o020600 }], error: /links and special files/ },
      { entries: [{ name: "same.txt" }, { name: "same.txt" }], error: /EEXIST/ },
      { entries: [{ name: "huge.txt", size: 1024 * 1024 * 1024 + 1, method: 8 }], error: /1 GiB limit/ },
    ];
    for (const [i, fixture] of cases.entries()) {
      const file = path.join(root, `${i}.zip`);
      await writeFile(file, zip(fixture.entries));
      await assert.rejects(extractArchive(file, path.join(root, `out-${i}`)), fixture.error);
    }
    const corrupt = path.join(root, "corrupt.zip");
    await writeFile(corrupt, "not a ZIP");
    await assert.rejects(extractArchive(corrupt, path.join(root, "corrupt")), /end of central directory|not enough bytes/i);
    await assert.rejects(readFile(path.join(root, "outside.txt")), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("archive download reports HTTP errors and rejects oversized responses", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-zip-download-"));
  const server = createServer((request, response) => {
    if (request.url === "/large") {
      response.writeHead(200, { "Content-Length": String(513 * 1024 * 1024) });
      response.flushHeaders();
    } else { response.writeHead(403); response.end("Login required"); }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    await assert.rejects(downloadArchive(base + "/denied", path.join(root, "failed.zip")), /HTTP 403/);
    await assert.rejects(downloadArchive(base + "/large", path.join(root, "large.zip")), /512 MiB limit/);
  } finally {
    server.closeAllConnections();
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
