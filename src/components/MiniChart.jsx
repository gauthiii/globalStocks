import { ResponsiveContainer, AreaChart, Area, Tooltip, YAxis } from 'recharts';
import { useStockData } from '../hooks/useStockData';
import { useTheme } from '../context/ThemeContext';

function formatPrice(price, currency) {
  if (price == null) return '--';
  const sym = currency === 'INR' ? '₹' : '$';
  return `${sym}${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function MiniChart({ stock, timeRange, onClick, type }) {
  const { theme } = useTheme();
  const { data, loading, error } = useStockData(
    stock.symbol, timeRange.range, timeRange.interval, type, stock.schemeCode
  );

  const displayName = stock.display || stock.symbol || stock.name;
  const lastIdx = data?.points?.length - 1;
  const isUp = data?.points?.length >= 2
    ? data.points[lastIdx].price >= data.points[0].price
    : null;

  const upColor   = theme === 'dark' ? '#06C167' : '#1A7F37';
  const downColor = theme === 'dark' ? '#E53E3E' : '#C0001A';
  const flatColor = theme === 'dark' ? '#6B6B6B' : '#8A8A8A';
  const lineColor = isUp === null ? flatColor : isUp ? upColor : downColor;
  const fillId    = `fill-${displayName.replace(/[^a-z0-9]/gi, '')}`;

  const pct = data?.points?.length >= 2
    ? (((data.points[lastIdx].price - data.points[0].price) / data.points[0].price) * 100).toFixed(2)
    : null;

  const ChartTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-date">
          {new Date(payload[0].payload.time).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
        <div className="chart-tooltip-price">{formatPrice(payload[0].value, data?.currency)}</div>
      </div>
    );
  };

  return (
    <div className="card" onClick={onClick}>
      <div className="card-header">
        <div>
          <div className="card-ticker">{displayName}</div>
          <div className="card-name">{stock.name}</div>
          {stock.category && <span className="cat-badge">{stock.category}</span>}
        </div>
        <div>
          {loading ? (
            <div className="card-loading-label">Loading…</div>
          ) : error ? (
            <div style={{ fontSize: 11, color: 'var(--down)' }}>Unavailable</div>
          ) : (
            <>
              <div className="card-price">{formatPrice(data?.currentPrice, data?.currency)}</div>
              {pct !== null && (
                <div className={`card-pct ${isUp ? 'up' : 'down'}`}>
                  {isUp ? '↑' : '↓'} {Math.abs(pct)}%
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="card-chart">
        {loading ? (
          <div className="skeleton" style={{ height: '100%' }} />
        ) : error ? (
          <div className="card-error-label">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data?.points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis domain={['auto', 'auto']} hide />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="price"
                stroke={lineColor}
                strokeWidth={1.5}
                fill={`url(#${fillId})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
