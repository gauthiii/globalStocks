export const US_STOCKS = [
  { symbol: 'GOOGL', name: 'Alphabet Inc.', category: 'Technology' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', category: 'Consumer Discretionary' },
  { symbol: 'CVX', name: 'Chevron Corp.', category: 'Energy' },
  { symbol: 'CVS', name: 'CVS Health Corp.', category: 'Healthcare' },
  { symbol: 'XOM', name: 'Exxon Mobil Corp.', category: 'Energy' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', category: 'Technology' },
  { symbol: 'NFLX', name: 'Netflix Inc.', category: 'Communication' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', category: 'Technology' },
  { symbol: 'SPCX', name: 'SPDR S&P 500 ETF', category: 'Index / ETF' },
  { symbol: 'KO', name: 'Coca-Cola Co.', category: 'Consumer Staples' },
  { symbol: 'UBER', name: 'Uber Technologies', category: 'Technology' },
  { symbol: 'WMT', name: 'Walmart Inc.', category: 'Consumer Staples' },
];

export const US_FUNDS = [
  { symbol: 'SFLNX', name: 'Schwab Fundamental US Large Co.', category: 'Index / ETF' },
  { symbol: 'SWPPX', name: 'Schwab S&P 500 Index', category: 'Index / ETF' },
];

export const INDIA_STOCKS = [
  { symbol: 'DRREDDY.NS', name: "Dr. Reddy's Laboratories", display: 'DRREDDY', category: 'Pharma' },
  { symbol: 'GOLDBEES.NS', name: 'Nippon India Gold ETF', display: 'GOLDBEES', category: 'Commodity' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Ltd.', display: 'HDFCBANK', category: 'Banking' },
  { symbol: 'ITBEES.NS', name: 'Nippon India ETF Nifty IT', display: 'ITBEES', category: 'Index / ETF' },
  { symbol: 'ITC.NS', name: 'ITC Ltd.', display: 'ITC', category: 'Consumer Staples' },
  { symbol: 'PHARMABEES.NS', name: 'Nippon India Pharma ETF', display: 'PHARMABEES', category: 'Pharma' },
  { symbol: 'SILVERBEES.NS', name: 'Nippon India Silver ETF', display: 'SILVERBEES', category: 'Commodity' },
  { symbol: 'WIPRO.NS', name: 'Wipro Ltd.', display: 'WIPRO', category: 'Technology' },
  { symbol: 'ZYDUSLIFE.NS', name: 'Zydus Lifesciences Ltd.', display: 'ZYDUSLIFE', category: 'Pharma' },
];

// AMFI scheme codes for Indian mutual funds (via mfapi.in)
export const INDIA_FUNDS = [
  { schemeCode: '120586', name: 'ICICI Prudential Large Cap Fund', subName: 'Direct Plan · Growth · Large Cap', type: 'mf', category: 'Mutual Fund' },
  { schemeCode: '120716', name: 'UTI Nifty 50 Index Fund', subName: 'Direct Plan · Growth · Index Funds/ETFs', type: 'mf', category: 'Mutual Fund' },
  { schemeCode: '122639', name: 'Parag Parikh Flexi Cap Fund', subName: 'Direct Plan · Growth · Flexi Cap', type: 'mf', category: 'Mutual Fund' },
];

export const TIME_RANGES = [
  { label: '1D', range: '1d', interval: '5m' },
  { label: '5D', range: '5d', interval: '15m' },
  { label: '1W', range: '7d', interval: '1h' },
  { label: '2W', range: '14d', interval: '1d' },
  { label: '1M', range: '1mo', interval: '1d' },
  { label: '3M', range: '3mo', interval: '1d' },
  { label: '6M', range: '6mo', interval: '1d' },
  { label: '1Y', range: '1y', interval: '1wk' },
  { label: '5Y', range: '5y', interval: '1mo' },
  { label: '10Y', range: '10y', interval: '1mo' },
  { label: '15Y', range: '15y', interval: '3mo' },
  { label: '20Y', range: '20y', interval: '3mo' },
  { label: 'All', range: 'max', interval: '3mo' },
];

export const TABS = [
  { id: 'us-stocks', label: '🇺🇸 US Stocks', data: US_STOCKS, type: 'yahoo' },
  { id: 'us-funds', label: '🇺🇸 US Funds', data: US_FUNDS, type: 'yahoo' },
  { id: 'india-stocks', label: '🇮🇳 India Stocks', data: INDIA_STOCKS, type: 'yahoo' },
  { id: 'india-funds', label: '🇮🇳 India Funds', data: INDIA_FUNDS, type: 'mf' },
  { id: 'consolidated', label: '📊 Consolidated', consolidated: true },
];

// Every instrument tagged with its market + fetch type, for the consolidated view.
export const US_ALL = [
  ...US_STOCKS.map((s) => ({ ...s, type: 'yahoo', group: 'Stocks' })),
  ...US_FUNDS.map((s) => ({ ...s, type: 'yahoo', group: 'Funds' })),
];

export const INDIA_ALL = [
  ...INDIA_STOCKS.map((s) => ({ ...s, type: 'yahoo', group: 'Stocks' })),
  ...INDIA_FUNDS.map((s) => ({ ...s, type: 'mf', group: 'Funds' })),
];

// Distinct category list for filter chips, preserving first-seen order.
export function categoriesOf(items) {
  const seen = [];
  for (const it of items) {
    if (it.category && !seen.includes(it.category)) seen.push(it.category);
  }
  return seen;
}
