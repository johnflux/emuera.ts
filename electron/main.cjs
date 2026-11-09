const { app, BrowserWindow, clipboard, dialog, ipcMain, screen, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gamePaths = require("./game-paths.cjs");
const isSteamLaunch = require("./steam-launch.cjs");
const { compareVersions, getLatestVersion } = require("./update-check.cjs");

let server;
let window;
let updateCheckStarted = false;

function requireGameWindow(event, action) {
  const address = server?.address();
  if (!window || event.sender !== window.webContents || !address || typeof address === "string"
    || event.senderFrame?.url !== `http://127.0.0.1:${address.port}/`) {
    console.error(`${action} request rejected: unexpected sender`);
    throw new Error(`${action} is only available from the game window`);
  }
}

ipcMain.handle("era:quit", (event) => {
  requireGameWindow(event, "Exit");
  app.quit();
});

ipcMain.handle("era:write-clipboard", (event, text) => {
  requireGameWindow(event, "Clipboard access");
  if (typeof text !== "string" || text.length > 1_000_000) {
    console.error("Clipboard request rejected: invalid text");
    throw new Error("Clipboard text must be a string of at most 1,000,000 characters");
  }
  clipboard.writeText(text);
});

async function checkForUpdates() {
  if (!app.isPackaged || updateCheckStarted) return;
  updateCheckStarted = true;
  try {
    const currentVersion = app.getVersion();
    const latestVersion = await getLatestVersion();
    if (compareVersions(latestVersion, currentVersion) <= 0 || !window) return;
    const { response } = await dialog.showMessageBox(window, {
      type: "info",
      title: "Update available",
      message: `Era ${latestVersion} is available`,
      detail: `You are using Era ${currentVersion}. Open the release page to download it?`,
      buttons: ["Open release page", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      try {
        await shell.openExternal("https://github.com/johnflux/emuera.ts/releases/latest");
      } catch (error) {
        console.error("Failed to open the Era release page:", error);
        dialog.showErrorBox("Unable to open the release page",
          error instanceof Error ? error.message : String(error));
      }
    }
  } catch (error) {
    console.error("Failed to check for Era updates:", error);
  }
}

async function createWindow() {
  const { installDirectory, searchDirectories } = gamePaths(
    app.getPath("userData"), app.getPath("exe"),
  );
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const steamLaunch = isSteamLaunch();
  window = new BrowserWindow({
    width: Math.min(1200, width),
    height: Math.min(850, height),
    minWidth: Math.min(760, width),
    minHeight: Math.min(560, height),
    fullscreen: steamLaunch,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        ...(steamLaunch ? ["--era-steam"] : []),
      ],
    },
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => { window = undefined; });
  if (app.isPackaged && process.platform === "win32") {
    await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(
      "<!doctype html><title>Era</title><body style=\"font:16px system-ui;background:#171923;color:#eee;padding:24px\"><h2>Starting Era</h2><p>Downloading eraToho The World if needed...</p>",
    ));
    const library = await import(pathToFileURL(path.join(app.getAppPath(), "dist", "library.js")).href);
    try {
      await library.installStarterGame(installDirectory, searchDirectories);
    } catch (error) {
      console.error("Failed to install starter game:", error);
      dialog.showErrorBox("Unable to install eraToho The World",
        `${error instanceof Error ? error.message : String(error)}\n\nYou can install it from the library or restart Era to retry.`);
    }
  }
  if (!window) return;
  const serverModule = await import(pathToFileURL(path.join(app.getAppPath(), "dist", "server.js")).href);
  server = await serverModule.startServer(0, installDirectory, false, searchDirectories);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Desktop server did not bind to a TCP port");

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== `http://127.0.0.1:${address.port}/`) event.preventDefault();
  });
  await window.loadURL(`http://127.0.0.1:${address.port}/`);
  void checkForUpdates();
}

app.whenReady().then(createWindow).catch((error) => {
  console.error("Failed to start desktop app:", error);
  dialog.showErrorBox("Unable to start Era", error instanceof Error ? error.message : String(error));
  app.quit();
});

app.on("activate", () => {
  if (!window) void createWindow().catch((error) => {
    console.error("Failed to reopen desktop window:", error);
    dialog.showErrorBox("Unable to start Era", error instanceof Error ? error.message : String(error));
  });
});

app.on("before-quit", () => {
  server?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
