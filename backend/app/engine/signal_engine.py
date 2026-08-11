"""
SmartEdge Trader — Signal Engine
Strategy: SMA-cross trend filter + candle-structure entry trigger + ATR volatility
filter + ATR-based TP/SL/BE — the exact confluence combination validated by
backtest across Jan-Jun 2026 1H data (single train/test split; see README).
No ML component: this system never used a trained model -- the previous
"ML filter" was a hand-weighted heuristic function, not a fitted classifier,
and was not part of what was backtested, so it has been removed rather than
reimplemented.

Per-symbol strategy (both use SL=1.5xATR / TP=4.5xATR / BE at +1.5R):
  XRPUSDT: trend = SMA(50) vs SMA(200) | entry = candle body-ratio > 0.789
  ETHUSDT: trend = SMA(100) vs SMA(200) | entry = candle range > 1.52x its 20-period average
  both:    skip entries when ATR is in the top 40% of its trailing 30-day range
"""

import asyncio, httpx, numpy as np, uuid, os
from datetime import datetime, timezone
from dataclasses import dataclass, asdict
from typing import Optional

# Only the two pairs this strategy was actually validated on.
ALL_SYMBOLS = ["XRPUSDT", "ETHUSDT"]

SYMBOL_DISPLAY = {"XRPUSDT": "XRP/USDT", "ETHUSDT": "ETH/USDT"}

# Per-symbol confluence, exactly as backtested -- do not change one side
# without re-validating, these are not independent knobs.
STRATEGY_PARAMS = {
    "XRPUSDT": {"trend_fast": 50,  "trend_slow": 200, "entry": "body_ratio", "body_ratio_min": 0.789},
    "ETHUSDT": {"trend_fast": 100, "trend_slow": 200, "entry": "mom_candle", "range_mult_min": 1.52},
}
ATR_PERIOD             = 14
SL_ATR_MULT             = 1.5
TP_ATR_MULT             = 4.5   # 3R target (4.5 / 1.5)
BE_TRIGGER_R            = 1.5
VOL_LOOKBACK_H          = 720   # 30 days, matches the backtest's rolling percentile window
VOL_EXCLUDE_ABOVE_PCTL  = 60    # skip entries when ATR% is in the top 40% for that symbol

@dataclass
class Signal:
    id: str; symbol: str; direction: str
    entry: float; tp: float; sl: float; be: float
    rr: str; status: str; timeframe: str; market: str
    trend: str; entry_trigger: str; vol_ok: bool
    atr: float; timestamp: str; expires_at: str
    executed: bool = False

# -- Market Data ------------------------------------------------------------
async def fetch_candles(symbol: str, interval: str = "60", limit: int = 1000) -> list[dict]:
    """interval=60 -> 1H candles, matching the backtest exactly (was 15m)."""
    try:
        async with httpx.AsyncClient(timeout=20) as client:
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

# -- Indicators (match the backtest's math, not simplified approximations) --
def sma(values: list[float], period: int) -> Optional[float]:
    if len(values) < period: return None
    return float(np.mean(values[-period:]))

def wilder_atr_series(candles: list[dict], period: int = ATR_PERIOD) -> list:
    """Wilder-smoothed ATR (same formula the backtest used: ewm alpha=1/period),
    NOT a simple rolling mean -- the two diverge enough to matter for SL/TP sizing."""
    n = len(candles)
    if n < 2: return [None] * n
    trs = [None]
    for i in range(1, n):
        h, l, pc = candles[i]["high"], candles[i]["low"], candles[i - 1]["close"]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    atr = [None] * n
    if n <= period: return atr
    atr[period] = float(np.mean(trs[1:period + 1]))
    for i in range(period + 1, n):
        atr[i] = (atr[i - 1] * (period - 1) + trs[i]) / period
    return atr

def body_ratio(c: dict) -> float:
    rng = c["high"] - c["low"]
    return abs(c["close"] - c["open"]) / rng if rng > 0 else 0.0

def candle_direction(c: dict) -> int:
    return 1 if c["close"] > c["open"] else (-1 if c["close"] < c["open"] else 0)

def range_avg(candles: list[dict], period: int = 20) -> Optional[float]:
    if len(candles) < period: return None
    return float(np.mean([c["high"] - c["low"] for c in candles[-period:]]))

def atr_percentile(atr_pct_series: list, lookback: int = VOL_LOOKBACK_H) -> Optional[float]:
    """Where the current ATR% ranks within its trailing `lookback` hours (0-100)."""
    window = [v for v in atr_pct_series[-lookback:] if v is not None]
    if len(window) < 168:   # need at least a week of history before this is meaningful
        return None
    current = window[-1]
    return float(sum(1 for v in window if v <= current) / len(window) * 100)

# -- Main Scanner -------------------------------------------------------------
async def scan_symbol(symbol: str) -> Optional[Signal]:
    params = STRATEGY_PARAMS[symbol]
    candles = await fetch_candles(symbol, interval="60", limit=1000)
    min_needed = max(params["trend_slow"], VOL_LOOKBACK_H) + 5
    if len(candles) < min_needed:
        print(f"[SCAN] {symbol}: only {len(candles)} candles, need {min_needed} -- skipping")
        return None

    closes = [c["close"] for c in candles]
    price  = closes[-1]

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

    # -- entry trigger (symbol-specific, exactly as backtested) -------------
    triggered_long = triggered_short = False
    if params["entry"] == "body_ratio":
        br = body_ratio(last)
        triggered_long  = trend_bull      and direction_candle > 0 and br > params["body_ratio_min"]
        triggered_short = (not trend_bull) and direction_candle < 0 and br > params["body_ratio_min"]
        trigger_desc = f"body-ratio {body_ratio(last):.2f} > {params['body_ratio_min']}"
    else:  # mom_candle
        ravg = range_avg(candles, 20)
        rng  = last["high"] - last["low"]
        mult = (rng / ravg) if ravg else 0
        triggered_long  = trend_bull      and direction_candle > 0 and ravg and mult > params["range_mult_min"]
        triggered_short = (not trend_bull) and direction_candle < 0 and ravg and mult > params["range_mult_min"]
        trigger_desc = f"range {mult:.2f}x avg > {params['range_mult_min']}x"

    if not vol_ok or not (triggered_long or triggered_short):
        print(f"[SCAN] {symbol}: trend={trend} vol_ok={vol_ok} "
              f"({'-' if vol_pctl is None else f'{vol_pctl:.0f}pctl'}) no entry")
        return None

    direction = "LONG" if triggered_long else "SHORT"

    # -- levels: SL/TP/BE exactly as backtested; live execution acts
    # immediately on signal generation as an approximation of the
    # backtest's next-candle-open fill ------------------------------------
    if direction == "LONG":
        sl = price - SL_ATR_MULT * atr
        tp = price + TP_ATR_MULT * atr
        be = price + BE_TRIGGER_R * SL_ATR_MULT * atr
    else:
        sl = price + SL_ATR_MULT * atr
        tp = price - TP_ATR_MULT * atr
        be = price - BE_TRIGGER_R * SL_ATR_MULT * atr

    rr = TP_ATR_MULT / SL_ATR_MULT  # constant by construction = 3.0

    print(f"[SCAN] {symbol}: {direction} price={price:.4f} trend={trend} "
          f"trigger=({trigger_desc}) vol={'ok' if vol_ok else 'skip'}")

    now = datetime.now(timezone.utc)
    expires_at = datetime.fromtimestamp(now.timestamp() + 3600, tz=timezone.utc).isoformat()

    return Signal(
        id=str(uuid.uuid4()),
        symbol=SYMBOL_DISPLAY.get(symbol, symbol),
        direction=direction, entry=round(price, 6),
        tp=round(tp, 6), sl=round(sl, 6), be=round(be, 6),
        rr=f"1:{rr:.1f}", status="ACTIVE", timeframe="1H", market="crypto",
        trend=trend, entry_trigger=trigger_desc, vol_ok=vol_ok,
        atr=round(atr, 6), timestamp=now.isoformat(), expires_at=expires_at,
    )

# -- Signal Engine ------------------------------------------------------------
class SignalEngine:
    def __init__(self):
        self.signals      = []
        self.running      = False
        self.broadcast_cb = None

    def set_broadcast(self, cb): self.broadcast_cb = cb

    def get_active(self):
        # Non-executed signals go stale after an hour and should drop off --
        # but a signal that WAS executed now represents an open position,
        # not a pending opportunity, and has nothing to do with this timer.
        # It's cleared separately, by clear_executed_if_closed, once the
        # position it represents actually closes.
        now = datetime.now(timezone.utc).isoformat()
        self.signals = [s for s in self.signals if s.executed or s.expires_at > now]
        return [asdict(s) for s in self.signals]

    def mark_executed(self, signal_id: str):
        for s in self.signals:
            if s.id == signal_id:
                s.executed = True
                return True
        return False

    def clear_executed_if_closed(self, open_symbols_raw: set):
        """open_symbols_raw: symbols (no slash, e.g. 'XRPUSDT') with a
        currently-open position, from auto_executor's own 30s position
        poll. An executed signal whose symbol isn't in that set anymore
        means the trade it represents has closed -- remove it."""
        before = len(self.signals)
        self.signals = [
            s for s in self.signals
            if not s.executed or s.symbol.replace("/", "") in open_symbols_raw
        ]
        if len(self.signals) != before:
            print(f"[ENGINE] Cleared {before - len(self.signals)} executed signal(s) whose position closed")

    async def scan_all(self):
        print(f"[ENGINE] Scanning {len(ALL_SYMBOLS)} symbols (1H, 24/7 -- no session gating)")
        results = await asyncio.gather(
            *[scan_symbol(sym) for sym in ALL_SYMBOLS],
            return_exceptions=True
        )
        for r in results:
            if isinstance(r, Exception):
                print(f"[ENGINE] scan error: {r}")
        new_signals = [r for r in results if isinstance(r, Signal)]
        existing    = {s.symbol for s in new_signals}
        # Don't replace an executed signal with a fresh-looking one for the
        # same symbol -- that position is still open, there's nothing new
        # to act on until it closes (see execute_signal's same-pair guard).
        self.signals = [
            s for s in self.signals
            if s.symbol not in existing or s.executed
        ] + [ns for ns in new_signals if not any(
            s.symbol == ns.symbol and s.executed for s in self.signals
        )]
        print(f"[ENGINE] {len(new_signals)} new signals | {len(self.signals)} total active")

        if self.broadcast_cb:
            await self.broadcast_cb({
                "type":      "signal_update",
                "signals":   [asdict(s) for s in self.signals],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

    async def run(self):
        self.running = True
        print("[ENGINE] Started -- 1H candles, XRPUSDT + ETHUSDT, 24/7")
        while self.running:
            try:
                await self.scan_all()
            except Exception as e:
                print(f"[ENGINE] Error: {e}")
            # Signals only change on a completed 1H candle; polling every 5 min
            # is just how promptly a new candle close gets noticed, not a
            # parameter the backtest had an opinion on.
            await asyncio.sleep(300)

    def stop(self): self.running = False

signal_engine = SignalEngine()
