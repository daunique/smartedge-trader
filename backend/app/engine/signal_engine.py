"""
Signal Engine — VWAP + ORB + ML Filter
Generates trade signals with confidence scores
"""

import numpy as np
from datetime import datetime, time
from dataclasses import dataclass
from typing import Optional
import uuid


@dataclass
class Signal:
    id: str
    symbol: str
    direction: str       # LONG | SHORT
    entry: float
    tp: float
    sl: float
    rr: float
    ml_score: float
    confidence: int
    status: str          # ACTIVE | PENDING | WATCH | REJECTED
    timeframe: str
    market: str
    vwap_above: bool
    orb_break: bool
    regime: str          # TRENDING | RANGING
    timestamp: datetime
    atr: float = 0.0


class OrbCalculator:
    """Opening Range Breakout — marks first N-minute range"""

    def __init__(self, minutes: int = 15):
        self.minutes = minutes
        self.orb_high: Optional[float] = None
        self.orb_low: Optional[float] = None
        self.formed = False

    def update(self, candles: list[dict]) -> bool:
        """Feed OHLCV candles. Returns True when ORB is formed."""
        if self.formed:
            return True
        if len(candles) < 1:
            return False

        highs = [c["high"] for c in candles]
        lows = [c["low"] for c in candles]
        self.orb_high = max(highs)
        self.orb_low = min(lows)
        self.formed = True
        return True

    def breakout(self, price: float) -> Optional[str]:
        """Returns LONG | SHORT | None based on ORB break"""
        if not self.formed:
            return None
        if price > self.orb_high:
            return "LONG"
        if price < self.orb_low:
            return "SHORT"
        return None


class VWAPCalculator:
    """Volume Weighted Average Price"""

    def __init__(self):
        self.cumulative_pv = 0.0
        self.cumulative_volume = 0.0

    def reset(self):
        self.cumulative_pv = 0.0
        self.cumulative_volume = 0.0

    def update(self, high: float, low: float, close: float, volume: float) -> float:
        typical_price = (high + low + close) / 3
        self.cumulative_pv += typical_price * volume
        self.cumulative_volume += volume
        if self.cumulative_volume == 0:
            return close
        return self.cumulative_pv / self.cumulative_volume

    def get_vwap(self) -> float:
        if self.cumulative_volume == 0:
            return 0
        return self.cumulative_pv / self.cumulative_volume


class MLFilter:
    """
    XGBoost-based signal quality classifier
    In production: loads a trained model from disk
    Here: uses a weighted scoring heuristic as placeholder
    """

    def __init__(self, threshold: float = 0.65):
        self.threshold = threshold

    def score(self, features: dict) -> float:
        """
        Features:
          - gap_pct: pre-market gap %
          - volume_ratio: current vol / 20-period avg vol
          - atr_pct: ATR as % of price
          - vwap_distance: % distance from VWAP
          - orb_break: bool
          - trend_strength: 0-1
          - session_time: minutes since open
          - prev_day_direction: 1 = bullish, -1 = bearish
        """
        score = 0.0
        weights = {
            "volume_ratio": 0.25,
            "orb_break": 0.20,
            "trend_strength": 0.20,
            "vwap_distance": 0.15,
            "gap_pct": 0.10,
            "session_time": 0.10,
        }

        # Volume: high vol = strong signal
        vol_ratio = features.get("volume_ratio", 1.0)
        score += min(vol_ratio / 3.0, 1.0) * weights["volume_ratio"]

        # ORB break confirmation
        score += (1.0 if features.get("orb_break") else 0.3) * weights["orb_break"]

        # Trend strength
        score += features.get("trend_strength", 0.5) * weights["trend_strength"]

        # VWAP distance (not too far, not too close)
        dist = abs(features.get("vwap_distance", 0.5))
        dist_score = 1.0 - abs(dist - 0.3) / 0.3
        score += max(0, dist_score) * weights["vwap_distance"]

        # Gap confirms direction
        gap = features.get("gap_pct", 0)
        score += min(abs(gap) / 2.0, 1.0) * weights["gap_pct"]

        # Session time: best 15–90 min after open
        t = features.get("session_time", 30)
        time_score = 1.0 if 15 <= t <= 90 else max(0, 1 - (t - 90) / 30)
        score += time_score * weights["session_time"]

        return round(min(max(score, 0.0), 1.0), 3)

    def passes(self, score: float) -> bool:
        return score >= self.threshold


class RegimeDetector:
    """Classifies market regime: TRENDING or RANGING"""

    def classify(self, candles: list[dict]) -> str:
        if len(candles) < 10:
            return "RANGING"
        closes = [c["close"] for c in candles]
        highs = [c["high"] for c in candles]
        lows = [c["low"] for c in candles]

        # ADX proxy: compare directional movement vs range
        price_move = abs(closes[-1] - closes[0])
        total_range = sum(h - l for h, l in zip(highs, lows)) / len(candles)

        ratio = price_move / (total_range * len(candles)) if total_range > 0 else 0
        return "TRENDING" if ratio > 0.3 else "RANGING"


class SignalEngine:
    def __init__(self, settings: dict = None):
        self.settings = settings or {"orb_timeframe": 15, "ml_threshold": 0.65}
        self.orb = OrbCalculator(self.settings["orb_timeframe"])
        self.vwap = VWAPCalculator()
        self.ml = MLFilter(self.settings["ml_threshold"])
        self.regime = RegimeDetector()
        self._active_signals: list[Signal] = []

    def process_candle(self, symbol: str, candle: dict, history: list[dict]) -> Optional[Signal]:
        """
        Main processing loop per candle tick.
        Returns a Signal if conditions are met, else None.
        """
        price = candle["close"]
        vwap = self.vwap.update(candle["high"], candle["low"], candle["close"], candle["volume"])
        atr = self._calc_atr(history)
        regime = self.regime.classify(history)

        # Skip ranging markets (ORB less reliable)
        if regime == "RANGING":
            return None

        # Check ORB
        orb_direction = self.orb.breakout(price)
        if not orb_direction:
            return None

        # VWAP filter: only long above VWAP, short below
        vwap_above = price > vwap
        if orb_direction == "LONG" and not vwap_above:
            return None
        if orb_direction == "SHORT" and vwap_above:
            return None

        # Calculate levels
        sl = price - (1.5 * atr) if orb_direction == "LONG" else price + (1.5 * atr)
        tp = price + (4.5 * atr) if orb_direction == "LONG" else price - (4.5 * atr)
        rr = round(abs(tp - price) / abs(price - sl), 2) if abs(price - sl) > 0 else 0

        # ML score
        features = {
            "volume_ratio": candle["volume"] / max(np.mean([c["volume"] for c in history[-20:]]), 1),
            "orb_break": True,
            "trend_strength": 0.7 if regime == "TRENDING" else 0.3,
            "vwap_distance": abs(price - vwap) / vwap if vwap > 0 else 0,
            "gap_pct": 0,
            "session_time": 30,
        }
        ml_score = self.ml.score(features)

        if not self.ml.passes(ml_score):
            return None

        signal = Signal(
            id=str(uuid.uuid4()),
            symbol=symbol,
            direction=orb_direction,
            entry=price,
            tp=round(tp, 6),
            sl=round(sl, 6),
            rr=rr,
            ml_score=ml_score,
            confidence=int(ml_score * 100),
            status="ACTIVE",
            timeframe=f"{self.settings['orb_timeframe']}M",
            market="crypto",
            vwap_above=vwap_above,
            orb_break=True,
            regime=regime,
            timestamp=datetime.utcnow(),
            atr=atr,
        )
        self._active_signals.append(signal)
        return signal

    def _calc_atr(self, candles: list[dict], period: int = 14) -> float:
        if len(candles) < 2:
            return 0.01
        trs = []
        for i in range(1, min(period + 1, len(candles))):
            c = candles[-i]
            p = candles[-i - 1]
            tr = max(c["high"] - c["low"], abs(c["high"] - p["close"]), abs(c["low"] - p["close"]))
            trs.append(tr)
        return float(np.mean(trs)) if trs else 0.01

    def is_trading_hours(self) -> bool:
        """Only trade first 2 hours of NY session (14:30–16:30 UTC) + London overlap"""
        now = datetime.utcnow().time()
        ny_open = time(14, 30)
        ny_window = time(16, 30)
        london_open = time(8, 0)
        london_close = time(10, 30)
        return (ny_open <= now <= ny_window) or (london_open <= now <= london_close)

    def get_active_signals(self) -> list:
        return [vars(s) for s in self._active_signals if s.status == "ACTIVE"]
