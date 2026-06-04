"""
SmartEdge Trader — Live Signal Engine
Fixes: symbol names, ORB session candle, regime tuning
"""

import asyncio, httpx, numpy as np, uuid, os
from datetime import datetime, timezone
from dataclasses import dataclass, asdict
from typing import Optional

API_KEY    = os.getenv("BYBIT_API_KEY", "")
API_SECRET = os.getenv("BYBIT_API_SECRET", "")

ALL_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT",
    "BNBUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT",
]

# Correct display names
SYMBOL_DISPLAY = {
    "BTCUSDT":  "BTC/USDT",
    "ETHUSDT":  "ETH/USDT",
    "SOLUSDT":  "SOL/USDT",
    "XRPUSDT":  "XRP/USDT",
    "BNBUSDT":  "BNB/USDT",
    "DOGEUSDT": "DOGE/USDT",
    "AVAXUSDT": "AVAX/USDT",
    "LINKUSDT": "LINK/USDT",
}

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

def get_session_orb(candles: list[dict]) -> tuple[float, float]:
    """
    ORB = first candle of today's NY session (14:30 UTC).
    Falls back to first candle of London session (08:00 UTC).
    Falls back to first candle of dataset.
    """
    now_utc   = datetime.now(timezone.utc)
    today_str = now_utc.strftime("%Y-%m-%d")

    # Try NY open (14:30 UTC)
    ny_open_ts = int(datetime.fromisoformat(f"{today_str}T14:30:00+00:00").timestamp() * 1000)
    # Try London open (08:00 UTC)
    ld_open_ts = int(datetime.fromisoformat(f"{today_str}T08:00:00+00:00").timestamp() * 1000)

    ny_candle = next((c for c in candles if c["timestamp"] >= ny_open_ts), None)
    ld_candle = next((c for c in candles if c["timestamp"] >= ld_open_ts), None)

    orb = ny_candle or ld_candle or candles[0]
    return orb["high"], orb["low"]

def calc_vwap(candles: list[dict]) -> float:
    """Session VWAP — reset at midnight UTC"""
    now_utc    = datetime.now(timezone.utc)
    midnight   = int(datetime.fromisoformat(
        f"{now_utc.strftime('%Y-%m-%d')}T00:00:00+00:00"
    ).timestamp() * 1000)
    session_candles = [c for c in candles if c["timestamp"] >= midnight] or candles[-20:]
    cum_pv = cum_v = 0.0
    for c in session_candles:
        tp = (c["high"] + c["low"] + c["close"]) / 3
        cum_pv += tp * c["volume"]
        cum_v  += c["volume"]
    return cum_pv / cum_v if cum_v > 0 else 0

def calc_atr(candles: list[dict], period: int = 14) -> float:
    if len(candles) < 2: return 0
    trs = []
    for i in range(1, min(period + 1, len(candles))):
        c = candles[-i]; p = candles[-i - 1]
        trs.append(max(
            c["high"] - c["low"],
            abs(c["high"] - p["close"]),
            abs(c["low"]  - p["close"])
        ))
    return float(np.mean(trs)) if trs else 0

def detect_regime(candles: list[dict]) -> str:
    """ADX-like regime using last 20 candles"""
    if len(candles) < 20: return "RANGING"
    recent = candles[-20:]
    closes = [c["close"] for c in recent]
    # EMA slope
    ema_fast = np.mean(closes[-5:])
    ema_slow = np.mean(closes[-20:])
    slope    = abs(ema_fast - ema_slow) / ema_slow * 100 if ema_slow > 0 else 0
    # Higher highs / lower lows check
    highs = [c["high"] for c in recent]
    lows  = [c["low"]  for c in recent]
    hh = sum(1 for i in range(1, len(highs)) if highs[i] > highs[i-1])
    ll = sum(1 for i in range(1, len(lows))  if lows[i]  < lows[i-1])
    directional = max(hh, ll) / (len(recent) - 1)
    # Trending if slope > 0.3% OR strong directional movement
    return "TRENDING" if slope > 0.3 or directional > 0.65 else "RANGING"

def ml_score(features: dict) -> float:
    score  = min(features.get("vol_ratio", 1.0) / 2.5, 1.0) * 0.25
    score += (1.0 if features.get("orb_break")  else 0.2) * 0.20
    score += (0.9 if features.get("regime") == "TRENDING" else 0.5) * 0.20
    score += (1.0 if features.get("vwap_aligned") else 0.2) * 0.15
    score += min(features.get("atr_pct", 0.5), 1.0) * 0.10
    score += features.get("momentum", 0.5) * 0.10
    return round(min(max(score, 0.0), 1.0), 3)

async def scan_symbol(symbol: str, threshold: float = 0.60) -> Optional[Signal]:
    candles = await fetch_candles(symbol, interval="15", limit=100)
    if len(candles) < 20:
        return None

    price    = candles[-1]["close"]
    vwap     = calc_vwap(candles)
    atr      = calc_atr(candles)
    regime   = detect_regime(candles)
    orb_high, orb_low = get_session_orb(candles)

    print(f"[SCAN] {symbol}: price={price:.4f} vwap={vwap:.4f} "
          f"orb={orb_low:.4f}–{orb_high:.4f} regime={regime}")

    # Direction
    if price > orb_high * 1.0003:
        direction = "LONG"; orb_break = True
    elif price < orb_low * 0.9997:
        direction = "SHORT"; orb_break = True
    else:
        print(f"[SCAN] {symbol}: no ORB break")
        return None

    # VWAP filter
    vwap_above = price > vwap
    if direction == "LONG"  and not vwap_above:
        print(f"[SCAN] {symbol}: REJECTED — LONG below VWAP")
        return None
    if direction == "SHORT" and vwap_above:
        print(f"[SCAN] {symbol}: REJECTED — SHORT above VWAP")
        return None

    # Levels
    if direction == "LONG":
        sl = price - 1.5 * atr; tp = price + 4.5 * atr; be = price + 1.5 * atr
    else:
        sl = price + 1.5 * atr; tp = price - 4.5 * atr; be = price - 1.5 * atr

    risk = abs(price - sl)
    rr   = abs(tp - price) / risk if risk > 0 else 0
    if rr < 1.5:
        print(f"[SCAN] {symbol}: REJECTED — RR {rr:.2f} too low")
        return None

    recent_vol = np.mean([c["volume"] for c in candles[-5:]])
    avg_vol    = np.mean([c["volume"] for c in candles[-20:]])
    vol_ratio  = recent_vol / avg_vol if avg_vol > 0 else 1.0
    last       = candles[-1]
    c_range    = last["high"] - last["low"]
    momentum   = ((last["close"] - last["low"]) / c_range
                  if direction == "LONG"
                  else (last["high"] - last["close"]) / c_range
                  ) if c_range > 0 else 0.5
    atr_pct    = (atr / price) * 100 if price > 0 else 0

    score      = ml_score({
        "vol_ratio": vol_ratio, "orb_break": orb_break,
        "regime": regime, "vwap_aligned": True,
        "atr_pct": atr_pct, "momentum": momentum,
    })
    confidence = int(score * 100)
    print(f"[SCAN] {symbol}: {direction} RR=1:{rr:.1f} ML={confidence}% regime={regime}")

    if score < threshold:
        print(f"[SCAN] {symbol}: REJECTED — ML {confidence}% < {int(threshold*100)}%")
        return None

    status     = "ACTIVE" if score >= 0.75 else "PENDING"
    now        = datetime.now(timezone.utc)
    expires_at = datetime.fromtimestamp(
        now.timestamp() + 4 * 3600, tz=timezone.utc
    ).isoformat()

    return Signal(
        id          = str(uuid.uuid4()),
        symbol      = SYMBOL_DISPLAY.get(symbol, symbol),
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

class SignalEngine:
    def __init__(self):
        self.signals      = []
        self.threshold    = float(os.getenv("ML_THRESHOLD", "0.60"))
        self.running      = False
        self.broadcast_cb = None

    def set_broadcast(self, cb): self.broadcast_cb = cb

    def get_active(self):
        now = datetime.now(timezone.utc).isoformat()
        self.signals = [s for s in self.signals if s.expires_at > now]
        return [asdict(s) for s in self.signals]

    async def scan_all(self):
        print(f"[ENGINE] Scanning {len(ALL_SYMBOLS)} symbols...")
        results     = await asyncio.gather(
            *[scan_symbol(sym, self.threshold) for sym in ALL_SYMBOLS],
            return_exceptions=True
        )
        new_signals = [r for r in results if isinstance(r, Signal)]
        existing    = {s.symbol for s in new_signals}
        self.signals = [s for s in self.signals if s.symbol not in existing] + new_signals
        print(f"[ENGINE] ✅ {len(new_signals)} new | {len(self.signals)} total active")
        if self.broadcast_cb and new_signals:
            await self.broadcast_cb({
                "type":      "signal_update",
                "signals":   [asdict(s) for s in self.signals],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

    async def run(self):
        self.running = True
        print("[ENGINE] Started — scanning every 5 min")
        while self.running:
            try:
                await self.scan_all()
            except Exception as e:
                print(f"[ENGINE] Error: {e}")
            await asyncio.sleep(300)

    def stop(self): self.running = False

signal_engine = SignalEngine()
