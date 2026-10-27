const { app, BrowserWindow, dialog, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let server;
let window;

async function createWindow() {
  const gamesDir = path.join(app.getPath("userData"), "GAMES");
  const serverModule = await import(pathToFileURL(path.join(app.getAppPath(), "dist", "server.js")).href);
  server = await serverModule.startServer(0, gamesDir);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Desktop server did not bind to a TCP port");

  window = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 760,
    minHeight: 560,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== `http://127.0.0.1:${address.port}/`) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => { window = undefined; });
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
