# SmartEdge Trader 🚀
**Professional Autonomous Trading System — Crypto & Forex**

> VWAP + ORB signals · ML confidence filter · Auto TP/SL/BE · Bybit CEX/DEX · Dark Pro UI

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TailwindCSS + Recharts |
| Backend | FastAPI (Python 3.11) |
| Signal Engine | VWAP + ORB + ATR-based TP/SL/BE |
| ML Filter | XGBoost / scikit-learn |
| Exchange | Bybit via ccxt (crypto + forex) |
| Real-time | WebSocket + Redis Pub/Sub |
| Deployment | Render (frontend + backend) |

---

## Project Structure

```
smartedge-trader/
├── frontend/                  # React dashboard
│   ├── src/
│   │   ├── components/
│   │   │   ├── dashboard/     # Main dashboard
│   │   │   ├── history/       # Trade history
│   │   │   ├── statistics/    # Performance analytics
│   │   │   ├── settings/      # Configuration panel
│   │   │   └── shared/        # Header, Sidebar
│   │   ├── store/             # Zustand global state
│   │   └── App.jsx
│   ├── package.json
│   └── vite.config.js
├── backend/                   # FastAPI backend
│   ├── app/
│   │   ├── main.py            # FastAPI app + WebSocket
│   │   ├── engine/
│   │   │   ├── signal_engine.py    # VWAP + ORB + ML
│   │   │   └── trade_manager.py   # Auto TP/SL/BE
│   │   └── exchange/
│   │       └── bybit.py       # Bybit connector
│   └── requirements.txt
├── render.yaml                # Render deployment config
├── .env.example               # Environment template
└── .gitignore
```

---

## Local Development

### Prerequisites
- Node.js 18+
- Python 3.11+
- Git

### 1. Clone & Setup

```bash
git clone https://github.com/YOUR_USERNAME/smartedge-trader.git
cd smartedge-trader
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
# Runs at http://localhost:5173
```

### 3. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example ../.env        # Fill in your values
uvicorn app.main:app --reload --port 8000
# Runs at http://localhost:8000
```

---

## Deploy to Render

### Step 1 — Push to GitHub

```bash
cd smartedge-trader
git init
git add .
git commit -m "Initial commit — SmartEdge Trader"
git remote add origin https://github.com/YOUR_USERNAME/smartedge-trader.git
git push -u origin main
```

### Step 2 — Create Render Account
Go to [render.com](https://render.com) → Sign up with GitHub

### Step 3A — Deploy Frontend (Static Site or Web Service)

1. Click **New +** → **Web Service**
2. Connect your GitHub repo
3. Configure:
   - **Root Directory:** `frontend`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run preview`
   - **Environment:** `Node`

### Step 3B — Deploy Backend (Web Service)

1. Click **New +** → **Web Service**
2. Connect same GitHub repo
3. Configure:
   - **Root Directory:** `backend`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Environment:** `Python 3`

### Step 4 — Set Environment Variables in Render Dashboard

For the **backend** service, add these in Render's Environment tab:

```
BYBIT_API_KEY          = your_key
BYBIT_API_SECRET       = your_secret
BYBIT_TESTNET          = true
JWT_SECRET             = (generate a long random string)
ACCOUNT_MODE           = DEMO
ML_THRESHOLD           = 0.65
```

### Step 5 — Auto Deploy
Every `git push` to `main` triggers automatic redeploy on Render.

---

## Build & Start Commands Summary

| Service | Build Command | Start Command |
|---|---|---|
| Frontend | `npm install && npm run build` | `npm run preview` |
| Backend | `pip install -r requirements.txt` | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |

---

## Bybit API Setup

1. Log in to [bybit.com](https://bybit.com)
2. Go to **Account** → **API Management** → **Create New Key**
3. Permissions needed:
   - ✅ Read
   - ✅ Trade (Unified Trading)
   - ❌ Withdraw (NEVER enable)
4. Add your server IP to the whitelist (use Render's IP)
5. For **demo/testnet**: use [testnet.bybit.com](https://testnet.bybit.com)

---

## Autonomous Mode Safety Checklist

Before FULL-AUTO executes any trade, all checks must pass:

- ✅ ML score ≥ threshold (default 65%)
- ✅ Within trading hours (ORB window)
- ✅ Daily loss < limit (default 2%)
- ✅ Max trades not hit (default 3/day)
- ✅ Exchange API connected
- ✅ System not paused

---

## Adding More Exchanges (Future)

The connector interface is unified. To add OKX or Binance:

```python
# backend/app/exchange/okx.py
import ccxt

class OkxConnector:
    def __init__(self, mode="DEMO"):
        self.exchange = ccxt.okx({...})
    # Same interface as bybit.py
```

---

## License
MIT — Build freely, trade responsibly.

---

> ⚠️ **Disclaimer:** This software is for educational purposes. 
> Trading involves significant risk. Past performance does not guarantee future results.
> Always test thoroughly on demo before going live.
