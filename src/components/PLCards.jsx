import { useState, useCallback, useMemo, useEffect } from 'react';
import { useStockData } from '../hooks/useStockData';

const DAY = 86400000;

// Period changes (latest price minus price at the start of each window),
// derived from a daily series sorted oldest → newest.
function computeDeltas(points) {
  if (!points || points.length < 2) return null;
  const n = points.length;
  const last = points[n - 1].price;
  const lastTime = points[n - 1].time;
  const atOrBefore = (t) => {
    let chosen = points[0].price;
    for (const p of points) {
      if (p.time <= t) chosen = p.price;
      else break;
    }
    return chosen;
  };
  return {
    d1: last - points[n - 2].price,
    d5: last - points[Math.max(0, n - 6)].price,
    w1: last - atOrBefore(lastTime - 7 * DAY),
    m1: last - points[0].price,
  };
}

// Invisible per-instrument fetcher: reports its period deltas up to the parent.
function PLFetcher({ stock, onResult }) {
  const { data } = useStockData(stock.symbol, '1mo', '1d', stock.type, stock.schemeCode);
  const key = stock.symbol || stock.schemeCode;
  useEffect(() => {
    if (!data?.points) return;
    const deltas = computeDeltas(data.points);
    if (deltas) onResult(key, { currency: data.currency || 'USD', deltas });
  }, [data, key, onResult]);
  return null;
}

export function formatMoney(v, currency) {
  const sym = currency === 'INR' ? '₹' : '$';
  return `${sym}${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const PERIODS = [
  { key: 'd1', label: 'Daily P/L' },
  { key: 'd5', label: '5-Day P/L' },
  { key: 'w1', label: '1-Week P/L' },
  { key: 'm1', label: '1-Month P/L' },
];

// Equal-weighted (1 unit per instrument) P/L across a watchlist, summed per
// currency so the consolidated view can show both $ and ₹ side by side.
export default function PLCards({ items, onTotals }) {
  const [results, setResults] = useState({});

  // Reset accumulated results whenever the instrument set changes (tab switch).
  const keysSig = items.map((s) => s.symbol || s.schemeCode).join(',');
  useEffect(() => { setResults({}); }, [keysSig]);

  const onResult = useCallback((key, val) => {
    setResults((prev) => {
      const existing = prev[key];
      if (existing && existing.deltas.m1 === val.deltas.m1 && existing.deltas.d1 === val.deltas.d1) {
        return prev;
      }
      return { ...prev, [key]: val };
    });
  }, []);

  const totals = useMemo(() => {
    const byCur = {};
    for (const k in results) {
      const { currency, deltas } = results[k];
      if (!byCur[currency]) byCur[currency] = { d1: 0, d5: 0, w1: 0, m1: 0 };
      byCur[currency].d1 += deltas.d1;
      byCur[currency].d5 += deltas.d5;
      byCur[currency].w1 += deltas.w1;
      byCur[currency].m1 += deltas.m1;
    }
    return byCur;
  }, [results]);

  const currencies = Object.keys(totals).sort();
  const loaded = Object.keys(results).length;
  const total = items.length;

  // Surface totals + load progress to the parent (for the Telegram alert).
  useEffect(() => {
    onTotals?.({ totals, currencies, loaded, total });
  }, [onTotals, totals, currencies, loaded, total]);

  return (
    <div className="pl-wrap">
      <div className="pl-cards">
        {PERIODS.map((p) => (
          <div key={p.key} className="pl-card">
            <div className="pl-card-label">{p.label}</div>
            {currencies.length === 0 ? (
              <div className="pl-card-val muted">…</div>
            ) : (
              currencies.map((cur) => {
                const v = totals[cur][p.key];
                const up = v >= 0;
                return (
                  <div key={cur} className={`pl-card-val ${up ? 'up' : 'down'}`}>
                    {up ? '+' : '−'}{formatMoney(Math.abs(v), cur)}
                  </div>
                );
              })
            )}
          </div>
        ))}
      </div>
      <div className="pl-note">
        Equal-weighted (1 unit of each)&nbsp;·&nbsp;{loaded}/{total} loaded
      </div>
      {items.map((s) => (
        <PLFetcher key={s.symbol || s.schemeCode} stock={s} onResult={onResult} />
      ))}
    </div>
  );
}
