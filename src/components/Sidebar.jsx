/**
 * Sidebar — Conversations list, server status, and settings access.
 */
export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  serverOnline,
  serverInfo,
  onOpenSettings,
  onPurgeData,
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Gemma Chat</h1>
        <div className="subtitle">Private · Local · Uncensored</div>
      </div>

      <button className="new-chat-btn" onClick={onNewChat} id="new-chat-button">
        <span className="icon">+</span>
        New chat
      </button>

      <div className="conversation-list">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`conversation-item ${conv.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(conv.id)}
            title={conv.title}
          >
            {conv.title}
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <button 
          className="danger-action-btn" 
          onClick={onPurgeData}
          title="Permanently Erase All Data"
          style={{ width: '100%', padding: '10px', background: '#301010', color: '#ff6b6b', border: '1px solid #ff444455', borderRadius: '6px', marginBottom: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '13px' }}
        >
          <span>🔥</span> Erase All Data
        </button>

        <div className="sidebar-footer-controls" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className={`model-badge ${serverOnline ? "" : "offline"}`}>
            <span className="dot" />
            <div className="model-info">
              <span className="model-name">
                {serverOnline ? "Gemma 4 — Online" : "Server offline"}
              </span>
              {serverOnline && serverInfo?.kv_cache && (
                <span className="model-detail">
                  KV: {serverInfo.kv_cache.type_k}/{serverInfo.kv_cache.type_v}
                  {serverInfo.kv_cache.flash_attn && " · FA"}
                </span>
              )}
            </div>
          </div>
          <button
            className="settings-btn"
            onClick={onOpenSettings}
            title="Settings"
            id="settings-button"
          >
            ⚙
          </button>
        </div>
      </div>
    </aside>
  );
}
