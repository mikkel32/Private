/**
 * Electron Preload Script
 * ───────────────────────
 * Minimal preload — exposes nothing to the renderer.
 * The React app communicates directly with the FastAPI server over HTTP.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  onWindowBlur: (callback) => ipcRenderer.on("window-blur", () => callback()),
  onWindowFocus: (callback) => ipcRenderer.on("window-focus", () => callback()),
  enableSecureInput: () => ipcRenderer.send("secure-enable"),
  disableSecureInput: () => ipcRenderer.send("secure-disable"),
  appendBuffer: (buffer) => ipcRenderer.send("secure-append", buffer),
  backspace: () => ipcRenderer.send("secure-backspace"),
  wipeVault: () => ipcRenderer.send("secure-wipe"),
  drainVault: () => ipcRenderer.invoke("secure-drain"),
});
