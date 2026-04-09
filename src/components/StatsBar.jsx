/**
 * StatsBar — Performance telemetry display.
 * Shows TTFT, TPS, total time, and token count after each generation.
 * Animates in when data arrives, pulses during streaming.
 */
export default function StatsBar({ timings, isStreaming, serverInfo }) {
  if (!timings && !isStreaming) return null;

  const formatMs = (ms) => {
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
    return `${Math.round(ms)} ms`;
  };

  return (
    <div className={`stats-bar ${isStreaming ? "streaming" : ""}`}>
      {isStreaming && !timings ? (
        <div className="stats-streaming">
          <span className="stats-pulse" />
          <span>Generating…</span>
        </div>
      ) : timings ? (
        <div className="stats-grid">
          <div className="stat-item" title="Total generation time">
            <span className="stat-value">{formatMs(timings.total_ms)}</span>
            <span className="stat-label">Total</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item" title="Tokens per second (decode speed)">
            <span className="stat-value">{timings.tps.toFixed(2)}</span>
            <span className="stat-label">TPS</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item" title="Time to first token (prompt processing)">
            <span className="stat-value">{formatMs(timings.ttft_ms)}</span>
            <span className="stat-label">TTFT</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item" title="Completion tokens generated">
            <span className="stat-value">{timings.tokens}</span>
            <span className="stat-label">Tokens</span>
          </div>
          {serverInfo?.kv_cache && (
            <>
              <div className="stat-divider" />
              <div className="stat-item" title="KV Cache quantization">
                <span className="stat-value stat-cache">
                  K:{serverInfo.kv_cache.type_k} V:{serverInfo.kv_cache.type_v}
                </span>
                <span className="stat-label">KV Cache</span>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
