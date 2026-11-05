const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("eraDesktop", {
  writeClipboard: (text) => ipcRenderer.invoke("era:write-clipboard", text),
});
