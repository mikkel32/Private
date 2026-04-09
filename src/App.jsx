import { useState, useCallback, useRef, useEffect } from "react";
import Sidebar from "./components/Sidebar.jsx";
import ChatWindow from "./components/ChatWindow.jsx";
import MessageInput from "./components/MessageInput.jsx";
import StatsBar from "./components/StatsBar.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";

const API_URL = "https://127.0.0.1:8420";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function createConversation() {
  return {
    id: uid(),
    title: "New chat",
    messages: [],
    createdAt: Date.now(),
  };
}

/**
 * Parse Gemma 4 thinking blocks from raw text.
 * The model emits reasoning inside <|channel>thought\n...\n<channel|> tags.
 * Returns { thinking: string|null, response: string }
 */
function parseThinking(raw) {
  const thinkStartTag = "<|channel>thought";
  const thinkEndTag = "<channel|>";

  const startIdx = raw.indexOf(thinkStartTag);
  if (startIdx === -1) {
    return { thinking: null, response: raw };
  }

  const afterStart = startIdx + thinkStartTag.length;
  const endIdx = raw.indexOf(thinkEndTag, afterStart);

  if (endIdx === -1) {
    // Still streaming thinking content
    const thinkContent = raw.slice(afterStart).replace(/^\n/, "");
    return { thinking: thinkContent, response: "" };
  }

  const thinkContent = raw.slice(afterStart, endIdx).replace(/^\n/, "").replace(/\n$/, "");
  const response = raw.slice(endIdx + thinkEndTag.length).replace(/^\n/, "");

  return { thinking: thinkContent, response };
}

export default function App() {
  const [conversations, setConversations] = useState(() => {
    const initial = createConversation();
    return [initial];
  });
  const [activeId, setActiveId] = useState(() => conversations[0].id);
  const [isStreaming, setIsStreaming] = useState(false);
  const [serverOnline, setServerOnline] = useState(false);
  const [serverInfo, setServerInfo] = useState(null);
  const [lastTimings, setLastTimings] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isBlurred, setIsBlurred] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onWindowBlur(() => setIsBlurred(true));
      window.electronAPI.onWindowFocus(() => setIsBlurred(false));
    }
  }, []);

  // ── Settings (persisted in state, could be localStorage later) ─────────
  const [settings, setSettings] = useState({
    enableThinking: true,
    thinkingBudget: 8192,
    maxTokens: 8192,
    temperature: 0.6,
    topP: 0.95,
  });

  // ── Health check ───────────────────────────────────────────────────────
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        setServerOnline(true);
        setServerInfo(data);
      } else {
        setServerOnline(false);
      }
    } catch {
      setServerOnline(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  const activeConversation = conversations.find((c) => c.id === activeId) || conversations[0];

  const updateConversation = useCallback((id, updater) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? updater(c) : c))
    );
  }, []);

  const handleNewChat = useCallback(() => {
    const conv = createConversation();
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    setLastTimings(null);
  }, []);

  const purgeAllData = useCallback(() => {
    if (window.confirm("CRITICAL WARNING: This will permanently erase all chat histories, settings, and states from this machine. Proceed?")) {
      localStorage.clear();
      sessionStorage.clear();
      const fresh = createConversation();
      setConversations([fresh]);
      setActiveId(fresh.id);
      setLastTimings(null);
    }
  }, []);

  const handleSend = useCallback(
    async (text) => {
      if (!text.trim() || isStreaming) return;

      const userMessage = { role: "user", content: text.trim() };
      const convId = activeId;

      // Append user message
      updateConversation(convId, (c) => {
        const updated = { ...c, messages: [...c.messages, userMessage] };
        if (c.messages.length === 0) {
          updated.title = text.trim().slice(0, 50) + (text.length > 50 ? "…" : "");
        }
        return updated;
      });

      // Assistant placeholder
      const assistantId = uid();
      updateConversation(convId, (c) => ({
        ...c,
        messages: [
          ...c.messages,
          { role: "assistant", content: "", _id: assistantId, _raw: "" },
        ],
      }));

      setIsStreaming(true);
      setLastTimings(null);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const currentConv = conversations.find((c) => c.id === convId);
        // Build messages — strip _id, _raw, and any parsed thinking from history
        const allMessages = [
          ...currentConv.messages,
          userMessage,
        ].map(({ role, content, _raw }) => {
          // For assistant messages that had thinking, only send the response part
          if (role === "assistant" && _raw) {
            const { response } = parseThinking(_raw);
            return { role, content: response || content };
          }
          return { role, content };
        });

        const payloadObj = {
          messages: allMessages,
          stream: true,
          max_tokens: settings.maxTokens,
          temperature: settings.temperature,
          top_p: settings.topP,
          enable_thinking: settings.enableThinking,
          thinking_budget: settings.thinkingBudget,
        };

        const res = await fetch(`${API_URL}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadObj),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`Server error: ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") break;

            try {
              const parsed = JSON.parse(data);

              // Handle timings chunk
              if (parsed.object === "chat.completion.timings") {
                setLastTimings(parsed.timings);
                continue;
              }

              const token = parsed.choices?.[0]?.delta?.content || "";
              if (token) {
                updateConversation(convId, (c) => ({
                  ...c,
                  messages: c.messages.map((m) => {
                    if (m._id !== assistantId) return m;
                    const newRaw = (m._raw || "") + token;
                    const { thinking, response } = parseThinking(newRaw);
                    return {
                      ...m,
                      _raw: newRaw,
                      content: response || "",
                      _thinking: thinking,
                    };
                  }),
                }));
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          updateConversation(convId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m._id === assistantId
                ? { ...m, content: m.content || `⚠️ Error: ${err.message}` }
                : m
            ),
          }));
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
        checkHealth();
      }
    },
    [activeId, isStreaming, conversations, updateConversation, checkHealth, settings]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return (
    <div className="app-layout" style={{ filter: isBlurred ? "blur(100px)" : "none", transition: "filter 0.05s ease-in" }}>
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => { setActiveId(id); setLastTimings(null); }}
        onNewChat={handleNewChat}
        serverOnline={serverOnline}
        serverInfo={serverInfo}
        onOpenSettings={() => setShowSettings(true)}
        onPurgeData={purgeAllData}
      />
      <div className="chat-main">
        <StatsBar
          timings={lastTimings}
          isStreaming={isStreaming}
          serverInfo={serverInfo}
        />
        <ChatWindow
          messages={activeConversation.messages}
          isStreaming={isStreaming}
        />
        <MessageInput
          onSend={handleSend}
          onStop={handleStop}
          isStreaming={isStreaming}
          disabled={!serverOnline}
          settings={settings}
        />
      </div>
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onUpdate={setSettings}
          onClose={() => setShowSettings(false)}
          serverInfo={serverInfo}
        />
      )}
    </div>
  );
}
