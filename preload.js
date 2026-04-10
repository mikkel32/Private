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
  onSecureKeyTick: (callback) => ipcRenderer.on("secure-key-tick", (_, actionId) => callback(actionId)),
  offSecureKeyTick: () => ipcRenderer.removeAllListeners("secure-key-tick"),
  enableSecureInput: () => ipcRenderer.send("secure-enable"),
  disableSecureInput: () => ipcRenderer.send("secure-disable"),
  isHardwareLocked: () => ipcRenderer.invoke("secure-check-hardware"),
  initSAB: (sab) => ipcRenderer.send("secure-init-sab", sab),
  appendBuffer: (buffer) => ipcRenderer.send("secure-append", buffer),
  backspace: () => ipcRenderer.send("secure-backspace"),
  wipeVault: () => ipcRenderer.send("secure-wipe"),
  drainVault: () => ipcRenderer.invoke("secure-drain"),
  // Protocol Omega: Network Dispatch
  secureNetworkDispatch: (configObj) => ipcRenderer.send("secure-network-dispatch", configObj),
  fetchHistory: (id) => ipcRenderer.send("fetch-history", id),
  checkServerHealth: () => ipcRenderer.invoke("check-server-health"),
  exportVault: (id) => ipcRenderer.send("export-vault", id),
  onVaultExportKey: (callback) => ipcRenderer.on("vault-export-key", (_, buffer) => callback(buffer)),
  offVaultExportKey: () => ipcRenderer.removeAllListeners("vault-export-key"),
  
  // Natively routes raw Uint8Array from main.js directly. No Javascript Strings.
  onCanvasFrame: (callback) => ipcRenderer.on("secure-canvas-frame", (_, ptr) => callback(ptr)),
  
  onStreamEnd: (callback) => ipcRenderer.on("secure-stream-end", () => callback()),
  
  offCanvasFrame: () => ipcRenderer.removeAllListeners("secure-canvas-frame"),
  offStreamEvents: () => {
      ipcRenderer.removeAllListeners("secure-stream-end");
  }
});
