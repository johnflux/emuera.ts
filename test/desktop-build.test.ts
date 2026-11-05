import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import path from "node:path";

const require = createRequire(import.meta.url);
const beforePack = require("../electron/before-pack.cjs");
const gamePaths = require("../electron/game-paths.cjs");
const { Arch } = require("electron-builder");
const appDir = path.resolve(import.meta.dirname, "..");

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

test("portable games use the original executable directory, not its extraction directory", () => {
  const userData = path.resolve("appdata");
  const portableDirectory = path.resolve("usb");
  assert.deepEqual(gamePaths(userData, path.resolve("temporary", "Era.exe"), portableDirectory), {
    installDirectory: path.join(portableDirectory, "GAMES"),
    searchDirectories: [path.join(portableDirectory, "GAMES"), path.join(userData, "GAMES")],
  });
});

test("installed games download to AppData and also search beside the executable", () => {
  const userData = path.resolve("appdata");
  const executable = path.resolve("installed", "Era.exe");
  assert.deepEqual(gamePaths(userData, executable, undefined), {
    installDirectory: path.join(userData, "GAMES"),
    searchDirectories: [path.join(userData, "GAMES"), path.join(path.dirname(executable), "GAMES")],
  });
});
