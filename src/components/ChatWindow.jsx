import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

/**
 * ThinkingBlock — Collapsible reasoning display with a pulsing brain icon.
 */
function ThinkingBlock({ content, isStreaming }) {
  const [expanded, setExpanded] = useState(false);

  if (!content) return null;

  return (
    <div className={`thinking-block ${expanded ? "expanded" : ""}`}>
      <button
        className="thinking-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={`thinking-icon ${isStreaming ? "thinking-active" : ""}`}>
          ✦
        </span>
        <span className="thinking-label">
          {isStreaming ? "Reasoning…" : "Reasoning"}
        </span>
        <span className="thinking-arrow">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="thinking-content">
          <ReactMarkdown 
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
          >
            {content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

/**
 * ChatWindow — Message list with thinking blocks, markdown, and auto-scroll.
 */
export default function ChatWindow({ messages, isStreaming }) {
  const bottomRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const downloadPDF = async (msgId, contentElement) => {
    if (!contentElement) return;
    try {
      const canvas = await html2canvas(contentElement, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save(`gemma-chat-${msgId.slice(0, 6)}.pdf`);
    } catch (err) {
      console.error("PDF generation failed", err);
    }
  };

  // Poisoned Clipboard Manager Fix (Now Native Concealed Pasteboard)
  const secureCopy = (text) => {
    if (window.electronAPI && window.electronAPI.concealedCopy) {
      window.electronAPI.concealedCopy(text);
    } else {
      // Fallback if electronAPI is mysteriously unavailable
      navigator.clipboard.writeText(text);
      setTimeout(() => {
        navigator.clipboard.writeText(`[SYSTEM OVERWRITE: CLIPPING UNAUTHORIZED]`);
      }, 10000);
    }
  };

  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <div className="logo">✦</div>
        <h2>Gemma 4</h2>
        <p className="empty-subtitle">Private · Local · Uncensored</p>
        <p>
          Your conversations never leave this machine. Type a message below to begin.
        </p>
        <div className="empty-features">
          <div className="feature-pill">
            <span className="feature-icon">🧠</span>
            Chain-of-Thought Reasoning
          </div>
          <div className="feature-pill">
            <span className="feature-icon">⚡</span>
            Quantized KV Cache
          </div>
          <div className="feature-pill">
            <span className="feature-icon">🔒</span>
            Fully Offline
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="messages-container" ref={containerRef}>
      <div className="messages-inner">
        {messages.map((msg, i) => {
          const isLast = i === messages.length - 1;
          const isAssistantStreaming =
            isStreaming && isLast && msg.role === "assistant";
          const hasThinking = msg._thinking && msg._thinking.trim();
          const isStillThinking =
            isAssistantStreaming && hasThinking && !msg.content;

          return (
            <div className="message" key={msg._id || i}>
              <div className={`message-role ${msg.role}`}>
                {msg.role === "user" ? "You" : "Gemma"}
              </div>

              {/* Thinking block (collapsible) */}
              {hasThinking && (
                <ThinkingBlock
                  content={msg._thinking}
                  isStreaming={isStillThinking}
                />
              )}

              {/* Main response */}
              <div
                className={`message-content ${
                  isAssistantStreaming && msg.content ? "streaming-cursor" : ""
                }`}
                id={`msg-content-${msg._id || i}`}
              >
                {msg.role === "assistant" && msg.content ? (
                  <>
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {msg.content}
                    </ReactMarkdown>
                    {!isStreaming && (
                      <div className="message-actions" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
                        <button 
                          className="pdf-export-btn" 
                          title="Volatile Copy Text (10s self-destruct)"
                          onClick={() => secureCopy(msg.content)}
                          style={{ background: 'transparent', border: '1px solid #444', color: '#888', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}
                        >
                          📋 Secure Copy
                        </button>
                        <button 
                          className="pdf-export-btn" 
                          title="Export this response as PDF"
                          onClick={() => downloadPDF(msg._id || String(i), document.getElementById(`msg-content-${msg._id || i}`))}
                          style={{ background: 'transparent', border: '1px solid #444', color: '#888', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}
                        >
                          📄 Download PDF
                        </button>
                      </div>
                    )}
                  </>
                ) : msg.role === "assistant" && !msg.content ? (
                  <div className="loading-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : (
                  <p>{msg.content}</p>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
