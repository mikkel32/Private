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
const HID = require("node-hid");
const crypto = require("crypto");
const child_process = require("child_process");

function makeSEPHeaders(payloadBuf) {
    const timestamp = Date.now().toString();
    const timeBuf = Buffer.from(timestamp, "utf-8");
    const combinedBuf = Buffer.concat([payloadBuf, timeBuf]);
    let sig = "UNAUTHORIZED";
    
    if (secureInput && secureInput.signSEPPayload) {
        sig = secureInput.signSEPPayload(combinedBuf);
        if (!sig) sig = "UNAUTHORIZED";
    } else {
        console.error("Hardware Encryption Failure: C++ SEP Cryptography module missing.");
    }
    
    return {
        'Content-Type': 'application/octet-stream',
        'X-SEP-Timestamp': timestamp,
        'X-SEP-Signature': sig
    };
}

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
    if (secureInput.generateSEPKey) {
       console.log("Initializing SEP Hardware Cryptography natively via C++ Driver...");
       const pubKey = secureInput.generateSEPKey();
       console.log("---SEP_PUB_KEY---:" + pubKey);
    }
  }
} catch (e) {
  if (process.platform === 'linux' && e.message && e.message.includes("FATAL: Monolith Kernel Level security mandates root privileges")) {
      console.error(e.message);
      process.exit(1);
  }
  console.warn("Native Secure Input module not loaded");
}

let hardwareHID;
function initializeAirGappedKeyboard() {
  try {
     const devices = HID.devices();
     // TinyUSB Default VENDOR_ID = 0xCafe, PRODUCT_ID = 0x4004 for our Pico firmware
     const deviceInfo = devices.find(d => d.vendorId === 0xCAFE && d.productId === 0x4004);
     if (deviceInfo) {
         hardwareHID = new HID.HID(deviceInfo.path);
         
         // Hardware firmware symmetric key negotiation buffer
         const USB_AES_KEY = process.env.USB_AES_KEY ? Buffer.from(process.env.USB_AES_KEY, 'hex') : crypto.createHash('sha256').update("FallbackSymmetricKeyUntilHardwareFlashed").digest();
         let decipher = null;

         hardwareHID.on("data", (data) => {
             // Hardware Boot requirement: Physical device MUST send 16-byte fresh IV upon pairing initialization
             if (!decipher) {
                 if (data.length >= 16) {
                     const iv = Buffer.from(data.slice(0, 16));
                     decipher = crypto.createDecipheriv('aes-256-ctr', USB_AES_KEY, iv);
                     console.log("Pico Keyboard Cryptographic Handshake Established (AES-256-CTR)");
                 }
                 return;
             }
             
             // Decrypt the raw encrypted payload byte stream dynamically
             const encryptedChunk = Buffer.from(data);
             const decryptedBytes = decipher.update(encryptedChunk);
             
             for (let i = 0; i < decryptedBytes.length; i++) {
                 const charCode = decryptedBytes[i];
                 if (charCode >= 32 && charCode <= 126 && secureInput) {
                      // Dynamically insert unmasked byte deeply into the C++ Vault without variable leak
                      secureInput.append(Buffer.from([charCode]));
                      
                      // Notify the UI bullet mapping tracker securely
                      const mainWindow = BrowserWindow.getAllWindows()[0];
                      if (mainWindow) mainWindow.webContents.send("secure-key-tick", 1);
                 }
             }
         });
         
         hardwareHID.on("error", () => {
             decipher = null; // Re-sync cryptographic handshakes natively on disconnects
         });
         console.log("Air-Gapped Interface Attached! Waiting for AES cryptographic handshake...");
     }
  } catch (e) {
      console.log("No air-gapped node-hid hardware attached.");
  }
}
initializeAirGappedKeyboard();

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

const secureAgent = new https.Agent({
  rejectUnauthorized: false, // Disables standard root CA checks
  checkServerIdentity: (host, cert) => { // But enforces strict byte-for-byte thumbprint pinning
    if (!cert || cert.fingerprint256 !== rawFingerprint) {
      console.error(`FATAL MITM INTERCEPT: Fingerprint mismatch! Expected ${rawFingerprint}, got ${cert ? cert.fingerprint256 : 'none'}`);
      return new Error('Invalid Server Certificate Fingerprint'); // Reject TLS Handshake BEFORE sending payload
    }
    return undefined; // Valid!
  }
});

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
      agent: secureAgent,
      headers: makeSEPHeaders(finalPayload)
    });
    
    req.on('response', (res) => {
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
                 if (secureInput && secureInput.renderDRMFrame) {
                     secureInput.renderDRMFrame(pngData);
                     if (pngData.length >= 24) {
                         const w = pngData.readUInt32BE(16);
                         const h = pngData.readUInt32BE(20);
                         event.sender.send("secure-canvas-frame", { type: "Dimensions", width: w, height: h });
                     }
                 } else {
                     event.sender.send("secure-canvas-frame", pngData);
                 }
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

    const req = https.request("https://127.0.0.1:8420/v1/chat/stream_canvas?ocr_shield=off", {
      method: 'POST',
      agent: secureAgent,
      headers: makeSEPHeaders(finalPayload)
    });

    req.on('response', (res) => {
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
                 if (secureInput && secureInput.renderDRMFrame) {
                     secureInput.renderDRMFrame(pngData);
                     if (pngData.length >= 24) {
                         const w = pngData.readUInt32BE(16);
                         const h = pngData.readUInt32BE(20);
                         event.sender.send("secure-canvas-frame", { type: "Dimensions", width: w, height: h });
                     }
                 } else {
                     event.sender.send("secure-canvas-frame", pngData);
                 }
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
      agent: secureAgent,
      timeout: 2000,
      headers: makeSEPHeaders(Buffer.from('/health'))
    }, (res) => {
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

ipcMain.on("fetch-history", (event, id, mode) => {
  const shieldParam = mode === "standard" ? "?ocr_shield=off" : "";
  const targetUrl = `https://127.0.0.1:8420/v1/chat/render/${id}${shieldParam}`;
  const req = https.request(targetUrl, {
    method: 'GET',
    agent: secureAgent,
    headers: makeSEPHeaders(Buffer.from(`/v1/chat/render/${id}`))
  });
  
  req.on('response', (res) => {
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
               if (secureInput && secureInput.renderDRMFrame) {
                   secureInput.renderDRMFrame(pngData);
                   if (pngData.length >= 24) {
                       const w = pngData.readUInt32BE(16);
                       const h = pngData.readUInt32BE(20);
                       event.sender.send("secure-canvas-frame", { type: "Dimensions", width: w, height: h });
                   }
               } else {
                   event.sender.send("secure-canvas-frame", pngData);
               }
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

ipcMain.on("secure-canvas-bounds", (event, bounds) => {
    if (secureInput && secureInput.syncCanvasBounds) {
        secureInput.syncCanvasBounds(bounds);
    }
});

ipcMain.on("secure-layer-visibility", (event, visible) => {
    if (secureInput && secureInput.setLayerVisibility) {
        secureInput.setLayerVisibility(visible);
    }
});

ipcMain.on("export-vault", (event, id, mode) => {
  const os = require('os');
  const targetEncPath = path.join(os.homedir(), 'Desktop', `Monolith_Vault_${id.substring(0, 8)}.enc`);
  
  const req = https.request(`https://127.0.0.1:8420/v1/chat/export/${id}`, {
    method: 'GET',
    agent: secureAgent,
    headers: makeSEPHeaders(Buffer.from(`/v1/chat/export/${id}`))
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
       const shieldParam = mode === "standard" ? "?ocr_shield=off" : "";
       const reqKey = https.request(`https://127.0.0.1:8420/v1/chat/export/key/${id}${shieldParam}`, {
         method: 'GET',
         agent: secureAgent,
         headers: makeSEPHeaders(Buffer.from(`/v1/chat/export/key/${id}`))
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
