import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import path from "node:path";

const require = createRequire(import.meta.url);
const beforePack = require("../electron/before-pack.cjs");
const gamePaths = require("../electron/game-paths.cjs");
const { Arch } = require("electron-builder");
const appDir = path.resolve(import.meta.dirname, "..");

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
