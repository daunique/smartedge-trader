"""
Autonomous Trade Manager
Handles: TP, SL, Break-Even, Trailing Stop — no human needed in FULL-AUTO mode
"""

from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime
import uuid


@dataclass
class Position:
    id: str
    symbol: str
    direction: str          # LONG | SHORT
    entry: float
    current: float
    tp: float
    sl: float
    be_price: float         # break-even price
    size: float
    atr: float
    status: str = "OPEN"    # OPEN | BE | CLOSED
    rr_achieved: float = 0.0
    pnl: float = 0.0
    open_time: datetime = field(default_factory=datetime.utcnow)
    market: str = "crypto"
    be_triggered: bool = False
    trailing_active: bool = False
    highest_price: float = 0.0   # for trailing on LONG
    lowest_price: float = 999999  # for trailing on SHORT


class TradeManager:
    def __init__(self, settings: dict = None):
        self.settings = settings or {
            "risk_per_trade": 0.01,
            "min_rr": 3.0,
            "daily_loss_limit": 0.02,
            "be_trigger": 1.0,       # trigger BE at 1:1
            "trailing_stop": True,
        }
        self.positions: dict[str, Position] = {}
        self.daily_loss = 0.0
        self.trades_today = 0
        self.max_trades_per_day = 3

    # ── Open Position ─────────────────────────────────────────────
    def open_position(self, signal: dict, balance: float) -> Optional[Position]:
        """Open a new position from a validated signal"""
        if self._check_daily_limits():
            return None

        atr = signal.get("atr", abs(signal["entry"] - signal["sl"]))
        tp = signal["tp"]
        sl = signal["sl"]
        entry = signal["entry"]

        # Calculate BE level
        be_price = entry + (entry - sl) * self.settings["be_trigger"] \
            if signal["direction"] == "LONG" \
            else entry - (sl - entry) * self.settings["be_trigger"]

        # Size based on risk %
        risk_amount = balance * self.settings["risk_per_trade"]
        risk_per_unit = abs(entry - sl)
        size = risk_amount / risk_per_unit if risk_per_unit > 0 else 0.01

        pos = Position(
            id=str(uuid.uuid4()),
            symbol=signal["symbol"],
            direction=signal["direction"],
            entry=entry,
            current=entry,
            tp=tp,
            sl=sl,
            be_price=be_price,
            size=size,
            atr=atr,
            highest_price=entry,
            lowest_price=entry,
            market=signal.get("market", "crypto"),
        )

        self.positions[pos.id] = pos
        self.trades_today += 1
        return pos

    # ── Update Position (called every tick) ──────────────────────
    def update_position(self, position_id: str, current_price: float) -> dict:
        """
        Core autonomous engine:
        1. Check TP
        2. Check SL
        3. Check BE trigger
        4. Update trailing stop
        """
        pos = self.positions.get(position_id)
        if not pos or pos.status == "CLOSED":
            return {"action": "none"}

        pos.current = current_price
        pos.pnl = self._calc_pnl(pos)
        pos.rr_achieved = self._calc_rr(pos)

        # Track extremes for trailing
        if pos.direction == "LONG":
            pos.highest_price = max(pos.highest_price, current_price)
        else:
            pos.lowest_price = min(pos.lowest_price, current_price)

        # ─ 1. Check TP ───────────────────────────────────────────
        if self._check_tp(pos):
            return self._close(pos, "TP_HIT")

        # ─ 2. Check SL ───────────────────────────────────────────
        if self._check_sl(pos):
            return self._close(pos, "SL_HIT")

        # ─ 3. Break-Even ─────────────────────────────────────────
        if not pos.be_triggered:
            if self._should_trigger_be(pos):
                pos.sl = pos.entry       # Move SL to entry
                pos.be_triggered = True
                pos.status = "BE"
                return {"action": "BE_TRIGGERED", "new_sl": pos.entry}

        # ─ 4. Trailing Stop ──────────────────────────────────────
        if self.settings["trailing_stop"] and pos.be_triggered:
            new_sl = self._calc_trailing_sl(pos)
            if new_sl and new_sl != pos.sl:
                pos.sl = new_sl
                return {"action": "TRAIL_UPDATED", "new_sl": new_sl}

        return {"action": "hold", "pnl": pos.pnl, "rr": pos.rr_achieved}

    # ── Helpers ───────────────────────────────────────────────────
    def _check_tp(self, pos: Position) -> bool:
        return (pos.direction == "LONG" and pos.current >= pos.tp) or \
               (pos.direction == "SHORT" and pos.current <= pos.tp)

    def _check_sl(self, pos: Position) -> bool:
        return (pos.direction == "LONG" and pos.current <= pos.sl) or \
               (pos.direction == "SHORT" and pos.current >= pos.sl)

    def _should_trigger_be(self, pos: Position) -> bool:
        be_trigger = self.settings["be_trigger"]
        risk = abs(pos.entry - pos.sl)
        target = pos.entry + risk * be_trigger if pos.direction == "LONG" \
            else pos.entry - risk * be_trigger
        return (pos.direction == "LONG" and pos.current >= target) or \
               (pos.direction == "SHORT" and pos.current <= target)

    def _calc_trailing_sl(self, pos: Position) -> Optional[float]:
        """Trail at 1 ATR below highest price (LONG) or above lowest (SHORT)"""
        if pos.direction == "LONG":
            new_sl = pos.highest_price - pos.atr
            return new_sl if new_sl > pos.sl else None
        else:
            new_sl = pos.lowest_price + pos.atr
            return new_sl if new_sl < pos.sl else None

    def _calc_pnl(self, pos: Position) -> float:
        if pos.direction == "LONG":
            return (pos.current - pos.entry) * pos.size
        return (pos.entry - pos.current) * pos.size

    def _calc_rr(self, pos: Position) -> float:
        risk = abs(pos.entry - pos.sl)
        if risk == 0:
            return 0
        if pos.direction == "LONG":
            return (pos.current - pos.entry) / risk
        return (pos.entry - pos.current) / risk

    def _close(self, pos: Position, reason: str) -> dict:
        pos.status = "CLOSED"
        pnl = self._calc_pnl(pos)
        if pnl < 0:
            self.daily_loss += abs(pnl)
        del self.positions[pos.id]
        return {"action": reason, "pnl": pnl, "rr": pos.rr_achieved}

    def _check_daily_limits(self) -> bool:
        return self.trades_today >= self.max_trades_per_day or \
               self.daily_loss >= self.settings["daily_loss_limit"]

    def get_open_positions(self) -> list:
        return [vars(p) for p in self.positions.values()]

    def close_position(self, position_id: str, reason: str = "manual") -> dict:
        pos = self.positions.get(position_id)
        if not pos:
            return {"error": "Position not found"}
        return self._close(pos, reason)
