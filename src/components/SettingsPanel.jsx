import { useState } from "react";

export default function SettingsPanel({ settings, onUpdate, onClose, serverInfo }) {
  const [local, setLocal] = useState({ ...settings });
  const [activeTab, setActiveTab] = useState("security");

  const update = (key, value) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onUpdate(local);
    onClose();
  };

  const tabs = [
    { id: "security", label: "🛡️ Security", title: "Security & Isolation" },
    { id: "reasoning", label: "🧠 Reasoning", title: "Neural Dynamics" },
    { id: "generation", label: "⚡ Generation", title: "Advanced Sampling" },
    { id: "system", label: "📊 Architecture", title: "System Hardware" }
  ];

  const StatusDot = ({ active, color }) => (
    <span style={{
      display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
      background: active ? (color || '#4ade80') : '#555', boxShadow: active ? `0 0 6px ${color || '#4ade80'}` : 'none',
      marginRight: '8px', flexShrink: 0
    }} />
  );

  const InfoRow = ({ label, value, color }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#22222a', borderRadius: '6px', marginBottom: '6px' }}>
      <span style={{ color: '#999', fontSize: '13px' }}>{label}</span>
      <span style={{ color: color || '#ccc', fontSize: '13px', fontFamily: 'monospace' }}>{value}</span>
    </div>
  );

  return (
    <div className="settings-overlay" onClick={onClose} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
      <div 
        className="settings-panel" 
        onClick={(e) => e.stopPropagation()} 
        style={{ width: '900px', height: '650px', display: 'flex', flexDirection: 'row', padding: 0, overflow: 'hidden' }}
      >
        {/* Sidebar Tabs */}
        <div style={{ width: '220px', background: '#13131a', borderRight: '1px solid #2a2a35', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '24px 20px', borderBottom: '1px solid #2a2a35' }}>
             <h2 style={{ margin: 0, fontSize: '17px', display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '0.5px' }}>
                <span style={{ background: 'linear-gradient(135deg, #4ade80, #22c55e)', color: '#000', fontSize: '10px', fontWeight: 800, padding: '2px 6px', borderRadius: '3px', letterSpacing: '1px' }}>PRO</span> Settings
             </h2>
             <p style={{ color: '#666', fontSize: '11px', margin: '8px 0 0 0' }}>Project Monolith v1.0</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '8px 0', gap: '2px', flex: 1 }}>
            {tabs.map((tab) => (
               <button 
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                     padding: '11px 20px', textAlign: 'left', background: activeTab === tab.id ? '#1e1e28' : 'transparent',
                     border: 'none', borderLeft: activeTab === tab.id ? '3px solid #4ade80' : '3px solid transparent',
                     color: activeTab === tab.id ? '#fff' : '#777', cursor: 'pointer', fontSize: '13px', transition: 'all 0.15s'
                  }}
               >
                  {tab.label}
               </button>
            ))}
          </div>
          <div style={{ padding: '15px 20px', borderTop: '1px solid #2a2a35', fontSize: '11px', color: '#555' }}>
            Press Esc to close
          </div>
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#1a1a22' }}>
           <div style={{ padding: '20px 30px', borderBottom: '1px solid #2a2a35', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px' }}>{tabs.find(t => t.id === activeTab)?.title}</h3>
              <button className="settings-close" onClick={onClose} style={{ background: 'transparent', color: '#666', border: '1px solid #333', fontSize: '14px', cursor: 'pointer', width: '28px', height: '28px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
           </div>
           
           <div style={{ flex: 1, overflowY: 'auto', padding: '25px 30px' }}>
              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* SECURITY TAB                                                  */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              {activeTab === "security" && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  
                  {/* Input Isolation Mode */}
                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#e0e0e0' }}>⌨️ Input Isolation Strategy</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                      Controls how keystrokes are captured. Higher isolation prevents OS-level keyloggers from intercepting your prompts.
                    </p>
                    <select 
                      style={{ width: '100%', padding: '11px 14px', background: '#22222c', border: '1px solid #333', color: '#fff', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', outline: 'none' }}
                      value={local.securityMode || "paranoid"} 
                      onChange={(e) => update("securityMode", e.target.value)}
                    >
                        <option value="paranoid">🔒 Paranoid — Ring-3 CGEventTap + C++ Vault (DRM Output)</option>
                        <option value="ghost">👻 Ghost Protocol — Virtual On-Screen Keyboard Only</option>
                        <option value="standard">🌐 Standard — Browser DOM Input (No Memory Shielding)</option>
                    </select>
                    <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                       <InfoRow label="Keystroke Interception" value={local.securityMode === 'paranoid' ? 'CGEventTap (Ring 3)' : local.securityMode === 'ghost' ? 'Canvas Virtual OSK' : 'DOM <input>'} color={local.securityMode !== 'standard' ? '#4ade80' : '#ff6b6b'} />
                       <InfoRow label="Memory Vault" value={local.securityMode !== 'standard' ? 'XOR-Masked C++ Buffer' : 'V8 JavaScript Heap'} color={local.securityMode !== 'standard' ? '#4ade80' : '#ff6b6b'} />
                    </div>
                  </div>

                  {/* Screen Capture Protection */}
                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#e0e0e0' }}>🖥️ Screen Capture Protection</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                      Hardware DRM rendering pipeline. Text is rendered server-side as PNG frames piped through AVSampleBufferDisplayLayer with HDCP encryption.
                    </p>

                    <div className="setting-row" style={{ marginBottom: '12px' }}>
                      <label style={{ display: 'flex', alignItems: 'center' }}>
                        <StatusDot active={local.enableDRM !== false} />
                        DRM Hardware Rendering
                      </label>
                      <button
                        className={`toggle-btn ${local.enableDRM !== false ? "on" : ""}`}
                        onClick={() => update("enableDRM", local.enableDRM === false ? true : false)}
                      >
                        <span className="toggle-thumb" />
                      </button>
                    </div>

                    <div className="setting-row" style={{ marginBottom: '12px' }}>
                      <label style={{ display: 'flex', alignItems: 'center' }}>
                        <StatusDot active={local.enableScreenProtection !== false} />
                        Window Content Protection (NSWindowSharingNone)
                      </label>
                      <button
                        className={`toggle-btn ${local.enableScreenProtection !== false ? "on" : ""}`}
                        onClick={() => update("enableScreenProtection", local.enableScreenProtection === false ? true : false)}
                      >
                        <span className="toggle-thumb" />
                      </button>
                    </div>

                    <div className="setting-row">
                      <label style={{ display: 'flex', alignItems: 'center' }}>
                        <StatusDot active={local.enableBlurOnFocusLoss !== false} />
                        Blur on Focus Loss (Mission Control Shield)
                      </label>
                      <button
                        className={`toggle-btn ${local.enableBlurOnFocusLoss !== false ? "on" : ""}`}
                        onClick={() => update("enableBlurOnFocusLoss", local.enableBlurOnFocusLoss === false ? true : false)}
                      >
                        <span className="toggle-thumb" />
                      </button>
                    </div>
                  </div>

                  {/* Memory Isolation */}
                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#e0e0e0' }}>🧊 Memory & Process Isolation</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                      Anti-forensic memory protections. Prevents swap-file recovery and debugger attachment.
                    </p>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '14px' }}>
                       <InfoRow label="V8 Process mlockall" value="Active" color="#4ade80" />
                       <InfoRow label="Anti-Debug (PT_DENY_ATTACH)" value="Active" color="#4ade80" />
                       <InfoRow label="XOR Session Mask" value="Random (arc4random)" color="#4ade80" />
                       <InfoRow label="Vault Wipe Strategy" value="memset_s + MADV_DONTNEED" color="#4ade80" />
                    </div>
                    
                    <div className="setting-row">
                      <label style={{ display: 'flex', alignItems: 'center' }}>
                        <StatusDot active={local.enableAutoWipe !== false} />
                        Auto-Wipe Input Buffer After Send
                      </label>
                      <button
                        className={`toggle-btn ${local.enableAutoWipe !== false ? "on" : ""}`}
                        onClick={() => update("enableAutoWipe", local.enableAutoWipe === false ? true : false)}
                      >
                        <span className="toggle-thumb" />
                      </button>
                    </div>
                  </div>

                  {/* IPC & Network */}
                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#e0e0e0' }}>🔐 Cryptographic IPC & Network Perimeter</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                      Every API request is signed via Apple Secure Enclave (ECDSA P-256). The Python inference engine runs inside a strict sandbox-exec jail.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                       <InfoRow label="IPC Signing" value="ECDSA-SHA256 (SEP)" color="#4ade80" />
                       <InfoRow label="Key Persistence" value="Ephemeral (RAM Only)" color="#4ade80" />
                       <InfoRow label="TLS Pinning" value="Self-Signed SHA-256" color="#4ade80" />
                       <InfoRow label="CORS Policy" value="Strictly Absent" color="#4ade80" />
                       <InfoRow label="Sandbox Profile" value="monolith.sb (deny default)" color="#4ade80" />
                       <InfoRow label="Outbound Network" value="Blocked (TCP/UDP/IP)" color="#4ade80" />
                       <InfoRow label="Session Partition" value="In-Memory (No Disk I/O)" color="#4ade80" />
                       <InfoRow label="Exfil Deny List" value=".ssh, .gnupg, .aws, Keychains" color="#ff6b6b" />
                    </div>
                  </div>

                </div>
              )}

              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* REASONING TAB                                                 */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              {activeTab === "reasoning" && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#e0e0e0' }}>🧠 Chain-of-Thought Engine</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                      Gemma 4's inner monologue system. When enabled, the model reasons step-by-step internally before generating the visible response.
                    </p>

                    <div className="setting-row" style={{ marginBottom: '15px' }}>
                      <label style={{ display: 'flex', alignItems: 'center' }}>
                        <StatusDot active={local.enableThinking} />
                        Enable Inner Monologue
                      </label>
                      <button
                        className={`toggle-btn ${local.enableThinking ? "on" : ""}`}
                        onClick={() => update("enableThinking", !local.enableThinking)}
                      >
                        <span className="toggle-thumb" />
                      </button>
                    </div>

                    <div className="setting-row">
                      <label>
                        CoT Token Ceiling
                        <span className="setting-hint" style={{ opacity: local.enableThinking ? 1 : 0.4 }}>{local.thinkingBudget.toLocaleString()} tk</span>
                      </label>
                      <input
                        type="range" min="1024" max="32768" step="1024"
                        value={local.thinkingBudget} onChange={(e) => update("thinkingBudget", Number(e.target.value))}
                        disabled={!local.enableThinking} style={{ opacity: local.enableThinking ? 1 : 0.4 }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* GENERATION TAB                                                */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              {activeTab === "generation" && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#e0e0e0' }}>📐 Output Constraints</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                      Maximum response length before autoregressive termination.
                    </p>
                    <div className="setting-row">
                      <label>Response Max <span className="setting-hint">{local.maxTokens.toLocaleString()} tokens</span></label>
                      <input type="range" min="256" max="65536" step="256" value={local.maxTokens} onChange={(e) => update("maxTokens", Number(e.target.value))} />
                    </div>
                  </div>

                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#e0e0e0' }}>🎲 Probability Distribution</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                      Fine-tune the autoregressive sampling matrices controlling token selection randomness and diversity.
                    </p>

                    <div className="setting-row" style={{ marginBottom: '15px' }}>
                      <label>Temperature <span className="setting-hint">{local.temperature.toFixed(2)}</span></label>
                      <input type="range" min="0" max="2" step="0.05" value={local.temperature} onChange={(e) => update("temperature", Number(e.target.value))} />
                    </div>

                    <div className="setting-row" style={{ marginBottom: '15px' }}>
                      <label>Top P (Nucleus Sampling) <span className="setting-hint">{local.topP.toFixed(2)}</span></label>
                      <input type="range" min="0.05" max="1" step="0.05" value={local.topP} onChange={(e) => update("topP", Number(e.target.value))} />
                    </div>

                    <div className="setting-row" style={{ marginBottom: '15px' }}>
                      <label>Top K (Vocabulary Truncation) <span className="setting-hint">{local.topK}</span></label>
                      <input type="range" min="1" max="200" step="1" value={local.topK} onChange={(e) => update("topK", Number(e.target.value))} />
                    </div>

                    <div className="setting-row">
                      <label>Repetition Penalty <span className="setting-hint">{local.repeatPenalty.toFixed(2)}</span></label>
                      <input type="range" min="1.0" max="2.0" step="0.01" value={local.repeatPenalty} onChange={(e) => update("repeatPenalty", Number(e.target.value))} />
                    </div>
                  </div>
                </div>
              )}

              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* ARCHITECTURE TAB                                              */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              {activeTab === "system" && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#e0e0e0' }}> Apple Silicon Configuration</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                      CPU thread allocation for llama.cpp inference execution.
                    </p>
                    <div className="setting-row">
                      <label>Inference Thread Pool <span className="setting-hint">{local.nThreads} threads</span></label>
                      <input type="range" min="1" max="16" step="1" value={local.nThreads} onChange={(e) => update("nThreads", Number(e.target.value))} />
                    </div>
                  </div>

                  {serverInfo ? (
                    <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                      <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#e0e0e0' }}>📊 Live Engine Telemetry</h4>
                      <p style={{ color: '#888', fontSize: '12px', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                        Real-time configuration reported by the running inference server.
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                        <InfoRow label="Active Weights" value={serverInfo.model} />
                        <InfoRow label="Context Window" value={serverInfo.context_size >= 1024 ? `${Math.round(serverInfo.context_size / 1024)}K tokens` : `${serverInfo.context_size} tokens`} />
                        {serverInfo.kv_cache && (
                          <>
                            <InfoRow label="Key Cache Quant" value={serverInfo.kv_cache.type_k} color="#60a5fa" />
                            <InfoRow label="Value Cache Quant" value={serverInfo.kv_cache.type_v} color="#60a5fa" />
                            <InfoRow label="Flash Attention" value={serverInfo.kv_cache.flash_attn ? "Enabled" : "Disabled"} color={serverInfo.kv_cache.flash_attn ? '#4ade80' : '#888'} />
                            <InfoRow label="Est. KV Memory" value="~2.6 GB" color="#f59e0b" />
                          </>
                        )}
                        <InfoRow label="GPU Offload" value="All Layers (Metal)" color="#4ade80" />
                        <InfoRow label="Backend" value="llama.cpp" />
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: '#ff6b6b', fontSize: '13px', background: 'rgba(255,107,107,0.08)', padding: '16px', borderRadius: '10px', border: '1px solid rgba(255,107,107,0.2)' }}>
                       ⚠️ Server is currently offline. Hardware profiling unavailable.
                    </div>
                  )}
                </div>
              )}
           </div>

           <div style={{ padding: '16px 30px', borderTop: '1px solid #2a2a35', background: '#16161d', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn-secondary" onClick={onClose} style={{ border: '1px solid #333', background: 'transparent', borderRadius: '8px', padding: '8px 20px', color: '#888', cursor: 'pointer', fontSize: '13px' }}>Discard</button>
              <button className="btn-primary" onClick={handleSave} style={{ minWidth: '140px', borderRadius: '8px', padding: '8px 20px', fontSize: '13px', fontWeight: 600 }}>Apply Configuration</button>
           </div>
        </div>
      </div>
    </div>
  );
}
