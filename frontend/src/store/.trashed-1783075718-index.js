import { create } from 'zustand'

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
  {
    id: generateId(), symbol: 'EUR/USD', direction: 'SHORT',
    entry: 1.0842, current: 1.0821, tp: 1.0778, sl: 1.0878, be: 1.0842,
    size: 10000, status: 'BE', rrAchieved: 0.58, mlScore: 0.79,
    pnl: 21.0, pnlPct: 0.19, openTime: Date.now() - 7200000, market: 'forex'
  }
]

const generateSignals = () => [
  {
    id: generateId(), symbol: 'SOL/USDT', direction: 'LONG',
    entry: 172.40, tp: 181.20, sl: 168.80, rr: '1:2.4',
    mlScore: 0.88, confidence: 88, status: 'ACTIVE',
    timeframe: '15M', market: 'crypto', vwapAbove: true,
    orbBreak: true, regime: 'TRENDING', timestamp: Date.now()
  },
  {
    id: generateId(), symbol: 'GBP/USD', direction: 'SHORT',
    entry: 1.2645, tp: 1.2580, sl: 1.2680, rr: '1:1.86',
    mlScore: 0.71, confidence: 71, status: 'PENDING',
    timeframe: '15M', market: 'forex', vwapAbove: false,
    orbBreak: true, regime: 'RANGING', timestamp: Date.now() - 300000
  },
  {
    id: generateId(), symbol: 'XRP/USDT', direction: 'LONG',
    entry: 0.6124, tp: 0.6480, sl: 0.5960, rr: '1:2.17',
    mlScore: 0.65, confidence: 65, status: 'WATCH',
    timeframe: '15M', market: 'crypto', vwapAbove: true,
    orbBreak: false, regime: 'TRENDING', timestamp: Date.now() - 600000
  },
  {
    id: generateId(), symbol: 'USD/JPY', direction: 'LONG',
    entry: 149.82, tp: 151.20, sl: 149.20, rr: '1:2.23',
    mlScore: 0.76, confidence: 76, status: 'ACTIVE',
    timeframe: '15M', market: 'forex', vwapAbove: true,
    orbBreak: true, regime: 'TRENDING', timestamp: Date.now() - 120000
  }
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

export const useStore = create((set, get) => ({
  // Mode
  executionMode: 'SEMI-AUTO',
  setExecutionMode: (mode) => set({ executionMode: mode }),

  // Exchange
  activeExchange: 'bybit',
  accountMode: 'DEMO',
  setAccountMode: (mode) => set({ accountMode: mode }),
  setActiveExchange: (ex) => set({ activeExchange: ex }),

  // Connection status
  backendConnected: false,
  wsConnected: false,
  setBackendConnected: (v) => set({ backendConnected: v }),
  setWsConnected: (v) => set({ wsConnected: v }),

  // Live prices { BTCUSDT: { price, change, volume } }
  livePrices: {},
  updateLivePrices: (prices) => set({ livePrices: prices }),

  // Market filter
  marketFilter: 'ALL',
  setMarketFilter: (f) => set({ marketFilter: f }),

  // Navigation
  activePage: 'dashboard',
  setActivePage: (page) => set({ activePage: page }),

  // Sidebar
  sidebarOpen: false,
  setSidebarOpen: (v) => set({ sidebarOpen: v }),

  // Emergency
  systemPaused: false,
  setPaused: (v) => set({ systemPaused: v }),

  // Positions
  positions: initialPositions,
  refreshPositions: (positions) => set({ positions }),
  updatePosition: (id, updates) => set(state => ({
    positions: state.positions.map(p => p.id === id ? { ...p, ...updates } : p)
  })),
  closePosition: (id) => set(state => ({
    positions: state.positions.filter(p => p.id !== id)
  })),

  // Signals
  signals: generateSignals(),
  refreshSignals: (signals) => set({ signals }),
  dismissSignal: (id) => set(state => ({
    signals: state.signals.filter(s => s.id !== id)
  })),

  // History
  tradeHistory: generateHistory(),

  // Settings
  settings: {
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
  },
  updateSettings: (updates) => set(state => ({
    settings: { ...state.settings, ...updates }
  })),

  // Portfolio stats
  portfolioBalance: 12480.50,
  dailyPnl: 168.90,
  dailyPnlPct: 1.37,
  weeklyPnl: 842.30,
  monthlyPnl: 3240.80,
  winRate: 58,
  avgRR: 2.4,
  totalTrades: 247,
  currentStreak: 4,
  maxDrawdown: 3.2,
  sharpeRatio: 2.18,

  // Refresh from live API
  refreshPortfolio: (data) => set({
    portfolioBalance: data.balance ?? get().portfolioBalance,
    dailyPnl: data.daily_pnl ?? get().dailyPnl,
    dailyPnlPct: data.daily_pnl_pct ?? get().dailyPnlPct,
    winRate: data.win_rate ?? get().winRate,
    avgRR: data.avg_rr ?? get().avgRR,
  }),
}))
