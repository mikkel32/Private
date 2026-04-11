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

  const InfoRow = ({ label, value, color, hint }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', background: '#22222a', borderRadius: '6px', marginBottom: '6px' }}>
      <span style={{ color: '#999', fontSize: '12px' }}>{label}</span>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <span style={{ color: color || '#ccc', fontSize: '12px', fontFamily: 'monospace' }}>{value}</span>
        {hint && <span style={{ color: '#666', fontSize: '10px', marginTop: '2px' }}>{hint}</span>}
      </div>
    </div>
  );

  const ToggleRow = ({ label, description, active, onToggle }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 0', borderBottom: '1px solid #22222a' }}>
      <div style={{ flex: 1, paddingRight: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '3px' }}>
          <StatusDot active={active} />
          <span style={{ fontSize: '13px', color: '#e0e0e0' }}>{label}</span>
        </div>
        {description && <p style={{ color: '#777', fontSize: '11px', margin: '0 0 0 16px', lineHeight: '1.4' }}>{description}</p>}
      </div>
      <button
        className={`toggle-btn ${active ? "on" : ""}`}
        onClick={onToggle}
        style={{ flexShrink: 0, marginTop: '2px' }}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  );

  const modeExplanations = {
    paranoid: {
      title: "Maximum Isolation",
      color: "#4ade80",
      details: [
        "Your keystrokes are intercepted at the macOS system level (CGEventTap) before they reach the browser.",
        "Text is stored in a C++ memory buffer encrypted with a random XOR mask — never touches JavaScript.",
        "AI responses are rendered as encrypted PNG frames via Apple's hardware DRM pipeline, invisible to screen scrapers.",
        "No text data exists anywhere in the Chromium DOM or V8 heap."
      ]
    },
    ghost: {
      title: "Virtual Keyboard Only",
      color: "#f59e0b",
      details: [
        "An on-screen keyboard with randomized key positions appears above the input field.",
        "Key layout shuffles after every keystroke to defeat visual pattern analysis and shoulder-surfing.",
        "Characters are routed directly to the C++ vault via IPC — the physical keyboard is completely ignored.",
        "Slightly slower input speed, but immune to both hardware and software keyloggers."
      ]
    },
    standard: {
      title: "Maximum UX — Full Security",
      color: "#4caf50",
      details: [
        "All encryption, DRM rendering, and secure memory protections remain fully active.",
        "Keystrokes are captured via the C++ secure vault — text never exists in JavaScript memory or the DOM.",
        "The only difference: the OCR adversarial overlay (scanlines, zebra striping) is disabled for cleaner readability.",
        "Screen capture protection (preventsCapture + NSWindowSharingNone) remains enforced at all times."
      ]
    }
  };

  const currentMode = modeExplanations[local.securityMode] || modeExplanations.paranoid;

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
              <button onClick={onClose} style={{ background: 'transparent', color: '#666', border: '1px solid #333', fontSize: '14px', cursor: 'pointer', width: '28px', height: '28px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
           </div>
           
           <div style={{ flex: 1, overflowY: 'auto', padding: '25px 30px' }}>

              {/* ═══════════ SECURITY TAB ═══════════ */}
              {activeTab === "security" && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  
                  {/* Input Isolation Mode */}
                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#e0e0e0' }}>⌨️ Input Isolation Mode</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                      Determines how your typed messages are captured and stored in memory before being sent to the AI.
                    </p>
                    <select 
                      style={{ width: '100%', padding: '11px 14px', background: '#22222c', border: '1px solid #333', color: '#fff', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', outline: 'none' }}
                      value={local.securityMode || "paranoid"} 
                      onChange={(e) => update("securityMode", e.target.value)}
                    >
                        <option value="paranoid">🔒 Paranoid — Hardware-level keystroke capture with DRM rendering</option>
                        <option value="ghost">👻 Ghost Protocol — Randomized on-screen keyboard</option>
                        <option value="standard">🔓 Standard — Full encryption, OCR shield disabled for readability</option>
                    </select>

                    {/* Dynamic Explanation Card */}
                    <div style={{ marginTop: '14px', background: '#16161e', borderRadius: '8px', padding: '14px 16px', border: `1px solid ${currentMode.color}33` }}>
                       <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: currentMode.color, boxShadow: `0 0 8px ${currentMode.color}` }} />
                          <span style={{ color: currentMode.color, fontSize: '13px', fontWeight: 600 }}>{currentMode.title}</span>
                       </div>
                       <ul style={{ margin: 0, padding: '0 0 0 20px', listStyle: 'none' }}>
                         {currentMode.details.map((d, i) => (
                           <li key={i} style={{ color: '#aaa', fontSize: '11.5px', lineHeight: '1.6', marginBottom: '4px', position: 'relative' }}>
                             <span style={{ position: 'absolute', left: '-16px', color: '#555' }}>›</span>
                             {d}
                           </li>
                         ))}
                       </ul>
                    </div>

                    <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                       <InfoRow label="Keystroke Method" value={local.securityMode === 'paranoid' ? 'CGEventTap' : local.securityMode === 'ghost' ? 'Virtual Canvas' : 'DOM <input>'} color={local.securityMode !== 'standard' ? '#4ade80' : '#ff6b6b'} hint={local.securityMode === 'paranoid' ? 'macOS Ring 3' : local.securityMode === 'ghost' ? 'Anti-keylogger' : 'No protection'} />
                       <InfoRow label="Memory Storage" value={local.securityMode !== 'standard' ? 'C++ XOR Vault' : 'JS Heap'} color={local.securityMode !== 'standard' ? '#4ade80' : '#ff6b6b'} hint={local.securityMode !== 'standard' ? 'Encrypted at rest' : 'Visible to extensions'} />
                    </div>
                  </div>

                  {/* Screen Capture Protection */}
                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#e0e0e0' }}>🖥️ Screen Capture Defence</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 6px 0', lineHeight: '1.5' }}>
                      Controls whether the AI's responses can be captured by screenshots, screen recording, or screen sharing tools.
                    </p>

                    <ToggleRow 
                      label="DRM Hardware Rendering"
                      description="AI responses are rendered as encrypted video frames using Apple's AVSampleBufferDisplayLayer. Screen capture tools see a black rectangle instead of your conversation."
                      active={local.enableDRM !== false}
                      onToggle={() => update("enableDRM", local.enableDRM === false ? true : false)}
                    />

                    <ToggleRow 
                      label="Window Recording Block"
                      description="Marks the window as non-sharable at the macOS Window Server level. Prevents OBS, QuickTime, and AirPlay from capturing the window content."
                      active={local.enableScreenProtection !== false}
                      onToggle={() => update("enableScreenProtection", local.enableScreenProtection === false ? true : false)}
                    />

                    <ToggleRow 
                      label="Blur on Window Unfocus"
                      description="Instantly blurs the entire window when you switch to another app (Cmd+Tab, Mission Control). Prevents visual eavesdropping from over-the-shoulder attacks or screen recording of your desktop."
                      active={local.enableBlurOnFocusLoss !== false}
                      onToggle={() => update("enableBlurOnFocusLoss", local.enableBlurOnFocusLoss === false ? true : false)}
                    />
                  </div>

                  {/* Memory Isolation */}
                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#e0e0e0' }}>🧊 Memory Protection</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 6px 0', lineHeight: '1.5' }}>
                      Prevents your conversation data from being recovered from RAM, swap files, or crash dumps.
                    </p>
                    
                    <ToggleRow
                      label="Auto-Wipe After Send"
                      description="Immediately zeroes out the encrypted input buffer after your message is transmitted to the AI. Prevents forensic recovery of previously typed prompts from process memory."
                      active={local.enableAutoWipe !== false}
                      onToggle={() => update("enableAutoWipe", local.enableAutoWipe === false ? true : false)}
                    />

                    <div style={{ marginTop: '14px' }}>
                      <p style={{ color: '#777', fontSize: '11px', margin: '0 0 8px 0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>Always-On Protections</p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                         <InfoRow label="Process Memory Lock" value="mlockall" color="#4ade80" hint="Prevents swap to disk" />
                         <InfoRow label="Anti-Debugger" value="PT_DENY_ATTACH" color="#4ade80" hint="Blocks LLDB/DTrace" />
                         <InfoRow label="Buffer Encryption" value="XOR Mask" color="#4ade80" hint="Random per session" />
                         <InfoRow label="Wipe Method" value="memset_s" color="#4ade80" hint="Compiler-safe zeroing" />
                      </div>
                    </div>
                  </div>

                  {/* Network Perimeter */}
                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#e0e0e0' }}>🔐 Network & IPC Perimeter</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 12px 0', lineHeight: '1.5' }}>
                      All communication between the UI and AI engine is cryptographically signed. The AI process cannot access the internet.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                       <InfoRow label="Request Signing" value="ECDSA P-256" color="#4ade80" hint="Apple Secure Enclave" />
                       <InfoRow label="Key Lifetime" value="Ephemeral" color="#4ade80" hint="Destroyed on quit" />
                       <InfoRow label="Transport" value="TLS 1.3" color="#4ade80" hint="Self-signed, pinned" />
                       <InfoRow label="CORS Policy" value="None" color="#4ade80" hint="No cross-origin allowed" />
                       <InfoRow label="AI Sandbox" value="deny default" color="#4ade80" hint="monolith.sb profile" />
                       <InfoRow label="Outbound Network" value="Blocked" color="#ff6b6b" hint="TCP/UDP/IP/Unix denied" />
                       <InfoRow label="Browser Session" value="In-Memory" color="#4ade80" hint="Zero disk I/O" />
                       <InfoRow label="Filesystem Deny" value="4 paths" color="#ff6b6b" hint=".ssh .gnupg .aws Keychains" />
                    </div>
                  </div>

                </div>
              )}

              {/* ═══════════ REASONING TAB ═══════════ */}
              {activeTab === "reasoning" && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#e0e0e0' }}>🧠 Chain-of-Thought</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 6px 0', lineHeight: '1.5' }}>
                      When enabled, the model thinks through problems step-by-step internally before generating its visible response.
                      This produces higher quality answers for complex questions but uses more tokens and takes longer.
                    </p>

                    <ToggleRow
                      label="Enable Inner Monologue"
                      description="The model will reason internally using a hidden thought process. The thinking tokens count against the budget below but are not shown in the response."
                      active={local.enableThinking}
                      onToggle={() => update("enableThinking", !local.enableThinking)}
                    />

                    <div className="setting-row" style={{ marginTop: '12px' }}>
                      <label>
                        Thinking Budget
                        <span className="setting-hint" style={{ opacity: local.enableThinking ? 1 : 0.4 }}>{local.thinkingBudget.toLocaleString()} tokens</span>
                      </label>
                      <input
                        type="range" min="1024" max="32768" step="1024"
                        value={local.thinkingBudget} onChange={(e) => update("thinkingBudget", Number(e.target.value))}
                        disabled={!local.enableThinking} style={{ opacity: local.enableThinking ? 1 : 0.4 }}
                      />
                    </div>
                    <p style={{ color: '#666', fontSize: '11px', margin: '6px 0 0 0', lineHeight: '1.4' }}>
                      Higher values allow deeper reasoning but increase response time. 8K is recommended for most tasks.
                    </p>
                  </div>
                </div>
              )}

              {/* ═══════════ GENERATION TAB ═══════════ */}
              {activeTab === "generation" && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#e0e0e0' }}>📐 Response Length</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                      Maximum number of tokens the model can generate in a single response. Longer limits allow more detailed answers but take more time and memory.
                    </p>
                    <div className="setting-row">
                      <label>Max Tokens <span className="setting-hint">{local.maxTokens.toLocaleString()}</span></label>
                      <input type="range" min="256" max="65536" step="256" value={local.maxTokens} onChange={(e) => update("maxTokens", Number(e.target.value))} />
                    </div>
                  </div>

                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#e0e0e0' }}>🎲 Sampling Parameters</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                      These parameters control how the model selects the next word. Lower temperature = more focused and deterministic. Higher = more creative and varied.
                    </p>

                    <div className="setting-row" style={{ marginBottom: '12px' }}>
                      <label>Temperature <span className="setting-hint">{local.temperature.toFixed(2)}</span></label>
                      <input type="range" min="0" max="2" step="0.05" value={local.temperature} onChange={(e) => update("temperature", Number(e.target.value))} />
                    </div>
                    <p style={{ color: '#666', fontSize: '10.5px', margin: '-4px 0 14px 0' }}>0 = deterministic · 0.6 = balanced · 1.5+ = highly creative</p>

                    <div className="setting-row" style={{ marginBottom: '12px' }}>
                      <label>Top P <span className="setting-hint">{local.topP.toFixed(2)}</span></label>
                      <input type="range" min="0.05" max="1" step="0.05" value={local.topP} onChange={(e) => update("topP", Number(e.target.value))} />
                    </div>
                    <p style={{ color: '#666', fontSize: '10.5px', margin: '-4px 0 14px 0' }}>Consider only the most likely tokens whose cumulative probability reaches this threshold</p>

                    <div className="setting-row" style={{ marginBottom: '12px' }}>
                      <label>Top K <span className="setting-hint">{local.topK}</span></label>
                      <input type="range" min="1" max="200" step="1" value={local.topK} onChange={(e) => update("topK", Number(e.target.value))} />
                    </div>
                    <p style={{ color: '#666', fontSize: '10.5px', margin: '-4px 0 14px 0' }}>Only consider the top K most likely next tokens (lower = more focused)</p>

                    <div className="setting-row">
                      <label>Repetition Penalty <span className="setting-hint">{local.repeatPenalty.toFixed(2)}</span></label>
                      <input type="range" min="1.0" max="2.0" step="0.01" value={local.repeatPenalty} onChange={(e) => update("repeatPenalty", Number(e.target.value))} />
                    </div>
                    <p style={{ color: '#666', fontSize: '10.5px', margin: '-4px 0 0 0' }}>Penalises tokens that have already appeared (1.0 = no penalty, 1.3+ = strong anti-repetition)</p>
                  </div>
                </div>
              )}

              {/* ═══════════ SYSTEM TAB ═══════════ */}
              {activeTab === "system" && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#e0e0e0' }}> Thread Allocation</h4>
                    <p style={{ color: '#888', fontSize: '12px', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                      Number of CPU threads used for inference. More threads can speed up generation but may compete with other apps. The model also uses Metal GPU acceleration automatically.
                    </p>
                    <div className="setting-row">
                      <label>Inference Threads <span className="setting-hint">{local.nThreads}</span></label>
                      <input type="range" min="1" max="16" step="1" value={local.nThreads} onChange={(e) => update("nThreads", Number(e.target.value))} />
                    </div>
                  </div>

                  {serverInfo ? (
                    <div style={{ background: '#1e1e28', borderRadius: '10px', padding: '20px', border: '1px solid #2a2a35' }}>
                      <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#e0e0e0' }}>📊 Live Engine Status</h4>
                      <p style={{ color: '#888', fontSize: '12px', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                        Real-time configuration reported by the running inference server.
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                        <InfoRow label="Model" value={serverInfo.model} />
                        <InfoRow label="Context Window" value={serverInfo.context_size >= 1024 ? `${Math.round(serverInfo.context_size / 1024)}K tokens` : `${serverInfo.context_size}`} />
                        {serverInfo.kv_cache && (
                          <>
                            <InfoRow label="Key Cache" value={serverInfo.kv_cache.type_k} color="#60a5fa" hint="Quantized" />
                            <InfoRow label="Value Cache" value={serverInfo.kv_cache.type_v} color="#60a5fa" hint="Quantized" />
                            <InfoRow label="Flash Attention" value={serverInfo.kv_cache.flash_attn ? "Enabled" : "Disabled"} color={serverInfo.kv_cache.flash_attn ? '#4ade80' : '#888'} />
                            <InfoRow label="KV Memory" value="~2.6 GB" color="#f59e0b" hint="Estimated" />
                          </>
                        )}
                        <InfoRow label="GPU Offload" value="All Layers" color="#4ade80" hint="Metal" />
                        <InfoRow label="Backend" value="llama.cpp" />
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: '#ff6b6b', fontSize: '13px', background: 'rgba(255,107,107,0.08)', padding: '16px', borderRadius: '10px', border: '1px solid rgba(255,107,107,0.2)' }}>
                       ⚠️ Server is currently offline. Engine telemetry unavailable.
                    </div>
                  )}
                </div>
              )}
           </div>

           <div style={{ padding: '16px 30px', borderTop: '1px solid #2a2a35', background: '#16161d', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={onClose} style={{ border: '1px solid #333', background: 'transparent', borderRadius: '8px', padding: '8px 20px', color: '#888', cursor: 'pointer', fontSize: '13px' }}>Discard</button>
              <button className="btn-primary" onClick={handleSave} style={{ minWidth: '140px', borderRadius: '8px', padding: '8px 20px', fontSize: '13px', fontWeight: 600 }}>Apply</button>
           </div>
        </div>
      </div>
    </div>
  );
}
