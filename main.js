/**
 * Electron Main Process
 * ─────────────────────
 * Creates the browser window and loads the React app.
 * In dev mode, connects to Vite's HMR server.
 * In production, loads the built dist/index.html.
 */

const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

let secureInput;
try {
  // Graceful fallback if native module isn't compiled yet during dev
  const addonPath = path.join(__dirname, "build", "Release", "secure_input.node");
  if (fs.existsSync(addonPath)) {
    secureInput = require(addonPath);
  }
} catch (e) {
  console.warn("Native Secure Input module not loaded");
}

const IS_DEV = !app.isPackaged;
const VITE_DEV_URL = "http://localhost:5173";

// Extreme Privacy: Disable all Chromium Telemetry and Logging
app.commandLine.appendSwitch("disable-logging");
app.commandLine.appendSwitch("v", "0");
app.commandLine.appendSwitch("disable-http-cache");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-default-apps");
app.commandLine.appendSwitch("disable-dev-shm-usage"); // Prevent sharing memory with OS
app.commandLine.appendSwitch("ignore-certificate-errors", "true"); // Allow volatile self-signed local certs

// IPC Routers for Native C++ Proxy
ipcMain.on("secure-enable", () => {
  if (secureInput) secureInput.enableSecureInput();
});
ipcMain.on("secure-disable", () => {
  if (secureInput) secureInput.disableSecureInput();
});
ipcMain.on("secure-append", (event, buffer) => {
  if (secureInput) secureInput.append(buffer);
});
ipcMain.on("secure-concealed-copy", (event, text) => {
  if (secureInput) secureInput.concealedCopy(text);
});
ipcMain.on("secure-backspace", () => {
  if (secureInput) secureInput.backspace();
});
ipcMain.on("secure-wipe", () => {
  if (secureInput) secureInput.wipe();
});
ipcMain.handle("secure-drain", async () => {
  if (!secureInput) return Buffer.alloc(0);
  // Returns Buffer containing payload and securely wipes the C++ physical RAM in one command
  return secureInput.drain(); 
});

function createWindow() {
  const { session } = require('electron');
  
  // Force total volatile memory space. Zero disk IO.
  const volSession = session.fromPartition('in-memory', { cache: false });
  volSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false); // Deny all by default
  });
  volSession.setSpellCheckerEnabled(false);
  volSession.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');

  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 700,
    minHeight: 500,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#0a0a0f",
    webPreferences: {
      session: volSession,
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open external links in the system browser, not inside Electron
  // Extreme Privacy: Block Remote Code Execution via hallucinatory payload URIs
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Extreme Privacy: Defeat screen scrapers and OS video recording
  win.setContentProtection(true);

  // Send Blur/Focus to React for Mission Control Scrambling
  win.on('blur', () => {
    win.webContents.send('window-blur');
  });
  win.on('focus', () => {
    win.webContents.send('window-focus');
  });

  if (IS_DEV) {
    win.loadURL(VITE_DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, "dist", "index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
