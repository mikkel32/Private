/**
 * Electron Main Process
 * ─────────────────────
 * Creates the browser window and loads the React app.
 * In dev mode, connects to Vite's HMR server.
 * In production, loads the built dist/index.html.
 */

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");

let secureInput;
try {
  // Graceful fallback if native module isn't compiled yet during dev
  const addonPath = path.join(__dirname, "build", "Release", "secure_input.node");
  if (fs.existsSync(addonPath)) {
    secureInput = require(addonPath);
    if (secureInput.mlockallEnvironment) {
       secureInput.mlockallEnvironment();
       console.log("V8 Node Process physically locked to RAM via mlockall");
    }
  }
} catch (e) {
  if (process.platform === 'linux' && e.message && e.message.includes("FATAL: Monolith Kernel Level security mandates root privileges")) {
      console.error(e.message);
      process.exit(1);
  }
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
// Strict TLS Pinning
let rawFingerprint = "";
try {
  rawFingerprint = fs.readFileSync(path.join(__dirname, "cert_fingerprint.txt"), "utf-8").trim();
} catch (e) {
  console.error("Missing cert_fingerprint.txt! Local MITM protection inactive.");
}

function validateFingerprint(res, req) {
  const cert = res.socket.getPeerCertificate();
  if (!cert || cert.fingerprint256 !== rawFingerprint) {
    console.error(`FATAL MITM INTERCEPT: Fingerprint mismatch! Expected ${rawFingerprint}, got ${cert ? cert.fingerprint256 : 'none'}`);
    req.destroy();
    return false;
  }
  return true;
}

// Deprecated Chromium net.request callback

app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp"); // Defeat WebRTC IP leaks

// IPC Routers for Native C++ Proxy
ipcMain.handle("secure-check-hardware", () => {
  if (secureInput && secureInput.isHardwareLocked) {
    return secureInput.isHardwareLocked();
  }
  return false;
});

ipcMain.handle("secure-check-debugger", () => {
  if (secureInput && secureInput.isDebuggerAttached) {
    return secureInput.isDebuggerAttached();
  }
  return false;
});

ipcMain.on("secure-enable", () => {
  if (secureInput) secureInput.enableSecureInput();
});
ipcMain.on("secure-disable", () => {
  if (secureInput) secureInput.disableSecureInput();
});
ipcMain.on("secure-append", (event, buffer) => {
  if (secureInput) secureInput.append(buffer);
});

let sharedArrayMap = null;
let sharedArrayOffset = 0;

ipcMain.on("secure-init-sab", (event, buffer) => {
  // Receives SharedArrayBuffer from renderer
  sharedArrayMap = Buffer.from(buffer);
});

// A ticker that flushes SAB natively
setInterval(() => {
  if (sharedArrayMap && secureInput) {
    // Look for pending bytes
    const len = sharedArrayMap.readUInt32BE(0);
    if (len > 0) {
      const slice = sharedArrayMap.slice(4, 4 + len);
      secureInput.append(slice);
      
      // Zero out
      sharedArrayMap.fill(0, 0, 4 + len);
    }
  }
}, 50);

ipcMain.on("secure-backspace", () => {
  if (secureInput) secureInput.backspace();
});
ipcMain.on("secure-wipe", () => {
  if (secureInput) secureInput.wipe();
});

let extremeModeActive = false;
ipcMain.handle("toggle-extreme-mode", (event, enable) => {
  extremeModeActive = enable;
  if (secureInput) {
    if (enable) {
      secureInput.disableSecureInput();
      console.log("EXTREME MODE: Physical Hardware Keyboards Disabled. Ghost Protocol ONLY.");
    } else {
      secureInput.enableSecureInput();
      console.log("EXTREME MODE: Restored Physical Keyboard processing.");
    }
  }
  return extremeModeActive;
});
ipcMain.handle("secure-drain", async () => {
  if (!secureInput) return Buffer.alloc(0);
  // Returns Buffer containing payload and securely wipes the C++ physical RAM in one command
  return secureInput.drain(); 
});

// Protocol Omega: Remote Splice and Dispatch
ipcMain.on("secure-network-dispatch", (event, configObj) => {
  if (!secureInput) return;

  try {
    const rawSecretBuffer = secureInput.drain(); 
    if (!rawSecretBuffer) return;

    const secret = Buffer.from(rawSecretBuffer);
    const convIdBuf = Buffer.from(configObj.conversation_id || "default", "utf-8");

    // Format: 
    // uint8 enable_thinking 
    // uint32 thinking_budget 
    // uint32 max_tokens 
    // double temperature 
    // double top_p 
    // uint32 convId_len, convId Buf
    // uint32 secret_len, secret Buf
    
    // Size = 1 + 4 + 4 + 8 + 8 + 4 + convIdBuf.length + 4 + secret.length
    const fixedAllocSize = 1 + 4 + 4 + 8 + 8 + 4 + 4;
    const finalPayload = Buffer.alloc(fixedAllocSize + convIdBuf.length + secret.length);
    
    let offset = 0;
    finalPayload.writeUInt8(configObj.enable_thinking, offset); offset += 1;
    finalPayload.writeUInt32BE(configObj.thinking_budget, offset); offset += 4;
    finalPayload.writeUInt32BE(configObj.max_tokens, offset); offset += 4;
    finalPayload.writeDoubleBE(configObj.temperature, offset); offset += 8;
    finalPayload.writeDoubleBE(configObj.top_p, offset); offset += 8;
    
    finalPayload.writeUInt32BE(convIdBuf.length, offset); offset += 4;
    convIdBuf.copy(finalPayload, offset); offset += convIdBuf.length;
    
    finalPayload.writeUInt32BE(secret.length, offset); offset += 4;
    secret.copy(finalPayload, offset); offset += secret.length;

    const req = https.request("https://127.0.0.1:8420/v1/chat/stream_canvas", {
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': `Bearer ${process.env.IPC_SECRET}`
      }
    });
    
    req.on('response', (res) => {
      if (!validateFingerprint(res, req)) return event.sender.send("secure-stream-end");
      if (res.statusCode !== 200) {
        return event.sender.send("secure-stream-end");
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
      res.on('error', (err) => {
         console.error("Stream Error", err);
         event.sender.send("secure-stream-end");
      });
    });

    req.on('error', (err) => {
      console.error("Network Error", err);
      event.sender.send("secure-stream-end");
    });

  req.on('finish', () => {
    // Natively wipe completely after the final TCP packet is fully handed off to kernel
    // The Buffer is inaccessible to typical V8 GC paths natively anyway.
    finalPayload.fill(0);
    secret.fill(0);
    convIdBuf.fill(0);
  });
  req.end(finalPayload);
    
  } catch (err) {
    console.error("Splice error:", err);
  }
});

// Standard Web Input Fallback (Bypasses C++ Memory Vault & Telemetry)
ipcMain.handle("send-standard-message", (event, configObj, text) => {
  try {
    const secret = Buffer.from(text, "utf-8");
    const convIdBuf = Buffer.from(configObj.conversation_id || "default", "utf-8");

    const fixedAllocSize = 1 + 4 + 4 + 8 + 8 + 4 + 4;
    const finalPayload = Buffer.alloc(fixedAllocSize + convIdBuf.length + secret.length);
    
    let offset = 0;
    finalPayload.writeUInt8(configObj.enable_thinking, offset); offset += 1;
    finalPayload.writeUInt32BE(configObj.thinking_budget, offset); offset += 4;
    finalPayload.writeUInt32BE(configObj.max_tokens, offset); offset += 4;
    finalPayload.writeDoubleBE(configObj.temperature, offset); offset += 8;
    finalPayload.writeDoubleBE(configObj.top_p, offset); offset += 8;
    
    finalPayload.writeUInt32BE(convIdBuf.length, offset); offset += 4;
    convIdBuf.copy(finalPayload, offset); offset += convIdBuf.length;
    
    finalPayload.writeUInt32BE(secret.length, offset); offset += 4;
    secret.copy(finalPayload, offset); offset += secret.length;

    const req = https.request("https://127.0.0.1:8420/v1/chat/stream_canvas", {
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': `Bearer ${process.env.IPC_SECRET}`
      }
    });

    req.on('response', (res) => {
      if (!validateFingerprint(res, req)) return event.sender.send("secure-stream-end");
      if (res.statusCode !== 200) {
        return event.sender.send("secure-stream-end");
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
      res.on('end', () => event.sender.send("secure-stream-end"));
      res.on('error', (err) => {
         console.error("Stream Error", err);
         event.sender.send("secure-stream-end");
      });
    });

    req.on('error', (err) => {
      console.error("Network Error", err);
      event.sender.send("secure-stream-end");
    });

    req.on('finish', () => {
      finalPayload.fill(0);
      secret.fill(0);
      convIdBuf.fill(0);
    });
    
    req.end(finalPayload);
  } catch (err) {
    console.error("Standard MSG error:", err);
  }
});

ipcMain.handle("check-server-health", () => {
  return new Promise((resolve) => {
    const req = https.request("https://127.0.0.1:8420/health", {
      method: "GET",
      rejectUnauthorized: false,
      timeout: 2000,
      headers: {
          "Authorization": `Bearer ${process.env.IPC_SECRET}`
      }
    }, (res) => {
      if (!validateFingerprint(res, req)) return resolve({ ok: false });
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve({ ok: true, data: JSON.parse(data) });
          } catch (e) {
            resolve({ ok: false });
          }
        } else {
          resolve({ ok: false });
        }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.end();
  });
});

ipcMain.on("fetch-history", (event, id) => {
  const targetUrl = `https://127.0.0.1:8420/v1/chat/render/${id}`;
  const req = https.request(targetUrl, {
    method: 'GET',
    rejectUnauthorized: false,
    headers: {
        'Authorization': `Bearer ${process.env.IPC_SECRET}`
    }
  });
  
  req.on('response', (res) => {
    if (!validateFingerprint(res, req)) return;
    if (res.statusCode !== 200) {
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
      console.error("History fetch error:", err);
  });
  req.end();
});

ipcMain.on("export-vault", (event, id) => {
  const os = require('os');
  const targetEncPath = path.join(os.homedir(), 'Desktop', `Monolith_Vault_${id.substring(0, 8)}.enc`);
  
  const req = https.request(`https://127.0.0.1:8420/v1/chat/export/${id}`, {
    method: 'GET',
    rejectUnauthorized: false,
    headers: {
        'Authorization': `Bearer ${process.env.IPC_SECRET}`
    }
  });
  
  req.on('response', (res) => {
    if (!validateFingerprint(res, req)) return;
    if (res.statusCode !== 200) {
      console.error("Export Vault error:", res.statusCode);
      return;
    }
    const fileStream = fs.createWriteStream(targetEncPath);
    res.on('data', chunk => fileStream.write(chunk));
    res.on('end', () => {
       fileStream.end();
       
       // The file is secure. Now securely request the PNG raster of the password.
       const reqKey = https.request(`https://127.0.0.1:8420/v1/chat/export/key/${id}`, {
         method: 'GET',
         rejectUnauthorized: false,
         headers: {
             'Authorization': `Bearer ${process.env.IPC_SECRET}`
         }
       });
       
       reqKey.on('response', (kRes) => {
           if (!validateFingerprint(kRes, reqKey)) return;
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
  
  volSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Embedder-Policy': ['require-corp'],
        'Cross-Origin-Opener-Policy': ['same-origin']
      }
    });
  });

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
  win.on('ready-to-show', () => {
    if (secureInput && secureInput.protectWindow) {
      secureInput.protectWindow(); 
      console.log("Native AppKit Window Protection Engaged");
    }
  });

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

app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
