"""
Watchlist high/low scanner for cron.

On every call this fetches the latest values for every US and India instrument in
the watchlist and, for each trailing window — 1 day, 5 days, 1 week, 2 weeks,
3 weeks and 1 month — checks whether the latest value is the highest or lowest
point inside that window's exact-timestamp range. The flagged instruments are
grouped by window (chronologically, 1 day → 1 month) and pushed to Telegram as a
single logical message per call, split into multiple messages (with a gap) if it
exceeds Telegram's character cap.

Design decisions (confirmed with the user):
  • Window  = exact-timestamp trailing range [anchor − N, anchor], where the
              anchor is the latest available data point (so the latest value is
              always the window's endpoint being tested). E.g. for a 1-month
              window anchored at Jun 18 06:10, the range is May 18 06:10 → now.
  • Flag    = latest value STRICTLY beats the prior max (HIGH) or prior min
              (LOW) of the window — exact ties (±0.00) are not flagged.
  • Data    = Yahoo HOURLY bars (range=3mo, interval=1h) for all six windows, so
              short windows (1d / 5d) are meaningful. Mutual funds publish one
              NAV per day, so they are checked only in the 1-week → 1-month
              windows and skipped for 1 day / 5 days.
  • Output  = grouped by window; one line per flagged instrument:
              "<ticker> (<name>) — <current price> — HIGH/LOW by ±diff (±%)",
              where the diff is measured against the prior extreme of that window
              (i.e. excluding the current point).
  • Send    = one message per call, split under the 4096-char cap, with a 5–10s
              gap between parts to respect the Telegram rate limit.

This module is import-safe (no side effects) so the FastAPI app can call
`scan_watchlist()` from the /cron endpoint, and it can also be run standalone.
"""

import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DAY_MS = 86_400_000

# Telegram caps a single message at 4096 chars; stay safely under it. When a scan
# produces more flags than fit, split into multiple messages and pause between
# sends to avoid hitting the Bot API rate limit.
TELEGRAM_MAX_CHARS = 3800
SEND_GAP_SECONDS = 7

# ── Watchlist (mirror of ../src/config/stocks.js) ────────────────────────────
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
    ("VOO", "Vanguard S&P 500 ETF"),
    # US funds
    ("SFLNX", "Schwab Fundamental US Large Co."),
    ("SWPPX", "Schwab S&P 500 Index"),
]

INDIA_INSTRUMENTS = [
    ("COFORGE.NS", "Coforge Ltd."),
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

# Trailing windows, chronological (shortest first). (label, days)
WINDOWS = [
    ("1 Day", 1),
    ("5 Days", 5),
    ("1 Week", 7),
    ("2 Weeks", 14),
    ("3 Weeks", 21),
    ("1 Month", 30),
]

# Mutual funds (daily NAV) only participate in windows at least this many days.
MF_MIN_DAYS = 7


# ── Market hours ─────────────────────────────────────────────────────────────
# Regular equity sessions, Mon–Fri (holidays are NOT accounted for):
#   India (NSE):        09:15–15:30 Asia/Kolkata
#   US (NYSE/Nasdaq):   09:30–16:00 America/New_York (DST handled by tz database)
# The two sessions never overlap in UTC, so at most one is open at a time.
NSE_OPEN_MIN, NSE_CLOSE_MIN = 9 * 60 + 15, 15 * 60 + 30
US_OPEN_MIN, US_CLOSE_MIN = 9 * 60 + 30, 16 * 60


def _in_session(now_utc, tz_name, open_min, close_min):
    from zoneinfo import ZoneInfo

    local = now_utc.astimezone(ZoneInfo(tz_name))
    if local.weekday() >= 5:  # Sat/Sun
        return False
    minutes = local.hour * 60 + local.minute
    return open_min <= minutes <= close_min


def current_open_market(now_utc=None):
    """Return the market whose regular session is open right now: "india", "us",
    or None if neither is open. Weekday + time only — exchange holidays ignored."""
    now_utc = now_utc or datetime.now(timezone.utc)
    if _in_session(now_utc, "Asia/Kolkata", NSE_OPEN_MIN, NSE_CLOSE_MIN):
        return "india"
    if _in_session(now_utc, "America/New_York", US_OPEN_MIN, US_CLOSE_MIN):
        return "us"
    return None


# ── Fetching ─────────────────────────────────────────────────────────────────

def _fetch_yahoo_hourly(client, symbol):
    """Hourly bars over the last ~3 months: list of (time_ms, price) oldest->newest."""
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        "?range=3mo&interval=1h&includePrePost=false"
    )
    r = client.get(url, headers={"User-Agent": "Mozilla/5.0"})
    res = r.json()["chart"]["result"][0]
    ts = res.get("timestamp") or []
    closes = res["indicators"]["quote"][0].get("close") or []
    currency = res.get("meta", {}).get("currency", "USD")
    points = [(t * 1000, c) for t, c in zip(ts, closes) if c is not None]
    return currency, points


def _fetch_mf_daily(client, scheme):
    """Daily NAV over the last ~3 months: list of (time_ms, nav) oldest->newest."""
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

# Ignore microscopic new extremes: only flag a high/low that cleared the prior
# extreme by at least this percentage (0.1%).
MIN_EXTREME_PCT = 0.1


def _check_window(points, days):
    """For the trailing `days` window ending at the latest point, decide whether
    the latest value is a high and/or low, and by how much it cleared the prior
    extreme (the extreme of every *other* point in the window).

    Returns a list of (kind, amount, pct) results, possibly empty. Extremes that
    clear the prior extreme by less than MIN_EXTREME_PCT are dropped.
    """
    if len(points) < 2:
        return []
    anchor = points[-1][0]
    cutoff = anchor - days * DAY_MS
    window = [p for p in points if p[0] >= cutoff]
    if len(window) < 2:
        return []

    latest = window[-1][1]
    prior = [p for _, p in window[:-1]]  # exclude the current point
    prior_max = max(prior)
    prior_min = min(prior)

    # Require a *strict* new extreme — the latest value must beat the prior
    # extreme, not merely tie it (ties produce meaningless ±0.00 noise).
    out = []
    if latest > prior_max:
        amount = latest - prior_max
        pct = (amount / prior_max * 100) if prior_max else 0.0
        if pct >= MIN_EXTREME_PCT:
            out.append(("high", amount, pct))
    if latest < prior_min:
        amount = prior_min - latest
        pct = (amount / prior_min * 100) if prior_min else 0.0
        if pct >= MIN_EXTREME_PCT:
            out.append(("low", amount, pct))
    return out


# ── Formatting ───────────────────────────────────────────────────────────────

def _money(v, currency):
    sym = "₹" if currency == "INR" else "$"
    return f"{sym}{v:,.2f}"


def _format_line(flag):
    emoji = "🚀" if flag["kind"] == "high" else "🔻"
    word = "HIGH" if flag["kind"] == "high" else "LOW"
    sign = "+" if flag["kind"] == "high" else "−"
    return (
        f"{emoji} <b>{flag['symbol']}</b> ({flag['name']}) — "
        f"{_money(flag['latest'], flag['currency'])} — "
        f"{word} by {sign}{_money(flag['amount'], flag['currency'])} "
        f"({sign}{flag['pct']:.2f}%)"
    )


def _chunk_blocks(blocks, limit=TELEGRAM_MAX_CHARS):
    """Pack text blocks into messages no longer than `limit` chars, splitting on
    block boundaries (so a window section is never cut in half). A single
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


# ── Scan ─────────────────────────────────────────────────────────────────────

def scan_watchlist(market="all", dry_run=False, send=None):
    """Fetch the watchlist, detect per-window extremes, group by window, and
    (optionally) push the result to Telegram.

    market: "india" | "us" | "all".
    dry_run: if True, build the message(s) but don't send.
    send: callable(text) used to deliver a message (defaults to Telegram sender).

    Returns a summary dict describing what was checked and what fired.
    """
    market = market.lower()
    do_us = market in ("all", "us")
    do_india = market in ("all", "india")

    if send is None and not dry_run:
        from main import send_telegram as send  # lazy import to avoid a cycle

    grouped = {label: [] for label, _ in WINDOWS}
    checked = 0
    errors = []

    def handle(symbol, name, currency, points, is_mf):
        nonlocal checked
        checked += 1
        for label, days in WINDOWS:
            if is_mf and days < MF_MIN_DAYS:
                continue
            for kind, amount, pct in _check_window(points, days):
                grouped[label].append({
                    "symbol": symbol, "name": name, "currency": currency,
                    "kind": kind, "latest": points[-1][1],
                    "amount": amount, "pct": round(pct, 2),
                })

    with httpx.Client(timeout=20, follow_redirects=True) as client:
        yahoo = (US_INSTRUMENTS if do_us else []) + (INDIA_INSTRUMENTS if do_india else [])
        for symbol, name in yahoo:
            try:
                currency, points = _fetch_yahoo_hourly(client, symbol)
                if not points:
                    raise ValueError("no hourly data")
                handle(symbol, name, currency, points, is_mf=False)
            except Exception as e:  # noqa: BLE001 — skip a bad ticker, keep going
                errors.append(f"{symbol}: {e}")
                print(f"skip {symbol}: {e}", file=sys.stderr)

        if do_india:
            for scheme, name in INDIA_FUNDS:
                try:
                    currency, points = _fetch_mf_daily(client, scheme)
                    if not points:
                        raise ValueError("no NAV data")
                    handle(scheme, name, currency, points, is_mf=True)
                except Exception as e:  # noqa: BLE001
                    errors.append(f"MF {scheme}: {e}")
                    print(f"skip MF {scheme}: {e}", file=sys.stderr)

    total_flags = sum(len(v) for v in grouped.values())

    # Build one logical message: a section per window (chronological), then split
    # into Telegram-sized chunks sent with a gap so we don't trip the rate limit.
    messages = []
    if total_flags:
        title = {"india": "🇮🇳 India", "us": "🇺🇸 US", "all": "🌐 Global"}[market]
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        header = (
            f"📣 <b>GlobalStocks {title} — Highs/Lows</b>\n"
            f"<i>{stamp} · {total_flags} flag(s) across {checked} instruments</i>"
        )
        blocks = [header]
        for label, _ in WINDOWS:  # chronological order
            flags = grouped[label]
            if not flags:
                continue
            lines = [f"<b>📅 {label}</b>"] + [_format_line(f) for f in flags]
            blocks.append("\n".join(lines))

        messages = _chunk_blocks(blocks)
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
        "flags": total_flags,
        "dry_run": dry_run,
        "parts": len(messages),
        "grouped": grouped,
        "messages": messages,
        "errors": errors,
    }


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Watchlist high/low scanner")
    parser.add_argument("--dry-run", action="store_true", help="don't send to Telegram")
    parser.add_argument("--market", choices=["india", "us", "all"], default="all")
    args = parser.parse_args()

    result = scan_watchlist(args.market, dry_run=args.dry_run)
    print(f"checked {result['checked']}, flags {result['flags']}, parts {result['parts']}")
    for i, msg in enumerate(result["messages"]):
        print(f"\n--- message {i + 1}/{result['parts']} ---\n{msg}")
    for e in result["errors"]:
        print(f"! {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
