"""
Server-side daily P/L digest.

Computes an equal-weighted (1 unit per instrument) P/L across the watchlist for
the daily / 5-day / 1-week / 1-month windows, grouped by currency, and pushes a
summary to Telegram. Runs without a browser so it can be scheduled (cron/launchd).

Usage:
    cd backend
    ./.venv/bin/python digest.py            # build and send to Telegram
    ./.venv/bin/python digest.py --dry-run  # print the message, don't send

Mirrors the watchlist in ../src/config/stocks.js — keep the two in sync.
"""

import argparse
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# ── Watchlist (mirror of src/config/stocks.js) ───────────────────────────────
US_SYMBOLS = [
    "GOOGL", "AMZN", "CVX", "CVS", "XOM", "MSFT", "NFLX", "NVDA", "SPCX", "KO",
    "UBER", "WMT", "SNDK", "MU", "AMD", "MRVL", "ASML", "TSM", "TSLA",
    # US funds
    "SFLNX", "SWPPX",
]
INDIA_SYMBOLS = [
    "DRREDDY.NS", "GOLDBEES.NS", "HDFCBANK.NS", "ITBEES.NS", "ITC.NS",
    "PHARMABEES.NS", "SILVERBEES.NS", "WIPRO.NS", "ZYDUSLIFE.NS",
]
INDIA_FUND_SCHEMES = ["120586", "120716", "122639"]

DAY_MS = 86_400_000


def _deltas(points):
    """points: list of (time_ms, price) oldest->newest. Returns period changes."""
    if len(points) < 2:
        return None
    last_t, last = points[-1]

    def at_or_before(target):
        chosen = points[0][1]
        for t, p in points:
            if t <= target:
                chosen = p
            else:
                break
        return chosen

    return {
        "d1": last - points[-2][1],
        "d5": last - points[max(0, len(points) - 6)][1],
        "w1": last - at_or_before(last_t - 7 * DAY_MS),
        "m1": last - points[0][1],
    }


def _fetch_yahoo(client, symbol):
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        "?range=1mo&interval=1d&includePrePost=false"
    )
    r = client.get(url, headers={"User-Agent": "Mozilla/5.0"})
    res = r.json()["chart"]["result"][0]
    ts = res.get("timestamp") or []
    closes = res["indicators"]["quote"][0].get("close") or []
    currency = res.get("meta", {}).get("currency", "USD")
    points = [(t * 1000, c) for t, c in zip(ts, closes) if c is not None]
    return currency, points


def _fetch_mf(client, scheme):
    r = client.get(f"https://api.mfapi.in/mf/{scheme}")
    rows = r.json().get("data", [])
    points = []
    for d in reversed(rows):  # API is newest->oldest
        day, month, year = (int(x) for x in d["date"].split("-"))
        # naive ms timestamp (UTC midnight) — precise enough for daily windows
        from datetime import datetime, timezone
        t = int(datetime(year, month, day, tzinfo=timezone.utc).timestamp() * 1000)
        points.append((t, float(d["nav"])))
    # keep ~1 month
    if points:
        cutoff = points[-1][0] - 31 * DAY_MS
        points = [p for p in points if p[0] >= cutoff]
    return "INR", points


def build_digest():
    """Returns (message_text, stats) without sending."""
    totals = {}  # currency -> {d1,d5,w1,m1}
    loaded = 0
    total = len(US_SYMBOLS) + len(INDIA_SYMBOLS) + len(INDIA_FUND_SCHEMES)

    def add(currency, deltas):
        nonlocal loaded
        if not deltas:
            return
        loaded += 1
        bucket = totals.setdefault(currency, {"d1": 0, "d5": 0, "w1": 0, "m1": 0})
        for k in bucket:
            bucket[k] += deltas[k]

    with httpx.Client(timeout=20, follow_redirects=True) as client:
        for sym in US_SYMBOLS + INDIA_SYMBOLS:
            try:
                cur, pts = _fetch_yahoo(client, sym)
                add(cur, _deltas(pts))
            except Exception as e:  # noqa: BLE001 — skip a bad ticker, keep going
                print(f"skip {sym}: {e}", file=sys.stderr)
        for scheme in INDIA_FUND_SCHEMES:
            try:
                cur, pts = _fetch_mf(client, scheme)
                add(cur, _deltas(pts))
            except Exception as e:  # noqa: BLE001
                print(f"skip MF {scheme}: {e}", file=sys.stderr)

    periods = [("d1", "Daily P/L"), ("d5", "5-Day P/L"), ("w1", "1-Week P/L"), ("m1", "1-Month P/L")]
    currencies = sorted(totals)

    def money(v, cur):
        sym = "₹" if cur == "INR" else "$"
        sign = "+" if v >= 0 else "−"
        return f"{sign}{sym}{abs(v):,.2f}"

    lines = ["📊 <b>GlobalStocks — Daily P/L</b>", f"<i>Equal-weighted · {loaded}/{total} loaded</i>", ""]
    for key, label in periods:
        parts = [money(totals[c][key], c) for c in currencies]
        lines.append(f"<b>{label}:</b> {'  |  '.join(parts)}" if parts else f"<b>{label}:</b> n/a")
    text = "\n".join(lines)
    return text, {"loaded": loaded, "total": total, "currencies": currencies}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="print, don't send")
    args = parser.parse_args()

    text, stats = build_digest()
    if args.dry_run:
        print(text)
        return

    # Reuse the sender from the API server.
    from main import send_telegram

    send_telegram(text)
    print(f"Sent digest ({stats['loaded']}/{stats['total']} loaded).")


if __name__ == "__main__":
    main()
