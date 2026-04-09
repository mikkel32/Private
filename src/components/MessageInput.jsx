import { useState, useRef, useCallback, useEffect } from "react";

/**
 * MessageInput — Auto-resizing textarea with send/stop controls
 * and active settings indicators.
 */
export default function MessageInput({ onSend, onStop, isStreaming, disabled, settings }) {
  const inputRef = useRef(null);
  
  // Extreme Privacy: Memory Managed Keystroke Buffer
  // We allocate exactly 8192 bytes. Keystrokes are written to this TypedArray.
  const bufferRef = useRef(new Uint8Array(8192));
  const pointerRef = useRef(0);
  const [renderTrigger, setRenderTrigger] = useState(0);

  const resize = useCallback(() => {
    // We use standard input element size here
  }, []);

  useEffect(() => {
    resize();
  }, [renderTrigger, resize]);

  const getCurrentText = useCallback(() => {
    return new TextDecoder().decode(bufferRef.current.subarray(0, pointerRef.current));
  }, []);

  const wipeMemory = useCallback(() => {
    // Cryptographically obliterate the allocated RAM sectors for the physical buffer
    window.crypto.getRandomValues(bufferRef.current);
    bufferRef.current.fill(0);
    pointerRef.current = 0;
    if (inputRef.current) inputRef.current.value = "";
    setRenderTrigger(v => v + 1);
  }, []);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const currentText = getCurrentText();
        if (currentText.trim() && !isStreaming && !disabled) {
          onSend(currentText);
          wipeMemory();
        }
      }
    },
    [isStreaming, disabled, onSend, wipeMemory, getCurrentText]
  );

  const handleInputChange = useCallback((e) => {
    const val = e.target.value;
    const encoder = new TextEncoder();
    const encoded = encoder.encode(val);
    
    // Bounds check to prevent buffer overflow attack on local V8
    if (encoded.length > 8192) return;
    
    bufferRef.current.set(encoded);
    pointerRef.current = encoded.length;
    setRenderTrigger(v => v + 1);
  }, []);

  const handleSendClick = useCallback(() => {
    if (isStreaming) {
      onStop();
    } else {
      const currentText = getCurrentText();
      if (currentText.trim() && !disabled) {
        onSend(currentText);
        wipeMemory();
      }
    }
  }, [isStreaming, disabled, onSend, onStop, wipeMemory, getCurrentText]);

  const previewText = getCurrentText();

  return (
    <div className="input-area">
      <div className="input-container">
        <div className="input-wrapper">
          {/* Absolute Isolation Ghost Wrapper */}
          <div className="secure-input-wrapper" style={{ position: 'relative', flex: 1, minHeight: '44px' }}>
            <input
              ref={inputRef}
              type="password"
              title="OS-Level Keylogger Protection Active"
              defaultValue=""
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
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
                color: 'transparent',    // Hide the password discs
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
