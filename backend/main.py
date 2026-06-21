"""
GlobalStocks AI analysis backend.

A small FastAPI server that takes a ticker and asks an LLM agent (Claude or
ChatGPT) for a short research note: recent performance, news with sources and a
source-reputation score, and the likely impact of buying. Both providers use a
live web-search tool so the news is current.

Run:
    cd backend
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Keys are read from the project-root .env (ANTHROPIC_API_KEY / OPENAI_API_KEY).
"""

import datetime
import json
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Load .env from the project root (one level up from backend/).
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Analysis models (Agent 2 — does the actual web-search research).
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# Prompt-generator models (Agent 1 — writes the research strategy). Fall back to
# the analysis models so quality can be tuned per-agent purely via .env.
ANTHROPIC_PROMPT_MODEL = os.getenv("ANTHROPIC_PROMPT_MODEL", ANTHROPIC_MODEL)
OPENAI_PROMPT_MODEL = os.getenv("OPENAI_PROMPT_MODEL", OPENAI_MODEL)

MAX_TOKENS = 5000        # Agent 2 (analysis) budget.
PROMPT_MAX_TOKENS = 1500  # Agent 1 (prompt generation) budget.

app = FastAPI(title="GlobalStocks AI Analysis")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    ticker: str
    name: str | None = None
    provider: str = "claude"  # "claude" | "openai"


class NotifyRequest(BaseModel):
    text: str
    chat_id: str | None = None  # override the default TELEGRAM_CHAT_ID if provided


# ── Prompt ─────────────────────────────────────────────────────────────────

def build_meta_prompt(ticker: str, name: str | None, today: str) -> str:
    """Agent 1 instruction: ask the model to design a company-specific research
    strategy prompt. It returns plain prompt text (no JSON, no analysis)."""
    label = f"{ticker}" + (f" ({name})" if name else "")
    return f"""You are an expert financial-research prompt engineer. Today's date is {today}.

Write a detailed research-instruction prompt that another financial-analyst AI \
will follow to research the security {label}. Tailor it specifically to THIS \
company: its sector, its home market/region and exchange, and the kinds of \
catalysts that move it.

The prompt you write MUST instruct the analyst to:
- Use web search for the LATEST information, anchored to today's date ({today}).
- Name the most relevant, reputable sources and outlets to search for this \
specific company/sector/region (e.g. exchange filings, sector-specific outlets, \
reputable financial press).
- Specify what kinds of recent news and events matter most for this company \
(earnings, regulation, products, macro, sector trends, etc.).
- Explain how to assess the news' impact on the stock over short and long horizons.

Output ONLY the research-instruction prompt text. Do NOT perform the research \
yourself, do NOT include any JSON, and do NOT add commentary before or after the \
prompt. Keep it focused and under {PROMPT_MAX_TOKENS} tokens."""


def build_json_contract() -> str:
    """The strict output contract appended to every analysis prompt so the UI
    always receives the exact JSON shape it renders."""
    return f"""Return ONLY a JSON object (no markdown, no prose outside the JSON) with EXACTLY this shape:

{{
  "summary": "2-3 sentence overview of how the stock has been performing.",
  "performance": {{
    "week":    {{ "trend": "up|down|flat", "change": "approx % or qualitative", "reason": "why" }},
    "month":   {{ "trend": "up|down|flat", "change": "...", "reason": "..." }},
    "quarter": {{ "trend": "up|down|flat", "change": "...", "reason": "..." }},
    "year":    {{ "trend": "up|down|flat", "change": "...", "reason": "..." }}
  }},
  "news": [
    {{
      "headline": "recent headline that could impact the stock",
      "source": "publication name",
      "url": "valid source URL",
      "reputationScore": 0-100,
      "reputationNote": "one line on why the source is/isn't reputable",
      "impact": "how this news could affect the stock"
    }}
  ],
  "impactIfBought": {{
    "shortTerm": "likely impact factor / outlook if bought now, short run",
    "longTerm": "likely impact factor / outlook in the longer run"
  }}
}}

Provide 1-3 news items, each with a REAL, verifiable source URL found via web search and an honest \
reputationScore (0=unreliable, 100=highly reputable). Keep the whole response under {MAX_TOKENS} tokens. \
Output JSON only."""


def build_final_prompt(strategy: str) -> str:
    """Combine Agent 1's strategy with the fixed JSON contract for Agent 2."""
    return (
        f"{strategy.strip()}\n\n"
        f"--- OUTPUT FORMAT (strict) ---\n{build_json_contract()}"
    )


def extract_json(text: str) -> dict:
    """Pull the JSON object out of an LLM response, tolerating code fences."""
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    else:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end != -1:
            text = text[start : end + 1]
    return json.loads(text)


# ── Providers ──────────────────────────────────────────────────────────────

def claude_complete(prompt: str, *, model: str, max_tokens: int, web_search: bool) -> str:
    """Single Claude turn. Optionally enables the server-side web-search tool."""
    import anthropic

    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(500, "ANTHROPIC_API_KEY is not set in .env")

    client = anthropic.Anthropic()
    messages = [{"role": "user", "content": prompt}]
    tools = (
        [{"type": "web_search_20250305", "name": "web_search", "max_uses": 5}]
        if web_search else []
    )

    # Server-side tools may pause; resume until the turn ends.
    for _ in range(6):
        resp = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            messages=messages,
            tools=tools,
        )
        if resp.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": resp.content})
            continue
        break

    return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")


def openai_complete(prompt: str, *, model: str, max_tokens: int, web_search: bool) -> str:
    """Single OpenAI Responses turn. Optionally enables the web-search tool."""
    from openai import OpenAI

    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(500, "OPENAI_API_KEY is not set in .env")

    client = OpenAI()
    resp = client.responses.create(
        model=model,
        tools=[{"type": "web_search_preview"}] if web_search else [],
        max_output_tokens=max_tokens,
        input=prompt,
    )
    return resp.output_text


# Provider config: (prompt-generator model, analysis model, completion fn).
PROVIDERS = {
    "claude":    (ANTHROPIC_PROMPT_MODEL, ANTHROPIC_MODEL, claude_complete),
    "anthropic": (ANTHROPIC_PROMPT_MODEL, ANTHROPIC_MODEL, claude_complete),
    "openai":    (OPENAI_PROMPT_MODEL, OPENAI_MODEL, openai_complete),
    "chatgpt":   (OPENAI_PROMPT_MODEL, OPENAI_MODEL, openai_complete),
}


def run_two_agent_analysis(provider: str, ticker: str, name: str | None) -> dict:
    """Agent 1 writes a company-specific research strategy; Agent 2 follows it
    (with web search) to produce the JSON analysis. Returns both the analysis
    and the exact prompt Agent 2 used."""
    prompt_model, analysis_model, complete = PROVIDERS[provider]
    today = datetime.date.today().isoformat()

    # Agent 1 — generate the research strategy (no web search).
    strategy = complete(
        build_meta_prompt(ticker, name, today),
        model=prompt_model,
        max_tokens=PROMPT_MAX_TOKENS,
        web_search=False,
    ).strip()
    if not strategy:
        raise HTTPException(502, "The prompt-generator returned no text. Try again.")

    # Agent 2 — run the analysis using the generated prompt + JSON contract.
    final_prompt = build_final_prompt(strategy)
    text = complete(
        final_prompt,
        model=analysis_model,
        max_tokens=MAX_TOKENS,
        web_search=True,
    )
    return {
        "analysis": extract_json(text),
        "prompt": final_prompt,
        "promptModel": prompt_model,
        "analysisModel": analysis_model,
    }


# ── Telegram ───────────────────────────────────────────────────────────────

def send_telegram(text: str, chat_id: str | None = None) -> dict:
    """Send a message via the Telegram Bot API. Token/chat id come from .env."""
    import httpx

    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat = chat_id or os.getenv("TELEGRAM_CHAT_ID")
    if not token:
        raise HTTPException(500, "TELEGRAM_BOT_TOKEN is not set in .env")
    if not chat:
        raise HTTPException(500, "TELEGRAM_CHAT_ID is not set in .env (or pass chat_id)")

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    resp = httpx.post(url, json=payload, timeout=15)
    data = resp.json()
    if not data.get("ok"):
        # Telegram returns a human-readable "description" on error.
        raise HTTPException(502, f"Telegram error: {data.get('description', resp.text)}")
    return data


# ── Routes ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "ok": True,
        "claude": bool(os.getenv("ANTHROPIC_API_KEY")),
        "openai": bool(os.getenv("OPENAI_API_KEY")),
        "telegram": bool(os.getenv("TELEGRAM_BOT_TOKEN") and os.getenv("TELEGRAM_CHAT_ID")),
    }


@app.get("/telegram/health")
def telegram_health():
    return {
        "configured": bool(os.getenv("TELEGRAM_BOT_TOKEN") and os.getenv("TELEGRAM_CHAT_ID")),
        "hasToken": bool(os.getenv("TELEGRAM_BOT_TOKEN")),
        "hasChatId": bool(os.getenv("TELEGRAM_CHAT_ID")),
    }


@app.post("/notify")
def notify(req: NotifyRequest):
    if not req.text.strip():
        raise HTTPException(400, "text is required")
    result = send_telegram(req.text, req.chat_id)
    return {"ok": True, "message_id": result.get("result", {}).get("message_id")}


@app.get("/cron")
def cron():
    """Market-aware watchlist high/low scan. No parameters.

    Detects which regular equity session is open right now and scans only that
    market: India (NSE) -> India watchlist, US -> US watchlist. If neither is
    open, takes NO Telegram action and returns a closed status. Safe to hit on a
    fixed external schedule — it self-gates on market hours.
    """
    from cron import current_open_market, scan_watchlist

    market = current_open_market()
    if market is None:
        return {
            "status": "closed",
            "market": None,
            "checked": 0,
            "flags": 0,
            "parts": 0,
            "messages": [],
            "note": "Both markets closed; no Telegram action taken.",
        }

    try:
        result = scan_watchlist(market)
        result["status"] = "open"
        return result
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — surface scan errors to the caller
        raise HTTPException(502, f"{type(e).__name__}: {e}")


@app.get("/cron-all")
def cron_all():
    """Scan BOTH markets (US + India) unconditionally, ignoring market hours,
    and push the combined result to Telegram. Use for a manual or daily run."""
    from cron import scan_watchlist

    try:
        result = scan_watchlist("all")
        result["status"] = "ran"
        return result
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — surface scan errors to the caller
        raise HTTPException(502, f"{type(e).__name__}: {e}")


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    if not req.ticker:
        raise HTTPException(400, "ticker is required")

    provider = req.provider.lower()
    if provider not in PROVIDERS:
        raise HTTPException(400, f"unknown provider: {req.provider}")

    try:
        result = run_two_agent_analysis(provider, req.ticker, req.name)
    except HTTPException:
        raise
    except json.JSONDecodeError:
        raise HTTPException(502, "The model did not return valid JSON. Try again.")
    except Exception as e:  # noqa: BLE001 — surface provider errors to the client
        raise HTTPException(502, f"{type(e).__name__}: {e}")

    return {
        "provider": req.provider,
        "model": result["analysisModel"],
        "promptModel": result["promptModel"],
        "ticker": req.ticker,
        "analysis": result["analysis"],
        "prompt": result["prompt"],
        "disclaimer": (
            "AI-generated analysis for research purposes only. This is NOT financial "
            "advice. AI can be inaccurate or out of date — do not rely on it for "
            "investment decisions. Always do your own research and consult a licensed "
            "financial advisor."
        ),
    }
