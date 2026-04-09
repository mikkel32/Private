import { useState } from "react";

/**
 * SettingsPanel — Floating modal for configuring inference parameters.
 * Controls reasoning mode, thinking budget, temperature, max tokens.
 */
export default function SettingsPanel({ settings, onUpdate, onClose, serverInfo }) {
  const [local, setLocal] = useState({ ...settings });

  const update = (key, value) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onUpdate(local);
    onClose();
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          {/* ── Reasoning Section ─────────────────────────────────────── */}
          <div className="settings-section">
            <h3>🧠 Reasoning</h3>
            <p className="settings-desc">
              Enable Gemma 4's chain-of-thought reasoning mode. The model will
              think step-by-step before responding.
            </p>

            <div className="setting-row">
              <label htmlFor="enable-thinking">Enable Thinking</label>
              <button
                id="enable-thinking"
                className={`toggle-btn ${local.enableThinking ? "on" : ""}`}
                onClick={() => update("enableThinking", !local.enableThinking)}
              >
                <span className="toggle-thumb" />
              </button>
            </div>

            <div className="setting-row">
              <label htmlFor="thinking-budget">
                Thinking Budget
                <span className="setting-hint">{local.thinkingBudget} tokens</span>
              </label>
              <input
                id="thinking-budget"
                type="range"
                min="0"
                max="32768"
                step="1024"
                value={local.thinkingBudget}
                onChange={(e) => update("thinkingBudget", Number(e.target.value))}
                disabled={!local.enableThinking}
              />
            </div>
          </div>

          {/* ── Generation Section ────────────────────────────────────── */}
          <div className="settings-section">
            <h3>⚡ Generation</h3>

            <div className="setting-row">
              <label htmlFor="max-tokens">
                Max Tokens
                <span className="setting-hint">{local.maxTokens}</span>
              </label>
              <input
                id="max-tokens"
                type="range"
                min="512"
                max="32768"
                step="1024"
                value={local.maxTokens}
                onChange={(e) => update("maxTokens", Number(e.target.value))}
              />
            </div>

            <div className="setting-row">
              <label htmlFor="temperature">
                Temperature
                <span className="setting-hint">{local.temperature.toFixed(1)}</span>
              </label>
              <input
                id="temperature"
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={local.temperature}
                onChange={(e) => update("temperature", Number(e.target.value))}
              />
            </div>

            <div className="setting-row">
              <label htmlFor="top-p">
                Top P
                <span className="setting-hint">{local.topP.toFixed(2)}</span>
              </label>
              <input
                id="top-p"
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={local.topP}
                onChange={(e) => update("topP", Number(e.target.value))}
              />
            </div>
          </div>

          {/* ── System Info ───────────────────────────────────────────── */}
          {serverInfo && (
            <div className="settings-section">
              <h3>📊 System</h3>

              <div className="system-info-grid">
                <div className="sys-item">
                  <span className="sys-label">Model</span>
                  <span className="sys-value">{serverInfo.model}</span>
                </div>
                <div className="sys-item">
                  <span className="sys-label">Context</span>
                  <span className="sys-value">
                    {serverInfo.context_size >= 1024
                      ? `${Math.round(serverInfo.context_size / 1024)}K`
                      : serverInfo.context_size}{" "}
                    tokens
                  </span>
                </div>
                {serverInfo.kv_cache && (
                  <>
                    <div className="sys-item">
                      <span className="sys-label">K Cache</span>
                      <span className="sys-value">{serverInfo.kv_cache.type_k}</span>
                    </div>
                    <div className="sys-item">
                      <span className="sys-label">V Cache</span>
                      <span className="sys-value">{serverInfo.kv_cache.type_v}</span>
                    </div>
                    <div className="sys-item">
                      <span className="sys-label">Flash Attn</span>
                      <span className="sys-value">
                        {serverInfo.kv_cache.flash_attn ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <div className="sys-item">
                      <span className="sys-label">KV Memory</span>
                      <span className="sys-value">~2.6 GB</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
