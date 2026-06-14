import { useEffect, useState, useMemo } from 'react';
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts';
import { useStockData } from '../hooks/useStockData';
import { useTheme } from '../context/ThemeContext';
import { TIME_RANGES } from '../config/stocks';

function formatPrice(price, currency) {
  if (price == null) return '--';
  const sym = currency === 'INR' ? '₹' : '$';
  return `${sym}${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatVolume(v) {
  if (v == null) return '--';
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toString();
}

function formatAxisDate(ts, range) {
  const d = new Date(ts);
  if (['1d', '5d', '7d'].includes(range))
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (['14d', '1mo', '3mo', '6mo'].includes(range))
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { year: 'numeric', month: 'short' });
}

function MarketStateBadge({ state }) {
  if (!state) return null;
  const config = {
    PRE:     { label: 'Pre-Market',  color: '#F59E0B' },
    PREPRE:  { label: 'Pre-Market',  color: '#F59E0B' },
    REGULAR: { label: 'Market Open', color: '#22C55E' },
    POST:    { label: 'After Hours', color: '#818CF8' },
    POSTPOST:{ label: 'After Hours', color: '#818CF8' },
    CLOSED:  { label: 'Market Closed', color: '#6B7280' },
  };
  const c = config[state] || { label: state, color: '#6B7280' };
  return (
    <span className="market-state-badge" style={{ '--badge-color': c.color }}>
      <span className="market-state-dot" />
      {c.label}
    </span>
  );
}

function StatItem({ label, value }) {
  return (
    <div className="stat-item">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function WeekRangeBar({ low, high, current, currency }) {
  if (low == null || high == null || current == null || high === low) return null;
  const pct = Math.min(100, Math.max(0, ((current - low) / (high - low)) * 100));
  const sym = currency === 'INR' ? '₹' : '$';
  const fmt = (v) => v >= 1000 ? `${sym}${(v / 1000).toFixed(1)}k` : `${sym}${v.toFixed(2)}`;
  return (
    <div className="week-range-wrap">
      <div className="week-range-labels">
        <span>52W Low {fmt(low)}</span>
        <span>52W High {fmt(high)}</span>
      </div>
      <div className="week-range-track">
        <div className="week-range-fill" style={{ width: `${pct}%` }} />
        <div className="week-range-thumb" style={{ left: `${pct}%` }} />
      </div>
    </div>
  );
}

function HypotheticalRow({ label, thenPrice, nowPrice, amount, currency }) {
  if (thenPrice == null || nowPrice == null || !amount) return null;
  const units = amount / thenPrice;
  const valueNow = units * nowPrice;
  const gain = valueNow - amount;
  const gainPct = ((gain / amount) * 100).toFixed(2);
  const isUp = gain >= 0;
  const sym = currency === 'INR' ? '₹' : '$';
  const fmtAmt = (v) => `${sym}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <tr className="hyp-row">
      <td className="hyp-cell hyp-label">{label}</td>
      <td className="hyp-cell">{fmtAmt(thenPrice)}</td>
      <td className="hyp-cell">{units.toFixed(4)}</td>
      <td className="hyp-cell">{fmtAmt(valueNow)}</td>
      <td className={`hyp-cell hyp-gain ${isUp ? 'up' : 'down'}`}>
        {isUp ? '+' : '-'}{fmtAmt(gain)} ({isUp ? '+' : ''}{gainPct}%)
      </td>
    </tr>
  );
}

const HYP_PERIODS = [
  { label: 'Yesterday', days: 1 },
  { label: 'Last Week', days: 7 },
  { label: 'Last Month', days: 30 },
  { label: '3 Months Back', days: 90 },
  { label: '6 Months Back', days: 180 },
];

function HypotheticalSection({ data6M, currency, currentPrice }) {
  const defaultAmount = currency === 'INR' ? 10000 : 1000;
  const [amount, setAmount] = useState(defaultAmount);

  const prices = useMemo(() => {
    if (!data6M?.points?.length) return {};
    const now = Date.now();

    const closest = (target) => {
      let best = null;
      let bestDiff = Infinity;
      for (const p of data6M.points) {
        const diff = Math.abs(p.time - target);
        if (diff < bestDiff) { bestDiff = diff; best = p; }
      }
      return best?.price;
    };

    return Object.fromEntries(
      HYP_PERIODS.map((p) => [p.label, closest(now - p.days * 86400000)])
    );
  }, [data6M]);

  const sym = currency === 'INR' ? '₹' : '$';

  return (
    <div className="hyp-section">
      <div className="hyp-header">
        <span className="hyp-title">Hypothetical Investment</span>
        <div className="hyp-amount-wrap">
          <span className="hyp-sym">{sym}</span>
          <input
            className="hyp-amount-input"
            type="number"
            value={amount}
            min={1}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </div>
      </div>
      <table className="hyp-table">
        <thead>
          <tr>
            <th className="hyp-th">Period</th>
            <th className="hyp-th">Price Then</th>
            <th className="hyp-th">Units Bought</th>
            <th className="hyp-th">Value Now</th>
            <th className="hyp-th">Gain / Loss</th>
          </tr>
        </thead>
        <tbody>
          {HYP_PERIODS.map((p) => (
            <HypotheticalRow
              key={p.label}
              label={p.label}
              thenPrice={prices[p.label]}
              nowPrice={currentPrice}
              amount={amount}
              currency={currency}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ChartModal({ stock, type, selectedRange, onRangeChange, onClose }) {
  const { theme } = useTheme();
  const timeRange = TIME_RANGES.find((t) => t.label === selectedRange) || TIME_RANGES[4];

  const { data, loading, error } = useStockData(
    stock.symbol, timeRange.range, timeRange.interval, type, stock.schemeCode
  );

  // Separate 6M fetch for hypothetical section (server cache makes this cheap)
  const { data: data6M } = useStockData(
    stock.symbol, '6mo', '1d', type, stock.schemeCode
  );

  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  const displayName = stock.display || stock.symbol || stock.name;
  const lastIdx = data?.points?.length - 1;
  const isUp = data?.points?.length >= 2
    ? data.points[lastIdx].price >= data.points[0].price
    : null;

  const upColor   = theme === 'dark' ? '#06C167' : '#1A7F37';
  const downColor = theme === 'dark' ? '#E53E3E' : '#C0001A';
  const flatColor = theme === 'dark' ? '#6B6B6B' : '#8A8A8A';
  const lineColor = isUp === null ? flatColor : isUp ? upColor : downColor;

  const pct = data?.points?.length >= 2
    ? (((data.points[lastIdx].price - data.points[0].price) / data.points[0].price) * 100).toFixed(2)
    : null;

  const gridColor     = theme === 'dark' ? '#1A1A1A' : '#F0F0F0';
  const axisTickColor = theme === 'dark' ? '#6B6B6B' : '#8A8A8A';
  const refLineColor  = theme === 'dark' ? '#3D3D3D' : '#ABABAB';

  const ChartTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = new Date(payload[0].payload.time);
    const p = payload[0].payload;
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-date">
          {d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          {['1d', '5d', '7d'].includes(timeRange.range) && (
            <span> · {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          )}
        </div>
        <div className="chart-tooltip-price">{formatPrice(payload[0].value, data?.currency)}</div>
        {p.volume != null && (
          <div className="chart-tooltip-vol">Vol: {formatVolume(p.volume)}</div>
        )}
      </div>
    );
  };

  const showStats = !loading && !error && data;
  const isMF = type === 'mf';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>

        <div className="modal-header">
          <div>
            <div className="modal-ticker">
              {displayName}
              {data?.marketState && <MarketStateBadge state={data.marketState} />}
            </div>
            <div className="modal-fullname">{stock.name}</div>
            {isMF && data?.fundHouse && (
              <div className="modal-subname">{data.fundHouse} · {data.schemeCategory}</div>
            )}
            {stock.subName && !isMF && <div className="modal-subname">{stock.subName}</div>}
          </div>
          <div>
            {showStats && (
              <>
                <div className="modal-price">{formatPrice(data.currentPrice, data.currency)}</div>
                {pct !== null && (
                  <div className={`modal-pct ${isUp ? 'up' : 'down'}`}>
                    {isUp ? '↑' : '↓'} {Math.abs(pct)}% · {timeRange.label}
                  </div>
                )}
              </>
            )}
            <button className="modal-close-btn" onClick={onClose}>CLOSE ✕</button>
          </div>
        </div>

        {/* Stats bar */}
        {showStats && (
          <div className="modal-stats-bar">
            {!isMF && (
              <>
                <StatItem label="OPEN"       value={formatPrice(data.open, data.currency)} />
                <StatItem label="DAY HIGH"   value={formatPrice(data.dayHigh, data.currency)} />
                <StatItem label="DAY LOW"    value={formatPrice(data.dayLow, data.currency)} />
                <StatItem label="VOLUME"     value={formatVolume(data.volume)} />
              </>
            )}
            <StatItem label="PREV CLOSE" value={formatPrice(data.previousClose, data.currency)} />
            {!isMF && (
              <div className="stat-item stat-52w">
                <div className="stat-label">52-WEEK RANGE</div>
                <WeekRangeBar
                  low={data.fiftyTwoWeekLow}
                  high={data.fiftyTwoWeekHigh}
                  current={data.currentPrice}
                  currency={data.currency}
                />
              </div>
            )}
          </div>
        )}

        <div className="modal-range-bar">
          {TIME_RANGES.map((tr) => {
            const disabled = type === 'mf' && ['1D', '5D', '1W'].includes(tr.label);
            return (
              <button
                key={tr.label}
                disabled={disabled}
                onClick={() => !disabled && onRangeChange(tr.label)}
                title={disabled ? 'Mutual fund NAV is daily — intraday unavailable' : ''}
                className={`range-btn ${selectedRange === tr.label ? 'active' : ''}`}
              >
                {tr.label}
              </button>
            );
          })}
        </div>

        <div className="modal-chart">
          {loading ? (
            <div className="loading-state">Loading chart data…</div>
          ) : error ? (
            <div className="error-state">Failed to load. Try another time range.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.points} margin={{ top: 8, right: 8, bottom: 20, left: 8 }}>
                <defs>
                  <linearGradient id="modal-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity={0.20} />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={gridColor} strokeDasharray="none" vertical={false} />
                <XAxis
                  dataKey="time"
                  tickFormatter={(ts) => formatAxisDate(ts, timeRange.range)}
                  tick={{ fill: axisTickColor, fontSize: 11, fontFamily: 'DM Sans, sans-serif' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tickFormatter={(v) => {
                    const sym = data?.currency === 'INR' ? '₹' : '$';
                    return v >= 1000 ? `${sym}${(v / 1000).toFixed(1)}k` : `${sym}${v.toFixed(0)}`;
                  }}
                  tick={{ fill: axisTickColor, fontSize: 11, fontFamily: 'DM Sans, sans-serif' }}
                  axisLine={false}
                  tickLine={false}
                  width={62}
                  orientation="right"
                />
                <Tooltip content={<ChartTooltip />} />
                {data?.previousClose && (
                  <ReferenceLine y={data.previousClose} stroke={refLineColor} strokeDasharray="3 3" strokeWidth={1} />
                )}
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke={lineColor}
                  strokeWidth={2}
                  fill="url(#modal-fill)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Hypothetical investment */}
        {showStats && (
          <HypotheticalSection
            data6M={data6M}
            currency={data.currency}
            currentPrice={data.currentPrice}
          />
        )}

        {isMF && (
          <div className="modal-mf-note">
            * NAV published once daily by AMFI. Intraday ranges (1D, 5D, 1W) are not available for mutual funds.
          </div>
        )}
      </div>
    </div>
  );
}
