"""
Watchlist high/low scanner for cron.

Fetches the latest values for every US and India instrument in the watchlist and
checks, for each, whether the latest price is a *period extreme* (the highest or
lowest value seen) within a set of trailing windows: today, 1 week, 2 weeks,
3 weeks and 1 month. When it is, an alert is pushed to Telegram naming the
ticker, the company/fund name, by how much it cleared the prior extreme, and the
window it happened in.

Design decisions (confirmed with the user):
  • "high/low in <window>"  → latest price equals the max/min over that window.
  • "today"                 → uses intraday (1d / 5m) data for Yahoo tickers;
                              mutual funds (daily NAV only) skip the today check.
  • multiple windows        → one alert per ticker, for the LONGEST window it is
                              an extreme of (windows are nested, so a 1-month
                              high is also a week high — we report the strongest).
  • "by how much"           → distance from the prior extreme of that window
                              (i.e. excluding the current point), absolute + %.

This module is import-safe (no side effects) so the FastAPI app can call
`scan_watchlist()` from the /cron endpoint, and it can also be run standalone.
"""

import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DAY_MS = 86_400_000

# Telegram caps a single message at 4096 chars; stay safely under it. When a scan
# produces more alerts than fit, split into multiple messages and pause between
# sends to avoid hitting the Bot API rate limit.
TELEGRAM_MAX_CHARS = 3800
SEND_GAP_SECONDS = 7

# ── Watchlist (mirror of ../src/config/stocks.js) ────────────────────────────
# Each entry: symbol/scheme, human name, market, and fetch kind.
US_INSTRUMENTS = [
    ("GOOGL", "Alphabet Inc."),
    ("AMZN", "Amazon.com Inc."),
    ("CVX", "Chevron Corp."),
    ("CVS", "CVS Health Corp."),
    ("XOM", "Exxon Mobil Corp."),
    ("MSFT", "Microsoft Corp."),
    ("NFLX", "Netflix Inc."),
    ("NVDA", "NVIDIA Corp."),
    ("SPCX", "SpaceX"),
    ("KO", "Coca-Cola Co."),
    ("UBER", "Uber Technologies"),
    ("WMT", "Walmart Inc."),
    ("SNDK", "SanDisk Corp."),
    ("MU", "Micron Technology"),
    ("AMD", "Advanced Micro Devices"),
    ("MRVL", "Marvell Technology"),
    ("ASML", "ASML Holding N.V."),
    ("TSM", "Taiwan Semiconductor (TSMC)"),
    ("TSLA", "Tesla Inc."),
    # US funds
    ("SFLNX", "Schwab Fundamental US Large Co."),
    ("SWPPX", "Schwab S&P 500 Index"),
]

INDIA_INSTRUMENTS = [
    ("DRREDDY.NS", "Dr. Reddy's Laboratories"),
    ("GOLDBEES.NS", "Nippon India Gold ETF"),
    ("HDFCBANK.NS", "HDFC Bank Ltd."),
    ("ITBEES.NS", "Nippon India ETF Nifty IT"),
    ("ITC.NS", "ITC Ltd."),
    ("PHARMABEES.NS", "Nippon India Pharma ETF"),
    ("SILVERBEES.NS", "Nippon India Silver ETF"),
    ("WIPRO.NS", "Wipro Ltd."),
    ("ZYDUSLIFE.NS", "Zydus Lifesciences Ltd."),
]

# AMFI scheme codes for Indian mutual funds (via mfapi.in) — daily NAV only.
INDIA_FUNDS = [
    ("120586", "ICICI Prudential Large Cap Fund"),
    ("120716", "UTI Nifty 50 Index Fund"),
    ("122639", "Parag Parikh Flexi Cap Fund"),
]

# Trailing windows, longest first. "today" is handled specially (intraday).
# (key, label, days)  — days is None for the intraday "today" window.
WINDOWS = [
    ("m1", "1 month", 30),
    ("w3", "3 weeks", 21),
    ("w2", "2 weeks", 14),
    ("w1", "1 week", 7),
    ("today", "today", None),
]


# ── Fetching ─────────────────────────────────────────────────────────────────

def _fetch_yahoo_daily(client, symbol):
    """Daily closes over the last ~3 months: list of (time_ms, close)."""
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        "?range=3mo&interval=1d&includePrePost=false"
    )
    r = client.get(url, headers={"User-Agent": "Mozilla/5.0"})
    res = r.json()["chart"]["result"][0]
    ts = res.get("timestamp") or []
    closes = res["indicators"]["quote"][0].get("close") or []
    currency = res.get("meta", {}).get("currency", "USD")
    points = [(t * 1000, c) for t, c in zip(ts, closes) if c is not None]
    return currency, points


def _fetch_yahoo_intraday(client, symbol):
    """Today's intraday prices (5m bars): list of (time_ms, price)."""
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        "?range=1d&interval=5m&includePrePost=false"
    )
    r = client.get(url, headers={"User-Agent": "Mozilla/5.0"})
    res = r.json()["chart"]["result"][0]
    ts = res.get("timestamp") or []
    closes = res["indicators"]["quote"][0].get("close") or []
    points = [(t * 1000, c) for t, c in zip(ts, closes) if c is not None]
    return points


def _fetch_mf_daily(client, scheme):
    """Daily NAV over the last ~3 months: list of (time_ms, nav)."""
    from datetime import datetime, timezone

    r = client.get(f"https://api.mfapi.in/mf/{scheme}")
    rows = r.json().get("data", [])
    points = []
    for d in reversed(rows):  # API is newest -> oldest
        day, month, year = (int(x) for x in d["date"].split("-"))
        t = int(datetime(year, month, day, tzinfo=timezone.utc).timestamp() * 1000)
        points.append((t, float(d["nav"])))
    if points:
        cutoff = points[-1][0] - 93 * DAY_MS
        points = [p for p in points if p[0] >= cutoff]
    return "INR", points


# ── Extreme detection ────────────────────────────────────────────────────────

def _window_extreme(points, days, now_ms):
    """For the trailing `days` window ending at the latest point, decide whether
    the latest price is a high and/or a low, and by how much it cleared the prior
    extreme (the extreme of every *other* point in the window).

    Returns a dict, or None if there isn't enough data.
    """
    if len(points) < 2:
        return None
    cutoff = now_ms - days * DAY_MS
    window = [p for p in points if p[0] >= cutoff]
    if len(window) < 2:
        return None

    latest = window[-1][1]
    prior = [p for _, p in window[:-1]]  # exclude the current point
    prior_max = max(prior)
    prior_min = min(prior)

    out = {"latest": latest}
    if latest >= prior_max:
        out["high"] = {
            "prior": prior_max,
            "amount": latest - prior_max,
            "pct": ((latest - prior_max) / prior_max * 100) if prior_max else 0.0,
        }
    if latest <= prior_min:
        out["low"] = {
            "prior": prior_min,
            "amount": prior_min - latest,
            "pct": ((prior_min - latest) / prior_min * 100) if prior_min else 0.0,
        }
    return out


def _longest_extreme(daily, intraday, now_ms):
    """Walk windows longest -> shortest and return the strongest high and/or low
    the latest price represents. `intraday` may be None (mutual funds)."""
    high = None
    low = None
    for key, label, days in WINDOWS:
        if key == "today":
            if not intraday:
                continue
            ex = _window_extreme(intraday, 1, now_ms)
        else:
            ex = _window_extreme(daily, days, now_ms)
        if not ex:
            continue
        if high is None and "high" in ex:
            high = {"window": label, "latest": ex["latest"], **ex["high"]}
        if low is None and "low" in ex:
            low = {"window": label, "latest": ex["latest"], **ex["low"]}
    return high, low


# ── Formatting ───────────────────────────────────────────────────────────────

def _chunk_blocks(blocks, limit=TELEGRAM_MAX_CHARS):
    """Pack text blocks into messages no longer than `limit` chars, splitting on
    block boundaries (so an individual alert is never cut in half). A single
    oversized block is emitted on its own as a last resort."""
    messages = []
    current = ""
    for block in blocks:
        candidate = f"{current}\n\n{block}" if current else block
        if len(candidate) <= limit:
            current = candidate
        else:
            if current:
                messages.append(current)
            current = block
    if current:
        messages.append(current)
    return messages


def _money(v, currency):
    sym = "₹" if currency == "INR" else "$"
    return f"{sym}{v:,.2f}"


def _format_alert(symbol, name, currency, kind, info):
    """kind: 'high' | 'low'. Returns an HTML Telegram message."""
    emoji = "🚀📈" if kind == "high" else "🔻📉"
    word = "HIGH" if kind == "high" else "LOW"
    direction = "above" if kind == "high" else "below"
    sign = "+" if kind == "high" else "−"
    return (
        f"{emoji} <b>{symbol}</b> — new {info['window']} {word}\n"
        f"<i>{name}</i>\n"
        f"Current: <b>{_money(info['latest'], currency)}</b>\n"
        f"{sign}{_money(info['amount'], currency)} ({sign}{info['pct']:.2f}%) "
        f"{direction} the prior {info['window']} {word.lower()} "
        f"({_money(info['prior'], currency)})"
    )


# ── Scan ─────────────────────────────────────────────────────────────────────

def scan_watchlist(market="all", dry_run=False, send=None):
    """Fetch the watchlist, detect period extremes, and (optionally) alert.

    market: "india" | "us" | "all".
    dry_run: if True, build alerts but don't send.
    send: callable(text) used to deliver an alert (defaults to Telegram sender).

    Returns a summary dict describing what was checked and what fired.
    """
    market = market.lower()
    do_us = market in ("all", "us")
    do_india = market in ("all", "india")

    if send is None and not dry_run:
        from main import send_telegram as send  # lazy import to avoid a cycle

    alerts = []
    checked = 0
    errors = []

    def handle(symbol, name, currency, daily, intraday, now_ms):
        nonlocal checked
        checked += 1
        high, low = _longest_extreme(daily, intraday, now_ms)
        for kind, info in (("high", high), ("low", low)):
            if not info:
                continue
            text = _format_alert(symbol, name, currency, kind, info)
            alerts.append({
                "symbol": symbol, "name": name, "kind": kind,
                "window": info["window"], "latest": info["latest"],
                "amount": info["amount"], "pct": round(info["pct"], 2),
                "currency": currency, "text": text,
            })

    with httpx.Client(timeout=20, follow_redirects=True) as client:
        yahoo = (US_INSTRUMENTS if do_us else []) + (INDIA_INSTRUMENTS if do_india else [])
        for symbol, name in yahoo:
            try:
                currency, daily = _fetch_yahoo_daily(client, symbol)
                if not daily:
                    raise ValueError("no daily data")
                try:
                    intraday = _fetch_yahoo_intraday(client, symbol)
                except Exception:  # noqa: BLE001 — intraday is best-effort
                    intraday = None
                now_ms = daily[-1][0]
                handle(symbol, name, currency, daily, intraday, now_ms)
            except Exception as e:  # noqa: BLE001 — skip a bad ticker, keep going
                errors.append(f"{symbol}: {e}")
                print(f"skip {symbol}: {e}", file=sys.stderr)

        if do_india:
            for scheme, name in INDIA_FUNDS:
                try:
                    currency, daily = _fetch_mf_daily(client, scheme)
                    if not daily:
                        raise ValueError("no NAV data")
                    now_ms = daily[-1][0]
                    handle(scheme, name, currency, daily, None, now_ms)
                except Exception as e:  # noqa: BLE001
                    errors.append(f"MF {scheme}: {e}")
                    print(f"skip MF {scheme}: {e}", file=sys.stderr)

    # Combine all triggering tickers into one logical message per cron call,
    # split into Telegram-sized chunks (4096-char cap) and sent with a gap so we
    # don't trip the Bot API rate limit.
    messages = []
    if alerts:
        title = {"india": "🇮🇳 India", "us": "🇺🇸 US", "all": "🌐 Global"}[market]
        highs = sum(1 for a in alerts if a["kind"] == "high")
        lows = len(alerts) - highs
        header = (
            f"📣 <b>GlobalStocks {title} — Highs/Lows</b>\n"
            f"<i>{highs} high(s) · {lows} low(s)</i>"
        )
        messages = _chunk_blocks([header] + [a["text"] for a in alerts])
        if not dry_run:
            for i, msg in enumerate(messages):
                if i > 0:
                    time.sleep(SEND_GAP_SECONDS)  # space out sends to respect rate limits
                try:
                    send(msg)
                except Exception as e:  # noqa: BLE001 — surface send failure, don't crash
                    errors.append(f"send part {i + 1}/{len(messages)}: {e}")

    return {
        "market": market,
        "checked": checked,
        "alerted": len(alerts),
        "dry_run": dry_run,
        "parts": len(messages),
        "messages": messages,
        "alerts": alerts,
        "errors": errors,
    }


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Watchlist high/low scanner")
    parser.add_argument("--dry-run", action="store_true", help="don't send to Telegram")
    parser.add_argument("--market", choices=["india", "us", "all"], default="all")
    args = parser.parse_args()

    result = scan_watchlist(args.market, dry_run=args.dry_run)
    print(f"checked {result['checked']}, alerted {result['alerted']}, "
          f"parts {result['parts']}")
    for i, msg in enumerate(result["messages"]):
        print(f"\n--- message {i + 1}/{result['parts']} ---\n{msg}")
    for e in result["errors"]:
        print(f"! {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
