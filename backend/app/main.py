"""
SmartEdge Trader — FastAPI Backend
Full autonomous trading: signals + auto-execution + BE monitor
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio, json, os, hmac, hashlib, time
import httpx
from datetime import datetime
from dotenv import load_dotenv
from app.engine.signal_engine import signal_engine
from app.engine.auto_executor import auto_executor

load_dotenv()

DEMO_BASE  = "https://api-demo.bybit.com"
API_KEY    = os.getenv("BYBIT_API_KEY", "")
API_SECRET = os.getenv("BYBIT_API_SECRET", "")

def sign_headers(params: dict) -> dict:
    # Use larger recv_window to handle server clock drift
    ts          = str(int(time.time() * 1000))
    recv_window = "20000"
    param_str   = ts + API_KEY + recv_window + "&".join(
        f"{k}={v}" for k, v in sorted(params.items())
    )
    sig = hmac.new(API_SECRET.encode(), param_str.encode(), hashlib.sha256).hexdigest()
    return {
        "X-BAPI-API-KEY":     API_KEY,
        "X-BAPI-TIMESTAMP":   ts,
        "X-BAPI-SIGN":        sig,
        "X-BAPI-RECV-WINDOW": recv_window,
    }

async def bybit_get(path: str, params: dict = {}) -> dict:
    headers = sign_headers(params)
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{DEMO_BASE}{path}", params=params, headers=headers)
        return r.json()

async def bybit_post(path: str, body: dict = {}) -> dict:
    ts          = str(int(time.time() * 1000))
    recv_window = "20000"
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

# ── Full-Auto signal watcher ──────────────────────────────────────
async def full_auto_watcher():
    """
    When mode = FULL-AUTO, auto-execute new ACTIVE signals.
    Only runs during signal engine scan cycles to avoid spam.
    """
    print("[AUTO] Full-auto watcher started")
    last_scan_count = 0
    while True:
        try:
            if auto_executor.mode == "FULL-AUTO" and not auto_executor.paused:
                signals   = signal_engine.get_active()
                new_count = len(signals)

                # Only attempt execution when signal list has changed
                if new_count != last_scan_count:
                    last_scan_count = new_count
                    executed_this_cycle = 0
                    for sig in signals:
                        sig_id = sig.get("id")
                        if sig.get("status") == "ACTIVE" and sig_id not in auto_executor.executed_ids:
                            # Stop if daily limit already hit
                            if auto_executor.trades_today >= auto_executor.settings.get("maxTradesPerDay", 3):
                                print(f"[AUTO] Daily limit hit ({auto_executor.trades_today}) — skipping remaining signals")
                                break
                            print(f"[AUTO] Executing: {sig['symbol']} {sig['direction']}")
                            result = await auto_executor.execute_signal(sig)
                            if result.get("success"):
                                executed_this_cycle += 1
                                await manager.broadcast({
                                    "type":      "auto_executed",
                                    "result":    result,
                                    "timestamp": datetime.utcnow().isoformat(),
                                })
                    if executed_this_cycle:
                        print(f"[AUTO] Cycle complete — {executed_this_cycle} trades placed")
        except Exception as e:
            print(f"[AUTO] Watcher error: {e}")
        await asyncio.sleep(30)

# ── Daily reset at midnight UTC ───────────────────────────────────
async def daily_reset():
    while True:
        now = datetime.utcnow()
        secs_to_midnight = (24 * 3600) - (now.hour * 3600 + now.minute * 60 + now.second)
        await asyncio.sleep(secs_to_midnight)
        auto_executor.reset_daily()
        print("[RESET] Daily counters reset")

# ── Lifespan ──────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 SmartEdge Trader backend starting...")
    print(f"   Mode:        {os.getenv('ACCOUNT_MODE', 'DEMO')}")
    print(f"   API Key set: {bool(API_KEY)}")
    print(f"   Endpoint:    {DEMO_BASE}")

    signal_engine.set_broadcast(manager.broadcast)
    auto_executor.set_broadcast(manager.broadcast)

    asyncio.create_task(signal_engine.run())
    asyncio.create_task(auto_executor.run_be_monitor())
    asyncio.create_task(full_auto_watcher())
    asyncio.create_task(daily_reset())

    print("   Signal engine:   started ✅")
    print("   Auto executor:   started ✅")
    print("   BE monitor:      started ✅")
    yield
    signal_engine.stop()
    auto_executor.stop()
    print("🛑 Shutting down...")

app = FastAPI(title="SmartEdge Trader API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# ── Routes ────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"app": "SmartEdge Trader", "status": "online",
            "mode": auto_executor.mode, "docs": "/docs"}

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0",
        "execution_mode": auto_executor.mode,
        "paused": auto_executor.paused,
        "api_key_set": bool(API_KEY),
        "signals_active": len(signal_engine.get_active()),
        "trades_today": auto_executor.trades_today,
        "endpoint": DEMO_BASE,
    }

@app.get("/api/portfolio")
async def get_portfolio():
    try:
        data   = await bybit_get("/v5/account/wallet-balance", {"accountType": "UNIFIED"})
        if data.get("retCode") != 0: raise Exception(data.get("retMsg"))
        lst    = data["result"]["list"]
        acc    = lst[0] if lst else {}
        equity = float(acc.get("totalEquity") or 0)
        free   = float(acc.get("totalAvailableBalance") or 0)

        pnl_data  = await bybit_get("/v5/account/transaction-log",
                                    {"accountType": "UNIFIED", "limit": "50"})
        daily_pnl = 0
        if pnl_data.get("retCode") == 0:
            today = datetime.utcnow().date().isoformat()
            for tx in pnl_data["result"].get("list", []):
                tx_date = datetime.utcfromtimestamp(
                    int(tx.get("transactionTime", 0)) / 1000
                ).date().isoformat()
                if tx_date == today:
                    daily_pnl += float(tx.get("cashFlow") or 0)

        return {
            "balance":              equity,
            "free":                 free,
            "used":                 equity - free,
            "daily_pnl":           round(daily_pnl, 2),
            "daily_pnl_pct":       round((daily_pnl/equity*100) if equity else 0, 2),
            "open_positions":       0,
            "trades_today":         auto_executor.trades_today,
            "daily_loss_used_pct":  round((auto_executor.daily_loss/equity*100) if equity else 0, 2),
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
            size = float(p.get("size") or 0)
            if size == 0: continue
            entry   = float(p.get("avgPrice")      or 0)
            current = float(p.get("markPrice")     or entry)
            pnl     = float(p.get("unrealisedPnl") or 0)
            pct     = (pnl / (entry * size)) * 100 if entry and size else 0
            sl      = float(p.get("stopLoss")  or 0)
            risk    = abs(entry - sl)
            rr      = abs(pnl / (risk * size)) if risk and size else 0
            be_triggered = sl == entry and entry > 0
            positions.append({
                "id":          p.get("positionIdx") or p.get("symbol"),
                "symbol":      p.get("symbol", ""),
                "direction":   "LONG" if p.get("side") == "Buy" else "SHORT",
                "entry":       entry, "current": current,
                "tp":          float(p.get("takeProfit") or 0),
                "sl":          sl, "be": entry, "size": size,
                "pnl":         round(pnl, 2),
                "pnlPct":      round(pct, 2),
                "status":      "BE" if be_triggered else "OPEN",
                "rrAchieved":  round(rr, 2),
                "mlScore":     0, "market": "crypto",
                "openTime":    p.get("createdTime") or datetime.utcnow().isoformat(),
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
async def get_history(limit: int = 50):
    try:
        data = await bybit_get("/v5/order/history",
                               {"category": "linear", "limit": str(limit)})
        if data.get("retCode") != 0: raise Exception(data.get("retMsg"))
        trades  = []
        running = 0.0
        for o in data["result"].get("list", []):
            pnl = float(o.get("cumExecFee") or 0) * -1
            running += pnl
            trades.append({
                "id":         o.get("orderId"),
                "symbol":     o.get("symbol", ""),
                "direction":  "LONG" if o.get("side") == "Buy" else "SHORT",
                "pnl":        round(pnl, 2),
                "runningPnl": round(running, 2),
                "status":     "TP" if pnl >= 0 else "SL",
                "rr": "0", "mlScore": 0,
                "date":       o.get("createdTime") or datetime.utcnow().isoformat(),
                "market":     "crypto", "duration": "—",
            })
        return {"trades": trades, "total": len(trades), "source": "bybit_demo"}
    except Exception as e:
        print(f"[HISTORY] {e}")
        return {"trades": [], "total": 0, "source": "error", "error": str(e)}

@app.post("/api/settings")
async def update_settings(settings: dict):
    auto_executor.update_settings(settings)
    if "mlThreshold" in settings:
        signal_engine.threshold = float(settings["mlThreshold"])
    return {"success": True, "settings": settings}

@app.post("/api/mode/{mode}")
async def set_mode(mode: str):
    if mode not in ("MANUAL", "SEMI-AUTO", "FULL-AUTO"):
        return {"success": False, "error": "Invalid mode"}
    auto_executor.set_mode(mode)
    print(f"[MODE] Switched to {mode}")
    await manager.broadcast({
        "type": "mode_change", "mode": mode,
        "timestamp": datetime.utcnow().isoformat()
    })
    return {"success": True, "mode": mode}

@app.post("/api/pause/{state}")
async def set_pause(state: str):
    paused = state.lower() == "true"
    auto_executor.set_paused(paused)
    await manager.broadcast({
        "type": "pause_change", "paused": paused,
        "timestamp": datetime.utcnow().isoformat()
    })
    return {"success": True, "paused": paused}

@app.post("/api/execute/{signal_id}")
async def execute_signal(signal_id: str):
    sig = next((s for s in signal_engine.signals if s.id == signal_id), None)
    if not sig:
        return {"success": False, "error": "Signal not found"}
    result = await auto_executor.execute_signal(asdict(sig))
    return result

@app.post("/api/positions/{position_id}/close")
async def close_position(position_id: str):
    try:
        data = await bybit_post("/v5/order/cancel",
                                {"category": "linear", "orderId": position_id})
        return {"success": data.get("retCode") == 0, "result": data}
    except Exception as e:
        return {"success": False, "error": str(e)}

# ── WebSocket ─────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    print("INFO:     connection open")

    # Send current state on connect
    try:
        await websocket.send_text(json.dumps({
            "type":    "signal_update",
            "signals": signal_engine.get_active(),
            "timestamp": datetime.utcnow().isoformat(),
        }))
        await websocket.send_text(json.dumps({
            "type": "mode_change",
            "mode": auto_executor.mode,
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
                            "pnl":       round(float(p.get("unrealisedPnl") or 0), 2),
                            "tp":        float(p.get("takeProfit") or 0),
                            "sl":        sl,
                            "status":    "BE" if sl == entry and entry > 0 else "OPEN",
                            "rrAchieved": 0, "mlScore": 0, "market": "crypto",
                        })
                await manager.broadcast({
                    "type":      "position_update",
                    "positions": positions,
                    "timestamp": datetime.utcnow().isoformat(),
                })
            except Exception as e:
                print(f"[WS] {e}")
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        print("INFO:     connection closed")

# Fix import
from dataclasses import asdict
