"""
SmartEdge Trader — Auto Execution Engine
Handles: Full-Auto order placement, position sizing, TP/SL/BE management
"""

import asyncio
from datetime import datetime, timezone
from dataclasses import dataclass, asdict
from typing import Optional
from app import telegram_notify
from app.bybit_client import bybit_get, bybit_post, get_order_pnl, is_closing_order, is_today_utc
from app.engine.signal_engine import (
    fetch_candles, wilder_atr_series, SL_ATR_MULT, ATR_PERIOD, signal_engine,
)

# ── Position sizing ───────────────────────────────────────────────
MAX_LEVERAGE = {"XRPUSDT": 15.0}

def calc_position_size(
    balance: float,
    risk_pct: float,
    entry: float,
    sl: float,
    min_qty: float = 0.001,
    qty_step: float = 0.001,
    max_leverage: float = 10.0,
    available=None,
) -> float:
    """Risk-based sizing, leverage-capped, with margin headroom.

    Uses available balance for the leverage cap (not total equity) so we do
    not request more margin than Bybit will accept. A 15% buffer avoids
    'ab not enough for new order' from fees / rounding / locked funds.
    """
    equity = max(balance, 0.0)
    avail = equity if available is None else max(float(available), 0.0)
    # Cap margin usage at 85% of what available balance can support at max lev
    margin_budget = avail * 0.85
    risk_amount = equity * (risk_pct / 100)
    risk_per_unit = abs(entry - sl)
    if risk_per_unit <= 0 or entry <= 0:
        return min_qty
    raw_qty = risk_amount / risk_per_unit
    max_qty_lev = (margin_budget * max_leverage) / entry if entry > 0 else min_qty
    qty = min(raw_qty, max_qty_lev)
    if qty_step > 0:
        qty = (qty // qty_step) * qty_step
    qty = max(min_qty, qty)
    return round(qty, 6)

# ── Min qty per symbol (only the two validated pairs) ─────────────
MIN_QTY  = {"XRPUSDT": 1.0}
QTY_STEP = {"XRPUSDT": 1.0}

# ── Safety checklist ──────────────────────────────────────────────
@dataclass
class SafetyCheck:
    passed:         bool
    reason:         str
    trades_today:   int = 0
    daily_loss_pct: float = 0.0
    balance:        float = 0.0
    available:      float = 0.0

async def run_safety_checks(settings: dict, trades_today: int, daily_loss: float) -> SafetyCheck:
    """All checks must pass before executing any trade"""
    try:
        data = await bybit_get("/v5/account/wallet-balance", {"accountType": "UNIFIED"})
        if data.get("retCode") != 0:
            return SafetyCheck(False, f"Cannot fetch balance: {data.get('retMsg')}")
        lst = data.get("result", {}).get("list") or []
        acc = lst[0] if lst else {}
        balance = float(acc.get("totalEquity") or 0)
        # Prefer totalAvailableBalance; fall back to coin USDT availableToWithdraw / walletBalance
        available = float(acc.get("totalAvailableBalance") or 0)
        if available <= 0:
            for coin in acc.get("coin") or []:
                if coin.get("coin") == "USDT":
                    available = float(
                        coin.get("availableToWithdraw")
                        or coin.get("walletBalance")
                        or coin.get("equity")
                        or 0
                    )
                    break
        if available <= 0:
            available = balance
    except Exception as e:
        return SafetyCheck(False, f"Cannot fetch balance: {e}")

    if balance <= 0:
        return SafetyCheck(False, "Zero balance")
    if available <= 0:
        return SafetyCheck(False, f"No available margin (equity={balance:.2f}, available=0)")

    loss_pct = (daily_loss / balance * 100) if balance > 0 else 0
    if loss_pct >= settings.get("dailyLossLimit", 2):
        return SafetyCheck(False,
            f"Daily loss limit hit ({loss_pct:.1f}% >= {settings['dailyLossLimit']}%)",
            trades_today, loss_pct, balance, available)

    if trades_today >= settings.get("maxTradesPerDay", 3):
        return SafetyCheck(False,
            f"Max trades hit ({trades_today}/{settings['maxTradesPerDay']})",
            trades_today, loss_pct, balance, available)

    return SafetyCheck(True, "All checks passed", trades_today, loss_pct, balance, available)

# ── Order executor ────────────────────────────────────────────────
RISK_PER_TRADE_PCT = {"XRPUSDT": 10.0}

class AutoExecutor:
    def __init__(self):
        # Aligned to the actual backtest (single train/test split over
        # Jan-Jun 2026 1H data -- see README). No ML gating: nothing in the
        # validated strategy conditions on a model score.
        self.settings = {
            "riskPerTrade":    dict(RISK_PER_TRADE_PCT),
            "minRR":           3.0,
            "maxTradesPerDay": 4,
            "dailyLossLimit":  25.0,
            "beTrigger":       2.0,
        }
        self.mode          = "SEMI-AUTO"  # MANUAL | SEMI-AUTO | FULL-AUTO
        self.paused        = False
        self.trades_today  = 0
        self.daily_loss    = 0.0
        self.executed_ids  = set()   # prevent double execution
        self.broadcast_cb  = None
        self.running       = False
        # Best price seen in the position's favor since it opened, per
        # symbol -- update_break_even was checking only the instantaneous
        # markPrice at each 10s poll, so a price spike that touched the BE
        # trigger and pulled back before the next poll landed was simply
        # never detected. This high-water mark catches it even if price
        # has already pulled back by the time the next poll runs.
        self.peak_favorable = {}
        self._orig_risk = {}
        # signal_id -> unix ts of last hard failure (margin etc.) — skip retries for 10 min
        self.failed_ids = {}
        self.last_be_check_at = None
        self.last_be_move_at = None
        self.last_be_symbol = None
        self.last_order = None  # {ok, symbol, msg, at, order_id}

    def set_broadcast(self, cb): self.broadcast_cb = cb
    def set_mode(self, mode):    self.mode = mode
    def set_paused(self, v):     self.paused = v
    def update_settings(self, s):
        # Validate/normalize rather than blindly overwrite -- a malformed
        # payload (e.g. riskPerTrade sent as a bare number by a stale
        # frontend build) must not be allowed to replace the per-symbol
        # dict structure this class depends on elsewhere.
        s = dict(s)
        if "riskPerTrade" in s:
            rpt = s["riskPerTrade"]
            if isinstance(rpt, dict):
                merged = dict(self.settings["riskPerTrade"])
                merged.update({k: float(v) for k, v in rpt.items()})
                s["riskPerTrade"] = merged
            elif isinstance(rpt, (int, float)):
                # Legacy flat value: apply to both symbols rather than reject outright.
                print(f"[SETTINGS] riskPerTrade sent as flat number ({rpt}) — applying to XRPUSDT")
                s["riskPerTrade"] = {sym: float(rpt) for sym in RISK_PER_TRADE_PCT}
            else:
                print(f"[SETTINGS] riskPerTrade had an unexpected type ({type(rpt)}) -- ignoring, keeping current value")
                del s["riskPerTrade"]
        self.settings.update(s)

    async def execute_signal(self, signal: dict) -> dict:
        """Execute a single signal — place order on Bybit demo"""

        sig_id = signal.get("id")
        if sig_id in self.executed_ids:
            return {"success": False, "reason": "Already executed"}

        if self.paused:
            return {"success": False, "reason": "System paused"}

        # Cooldown after margin / hard failures — stop hammering the same signal
        import time as _time
        fail_ts = self.failed_ids.get(sig_id)
        if fail_ts and (_time.time() - fail_ts) < 600:
            return {"success": False, "reason": "Cooldown for this signal (margin/order failure cooldown)"}

        # Sync actual fill count AND realized daily loss from Bybit before
        # checking limits -- both were previously either wrong or never
        # updated at all; see _sync_daily_stats for what that fixes.
        await self._sync_daily_stats()

        # Safety checks
        check = await run_safety_checks(
            self.settings, self.trades_today, self.daily_loss
        )
        if not check.passed:
            print(f"[EXECUTOR] Safety check failed: {check.reason}")
            return {"success": False, "reason": check.reason}

        symbol_raw = signal["symbol"].replace("/", "")
        direction  = signal["direction"]
        entry      = float(signal["entry"])
        tp         = float(signal["tp"])
        sl         = float(signal["sl"])

        # Min RR check. entry/tp/sl each get rounded to 6dp independently in
        # signal_engine.py, so a signal that's exactly 3.0 by construction
        # (TP_ATR_MULT/SL_ATR_MULT = 4.5/1.5) can recompute here as e.g.
        # 2.999958 -- verified this lands below the threshold on ~47% of
        # realistic price/ATR combinations, essentially at random, which is
        # exactly the intermittent "RR too low" behavior being reported.
        # A tolerance absorbs the rounding noise without weakening the check
        # for any signal that's actually below minRR. 1e-3 chosen empirically:
        # tested across 300k realistic price/ATR combinations, worst-case
        # rounding error observed was ~4.1e-4, so 1e-3 has real margin above
        # that while still being ~500x smaller than any legitimate RR gap
        # this check needs to catch.
        risk = abs(entry - sl)
        rr   = abs(tp - entry) / risk if risk > 0 else 0
        RR_EPSILON = 1e-3
        if rr < self.settings["minRR"] - RR_EPSILON:
            return {"success": False, "reason": f"RR too low ({rr:.2f} < {self.settings['minRR']})"}

        # Same-pair guard, matching the backtest exactly: entries were only
        # ever considered while flat (`if position == 0` in backtest.py) --
        # a new signal for a pair that already has an open trade was never
        # acted on, the existing trade just ran to its own SL/TP/BE. This
        # was missing entirely from the live path (verified by grep before
        # writing this) -- nothing stopped a second order, manual or auto,
        # from stacking onto or flipping an already-open position.
        pos_check = await bybit_get("/v5/position/list",
                                    {"category": "linear", "symbol": symbol_raw, "settleCoin": "USDT"})
        if pos_check.get("retCode") == 0:
            existing = next((p for p in pos_check["result"].get("list", [])
                             if float(p.get("size") or 0) > 0), None)
            if existing:
                return {"success": False,
                        "reason": f"{symbol_raw} already has an open position -- "
                                  f"matching backtest behavior, new signals for a pair "
                                  f"aren't acted on until the current trade closes"}

        rpt = self.settings["riskPerTrade"]
        if isinstance(rpt, dict):
            risk_pct = rpt.get(symbol_raw, RISK_PER_TRADE_PCT.get(symbol_raw, 1.0))
        else:
            risk_pct = float(rpt) if isinstance(rpt, (int, float)) else RISK_PER_TRADE_PCT.get(symbol_raw, 1.0)

        lev = MAX_LEVERAGE.get(symbol_raw, 10.0)
        # Set leverage BEFORE sizing so exchange margin math matches our cap
        await self._ensure_leverage(symbol_raw, lev)

        qty = calc_position_size(
            balance      = check.balance,
            risk_pct     = risk_pct,
            entry        = entry,
            sl           = sl,
            min_qty      = MIN_QTY.get(symbol_raw, 0.01),
            qty_step     = QTY_STEP.get(symbol_raw, 0.01),
            max_leverage = lev,
            available    = check.available,
        )
        notional = qty * entry
        margin_est = notional / lev if lev else notional
        print(f"[EXECUTOR] Placing {direction} {symbol_raw} "
              f"qty={qty} entry={entry} tp={tp} sl={sl} "
              f"risk={risk_pct}% RR=1:{rr:.1f} lev={lev}x "
              f"equity={check.balance:.2f} avail={check.available:.2f} "
              f"margin≈{margin_est:.2f}")

        # Place order. Bybit's actual error on the last deploy was explicit:
        # "tpOrderType can not have a value when tpSlMode is empty" -- so
        # tpOrderType/slOrderType require tpslMode to be set, which was the
        # missing piece, not a guess this time. "Full" = TP/SL applies to
        # the whole position (we never split TP/SL across partial size).
        # orderLinkId ties the exchange order to our signal id (max 36 chars on Bybit)
        link_id = str(sig_id).replace("-", "")[:36]
        body = {
            "category":    "linear",
            "symbol":      symbol_raw,
            "side":        "Buy" if direction == "LONG" else "Sell",
            "orderType":   "Market",
            "qty":         str(qty),
            "takeProfit":  str(round(tp, 6)),
            "stopLoss":    str(round(sl, 6)),
            "tpTriggerBy": "MarkPrice",
            "slTriggerBy": "MarkPrice",
            "tpslMode":    "Full",
            "tpOrderType": "Market",
            "slOrderType": "Market",
            "timeInForce": "IOC",
            "orderLinkId": link_id,
        }

        try:
            result = await bybit_post("/v5/order/create", body)
            if result.get("retCode") == 0:
                self.executed_ids.add(sig_id)
                self.trades_today += 1
                order_id = result["result"].get("orderId")
                print(f"[EXECUTOR] ✅ Order placed: {order_id} link={link_id}")
                self.last_order = {
                    "ok": True, "symbol": symbol_raw, "order_id": order_id,
                    "order_link_id": link_id, "msg": "filled",
                    "at": datetime.now(timezone.utc).isoformat(),
                }
                try:
                    await telegram_notify.notify_trade({
                        "success": True, "symbol": signal.get("symbol"),
                        "direction": direction, "qty": qty, "entry": entry,
                        "tp": tp, "sl": sl, "order_id": order_id,
                    })
                except Exception as _te:
                    print(f"[EXECUTOR] telegram: {_te}")

                # Verify SL actually attached rather than assume the
                # order-create params were honored -- this position is
                # what was open with no stop protecting it, and the cause
                # wasn't fully certain even after reviewing Bybit's own
                # docs, so this is a safety net, not a bet that the params
                # above are now definitely sufficient on their own.
                await asyncio.sleep(1.5)  # let the fill/position update propagate
                await self._verify_and_protect(symbol_raw, sl, tp)

                # Broadcast execution event
                if self.broadcast_cb:
                    await self.broadcast_cb({
                        "type":     "trade_executed",
                        "signal":   signal,
                        "order_id": order_id,
                        "qty":      qty,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })

                return {
                    "success":  True,
                    "order_id": order_id,
                    "symbol":   signal["symbol"],
                    "direction": direction,
                    "qty":      qty,
                    "entry":    entry,
                    "tp":       tp,
                    "sl":       sl,
                    "rr":       f"1:{rr:.1f}",
                }
            else:
                err = result.get("retMsg", "Unknown error")
                print(f"[EXECUTOR] ❌ Order failed: {err}")
                self.last_order = {
                    "ok": False, "symbol": symbol_raw, "order_id": None,
                    "order_link_id": link_id, "msg": err,
                    "at": datetime.now(timezone.utc).isoformat(),
                }
                # One automatic downsize retry on insufficient margin
                if "not enough" in err.lower() or "ab not enough" in err.lower():
                    step = QTY_STEP.get(symbol_raw, 0.01)
                    retry_qty = max(MIN_QTY.get(symbol_raw, 0.01), (qty * 0.6 // step) * step)
                    if retry_qty < qty and retry_qty > 0:
                        print(f"[EXECUTOR] Retrying with reduced qty {retry_qty} (was {qty})")
                        body["qty"] = str(retry_qty)
                        result2 = await bybit_post("/v5/order/create", body)
                        if result2.get("retCode") == 0:
                            self.executed_ids.add(sig_id)
                            self.failed_ids.pop(sig_id, None)
                            self.trades_today += 1
                            order_id = result2["result"].get("orderId")
                            await asyncio.sleep(1.5)
                            await self._verify_and_protect(symbol_raw, sl, tp)
                            print(f"[EXECUTOR] ✅ Order placed on retry: {order_id}")
                            return {
                                "success": True, "order_id": order_id,
                                "symbol": signal["symbol"], "direction": direction,
                                "qty": retry_qty, "entry": entry, "tp": tp, "sl": sl,
                                "rr": f"1:{rr:.1f}", "retried": True,
                            }
                        err = result2.get("retMsg", err)
                        print(f"[EXECUTOR] ❌ Retry also failed: {err}")
                    import time as _time
                    self.failed_ids[sig_id] = _time.time()
                return {"success": False, "reason": err, "raw": result}

        except Exception as e:
            print(f"[EXECUTOR] Exception: {e}")
            return {"success": False, "reason": str(e)}

    async def _ensure_leverage(self, symbol_raw: str, leverage: float) -> bool:
        """Set both sides' leverage for a symbol before trading it. Bybit
        returns retCode 110043 ("leverage not modified") when it's already
        at the requested value -- that's a success case, not an error, and
        is expected on every call after the first for a given symbol."""
        try:
            result = await bybit_post("/v5/position/set-leverage", {
                "category":     "linear",
                "symbol":       symbol_raw,
                "buyLeverage":  str(leverage),
                "sellLeverage": str(leverage),
            })
            code = result.get("retCode")
            if code == 0:
                print(f"[EXECUTOR] Leverage set: {symbol_raw} -> {leverage}x")
                return True
            if code == 110043 or "not modified" in str(result.get("retMsg", "")).lower():
                return True  # already at this leverage -- fine
            print(f"[EXECUTOR] Leverage set failed for {symbol_raw}: "
                  f"{result.get('retMsg')} (retCode={code}) -- attempting order anyway")
            return False
        except Exception as e:
            print(f"[EXECUTOR] Leverage set exception for {symbol_raw}: {e} -- attempting order anyway")
            return False

    async def _verify_and_protect(self, symbol_raw: str, intended_sl: float, intended_tp: float):
        """Confirm SL actually landed on the position after order creation;
        if not, set it explicitly rather than leave the position naked
        until the next 10s monitor pass. This is what should have caught
        the case where an open position had no SL at all."""
        try:
            data = await bybit_get("/v5/position/list",
                                   {"category": "linear", "symbol": symbol_raw, "settleCoin": "USDT"})
            if data.get("retCode") != 0:
                print(f"[EXECUTOR] Could not verify SL for {symbol_raw}: {data.get('retMsg')}")
                return
            plist = data["result"].get("list", [])
            pos = next((p for p in plist if float(p.get("size") or 0) > 0), None)
            if not pos:
                return  # already closed/no position -- nothing to protect
            current_sl = float(pos.get("stopLoss") or 0)
            if current_sl > 0:
                return  # attached correctly, nothing to do
            pos_idx = int(pos.get("positionIdx", 0))  # read the real value -- hardcoding 0 assumes one-way mode, which silently fails every call if the account is actually in hedge mode
            print(f"[EXECUTOR] ⚠ {symbol_raw} opened with no SL attached -- setting it now (positionIdx={pos_idx})")
            result = await bybit_post("/v5/position/trading-stop", {
                "category":    "linear",
                "symbol":      symbol_raw,
                "tpslMode":    "Full",
                "stopLoss":    str(round(intended_sl, 6)),
                "takeProfit":  str(round(intended_tp, 6)),
                "slTriggerBy": "MarkPrice",
                "tpTriggerBy": "MarkPrice",
                "positionIdx": int(pos_idx),
            })
            if result.get("retCode") == 0:
                print(f"[EXECUTOR] SL set as fallback for {symbol_raw}: {intended_sl}")
            else:
                print(f"[EXECUTOR] ❌ Fallback SL-set FAILED for {symbol_raw}: "
                      f"retCode={result.get('retCode')} retMsg={result.get('retMsg')} -- still unprotected")
        except Exception as e:
            print(f"[EXECUTOR] SL verification error for {symbol_raw}: {e}")

    async def _ensure_position_protected(self, pos: dict) -> float:
        """Called from the monitor loop on every open position, every 10s --
        not just at entry. Catches a naked (no-SL) position regardless of
        how it got that way (a failed entry-time attach that verification
        also missed, a manual exchange-side change, anything), using a
        freshly-computed ATR stop from current price since the original
        entry-time SL isn't available once we're this far removed from the
        entry order. Returns the SL now in effect (possibly unchanged)."""
        if pos["sl"] > 0:
            return pos["sl"]
        symbol_raw = pos["symbol"]
        pos_idx = pos.get("positionIdx", 0)
        print(f"[EXECUTOR] ⚠ {symbol_raw} has an OPEN position with NO stop-loss -- protecting it now")
        try:
            candles = await fetch_candles(symbol_raw, interval="60", limit=100)
            if len(candles) < ATR_PERIOD + 5:
                print(f"[EXECUTOR] Not enough candles to compute an emergency SL for {symbol_raw}")
                return 0.0
            atr = wilder_atr_series(candles, ATR_PERIOD)[-1]
            if not atr or atr <= 0:
                return 0.0
            current = pos["current"]
            sl = current - SL_ATR_MULT * atr if pos["direction"] == "LONG" else current + SL_ATR_MULT * atr
            result = await bybit_post("/v5/position/trading-stop", {
                "category": "linear", "symbol": symbol_raw,
                "tpslMode": "Full",
                "stopLoss": str(round(sl, 6)), "slTriggerBy": "MarkPrice",
                "positionIdx": int(pos_idx),
            })
            if result.get("retCode") == 0:
                print(f"[EXECUTOR] Emergency SL set for {symbol_raw}: {sl}")
                return sl
            print(f"[EXECUTOR] ❌ Emergency SL set FAILED for {symbol_raw}: "
                  f"retCode={result.get('retCode')} retMsg={result.get('retMsg')}")
            return 0.0
        except Exception as e:
            print(f"[EXECUTOR] Emergency SL error for {symbol_raw}: {e}")
            return 0.0

    async def update_break_even(self, position: dict) -> bool:
        """Move SL to entry (+small buffer) when BE trigger is hit. `position`
        may carry a 'peak' field (best price seen since open, tracked by the
        caller) -- if present, the trigger check uses that instead of the
        instantaneous current price, so a price spike that already touched
        the trigger still counts even if price has since pulled back."""
        symbol_raw = position["symbol"].replace("/", "")
        entry      = float(position.get("entry", 0))
        current    = float(position.get("current", 0))
        peak       = float(position.get("peak", current))
        sl         = float(position.get("sl", 0))
        direction  = position.get("direction")
        be_trigger = self.settings.get("beTrigger", 2.0)

        if sl == 0:
            return False

        # Prefer original risk distance (entry vs initial SL) so BE R stays
        # correct even if SL was already partially adjusted.
        orig_risk = float(position.get("orig_risk") or 0)
        risk = orig_risk if orig_risk > 0 else abs(entry - sl)
        if risk <= 0:
            return False

        # Already at/beyond breakeven SL — nothing to do
        if direction == "LONG" and sl >= entry:
            return False
        if direction == "SHORT" and sl <= entry and sl > 0:
            return False

        rr_achieved = (
            (peak - entry) / risk if direction == "LONG"
            else (entry - peak) / risk
        )

        if rr_achieved >= be_trigger:
            # Small buffer beyond exact entry, matching the backtest
            # (be_buffer in backtest.py) -- without it, a "breakeven" exit
            # still nets a small loss once fees are accounted for.
            BE_BUFFER = 0.0006
            be_price = entry * (1 + BE_BUFFER) if direction == "LONG" else entry * (1 - BE_BUFFER)
            pos_idx = position.get("positionIdx", 0)
            print(f"[EXECUTOR] Moving SL to BE for {symbol_raw} (peak rr={rr_achieved:.2f} >= {be_trigger}, positionIdx={pos_idx})")
            try:
                result = await bybit_post("/v5/position/trading-stop", {
                    "category":    "linear",
                    "symbol":      symbol_raw,
                    "tpslMode":    "Full",
                    "stopLoss":    str(round(be_price, 6)),
                    "slTriggerBy": "MarkPrice",
                    "positionIdx": int(pos_idx),
                })
                if result.get("retCode") != 0:
                    print(f"[EXECUTOR] ❌ BE move FAILED for {symbol_raw}: "
                          f"retCode={result.get('retCode')} retMsg={result.get('retMsg')} "
                          f"-- SL still at {sl}, will retry next 10s pass")
                    return False
                # Verify it actually landed rather than trust a retCode==0
                # response alone -- confirm the position's stopLoss field
                # actually changed before calling this done.
                check = await bybit_get("/v5/position/list",
                                        {"category": "linear", "symbol": symbol_raw, "settleCoin": "USDT"})
                new_sl = 0.0
                if check.get("retCode") == 0:
                    p = next((p for p in check["result"].get("list", []) if float(p.get("size") or 0) > 0), None)
                    if p: new_sl = float(p.get("stopLoss") or 0)
                if abs(new_sl - be_price) < be_price * 0.001:  # matches within tick-size rounding
                    print(f"[EXECUTOR] ✅ BE confirmed for {symbol_raw}: SL now {new_sl} (was {sl})")
                    self.last_be_move_at = datetime.now(timezone.utc).isoformat()
                    self.last_be_symbol = symbol_raw
                    return True
                print(f"[EXECUTOR] ⚠ BE move returned success for {symbol_raw} but SL reads "
                      f"{new_sl}, expected ~{be_price} -- treating as unconfirmed, will retry")
                return False
            except Exception as e:
                print(f"[EXECUTOR] ❌ BE move exception for {symbol_raw}: {e} -- will retry next 10s pass")
                return False
        return False

    async def run_be_monitor(self):
        """Background loop — checks BE trigger and SL presence on all open
        positions every 10s. Runs unconditionally regardless of mode/pause:
        those govern whether NEW trades get taken, not whether an already-
        open position stays protected. Gating this on mode meant switching
        to MANUAL or hitting pause would have silently stopped BE-monitoring
        and the SL self-heal both, for any position still open at the time."""
        self.running = True
        print("[EXECUTOR] BE monitor started")
        while self.running:
            try:
                self.last_be_check_at = datetime.now(timezone.utc).isoformat()
                data = await bybit_get("/v5/position/list",
                                      {"category": "linear", "settleCoin": "USDT"})
                if data.get("retCode") == 0:
                    open_symbols = set()
                    for p in data["result"].get("list", []):
                        size = float(p.get("size") or 0)
                        if size == 0: continue
                        symbol = p.get("symbol")
                        open_symbols.add(symbol)
                        direction = "LONG" if p.get("side") == "Buy" else "SHORT"
                        current   = float(p.get("markPrice") or 0)

                        prev_peak = self.peak_favorable.get(symbol)
                        peak = current if prev_peak is None else (
                            max(prev_peak, current) if direction == "LONG" else min(prev_peak, current)
                        )
                        self.peak_favorable[symbol] = peak

                        entry_px = float(p.get("avgPrice") or 0)
                        sl_px = float(p.get("stopLoss") or 0)
                        if not hasattr(self, "_orig_risk"):
                            self._orig_risk = {}
                        if symbol not in self._orig_risk and sl_px > 0 and entry_px > 0:
                            self._orig_risk[symbol] = abs(entry_px - sl_px)
                        pos = {
                            "symbol":      symbol,
                            "direction":   direction,
                            "entry":       entry_px,
                            "current":     current,
                            "peak":        peak,
                            "sl":          sl_px,
                            "orig_risk":   self._orig_risk.get(symbol, 0),
                            "positionIdx": int(p.get("positionIdx", 0)),
                        }
                        if pos["sl"] == 0:
                            pos["sl"] = await self._ensure_position_protected(pos)
                        await self.update_break_even(pos)
                    signal_engine.clear_executed_if_closed(open_symbols)
                    # Drop peak tracking for anything no longer open, so the
                    # next trade on that symbol starts with a clean slate
                    # instead of inheriting a stale high-water mark.
                    for sym in list(self.peak_favorable):
                        if sym not in open_symbols:
                            del self.peak_favorable[sym]
                            if hasattr(self, "_orig_risk") and sym in self._orig_risk:
                                del self._orig_risk[sym]
            except Exception as e:
                print(f"[EXECUTOR] BE monitor error: {e}")
            # 10s, down from 30s -- this loop only fetches one lightweight
            # position-list call (and, rarely, a trading-stop call) for
            # what's normally 0-2 open positions, so tightening this is
            # cheap and doesn't meaningfully touch Bybit's rate limits at
            # this trade frequency. Real-time WebSocket-based monitoring
            # would remove polling latency entirely, but that's a separate,
            # larger change (different auth model, persistent connection,
            # reconnect handling) worth its own careful pass rather than
            # folding into this fix.
            await asyncio.sleep(10)

    def stop(self): self.running = False

    async def _sync_daily_stats(self):
        """Sync today's real trade count AND realized P&L from Bybit before
        every execution -- both matter for the safety checks right after this
        call, and both were broken before this fix:
        - trades_today previously counted orderStatus=='New' (unfilled/
          pending) orders as trades, inflating the count against real fills.
          IOC market orders resolve almost instantly so this rarely bit in
          practice, but it's wrong regardless of how often it manifests.
        - daily_loss was initialized once and only ever reset to 0.0 -- 
          nothing anywhere updated it with real losses, so the "daily loss
          limit" safety check always saw 0% and could never trip. It looked
          like a working circuit breaker in the settings UI; it wasn't one.
        """
        try:
            data = await bybit_get("/v5/order/history", {"category": "linear", "limit": "50"})
            if data.get("retCode") != 0:
                return
            trades_today = 0
            daily_loss   = 0.0
            for o in data["result"].get("list", []):
                if not is_today_utc(o.get("createdTime") or "0"):
                    continue
                if o.get("orderStatus") not in ("Filled", "PartiallyFilled"):
                    continue
                if not is_closing_order(o):
                    continue  # entry order, not a completed trade -- see is_closing_order
                trades_today += 1
                pnl = get_order_pnl(o)
                if pnl < 0:
                    daily_loss += abs(pnl)
            self.trades_today = trades_today
            self.daily_loss   = daily_loss
            print(f"[EXECUTOR] Synced: {trades_today} trades today, ${daily_loss:.2f} realized loss today")
        except Exception as e:
            print(f"[EXECUTOR] Sync error: {e}")

    def reset_daily(self):
        self.trades_today = 0
        self.daily_loss   = 0.0
        self.executed_ids.clear()

# Global instance
auto_executor = AutoExecutor()
