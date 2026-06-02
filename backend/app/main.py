"""
SmartEdge Trader — FastAPI Backend
Live Bybit integration via ccxt
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import json
import os
import ccxt.async_support as ccxt
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# ── Exchange init ─────────────────────────────────────────────────
def get_exchange():
    config = {
        "apiKey": os.getenv("BYBIT_API_KEY", ""),
        "secret": os.getenv("BYBIT_API_SECRET", ""),
        "enableRateLimit": True,
        "options": {"defaultType": "unified"},
    }
    if os.getenv("BYBIT_TESTNET", "true").lower() == "true":
        config["testnet"] = True
    return ccxt.bybit(config)

# ── Lifespan ──────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 SmartEdge Trader backend starting...")
    yield
    print("🛑 Shutting down...")

app = FastAPI(title="SmartEdge Trader API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── WebSocket Manager ─────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict):
        msg = json.dumps(data, default=str)
        for ws in self.active[:]:
            try:
                await ws.send_text(msg)
            except Exception:
                self.active.remove(ws)

manager = ConnectionManager()

# ── Routes ────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"app": "SmartEdge Trader", "status": "online", "docs": "/docs"}

@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat(), "version": "1.0.0"}

@app.get("/api/portfolio")
async def get_portfolio():
    exchange = get_exchange()
    try:
        has_keys = bool(os.getenv("BYBIT_API_KEY"))
        if not has_keys:
            raise Exception("No API keys")

        balance = await exchange.fetch_balance()
        usdt = balance.get("USDT", {})
        total = float(usdt.get("total", 0) or 0)
        free  = float(usdt.get("free",  0) or 0)
        used  = float(usdt.get("used",  0) or 0)

        return {
            "balance": total,
            "free": free,
            "used": used,
            "daily_pnl": 0,
            "daily_pnl_pct": 0,
            "open_positions": 0,
            "trades_today": 0,
            "daily_loss_used_pct": 0,
            "source": "bybit_live",
            "testnet": os.getenv("BYBIT_TESTNET", "true"),
        }
    except Exception as e:
        print(f"[PORTFOLIO] Error: {e}")
        return {
            "balance": 12480.50,
            "free": 12480.50,
            "used": 0,
            "daily_pnl": 168.90,
            "daily_pnl_pct": 1.37,
            "open_positions": 0,
            "trades_today": 0,
            "daily_loss_used_pct": 0,
            "source": "mock",
            "error": str(e),
        }
    finally:
        await exchange.close()

@app.get("/api/positions")
async def get_positions():
    exchange = get_exchange()
    try:
        has_keys = bool(os.getenv("BYBIT_API_KEY"))
        if not has_keys:
            raise Exception("No API keys")

        raw = await exchange.fetch_positions()
        positions = []
        for p in raw:
            size = float(p.get("contracts") or 0)
            if size == 0:
                continue
            entry  = float(p.get("entryPrice") or 0)
            current = float(p.get("markPrice") or entry)
            side   = "LONG" if p.get("side") == "long" else "SHORT"
            pnl    = float(p.get("unrealizedPnl") or 0)
            pct    = (pnl / (entry * size)) * 100 if entry and size else 0

            positions.append({
                "id": p.get("id") or p.get("symbol"),
                "symbol": p.get("symbol", ""),
                "direction": side,
                "entry": entry,
                "current": current,
                "tp": float(p.get("takeProfit") or 0),
                "sl": float(p.get("stopLoss") or 0),
                "size": size,
                "pnl": round(pnl, 2),
                "pnlPct": round(pct, 2),
                "status": "OPEN",
                "rrAchieved": 0,
                "mlScore": 0,
                "market": "crypto",
                "openTime": p.get("timestamp") or datetime.utcnow().isoformat(),
            })
        return {"positions": positions, "source": "bybit_live"}
    except Exception as e:
        print(f"[POSITIONS] Error: {e}")
        return {"positions": [], "source": "mock", "error": str(e)}
    finally:
        await exchange.close()

@app.get("/api/signals")
async def get_signals():
    # Signals come from signal engine — returns empty until engine runs
    return {"signals": [], "source": "engine"}

@app.get("/api/history")
async def get_history(limit: int = 50, offset: int = 0):
    exchange = get_exchange()
    try:
        has_keys = bool(os.getenv("BYBIT_API_KEY"))
        if not has_keys:
            raise Exception("No API keys")

        orders = await exchange.fetch_closed_orders(limit=limit)
        trades = []
        for o in orders:
            if o.get("status") != "closed":
                continue
            trades.append({
                "id": o.get("id"),
                "symbol": o.get("symbol", ""),
                "direction": "LONG" if o.get("side") == "buy" else "SHORT",
                "pnl": float(o.get("profit") or 0),
                "status": "TP" if float(o.get("profit") or 0) > 0 else "SL",
                "date": o.get("datetime") or datetime.utcnow().isoformat(),
                "market": "crypto",
                "duration": "—",
                "mlScore": 0,
                "rr": "0",
                "runningPnl": 0,
            })
        return {"trades": trades, "total": len(trades), "source": "bybit_live"}
    except Exception as e:
        print(f"[HISTORY] Error: {e}")
        return {"trades": [], "total": 0, "source": "mock", "error": str(e)}
    finally:
        await exchange.close()

@app.post("/api/settings")
async def update_settings(settings: dict):
    return {"success": True, "settings": settings}

@app.post("/api/positions/{position_id}/close")
async def close_position(position_id: str, reason: str = "manual"):
    exchange = get_exchange()
    try:
        result = await exchange.cancel_order(position_id)
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        await exchange.close()

# ── WebSocket ─────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    print("INFO:     connection open")
    try:
        while True:
            # Fetch live positions every 2s and broadcast
            exchange = get_exchange()
            try:
                if os.getenv("BYBIT_API_KEY"):
                    raw = await exchange.fetch_positions()
                    positions = []
                    for p in raw:
                        size = float(p.get("contracts") or 0)
                        if size == 0:
                            continue
                        positions.append({
                            "id": p.get("id") or p.get("symbol"),
                            "symbol": p.get("symbol", ""),
                            "direction": "LONG" if p.get("side") == "long" else "SHORT",
                            "entry": float(p.get("entryPrice") or 0),
                            "current": float(p.get("markPrice") or 0),
                            "pnl": float(p.get("unrealizedPnl") or 0),
                            "status": "OPEN",
                            "rrAchieved": 0,
                            "mlScore": 0,
                            "market": "crypto",
                        })
                    await manager.broadcast({
                        "type": "position_update",
                        "positions": positions,
                        "timestamp": datetime.utcnow().isoformat(),
                    })
            except Exception as e:
                print(f"[WS] Fetch error: {e}")
            finally:
                await exchange.close()

            await asyncio.sleep(2)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        print("INFO:     connection closed")
