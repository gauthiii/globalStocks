export const US_STOCKS = [
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'CVX', name: 'Chevron Corp.' },
  { symbol: 'CVS', name: 'CVS Health Corp.' },
  { symbol: 'XOM', name: 'Exxon Mobil Corp.' },
  { symbol: 'MSFT', name: 'Microsoft Corp.' },
  { symbol: 'NFLX', name: 'Netflix Inc.' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.' },
  { symbol: 'SPCX', name: 'SPDR S&P 500 ETF' },
  { symbol: 'KO', name: 'Coca-Cola Co.' },
  { symbol: 'UBER', name: 'Uber Technologies' },
  { symbol: 'WMT', name: 'Walmart Inc.' },
];

export const US_FUNDS = [
  { symbol: 'SFLNX', name: 'Schwab Fundamental US Large Co.' },
  { symbol: 'SWPPX', name: 'Schwab S&P 500 Index' },
];

export const INDIA_STOCKS = [
  { symbol: 'DRREDDY.NS', name: "Dr. Reddy's Laboratories", display: 'DRREDDY' },
  { symbol: 'GOLDBEES.NS', name: 'Nippon India Gold ETF', display: 'GOLDBEES' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Ltd.', display: 'HDFCBANK' },
  { symbol: 'ITBEES.NS', name: 'Nippon India ETF Nifty IT', display: 'ITBEES' },
  { symbol: 'ITC.NS', name: 'ITC Ltd.', display: 'ITC' },
  { symbol: 'PHARMABEES.NS', name: 'Nippon India Pharma ETF', display: 'PHARMABEES' },
  { symbol: 'SILVERBEES.NS', name: 'Nippon India Silver ETF', display: 'SILVERBEES' },
  { symbol: 'WIPRO.NS', name: 'Wipro Ltd.', display: 'WIPRO' },
  { symbol: 'ZYDUSLIFE.NS', name: 'Zydus Lifesciences Ltd.', display: 'ZYDUSLIFE' },
];

// AMFI scheme codes for Indian mutual funds (via mfapi.in)
export const INDIA_FUNDS = [
  { schemeCode: '120586', name: 'ICICI Prudential Large Cap Fund', subName: 'Direct Plan · Growth · Large Cap', type: 'mf' },
  { schemeCode: '120716', name: 'UTI Nifty 50 Index Fund', subName: 'Direct Plan · Growth · Index Funds/ETFs', type: 'mf' },
  { schemeCode: '122639', name: 'Parag Parikh Flexi Cap Fund', subName: 'Direct Plan · Growth · Flexi Cap', type: 'mf' },
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
];
