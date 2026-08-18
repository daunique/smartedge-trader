"""
Supabase Postgres via IPv4 Session Pooler (asyncpg).

Set secret:
  DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres

Session mode = port 5432 (not 6543 transaction mode).
"""

from __future__ import annotations

import os
import json
from datetime import datetime, timezone
from typing import Any, Optional

_pool = None
_init_attempted = False


def database_url() -> str:
    return (
        os.getenv("DATABASE_URL")
        or os.getenv("SUPABASE_DB_URL")
        or os.getenv("SUPABASE_DATABASE_URL")
        or ""
    ).strip()


async def get_pool():
    global _pool, _init_attempted
    url = database_url()
    if not url:
        return None
    if _pool is not None:
        return _pool
    if _init_attempted and _pool is None:
        return None
    _init_attempted = True
    try:
        import asyncpg
        # Prefer IPv4 for Fly/some hosts: use pooler host as provided
        _pool = await asyncpg.create_pool(
            dsn=url,
            min_size=1,
            max_size=4,
            command_timeout=30,
            statement_cache_size=0,  # required for pgbouncer/session pooler compatibility
        )
        await _ensure_schema(_pool)
        print("[DB] Supabase session pooler connected")
        return _pool
    except Exception as e:
        print(f"[DB] connect failed: {e}")
        _pool = None
        return None


async def _ensure_schema(pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute("""
        CREATE TABLE IF NOT EXISTS trades (
            id TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            direction TEXT,
            status TEXT,
            pnl DOUBLE PRECISION DEFAULT 0,
            rr TEXT,
            raw JSONB,
            closed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS signals_log (
            id TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            direction TEXT,
            entry DOUBLE PRECISION,
            tp DOUBLE PRECISION,
            sl DOUBLE PRECISION,
            be DOUBLE PRECISION,
            status TEXT,
            executed BOOLEAN DEFAULT FALSE,
            last_error TEXT,
            raw JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS equity_snapshots (
            id BIGSERIAL PRIMARY KEY,
            equity DOUBLE PRECISION,
            available DOUBLE PRECISION,
            open_positions INT DEFAULT 0,
            source TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value JSONB NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_trades_symbol_closed ON trades (symbol, closed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_signals_created ON signals_log (created_at DESC);
        CREATE TABLE IF NOT EXISTS position_state (
            symbol TEXT PRIMARY KEY,
            direction TEXT,
            entry DOUBLE PRECISION,
            tp DOUBLE PRECISION,
            sl DOUBLE PRECISION,
            orig_risk DOUBLE PRECISION,
            peak_favorable DOUBLE PRECISION,
            be_moved BOOLEAN DEFAULT FALSE,
            signal_id TEXT,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        """)


def _as_dt(value):
    if value is None:
        return datetime.now(timezone.utc)
    if isinstance(value, datetime):
        return value
    s = str(value).strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return datetime.now(timezone.utc)


async def save_trade(trade: dict) -> bool:
    pool = await get_pool()
    if not pool:
        return False
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO trades (id, symbol, direction, status, pnl, rr, raw, closed_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
                ON CONFLICT (id) DO UPDATE SET
                  pnl = EXCLUDED.pnl,
                  status = EXCLUDED.status,
                  rr = EXCLUDED.rr,
                  raw = EXCLUDED.raw
                """,
                str(trade.get("id") or trade.get("order_id") or ""),
                trade.get("symbol") or "XRPUSDT",
                trade.get("direction"),
                trade.get("status"),
                float(trade.get("pnl") or 0),
                str(trade.get("rr") or ""),
                json.dumps(trade, default=str),
                _as_dt(trade.get("date")),
            )
        return True
    except Exception as e:
        print(f"[DB] save_trade: {e}")
        return False


async def save_signal(sig: dict) -> bool:
    pool = await get_pool()
    if not pool:
        return False
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO signals_log
                  (id, symbol, direction, entry, tp, sl, be, status, executed, last_error, raw)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
                ON CONFLICT (id) DO UPDATE SET
                  status = EXCLUDED.status,
                  executed = EXCLUDED.executed,
                  last_error = EXCLUDED.last_error,
                  raw = EXCLUDED.raw
                """,
                str(sig.get("id") or ""),
                sig.get("symbol") or "XRPUSDT",
                sig.get("direction"),
                float(sig.get("entry") or 0),
                float(sig.get("tp") or 0),
                float(sig.get("sl") or 0),
                float(sig.get("be") or 0),
                sig.get("status"),
                bool(sig.get("executed")),
                sig.get("last_error") or sig.get("lastError") or "",
                json.dumps(sig, default=str),
            )
        return True
    except Exception as e:
        print(f"[DB] save_signal: {e}")
        return False


async def save_equity(equity: float, available: float, open_positions: int = 0) -> bool:
    pool = await get_pool()
    if not pool:
        return False
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO equity_snapshots (equity, available, open_positions, source)
                VALUES ($1,$2,$3,'bybit')
                """,
                float(equity), float(available), int(open_positions),
            )
        return True
    except Exception as e:
        print(f"[DB] save_equity: {e}")
        return False


async def save_settings(settings: dict) -> bool:
    pool = await get_pool()
    if not pool:
        return False
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO app_settings (key, value, updated_at)
                VALUES ('runtime', $1::jsonb, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
                """,
                json.dumps(settings),
            )
        return True
    except Exception as e:
        print(f"[DB] save_settings: {e}")
        return False


async def load_settings() -> Optional[dict]:
    pool = await get_pool()
    if not pool:
        return None
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT value FROM app_settings WHERE key = 'runtime'"
            )
            if not row:
                return None
            val = row["value"]
            return val if isinstance(val, dict) else json.loads(val)
    except Exception as e:
        print(f"[DB] load_settings: {e}")
        return None


async def list_trades(symbol: str = "XRPUSDT", limit: int = 100) -> list[dict]:
    pool = await get_pool()
    if not pool:
        return []
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, symbol, direction, status, pnl, rr, closed_at, raw
                FROM trades
                WHERE symbol = $1
                ORDER BY closed_at DESC NULLS LAST
                LIMIT $2
                """,
                symbol, limit,
            )
        out = []
        for r in rows:
            raw = r["raw"] if isinstance(r["raw"], dict) else {}
            out.append({
                "id": r["id"],
                "symbol": r["symbol"],
                "direction": r["direction"],
                "status": r["status"],
                "pnl": r["pnl"],
                "rr": r["rr"],
                "date": r["closed_at"].isoformat() if r["closed_at"] else None,
                **({} if not raw else {}),
            })
        return out
    except Exception as e:
        print(f"[DB] list_trades: {e}")
        return []


async def db_status() -> dict[str, Any]:
    url = database_url()
    if not url:
        return {"configured": False, "connected": False}
    pool = await get_pool()
    return {"configured": True, "connected": pool is not None}


async def upsert_position_state(state: dict) -> bool:
    """Persist BE-monitor fields so deploys do not wipe peak / orig_risk."""
    pool = await get_pool()
    if not pool:
        return False
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO position_state
                  (symbol, direction, entry, tp, sl, orig_risk, peak_favorable, be_moved, signal_id, updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW())
                ON CONFLICT (symbol) DO UPDATE SET
                  direction = EXCLUDED.direction,
                  entry = EXCLUDED.entry,
                  tp = COALESCE(EXCLUDED.tp, position_state.tp),
                  sl = EXCLUDED.sl,
                  orig_risk = COALESCE(EXCLUDED.orig_risk, position_state.orig_risk),
                  peak_favorable = EXCLUDED.peak_favorable,
                  be_moved = EXCLUDED.be_moved OR position_state.be_moved,
                  signal_id = COALESCE(EXCLUDED.signal_id, position_state.signal_id),
                  updated_at = NOW()
                """,
                str(state.get("symbol") or "XRPUSDT"),
                state.get("direction"),
                float(state.get("entry") or 0) or None,
                float(state.get("tp") or 0) or None,
                float(state.get("sl") or 0) or None,
                float(state["orig_risk"]) if state.get("orig_risk") not in (None, "") else None,
                float(state["peak_favorable"]) if state.get("peak_favorable") not in (None, "") else None,
                bool(state.get("be_moved")),
                state.get("signal_id"),
            )
        return True
    except Exception as e:
        print(f"[DB] upsert_position_state: {e}")
        return False


async def load_position_states() -> dict:
    """symbol -> row dict"""
    pool = await get_pool()
    if not pool:
        return {}
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM position_state")
        out = {}
        for r in rows:
            out[r["symbol"]] = dict(r)
        return out
    except Exception as e:
        print(f"[DB] load_position_states: {e}")
        return {}


async def clear_position_state(symbol: str) -> bool:
    pool = await get_pool()
    if not pool:
        return False
    try:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM position_state WHERE symbol = $1", symbol)
        return True
    except Exception as e:
        print(f"[DB] clear_position_state: {e}")
        return False


async def load_recent_signals(limit: int = 50) -> list:
    pool = await get_pool()
    if not pool:
        return []
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT raw FROM signals_log
                ORDER BY created_at DESC
                LIMIT $1
                """,
                limit,
            )
        out = []
        for r in rows:
            raw = r["raw"]
            if isinstance(raw, str):
                try:
                    raw = json.loads(raw)
                except Exception:
                    continue
            if isinstance(raw, dict):
                out.append(raw)
        return out
    except Exception as e:
        print(f"[DB] load_recent_signals: {e}")
        return []
