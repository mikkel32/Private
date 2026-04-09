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
    title: "Secure Session",
    createdAt: Date.now(),
  };
}

// String Parsing Banned - Ghost Protocol V2 Active

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

  useEffect(() => {
    if (serverOnline && activeId && !isStreaming) {
       window.electronAPI.fetchHistory(activeId);
    }
  }, [activeId, serverOnline, isStreaming]);

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
      if (isStreaming) return;

      const userMessage = { role: "user", content: "<|SECURE_INJECT|>" };
      const convId = activeId;

      setIsStreaming(true);
      setLastTimings(null);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const payloadObj = {
          conversation_id: convId,
          message: userMessage,
          stream: true,
          max_tokens: settings.maxTokens,
          temperature: settings.temperature,
          top_p: settings.topP,
          enable_thinking: settings.enableThinking,
          thinking_budget: settings.thinkingBudget,
        };

        const jsonString = JSON.stringify(payloadObj);
        const skeletonBuffer = new TextEncoder().encode(jsonString);

        window.electronAPI.offStreamEvents();

        window.electronAPI.onStreamEnd(() => {
           window.electronAPI.wipeVault();
           setIsStreaming(false);
           abortRef.current = null;
           checkHealth();
           window.electronAPI.offStreamEvents();
        });

        window.electronAPI.secureNetworkDispatch(skeletonBuffer);

      } catch (err) {
        setIsStreaming(false);
        abortRef.current = null;
        console.error("Transmission failed", err);
      }
    },
    [activeId, isStreaming, checkHealth, settings]
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
        <ChatWindow />
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
