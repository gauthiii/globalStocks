# GlobalStocks

A React + Vite portfolio dashboard for US and India stocks/funds, with an
optional FastAPI backend that runs Claude / ChatGPT agents for per-stock
research notes.

## Frontend

```bash
npm install
npm run dev      # dev server
npm run build    # production build
```

## AI Analysis backend (optional)

Each stock's detail modal has **Claude** and **ChatGPT** buttons. Clicking one
calls the backend, which asks that agent (with live web search) for a short
analysis: recent performance (week / month / quarter / year) with reasons,
latest news with sources and a source-reputation score, and the likely impact
of buying. A disclaimer is always shown — the output is for research only and
must not be treated as financial advice.

### Setup

1. Copy `.env.example` to `.env` and fill in your keys:

   ```
   ANTHROPIC_API_KEY=...
   OPENAI_API_KEY=...
   ANTHROPIC_MODEL=claude-haiku-4-5
   OPENAI_MODEL=gpt-4o-mini
   ```

   `.env` is gitignored — never commit real keys.

2. Run the backend:

   ```bash
   cd backend
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   uvicorn main:app --reload --port 8000
   ```

The frontend talks to `http://localhost:8000` by default; override with
`VITE_API_URL`.

## Watchlist high/low alerts (`/cron`)

A market-aware scanner that checks the whole watchlist for new period
highs/lows and pushes a single Telegram message per call. Intended to be hit by
an external scheduler (e.g. a Render Cron Job) on a fixed cadence — it self-gates
on market hours, so it's safe to call frequently.

For every instrument it checks each trailing window — **1 day, 5 days, 1 week,
2 weeks, 3 weeks, 1 month** — using exact-timestamp ranges anchored at the latest
data point, and flags it when the latest value **strictly** beats the prior high
or low of that window. Results are grouped by window (chronologically) into one
message, split under Telegram's 4096-char cap with a ~7s gap between parts.

- **Data:** Yahoo hourly bars for all windows; Indian mutual funds use daily NAV
  and are scanned only in the 1-week → 1-month windows.
- **`.env`:** requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (no AI keys
  needed for the cron).

### Endpoints

| Endpoint    | Behavior |
|-------------|----------|
| `GET /cron` | **No parameters.** Detects which regular equity session is open *right now* and scans only that market: NSE open (09:15–15:30 IST, Mon–Fri) → India; US open (09:30–16:00 ET, Mon–Fri, DST-aware) → US. If neither is open it takes **no Telegram action** and returns a `"closed"` status. Exchange holidays are not accounted for. |
| `GET /cron-all` | Scans **both** markets unconditionally, ignoring market hours. Use for a manual or daily run. |

Run standalone (without the web server) for testing:

```bash
cd backend
./.venv/bin/python cron.py --market us --dry-run     # us | india | all
```
