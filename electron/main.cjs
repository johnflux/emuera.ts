const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gamePaths = require("./game-paths.cjs");

let server;
let window;

ipcMain.handle("era:write-clipboard", (event, text) => {
  const address = server?.address();
  if (!window || event.sender !== window.webContents || !address || typeof address === "string"
    || event.senderFrame?.url !== `http://127.0.0.1:${address.port}/`) {
    console.error("Clipboard request rejected: unexpected sender");
    throw new Error("Clipboard access is only available from the game window");
  }
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
  window = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 760,
    minHeight: 560,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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
