"""
SmartEdge Trader — Auto Execution Engine
Handles: Full-Auto order placement, position sizing, TP/SL/BE management
"""

import asyncio, os, json, hmac, hashlib, time
import httpx
from datetime import datetime, timezone
from dataclasses import dataclass, asdict
from typing import Optional

DEMO_BASE  = "https://api-demo.bybit.com"
API_KEY    = os.getenv("BYBIT_API_KEY", "")
API_SECRET = os.getenv("BYBIT_API_SECRET", "")

# ── Signed requests ───────────────────────────────────────────────
async def bybit_post(path: str, body: dict) -> dict:
    ts          = str(int(time.time() * 1000))
    recv_window = "5000"
    body_str    = json.dumps(body)
    param_str   = ts + API_KEY + recv_window + body_str
    sig = hmac.new(API_SECRET.encode(), param_str.encode(), hashlib.sha256).hexdigest()
    headers = {
        "X-BAPI-API-KEY":     API_KEY,
        "X-BAPI-TIMESTAMP":   ts,
        "X-BAPI-SIGN":        sig,
        "X-BAPI-RECV-WINDOW": recv_window,
        "Content-Type":       "application/json",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{DEMO_BASE}{path}", content=body_str, headers=headers)
        return r.json()

async def bybit_get(path: str, params: dict = {}) -> dict:
    ts          = str(int(time.time() * 1000))
    recv_window = "5000"
    param_str   = ts + API_KEY + recv_window + "&".join(
        f"{k}={v}" for k, v in sorted(params.items())
    )
    sig = hmac.new(API_SECRET.encode(), param_str.encode(), hashlib.sha256).hexdigest()
    headers = {
        "X-BAPI-API-KEY":     API_KEY,
        "X-BAPI-TIMESTAMP":   ts,
        "X-BAPI-SIGN":        sig,
        "X-BAPI-RECV-WINDOW": recv_window,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{DEMO_BASE}{path}", params=params, headers=headers)
        return r.json()

# ── Position sizing ───────────────────────────────────────────────
def calc_position_size(
    balance: float,
    risk_pct: float,
    entry: float,
    sl: float,
    min_qty: float = 0.001,
    qty_step: float = 0.001,
) -> float:
    """Risk-based position sizing"""
    risk_amount  = balance * (risk_pct / 100)
    risk_per_unit = abs(entry - sl)
    if risk_per_unit == 0:
        return min_qty
    raw_qty = risk_amount / risk_per_unit
    # Round down to qty_step
    qty = max(min_qty, (raw_qty // qty_step) * qty_step)
    return round(qty, 6)

# ── Min qty per symbol ────────────────────────────────────────────
MIN_QTY = {
    "BTCUSDT":  0.001,
    "ETHUSDT":  0.01,
    "SOLUSDT":  0.1,
    "XRPUSDT":  1.0,
    "BNBUSDT":  0.01,
    "DOGEUSDT": 10.0,
    "AVAXUSDT": 0.1,
    "LINKUSDT": 0.1,
}

QTY_STEP = {
    "BTCUSDT":  0.001,
    "ETHUSDT":  0.01,
    "SOLUSDT":  0.1,
    "XRPUSDT":  1.0,
    "BNBUSDT":  0.01,
    "DOGEUSDT": 10.0,
    "AVAXUSDT": 0.1,
    "LINKUSDT": 0.1,
}

# ── Safety checklist ──────────────────────────────────────────────
@dataclass
class SafetyCheck:
    passed:         bool
    reason:         str
    trades_today:   int = 0
    daily_loss_pct: float = 0.0
    balance:        float = 0.0

async def run_safety_checks(settings: dict, trades_today: int, daily_loss: float) -> SafetyCheck:
    """All checks must pass before executing any trade"""

    # 1. Fetch balance
    try:
        data    = await bybit_get("/v5/account/wallet-balance", {"accountType": "UNIFIED"})
        lst     = data["result"]["list"]
        acc     = lst[0] if lst else {}
        balance = float(acc.get("totalEquity") or 0)
    except Exception as e:
        return SafetyCheck(False, f"Cannot fetch balance: {e}")

    if balance <= 0:
        return SafetyCheck(False, "Zero balance")

    # 2. Daily loss limit
    loss_pct = (daily_loss / balance * 100) if balance > 0 else 0
    if loss_pct >= settings.get("dailyLossLimit", 2):
        return SafetyCheck(False,
            f"Daily loss limit hit ({loss_pct:.1f}% >= {settings['dailyLossLimit']}%)",
            trades_today, loss_pct, balance)

    # 3. Max trades per day
    if trades_today >= settings.get("maxTradesPerDay", 3):
        return SafetyCheck(False,
            f"Max trades hit ({trades_today}/{settings['maxTradesPerDay']})",
            trades_today, loss_pct, balance)

    return SafetyCheck(True, "All checks passed", trades_today, loss_pct, balance)

# ── Order executor ────────────────────────────────────────────────
class AutoExecutor:
    def __init__(self):
        self.settings = {
            "riskPerTrade":    1.0,
            "minRR":           3.0,
            "maxTradesPerDay": 3,
            "dailyLossLimit":  2.0,
            "beTrigger":       1.0,
            "trailingStop":    True,
            "mlThreshold":     0.65,
        }
        self.mode          = "SEMI-AUTO"  # MANUAL | SEMI-AUTO | FULL-AUTO
        self.paused        = False
        self.trades_today  = 0
        self.daily_loss    = 0.0
        self.executed_ids  = set()   # prevent double execution
        self.broadcast_cb  = None
        self.running       = False

    def set_broadcast(self, cb): self.broadcast_cb = cb
    def set_mode(self, mode):    self.mode = mode
    def set_paused(self, v):     self.paused = v
    def update_settings(self, s): self.settings.update(s)

    async def execute_signal(self, signal: dict) -> dict:
        """Execute a single signal — place order on Bybit demo"""

        sig_id = signal.get("id")
        if sig_id in self.executed_ids:
            return {"success": False, "reason": "Already executed"}

        if self.paused:
            return {"success": False, "reason": "System paused"}

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
        ml_score   = float(signal.get("ml_score", 0))

        # ML threshold check
        if ml_score < self.settings["mlThreshold"]:
            return {"success": False, "reason": f"ML score too low ({ml_score:.0%})"}

        # Min RR check
        risk = abs(entry - sl)
        rr   = abs(tp - entry) / risk if risk > 0 else 0
        if rr < self.settings["minRR"]:
            return {"success": False, "reason": f"RR too low ({rr:.1f} < {self.settings['minRR']})"}

        # Position size
        qty = calc_position_size(
            balance   = check.balance,
            risk_pct  = self.settings["riskPerTrade"],
            entry     = entry,
            sl        = sl,
            min_qty   = MIN_QTY.get(symbol_raw, 0.01),
            qty_step  = QTY_STEP.get(symbol_raw, 0.01),
        )

        print(f"[EXECUTOR] Placing {direction} {symbol_raw} "
              f"qty={qty} entry={entry} tp={tp} sl={sl} "
              f"risk={self.settings['riskPerTrade']}% RR=1:{rr:.1f}")

        # Place order
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
            "timeInForce": "IOC",
        }

        try:
            result = await bybit_post("/v5/order/create", body)
            if result.get("retCode") == 0:
                self.executed_ids.add(sig_id)
                self.trades_today += 1
                order_id = result["result"].get("orderId")
                print(f"[EXECUTOR] ✅ Order placed: {order_id}")

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
                return {"success": False, "reason": err, "raw": result}

        except Exception as e:
            print(f"[EXECUTOR] Exception: {e}")
            return {"success": False, "reason": str(e)}

    async def update_break_even(self, position: dict) -> bool:
        """Move SL to entry when BE trigger is hit"""
        symbol_raw = position["symbol"].replace("/", "")
        entry      = float(position.get("entry", 0))
        current    = float(position.get("current", 0))
        sl         = float(position.get("sl", 0))
        direction  = position.get("direction")
        be_trigger = self.settings.get("beTrigger", 1.0)

        risk = abs(entry - sl)
        if risk == 0: return False

        rr_achieved = (
            (current - entry) / risk if direction == "LONG"
            else (entry - current) / risk
        )

        if rr_achieved >= be_trigger and sl != entry:
            print(f"[EXECUTOR] Moving SL to BE for {symbol_raw}")
            try:
                result = await bybit_post("/v5/position/trading-stop", {
                    "category":  "linear",
                    "symbol":    symbol_raw,
                    "stopLoss":  str(entry),
                    "slTriggerBy": "MarkPrice",
                    "positionIdx": 0,
                })
                return result.get("retCode") == 0
            except:
                return False
        return False

    async def run_be_monitor(self):
        """Background loop — checks BE trigger on all open positions every 30s"""
        self.running = True
        print("[EXECUTOR] BE monitor started")
        while self.running:
            try:
                if not self.paused and self.mode in ("SEMI-AUTO", "FULL-AUTO"):
                    data = await bybit_get("/v5/position/list",
                                          {"category": "linear", "settleCoin": "USDT"})
                    if data.get("retCode") == 0:
                        for p in data["result"].get("list", []):
                            size = float(p.get("size") or 0)
                            if size == 0: continue
                            pos = {
                                "symbol":    p.get("symbol"),
                                "direction": "LONG" if p.get("side") == "Buy" else "SHORT",
                                "entry":     float(p.get("avgPrice")  or 0),
                                "current":   float(p.get("markPrice") or 0),
                                "sl":        float(p.get("stopLoss")  or 0),
                            }
                            await self.update_break_even(pos)
            except Exception as e:
                print(f"[EXECUTOR] BE monitor error: {e}")
            await asyncio.sleep(30)

    def stop(self): self.running = False

    def reset_daily(self):
        self.trades_today = 0
        self.daily_loss   = 0.0
        self.executed_ids.clear()

# Global instance
auto_executor = AutoExecutor()
