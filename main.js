/**
 * Electron Main Process
 * ─────────────────────
 * Creates the browser window and loads the React app.
 * In dev mode, connects to Vite's HMR server.
 * In production, loads the built dist/index.html.
 */

const { app, BrowserWindow, ipcMain, net } = require("electron");
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
app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp"); // Defeat WebRTC IP leaks

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

// Protocol Omega: Remote Splice and Dispatch
ipcMain.on("secure-network-dispatch", (event, skeletonBuffer) => {
  fs.appendFileSync("ipc-debug.log", "Received secure-network-dispatch\n");
  if (!secureInput) return fs.appendFileSync("ipc-debug.log", "secureInput is null\n");

  try {
    fs.appendFileSync("ipc-debug.log", `Attempting to drain...\n`);
    const rawSecretBuffer = secureInput.drain(); 
    if (!rawSecretBuffer) return fs.appendFileSync("ipc-debug.log", `rawSecretBuffer is empty\n`);

    // Buffer is a Node primitive, it avoids V8 Immutable String generation
    const skeleton = Buffer.from(skeletonBuffer);
    const secret = Buffer.from(rawSecretBuffer);

    fs.appendFileSync("ipc-debug.log", `Skeleton length: ${skeleton.length}, Secret length: ${secret.length}\n`);

    const anchorText = "<|SECURE_INJECT|>";
    const index = skeleton.indexOf(anchorText);

    if (index !== -1) {
      const part1 = skeleton.slice(0, index);
      const part2 = skeleton.slice(index + anchorText.length);
      const finalPayload = Buffer.concat([part1, secret, part2]);

      fs.appendFileSync("ipc-debug.log", `Payload constructed. Sending POST request to backend...\n`);

      const req = net.request({
        url: "https://127.0.0.1:8420/v1/chat/stream_canvas",
        method: 'POST',
      });
      req.setHeader('Content-Type', 'application/json');
      
      req.on('response', (res) => {
        fs.appendFileSync("ipc-debug.log", `stream_canvas response: ${res.statusCode}\n`);
        if (res.statusCode !== 200) {
          res.on('data', d => fs.appendFileSync("ipc-debug.log", `stream_canvas ERROR: ${d}\n`));
          return event.sender.send("secure-stream-end");
        }
        let currentBuffer = Buffer.alloc(0);
        
        res.on('data', (chunk) => {
           currentBuffer = Buffer.concat([currentBuffer, chunk]);
           
           // Extract PNG chunks natively in C++ via Buffer length parsing
           while (currentBuffer.length >= 4) {
               const len = currentBuffer.readUInt32BE(0);
               if (currentBuffer.length >= 4 + len) {
                   const pngData = currentBuffer.slice(4, 4 + len);
                   currentBuffer = currentBuffer.slice(4 + len);
                   // Fire raw Uint8Array over IPC boundary directly to Canvas API
                   event.sender.send("secure-canvas-frame", pngData);
               } else {
                   break;
               }
           }
        });
        res.on('end', () => {
           event.sender.send("secure-stream-end");
        });
        res.on('error', (err) => {
           console.error("Stream Error", err);
           event.sender.send("secure-stream-end");
        });
      });

      req.on('error', (err) => {
        fs.appendFileSync("ipc-debug.log", `stream_canvas NETWORK ERROR: ${err}\n`);
        console.error("Network Error", err);
        event.sender.send("secure-stream-end");
      });

      req.end(finalPayload);

      // Natively wipe completely before passing control back to GC
      finalPayload.fill(0);
      skeleton.fill(0);
      part1.fill(0);
      part2.fill(0);
      secret.fill(0);
    }
  } catch (err) {
    fs.appendFileSync("ipc-debug.log", `Splice error: ${err}\n`);
    console.error("Splice error:", err);
  }
});

ipcMain.on("fetch-history", (event, id) => {
  const targetUrl = `https://127.0.0.1:8420/v1/chat/render/${id}`;
  fs.appendFileSync("ipc-debug.log", `Issuing fetch-history to: ${targetUrl}\n`);
  const req = net.request({
    url: targetUrl,
    method: 'GET'
  });
  
  req.on('response', (res) => {
    fs.appendFileSync("ipc-debug.log", `fetch-history response: ${res.statusCode}\n`);
    if (res.statusCode !== 200) {
      res.on('data', d => fs.appendFileSync("ipc-debug.log", `fetch-history ERROR: ${d}\n`));
      return;
    }
    let currentBuffer = Buffer.alloc(0);
    res.on('data', (chunk) => {
       currentBuffer = Buffer.concat([currentBuffer, chunk]);
       while (currentBuffer.length >= 4) {
           const len = currentBuffer.readUInt32BE(0);
           if (currentBuffer.length >= 4 + len) {
               const pngData = currentBuffer.slice(4, 4 + len);
               currentBuffer = currentBuffer.slice(4 + len);
               event.sender.send("secure-canvas-frame", pngData);
           } else {
               break;
           }
       }
    });

    res.on('end', () => {
       event.sender.send("secure-stream-end");
    });
  });
  req.on('error', (err) => {
      fs.appendFileSync("ipc-debug.log", `fetch-history NETWORK ERROR: ${err}\n`);
      console.error("History fetch error:", err);
  });
  req.end();
});

ipcMain.on("export-vault", (event, id) => {
  const os = require('os');
  const targetEncPath = path.join(os.homedir(), 'Desktop', `Monolith_Vault_${id.substring(0, 8)}.enc`);
  
  const req = net.request({
    url: `https://127.0.0.1:8420/v1/chat/export/${id}`,
    method: 'GET'
  });
  
  req.on('response', (res) => {
    if (res.statusCode !== 200) {
      console.error("Export Vault error:", res.statusCode);
      return;
    }
    const fileStream = fs.createWriteStream(targetEncPath);
    res.on('data', chunk => fileStream.write(chunk));
    res.on('end', () => {
       fileStream.end();
       
       // The file is secure. Now securely request the PNG raster of the password.
       const reqKey = net.request({
         url: `https://127.0.0.1:8420/v1/chat/export/key/${id}`,
         method: 'GET'
       });
       
       reqKey.on('response', (kRes) => {
           let pngBuffer = Buffer.alloc(0);
           kRes.on('data', chunk => {
               pngBuffer = Buffer.concat([pngBuffer, chunk]);
           });
           kRes.on('end', () => {
               event.sender.send("vault-export-key", pngBuffer);
           });
       });
       reqKey.end();
    });
  });
  req.on('error', err => console.error("Export Vault Network Error:", err));
  req.end();
});

function createWindow() {
  const { session } = require('electron');
  
  // Force total volatile memory space. Zero disk IO.
  const volSession = session.fromPartition('in-memory', { cache: false });
  volSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false); // Deny all by default
  });
  volSession.setSpellCheckerEnabled(false);

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
  
  if (secureInput) {
      secureInput.registerCallback((actionId) => {
          // Fire IPC directly from OS-level to React for length tracking
          win.webContents.send("secure-key-tick", actionId);
      });
  }

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
