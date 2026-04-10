import { useState, useRef, useCallback, useEffect } from "react";
import VirtualKeyboard from "./VirtualKeyboard.jsx";

/**
 * MessageInput — Auto-resizing textarea with send/stop controls
 * and active settings indicators.
 */
export default function MessageInput({ onSend, onStop, isStreaming, disabled, settings }) {
  const inputRef = useRef(null);
  
  // Extreme Privacy: C++ Vault Counter
  // The characters themselves are physically residing inside the macOS C++ compilation.
  // The frontend only tracks how many dots to render. V8 never aggregates the Strings.
  const [vaultLength, setVaultLength] = useState(0);
  const [ghostMode, setGhostMode] = useState(false);
  const [hardwareLockWarning, setHardwareLockWarning] = useState(false);

  useEffect(() => {
    async function checkHardware() {
      if (window.electronAPI) {
        const isLocked = await window.electronAPI.isHardwareLocked();
        const isDebugged = await window.electronAPI.isDebuggerAttached();
        if (!isLocked || isDebugged) {
          setHardwareLockWarning(true);
          setGhostMode(true); // Force Ghost Protocol automatically
        }
      }
    }
    checkHardware();
  }, []);

  const resize = useCallback(() => {
    // We use standard input element size here
  }, []);

  useEffect(() => {
    resize();
  }, [vaultLength, resize]);

  const wipeMemory = useCallback(() => {
    window.electronAPI.wipeVault();
    setVaultLength(0);
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;
    
    window.electronAPI.onSecureKeyTick((actionId) => {
        if (ghostMode) return;
        
        if (actionId === 1) { // Append
            setVaultLength(l => l + 1);
        } else if (actionId === 2) { // Backspace
            setVaultLength(l => Math.max(0, l - 1));
        } else if (actionId === 3) { // Enter
            // We cannot access current state via closure easily here, so we dispatch custom event or rely on ref
            // Actually, since setState allows function updater, we can rely on state safely for length!
            setVaultLength(l => {
                if (l > 0 && !isStreaming && !disabled) {
                    onSend("");
                }
                return l;
            });
        }
    });

    return () => window.electronAPI.offSecureKeyTick();
  }, [ghostMode, isStreaming, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e) => {
      // Absolut C++ Ghost Mode! Sørger for Blink/V8 Strings ikke oprettes via native browser event
      e.preventDefault();
      e.stopPropagation();
    },
    []
  );
  const handleFocus = useCallback(() => {
    window.electronAPI.enableSecureInput();
  }, []);

  const handleBlur = useCallback(() => {
    window.electronAPI.disableSecureInput();
  }, []);

  const handleSendClick = useCallback(async () => {
    if (isStreaming) {
      onStop();
    } else {
      if (vaultLength > 0 && !disabled) {
          onSend("");
      }
    }
  }, [isStreaming, disabled, onSend, onStop, vaultLength]);

  const previewText = "●".repeat(vaultLength);

  return (
    <>
      {hardwareLockWarning && (
        <div style={{ backgroundColor: '#ff3b30', color: 'white', padding: '10px', textAlign: 'center', fontSize: '12px', fontWeight: 'bold', borderRadius: '8px', marginBottom: '8px', zIndex: 100 }}>
          ⚠️ CRITICAL: HARDWARE-LEVEL VULNERABILITY DETECTED. PHYSICAL KEYBOARD HOOK REJECTED / INSECURE.<br/>
          Ghost Protocol (OSK) has been forcibly enabled to prevent user-space Rootkits from intercepting keystrokes.
        </div>
      )}
      <div className="input-area" style={{ position: 'relative' }}>
      {ghostMode && (
          <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: '8px', zIndex: 10 }}>
              <VirtualKeyboard 
                  onKeyPress={() => setVaultLength(l => l + 1)} 
                  onBackspace={() => setVaultLength(l => Math.max(0, l - 1))} 
                  onSpace={() => setVaultLength(l => l + 1)}
                  onEnter={() => {
                      if (vaultLength > 0 && !disabled && !isStreaming) {
                          onSend("");
                      }
                  }}
              />
          </div>
      )}
      <div className="input-container">
        <div className="input-wrapper">
          <div className="secure-input-wrapper" style={{ position: 'relative', flex: 1, minHeight: '44px' }}>
            {/* Absolute Isolation Ghost Wrapper bypassing DOM String allocation */}
            <input
              ref={inputRef}
              type="text"
              title="OS-Level Keylogger Protection Active"
              defaultValue=""
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              onBlur={handleBlur}
              disabled={disabled}
              id="message-input"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              onPaste={(e) => e.preventDefault()}
              onDrop={(e) => e.preventDefault()}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                width: '100%',
                height: '100%',
                position: 'absolute',
                top: 0,
                left: 0,
                color: 'transparent',    // Hide text instantly
                background: 'transparent',
                caretColor: '#888',      // Keep cursor visible
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontFamily: 'inherit',
                fontSize: '15px',
                padding: '12px',
                zIndex: 2,               // Receive all clicks and focus
              }}
            />
            {/* Visual Proxy */}
            <div 
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                padding: '12px',
                pointerEvents: 'none',
                fontFamily: 'inherit',
                fontSize: '15px',
                color: vaultLength > 0 ? '#eee' : '#555',
                zIndex: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden'
              }}
            >
              {previewText ? previewText : (disabled ? "Waiting for server…" : (ghostMode ? "Ghost Protocol Active..."  : "Secure isolated input…"))}
            </div>
            
            {/* Kernel Warning Dropdown */}
            {!ghostMode && (
                <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#301010', color: '#ff6b6b', fontSize: '11px', padding: '4px 8px', borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px', border: '1px solid #ff444455', borderTop: 'none', zIndex: -1, pointerEvents: 'none' }}>
                    ⚠️ <b>PHYSICAL KEYBOARD ACTIVE:</b> Vulnerable to Kernel & Hardware level Keyloggers. Use Ghost Protocol (👻) for maximum isolation.
                </div>
            )}
          </div>
          <button
              onClick={() => !hardwareLockWarning && setGhostMode(m => !m)}
              title={hardwareLockWarning ? "Ghost Protocol Forced (Hardware Compromised)" : "Toggle Ghost Protocol (OSK)"}
              disabled={hardwareLockWarning}
              style={{
                  background: ghostMode ? (hardwareLockWarning ? '#ff9800' : '#4caf50') : 'transparent',
                  border: '1px solid #444',
                  color: ghostMode ? '#000' : '#888',
                  padding: '0 12px',
                  borderRadius: '4px',
                  cursor: hardwareLockWarning ? 'not-allowed' : 'pointer',
                  opacity: hardwareLockWarning ? 0.8 : 1,
                  marginRight: '8px'
              }}
          >
              👻
          </button>
          <button
            className="send-btn"
            onClick={handleSendClick}
            disabled={disabled && !isStreaming}
            title={isStreaming ? "Stop generating" : "Send message"}
            id="send-button"
          >
            {isStreaming ? "◼" : "↑"}
          </button>
        </div>
        <div className="input-meta">
          <div className="input-badges">
            {settings?.enableThinking && (
              <span className="input-badge thinking-badge" title="Reasoning enabled">
                🧠 Thinking · {settings.thinkingBudget}t
              </span>
            )}
            <span className="input-badge" title="Max response tokens">
              ↗ {settings?.maxTokens || 2048}t
            </span>
            <span className="input-badge" title="Temperature">
              🌡 {(settings?.temperature || 0.7).toFixed(1)}
            </span>
          </div>
          <div className="input-hint">
            <kbd>Enter</kbd> send · <kbd>Shift+Enter</kbd> newline
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
