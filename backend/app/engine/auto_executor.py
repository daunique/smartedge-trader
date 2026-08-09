"""
SmartEdge Trader — Auto Execution Engine
Handles: Full-Auto order placement, position sizing, TP/SL/BE management
"""

import asyncio, os, json, hmac, hashlib, time
import httpx
from datetime import datetime, timezone
from dataclasses import dataclass, asdict
from typing import Optional

DEMO_BASE = "https://api-demo.bybit.com"

# Bug fix: same module-level credential caching issue as main.py — reading
# os.getenv() once at import time meant a Bybit key rotation in Render's
# environment would not take effect even after a redeploy, if the module
# had already cached the old (or empty) value. Now read fresh on every call.
def get_api_key() -> str:
    return os.getenv("BYBIT_API_KEY", "")

def get_api_secret() -> str:
    return os.getenv("BYBIT_API_SECRET", "")

# ── Signed requests ───────────────────────────────────────────────
async def bybit_post(path: str, body: dict) -> dict:
    api_key     = get_api_key()
    api_secret  = get_api_secret()
    ts          = str(int(time.time() * 1000))
    recv_window = "20000"
    body_str    = json.dumps(body)
    param_str   = ts + api_key + recv_window + body_str
    sig = hmac.new(api_secret.encode(), param_str.encode(), hashlib.sha256).hexdigest()
    headers = {
        "X-BAPI-API-KEY":     api_key,
        "X-BAPI-TIMESTAMP":   ts,
        "X-BAPI-SIGN":        sig,
        "X-BAPI-RECV-WINDOW": recv_window,
        "Content-Type":       "application/json",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{DEMO_BASE}{path}", content=body_str, headers=headers)
        return r.json()

async def bybit_get(path: str, params: dict = {}) -> dict:
    api_key     = get_api_key()
    api_secret  = get_api_secret()
    ts          = str(int(time.time() * 1000))
    recv_window = "20000"
    param_str   = ts + api_key + recv_window + "&".join(
        f"{k}={v}" for k, v in sorted(params.items())
    )
    sig = hmac.new(api_secret.encode(), param_str.encode(), hashlib.sha256).hexdigest()
    headers = {
        "X-BAPI-API-KEY":     api_key,
        "X-BAPI-TIMESTAMP":   ts,
        "X-BAPI-SIGN":        sig,
        "X-BAPI-RECV-WINDOW": recv_window,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{DEMO_BASE}{path}", params=params, headers=headers)
        return r.json()

# ── Position sizing ───────────────────────────────────────────────
MAX_LEVERAGE = {"XRPUSDT": 15.0, "ETHUSDT": 20.0}  # matches the backtest's safety ceiling

def calc_position_size(
    balance: float,
    risk_pct: float,
    entry: float,
    sl: float,
    min_qty: float = 0.001,
    qty_step: float = 0.001,
    max_leverage: float = 10.0,
) -> float:
    """Risk-based position sizing, leverage-capped exactly like the backtest:
    qty is normally risk_amount / stop_distance, but if that stop distance is
    small enough to imply more than max_leverage, the position is capped at
    max_leverage*balance notional instead -- actual risk taken drops below
    risk_pct on those trades rather than leverage climbing unbounded."""
    risk_amount   = balance * (risk_pct / 100)
    risk_per_unit = abs(entry - sl)
    if risk_per_unit == 0 or entry == 0:
        return min_qty
    raw_qty     = risk_amount / risk_per_unit
    max_qty_lev = (balance * max_leverage) / entry
    qty = min(raw_qty, max_qty_lev)
    # Round down to qty_step
    qty = max(min_qty, (qty // qty_step) * qty_step)
    return round(qty, 6)

# ── Min qty per symbol (only the two validated pairs) ─────────────
MIN_QTY  = {"XRPUSDT": 1.0, "ETHUSDT": 0.01}
QTY_STEP = {"XRPUSDT": 1.0, "ETHUSDT": 0.01}

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
# Per-symbol risk: the two pairs use different risk-per-trade because that's
# what the backtest's risk/drawdown sweep actually validated -- XRP's tighter
# max-drawdown profile supports more risk per trade than ETH's for a
# comparable drawdown outcome. Don't collapse these to one shared number.
RISK_PER_TRADE_PCT = {"XRPUSDT": 6.0, "ETHUSDT": 5.0}

class AutoExecutor:
    def __init__(self):
        # Aligned to the actual backtest (single train/test split over
        # Jan-Jun 2026 1H data -- see README). No ML gating: nothing in the
        # validated strategy conditions on a model score.
        self.settings = {
            "riskPerTrade":    dict(RISK_PER_TRADE_PCT),  # per-symbol, see above
            "minRR":           3.0,     # matches TP/SL = 4.5xATR / 1.5xATR exactly
            "maxTradesPerDay": 4,       # safety net only -- signals average ~1 every 1.6-2.3 days
            "dailyLossLimit":  20.0,    # safety net only -- not itself backtested; set well
                                        # above a single trade's risk so it only trips on a
                                        # genuine malfunction, not normal operation
            "beTrigger":       1.5,
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
                print(f"[SETTINGS] riskPerTrade sent as a flat number ({rpt}) -- "
                      f"expected a per-symbol object, applying to both symbols")
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

        # Sync actual fill count from Bybit before checking limits — trades_today
        # was previously only tracked in-memory and reset to 0 on every server
        # restart, so the daily cap could be silently bypassed by a redeploy.
        # This was defined but never called; now it runs before every execution.
        await self._sync_trades_today()

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

        # Min RR check
        risk = abs(entry - sl)
        rr   = abs(tp - entry) / risk if risk > 0 else 0
        if rr < self.settings["minRR"]:
            return {"success": False, "reason": f"RR too low ({rr:.1f} < {self.settings['minRR']})"}

        # Position size -- risk % is per-symbol (XRP 6% / ETH 5%), not a flat number.
        # Defensive against riskPerTrade being a stale flat number (shouldn't happen
        # post-update_settings-fix, but a currently-running instance may still be
        # holding one in memory from before a redeploy) rather than crashing execution.
        rpt = self.settings["riskPerTrade"]
        if isinstance(rpt, dict):
            risk_pct = rpt.get(symbol_raw, RISK_PER_TRADE_PCT.get(symbol_raw, 1.0))
        else:
            risk_pct = float(rpt) if isinstance(rpt, (int, float)) else RISK_PER_TRADE_PCT.get(symbol_raw, 1.0)
        qty = calc_position_size(
            balance      = check.balance,
            risk_pct     = risk_pct,
            entry        = entry,
            sl           = sl,
            min_qty      = MIN_QTY.get(symbol_raw, 0.01),
            qty_step     = QTY_STEP.get(symbol_raw, 0.01),
            max_leverage = MAX_LEVERAGE.get(symbol_raw, 10.0),
        )

        print(f"[EXECUTOR] Placing {direction} {symbol_raw} "
              f"qty={qty} entry={entry} tp={tp} sl={sl} "
              f"risk={risk_pct}% RR=1:{rr:.1f}")

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

    async def _sync_trades_today(self):
        """Sync actual trade count from Bybit to prevent exceeding daily limit"""
        import httpx, hmac, hashlib, time, json, os
        try:
            ts          = str(int(time.time() * 1000))
            recv_window = '20000'
            params      = {'category': 'linear', 'limit': '50'}
            param_str   = ts + os.getenv('BYBIT_API_KEY','') + recv_window + '&'.join(f'{k}={v}' for k,v in sorted(params.items()))
            sig = hmac.new(os.getenv('BYBIT_API_SECRET','').encode(), param_str.encode(), hashlib.sha256).hexdigest()
            headers = {
                'X-BAPI-API-KEY': os.getenv('BYBIT_API_KEY',''),
                'X-BAPI-TIMESTAMP': ts,
                'X-BAPI-SIGN': sig,
                'X-BAPI-RECV-WINDOW': recv_window,
            }
            from datetime import datetime, timezone
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get('https://api-demo.bybit.com/v5/order/history', params=params, headers=headers)
                data = r.json()
            if data.get('retCode') == 0:
                today = datetime.now(timezone.utc).date().isoformat()
                count = 0
                for o in data['result'].get('list', []):
                    created = o.get('createdTime') or '0'
                    try:
                        order_date = datetime.utcfromtimestamp(int(created)/1000).date().isoformat()
                    except:
                        order_date = ''
                    if order_date == today and o.get('orderStatus') in ('Filled','PartiallyFilled','New'):
                        count += 1
                self.trades_today = count
                print(f'[EXECUTOR] Synced trades today: {count}')
        except Exception as e:
            print(f'[EXECUTOR] Sync error: {e}')

    def reset_daily(self):
        self.trades_today = 0
        self.daily_loss   = 0.0
        self.executed_ids.clear()

# Global instance
auto_executor = AutoExecutor()
