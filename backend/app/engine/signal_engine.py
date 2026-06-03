"""
SmartEdge Trader — Live Signal Engine
Debug mode: verbose rejection logging
"""

import asyncio, httpx, numpy as np, uuid, os, time, json
from datetime import datetime, timezone
from dataclasses import dataclass, asdict
from typing import Optional

API_KEY    = os.getenv("BYBIT_API_KEY", "")
API_SECRET = os.getenv("BYBIT_API_SECRET", "")

ALL_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT",
    "BNBUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT",
]

@dataclass
class Signal:
    id: str; symbol: str; direction: str
    entry: float; tp: float; sl: float; be: float
    rr: str; ml_score: float; confidence: int
    status: str; timeframe: str; market: str
    vwap_above: bool; orb_break: bool; regime: str
    atr: float; timestamp: str; expires_at: str

async def bybit_public_get(path: str, params: dict = {}) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"https://api.bybit.com{path}", params=params)
        return r.json()

async def fetch_candles(symbol: str, interval: str = "15", limit: int = 100) -> list[dict]:
    try:
        data = await bybit_public_get("/v5/market/kline", {
            "category": "linear", "symbol": symbol,
            "interval": interval, "limit": str(limit),
        })
        if data.get("retCode") != 0:
            print(f"[CANDLES] {symbol} API error: {data.get('retMsg')}")
            return []
        candles = []
        for c in reversed(data["result"]["list"]):
            candles.append({
                "timestamp": int(c[0]), "open": float(c[1]),
                "high": float(c[2]), "low": float(c[3]),
                "close": float(c[4]), "volume": float(c[5]),
            })
        return candles
    except Exception as e:
        print(f"[CANDLES] {symbol}: {e}")
        return []

def calc_vwap(candles):
    cum_pv = cum_v = 0.0
    for c in candles:
        tp = (c["high"] + c["low"] + c["close"]) / 3
        cum_pv += tp * c["volume"]; cum_v += c["volume"]
    return cum_pv / cum_v if cum_v > 0 else 0

def calc_atr(candles, period=14):
    if len(candles) < 2: return 0
    trs = []
    for i in range(1, min(period + 1, len(candles))):
        c = candles[-i]; p = candles[-i - 1]
        trs.append(max(c["high"]-c["low"], abs(c["high"]-p["close"]), abs(c["low"]-p["close"])))
    return float(np.mean(trs)) if trs else 0

def detect_regime(candles):
    if len(candles) < 10: return "RANGING"
    closes = [c["close"] for c in candles]
    highs  = [c["high"]  for c in candles]
    lows   = [c["low"]   for c in candles]
    move   = abs(closes[-1] - closes[0])
    avg_r  = np.mean([h - l for h, l in zip(highs, lows)])
    ratio  = move / (avg_r * len(candles)) if avg_r > 0 else 0
    return "TRENDING" if ratio > 0.15 else "RANGING"

def ml_score(features):
    score  = min(features.get("vol_ratio", 1.0) / 2.5, 1.0) * 0.25
    score += (1.0 if features.get("orb_break")  else 0.2) * 0.20
    score += (0.9 if features.get("regime") == "TRENDING" else 0.4) * 0.20
    score += (1.0 if features.get("vwap_aligned") else 0.2) * 0.15
    score += min(features.get("atr_pct", 0.5), 1.0) * 0.10
    score += features.get("momentum", 0.5) * 0.10
    return round(min(max(score, 0.0), 1.0), 3)

async def scan_symbol(symbol: str, threshold: float = 0.60) -> Optional[Signal]:
    candles = await fetch_candles(symbol, interval="15", limit=100)
    if len(candles) < 20:
        print(f"[SCAN] {symbol}: not enough candles ({len(candles)})")
        return None

    price     = candles[-1]["close"]
    vwap      = calc_vwap(candles)
    atr       = calc_atr(candles)
    regime    = detect_regime(candles)
    orb_high  = candles[0]["high"]
    orb_low   = candles[0]["low"]

    print(f"[SCAN] {symbol}: price={price:.4f} vwap={vwap:.4f} atr={atr:.4f} "
          f"orb_h={orb_high:.4f} orb_l={orb_low:.4f} regime={regime}")

    # Direction
    if price > orb_high * 1.0003:
        direction = "LONG"; orb_break = True
    elif price < orb_low * 0.9997:
        direction = "SHORT"; orb_break = True
    else:
        print(f"[SCAN] {symbol}: NO ORB BREAK (price between {orb_low:.4f}–{orb_high:.4f})")
        return None

    # VWAP filter
    vwap_above = price > vwap
    if direction == "LONG" and not vwap_above:
        print(f"[SCAN] {symbol}: REJECTED — LONG but price below VWAP")
        return None
    if direction == "SHORT" and vwap_above:
        print(f"[SCAN] {symbol}: REJECTED — SHORT but price above VWAP")
        return None

    # Levels
    if direction == "LONG":
        sl = price - 1.5 * atr; tp = price + 4.5 * atr; be = price + 1.5 * atr
    else:
        sl = price + 1.5 * atr; tp = price - 4.5 * atr; be = price - 1.5 * atr

    risk = abs(price - sl)
    rr   = abs(tp - price) / risk if risk > 0 else 0
    if rr < 1.5:
        print(f"[SCAN] {symbol}: REJECTED — RR too low ({rr:.2f})")
        return None

    recent_vol = np.mean([c["volume"] for c in candles[-5:]])
    avg_vol    = np.mean([c["volume"] for c in candles[-20:]])
    vol_ratio  = recent_vol / avg_vol if avg_vol > 0 else 1.0
    last       = candles[-1]
    c_range    = last["high"] - last["low"]
    momentum   = ((last["close"] - last["low"]) / c_range if direction == "LONG"
                  else (last["high"] - last["close"]) / c_range) if c_range > 0 else 0.5
    atr_pct    = (atr / price) * 100 if price > 0 else 0

    features = {
        "vol_ratio": vol_ratio, "orb_break": orb_break,
        "regime": regime, "vwap_aligned": True,
        "atr_pct": atr_pct, "momentum": momentum,
    }
    score      = ml_score(features)
    confidence = int(score * 100)

    print(f"[SCAN] {symbol}: {direction} | RR=1:{rr:.1f} | ML={confidence}% | regime={regime}")

    if score < threshold:
        print(f"[SCAN] {symbol}: REJECTED — ML score too low ({confidence}% < {int(threshold*100)}%)")
        return None

    status     = "ACTIVE" if score >= 0.75 else "PENDING"
    now        = datetime.now(timezone.utc)
    expires_at = datetime.fromtimestamp(now.timestamp() + 4*3600, tz=timezone.utc).isoformat()

    return Signal(
        id=str(uuid.uuid4()), symbol=f"{symbol[:3]}/{symbol[3:]}",
        direction=direction, entry=round(price,6),
        tp=round(tp,6), sl=round(sl,6), be=round(be,6),
        rr=f"1:{rr:.1f}", ml_score=score, confidence=confidence,
        status=status, timeframe="15M", market="crypto",
        vwap_above=vwap_above, orb_break=orb_break, regime=regime,
        atr=round(atr,6), timestamp=now.isoformat(), expires_at=expires_at,
    )

class SignalEngine:
    def __init__(self):
        self.signals    = []
        self.threshold  = float(os.getenv("ML_THRESHOLD", "0.60"))
        self.running    = False
        self.broadcast_cb = None

    def set_broadcast(self, cb): self.broadcast_cb = cb

    def get_active(self):
        now = datetime.now(timezone.utc).isoformat()
        self.signals = [s for s in self.signals if s.expires_at > now]
        return [asdict(s) for s in self.signals]

    async def scan_all(self):
        print(f"[ENGINE] Scanning {len(ALL_SYMBOLS)} symbols... threshold={int(self.threshold*100)}%")
        results = await asyncio.gather(
            *[scan_symbol(sym, self.threshold) for sym in ALL_SYMBOLS],
            return_exceptions=True
        )
        new_signals = [r for r in results if isinstance(r, Signal)]
        existing    = {s.symbol for s in new_signals}
        self.signals = [s for s in self.signals if s.symbol not in existing] + new_signals
        print(f"[ENGINE] ✅ {len(new_signals)} new signals | {len(self.signals)} total active")
        if self.broadcast_cb and new_signals:
            await self.broadcast_cb({
                "type": "signal_update",
                "signals": [asdict(s) for s in self.signals],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

    async def run(self):
        self.running = True
        print("[ENGINE] Started — trading hours filter DISABLED — scanning every 5 min")
        while self.running:
            try: await self.scan_all()
            except Exception as e: print(f"[ENGINE] Error: {e}")
            await asyncio.sleep(300)  # 5 min for testing

    def stop(self): self.running = False

signal_engine = SignalEngine()
