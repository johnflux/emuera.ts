import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { downloadedCatalogGames, GAME_CATALOG, installGame } from "../src/library.js";
import { createApp } from "../src/server.js";
import { discoverGames, HOTPATCH_ROOT } from "../src/loader.js";

test("library loads and refreshes without the optional starter panel", async () => {
  let tabs: Element[] = [];
  class Element {
    textContent = "";
    hidden = false;
    disabled = false;
    dataset = {};
    children: Element[] = [];
    attributes = new Map<string, string>();
    listeners = new Map<string, () => void>();
    classList = { add() {}, remove() {}, toggle() {} };
    append(...children: Element[]) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
    querySelectorAll() { return tabs; }
  }
  tabs = [new Element(), new Element()];
  const nodes = new Map(["library", "game-grid", "library-message", "library-progress", "library-progress-text", "library-refresh",
    "catalog-note", "installed-count", "catalog-count", "status", "library-toggle"]
    .map((id) => [`#${id}`, new Element()]));
  const source = await readFile(new URL("../web/library.js", import.meta.url), "utf8");
  const createLibrary = runInNewContext(`${source.replace("export function", "function")}\ncreateLibrary`, {
    document: {
      body: new Element(),
      querySelector: (selector: string) => nodes.get(selector) ?? null,
      createElement: () => new Element(),
    },
  });
  const requests: string[] = [];
  let finishInstall!: () => void;
  const library = createLibrary({
    api: async (url: string) => {
      requests.push(url);
      if (url === "/api/library/install") {
        await new Promise<void>((resolve) => { finishInstall = resolve; });
        return { ok: true };
      }
      return {
        installed: [], downloaded: [],
        catalog: [
          { id: "tw", title: "eraToho The World", genre: "Life simulation", folder: "tw", blurb: "Touhou life simulation." },
          { id: "erauma", title: "EraUma", genre: "Training / story", folder: "erauma", stars: 119, source: "https://gitgud.io/umaera/erauma", repository: "https://gitgud.io/umaera/erauma.git", downloadOnly: true, requirements: "Not playable here." },
          { id: "erablue-resort", title: "erablue_resort", genre: "Management / adventure", folder: "erablue_resort", stars: 57, source: "https://gitgud.io/era-games/erablue_resort" },
        ],
      };
    },
    gamesChanged: async () => {},
    confirmAction: async () => true,
  });
  await library.show();
  assert.equal(nodes.get("#library-message")!.textContent, "Select Play game to start.");
  assert.equal(nodes.get("#catalog-count")!.textContent, 3);
  assert.equal(nodes.get("#game-grid")!.children.length, 1);
  tabs[1]!.listeners.get("click")!();
  const catalogText = (node: Element): string => node.textContent + node.children.map(catalogText).join("");
  assert.match(catalogText(nodes.get("#game-grid")!), /Download source/);
  assert.match(catalogText(nodes.get("#game-grid")!), /GAMES\/.downloads\/erauma/);
  assert.doesNotMatch(catalogText(nodes.get("#game-grid")!), /Compatibility:|full gameplay is not yet supported|through the protagonist-name prompt/);
  const findElement = (node: Element, predicate: (candidate: Element) => boolean): Element | undefined =>
    predicate(node) ? node : node.children.map((child) => findElement(child, predicate)).find(Boolean);
  findElement(nodes.get("#game-grid")!, (node) => node.textContent === "Download source" && node.listeners.has("click"))!.listeners.get("click")!();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(nodes.get("#library-progress")!.hidden, false);
  assert.equal(nodes.get("#library-progress-text")!.textContent, "Downloading EraUma source...");
  assert.match(nodes.get("#library-message")!.textContent, /Downloading EraUma source into GAMES\/.downloads\/erauma/);
  assert.match(catalogText(nodes.get("#game-grid")!), /Downloading\.\.\./);
  finishInstall();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(nodes.get("#library-progress")!.hidden, true);
  assert.match(nodes.get("#library-message")!.textContent, /source downloaded for inspection/);
  nodes.get("#library-refresh")!.listeners.get("click")!();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, ["/api/library", "/api/library/install", "/api/library", "/api/library/refresh", "/api/library"]);
  assert.match(nodes.get("#library-message")!.textContent, /Library refreshed/);
  assert.equal(nodes.get("#library-refresh")!.disabled, false);
});

test("catalog has unique ids and verified group blurbs and restricts clone sources", () => {
  assert.equal(new Set(GAME_CATALOG.map((game) => game.id)).size, GAME_CATALOG.length);
  assert.equal(GAME_CATALOG.length, 13);
  const popular = GAME_CATALOG.filter((game) => game.stars !== undefined);
  assert.equal(popular.length, 10);
  assert.deepEqual(popular.map((game) => game.stars), [119, 91, 87, 65, 58, 57, 32, 27, 24, 17]);
  for (const game of GAME_CATALOG) {
    assert.match(game.id, /^[a-z0-9-]+$/);
    assert.equal(path.basename(game.folder), game.folder);
    if (game.repository) assert.match(game.repository, /^https:\/\/gitgud\.io\/(?:[\w-]+\/)+[\w-]+\.git$/);
  }
  assert.equal(GAME_CATALOG.find((game) => game.id === "erablue-resort")?.blurb,
    "Manage a resort and explore dungeons with Granblue Fantasy characters.");
  const uma = GAME_CATALOG.find((game) => game.id === "erauma")!;
  assert.equal(uma.repository, "https://gitgud.io/umaera/erauma.git");
  assert.equal(uma.downloadOnly, true);
  assert.equal(uma.submodules, true);
  assert.match(uma.requirements ?? "", /not playable in this interpreter/);
  const tw = GAME_CATALOG.find((game) => game.id === "tw")!;
  assert.equal(tw.monogram, "TW");
  assert.equal(tw.archive, "https://gitgud.io/Legis1998/anon-tw/-/archive/anon-tw_eng-modding/anon-tw-anon-tw_eng-modding.zip");
  assert.equal(tw.repository, undefined);
  assert.equal(GAME_CATALOG.find((game) => game.id === "k")?.monogram, "K");
});

test("EraUma source downloads without becoming a playable game", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-library-download-"));
  const games = path.join(root, "GAMES");
  const uma = GAME_CATALOG.find((game) => game.id === "erauma")!;
  try {
    await installGame(uma, games, async (_game, destination) => {
      await mkdir(path.join(destination, "engine"), { recursive: true });
      await writeFile(path.join(destination, "README.md"), "EraUma source");
    });
    const checkout = path.join(games, ".downloads", "erauma");
    assert.equal(await readFile(path.join(checkout, "README.md"), "utf8"), "EraUma source");
    assert.deepEqual(await downloadedCatalogGames(games), ["erauma"]);
    assert.deepEqual(discoverGames(games, []), []);
    await assert.rejects(installGame(uma, games, async () => assert.fail("must not replace downloaded source")), /already exists/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("installation publishes a complete game, preserves existing folders, and cleans failed clones", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-library-install-"));
  const games = path.join(root, "GAMES");
  const game = GAME_CATALOG.find((game) => game.id === "eraas")!;
  try {
    let attempts = 0;
    const clone = async (_game: typeof game, destination: string) => {
      attempts++;
      assert.equal((await readdir(games)).includes(game.folder), false);
      await mkdir(path.join(destination, "ERB"), { recursive: true });
      await mkdir(path.join(destination, "CSV"));
      await writeFile(path.join(destination, "ERB", "start.erb"), "@SYSTEM_TITLE\nPRINTL Installed\nINPUT");
    };
    await installGame(game, games, clone);
    const erb = path.join(games, game.folder, "ERB", "start.erb");
    assert.match(await readFile(erb, "utf8"), /Installed/);
    await assert.rejects(installGame(game, games, clone), /already exists/);
    assert.equal(attempts, 1);
    assert.match(await readFile(erb, "utf8"), /Installed/);
    const other = GAME_CATALOG.find((game) => game.id === "erablue-resort")!;
    await assert.rejects(installGame(other, games, async () => { throw new Error("network unavailable"); }), /network unavailable/);
    await assert.rejects(installGame(other, games, async (_game, destination) => { await mkdir(destination); }), /Expected one game/);
    assert.deepEqual(await readdir(root), ["GAMES"]);
    assert.deepEqual(await readdir(games), [game.folder]);
    await mkdir(path.join(games, other.folder));
    await assert.rejects(installGame(other, games, clone), /already exists/);
    const manual = GAME_CATALOG.find((game) => game.id === "k")!;
    await assert.rejects(installGame(manual, games, clone), /manual download/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recognized games retain their ids when extracted directly or into an archive subfolder", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-library-known-"));
  try {
    for (const dir of ["eraTohoK", "eraRanceK/archive-main"]) {
      await mkdir(path.join(root, dir, "ERB"), { recursive: true });
      await mkdir(path.join(root, dir, "CSV"));
    }
    const known = [
      { id: "k", title: "eraTohoK", root: path.join(root, "eraTohoK/eraTohoK-master") },
      { id: "rancek", title: "eraRanceK", root: path.join(root, "eraRanceK") },
    ];
    assert.deepEqual(discoverGames(root, known), [
      { ...known[0], root: path.join(root, "eraTohoK") },
      { ...known[1], root: path.join(root, "eraRanceK/archive-main") },
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("empty library serves home, refresh discovers games live, and stop releases sessions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-library-http-"));
  const app = createApp([], false, path.join(root, "GAMES"));
  try {
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (url: string, data: unknown) => fetch(base + url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    const page = await (await fetch(base)).text();
    assert.match(page, /class="is-home"/);
    assert.match(page, /id="installed-tab"/);
    assert.match(page, /id="catalog-tab"/);
    for (const asset of ["/library.js", "/library.css"]) assert.equal((await fetch(base + asset)).status, 200);
    const initial = await (await fetch(base + "/api/library")).json();
    assert.deepEqual(initial.installed, []);
    assert.deepEqual(initial.downloaded, []);
    assert.equal(initial.catalog.length, GAME_CATALOG.length);
    for (const id of ["tw", "k", "rancek"]) {
      assert.ok(initial.catalog.some((game: { id: string }) => game.id === id));
    }
    assert.deepEqual((await (await fetch(base + "/api/runtime")).json()).games, []);
    assert.equal((await post("/api/start", { mode: "game" })).status, 404);
    assert.equal((await post("/api/start", { mode: "demo" })).status, 200);
    for (const id of ["../../escape", "https://example.com/repo.git", "k", null])
      assert.equal((await post("/api/library/install", { id })).status, 400);
    assert.equal((await fetch(base + "/api/library/install", {
      method: "POST", headers: { Origin: "https://example.com", "Content-Type": "application/json" },
      body: JSON.stringify({ id: "eraas" }),
    })).status, 403);
    const gameRoot = path.join(root, "GAMES", "eraAS");
    await mkdir(path.join(gameRoot, "ERB"), { recursive: true });
    await mkdir(path.join(gameRoot, "CSV"));
    await writeFile(path.join(gameRoot, "ERB", "start.erb"), "@SYSTEM_TITLE\nPRINTL Library fixture\nINPUT");
    await writeFile(path.join(gameRoot, "ERB", "Custom.ERD"), "0,first\n1,\n2,second");
    assert.equal((await post("/api/library/refresh", {})).status, 200);
    const library = await (await fetch(base + "/api/library")).json();
    assert.equal(library.installed.length, 1);
    assert.equal(library.installed[0].catalogId, "eraas");
    assert.equal(library.installed[0].title, "eraAS");
    assert.equal((await post("/api/library/refresh", {})).status, 200);
    assert.equal((await (await fetch(base + "/api/runtime")).json()).games.length, 1);
    const run = await (await post("/api/start", { mode: "game", game: library.installed[0].id })).json();
    assert.equal(run.status, "waiting");
    assert.match(JSON.stringify(run.output), /Library fixture/);
    assert.equal((await post("/api/stop", { session: run.session })).status, 200);
    assert.equal((await post("/api/resume", { session: run.session })).status, 404);
    assert.equal((await post("/api/stop", { session: 12 })).status, 400);
  } finally {
    app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("clean distribution discovers TW, K and Rance only after adding their folders", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-library-unbundled-"));
  const app = createApp([], false, path.join(root, "GAMES"));
  try {
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const patchFiles = (await readdir(HOTPATCH_ROOT)).filter((file) => /\.erb$/i.test(file));
    const patchTexts = await Promise.all(patchFiles.map((file) => readFile(path.join(HOTPATCH_ROOT, file), "utf8")));
    const twStubs = patchTexts.flatMap((text) => [...text.matchAll(/^@(?!HOTPATCH_)(\w+)/gm)].map((match) => `@${match[1]}\nRETURN`)).join("\n");
    for (const game of GAME_CATALOG.filter((game) => ["tw", "k", "rancek"].includes(game.id))) {
      await installGame(game.archive || game.repository ? game : { ...game, repository: "fixture" }, path.join(root, "GAMES"), async (_game, destination) => {
        const gameRoot = path.join(destination, game.archive ? "archive-branch-name" : "");
        await mkdir(path.join(gameRoot, "ERB"), { recursive: true });
        await mkdir(path.join(gameRoot, "CSV"));
        await writeFile(path.join(gameRoot, "ERB", "start.erb"), "@SYSTEM_TITLE\nPRINTL Installed\nINPUT\n" + (game.id === "tw" ? twStubs : ""));
      });
    }
    const response = await fetch(base + "/api/library/refresh", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(response.status, 200);
    const library = await (await fetch(base + "/api/library")).json();
    assert.deepEqual(library.installed.map((game: { id: string }) => game.id), ["tw", "k", "rancek"]);
    assert.deepEqual(library.installed.map((game: { catalogId: string }) => game.catalogId), ["tw", "k", "rancek"]);
    assert.equal(library.installed[0].monogram, "TW");
    assert.equal(library.installed[1].monogram, "K");
    assert.ok((await readdir(path.join(root, "GAMES", GAME_CATALOG[0]!.folder))).includes("ERB"));
  } finally {
    app.close();
    await rm(root, { recursive: true, force: true });
  }
});
