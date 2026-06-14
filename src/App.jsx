import { useState, useEffect, useMemo } from 'react';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import MiniChart from './components/MiniChart';
import ChartModal from './components/ChartModal';
import ConsolidatedView from './components/ConsolidatedView';
import { TABS, TIME_RANGES, categoriesOf } from './config/stocks';

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4"/>
      <line x1="12" y1="2" x2="12" y2="4"/>
      <line x1="12" y1="20" x2="12" y2="22"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="2" y1="12" x2="4" y2="12"/>
      <line x1="20" y1="12" x2="22" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

function Dashboard() {
  const { theme, toggle } = useTheme();
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('gs-tab') || 'us-stocks');
  const [selectedRange, setSelectedRange] = useState(() => localStorage.getItem('gs-range') || '1M');
  const [modal, setModal] = useState(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [sortBy, setSortBy] = useState('default');

  useEffect(() => { localStorage.setItem('gs-tab', activeTab); }, [activeTab]);
  useEffect(() => { localStorage.setItem('gs-range', selectedRange); }, [selectedRange]);

  // Switch tab and reset its filters.
  const changeTab = (id) => {
    setActiveTab(id);
    setQuery('');
    setCategory('All');
    setSortBy('default');
  };

  const tab = TABS.find((t) => t.id === activeTab) || TABS[0];
  const timeRange = TIME_RANGES.find((t) => t.label === selectedRange) || TIME_RANGES[4];
  const isConsolidated = !!tab.consolidated;

  const categories = useMemo(
    () => (isConsolidated ? [] : ['All', ...categoriesOf(tab.data)]),
    [tab, isConsolidated]
  );

  const visible = useMemo(() => {
    if (isConsolidated) return [];
    let list = tab.data.filter((s) => {
      const hay = `${s.display || ''} ${s.symbol || ''} ${s.name || ''}`.toLowerCase();
      const matchQ = hay.includes(query.trim().toLowerCase());
      const matchC = category === 'All' || s.category === category;
      return matchQ && matchC;
    });
    if (sortBy === 'name') {
      list = [...list].sort((a, b) =>
        (a.display || a.symbol || a.name).localeCompare(b.display || b.symbol || b.name)
      );
    }
    return list;
  }, [tab, isConsolidated, query, category, sortBy]);

  // Group the visible items by category (improvement: categorized sections).
  const groups = useMemo(() => {
    if (isConsolidated) return [];
    const order = categoriesOf(visible);
    return order.map((cat) => ({ cat, items: visible.filter((s) => s.category === cat) }));
  }, [visible, isConsolidated]);

  return (
    <div className="app">
      {/* Top bar */}
      <header className="topbar">
        <div>
          <div className="topbar-brand">GlobalStocks</div>
          <div className="topbar-sub">Portfolio Dashboard</div>
        </div>
        <button className="theme-toggle" onClick={toggle}>
          {theme === 'light' ? <MoonIcon /> : <SunIcon />}
          {theme === 'light' ? 'DARK' : 'LIGHT'}
        </button>
      </header>

      {/* Tabs */}
      <nav className="tabs-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => changeTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="content">
        {/* Time range row */}
        <div className="range-bar">
          {TIME_RANGES.map((tr) => {
            const disabled = tab.type === 'mf' && ['1D', '5D', '1W'].includes(tr.label);
            return (
              <button
                key={tr.label}
                disabled={disabled}
                onClick={() => !disabled && setSelectedRange(tr.label)}
                title={disabled ? 'NAV is daily — intraday unavailable' : ''}
                className={`range-btn ${selectedRange === tr.label ? 'active' : ''}`}
              >
                {tr.label}
              </button>
            );
          })}
        </div>

        {isConsolidated ? (
          <ConsolidatedView
            timeRange={timeRange}
            onSelect={(m) => setModal(m)}
          />
        ) : (
          <>
            {/* Toolbar: search + category chips + sort */}
            <div className="toolbar">
              <input
                className="search-input"
                type="text"
                placeholder="Search ticker or name…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="chip-row">
                {categories.map((c) => (
                  <button
                    key={c}
                    className={`chip ${category === c ? 'active' : ''}`}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <select
                className="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="default">Sort: Default</option>
                <option value="name">Sort: Name A–Z</option>
              </select>
            </div>

            {visible.length === 0 ? (
              <div className="empty-state">No instruments match your filters.</div>
            ) : (
              groups.map((g) => (
                <section key={g.cat} className="cat-section">
                  <div className="cat-section-head">
                    <span>{g.cat}</span>
                    <span className="cat-section-count">{g.items.length}</span>
                  </div>
                  <div className="stock-grid">
                    {g.items.map((stock) => (
                      <MiniChart
                        key={stock.symbol || stock.schemeCode}
                        stock={stock}
                        timeRange={timeRange}
                        type={tab.type}
                        onClick={() => setModal({ stock, type: tab.type })}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </>
        )}
      </main>

      {/* Modal */}
      {modal && (
        <ChartModal
          stock={modal.stock}
          type={modal.type}
          selectedRange={selectedRange}
          onRangeChange={setSelectedRange}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Dashboard />
    </ThemeProvider>
  );
}
