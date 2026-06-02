"""
SmartEdge Trader — Live Signal Engine
VWAP + ORB + ATR + ML Filter
Runs on a background scheduler, pushes signals via WebSocket
"""

import asyncio
import httpx
import numpy as np
import uuid
import os
import hmac
import hashlib
import time
import json
from datetime import datetime, timezone
from dataclasses import dataclass, field, asdict
from typing import Optional

DEMO_BASE  = "https://api-demo.bybit.com"
API_KEY    = os.getenv("BYBIT_API_KEY", "")
API_SECRET = os.getenv("BYBIT_API_SECRET", "")

# ── Symbols to scan ───────────────────────────────────────────────
CRYPTO_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT",
    "BNBUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT",
]
FOREX_SYMBOLS = []   # Bybit demo doesn't support forex CFDs
ALL_SYMBOLS   = CRYPTO_SYMBOLS

# ── Signal dataclass ──────────────────────────────────────────────
@dataclass
class Signal:
    id:          str
    symbol:      str
    direction:   str      # LONG | SHORT
    entry:       float
    tp:          float
    sl:          float
    be:          float
    rr:          str
    ml_score:    float
    confidence:  int
    status:      str      # ACTIVE | PENDING | WATCH
    timeframe:   str
    market:      str
    vwap_above:  bool
    orb_break:   bool
    regime:      str      # TRENDING | RANGING
    atr:         float
    timestamp:   str
    expires_at:  str      # signals expire after 4 hours


# ── HTTP helper ───────────────────────────────────────────────────
async def bybit_get(path: str, params: dict = {}) -> dict:
    ts          = str(int(time.time() * 1000))
    recv_window = "5000"
    param_str   = ts + API_KEY + recv_window + "&".join(
        f"{k}={v}" for k, v in sorted(params.items())
    )
    signature = hmac.new(
        API_SECRET.encode(), param_str.encode(), hashlib.sha256
    ).hexdigest()
    headers = {
        "X-BAPI-API-KEY":     API_KEY,
        "X-BAPI-TIMESTAMP":   ts,
        "X-BAPI-SIGN":        signature,
        "X-BAPI-RECV-WINDOW": recv_window,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{DEMO_BASE}{path}", params=params, headers=headers)
        return r.json()


async def bybit_public_get(path: str, params: dict = {}) -> dict:
    """Public endpoint — no auth needed for market data"""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"https://api.bybit.com{path}", params=params)
        return r.json()


# ── OHLCV fetcher ─────────────────────────────────────────────────
async def fetch_candles(symbol: str, interval: str = "15", limit: int = 100) -> list[dict]:
    """Fetch OHLCV candles from Bybit public API"""
    try:
        data = await bybit_public_get("/v5/market/kline", {
            "category": "linear",
            "symbol":   symbol,
            "interval": interval,
            "limit":    str(limit),
        })
        if data.get("retCode") != 0:
            return []
        candles = []
        for c in reversed(data["result"]["list"]):
            candles.append({
                "timestamp": int(c[0]),
                "open":      float(c[1]),
                "high":      float(c[2]),
                "low":       float(c[3]),
                "close":     float(c[4]),
                "volume":    float(c[5]),
            })
        return candles
    except Exception as e:
        print(f"[CANDLES] {symbol} error: {e}")
        return []


# ── Technical Indicators ──────────────────────────────────────────
def calc_vwap(candles: list[dict]) -> float:
    """Session VWAP from available candles"""
    cum_pv = 0.0
    cum_v  = 0.0
    for c in candles:
        tp     = (c["high"] + c["low"] + c["close"]) / 3
        cum_pv += tp * c["volume"]
        cum_v  += c["volume"]
    return cum_pv / cum_v if cum_v > 0 else 0


def calc_atr(candles: list[dict], period: int = 14) -> float:
    """Average True Range"""
    if len(candles) < 2:
        return 0
    trs = []
    for i in range(1, min(period + 1, len(candles))):
        c  = candles[-i]
        p  = candles[-i - 1]
        tr = max(
            c["high"] - c["low"],
            abs(c["high"] - p["close"]),
            abs(c["low"]  - p["close"]),
        )
        trs.append(tr)
    return float(np.mean(trs)) if trs else 0


def calc_orb(candles: list[dict], orb_candles: int = 1) -> tuple[float, float]:
    """Opening Range High/Low from first N candles"""
    if not candles:
        return 0, 0
    orb = candles[:orb_candles]
    return max(c["high"] for c in orb), min(c["low"] for c in orb)


def detect_regime(candles: list[dict]) -> str:
    """TRENDING or RANGING based on directional vs total movement"""
    if len(candles) < 10:
        return "RANGING"
    closes      = [c["close"] for c in candles]
    highs       = [c["high"]  for c in candles]
    lows        = [c["low"]   for c in candles]
    price_move  = abs(closes[-1] - closes[0])
    avg_range   = np.mean([h - l for h, l in zip(highs, lows)])
    total_range = avg_range * len(candles)
    ratio       = price_move / total_range if total_range > 0 else 0
    return "TRENDING" if ratio > 0.25 else "RANGING"


def ml_score(features: dict) -> float:
    """
    Weighted ML score (0–1).
    Production: replace with loaded XGBoost model.
    """
    score = 0.0

    # Volume confirmation (high vol = institutional interest)
    vol_ratio = features.get("vol_ratio", 1.0)
    score += min(vol_ratio / 2.5, 1.0) * 0.25

    # ORB breakout confirmed
    score += (1.0 if features.get("orb_break") else 0.2) * 0.20

    # Trend regime
    score += (0.9 if features.get("regime") == "TRENDING" else 0.3) * 0.20

    # VWAP alignment
    score += (1.0 if features.get("vwap_aligned") else 0.2) * 0.15

    # ATR not too small (liquid market)
    atr_pct = features.get("atr_pct", 0.5)
    score += min(atr_pct / 1.0, 1.0) * 0.10

    # Candle momentum
    momentum = features.get("momentum", 0.5)
    score += momentum * 0.10

    return round(min(max(score, 0.0), 1.0), 3)


def is_trading_window() -> bool:
    """Only trade during high-liquidity windows (UTC)"""
    now  = datetime.now(timezone.utc)
    hour = now.hour

    # London session:     08:00–11:00 UTC
    # NY session:         13:30–16:30 UTC
    # London/NY overlap:  13:30–16:30 UTC (best)
    london = 8  <= hour < 11
    ny     = 13 <= hour < 17
    return london or ny


# ── Signal Generator ──────────────────────────────────────────────
async def scan_symbol(symbol: str, threshold: float = 0.65) -> Optional[Signal]:
    """
    Full signal scan pipeline for one symbol:
    1. Fetch candles
    2. Calculate VWAP, ATR, ORB
    3. Check breakout + VWAP filter
    4. ML score
    5. Return Signal if passes threshold
    """
    candles = await fetch_candles(symbol, interval="15", limit=100)
    if len(candles) < 20:
        return None

    price  = candles[-1]["close"]
    vwap   = calc_vwap(candles)
    atr    = calc_atr(candles)
    regime = detect_regime(candles)

    # ORB from first candle of current session
    orb_high, orb_low = calc_orb(candles[-96:], orb_candles=1)

    # Direction from ORB breakout
    if price > orb_high * 1.0005:        # 0.05% buffer
        direction = "LONG"
        orb_break = True
    elif price < orb_low * 0.9995:
        direction = "SHORT"
        orb_break = True
    else:
        return None                       # No breakout

    # VWAP filter
    vwap_above = price > vwap
    if direction == "LONG"  and not vwap_above: return None
    if direction == "SHORT" and     vwap_above: return None

    # Skip ranging markets
    if regime == "RANGING":
        return None

    # Calculate levels
    if direction == "LONG":
        sl  = price - (1.5 * atr)
        tp  = price + (4.5 * atr)
        be  = price + (1.5 * atr)
    else:
        sl  = price + (1.5 * atr)
        tp  = price - (4.5 * atr)
        be  = price - (1.5 * atr)

    risk = abs(price - sl)
    rr   = abs(tp - price) / risk if risk > 0 else 0

    # Skip if RR too low
    if rr < 2.5:
        return None

    # Volume momentum
    recent_vol = np.mean([c["volume"] for c in candles[-5:]])
    avg_vol    = np.mean([c["volume"] for c in candles[-20:]])
    vol_ratio  = recent_vol / avg_vol if avg_vol > 0 else 1.0

    # Candle momentum (close position in candle body)
    last   = candles[-1]
    c_range = last["high"] - last["low"]
    if c_range > 0:
        momentum = (last["close"] - last["low"]) / c_range \
            if direction == "LONG" \
            else (last["high"] - last["close"]) / c_range
    else:
        momentum = 0.5

    atr_pct = (atr / price) * 100 if price > 0 else 0

    features = {
        "vol_ratio":    vol_ratio,
        "orb_break":    orb_break,
        "regime":       regime,
        "vwap_aligned": True,
        "atr_pct":      atr_pct,
        "momentum":     momentum,
    }

    score      = ml_score(features)
    confidence = int(score * 100)

    if score < threshold:
        return None

    # Status based on score
    if score >= 0.78:
        status = "ACTIVE"
    elif score >= 0.65:
        status = "PENDING"
    else:
        status = "WATCH"

    now        = datetime.now(timezone.utc)
    expires_at = datetime.fromtimestamp(
        now.timestamp() + 4 * 3600, tz=timezone.utc
    ).isoformat()

    return Signal(
        id          = str(uuid.uuid4()),
        symbol      = f"{symbol[:3]}/{symbol[3:]}",
        direction   = direction,
        entry       = round(price, 6),
        tp          = round(tp, 6),
        sl          = round(sl, 6),
        be          = round(be, 6),
        rr          = f"1:{rr:.1f}",
        ml_score    = score,
        confidence  = confidence,
        status      = status,
        timeframe   = "15M",
        market      = "crypto",
        vwap_above  = vwap_above,
        orb_break   = orb_break,
        regime      = regime,
        atr         = round(atr, 6),
        timestamp   = now.isoformat(),
        expires_at  = expires_at,
    )


# ── Signal Manager ────────────────────────────────────────────────
class SignalEngine:
    def __init__(self):
        self.signals:   list[Signal] = []
        self.threshold: float        = float(os.getenv("ML_THRESHOLD", "0.65"))
        self.running:   bool         = False
        self.broadcast_cb            = None   # set by main.py

    def set_broadcast(self, cb):
        self.broadcast_cb = cb

    def get_active(self) -> list[dict]:
        now = datetime.now(timezone.utc).isoformat()
        # Remove expired signals
        self.signals = [
            s for s in self.signals
            if s.expires_at > now
        ]
        return [asdict(s) for s in self.signals]

    async def scan_all(self):
        """Scan all symbols and update signal list"""
        print(f"[ENGINE] Scanning {len(ALL_SYMBOLS)} symbols...")
        results = await asyncio.gather(
            *[scan_symbol(sym, self.threshold) for sym in ALL_SYMBOLS],
            return_exceptions=True
        )
        new_signals = []
        for r in results:
            if isinstance(r, Signal):
                new_signals.append(r)

        # Merge: keep existing signals not in new scan, add new ones
        existing_symbols = {s.symbol for s in new_signals}
        kept = [s for s in self.signals if s.symbol not in existing_symbols]
        self.signals = kept + new_signals

        print(f"[ENGINE] {len(new_signals)} new signals | {len(self.signals)} total active")

        # Broadcast to WebSocket clients
        if self.broadcast_cb and new_signals:
            await self.broadcast_cb({
                "type":    "signal_update",
                "signals": [asdict(s) for s in self.signals],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

    async def run(self):
        """Background loop — scans every 15 minutes"""
        self.running = True
        print("[ENGINE] Signal engine started")
        while self.running:
            try:
                await self.scan_all()
            except Exception as e:
                print(f"[ENGINE] Scan error: {e}")
            # Wait 15 minutes between full scans
            await asyncio.sleep(900)

    def stop(self):
        self.running = False


# Global instance
signal_engine = SignalEngine()
