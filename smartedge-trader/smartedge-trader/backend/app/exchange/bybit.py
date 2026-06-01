"""
Bybit Exchange Connector (CEX)
Supports: Crypto spot + futures + Forex via Bybit
Modes: DEMO (paper) | LIVE
"""

import ccxt
import os
from typing import Optional
from datetime import datetime


class BybitConnector:
    """
    Unified Bybit connector for crypto and forex markets.
    Uses ccxt library for standardized API access.
    """

    SUPPORTED_MARKETS = {
        "crypto": ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "BNB/USDT"],
        "forex": ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD"],
    }

    def __init__(self, mode: str = "DEMO"):
        self.mode = mode
        self.exchange = self._init_exchange()
        self.demo_balance = 10000.0  # paper trading balance
        self.demo_positions = {}

    def _init_exchange(self) -> ccxt.bybit:
        config = {
            "apiKey": os.getenv("BYBIT_API_KEY", ""),
            "secret": os.getenv("BYBIT_API_SECRET", ""),
            "enableRateLimit": True,
            "options": {
                "defaultType": "linear",  # USDT perpetual
            }
        }
        if self.mode == "DEMO":
            config["sandbox"] = True  # Bybit testnet

        exchange = ccxt.bybit(config)
        return exchange

    # ── Market Data ───────────────────────────────────────────────
    async def fetch_ohlcv(self, symbol: str, timeframe: str = "15m", limit: int = 100) -> list:
        """Fetch OHLCV candles"""
        try:
            data = await self.exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
            return [{"timestamp": d[0], "open": d[1], "high": d[2], "low": d[3], "close": d[4], "volume": d[5]}
                    for d in data]
        except Exception as e:
            print(f"[BYBIT] OHLCV error for {symbol}: {e}")
            return []

    async def fetch_ticker(self, symbol: str) -> Optional[dict]:
        try:
            ticker = await self.exchange.fetch_ticker(symbol)
            return {
                "symbol": symbol,
                "bid": ticker["bid"],
                "ask": ticker["ask"],
                "last": ticker["last"],
                "volume": ticker["baseVolume"],
                "timestamp": ticker["timestamp"],
            }
        except Exception as e:
            print(f"[BYBIT] Ticker error for {symbol}: {e}")
            return None

    async def fetch_orderbook(self, symbol: str, limit: int = 5) -> Optional[dict]:
        try:
            ob = await self.exchange.fetch_order_book(symbol, limit)
            return {"bids": ob["bids"], "asks": ob["asks"]}
        except Exception as e:
            print(f"[BYBIT] Orderbook error: {e}")
            return None

    # ── Order Execution ───────────────────────────────────────────
    async def place_order(self, symbol: str, direction: str, size: float,
                          tp: float, sl: float) -> dict:
        """Place market order with TP and SL attached"""
        if self.mode == "DEMO":
            return self._paper_trade(symbol, direction, size, tp, sl)

        try:
            side = "buy" if direction == "LONG" else "sell"
            # Place market order
            order = await self.exchange.create_order(
                symbol=symbol,
                type="market",
                side=side,
                amount=size,
                params={
                    "takeProfit": str(tp),
                    "stopLoss": str(sl),
                    "tpTriggerBy": "LastPrice",
                    "slTriggerBy": "LastPrice",
                }
            )
            return {
                "id": order["id"],
                "symbol": symbol,
                "direction": direction,
                "size": size,
                "tp": tp,
                "sl": sl,
                "status": "filled",
                "timestamp": datetime.utcnow().isoformat(),
            }
        except Exception as e:
            print(f"[BYBIT] Order error: {e}")
            return {"error": str(e)}

    async def update_sl(self, order_id: str, symbol: str, new_sl: float) -> dict:
        """Update stop-loss (for trailing / break-even)"""
        if self.mode == "DEMO":
            return {"success": True, "new_sl": new_sl}
        try:
            result = await self.exchange.edit_order(
                id=order_id, symbol=symbol, type="market",
                side=None, amount=None,
                params={"stopLoss": str(new_sl)}
            )
            return {"success": True, "new_sl": new_sl}
        except Exception as e:
            return {"error": str(e)}

    async def close_position(self, symbol: str, direction: str, size: float) -> dict:
        """Close a position at market"""
        if self.mode == "DEMO":
            return {"success": True, "message": "Demo position closed"}
        try:
            side = "sell" if direction == "LONG" else "buy"
            order = await self.exchange.create_order(
                symbol=symbol, type="market", side=side, amount=size,
                params={"reduceOnly": True}
            )
            return {"success": True, "order_id": order["id"]}
        except Exception as e:
            return {"error": str(e)}

    async def get_positions(self) -> list:
        """Fetch all open positions from exchange"""
        if self.mode == "DEMO":
            return list(self.demo_positions.values())
        try:
            positions = await self.exchange.fetch_positions()
            return [p for p in positions if p["contracts"] > 0]
        except Exception as e:
            print(f"[BYBIT] Positions error: {e}")
            return []

    async def get_balance(self) -> float:
        if self.mode == "DEMO":
            return self.demo_balance
        try:
            balance = await self.exchange.fetch_balance()
            return float(balance["USDT"]["free"])
        except Exception as e:
            return 0.0

    # ── Paper Trading ─────────────────────────────────────────────
    def _paper_trade(self, symbol: str, direction: str, size: float,
                     tp: float, sl: float) -> dict:
        import uuid
        pos_id = str(uuid.uuid4())
        self.demo_positions[pos_id] = {
            "id": pos_id, "symbol": symbol, "direction": direction,
            "size": size, "tp": tp, "sl": sl, "status": "open",
            "timestamp": datetime.utcnow().isoformat()
        }
        return {"id": pos_id, "status": "demo_filled", "symbol": symbol,
                "direction": direction, "size": size, "tp": tp, "sl": sl}
