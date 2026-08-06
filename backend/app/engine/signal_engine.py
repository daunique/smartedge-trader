"""
SmartEdge Trader — Production Signal Engine
Strategy: VWAP + ORB + ATR + ML Filter
Sessions: London (08:00–11:00 UTC) + NY (13:30–16:30 UTC)
Testing: TESTING_MODE=true bypasses session filter
"""

import asyncio, httpx, numpy as np, uuid, os
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass, asdict
from typing import Optional

# Restricted to exactly the 6 symbols validated in the walk-forward backtest
# (AVAX/LINK were previously included live but were never backtested — removed)
ALL_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT",
    "BNBUSDT", "DOGEUSDT",
]

SYMBOL_DISPLAY = {
    "BTCUSDT": "BTC/USDT",  "ETHUSDT": "ETH/USDT",
    "SOLUSDT": "SOL/USDT",  "XRPUSDT": "XRP/USDT",
    "BNBUSDT": "BNB/USDT",  "DOGEUSDT":"DOGE/USDT",
}

TESTING_MODE = os.getenv("TESTING_MODE", "true").lower() == "true"

@dataclass
class Signal:
    id: str; symbol: str; direction: str
    entry: float; tp: float; sl: float; be: float
    rr: str; ml_score: float; confidence: int
    status: str; timeframe: str; market: str
    vwap_above: bool; orb_break: bool; regime: str
    atr: float; timestamp: str; expires_at: str
    session: str = "ANY"

# ── Market Data ───────────────────────────────────────────────────
async def fetch_candles(symbol: str, interval: str = "15", limit: int = 200) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get("https://api.bybit.com/v5/market/kline", params={
                "category": "linear", "symbol": symbol,
                "interval": interval, "limit": str(limit),
            })
            data = r.json()
        if data.get("retCode") != 0: return []
        candles = []
        for c in reversed(data["result"]["list"]):
            candles.append({
                "timestamp": int(c[0]),   "open":   float(c[1]),
                "high":      float(c[2]), "low":    float(c[3]),
                "close":     float(c[4]), "volume": float(c[5]),
            })
        return candles
    except Exception as e:
        print(f"[CANDLES] {symbol}: {e}")
        return []

# ── Session Detection ─────────────────────────────────────────────
def get_current_session() -> str:
    now = datetime.now(timezone.utc)
    h   = now.hour + now.minute / 60
    if  8.0 <= h < 11.0: return "LONDON"
    if 13.5 <= h < 16.5: return "NEW_YORK"
    if 11.0 <= h < 13.5: return "OVERLAP"
    return "OFF_HOURS"

def is_trading_session() -> bool:
    if TESTING_MODE: return True
    session = get_current_session()
    return session in ("LONDON", "NEW_YORK", "OVERLAP")

def get_session_open_ts() -> int:
    """Get timestamp of current session open candle"""
    now = datetime.now(timezone.utc)
    h   = now.hour + now.minute / 60
    today = now.strftime("%Y-%m-%d")
    if h >= 13.5:
        open_time = f"{today}T13:30:00+00:00"
    elif h >= 8.0:
        open_time = f"{today}T08:00:00+00:00"
    else:
        # Previous NY session
        yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
        open_time = f"{yesterday}T13:30:00+00:00"
    return int(datetime.fromisoformat(open_time).timestamp() * 1000)

# ── Technical Indicators ──────────────────────────────────────────
def calc_session_vwap(candles: list[dict]) -> float:
    session_ts = get_session_open_ts()
    session_c  = [c for c in candles if c["timestamp"] >= session_ts]
    if not session_c:
        session_c = candles[-20:]
    cum_pv = cum_v = 0.0
    for c in session_c:
        tp      = (c["high"] + c["low"] + c["close"]) / 3
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

def get_orb(candles: list[dict]) -> tuple[float, float]:
    """Get Opening Range from first candle of current session"""
    session_ts = get_session_open_ts()
    orb_candle = next((c for c in candles if c["timestamp"] >= session_ts), None)
    if not orb_candle:
        orb_candle = candles[0]
    # ORB = first 15 min high/low (1 candle on 15M chart)
    return orb_candle["high"], orb_candle["low"]

def detect_regime(candles: list[dict]) -> str:
    if len(candles) < 20: return "RANGING"
    recent   = candles[-20:]
    closes   = [c["close"] for c in recent]
    ema_fast = np.mean(closes[-5:])
    ema_slow = np.mean(closes[-20:])
    slope    = abs(ema_fast - ema_slow) / ema_slow * 100 if ema_slow > 0 else 0
    highs    = [c["high"] for c in recent]
    lows     = [c["low"]  for c in recent]
    hh = sum(1 for i in range(1, len(highs)) if highs[i] > highs[i-1])
    ll = sum(1 for i in range(1, len(lows))  if lows[i]  < lows[i-1])
    directional = max(hh, ll) / (len(recent) - 1)
    return "TRENDING" if slope > 0.25 or directional > 0.60 else "RANGING"

def calc_momentum_direction(candles: list[dict], vwap: float) -> tuple[str, bool]:
    """Determine direction using VWAP + EMA + price action"""
    price    = candles[-1]["close"]
    closes   = [c["close"] for c in candles[-10:]]
    ema_fast = np.mean(closes[-3:])
    ema_slow = np.mean(closes[-10:])
    score    = 0
    if price > vwap:        score += 1
    if ema_fast > ema_slow: score += 1
    if closes[-1] > closes[-3]: score += 1
    return ("LONG", price > vwap) if score >= 2 else ("SHORT", price > vwap)

def ml_score_signal(features: dict) -> float:
    """
    Weighted signal quality score.
    Production: replace body with loaded XGBoost model.
    """
    s  = min(features.get("vol_ratio", 1.0) / 2.5, 1.0) * 0.20
    s += (1.0 if features.get("orb_break")    else 0.3) * 0.20
    s += (0.9 if features.get("regime") == "TRENDING" else 0.4) * 0.20
    s += (1.0 if features.get("vwap_aligned") else 0.3) * 0.15
    s += min(features.get("atr_pct", 0.5), 1.0) * 0.10
    s += features.get("momentum", 0.5)            * 0.10
    s += (1.0 if features.get("ema_aligned")  else 0.3) * 0.05
    return round(min(max(s, 0.0), 1.0), 3)

# ── Main Scanner ──────────────────────────────────────────────────
async def scan_symbol(symbol: str, threshold: float = 0.55) -> Optional[Signal]:
    candles = await fetch_candles(symbol, interval="15", limit=200)
    if len(candles) < 30: return None

    price     = candles[-1]["close"]
    vwap      = calc_session_vwap(candles)
    atr       = calc_atr(candles)
    regime    = detect_regime(candles)
    orb_high, orb_low = get_orb(candles)
    session   = get_current_session()

    # ─ ORB breakout detection ─────────────────────────────────────
    buf = 0.0003  # 0.03% buffer to avoid false breaks
    if price > orb_high * (1 + buf):
        direction, vwap_above = "LONG", price > vwap
        orb_break = True
    elif price < orb_low * (1 - buf):
        direction, vwap_above = "SHORT", price > vwap
        orb_break = True
    else:
        # No ORB break — use momentum direction in testing mode
        if TESTING_MODE:
            direction, vwap_above = calc_momentum_direction(candles, vwap)
            orb_break = False
        else:
            return None  # Production: require ORB break

    # ─ VWAP directional filter ────────────────────────────────────
    if not TESTING_MODE:
        if direction == "LONG"  and not (price > vwap): return None
        if direction == "SHORT" and not (price < vwap): return None

    # ─ Levels (ATR-based) ─────────────────────────────────────────
    atr_sl = max(atr * 1.5, price * 0.003)  # min 0.3% SL
    if direction == "LONG":
        sl = price - atr_sl
        tp = price + atr_sl * 3.0   # 1:3 minimum
        be = price + atr_sl * 1.0
    else:
        sl = price + atr_sl
        tp = price - atr_sl * 3.0
        be = price - atr_sl * 1.0

    risk = abs(price - sl)
    rr   = abs(tp - price) / risk if risk > 0 else 0
    if rr < 2.0: return None

    # ─ Volume + momentum features ─────────────────────────────────
    recent_vol  = np.mean([c["volume"] for c in candles[-5:]])
    avg_vol     = np.mean([c["volume"] for c in candles[-20:]])
    vol_ratio   = recent_vol / avg_vol if avg_vol > 0 else 1.0
    last        = candles[-1]
    c_range     = last["high"] - last["low"]
    momentum    = ((last["close"] - last["low"]) / c_range
                   if direction == "LONG"
                   else (last["high"] - last["close"]) / c_range
                   ) if c_range > 0 else 0.5
    atr_pct     = (atr / price) * 100 if price > 0 else 0
    closes      = [c["close"] for c in candles[-10:]]
    ema_aligned = (np.mean(closes[-3:]) > np.mean(closes[-10:])) == (direction == "LONG")

    score = ml_score_signal({
        "vol_ratio":   vol_ratio,
        "orb_break":   orb_break,
        "regime":      regime,
        "vwap_aligned": vwap_above == (direction == "LONG"),
        "atr_pct":     atr_pct,
        "momentum":    momentum,
        "ema_aligned": ema_aligned,
    })
    confidence = int(score * 100)

    print(f"[SCAN] {symbol}: {direction} price={price:.4f} vwap={vwap:.4f} "
          f"orb={'✓' if orb_break else '—'} ML={confidence}% regime={regime} session={session}")

    if score < threshold:
        return None

    status     = "ACTIVE" if score >= 0.72 else "PENDING"
    now        = datetime.now(timezone.utc)
    expires_at = datetime.fromtimestamp(
        now.timestamp() + 4 * 3600, tz=timezone.utc
    ).isoformat()

    return Signal(
        id=str(uuid.uuid4()),
        symbol=SYMBOL_DISPLAY.get(symbol, symbol),
        direction=direction, entry=round(price, 6),
        tp=round(tp, 6), sl=round(sl, 6), be=round(be, 6),
        rr=f"1:{rr:.1f}", ml_score=score, confidence=confidence,
        status=status, timeframe="15M", market="crypto",
        vwap_above=vwap_above, orb_break=orb_break,
        regime=regime, atr=round(atr, 6),
        timestamp=now.isoformat(), expires_at=expires_at,
        session=session,
    )

# ── Signal Engine ─────────────────────────────────────────────────
class SignalEngine:
    def __init__(self):
        self.signals      = []
        self.threshold    = float(os.getenv("ML_THRESHOLD", "0.55"))
        self.running      = False
        self.broadcast_cb = None

    def set_broadcast(self, cb): self.broadcast_cb = cb

    def get_active(self):
        now = datetime.now(timezone.utc).isoformat()
        self.signals = [s for s in self.signals if s.expires_at > now]
        return [asdict(s) for s in self.signals]

    async def scan_all(self):
        session = get_current_session()
        if not is_trading_session():
            print(f"[ENGINE] Off-hours ({session}) — skipping scan")
            return

        print(f"[ENGINE] Scanning {len(ALL_SYMBOLS)} symbols "
              f"| session={session} | testing={TESTING_MODE} | threshold={int(self.threshold*100)}%")

        results     = await asyncio.gather(
            *[scan_symbol(sym, self.threshold) for sym in ALL_SYMBOLS],
            return_exceptions=True
        )
        new_signals = [r for r in results if isinstance(r, Signal)]
        existing    = {s.symbol for s in new_signals}
        self.signals = [s for s in self.signals if s.symbol not in existing] + new_signals
        print(f"[ENGINE] ✅ {len(new_signals)} new signals | {len(self.signals)} total active")

        if self.broadcast_cb:
            await self.broadcast_cb({
                "type":      "signal_update",
                "signals":   [asdict(s) for s in self.signals],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

    async def run(self):
        self.running = True
        mode = "TESTING (24/7)" if TESTING_MODE else "PRODUCTION (London + NY sessions)"
        print(f"[ENGINE] Started — {mode}")
        while self.running:
            try:
                await self.scan_all()
            except Exception as e:
                print(f"[ENGINE] Error: {e}")
            await asyncio.sleep(300)  # 5 min

    def stop(self): self.running = False

signal_engine = SignalEngine()
