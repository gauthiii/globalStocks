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
