"""
SmartEdge Trader — Bybit REST client (demo / testnet / mainnet).
"""

from __future__ import annotations

import os
import json
import hmac
import hashlib
import time
import httpx
from datetime import datetime


def get_api_key() -> str:
    return (os.getenv("BYBIT_API_KEY") or "").strip()


def get_api_secret() -> str:
    return (os.getenv("BYBIT_API_SECRET") or "").strip()


def get_base() -> str:
    """
    Resolve REST host:
      BYBIT_BASE          — explicit override (full origin, no trailing slash)
      ACCOUNT_MODE=DEMO   — api-demo.bybit.com  (Bybit Demo Trading)
      BYBIT_TESTNET=true  — api-testnet.bybit.com
      else                — api.bybit.com (live)
    """
    explicit = (os.getenv("BYBIT_BASE") or "").strip().rstrip("/")
    if explicit:
        return explicit
    mode = (os.getenv("ACCOUNT_MODE") or "DEMO").strip().upper()
    if mode == "DEMO":
        return "https://api-demo.bybit.com"
    testnet = (os.getenv("BYBIT_TESTNET") or "true").strip().lower() in ("1", "true", "yes")
    if testnet:
        return "https://api-testnet.bybit.com"
    return "https://api.bybit.com"


# Back-compat name used by main.py health payload
DEMO_BASE = "https://api-demo.bybit.com"


def _sign(param_str: str) -> str:
    return hmac.new(get_api_secret().encode(), param_str.encode(), hashlib.sha256).hexdigest()


def _parse_response(r: httpx.Response, path: str) -> dict:
    text = (r.text or "").strip()
    if not text:
        return {
            "retCode": -1,
            "retMsg": f"empty body HTTP {r.status_code} for {path}",
            "result": {},
        }
    try:
        data = r.json()
        if not isinstance(data, dict):
            return {"retCode": -1, "retMsg": f"non-object JSON from {path}", "result": {}}
        return data
    except Exception as e:
        snippet = text[:240].replace("\n", " ")
        print(f"[BYBIT] JSON parse fail {path} HTTP {r.status_code}: {e} | body={snippet!r}")
        return {
            "retCode": -1,
            "retMsg": f"invalid JSON HTTP {r.status_code}: {snippet[:120]}",
            "result": {},
        }


async def bybit_get(path: str, params: dict = None) -> dict:
    params = params or {}
    api_key = get_api_key()
    if not api_key:
        return {"retCode": -1, "retMsg": "BYBIT_API_KEY not set", "result": {}}
    base = get_base()
    ts = str(int(time.time() * 1000))
    recv_window = "20000"
    param_str = ts + api_key + recv_window + "&".join(
        f"{k}={v}" for k, v in sorted(params.items())
    )
    headers = {
        "X-BAPI-API-KEY": api_key,
        "X-BAPI-TIMESTAMP": ts,
        "X-BAPI-SIGN": _sign(param_str),
        "X-BAPI-RECV-WINDOW": recv_window,
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(f"{base}{path}", params=params, headers=headers)
            data = _parse_response(r, path)
            if data.get("retCode") not in (0, None) and data.get("retCode") != 0:
                # Log auth/config mistakes once clearly
                if data.get("retCode") in (10003, 10004, 10005, 33004, -1):
                    print(f"[BYBIT] GET {path} retCode={data.get('retCode')} retMsg={data.get('retMsg')} base={base}")
            return data
    except Exception as e:
        print(f"[BYBIT] GET {path} network error: {e}")
        return {"retCode": -1, "retMsg": str(e), "result": {}}


async def bybit_post(path: str, body: dict = None) -> dict:
    body = body or {}
    api_key = get_api_key()
    if not api_key:
        return {"retCode": -1, "retMsg": "BYBIT_API_KEY not set", "result": {}}
    base = get_base()
    ts = str(int(time.time() * 1000))
    recv_window = "20000"
    body_str = json.dumps(body)
    param_str = ts + api_key + recv_window + body_str
    headers = {
        "X-BAPI-API-KEY": api_key,
        "X-BAPI-TIMESTAMP": ts,
        "X-BAPI-SIGN": _sign(param_str),
        "X-BAPI-RECV-WINDOW": recv_window,
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(f"{base}{path}", content=body_str, headers=headers)
            data = _parse_response(r, path)
            if data.get("retCode") != 0:
                print(f"[BYBIT] POST {path} retCode={data.get('retCode')} retMsg={data.get('retMsg')} base={base}")
            return data
    except Exception as e:
        print(f"[BYBIT] POST {path} network error: {e}")
        return {"retCode": -1, "retMsg": str(e), "result": {}}


def get_order_pnl(o: dict) -> float:
    closed = o.get("closedPnl")
    if closed and float(closed) != 0:
        return round(float(closed), 4)
    cum_fee = float(o.get("cumExecFee") or 0)
    return round(-cum_fee, 4)


def is_closing_order(o: dict) -> bool:
    return bool(o.get("reduceOnly"))


def get_order_rr(o: dict) -> float:
    try:
        entry = float(o.get("avgPrice") or 0)
        tp = float(o.get("takeProfit") or 0)
        sl = float(o.get("stopLoss") or 0)
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


async def fetch_closed_pnl(symbol: str = "XRPUSDT", limit: int = 50) -> list:
    """Realized PnL rows from Bybit (authoritative closedPnl)."""
    data = await bybit_get(
        "/v5/position/closed-pnl",
        {"category": "linear", "symbol": symbol, "limit": str(limit)},
    )
    if data.get("retCode") != 0:
        print(f"[BYBIT] closed-pnl: {data.get('retMsg')}")
        return []
    return data.get("result", {}).get("list") or []
