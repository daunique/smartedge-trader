# SmartEdge Trader

Automated crypto trading system for **XRPUSDT** and **ETHUSDT** on Bybit
(demo or live). Strategy is a fixed SMA-cross + candle-structure confluence,
validated by backtest on Jan–Jun 2026 1H data (single train/test split, not
a full walk-forward — see the backtest report for methodology and limits).
No ML component: the strategy conditions only on the rules below, nothing
learned/fitted.

## Strategy

| | XRPUSDT | ETHUSDT |
|---|---|---|
| Trend filter | SMA(50) vs SMA(200) | SMA(100) vs SMA(200) |
| Entry trigger | candle body-ratio > 0.789, in trend direction | candle range > 1.52× its 20-period average, in trend direction |
| Volatility filter | both: skip when ATR is in the top 40% of its trailing 30-day range |
| Stop / Target | both: SL = 1.5×ATR(14), TP = 4.5×ATR(14) (fixed 3:1 R:R) |
| Breakeven | both: SL moves to entry once price is 1.5R in favor |
| Risk per trade | XRP 6% · ETH 5% of equity, leverage derived from stop distance |
| Candles | 1H, 24/7 — no session/time-of-day gating |

Change one side of a pair (e.g. just the entry trigger) and you're no longer
running the validated combination — treat these as one unit, not five
independent settings.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TailwindCSS |
| Backend | FastAPI (Python 3.11) |
| Signal engine | `backend/app/engine/signal_engine.py` — SMA/ATR/candle math + Bybit kline fetch |
| Execution | `backend/app/engine/auto_executor.py` — sizing, SL/TP/BE placement, signed Bybit REST calls |
| Exchange | Bybit USDT perpetuals, demo or live via `BYBIT_TESTNET` |
| Realtime | WebSocket broadcast from backend to frontend |

## Structure

```
backend/app/
  main.py              FastAPI app, REST + WebSocket routes
  bybit_client.py       shared signed-request client (used by both files below)
  engine/
    signal_engine.py   strategy: indicators, entry logic, signal generation
    auto_executor.py   position sizing, order placement, BE monitor, safety checks
frontend/src/          React app (dashboard, signals, positions, history, settings)
render.yaml            Render deploy config (frontend + backend services)
```

## Run locally

```bash
# backend
cd backend
pip install -r requirements.txt
cp ../.env.example ../.env   # fill in BYBIT_API_KEY / BYBIT_API_SECRET
uvicorn app.main:app --reload

# frontend
cd frontend
npm install
npm run dev
```

Defaults to `BYBIT_TESTNET=true` / `ACCOUNT_MODE=DEMO`. Confirm both are
still set that way before switching to live trading with real funds.

## Keep-alive

Render's free tier spins the backend down after 15 min with no inbound
traffic — and once asleep, signal scanning and the breakeven monitor stop
running entirely, so open positions go unwatched. The backend pings its own
`/health` every 10 minutes (`RENDER_EXTERNAL_URL`, set automatically on
Render) to prevent that.

This is a best-effort workaround, not a guarantee — it can't wake an
instance that's already spun down, and running 24/7 this way uses ~730 of
Render's 750 free instance-hours/month by itself, leaving little headroom
for the frontend service in the same workspace. If you're holding live
positions and uptime actually matters, a paid Render instance (no spin-down
at all) is the reliable version of this, not the free-tier ping.

## Changed from the original template

- Strategy replaced end-to-end (was VWAP + Opening Range Breakout on 15m
  candles with London/NY session gating — now SMA-cross + candle-structure
  on 1H candles, 24/7, per the table above).
- ML confidence filter removed (backend scoring function, frontend
  confidence displays and threshold controls, `scikit-learn`/`xgboost` deps).
  It was a hand-weighted heuristic, not a trained model, and wasn't part of
  what was backtested.
- Removed two files that were never actually imported anywhere:
  `engine/trade_manager.py` and `exchange/bybit.py` (an unused `ccxt`
  connector — live execution goes through direct signed REST calls instead).
- `requirements.txt` trimmed to what's actually imported (was carrying
  unused `redis`, `sqlalchemy`, `alembic`, `asyncpg`, `python-jose`,
  `passlib`, `schedule`, `pandas`, `pydantic-settings`).
- Risk-per-trade is now per-symbol (XRP 6% / ETH 5%) instead of one flat
  number, and `minRR`/breakeven/daily-loss defaults now match what was
  actually backtested rather than a template placeholder.
- Debugging pass: Bybit request-signing logic (was independently duplicated
  in `main.py` and `auto_executor.py`) consolidated into `bybit_client.py`;
  `/api/history`'s R:R was hardcoded to `"0"` on every trade, now computed
  from each order's real entry/TP/SL; the daily-loss safety limit tracked a
  counter that was never actually updated (always read as 0% loss, could
  never trip) and now syncs from real closed-order P&L before every trade;
  closing a position from the dashboard called Bybit's order-cancel endpoint
  against an open position (wrong endpoint for that) with no UI button that
  could even reach it -- now a real reduce-only close order, with a Close
  button on each position; orders were also being sized assuming leverage
  the exchange account was never actually configured to allow (Bybit
  leverage is a persistent per-symbol account setting, not a per-order
  param), causing "insufficient margin" rejections on otherwise-correctly-
  sized trades -- leverage is now set explicitly before every order.
