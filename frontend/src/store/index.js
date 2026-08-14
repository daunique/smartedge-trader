import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const DEFAULT_SETTINGS = {
  riskPerTrade:    { XRPUSDT: 10 },
  minRR:           3,
  maxTradesPerDay: 4,
  dailyLossLimit:  25,
  beTrigger:       2.0,
  notifications:   true,
  mobileAlerts:    true,
  apiKey:          '',
  apiSecret:       '',
}

export const useStore = create(
  persist(
    (set, get) => ({
      executionMode: 'SEMI-AUTO',
      accountMode:   'DEMO',
      marketFilter:  'ALL',
      activePage:    'dashboard',
      settings:      DEFAULT_SETTINGS,

      sidebarOpen:         false,
      systemPaused:        false,
      backendConnected:    false,
      wsConnected:         false,
      livePrices:          {},
      positions:           [],
      signals:             [],
      tradeHistory:        [],
      portfolioBalance:    0,
      dailyPnl:            0,
      dailyPnlPct:         0,
      weeklyPnl:           0,
      monthlyPnl:          0,
      winRate:             0,
      avgRR:               0,
      totalTrades:         0,
      currentStreak:       0,
      maxDrawdown:         0,
      sharpeRatio:         0,
      activeExchange:      'bybit',
      openPnl:             0,

      setExecutionMode:      (mode) => set({ executionMode: mode }),
      setAccountMode:        (mode) => set({ accountMode: mode }),
      setMarketFilter:       (f)    => set({ marketFilter: f }),
      setActivePage:         (page) => set({ activePage: page }),
      setSidebarOpen:        (v)    => set({ sidebarOpen: v }),
      setPaused:             (v)    => set({ systemPaused: v }),
      setBackendConnected:   (v)    => set({ backendConnected: v }),
      setWsConnected:        (v)    => set({ wsConnected: v }),
      setActiveExchange:     (ex)   => set({ activeExchange: ex }),
      updateLivePrices:      (p)    => set({ livePrices: p }),

      updateSettings: (updates) => set(state => ({
        settings: { ...DEFAULT_SETTINGS, ...state.settings, ...updates }
      })),

      refreshPositions: (positions) => {
        const list = positions || []
        const openPnl = list.reduce((s, p) => s + (Number(p.pnl) || 0), 0)
        set({ positions: list, openPnl })
      },
      refreshSignals:   (signals)   => set({ signals: signals || [] }),
      refreshHistory:   (trades)    => set({ tradeHistory: trades || [] }),

      updatePosition: (id, updates) => set(state => ({
        positions: state.positions.map(p => p.id === id ? { ...p, ...updates } : p)
      })),
      closePosition: (id) => set(state => {
        const positions = state.positions.filter(p => p.id !== id)
        const openPnl = positions.reduce((s, p) => s + (Number(p.pnl) || 0), 0)
        return { positions, openPnl }
      }),
      dismissSignal: (id) => set(state => ({
        signals: state.signals.filter(s => s.id !== id)
      })),

      refreshPortfolio: (data) => {
        if (!data) return
        const trades  = get().tradeHistory || []
        const closed  = trades.filter(t => t.status === 'TP' || t.status === 'SL' || t.status === 'BE' || t.status === 'CLOSED')
        const wins    = closed.filter(t => (t.pnl || 0) > 0)
        const total   = closed.length
        const winRate = total > 0 ? Math.round((wins.length / total) * 100) : 0

        const sorted = [...closed].sort((a, b) => new Date(b.date) - new Date(a.date))
        let streak = 0
        let streakType = null
        for (const t of sorted) {
          const isWin = (t.pnl || 0) > 0
          const type = isWin ? 'W' : 'L'
          if (!streakType) { streakType = type; streak = 1 }
          else if (type === streakType) streak++
          else break
        }
        if (streakType === 'L') streak = -streak

        const weekAgo = Date.now() - 7 * 86400000
        const weeklyPnl = closed
          .filter(t => new Date(t.date).getTime() > weekAgo)
          .reduce((s, t) => s + (t.pnl || 0), 0)

        const monthStart = new Date()
        monthStart.setDate(1)
        monthStart.setHours(0, 0, 0, 0)
        const monthlyPnl = closed
          .filter(t => new Date(t.date) >= monthStart)
          .reduce((s, t) => s + (t.pnl || 0), 0)

        const rrValues = closed
          .map(t => parseFloat(t.rr))
          .filter(v => !isNaN(v) && isFinite(v))
        const avgRR = rrValues.length > 0
          ? Math.round((rrValues.reduce((s, v) => s + v, 0) / rrValues.length) * 100) / 100
          : 0

        set({
          portfolioBalance: data.balance       ?? get().portfolioBalance,
          dailyPnl:         data.daily_pnl     ?? get().dailyPnl,
          dailyPnlPct:      data.daily_pnl_pct ?? get().dailyPnlPct,
          winRate,
          currentStreak: streak,
          weeklyPnl:     Math.round(weeklyPnl * 100) / 100,
          monthlyPnl:    Math.round(monthlyPnl * 100) / 100,
          totalTrades:   total,
          avgRR,
        })
      },
    }),
    {
      name: 'smartedge-v4',
      version: 2,
      migrate: (persistedState, fromVersion) => {
        const s = persistedState?.settings || {}
        ;['mlThreshold', 'orbTimeframe', 'trailingStop', 'ETHUSDT'].forEach(k => delete s[k])
        let riskPerTrade = s.riskPerTrade
        if (!riskPerTrade || typeof riskPerTrade !== 'object') {
          riskPerTrade = { XRPUSDT: 10 }
        } else {
          riskPerTrade = { XRPUSDT: Number(riskPerTrade.XRPUSDT) || 10 }
          delete riskPerTrade.ETHUSDT
        }
        if (s.beTrigger !== undefined && Number(s.beTrigger) < 2) {
          s.beTrigger = 2.0
        }
        persistedState.settings = { ...DEFAULT_SETTINGS, ...s, riskPerTrade, beTrigger: s.beTrigger ?? 2.0 }
        return persistedState
      },
      partialize: (state) => ({
        executionMode: state.executionMode,
        accountMode:   state.accountMode,
        marketFilter:  state.marketFilter,
        activePage:    state.activePage,
        settings:      state.settings,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) console.error('Store rehydration failed:', error)
      },
    }
  )
)
