import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const beforePack = require("../electron/before-pack.cjs");
const gamePaths = require("../electron/game-paths.cjs");
const isSteamLaunch = require("../electron/steam-launch.cjs");
const { Arch } = require("electron-builder");
const appDir = path.resolve(import.meta.dirname, "..");

test("Steam launches default to fullscreen for games and non-Steam shortcuts", () => {
  assert.equal(isSteamLaunch({ SteamAppId: "480" }), true);
  assert.equal(isSteamLaunch({ SteamGameId: "12345678901234567890", SteamAppId: "0" }), true);
  assert.equal(isSteamLaunch({ SteamGameId: "12345678901234567890" }), true);
});

test("normal launches and unset Steam IDs remain windowed", () => {
  assert.equal(isSteamLaunch({}), false);
  for (const id of ["", "0", "000", "invalid", "-1", "1.5"]) {
    assert.equal(isSteamLaunch({ SteamAppId: id, SteamGameId: id }), false);
  }
  assert.equal(isSteamLaunch({ SteamDeck: "1" }), false);
});

test("desktop packages include Steam launch detection", () => {
  const { build } = require("../package.json");
  assert.ok(build.files.includes("electron/steam-launch.cjs"));
});

test("desktop window applies fullscreen only when launched through Steam", async () => {
  const source = readFileSync(path.join(appDir, "electron", "main.cjs"), "utf8");
  const desktopRequire = createRequire(path.join(appDir, "electron", "main.cjs"));
  for (const { steamLaunch, deck, width, height } of [
    { steamLaunch: false, deck: false, width: 1920, height: 1080 },
    { steamLaunch: true, deck: false, width: 1920, height: 1080 },
    { steamLaunch: true, deck: true, width: 1280, height: 800 },
    { steamLaunch: false, deck: false, width: 640, height: 480 },
  ]) {
    const stopped = new Error("Stop after checking window options");
    const electron = {
      app: {
        getPath: () => appDir,
        whenReady: () => new Promise(() => {}),
        on: () => {},
      },
      ipcMain: { handle: () => {} },
      screen: { getPrimaryDisplay: () => ({ workAreaSize: { width, height } }) },
      BrowserWindow: class {
        constructor(options: {
          fullscreen: boolean; width: number; height: number; minWidth: number; minHeight: number;
          webPreferences: { additionalArguments: string[] };
        }) {
          assert.equal(options.fullscreen, steamLaunch);
          assert.equal(options.width, Math.min(1200, width));
          assert.equal(options.height, Math.min(850, height));
          assert.equal(options.minWidth, Math.min(760, width));
          assert.equal(options.minHeight, Math.min(560, height));
          assert.equal(options.webPreferences.additionalArguments.join(), [
            ...(steamLaunch ? ["--era-steam"] : []),
            ...(deck ? ["--era-handheld"] : []),
          ].join());
          throw stopped;
        }
      },
    };
    const startup = runInNewContext(`${source}\ncreateWindow();`, {
      require: (id: string) => {
        if (id === "electron") return electron;
        if (id === "./steam-launch.cjs") {
          return () => isSteamLaunch(steamLaunch ? { SteamGameId: "12345678901234567890" } : {});
        }
        return desktopRequire(id);
      },
      __dirname: path.join(appDir, "electron"),
      process: { env: deck ? { SteamDeck: "1" } : {} },
    });
    await assert.rejects(startup, (error) => error === stopped);
  }
});

test("preload exposes the handheld default only with the desktop launch argument", () => {
  const source = readFileSync(path.join(appDir, "electron", "preload.cjs"), "utf8");
  for (const { handheld, steam } of [
    { handheld: false, steam: false },
    { handheld: false, steam: true },
    { handheld: true, steam: true },
  ]) {
    runInNewContext(source, {
      process: { argv: ["electron", ...(handheld ? ["--era-handheld"] : []), ...(steam ? ["--era-steam"] : [])] },
      require: () => ({
        ipcRenderer: {},
        contextBridge: {
          exposeInMainWorld(name: string, bridge: { handheld: boolean; steam: boolean }) {
            assert.equal(name, "eraDesktop");
            assert.equal(bridge.handheld, handheld);
            assert.equal(bridge.steam, steam);
          },
        },
      }),
    });
  }
});

test("Linux distribution uses a native x64 archive with a stable executable name", () => {
  const { scripts, build } = require("../package.json");
  assert.equal(scripts["dist:linux"], "npm run build && electron-builder --linux tar.gz --x64");
  assert.deepEqual(build.linux, {
    executableName: "emuera-ts",
    artifactName: "EraTs-${version}-linux-${arch}.${ext}",
    category: "Game",
    target: ["tar.gz"],
  });
});

test("desktop packaging rejects dependencies from another operating system", async () => {
  await assert.rejects(beforePack({
    electronPlatformName: process.platform === "win32" ? "darwin" : "win32",
    arch: Arch[process.arch],
    packager: { info: { appDir } },
  }), /Build on the target operating system and architecture/);
});

test("desktop packaging rejects dependencies from another architecture", async () => {
  await assert.rejects(beforePack({
    electronPlatformName: process.platform,
    arch: Arch[process.arch === "arm64" ? "x64" : "arm64"],
    packager: { info: { appDir } },
  }), /Build on the target operating system and architecture/);
});

test("desktop packaging loads the installed native libraries for the host target", async () => {
  await beforePack({
    electronPlatformName: process.platform,
    arch: Arch[process.arch],
    packager: { info: { appDir } },
  });
});

test("Windows ZIP games download and save beside the extracted executable", () => {
  const userData = path.resolve("appdata");
  const portableDirectory = path.resolve("usb");
  assert.deepEqual(gamePaths(userData, path.join(portableDirectory, "Era.exe"), "win32"), {
    installDirectory: path.join(portableDirectory, "GAMES"),
    searchDirectories: [path.join(portableDirectory, "GAMES"), path.join(userData, "GAMES")],
  });
});

test("Mac games download to application data and also search beside the executable", () => {
  const userData = path.resolve("appdata");
  const executable = path.resolve("installed", "Era.exe");
  assert.deepEqual(gamePaths(userData, executable, "darwin"), {
    installDirectory: path.join(userData, "GAMES"),
    searchDirectories: [path.join(userData, "GAMES"), path.join(path.dirname(executable), "GAMES")],
  });
});

test("Linux games download to application data and also search beside the executable", () => {
  const userData = path.resolve("config", "era-typescript");
  const executable = path.resolve("installed", "emuera-ts");
  assert.deepEqual(gamePaths(userData, executable, "linux"), {
    installDirectory: path.join(userData, "GAMES"),
    searchDirectories: [path.join(userData, "GAMES"), path.join(path.dirname(executable), "GAMES")],
  });
});
