from pathlib import Path
import os
"""
SmartEdge Trader — FastAPI Backend
Live Bybit Demo + Signal Engine + Auto Execution
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio, json, os
import httpx
from datetime import datetime, timezone
from dotenv import load_dotenv
from app.engine.signal_engine import signal_engine
from app.engine.auto_executor import auto_executor
from app import db
from app import telegram_notify
from app.bybit_client import (
    DEMO_BASE, get_base, get_api_key, bybit_get, bybit_post,
    get_order_pnl, get_order_rr, is_closing_order, ts_to_iso, is_today_utc,
)
from dataclasses import asdict

load_dotenv()

# ── WebSocket Manager ─────────────────────────────────────────────
class ConnectionManager:
    def __init__(self): self.active: list[WebSocket] = []
    async def connect(self, ws):
        await ws.accept(); self.active.append(ws)
    def disconnect(self, ws):
        if ws in self.active: self.active.remove(ws)
    async def broadcast(self, data: dict):
        msg = json.dumps(data, default=str)
        for ws in self.active[:]:
            try: await ws.send_text(msg)
            except: self.active.remove(ws)

manager = ConnectionManager()

# ── Full-Auto watcher ─────────────────────────────────────────────
async def full_auto_watcher():
    print("[AUTO] Full-auto watcher started")
    while True:
        try:
            if auto_executor.mode == "FULL-AUTO" and not auto_executor.paused:
                # Previously only entered this block when len(signals) had
                # changed since the last pass -- with 2 symbols mostly
                # producing 0-2 signals that replace rather than accumulate,
                # the count rarely changes between 30s checks, so this
                # almost never re-examined whether anything unexecuted was
                # sitting there. Check every pass instead; executed_ids
                # already prevents re-executing the same signal twice.
                signals = signal_engine.get_active()
                for sig in signals:
                    if auto_executor.trades_today >= auto_executor.settings.get("maxTradesPerDay", 3):
                        print(f"[AUTO] Daily limit hit ({auto_executor.trades_today}) — stopping")
                        break
                    if sig.get("status") == "ACTIVE" and sig.get("id") not in auto_executor.executed_ids:
                        print(f"[AUTO] Executing: {sig['symbol']} {sig['direction']}")
                        result = await auto_executor.execute_signal(sig)
                        if result.get("success"):
                            signal_engine.mark_executed(sig["id"])
                            signal_engine.clear_error(sig["id"])
                            await manager.broadcast({
                                "type": "auto_executed",
                                "result": result,
                                "timestamp": datetime.utcnow().isoformat(),
                            })
                        else:
                            err = result.get("reason") or result.get("error") or "Order failed"
                            signal_engine.set_error(sig["id"], err)
                            await manager.broadcast({
                                "type": "execute_error",
                                "signal_id": sig["id"],
                                "error": err,
                                "timestamp": datetime.utcnow().isoformat(),
                            })
                            print(f"[AUTO] Execute failed: {err}")
        except Exception as e:
            print(f"[AUTO] Error: {e}")
        await asyncio.sleep(30)

async def daily_reset():
    while True:
        now  = datetime.utcnow()
        secs = (24 * 3600) - (now.hour * 3600 + now.minute * 60 + now.second)
        await asyncio.sleep(secs)
        auto_executor.reset_daily()
        print("[RESET] Daily counters reset")

# ── Keep-alive ────────────────────────────────────────────────────
# Render free tier spins this service down after 15 min with zero inbound
# traffic — and once asleep, signal_engine.run() and run_be_monitor() stop
# executing entirely (open positions go unmonitored, no new signals fire).
# This pings the backend's OWN public /health endpoint every 10 minutes
# (comfortably under the 15-min threshold, not wastefully frequent) to keep
# generating inbound traffic. This is a workaround, not a guarantee: it only
# keeps an already-running instance awake, it cannot wake one that's already
# spun down (that needs an external visitor/request), and Render's free tier
# is capped at 750 instance-hours/workspace/month — running this 24/7 uses
# ~730 of those on the backend alone, so there's very little headroom left
# for the frontend service or anything else in the same workspace. If uptime
# genuinely matters (open positions, live capital), Render's own guidance is
# that a paid instance -- which doesn't spin down at all -- is the reliable
# fix; this keep-alive is the free-tier best-effort version of that.
KEEPALIVE_INTERVAL_S = 600  # 10 min — useful on hosts that idle-sleep free tiers
def _self_url() -> str:
    # Prefer explicit override, then Render, then Fly app hostname
    for key in ("SELF_URL", "RENDER_EXTERNAL_URL"):
        v = os.getenv(key)
        if v:
            return v.rstrip("/")
    fly_app = os.getenv("FLY_APP_NAME")
    if fly_app:
        return f"https://{fly_app}.fly.dev"
    return ""

SELF_URL = _self_url()

async def keepalive_ping():
    if not SELF_URL:
        print("[KEEPALIVE] No SELF_URL/RENDER_EXTERNAL_URL/FLY_APP_NAME -- skipping "
              "(ok on always-on Fly with min_machines_running=1)")
        return
    url = f"{SELF_URL}/health"
    print(f"[KEEPALIVE] Pinging {url} every {KEEPALIVE_INTERVAL_S}s")
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            await asyncio.sleep(KEEPALIVE_INTERVAL_S)
            try:
                r = await client.get(url)
                print(f"[KEEPALIVE] {r.status_code} @ {datetime.utcnow().isoformat()}")
            except Exception as e:
                print(f"[KEEPALIVE] ping failed: {e}")

# ── Lifespan ──────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 SmartEdge Trader backend starting...")
    print(f"   API Key set: {bool(get_api_key())}")
    print(f"   Telegram: {'on' if telegram_notify.enabled() else 'off'}")
    try:
        pool = await db.get_pool()
        print(f"   Supabase DB: {'connected' if pool else 'not configured / failed'}")
        stored = await db.load_settings()
        if stored:
            auto_executor.update_settings(stored)
            print("   Loaded settings from Supabase")
    except Exception as e:
        print(f"   Supabase init: {e}")
    signal_engine.set_broadcast(manager.broadcast)
    auto_executor.set_broadcast(manager.broadcast)
    asyncio.create_task(signal_engine.run())
    asyncio.create_task(auto_executor.run_be_monitor())
    asyncio.create_task(full_auto_watcher())
    asyncio.create_task(daily_reset())
    asyncio.create_task(keepalive_ping())
    print("   All engines started ✅")
    yield
    signal_engine.stop()
    auto_executor.stop()

app = FastAPI(title="SmartEdge Trader API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# ── Routes ────────────────────────────────────────────────────────
@app.get("/")
async def root():
    index = Path("/app/static/index.html")
    if index.exists():
        return FileResponse(index)
    return {"app": "SmartEdge Trader", "status": "online", "mode": auto_executor.mode}

@app.get("/health")
async def health():
    equity = None
    available = None
    open_positions = 0
    try:
        data = await bybit_get("/v5/account/wallet-balance", {"accountType": "UNIFIED"})
        if data.get("retCode") == 0:
            acc = (data.get("result", {}).get("list") or [{}])[0]
            equity = float(acc.get("totalEquity") or 0)
            available = float(acc.get("totalAvailableBalance") or 0)
        pos = await bybit_get("/v5/position/list", {"category": "linear", "settleCoin": "USDT"})
        if pos.get("retCode") == 0:
            open_positions = sum(
                1 for p in pos["result"].get("list", [])
                if p.get("symbol") == "XRPUSDT" and float(p.get("size") or 0) > 0
            )
    except Exception:
        pass
    return {
        "status": "ok",
        "ok": True,
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.1.0",
        "execution_mode": auto_executor.mode,
        "paused": auto_executor.paused,
        "api_key_set": bool(get_api_key()),
        "endpoint": get_base(),
        "account_mode": os.getenv("ACCOUNT_MODE", "DEMO"),
        "equity": equity,
        "available": available,
        "open_positions": open_positions,
        "signals_active": len(signal_engine.get_active()),
        "trades_today": auto_executor.trades_today,
        "last_scan_at": getattr(signal_engine, "last_scan_at", None),
        "last_scan_result": getattr(signal_engine, "last_scan_result", None),
        "last_be_check_at": getattr(auto_executor, "last_be_check_at", None),
        "last_be_move_at": getattr(auto_executor, "last_be_move_at", None),
        "last_be_symbol": getattr(auto_executor, "last_be_symbol", None),
        "last_order": getattr(auto_executor, "last_order", None),
        "supabase": await db.db_status(),
    }

@app.get("/api/status")
async def api_status():
    """Same payload as /health for the dashboard status strip."""
    return await health()

@app.get("/api/portfolio")
async def get_portfolio():
    try:
        # Balance
        data   = await bybit_get("/v5/account/wallet-balance", {"accountType": "UNIFIED"})
        if data.get("retCode") != 0: raise Exception(data.get("retMsg"))
        lst    = data["result"]["list"]
        acc    = lst[0] if lst else {}
        equity = float(acc.get("totalEquity") or 0)
        free   = float(acc.get("totalAvailableBalance") or 0)

        # Daily P&L from closed orders (not transaction log)
        orders_data = await bybit_get("/v5/order/history",
                                      {"category": "linear", "limit": "50"})
        daily_pnl        = 0.0
        trades_today_count = 0
        if orders_data.get("retCode") == 0:
            for o in orders_data["result"].get("list", []):
                if o.get("symbol") != "XRPUSDT":
                    continue
                created = o.get("createdTime") or "0"
                if is_today_utc(created) and o.get("orderStatus") in ("Filled", "PartiallyFilled") and is_closing_order(o):
                    trades_today_count += 1
                    daily_pnl += get_order_pnl(o)

        # Sync executor
        auto_executor.trades_today = trades_today_count

        try:
            await db.save_equity(equity, free, 0)
        except Exception:
            pass
        return {
            "balance":             equity,
            "free":                free,
            "used":                equity - free,
            "daily_pnl":           round(daily_pnl, 4),
            "daily_pnl_pct":       round((daily_pnl / equity * 100) if equity else 0, 4),
            "open_positions":      0,
            "trades_today":        trades_today_count,
            "daily_loss_used_pct": round((abs(min(0, daily_pnl)) / equity * 100) if equity else 0, 2),
            "source": "bybit_demo",
        }
    except Exception as e:
        print(f"[PORTFOLIO] {e}")
        return {"balance": 0, "free": 0, "used": 0, "daily_pnl": 0,
                "daily_pnl_pct": 0, "source": "error", "error": str(e)}

@app.get("/api/positions")
async def get_positions():
    try:
        data = await bybit_get("/v5/position/list",
                               {"category": "linear", "settleCoin": "USDT"})
        if data.get("retCode") != 0: raise Exception(data.get("retMsg"))
        positions = []
        for p in data["result"].get("list", []):
            if p.get("symbol") != "XRPUSDT":
                continue
            size = float(p.get("size") or 0)
            if size == 0: continue
            entry   = float(p.get("avgPrice")      or 0)
            current = float(p.get("markPrice")     or entry)
            pnl     = float(p.get("unrealisedPnl") or 0)
            pct     = (pnl / (entry * size)) * 100 if entry and size else 0
            sl      = float(p.get("stopLoss")  or 0)
            risk    = abs(entry - sl)
            rr      = abs(pnl / (risk * size)) if risk and size else 0
            positions.append({
                "id":          p.get("symbol", ""),   # one position per symbol at a time by design -- symbol is the stable, always-unique id (positionIdx is 0 in one-way mode for every position, not a real identifier)
                "symbol":      p.get("symbol", ""),
                "direction":   "LONG" if p.get("side") == "Buy" else "SHORT",
                "entry":       entry, "current": current,
                "tp":          float(p.get("takeProfit") or 0),
                "sl":          sl, "be": entry, "size": size,
                "pnl":         round(pnl, 4),
                "pnlPct":      round(pct, 4),
                "status":      "BE" if sl == entry and entry > 0 else "OPEN",
                "rrAchieved":  round(rr, 2),
                "market":      "crypto",
                "openTime":    ts_to_iso(p.get("createdTime") or "0"),
            })
        return {"positions": positions, "source": "bybit_demo"}
    except Exception as e:
        print(f"[POSITIONS] {e}")
        return {"positions": [], "source": "error", "error": str(e)}

@app.get("/api/signals")
async def get_signals():
    return {
        "signals": signal_engine.get_active(),
        "source":  "engine",
        "count":   len(signal_engine.get_active()),
    }

@app.get("/api/history")
async def get_history(limit: int = 100, offset: int = 0):
    try:
        # Bybit v5 order-history pagination is cursor-based, not a simple
        # numeric offset -- rather than chase cursors, fetch a generous
        # single batch (200, Bybit's practical per-call ceiling, which
        # comfortably covers months of this strategy's actual trade volume
        # at ~1 trade every 1.6-2.3 days) and paginate offset/limit over the
        # already-fetched list. offset was previously accepted by the
        # frontend but silently ignored here -- same response every time
        # regardless of what page was requested.
        data = await bybit_get("/v5/order/history",
                               {"category": "linear", "limit": "200"})
        if data.get("retCode") != 0: raise Exception(data.get("retMsg"))

        trades  = []
        running = 0.0
        # Process oldest first for running PnL
        orders  = list(reversed(data["result"].get("list", [])))
        for o in orders:
            if o.get("symbol") != "XRPUSDT":
                continue
            if o.get("orderStatus") not in ("Filled", "PartiallyFilled"):
                continue
            if not is_closing_order(o):
                continue  # entry order, not a completed trade -- see is_closing_order
            pnl      = get_order_pnl(o)
            running += pnl
            created  = o.get("createdTime") or o.get("updatedTime") or "0"
            # Determine TP or SL based on order type
            stop_order_type = o.get("stopOrderType", "")
            trigger = o.get("triggerBy", "")
            if "TakeProfit" in stop_order_type or "tp" in trigger.lower():
                status = "TP"
            elif "StopLoss" in stop_order_type or "sl" in trigger.lower():
                status = "SL"
            elif pnl > 0:
                status = "TP"
            else:
                status = "SL"

            trades.append({
                "id":         o.get("orderId"),
                "symbol":     o.get("symbol", ""),
                "direction":  "LONG" if o.get("side") == "Buy" else "SHORT",
                "pnl":        round(pnl, 4),
                "runningPnl": round(running, 4),
                "status":     status,
                "rr":         get_order_rr(o),
                "date":       ts_to_iso(created),
                "market":     "crypto",
                "duration":   "—",
            })

        # Return newest first, then apply the requested page
        trades.reverse()
        total = len(trades)
        trades = trades[offset:offset + min(limit, 200)]
        # Persist XRP closes into Supabase (best-effort)
        for tr in trades[:20]:
            try:
                await db.save_trade(tr)
            except Exception:
                pass
        return {"trades": trades, "total": total, "source": "bybit_demo"}
    except Exception as e:
        print(f"[HISTORY] {e}")
        return {"trades": [], "total": 0, "source": "error", "error": str(e)}

@app.post("/api/settings")
async def update_settings(settings: dict):
    auto_executor.update_settings(settings)
    try:
        await db.save_settings(settings)
    except Exception as e:
        print(f"[SETTINGS] db save: {e}")
    return {"success": True, "settings": settings}

@app.post("/api/mode/{mode}")
async def set_mode(mode: str):
    if mode not in ("MANUAL", "SEMI-AUTO", "FULL-AUTO"):
        return {"success": False, "error": "Invalid mode"}
    auto_executor.set_mode(mode)
    await manager.broadcast({"type": "mode_change", "mode": mode,
                             "timestamp": datetime.utcnow().isoformat()})
    return {"success": True, "mode": mode}

@app.post("/api/pause/{state}")
async def set_pause(state: str):
    paused = state.lower() == "true"
    auto_executor.set_paused(paused)
    await manager.broadcast({"type": "pause_change", "paused": paused,
                             "timestamp": datetime.utcnow().isoformat()})
    return {"success": True, "paused": paused}

@app.post("/api/execute/{signal_id}")
async def execute_signal(signal_id: str):
    sig = next((s for s in signal_engine.signals if s.id == signal_id), None)
    if not sig:
        return {"success": False, "error": "Signal not found", "reason": "Signal not found"}
    result = await auto_executor.execute_signal(asdict(sig))
    if result.get("success"):
        signal_engine.mark_executed(signal_id)
        signal_engine.clear_error(signal_id)
    else:
        err = result.get("reason") or result.get("error") or "Order failed"
        signal_engine.set_error(signal_id, err)
        result.setdefault("error", err)
        result.setdefault("reason", err)
    return result

@app.post("/api/positions/{position_id}/close")
async def close_position(position_id: str, reason: str = "manual"):
    """position_id is the symbol (see get_positions -- id is always the
    symbol, one position per symbol by design). Closing an OPEN position on
    Bybit is a reduce-only market order on the opposite side, not an order
    cancel -- /v5/order/cancel only cancels orders that haven't filled yet,
    which is a different thing from a filled position that's already open.
    The previous implementation called cancel with the position's id as if
    it were an orderId; it would have errored or silently done nothing
    against a real open position."""
    try:
        symbol = position_id.replace("/", "")
        pos_data = await bybit_get("/v5/position/list",
                                   {"category": "linear", "symbol": symbol, "settleCoin": "USDT"})
        if pos_data.get("retCode") != 0:
            return {"success": False, "error": pos_data.get("retMsg", "Could not fetch position")}
        plist = pos_data["result"].get("list", [])
        pos = next((p for p in plist if float(p.get("size") or 0) > 0), None)
        if not pos:
            return {"success": False, "error": "No open position found for this symbol"}

        size = pos["size"]
        side = pos.get("side")  # "Buy" or "Sell" -- the CURRENT position's side
        close_side = "Sell" if side == "Buy" else "Buy"  # opposite side closes it

        data = await bybit_post("/v5/order/create", {
            "category":   "linear",
            "symbol":     symbol,
            "side":       close_side,
            "orderType":  "Market",
            "qty":        str(size),
            "reduceOnly": True,
            "timeInForce": "IOC",
        })
        print(f"[POSITIONS] Closing {symbol} ({reason}): qty={size} side={close_side}")
        return {"success": data.get("retCode") == 0, "result": data}
    except Exception as e:
        return {"success": False, "error": str(e)}

# ── WebSocket ─────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    print("INFO:     connection open")
    try:
        await websocket.send_text(json.dumps({
            "type": "signal_update",
            "signals": signal_engine.get_active(),
            "timestamp": datetime.utcnow().isoformat(),
        }))
        await websocket.send_text(json.dumps({
            "type": "mode_change", "mode": auto_executor.mode,
        }))
    except: pass

    try:
        while True:
            try:
                data = await bybit_get("/v5/position/list",
                                       {"category": "linear", "settleCoin": "USDT"})
                positions = []
                if data.get("retCode") == 0:
                    for p in data["result"].get("list", []):
                        if p.get("symbol") != "XRPUSDT":
                            continue
                        size = float(p.get("size") or 0)
                        if size == 0: continue
                        entry = float(p.get("avgPrice") or 0)
                        sl    = float(p.get("stopLoss") or 0)
                        positions.append({
                            "id":        p.get("positionIdx") or p.get("symbol"),
                            "symbol":    p.get("symbol", ""),
                            "direction": "LONG" if p.get("side") == "Buy" else "SHORT",
                            "entry":     entry,
                            "current":   float(p.get("markPrice") or 0),
                            "pnl":       round(float(p.get("unrealisedPnl") or 0), 4),
                            "tp":        float(p.get("takeProfit") or 0),
                            "sl":        sl,
                            "status":    "BE" if sl == entry and entry > 0 else "OPEN",
                            "rrAchieved": 0, "market": "crypto",
                        })
                await manager.broadcast({
                    "type": "position_update",
                    "positions": positions,
                    "timestamp": datetime.utcnow().isoformat(),
                })
            except Exception as e:
                print(f"[WS] {e}")
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        print("INFO:     connection closed")


# ── Frontend SPA (same origin) ────────────────────────────────────
_STATIC = Path(__file__).resolve().parent.parent / "static"
if not _STATIC.exists():
    _STATIC = Path("/app/static")

if _STATIC.exists() and (_STATIC / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=str(_STATIC / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        # Do not swallow API routes (already registered above)
        file_path = _STATIC / full_path
        if full_path and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(_STATIC / "index.html")
    print(f"[APP] Serving SPA from {_STATIC}")
else:
    print(f"[APP] No SPA static dir at {_STATIC} — API only")

