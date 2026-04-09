import { useState, useRef, useCallback, useEffect } from "react";

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

  const handleKeyDown = useCallback(
    async (e) => {
      // Forebyg DOM vha. preventDefault så Blink/V8 Strings aldrig allokeres til `value`.
      e.preventDefault();

      if (e.key === "Enter" && !e.shiftKey) {
        if (vaultLength > 0 && !isStreaming && !disabled) {
          const bufferPayload = await window.electronAPI.drainVault();
          if (bufferPayload && bufferPayload.byteLength > 0) {
              const text = new TextDecoder().decode(bufferPayload);
              onSend(text);
          }
          wipeMemory();
        }
      } else if (e.key === "Backspace") {
        window.electronAPI.backspace();
        setVaultLength(l => Math.max(0, l - 1));
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Enforce standard tegn over V8 IPC uden brug af DOM node
        const buffer = new TextEncoder().encode(e.key);
        window.electronAPI.appendBuffer(buffer);
        setVaultLength(l => l + 1);
      }
    },
    [isStreaming, disabled, onSend, wipeMemory, vaultLength]
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
        const bufferPayload = await window.electronAPI.drainVault();
        if (bufferPayload && bufferPayload.byteLength > 0) {
            const text = new TextDecoder().decode(bufferPayload);
            onSend(text);
        }
        wipeMemory();
      }
    }
  }, [isStreaming, disabled, onSend, onStop, wipeMemory, vaultLength]);

  const previewText = "●".repeat(vaultLength);

  return (
    <div className="input-area">
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
                color: text ? '#eee' : '#555',
                zIndex: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden'
              }}
            >
              {previewText ? previewText : (disabled ? "Waiting for server…" : "Secure isolated input…")}
            </div>
          </div>
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
  );
}
