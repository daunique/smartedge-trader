import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const DEFAULT_SETTINGS = {
  riskPerTrade:    1,
  minRR:           3,
  maxTradesPerDay: 3,
  dailyLossLimit:  2,
  orbTimeframe:    15,
  beTrigger:       1,
  trailingStop:    true,
  mlThreshold:     0.65,
  notifications:   true,
  mobileAlerts:    true,
  apiKey:          '',
  apiSecret:       '',
}

export const useStore = create(
  persist(
    (set, get) => ({
      // ── Persisted ──────────────────────────────────────────────
      executionMode: 'SEMI-AUTO',
      accountMode:   'DEMO',
      marketFilter:  'ALL',
      activePage:    'dashboard',
      settings:      DEFAULT_SETTINGS,

      // ── Runtime (loaded fresh from backend each session) ───────
      sidebarOpen:       false,
      systemPaused:      false,
      backendConnected:  false,
      wsConnected:       false,
      livePrices:        {},
      positions:         [],
      signals:           [],
      tradeHistory:      [],   // NO mock data — only real Bybit trades
      portfolioBalance:  0,
      dailyPnl:          0,
      dailyPnlPct:       0,
      weeklyPnl:         0,
      monthlyPnl:        0,
      winRate:           0,
      avgRR:             0,
      totalTrades:       0,
      currentStreak:     0,
      maxDrawdown:       0,
      sharpeRatio:       0,
      activeExchange:    'bybit',
      tradesExecutedToday: 0,

      // ── Actions ────────────────────────────────────────────────
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
      setTradesExecutedToday:(n)    => set({ tradesExecutedToday: n }),

      updateSettings: (updates) => set(state => ({
        settings: { ...state.settings, ...updates }
      })),

      refreshPositions: (positions) => set({ positions }),
      refreshSignals:   (signals)   => set({ signals }),

      // Replace history with real backend data
      refreshHistory: (trades) => set({ tradeHistory: trades }),

      updatePosition: (id, updates) => set(state => ({
        positions: state.positions.map(p => p.id === id ? { ...p, ...updates } : p)
      })),
      closePosition: (id) => set(state => ({
        positions: state.positions.filter(p => p.id !== id)
      })),
      dismissSignal: (id) => set(state => ({
        signals: state.signals.filter(s => s.id !== id)
      })),

      refreshPortfolio: (data) => {
        const trades = get().tradeHistory
        const wins   = trades.filter(t => t.status === 'TP').length
        const total  = trades.length
        const winRate = total > 0 ? Math.round((wins / total) * 100) : 0

        // Calculate streaks
        const sorted = [...trades].sort((a, b) => new Date(b.date) - new Date(a.date))
        let streak = 0, streakType = null
        for (const t of sorted) {
          if (!streakType) { streakType = t.status; streak = 1 }
          else if (t.status === streakType) streak++
          else break
        }

        // Weekly PnL
        const weekAgo   = Date.now() - 7 * 86400000
        const weeklyPnl = trades
          .filter(t => new Date(t.date).getTime() > weekAgo)
          .reduce((s, t) => s + t.pnl, 0)

        set({
          portfolioBalance:    data.balance        ?? get().portfolioBalance,
          dailyPnl:            data.daily_pnl      ?? get().dailyPnl,
          dailyPnlPct:         data.daily_pnl_pct  ?? get().dailyPnlPct,
          tradesExecutedToday: data.trades_today    ?? get().tradesExecutedToday,
          winRate,
          currentStreak: streak,
          weeklyPnl:     Math.round(weeklyPnl * 100) / 100,
          totalTrades:   total,
          avgRR:         total > 0
            ? Math.round((trades.filter(t => t.status === 'TP')
                .reduce((s, t) => s + parseFloat(t.rr || 0), 0) / (wins || 1)) * 10) / 10
            : 0,
        })
      },
    }),
    {
      name: 'smartedge-v2',
      partialize: (state) => ({
        executionMode: state.executionMode,
        accountMode:   state.accountMode,
        marketFilter:  state.marketFilter,
        activePage:    state.activePage,
        settings:      state.settings,
      }),
    }
  )
)
