"""
SmartEdge Trader — FastAPI Backend
Handles: signals, positions, trade engine, exchange connectors, ML filter
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import asyncio
import json
import os
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# ── Lifespan ─────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 SmartEdge Trader backend starting...")
    # Start background tasks here
    yield
    print("🛑 SmartEdge Trader backend shutting down...")

# ── App ───────────────────────────────────────────────────────────
app = FastAPI(
    title="SmartEdge Trader API",
    version="1.0.0",
    lifespan=lifespan
)

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
        self.active.remove(ws)

    async def broadcast(self, data: dict):
        msg = json.dumps(data)
        for ws in self.active[:]:
            try:
                await ws.send_text(msg)
            except Exception:
                self.active.remove(ws)

manager = ConnectionManager()

# ── Routes ────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat(), "version": "1.0.0"}

@app.get("/api/signals")
async def get_signals():
    """Return current active signals from signal engine"""
    from app.engine.signal_engine import SignalEngine
    engine = SignalEngine()
    return {"signals": engine.get_active_signals()}

@app.get("/api/positions")
async def get_positions():
    """Return all open positions"""
    from app.engine.trade_manager import TradeManager
    tm = TradeManager()
    return {"positions": tm.get_open_positions()}

@app.post("/api/positions/{position_id}/close")
async def close_position(position_id: str, reason: str = "manual"):
    from app.engine.trade_manager import TradeManager
    tm = TradeManager()
    result = tm.close_position(position_id, reason)
    return {"success": True, "result": result}

@app.get("/api/portfolio")
async def get_portfolio():
    return {
        "balance": 12480.50,
        "daily_pnl": 168.90,
        "daily_pnl_pct": 1.37,
        "open_positions": 3,
        "trades_today": 1,
        "daily_loss_used_pct": 0.8,
    }

@app.post("/api/settings")
async def update_settings(settings: dict):
    # Persist to DB / env
    return {"success": True, "settings": settings}

@app.get("/api/history")
async def get_history(limit: int = 50, offset: int = 0):
    return {"trades": [], "total": 0}

# ── WebSocket endpoint ────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Send live position updates every 500ms
            await manager.broadcast({
                "type": "position_update",
                "timestamp": datetime.utcnow().isoformat(),
                "positions": []  # populated from TradeManager
            })
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
