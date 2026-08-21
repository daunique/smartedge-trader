"""
In-memory store (no Supabase / Postgres).

Persistence does not survive process restarts. Live trading state
(positions, BE) is recovered from Bybit on each boot.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

# Process-local stores
_settings: dict = {}
_signals: list[dict] = []
_trades: list[dict] = []
_position_state: dict[str, dict] = {}
_equity_snaps: list[dict] = []


def database_url() -> str:
    return ""


async def get_pool():
    return None


async def db_status() -> dict:
    return {
        "enabled": False,
        "backend": "memory",
        "connected": False,
        "message": "Supabase removed — using in-memory store only",
    }


async def save_trade(trade: dict) -> bool:
    try:
        tid = str(trade.get("id") or len(_trades))
        row = dict(trade)
        row["id"] = tid
        row["saved_at"] = datetime.now(timezone.utc).isoformat()
        _trades.append(row)
        if len(_trades) > 500:
            del _trades[:-400]
        return True
    except Exception as e:
        print(f"[DB] save_trade: {e}")
        return False


async def save_signal(sig: dict) -> bool:
    try:
        sid = str(sig.get("id") or "")
        raw = dict(sig)
        # upsert by id
        for i, s in enumerate(_signals):
            if str(s.get("id")) == sid:
                _signals[i] = raw
                break
        else:
            _signals.insert(0, raw)
        if len(_signals) > 200:
            del _signals[200:]
        return True
    except Exception as e:
        print(f"[DB] save_signal: {e}")
        return False


async def load_recent_signals(limit: int = 50) -> list:
    return list(_signals[: max(1, int(limit))])


async def save_equity(equity: float, available: float, open_positions: int = 0) -> bool:
    try:
        _equity_snaps.append({
            "equity": float(equity),
            "available": float(available),
            "open_positions": int(open_positions),
            "at": datetime.now(timezone.utc).isoformat(),
        })
        if len(_equity_snaps) > 200:
            del _equity_snaps[:-150]
        return True
    except Exception as e:
        print(f"[DB] save_equity: {e}")
        return False


async def save_settings(settings: dict) -> bool:
    try:
        _settings.clear()
        _settings.update(settings or {})
        return True
    except Exception as e:
        print(f"[DB] save_settings: {e}")
        return False


async def load_settings() -> Optional[dict]:
    return dict(_settings) if _settings else None


async def upsert_position_state(state: dict) -> bool:
    try:
        sym = str(state.get("symbol") or "XRPUSDT")
        prev = _position_state.get(sym) or {}
        merged = {**prev, **{k: v for k, v in state.items() if v is not None}}
        merged["symbol"] = sym
        merged["updated_at"] = datetime.now(timezone.utc).isoformat()
        if state.get("be_moved") or prev.get("be_moved"):
            merged["be_moved"] = True
        _position_state[sym] = merged
        return True
    except Exception as e:
        print(f"[DB] upsert_position_state: {e}")
        return False


async def load_position_states() -> dict:
    return {k: dict(v) for k, v in _position_state.items()}


async def clear_position_state(symbol: str) -> bool:
    _position_state.pop(str(symbol), None)
    return True
