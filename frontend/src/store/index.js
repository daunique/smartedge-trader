import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const generateId = () => Math.random().toString(36).substr(2, 9)

const initialPositions = [
  {
    id: generateId(), symbol: 'BTC/USDT', direction: 'LONG',
    entry: 67420, current: 68150, tp: 69680, sl: 66500, be: 68200,
    size: 0.15, status: 'OPEN', rrAchieved: 0.85, mlScore: 0.82,
    pnl: 109.5, pnlPct: 1.08, openTime: Date.now() - 3600000, market: 'crypto'
  },
  {
    id: generateId(), symbol: 'ETH/USDT', direction: 'LONG',
    entry: 3580, current: 3612, tp: 3760, sl: 3520, be: 3640,
    size: 1.2, status: 'OPEN', rrAchieved: 0.53, mlScore: 0.74,
    pnl: 38.4, pnlPct: 0.89, openTime: Date.now() - 1800000, market: 'crypto'
  },
]

const generateHistory = () => {
  const symbols = ['BTC/USDT','ETH/USDT','SOL/USDT','EUR/USD','GBP/USD','USD/JPY','XRP/USDT','BNB/USDT']
  const history = []
  let runningPnl = 0
  for (let i = 29; i >= 0; i--) {
    const win = Math.random() > 0.42
    const pnl = win ? +(Math.random() * 280 + 80).toFixed(2) : -(Math.random() * 90 + 20).toFixed(2)
    runningPnl += pnl
    history.push({
      id: generateId(),
      symbol: symbols[Math.floor(Math.random() * symbols.length)],
      direction: Math.random() > 0.5 ? 'LONG' : 'SHORT',
      pnl, runningPnl: +runningPnl.toFixed(2),
      rr: win ? (Math.random() * 2 + 1.5).toFixed(1) : '0',
      mlScore: +(Math.random() * 0.3 + 0.65).toFixed(2),
      status: win ? 'TP' : 'SL',
      date: new Date(Date.now() - i * 86400000 * 0.7).toISOString(),
      market: Math.random() > 0.5 ? 'crypto' : 'forex',
      duration: Math.floor(Math.random() * 180 + 15) + 'm'
    })
  }
  return history
}

const DEFAULT_SETTINGS = {
  riskPerTrade: 1,
  minRR: 3,
  maxTradesPerDay: 3,
  dailyLossLimit: 2,
  orbTimeframe: 15,
  beTrigger: 1,
  trailingStop: true,
  mlThreshold: 0.65,
  notifications: true,
  mobileAlerts: true,
  apiKey: '',
  apiSecret: '',
}

export const useStore = create(
  persist(
    (set, get) => ({
      // ── Persisted state (survives refresh) ──────────────────────
      executionMode: 'SEMI-AUTO',
      accountMode:   'DEMO',
      marketFilter:  'ALL',
      settings:      DEFAULT_SETTINGS,

      // ── Non-persisted (reset on refresh, loaded from backend) ───
      activePage:        'dashboard',
      sidebarOpen:       false,
      systemPaused:      false,
      backendConnected:  false,
      wsConnected:       false,
      livePrices:        {},
      positions:         initialPositions,
      signals:           [],
      tradeHistory:      generateHistory(),
      portfolioBalance:  0,
      dailyPnl:          0,
      dailyPnlPct:       0,
      weeklyPnl:         842.30,
      monthlyPnl:        3240.80,
      winRate:           58,
      avgRR:             2.4,
      totalTrades:       247,
      currentStreak:     4,
      maxDrawdown:       3.2,
      sharpeRatio:       2.18,

      // ── Actions ─────────────────────────────────────────────────
      setExecutionMode:    (mode) => set({ executionMode: mode }),
      setAccountMode:      (mode) => set({ accountMode: mode }),
      setMarketFilter:     (f)    => set({ marketFilter: f }),
      setActivePage:       (page) => set({ activePage: page }),
      setSidebarOpen:      (v)    => set({ sidebarOpen: v }),
      setPaused:           (v)    => set({ systemPaused: v }),
      setBackendConnected: (v)    => set({ backendConnected: v }),
      setWsConnected:      (v)    => set({ wsConnected: v }),
      updateLivePrices:    (p)    => set({ livePrices: p }),

      updateSettings: (updates) => set(state => ({
        settings: { ...state.settings, ...updates }
      })),

      refreshPositions: (positions) => set({ positions }),
      refreshSignals:   (signals)   => set({ signals }),

      updatePosition: (id, updates) => set(state => ({
        positions: state.positions.map(p => p.id === id ? { ...p, ...updates } : p)
      })),
      closePosition: (id) => set(state => ({
        positions: state.positions.filter(p => p.id !== id)
      })),
      dismissSignal: (id) => set(state => ({
        signals: state.signals.filter(s => s.id !== id)
      })),

      refreshPortfolio: (data) => set({
        portfolioBalance: data.balance        ?? get().portfolioBalance,
        dailyPnl:         data.daily_pnl      ?? get().dailyPnl,
        dailyPnlPct:      data.daily_pnl_pct  ?? get().dailyPnlPct,
        winRate:          data.win_rate        ?? get().winRate,
        avgRR:            data.avg_rr          ?? get().avgRR,
      }),

      setActiveExchange: (ex) => set({ activeExchange: ex }),
      activeExchange: 'bybit',
    }),
    {
      name: 'smartedge-store',   // localStorage key
      partialState: (state) => ({
        // Only persist these fields
        executionMode: state.executionMode,
        accountMode:   state.accountMode,
        marketFilter:  state.marketFilter,
        settings:      state.settings,
      }),
    }
  )
)
