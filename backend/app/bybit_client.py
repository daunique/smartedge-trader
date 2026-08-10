"""
SmartEdge Trader — shared Bybit demo-API client.

Previously this signing/request logic was duplicated independently in both
main.py and auto_executor.py (~50 lines each). Two independent copies of the
same logic is exactly the failure pattern that caused the settings-drift and
walk-forward-comment issues found earlier in this codebase -- one file gets
fixed or changed and the other silently doesn't. Consolidated here; both
modules import from this one instead.
"""

import os, json, hmac, hashlib, time
import httpx
from datetime import datetime

DEMO_BASE = "https://api-demo.bybit.com"

# Read fresh on every call, not cached at import time -- a Bybit key
# rotation in Render's environment must take effect without a full
# process restart, and importing this module before env injection
# completes must not permanently cache an empty value.
def get_api_key() -> str:
    return os.getenv("BYBIT_API_KEY", "")

def get_api_secret() -> str:
    return os.getenv("BYBIT_API_SECRET", "")

def _sign(param_str: str) -> str:
    return hmac.new(get_api_secret().encode(), param_str.encode(), hashlib.sha256).hexdigest()

async def bybit_get(path: str, params: dict = None) -> dict:
    params = params or {}
    api_key     = get_api_key()
    ts          = str(int(time.time() * 1000))
    recv_window = "20000"
    param_str   = ts + api_key + recv_window + "&".join(
        f"{k}={v}" for k, v in sorted(params.items())
    )
    headers = {
        "X-BAPI-API-KEY": api_key, "X-BAPI-TIMESTAMP": ts,
        "X-BAPI-SIGN": _sign(param_str), "X-BAPI-RECV-WINDOW": recv_window,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{DEMO_BASE}{path}", params=params, headers=headers)
        return r.json()

async def bybit_post(path: str, body: dict = None) -> dict:
    body        = body or {}
    api_key     = get_api_key()
    ts          = str(int(time.time() * 1000))
    recv_window = "20000"
    body_str    = json.dumps(body)
    param_str   = ts + api_key + recv_window + body_str
    headers = {
        "X-BAPI-API-KEY": api_key, "X-BAPI-TIMESTAMP": ts,
        "X-BAPI-SIGN": _sign(param_str), "X-BAPI-RECV-WINDOW": recv_window,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{DEMO_BASE}{path}", content=body_str, headers=headers)
        return r.json()

def get_order_pnl(o: dict) -> float:
    """Realized P&L for a Bybit order: closedPnl when available, else -fees."""
    closed = o.get("closedPnl")
    if closed and float(closed) != 0:
        return round(float(closed), 4)
    cum_fee = float(o.get("cumExecFee") or 0)
    return round(-cum_fee, 4)

def get_order_rr(o: dict) -> float:
    """Actual R:R achieved on a filled order, from its own fill/TP/SL prices
    -- not assumed from strategy defaults, so it stays correct even if the
    strategy's multiples change later."""
    try:
        entry = float(o.get("avgPrice") or 0)
        tp    = float(o.get("takeProfit") or 0)
        sl    = float(o.get("stopLoss") or 0)
        if not (entry and tp and sl):
            return 0.0
        risk = abs(entry - sl)
        return round(abs(tp - entry) / risk, 2) if risk > 0 else 0.0
    except (TypeError, ValueError):
        return 0.0

def ts_to_iso(ts_str) -> str:
    try:
        return datetime.utcfromtimestamp(int(ts_str) / 1000).isoformat() + "Z"
    except (TypeError, ValueError):
        return datetime.utcnow().isoformat() + "Z"

def is_today_utc(ts_str) -> bool:
    try:
        d = datetime.utcfromtimestamp(int(ts_str) / 1000).date()
        return d == datetime.utcnow().date()
    except (TypeError, ValueError):
        return False
