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
  concealedCopy: (text) => ipcRenderer.send("secure-concealed-copy", text),
  backspace: () => ipcRenderer.send("secure-backspace"),
  wipeVault: () => ipcRenderer.send("secure-wipe"),
  drainVault: () => ipcRenderer.invoke("secure-drain"),
  // Protocol Omega: Network Dispatch
  secureNetworkDispatch: (skeletonBuffer) => ipcRenderer.send("secure-network-dispatch", skeletonBuffer),
  fetchHistory: (id) => ipcRenderer.send("fetch-history", id),
  
  // Natively routes raw Uint8Array from main.js directly. No Javascript Strings.
  onCanvasFrame: (callback) => ipcRenderer.on("secure-canvas-frame", (_, ptr) => callback(ptr)),
  
  onStreamEnd: (callback) => ipcRenderer.on("secure-stream-end", () => callback()),
  
  offCanvasFrame: () => ipcRenderer.removeAllListeners("secure-canvas-frame"),
  offStreamEvents: () => {
      ipcRenderer.removeAllListeners("secure-stream-end");
  }
});
