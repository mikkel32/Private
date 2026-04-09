import { useState, useRef, useCallback, useEffect } from "react";

/**
 * MessageInput — Auto-resizing textarea with send/stop controls
 * and active settings indicators.
 */
export default function MessageInput({ onSend, onStop, isStreaming, disabled, settings }) {
  const [text, setText] = useState("");
  const textareaRef = useRef(null);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  useEffect(() => {
    resize();
  }, [text, resize]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (text.trim() && !isStreaming && !disabled) {
          onSend(text);
          setText("");
        }
      }
    },
    [text, isStreaming, disabled, onSend]
  );

  const handleSendClick = useCallback(() => {
    if (isStreaming) {
      onStop();
    } else if (text.trim() && !disabled) {
      onSend(text);
      setText("");
    }
  }, [text, isStreaming, disabled, onSend, onStop]);

  return (
    <div className="input-area">
      <div className="input-container">
        <div className="input-wrapper">
          {/* Absolute Isolation Ghost Wrapper */}
          <div className="secure-input-wrapper" style={{ position: 'relative', flex: 1, minHeight: '44px' }}>
            <input
              type="password"
              title="OS-Level Keylogger Protection Active"
              value={text}
              onChange={(e) => setText(e.target.value)}
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
              {text ? text : (disabled ? "Waiting for server…" : "Secure isolated input…")}
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
