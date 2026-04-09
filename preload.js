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
});
