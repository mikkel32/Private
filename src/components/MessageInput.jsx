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
  const vaultLengthRef = useRef(vaultLength);
  const [standardText, setStandardText] = useState("");
  const isStandard = settings?.securityMode === "standard";
  const isGhost = settings?.securityMode === "ghost";
  const [ghostMode, setGhostMode] = useState(isGhost);
  const [hardwareLockWarning, setHardwareLockWarning] = useState(false);

  useEffect(() => {
    async function checkHardware() {
      if (window.electronAPI) {
        const isLocked = await window.electronAPI.isHardwareLocked();
        const isDebugged = await window.electronAPI.isDebuggerAttached();
        if (!isLocked || isDebugged) {
          setHardwareLockWarning(true);
          // Do NOT force Ghost Protocol - fallback to Ring 3 Event Tap is engaged
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
    vaultLengthRef.current = vaultLength;
  }, [vaultLength, resize]);

  useEffect(() => {
    setGhostMode(isGhost);
  }, [isGhost]);

  const wipeMemory = useCallback(() => {
    if (isStandard) {
        setStandardText("");
    } else {
        window.electronAPI.wipeVault();
        setVaultLength(0);
    }
  }, [isStandard]);

  const isStreamingRef = useRef(isStreaming);
  const disabledRef = useRef(disabled);
  const onSendRef = useRef(onSend);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { onSendRef.current = onSend; }, [onSend]);

  useEffect(() => {
    if (!window.electronAPI) return;
    
    window.electronAPI.onSecureKeyTick((actionId) => {
        if (ghostMode) return;
        
        if (actionId === 1) { // Append
            setVaultLength(l => l + 1);
        } else if (actionId === 2) { // Backspace
            setVaultLength(l => Math.max(0, l - 1));
        } else if (actionId === 3) { // Enter
            if (vaultLengthRef.current > 0 && !isStreamingRef.current && !disabledRef.current) {
                onSendRef.current("");
            }
        }
    });

    return () => window.electronAPI.offSecureKeyTick();
  }, [ghostMode]);

  const handleKeyDown = useCallback((e) => {
      if (isStandard) {
          if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (standardText.trim() && !disabled && !isStreaming) {
                  onSend(standardText);
                  setStandardText("");
              }
          }
          return;
      }
      
      e.preventDefault();
      e.stopPropagation();
  }, [isStandard, standardText, disabled, isStreaming, onSend]);
  const handleFocus = useCallback(() => {
    if (!isStandard) window.electronAPI.enableSecureInput();
  }, [isStandard]);

  const handleBlur = useCallback(() => {
    if (!isStandard) window.electronAPI.disableSecureInput();
  }, [isStandard]);

  const handleSendClick = useCallback(async () => {
    if (isStreaming) {
      onStop();
    } else {
      if (isStandard) {
          if (standardText.trim() && !disabled) {
              onSend(standardText);
              setStandardText("");
          }
      } else {
          if (vaultLength > 0 && !disabled) {
              onSend("");
          }
      }
    }
  }, [isStreaming, disabled, onSend, onStop, vaultLength, isStandard, standardText]);

  const previewText = "●".repeat(vaultLength);

  return (
    <>
      {hardwareLockWarning && !isStandard && !isGhost && (
        <div style={{ backgroundColor: '#ff9800', color: '#000', padding: '6px', textAlign: 'center', fontSize: '11px', fontWeight: 'bold', borderRadius: '6px', marginBottom: '8px', zIndex: 100 }}>
          ⚠️ Ring 3 User-Space Lock Active (DEXT Offline). Physical Keyboard protected via AppKit.
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
                      if (vaultLengthRef.current > 0 && !disabled && !isStreaming) {
                          onSend("");
                      }
                  }}
              />
          </div>
      )}
      <div className="input-container">
        <div className="input-wrapper">
          <div className="secure-input-wrapper" style={{ position: 'relative', flex: 1, minHeight: '44px' }}>
            {/* Extracted Input */}
            <input
              ref={inputRef}
              type="text"
              title={isStandard ? "Standard Web Input" : "OS-Level Keylogger Protection Active"}
              value={isStandard ? standardText : ""}
              defaultValue={isStandard ? undefined : ""}
              onChange={(e) => { if (isStandard) setStandardText(e.target.value); }}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              onBlur={handleBlur}
              disabled={disabled}
              id="message-input"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              onPaste={(e) => !isStandard && e.preventDefault()}
              onDrop={(e) => !isStandard && e.preventDefault()}
              onContextMenu={(e) => !isStandard && e.preventDefault()}
              style={{
                width: '100%',
                height: '100%',
                position: 'absolute',
                top: 0,
                left: 0,
                color: isStandard ? '#eee' : 'transparent',
                background: 'transparent',
                caretColor: '#888',
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontFamily: 'inherit',
                fontSize: '15px',
                padding: '12px',
                zIndex: 2,
              }}
            />
            
            {/* Visual Proxy */}
            {!isStandard && (
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
                  {previewText ? previewText : (disabled ? "Waiting for server…" : (ghostMode ? "Ghost Protocol Active..." : "Secure isolated input…"))}
                </div>
            )}
            
            {/* Kernel Warning Dropdown */}
            {!ghostMode && !isStandard && (
                <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#301010', color: '#ff6b6b', fontSize: '11px', padding: '4px 8px', borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px', border: '1px solid #ff444455', borderTop: 'none', zIndex: -1, pointerEvents: 'none' }}>
                    ⚠️ <b>PHYSICAL KEYBOARD ACTIVE:</b> Vulnerable to Kernel & Hardware level Keyloggers. Use Ghost Protocol (👻) for maximum isolation.
                </div>
            )}
            {isStandard && (
                <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#222', color: '#aaa', fontSize: '11px', padding: '4px 8px', borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px', border: '1px solid #444', borderTop: 'none', zIndex: -1, pointerEvents: 'none' }}>
                    🌐 <b>STANDARD INPUT ACTIVE:</b> Screen Readers and Plugins are enabled. Visual OCR Anti-Scraper memory vault is bypassed.
                </div>
            )}
          </div>
          {!isStandard && (
              <button
                  onClick={() => setGhostMode(m => !m)}
                  title={"Toggle Ghost Protocol (OSK) " + (hardwareLockWarning ? "- Hardware Lock Missing" : "")}
                  disabled={false}
                  style={{
                      background: ghostMode ? '#4caf50' : 'transparent',
                      border: '1px solid #444',
                      color: ghostMode ? '#000' : '#888',
                      padding: '0 12px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      marginRight: '8px'
                  }}
              >
                  👻
              </button>
          )}
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
