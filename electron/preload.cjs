const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("eraDesktop", {
  steam: process.argv.includes("--era-steam"),
  quit: () => ipcRenderer.invoke("era:quit"),
  captureGame: () => ipcRenderer.invoke("era:capture-game"),
  writeClipboard: (text) => ipcRenderer.invoke("era:write-clipboard", text),
});
