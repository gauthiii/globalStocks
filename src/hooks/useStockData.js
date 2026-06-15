import { useState, useEffect, useRef } from 'react';

function parseYahooData(data, range) {
  const result = data?.chart?.result?.[0];
  if (!result) return null;

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const volumes = quote.volume || [];
  const meta = result.meta || {};

  const points = timestamps
    .map((ts, i) => ({
      time: ts * 1000,
      price: closes[i] ?? null,
      open: opens[i] ?? null,
      high: highs[i] ?? null,
      low: lows[i] ?? null,
      volume: volumes[i] ?? null,
    }))
    .filter((p) => p.price !== null);

  return {
    points,
    currency: meta.currency || 'USD',
    currentPrice: meta.regularMarketPrice,
    previousClose: meta.chartPreviousClose,
    symbol: meta.symbol,
    shortName: meta.shortName || meta.symbol,
    open: meta.regularMarketOpen,
    dayHigh: meta.regularMarketDayHigh,
    dayLow: meta.regularMarketDayLow,
    volume: meta.regularMarketVolume,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    marketState: meta.marketState,
    change: meta.regularMarketChange,
    changePercent: meta.regularMarketChangePercent,
  };
}

function parseMFData(data, range) {
  if (!data?.data) return null;

  const now = Date.now();
  const msPerDay = 86400000;
  const rangeMs = {
    '1d': msPerDay,
    '5d': 5 * msPerDay,
    '7d': 7 * msPerDay,
    '14d': 14 * msPerDay,
    '1mo': 30 * msPerDay,
    '3mo': 90 * msPerDay,
    '6mo': 180 * msPerDay,
    '1y': 365 * msPerDay,
    '5y': 5 * 365 * msPerDay,
    '10y': 10 * 365 * msPerDay,
    '15y': 15 * 365 * msPerDay,
    '20y': 20 * 365 * msPerDay,
    max: Infinity,
  };
  const cutoff = rangeMs[range] ? now - rangeMs[range] : 0;

  const allPoints = data.data
    .map((d) => {
      const [day, month, year] = d.date.split('-').map(Number);
      return { time: new Date(year, month - 1, day).getTime(), price: parseFloat(d.nav) };
    })
    .reverse(); // oldest → newest

  const points = allPoints.filter((p) => p.time >= cutoff);

  const current = points[points.length - 1]?.price;
  const prev = points[0]?.price;

  return {
    points,
    allPoints,
    currency: 'INR',
    currentPrice: current,
    previousClose: prev,
    symbol: data.meta?.scheme_name || '',
    fundHouse: data.meta?.fund_house,
    schemeCategory: data.meta?.scheme_category,
    schemeType: data.meta?.scheme_type,
  };
}

const CORS_PROXY = 'https://corsproxy.io/?url=';

// The dashboard mounts dozens of charts at once (consolidated rows + P/L cards),
// and the public CORS proxy rate-limits bursts. We funnel every request through a
// small concurrency gate, dedupe in-flight URLs, and cache raw responses briefly
// so identical requests (e.g. a row and the modal) reuse one network call.
const RAW_CACHE = new Map(); // url -> { time, data }
const INFLIGHT = new Map(); // url -> Promise
const CACHE_TTL = 60_000;

const MAX_CONCURRENT = 5;
let active = 0;
const waiters = [];

function acquireSlot() {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve)).then(() => {
    active++;
  });
}

function releaseSlot() {
  active--;
  const next = waiters.shift();
  if (next) next();
}

function loadRaw(url) {
  const cached = RAW_CACHE.get(url);
  if (cached && Date.now() - cached.time < CACHE_TTL) return Promise.resolve(cached.data);
  if (INFLIGHT.has(url)) return INFLIGHT.get(url);

  const promise = acquireSlot()
    .then(() => fetch(url).then((r) => r.json()))
    .then((data) => {
      RAW_CACHE.set(url, { time: Date.now(), data });
      return data;
    })
    .finally(() => {
      releaseSlot();
      INFLIGHT.delete(url);
    });

  INFLIGHT.set(url, promise);
  return promise;
}

export function useStockData(symbol, range, interval, type, schemeCode) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!symbol && !schemeCode) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    const url =
      type === 'mf'
        ? `https://api.mfapi.in/mf/${schemeCode}`
        : `${CORS_PROXY}${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`)}`;

    loadRaw(url)
      .then((raw) => {
        if (controller.signal.aborted) return;
        const parsed = type === 'mf' ? parseMFData(raw, range) : parseYahooData(raw, range);
        if (!parsed) throw new Error('No data');
        setData(parsed);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err.message);
        setLoading(false);
      });

    return () => controller.abort();
  }, [symbol, range, interval, type, schemeCode]);

  return { data, loading, error };
}
