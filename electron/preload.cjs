const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("eraDesktop", {
  steam: process.argv.includes("--era-steam"),
  quit: () => ipcRenderer.invoke("era:quit"),
  writeClipboard: (text) => ipcRenderer.invoke("era:write-clipboard", text),
});
