"""
SmartEdge Trader — FastAPI Backend
Bybit Demo Trading via direct V5 API calls
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio, json, os, hmac, hashlib, time
import httpx
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

DEMO_BASE = "https://api-demo.bybit.com"
API_KEY    = os.getenv("BYBIT_API_KEY", "")
API_SECRET = os.getenv("BYBIT_API_SECRET", "")

# ── Bybit V5 signed request ───────────────────────────────────────
def sign(params: dict) -> dict:
    ts        = str(int(time.time() * 1000))
    recv_window = "5000"
    param_str = ts + API_KEY + recv_window + "&".join(f"{k}={v}" for k, v in sorted(params.items()))
    signature = hmac.new(API_SECRET.encode(), param_str.encode(), hashlib.sha256).hexdigest()
    return {
        "X-BAPI-API-KEY":     API_KEY,
        "X-BAPI-TIMESTAMP":   ts,
        "X-BAPI-SIGN":        signature,
        "X-BAPI-RECV-WINDOW": recv_window,
        "Content-Type":       "application/json",
    }

async def bybit_get(path: str, params: dict = {}) -> dict:
    headers = sign(params)
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{DEMO_BASE}{path}", params=params, headers=headers)
        return r.json()

async def bybit_post(path: str, body: dict = {}) -> dict:
    ts          = str(int(time.time() * 1000))
    recv_window = "5000"
    body_str    = json.dumps(body)
    param_str   = ts + API_KEY + recv_window + body_str
    signature   = hmac.new(API_SECRET.encode(), param_str.encode(), hashlib.sha256).hexdigest()
    headers = {
        "X-BAPI-API-KEY":     API_KEY,
        "X-BAPI-TIMESTAMP":   ts,
        "X-BAPI-SIGN":        signature,
        "X-BAPI-RECV-WINDOW": recv_window,
        "Content-Type":       "application/json",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{DEMO_BASE}{path}", content=body_str, headers=headers)
        return r.json()

# ── Lifespan ──────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 SmartEdge Trader backend starting...")
    print(f"   Mode: {os.getenv('ACCOUNT_MODE', 'DEMO')}")
    print(f"   API Key set: {bool(API_KEY)}")
    print(f"   Endpoint: {DEMO_BASE}")
    yield
    print("🛑 Shutting down...")

app = FastAPI(title="SmartEdge Trader API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# ── WebSocket Manager ─────────────────────────────────────────────
class ConnectionManager:
    def __init__(self): self.active: list[WebSocket] = []
    async def connect(self, ws):
        await ws.accept(); self.active.append(ws)
    def disconnect(self, ws):
        if ws in self.active: self.active.remove(ws)
    async def broadcast(self, data):
        msg = json.dumps(data, default=str)
        for ws in self.active[:]:
            try: await ws.send_text(msg)
            except: self.active.remove(ws)

manager = ConnectionManager()

# ── Routes ────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"app": "SmartEdge Trader", "status": "online",
            "mode": os.getenv("ACCOUNT_MODE", "DEMO"), "docs": "/docs"}

@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat(),
            "version": "1.0.0", "mode": os.getenv("ACCOUNT_MODE", "DEMO"),
            "api_key_set": bool(API_KEY), "endpoint": DEMO_BASE}

@app.get("/api/portfolio")
async def get_portfolio():
    try:
        data = await bybit_get("/v5/account/wallet-balance", {"accountType": "UNIFIED"})
        if data.get("retCode") != 0:
            raise Exception(data.get("retMsg", "Unknown error"))
        lst    = data["result"]["list"]
        acc    = lst[0] if lst else {}
        equity = float(acc.get("totalEquity") or 0)
        free   = float(acc.get("totalAvailableBalance") or 0)
        used   = equity - free

        # Daily PnL
        pnl_data = await bybit_get("/v5/account/transaction-log",
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
            "balance": equity, "free": free, "used": used,
            "daily_pnl": round(daily_pnl, 2),
            "daily_pnl_pct": round((daily_pnl / equity * 100) if equity else 0, 2),
            "open_positions": 0, "trades_today": 0,
            "daily_loss_used_pct": 0, "source": "bybit_demo",
        }
    except Exception as e:
        print(f"[PORTFOLIO] Error: {e}")
        return {"balance": 0, "free": 0, "used": 0, "daily_pnl": 0,
                "daily_pnl_pct": 0, "source": "error", "error": str(e)}

@app.get("/api/positions")
async def get_positions():
    try:
        data = await bybit_get("/v5/position/list",
                               {"category": "linear", "settleCoin": "USDT"})
        if data.get("retCode") != 0:
            raise Exception(data.get("retMsg"))
        positions = []
        for p in data["result"].get("list", []):
            size = float(p.get("size") or 0)
            if size == 0: continue
            entry   = float(p.get("avgPrice")   or 0)
            current = float(p.get("markPrice")  or entry)
            pnl     = float(p.get("unrealisedPnl") or 0)
            pct     = (pnl / (entry * size)) * 100 if entry and size else 0
            side    = "LONG" if p.get("side") == "Buy" else "SHORT"
            positions.append({
                "id":        p.get("positionIdx") or p.get("symbol"),
                "symbol":    p.get("symbol", ""),
                "direction": side,
                "entry":     entry,
                "current":   current,
                "tp":        float(p.get("takeProfit") or 0),
                "sl":        float(p.get("stopLoss")   or 0),
                "be":        entry,
                "size":      size,
                "pnl":       round(pnl, 2),
                "pnlPct":    round(pct, 2),
                "status":    "OPEN",
                "rrAchieved": 0,
                "mlScore":   0,
                "market":    "crypto",
                "openTime":  p.get("createdTime") or datetime.utcnow().isoformat(),
            })
        return {"positions": positions, "source": "bybit_demo"}
    except Exception as e:
        print(f"[POSITIONS] Error: {e}")
        return {"positions": [], "source": "error", "error": str(e)}

@app.get("/api/signals")
async def get_signals():
    return {"signals": [], "source": "engine"}

@app.get("/api/history")
async def get_history(limit: int = 50):
    try:
        data = await bybit_get("/v5/order/history",
                               {"category": "linear", "limit": str(limit)})
        if data.get("retCode") != 0:
            raise Exception(data.get("retMsg"))
        trades = []
        running = 0
        for o in data["result"].get("list", []):
            pnl = float(o.get("cumExecFee") or 0) * -1
            running += pnl
            trades.append({
                "id":        o.get("orderId"),
                "symbol":    o.get("symbol", ""),
                "direction": "LONG" if o.get("side") == "Buy" else "SHORT",
                "pnl":       round(pnl, 2),
                "runningPnl": round(running, 2),
                "status":    "TP" if pnl >= 0 else "SL",
                "rr":        "0", "mlScore": 0,
                "date":      o.get("createdTime") or datetime.utcnow().isoformat(),
                "market":    "crypto", "duration": "—",
            })
        return {"trades": trades, "total": len(trades), "source": "bybit_demo"}
    except Exception as e:
        print(f"[HISTORY] Error: {e}")
        return {"trades": [], "total": 0, "source": "error", "error": str(e)}

@app.post("/api/settings")
async def update_settings(settings: dict):
    return {"success": True, "settings": settings}

@app.post("/api/positions/{position_id}/close")
async def close_position(position_id: str, reason: str = "manual"):
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
                        positions.append({
                            "id":        p.get("positionIdx") or p.get("symbol"),
                            "symbol":    p.get("symbol", ""),
                            "direction": "LONG" if p.get("side") == "Buy" else "SHORT",
                            "entry":     float(p.get("avgPrice")      or 0),
                            "current":   float(p.get("markPrice")     or 0),
                            "pnl":       round(float(p.get("unrealisedPnl") or 0), 2),
                            "status":    "OPEN", "rrAchieved": 0,
                            "mlScore":   0, "market": "crypto",
                        })
                await manager.broadcast({
                    "type": "position_update",
                    "positions": positions,
                    "timestamp": datetime.utcnow().isoformat(),
                })
            except Exception as e:
                print(f"[WS] Error: {e}")
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        print("INFO:     connection closed")
