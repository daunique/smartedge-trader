# SmartEdge Trader

Automated crypto trading system for **XRPUSDT** on Bybit
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
| Risk per trade | XRP 10% of equity, leverage derived from stop distance |
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
- ML confidence filter removed entirely (backend scoring function, frontend
  displays/controls, `scikit-learn`/`xgboost` deps) — it was a hand-weighted
  heuristic, not a trained model, and wasn't part of what was backtested.
- Removed dead code never actually imported anywhere (`trade_manager.py`,
  `exchange/bybit.py`) and trimmed `requirements.txt` to what's really used.
- Risk-per-trade is per-symbol (XRP 10%) with leverage set
  explicitly on the exchange to match, not left at whatever Bybit defaulted
  to; `minRR`/breakeven/daily-loss defaults match what was backtested.
- Bybit request-signing, previously duplicated independently in two files,
  consolidated into one shared `bybit_client.py`.

**Debugging pass fixes** (each verified against mocked Bybit responses, not
just read for correctness — see `bybit_client.py`/`auto_executor.py`
comments for the specifics of each):
- Position close, R:R history, and daily-loss tracking were each either
  computing wrong values or not wired up to real data at all.
- `full_auto_watcher` had a broken trigger condition that made it almost
  never fire; there was no protection anywhere against opening a second
  position on a pair that already had one open, unlike the backtest.
- Signals hard-expired 1 hour after firing regardless of execution state,
  so a trade running longer than an hour lost its own signal card.
- A position could end up open with no stop-loss at all; entry now
  verifies SL attached and the BE monitor self-heals any naked position
  found on any 10s pass, not just at entry.
- Every entry order was being counted as its own phantom loss (an entry's
  `closedPnl` is always 0), corrupting daily P&L and win/loss streaks —
  now filtered to closing orders only.
- BE-trigger checks used only the instantaneous price at each poll, so
  a spike that touched the trigger and pulled back before the next poll
  landed was never detected — now tracks a per-position high-water mark;
  breakeven also moves to a small buffer past entry now, not exactly
  entry, matching the backtest (avoids a "breakeven" exit still net-losing
  to fees).
- The actual cause of BE never firing: every call that modifies a position
  (BE move, emergency SL) hardcoded `positionIdx: 0`, which only holds in
  one-way mode — wrong in hedge mode, and every such call would fail
  silently (`except: return False`, no logging). Now reads the real
  positionIdx from the position itself, logs Bybit's actual retCode/retMsg
  on any failure, and verifies the SL actually changed after a BE move
  instead of trusting a success response alone. BE-monitor interval also
  tightened from 30s to 10s.
