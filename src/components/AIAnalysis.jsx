import { useState } from 'react';
import { API_URL } from '../config/api';

function ClaudeIcon() {
  // Anthropic / Claude "burst" mark
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2c.4 2.8 1 4.4 2 5.4S16.8 9 19.6 9.4c-2.8.4-4.4 1-5.4 2S12.4 16.8 12 19.6c-.4-2.8-1-4.4-2-5.4S7.2 12.4 4.4 12c2.8-.4 4.4-1 5.4-2S11.6 4.8 12 2z" />
    </svg>
  );
}

function ChatGPTIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12a4 4 0 1 1 8 0 4 4 0 0 1-8 0z" />
    </svg>
  );
}

function TrendBadge({ trend }) {
  const t = (trend || '').toLowerCase();
  const cls = t === 'up' ? 'up' : t === 'down' ? 'down' : '';
  const arrow = t === 'up' ? '↑' : t === 'down' ? '↓' : '→';
  return <span className={`ai-trend ${cls}`}>{arrow} {trend || '--'}</span>;
}

function PerformanceRow({ label, row }) {
  if (!row) return null;
  return (
    <tr>
      <td className="ai-perf-period">{label}</td>
      <td><TrendBadge trend={row.trend} /></td>
      <td className="ai-perf-change">{row.change || '--'}</td>
      <td className="ai-perf-reason">{row.reason || '--'}</td>
    </tr>
  );
}

function NoteIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3v5h5" />
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M8 13h8M8 17h6" />
    </svg>
  );
}

export default function AIAnalysis({ ticker, name }) {
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);

  const run = async (prov) => {
    setLoading(true);
    setProvider(prov);
    setResult(null);
    setError(null);
    setShowPrompt(false);
    try {
      const res = await fetch(`${API_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, name, provider: prov }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Request failed');
      setResult(data);
    } catch (e) {
      setError(
        e.message?.includes('Failed to fetch')
          ? 'Could not reach the AI backend. Start it with: uvicorn main:app --port 8000 (in /backend).'
          : e.message
      );
    } finally {
      setLoading(false);
    }
  };

  const a = result?.analysis;

  return (
    <div className="ai-section">
      <div className="ai-header">
        <span className="ai-title">AI Analysis</span>
        <div className="ai-btn-row">
          <button
            className={`ai-btn claude ${provider === 'claude' ? 'active' : ''}`}
            onClick={() => run('claude')}
            disabled={loading}
          >
            <ClaudeIcon /> Claude
          </button>
          <button
            className={`ai-btn chatgpt ${provider === 'openai' ? 'active' : ''}`}
            onClick={() => run('openai')}
            disabled={loading}
          >
            <ChatGPTIcon /> ChatGPT
          </button>
        </div>
      </div>

      {loading && (
        <div className="ai-loading">
          Researching {ticker} with {provider === 'claude' ? 'Claude' : 'ChatGPT'}…
        </div>
      )}

      {error && <div className="ai-error">{error}</div>}

      {a && (
        <div className="ai-result">
          {result.prompt && (
            <div className="ai-result-bar">
              <button
                type="button"
                className="ai-note-btn"
                onClick={() => setShowPrompt(true)}
                title="View the prompt this analysis used"
              >
                <NoteIcon /> View prompt
              </button>
            </div>
          )}

          {a.summary && <p className="ai-summary">{a.summary}</p>}

          {a.performance && (
            <>
              <div className="ai-subhead">Performance</div>
              <table className="ai-perf-table">
                <thead>
                  <tr>
                    <th>Period</th><th>Trend</th><th>Change</th><th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  <PerformanceRow label="Last Week" row={a.performance.week} />
                  <PerformanceRow label="Last Month" row={a.performance.month} />
                  <PerformanceRow label="Quarter" row={a.performance.quarter} />
                  <PerformanceRow label="Year" row={a.performance.year} />
                </tbody>
              </table>
            </>
          )}

          {Array.isArray(a.news) && a.news.length > 0 && (
            <>
              <div className="ai-subhead">Latest News</div>
              {a.news.map((n, i) => (
                <div className="ai-news" key={i}>
                  <div className="ai-news-headline">{n.headline}</div>
                  {n.impact && <div className="ai-news-impact">{n.impact}</div>}
                  <div className="ai-news-meta">
                    {n.url ? (
                      <a href={n.url} target="_blank" rel="noopener noreferrer">{n.source || 'Source'}</a>
                    ) : (
                      <span>{n.source || 'Source'}</span>
                    )}
                    {n.reputationScore != null && (
                      <span className="ai-rep" title={n.reputationNote || ''}>
                        Source reputation: <strong>{n.reputationScore}/100</strong>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {a.impactIfBought && (
            <>
              <div className="ai-subhead">Impact Factor If Bought</div>
              <div className="ai-impact">
                <div><span className="ai-impact-label">Short run</span> {a.impactIfBought.shortTerm}</div>
                <div><span className="ai-impact-label">Long run</span> {a.impactIfBought.longTerm}</div>
              </div>
            </>
          )}

          <div className="ai-disclaimer">
            ⚠️ {result.disclaimer}
            <div className="ai-model-tag">Generated by {result.model} · {result.provider}</div>
          </div>
        </div>
      )}

      {showPrompt && result?.prompt && (
        <div className="ai-modal-overlay" onClick={() => setShowPrompt(false)}>
          <div className="ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ai-modal-head">
              <span className="ai-modal-title">Prompt used</span>
              <button
                type="button"
                className="ai-modal-close"
                onClick={() => setShowPrompt(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="ai-modal-sub">
              Generated by {result.promptModel} · analyzed by {result.model}
            </div>
            <pre className="ai-modal-body">{result.prompt}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
