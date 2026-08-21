from pathlib import Path
import os
"""
SmartEdge Trader — FastAPI Backend
Live Bybit Demo + Signal Engine + Auto Execution
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
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
    get_order_pnl, get_order_rr, is_closing_order, ts_to_iso, is_today_utc, fetch_closed_pnl,
)
from dataclasses import asdict

load_dotenv()

# ── WebSocket Manager ─────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws):
        await ws.accept()
        if ws not in self.active:
            self.active.append(ws)

    def disconnect(self, ws):
        try:
            self.active.remove(ws)
        except ValueError:
            pass

    async def broadcast(self, data: dict):
        msg = json.dumps(data, default=str)
        dead = []
        for ws in list(self.active):
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            try:
                self.active.remove(ws)
            except ValueError:
                pass

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
        # Persistence: in-memory only (Supabase removed)
        print("   DB: in-memory (no Supabase)")
        stored = await db.load_settings()
        if stored:
            auto_executor.update_settings(stored)
            print("   Loaded settings from memory")
    except Exception as e:
        print(f"   DB init: {e}")
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

@app.head("/")
async def head_root():
    """Uptime probes often use HEAD / — must not 500."""
    return Response(status_code=200)

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
        "db": await db.db_status(),
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

        # Daily realized PnL from closed-pnl (accurate $ vs order-history fees)
        daily_pnl = 0.0
        trades_today_count = 0
        try:
            closed_rows = await fetch_closed_pnl("XRPUSDT", 50)
            for row in closed_rows:
                created = row.get("createdTime") or row.get("updatedTime") or "0"
                if not is_today_utc(created):
                    continue
                trades_today_count += 1
                try:
                    daily_pnl += float(row.get("closedPnl") or 0)
                except (TypeError, ValueError):
                    pass
        except Exception as _e:
            print(f"[PORTFOLIO] closed-pnl fallback: {_e}")

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
    """Stable open-position payload for the dashboard.
    R is measured vs initial stop distance (or TP/3 if SL already at BE)
    so progress does not explode when break-even is hit."""
    try:
        data = await bybit_get("/v5/position/list",
                               {"category": "linear", "settleCoin": "USDT"})
        if data.get("retCode") != 0:
            raise Exception(data.get("retMsg"))
        positions = []
        for p in data["result"].get("list", []):
            if p.get("symbol") != "XRPUSDT":
                continue
            size = float(p.get("size") or 0)
            if size <= 0:
                continue
            entry = float(p.get("avgPrice") or 0)
            current = float(p.get("markPrice") or entry)
            pnl = float(p.get("unrealisedPnl") or 0)
            sl = float(p.get("stopLoss") or 0)
            tp = float(p.get("takeProfit") or 0)
            lev_raw = p.get("leverage") or p.get("positionIM") or 0
            try:
                leverage = float(lev_raw) if lev_raw not in (None, "") else 0.0
            except (TypeError, ValueError):
                leverage = 0.0
            # Position value / IM as fallback leverage estimate
            if leverage <= 0 and entry and size:
                im = float(p.get("positionIM") or p.get("positionIMByMp") or 0)
                if im > 0:
                    leverage = round((entry * size) / im, 2)

            # Stable 1R distance: prefer distance to TP scaled by strategy 3R,
            # else |entry-sl| when SL is still away from entry
            risk_px = 0.0
            if tp > 0 and entry > 0:
                risk_px = abs(tp - entry) / 3.0
            if risk_px <= 0 and sl > 0 and entry > 0:
                risk_px = abs(entry - sl)
            if risk_px <= 0 and entry > 0:
                risk_px = entry * 0.01  # last-resort 1%

            direction = "LONG" if p.get("side") == "Buy" else "SHORT"
            # Signed R from mark vs entry
            move = (current - entry) if direction == "LONG" else (entry - current)
            rr = move / risk_px if risk_px > 0 else 0.0

            be_active = entry > 0 and sl > 0 and abs(sl - entry) / entry < 0.002
            margin = float(p.get("positionIM") or p.get("positionIMByMp") or 0)
            notional = entry * size if entry and size else 0.0
            pct = (pnl / margin * 100) if margin > 0 else (
                (pnl / notional * 100) if notional else 0.0
            )

            positions.append({
                "id": p.get("symbol", "XRPUSDT"),
                "symbol": p.get("symbol", "XRPUSDT"),
                "direction": direction,
                "entry": round(entry, 6),
                "current": round(current, 6),
                "tp": round(tp, 6),
                "sl": round(sl, 6),
                "be": round(entry, 6),
                "size": round(size, 6),
                "leverage": round(leverage, 2) if leverage else None,
                "margin": round(margin, 4),
                "notional": round(notional, 4),
                "pnl": round(pnl, 4),
                "pnlPct": round(pct, 4),
                "status": "BE" if be_active else "OPEN",
                "rrAchieved": round(rr, 2),
                "riskPx": round(risk_px, 8),
                "market": "crypto",
                "openTime": ts_to_iso(p.get("createdTime") or "0"),
            })
        return {"positions": positions, "source": "bybit", "ok": True}
    except Exception as e:
        print(f"[POSITIONS] {e}")
        # ok=False so frontend keeps last good snapshot instead of wiping
        return {"positions": [], "source": "error", "ok": False, "error": str(e)}

@app.get("/api/signals")
async def get_signals():
    return {
        "signals": signal_engine.get_active(),
        "source":  "engine",
        "count":   len(signal_engine.get_active()),
    }

@app.get("/api/history")
async def get_history(limit: int = 100, offset: int = 0):
    """Closed trades from Bybit closed-pnl (true realized $ PnL)."""
    try:
        rows = await fetch_closed_pnl("XRPUSDT", min(limit + offset, 100))
        # API returns newest first — reverse for running total
        chronological = list(reversed(rows))
        built = []
        running = 0.0
        for row in chronological:
            try:
                pnl = float(row.get("closedPnl") or 0)
            except (TypeError, ValueError):
                pnl = 0.0
            running += pnl
            side = (row.get("side") or "").capitalize()
            # Bybit closed-pnl: Buy = long position closed, Sell = short closed
            direction = "LONG" if side == "Buy" else "SHORT"
            entry = float(row.get("avgEntryPrice") or 0)
            exit_px = float(row.get("avgExitPrice") or 0)
            qty = float(row.get("closedSize") or row.get("qty") or 0)
            created = row.get("createdTime") or row.get("updatedTime") or "0"
            # Classify exit roughly
            if pnl > 0.01:
                status = "TP"
            elif pnl < -0.01:
                status = "SL"
            else:
                status = "BE"
            built.append({
                "id": row.get("orderId") or row.get("execId") or f"{created}-{qty}",
                "symbol": row.get("symbol") or "XRPUSDT",
                "direction": direction,
                "entry": round(entry, 6),
                "exit": round(exit_px, 6),
                "size": qty,
                "pnl": round(pnl, 4),
                "runningPnl": round(running, 4),
                "status": status,
                "rr": "—",
                "date": ts_to_iso(created),
                "market": "crypto",
                "duration": "—",
            })
        # newest first for UI
        built.reverse()
        total = len(built)
        trades = built[offset: offset + limit]
        for tr in trades[:20]:
            try:
                await db.save_trade(tr)
            except Exception:
                pass
        return {"trades": trades, "total": total, "source": "bybit_closed_pnl", "ok": True}
    except Exception as e:
        print(f"[HISTORY] {e}")
        return {"trades": [], "total": 0, "source": "error", "ok": False, "error": str(e)}


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

