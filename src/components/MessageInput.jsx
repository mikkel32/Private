import { useState, useRef, useCallback, useEffect } from "react";
import VirtualKeyboard from "./VirtualKeyboard.jsx";

/**
 * MessageInput — Auto-resizing textarea with send/stop controls
 * and active settings indicators.
 *
 * Standard mode: Normal text input (visible typing, text in React state).
 * Paranoid mode: C++ vault (dots only, text in native memory).
 * Ghost mode: Virtual keyboard only.
 */
export default function MessageInput({ onSend, onStop, isStreaming, disabled, settings }) {
  const inputRef = useRef(null);
  
  // Standard mode: text lives in React state (visible to user)
  const [standardText, setStandardText] = useState("");
  
  // Paranoid/Ghost mode: C++ Vault Counter
  // Characters reside in the C++ vault. Frontend only tracks dot count.
  const [vaultLength, setVaultLength] = useState(0);
  const vaultLengthRef = useRef(vaultLength);
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
        }
      }
    }
    checkHardware();
  }, []);

  // Auto-focus input on mount + whenever settings close
  useEffect(() => {
    if (inputRef.current && !disabled) {
      inputRef.current.focus();
    }
  }, [disabled]);

  // Ensure secure input is active on mount (paranoid/ghost modes)
  useEffect(() => {
    if (window.electronAPI && !isStandard) {
      window.electronAPI.enableSecureInput();
    }
  }, [isStandard]);

  const resize = useCallback(() => {}, []);

  useEffect(() => {
    resize();
    vaultLengthRef.current = vaultLength;
  }, [vaultLength, resize]);

  useEffect(() => {
    setGhostMode(isGhost);
  }, [isGhost]);

  const wipeMemory = useCallback(() => {
      if (window.electronAPI) window.electronAPI.wipeVault();
      setVaultLength(0);
      setStandardText("");
  }, []);

  const isStreamingRef = useRef(isStreaming);
  const disabledRef = useRef(disabled);
  const onSendRef = useRef(onSend);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { onSendRef.current = onSend; }, [onSend]);

  // Paranoid mode: C++ event tap sends key ticks
  useEffect(() => {
    if (!window.electronAPI || isStandard) return;
    
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
  }, [ghostMode, isStandard]);

  const handleKeyDown = useCallback((e) => {
      if (isStandard) {
        // Standard mode: allow normal typing, handle Enter for send
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (standardText.trim().length > 0 && !disabled && !isStreaming) {
            onSend(standardText);
            setStandardText("");
          }
        }
        return; // Let other keys through normally
      }
      
      // Paranoid/Ghost mode: block all keys from DOM
      if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (vaultLengthRef.current > 0 && !disabled && !isStreaming) {
              onSend("");
          }
          return;
      }
      e.preventDefault();
      e.stopPropagation();
  }, [disabled, isStreaming, onSend, isStandard, standardText]);

  const handleFocus = useCallback(() => {}, []);
  const handleBlur = useCallback(() => {}, []);

  const handleSendClick = useCallback(async () => {
    if (isStreaming) {
      onStop();
    } else {
      if (isStandard) {
        if (standardText.trim().length > 0 && !disabled) {
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

  const previewText = isStandard ? "" : "●".repeat(vaultLength);

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
            {isStandard ? (
              /* Standard mode: normal visible text input */
              <input
                ref={inputRef}
                type="text"
                placeholder={disabled ? "Waiting for server…" : "Type a message…"}
                value={standardText}
                onChange={(e) => setStandardText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                id="message-input"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                style={{
                  width: '100%',
                  height: '100%',
                  background: 'transparent',
                  color: '#eee',
                  border: 'none',
                  outline: 'none',
                  fontFamily: 'inherit',
                  fontSize: '15px',
                  padding: '12px',
                }}
              />
            ) : (
              /* Paranoid/Ghost mode: invisible input + dot proxy */
              <>
                <input
                  ref={inputRef}
                  type="text"
                  title="OS-Level Keylogger Protection Active"
                  value=""
                  onChange={() => {}}
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
                    color: 'transparent',
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
                {/* Visual Proxy — dots for vault length */}
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
              </>
            )}
            
            {/* Mode indicators */}
            {!ghostMode && !isStandard && (
                <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#301010', color: '#ff6b6b', fontSize: '11px', padding: '4px 8px', borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px', border: '1px solid #ff444455', borderTop: 'none', zIndex: -1, pointerEvents: 'none' }}>
                    ⚠️ <b>PHYSICAL KEYBOARD ACTIVE:</b> Vulnerable to Kernel & Hardware level Keyloggers. Use Ghost Protocol (👻) for maximum isolation.
                </div>
            )}
            {isStandard && (
                <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#1a2a1a', color: '#6b8', fontSize: '11px', padding: '4px 8px', borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px', border: '1px solid #4a644a', borderTop: 'none', zIndex: -1, pointerEvents: 'none' }}>
                    🔒 <b>STANDARD MODE:</b> DRM + Encryption active. OCR disruption disabled for readability.
                </div>
            )}
          </div>
          {!isGhost && (
              <button
                  onClick={() => setGhostMode(m => !m)}
                  title={"Toggle Ghost Protocol (OSK) " + (hardwareLockWarning ? "- Hardware Lock Missing" : "")}
                  disabled={false}
                  style={{
                      background: ghostMode ? '#4caf50' : 'transparent',
                      border: '1px solid #444',
                      borderRadius: '6px',
                      padding: '8px',
                      cursor: 'pointer',
                      fontSize: '18px',
                      marginRight: '4px',
                      color: ghostMode ? '#000' : (hardwareLockWarning ? '#ff9800' : '#888'),
                      transition: 'all 0.2s ease',
                  }}
              >
                  👻
              </button>
          )}
          <button
            onClick={handleSendClick}
            disabled={disabled}
            className="send-btn"
            title={isStreaming ? "Stop generation" : "Send message"}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isStreaming ? '#ff4444' :'#4caf50',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 14px',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              color: '#fff',
              fontSize: '18px',
              transition: 'all 0.2s ease',
            }}
          >
            {isStreaming ? "⏹" : "↑"}
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
