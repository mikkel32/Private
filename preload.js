/**
 * Electron Preload Script
 * ───────────────────────
 * Minimal preload — exposes nothing to the renderer.
 * The React app communicates directly with the FastAPI server over HTTP.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // P13-6 REMEDIATION: process.platform REMOVED — OS fingerprint leak
  onWindowBlur: (callback) => ipcRenderer.on("window-blur", () => callback()),
  onWindowFocus: (callback) => ipcRenderer.on("window-focus", () => callback()),
  onSecureKeyTick: (callback) => ipcRenderer.on("secure-key-tick", (_, actionId) => callback(actionId)),
  offSecureKeyTick: () => ipcRenderer.removeAllListeners("secure-key-tick"),
  enableSecureInput: () => ipcRenderer.send("secure-enable"),
  disableSecureInput: () => ipcRenderer.send("secure-disable"),
  isHardwareLocked: () => ipcRenderer.invoke("secure-check-hardware"),
  isDebuggerAttached: () => ipcRenderer.invoke("secure-check-debugger"),
  appendBuffer: (buffer) => ipcRenderer.send("secure-append", buffer),
  backspace: () => ipcRenderer.send("secure-backspace"),
  wipeVault: () => ipcRenderer.send("secure-wipe"),
  // P16-13 REMEDIATION: stopGeneration REMOVED — no handler in main.js (dead API surface)
  // P4-1 REMEDIATION: drainVault REMOVED from preload. It exposed raw plaintext to ANY
  // JS in the renderer context. Drain is now main-process-only via secure-network-dispatch.
  syncCanvasBounds: (bounds) => ipcRenderer.send("secure-canvas-bounds", bounds),
  setSecureLayerVisibility: (visible) => ipcRenderer.send("secure-layer-visibility", visible),
  // Protocol Omega: Network Dispatch
  secureNetworkDispatch: (configObj) => ipcRenderer.send("secure-network-dispatch", configObj),
  fetchHistory: (id, mode) => ipcRenderer.send("fetch-history", id, mode),
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
