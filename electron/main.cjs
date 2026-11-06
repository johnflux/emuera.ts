const { app, BrowserWindow, clipboard, dialog, ipcMain, screen, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gamePaths = require("./game-paths.cjs");
const isSteamLaunch = require("./steam-launch.cjs");

let server;
let window;

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
        ...(process.env.SteamDeck === "1" ? ["--era-handheld"] : []),
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
