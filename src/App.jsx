import { useState, useCallback, useRef, useEffect } from "react";
import Sidebar from "./components/Sidebar.jsx";
import ChatWindow from "./components/ChatWindow.jsx";
import MessageInput from "./components/MessageInput.jsx";
import StatsBar from "./components/StatsBar.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";

// API_URL has been removed to enforce zero-trust IPC routing

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
      const res = await window.electronAPI.checkServerHealth();
      if (res && res.ok) {
        setServerOnline(true);
        setServerInfo(res.data);
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
        const configObj = {
          conversation_id: convId,
          max_tokens: settings.maxTokens,
          temperature: settings.temperature,
          top_p: settings.topP,
          enable_thinking: settings.enableThinking ? 1 : 0,
          thinking_budget: settings.thinkingBudget,
        };

        window.electronAPI.offStreamEvents();

        window.electronAPI.onStreamEnd(() => {
           window.electronAPI.wipeVault();
           setIsStreaming(false);
           abortRef.current = null;
           checkHealth();
           window.electronAPI.offStreamEvents();
        });

        window.electronAPI.secureNetworkDispatch(configObj);

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

  const [exportKeyUrl, setExportKeyUrl] = useState(null);

  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.onVaultExportKey((bufferArray) => {
        // Transform the raw ArrayBuffer back to a local URL for the <img> tag
        const blob = new Blob([new Uint8Array(bufferArray)], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        setExportKeyUrl(url);
    });
    return () => window.electronAPI.offVaultExportKey();
  }, []);

  const closeExportModal = useCallback(() => {
      if (exportKeyUrl) {
          URL.revokeObjectURL(exportKeyUrl);
          setExportKeyUrl(null);
      }
  }, [exportKeyUrl]);

  return (
    <div className="app-layout" style={{ filter: isBlurred ? "blur(100px)" : "none", transition: "filter 0.05s ease-in", position: 'relative' }}>
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => { setActiveId(id); setLastTimings(null); }}
        onNewChat={handleNewChat}
        serverOnline={serverOnline}
        serverInfo={serverInfo}
        onOpenSettings={() => setShowSettings(true)}
        onPurgeData={purgeAllData}
        onExport={() => window.electronAPI.exportVault(activeId)}
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
      
      {exportKeyUrl && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
             <div style={{ background: '#1e1e24', padding: '20px', borderRadius: '8px', border: '1px solid #4caf50', maxWidth: '80%', maxHeight: '80%', display: 'flex', flexDirection: 'column' }}>
                 <h2 style={{ color: '#4caf50', margin: '0 0 10px 0', textAlign: 'center' }}>AES Vault Export Complete</h2>
                 <p style={{ color: '#aaa', fontSize: '13px', textAlign: 'center', marginTop: 0, marginBottom: '20px', lineHeight: '1.5' }}>The .enc file has been written to your Desktop. This is your ONLY chance to record the decryption password.</p>
                 <img src={exportKeyUrl} alt="Decryption Key" style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', userSelect: 'none' }} draggable="false" />
                 <button onClick={closeExportModal} style={{ marginTop: '20px', padding: '10px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer' }}>I have secured the password</button>
             </div>
          </div>
      )}
    </div>
  );
}
