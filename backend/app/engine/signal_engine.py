"""
SmartEdge Trader — Signal Engine
XRPUSDT only. Validated config (Jan–Jun 2026 1H backtest):
  SMA(50)/SMA(200) trend + body-ratio > 0.789 entry
  SL 1.5×ATR / TP 4.5×ATR / BE at +2.0R
  Skip when ATR% > 60th percentile of trailing 720h
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Optional

import httpx
import numpy as np

from app import db, telegram_notify
from app.bybit_client import bybit_get

ALL_SYMBOLS = ["XRPUSDT"]
SYMBOL_DISPLAY = {"XRPUSDT": "XRP/USDT"}

STRATEGY_PARAMS = {
    "XRPUSDT": {
        "trend_fast": 50,
        "trend_slow": 200,
        "entry": "body_ratio",
        "body_ratio_min": 0.789,
    },
}

ATR_PERIOD = 14
SL_ATR_MULT = 1.5
TP_ATR_MULT = 4.5
BE_TRIGGER_R = 2.0
VOL_LOOKBACK_H = 720
VOL_EXCLUDE_ABOVE_PCTL = 60


@dataclass
class Signal:
    id: str
    symbol: str
    direction: str
    entry: float
    tp: float
    sl: float
    be: float
    rr: str
    status: str
    timeframe: str
    market: str
    trend: str
    entry_trigger: str
    vol_ok: bool
    atr: float
    timestamp: str
    expires_at: str
    executed: bool = False
    last_error: str = ""


def _raw_symbol(sym: str) -> str:
    return (sym or "").replace("/", "").upper()


async def fetch_candles(symbol: str, interval: str = "60", limit: int = 1000) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                "https://api.bybit.com/v5/market/kline",
                params={
                    "category": "linear",
                    "symbol": symbol,
                    "interval": interval,
                    "limit": str(limit),
                },
            )
            data = r.json()
        if data.get("retCode") != 0:
            return []
        candles = []
        for c in reversed(data["result"]["list"]):
            candles.append({
                "timestamp": int(c[0]),
                "open": float(c[1]),
                "high": float(c[2]),
                "low": float(c[3]),
                "close": float(c[4]),
                "volume": float(c[5]),
            })
        return candles
    except Exception as e:
        print(f"[CANDLES] {symbol}: {e}")
        return []


def sma(values: list[float], period: int) -> Optional[float]:
    if len(values) < period:
        return None
    return float(np.mean(values[-period:]))


def wilder_atr_series(candles: list[dict], period: int = ATR_PERIOD) -> list:
    n = len(candles)
    if n < 2:
        return [None] * n
    trs = [None]
    for i in range(1, n):
        h, l, pc = candles[i]["high"], candles[i]["low"], candles[i - 1]["close"]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    atr = [None] * n
    if n <= period:
        return atr
    atr[period] = float(np.mean(trs[1:period + 1]))
    for i in range(period + 1, n):
        atr[i] = (atr[i - 1] * (period - 1) + trs[i]) / period
    return atr


def body_ratio(c: dict) -> float:
    rng = c["high"] - c["low"]
    return abs(c["close"] - c["open"]) / rng if rng > 0 else 0.0


def candle_direction(c: dict) -> int:
    return 1 if c["close"] > c["open"] else (-1 if c["close"] < c["open"] else 0)


def atr_percentile(atr_pct_series: list, lookback: int = VOL_LOOKBACK_H) -> Optional[float]:
    window = [v for v in atr_pct_series[-lookback:] if v is not None]
    if len(window) < 168:
        return None
    current = window[-1]
    return float(sum(1 for v in window if v <= current) / len(window) * 100)


async def open_position_symbols() -> set[str]:
    """Raw symbols (e.g. XRPUSDT) that currently have size > 0."""
    try:
        data = await bybit_get(
            "/v5/position/list",
            {"category": "linear", "settleCoin": "USDT"},
        )
        if data.get("retCode") != 0:
            return set()
        out = set()
        for p in data.get("result", {}).get("list") or []:
            if float(p.get("size") or 0) > 0:
                out.add(_raw_symbol(p.get("symbol") or ""))
        return out
    except Exception as e:
        print(f"[ENGINE] open_position_symbols: {e}")
        return set()


async def scan_symbol(symbol: str) -> Optional[Signal]:
    params = STRATEGY_PARAMS[symbol]
    candles = await fetch_candles(symbol, interval="60", limit=1000)
    min_needed = max(params["trend_slow"], VOL_LOOKBACK_H) + 5
    if len(candles) < min_needed:
        print(f"[SCAN] {symbol}: only {len(candles)} candles, need {min_needed}")
        return None

    closes = [c["close"] for c in candles]
    price = closes[-1]

    sma_fast = sma(closes, params["trend_fast"])
    sma_slow = sma(closes, params["trend_slow"])
    if sma_fast is None or sma_slow is None:
        return None
    trend_bull = sma_fast > sma_slow
    trend = "BULL" if trend_bull else "BEAR"

    atr_series = wilder_atr_series(candles, ATR_PERIOD)
    atr = atr_series[-1]
    if atr is None or atr <= 0:
        return None
    atr_pct_series = [(a / c) if a is not None else None for a, c in zip(atr_series, closes)]
    vol_pctl = atr_percentile(atr_pct_series)
    vol_ok = (vol_pctl is None) or (vol_pctl <= VOL_EXCLUDE_ABOVE_PCTL)

    last = candles[-1]
    direction_candle = candle_direction(last)
    br = body_ratio(last)
    triggered_long = trend_bull and direction_candle > 0 and br > params["body_ratio_min"]
    triggered_short = (not trend_bull) and direction_candle < 0 and br > params["body_ratio_min"]
    trigger_desc = f"body-ratio {br:.3f} > {params['body_ratio_min']}"

    if not vol_ok or not (triggered_long or triggered_short):
        print(
            f"[SCAN] {symbol}: trend={trend} vol_ok={vol_ok} "
            f"({'-' if vol_pctl is None else f'{vol_pctl:.0f}pctl'}) no entry"
        )
        return None

    direction = "LONG" if triggered_long else "SHORT"
    if direction == "LONG":
        sl = price - SL_ATR_MULT * atr
        tp = price + TP_ATR_MULT * atr
        be = price + BE_TRIGGER_R * SL_ATR_MULT * atr
    else:
        sl = price + SL_ATR_MULT * atr
        tp = price - TP_ATR_MULT * atr
        be = price - BE_TRIGGER_R * SL_ATR_MULT * atr

    rr = TP_ATR_MULT / SL_ATR_MULT
    print(
        f"[SCAN] {symbol}: {direction} price={price:.4f} trend={trend} "
        f"trigger=({trigger_desc}) SL={sl:.6f} TP={tp:.6f} BE@{BE_TRIGGER_R}R"
    )

    now = datetime.now(timezone.utc)
    expires_at = datetime.fromtimestamp(now.timestamp() + 3600, tz=timezone.utc).isoformat()

    return Signal(
        id=str(uuid.uuid4()),
        symbol=SYMBOL_DISPLAY.get(symbol, symbol),
        direction=direction,
        entry=round(price, 6),
        tp=round(tp, 6),
        sl=round(sl, 6),
        be=round(be, 6),
        rr=f"1:{rr:.1f}",
        status="ACTIVE",
        timeframe="1H",
        market="crypto",
        trend=trend,
        entry_trigger=trigger_desc,
        vol_ok=vol_ok,
        atr=round(atr, 6),
        timestamp=now.isoformat(),
        expires_at=expires_at,
    )


class SignalEngine:
    def __init__(self):
        self.signals = []
        self.running = False
        self.broadcast_cb = None
        self.last_scan_at = None
        self.last_scan_result = None

    def set_broadcast(self, cb):
        self.broadcast_cb = cb

    def get_active(self):
        now = datetime.now(timezone.utc).isoformat()
        self.signals = [s for s in self.signals if s.executed or s.expires_at > now]
        return [asdict(s) for s in self.signals]

    def mark_executed(self, signal_id: str):
        for s in self.signals:
            if s.id == signal_id:
                s.executed = True
                s.last_error = ""
                return True
        return False

    def set_error(self, signal_id: str, message: str):
        for s in self.signals:
            if s.id == signal_id:
                s.last_error = (message or "")[:240]
                return True
        return False

    def clear_error(self, signal_id: str):
        for s in self.signals:
            if s.id == signal_id:
                s.last_error = ""
                return True
        return False

    def clear_executed_if_closed(self, open_symbols_raw: set):
        before = len(self.signals)
        self.signals = [
            s for s in self.signals
            if not s.executed or _raw_symbol(s.symbol) in open_symbols_raw
        ]
        if len(self.signals) != before:
            print(f"[ENGINE] Cleared {before - len(self.signals)} closed position signal(s)")

    async def scan_all(self):
        print(f"[ENGINE] Scanning {ALL_SYMBOLS} (1H)")
        results = await asyncio.gather(
            *[scan_symbol(sym) for sym in ALL_SYMBOLS],
            return_exceptions=True,
        )
        for r in results:
            if isinstance(r, Exception):
                print(f"[ENGINE] scan error: {r}")

        candidates = [r for r in results if isinstance(r, Signal)]
        open_syms = await open_position_symbols()

        allowed, blocked = [], []
        for ns in candidates:
            if _raw_symbol(ns.symbol) in open_syms:
                blocked.append(ns)
            else:
                allowed.append(ns)

        if blocked:
            print(
                f"[ENGINE] Suppressing {len(blocked)} signal(s) for open position(s) "
                f"{[_raw_symbol(s.symbol) for s in blocked]} — no Telegram until flat"
            )

        new_signals = allowed
        existing = {s.symbol for s in new_signals}
        self.signals = [
            s for s in self.signals
            if s.symbol not in existing or s.executed
        ] + [
            ns for ns in new_signals
            if not any(s.symbol == ns.symbol and s.executed for s in self.signals)
        ]
        # Drop idle signals for pairs that are already in a trade
        self.signals = [
            s for s in self.signals
            if s.executed or _raw_symbol(s.symbol) not in open_syms
        ]

        print(f"[ENGINE] {len(new_signals)} new | {len(self.signals)} active")
        self.last_scan_at = datetime.now(timezone.utc).isoformat()
        self.last_scan_result = f"{len(new_signals)} new, {len(self.signals)} active"

        for ns in new_signals:
            try:
                await db.save_signal(asdict(ns))
            except Exception as e:
                print(f"[ENGINE] save_signal: {e}")
            # Telegram only when flat on that pair (already filtered; re-check)
            if _raw_symbol(ns.symbol) in open_syms:
                print(f"[ENGINE] skip Telegram {_raw_symbol(ns.symbol)}: position open")
                continue
            try:
                await telegram_notify.notify_signal(asdict(ns))
            except Exception as e:
                print(f"[ENGINE] telegram: {e}")

        if self.broadcast_cb:
            await self.broadcast_cb({
                "type": "signal_update",
                "signals": [asdict(s) for s in self.signals],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

    async def run(self):
        self.running = True
        print("[ENGINE] Started — XRPUSDT only | SL 1.5×ATR | TP 4.5×ATR | BE @ 2.0R")
        try:
            rows = await db.load_recent_signals(30)
            restored = []
            for raw in rows:
                if not raw or raw.get("executed"):
                    continue
                if raw.get("status") not in (None, "ACTIVE"):
                    continue
                try:
                    restored.append(
                        Signal(**{k: raw[k] for k in Signal.__dataclass_fields__ if k in raw})
                    )
                except Exception:
                    continue
            if restored:
                by_sym = {}
                for s in restored:
                    by_sym[s.symbol] = s
                self.signals = list(by_sym.values())
                print(f"[ENGINE] Restored {len(self.signals)} signal(s) from DB")
        except Exception as e:
            print(f"[ENGINE] restore signals: {e}")

        while self.running:
            try:
                await self.scan_all()
            except Exception as e:
                print(f"[ENGINE] Error: {e}")
            await asyncio.sleep(300)

    def stop(self):
        self.running = False


signal_engine = SignalEngine()
