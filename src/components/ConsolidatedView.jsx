import { useMemo } from 'react';
import { useStockData } from '../hooks/useStockData';
import { US_ALL, INDIA_ALL, categoriesOf } from '../config/stocks';

function formatPrice(price, currency) {
  if (price == null) return '--';
  const sym = currency === 'INR' ? '₹' : '$';
  return `${sym}${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ConsolidatedRow({ stock, timeRange, onClick }) {
  const { data, loading, error } = useStockData(
    stock.symbol, timeRange.range, timeRange.interval, stock.type, stock.schemeCode
  );

  const displayName = stock.display || stock.symbol || stock.name;
  const lastIdx = data?.points?.length - 1;
  const isUp = data?.points?.length >= 2
    ? data.points[lastIdx].price >= data.points[0].price
    : null;
  const pct = data?.points?.length >= 2
    ? (((data.points[lastIdx].price - data.points[0].price) / data.points[0].price) * 100).toFixed(2)
    : null;

  return (
    <div className="cons-row" onClick={onClick}>
      <div className="cons-row-main">
        <span className="cons-ticker">{displayName}</span>
        <span className="cons-name">{stock.name}</span>
      </div>
      <div className="cons-row-figs">
        {loading ? (
          <span className="cons-muted">…</span>
        ) : error ? (
          <span className="cons-down">N/A</span>
        ) : (
          <>
            <span className="cons-price">{formatPrice(data?.currentPrice, data?.currency)}</span>
            {pct !== null && (
              <span className={`cons-pct ${isUp ? 'up' : 'down'}`}>
                {isUp ? '↑' : '↓'} {Math.abs(pct)}%
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MarketColumn({ title, items, timeRange, onSelect }) {
  const categories = useMemo(() => categoriesOf(items), [items]);

  return (
    <div className="cons-col">
      <div className="cons-col-title">{title}</div>
      {categories.map((cat) => {
        const rows = items.filter((it) => it.category === cat);
        return (
          <div key={cat} className="cons-cat">
            <div className="cons-cat-head">
              <span>{cat}</span>
              <span className="cons-cat-count">{rows.length}</span>
            </div>
            {rows.map((stock) => (
              <ConsolidatedRow
                key={stock.symbol || stock.schemeCode}
                stock={stock}
                timeRange={timeRange}
                onClick={() => onSelect({ stock, type: stock.type })}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function ConsolidatedView({ timeRange, onSelect }) {
  return (
    <div className="cons-grid">
      <MarketColumn title="🇺🇸 United States" items={US_ALL} timeRange={timeRange} onSelect={onSelect} />
      <MarketColumn title="🇮🇳 India" items={INDIA_ALL} timeRange={timeRange} onSelect={onSelect} />
    </div>
  );
}
