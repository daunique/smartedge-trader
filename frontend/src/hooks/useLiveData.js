import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'
import { api } from '../services/api'
import { wsService } from '../services/websocket'
import { priceFeed } from '../services/priceFeed'
import { notifications } from '../services/notifications'

const CRYPTO_SYMBOLS = ['XRPUSDT']
const POLL_INTERVAL  = 4000
const PRICE_INTERVAL = 800

const normalizeSignal = (s) => ({
  id: s.id, symbol: s.symbol, direction: s.direction,
  entry: s.entry, tp: s.tp, sl: s.sl, be: s.be,
  rr: s.rr, status: s.status, timeframe: s.timeframe, market: s.market,
  trend: s.trend, entryTrigger: s.entry_trigger, volOk: s.vol_ok,
  atr: s.atr, executed: s.executed,
  timestamp: new Date(s.timestamp).getTime(),
})

const normalizeTrade = (t) => {
  let date = t.date || t.createdTime || t.create_time || null
  if (date) {
    const num = Number(date)
    if (!isNaN(num) && num > 1e12) date = new Date(num).toISOString()
    else if (!isNaN(num) && num > 1e9) date = new Date(num * 1000).toISOString()
  }
  if (!date || date === 'null') date = new Date().toISOString()
  return {
    id: t.id, symbol: t.symbol, direction: t.direction,
    pnl: t.pnl || 0, runningPnl: t.runningPnl || 0,
    rr: t.rr || '0', status: t.status || 'CLOSED',
    date, market: t.market || 'crypto', duration: t.duration || '—',
  }
}

export function useLiveData() {
  const {
    setBackendConnected, setWsConnected,
    updateLivePrices, refreshPortfolio,
    refreshPositions, refreshSignals, refreshHistory,
    settings,
  } = useStore()

  const pollRef = useRef(null)
  const priceRef = useRef(null)
  const mountedRef = useRef(true)
  const prevSignalIds = useRef(new Set())

  useEffect(() => {
    notifications.setEnabled(settings.notifications)
  }, [settings.notifications])

  const loadAll = useCallback(async () => {
    const [portfolio, positions, signals, history] = await Promise.all([
      api.getPortfolio(),
      api.getPositions(),
      api.getSignals(),
      api.getHistory(200),
    ])
    if (!mountedRef.current) return

    setBackendConnected(!!portfolio || !!positions)

    if (portfolio) refreshPortfolio(portfolio)
    if (positions?.positions) refreshPositions(positions.positions)
    if (history?.trades) refreshHistory(history.trades.map(normalizeTrade))
    if (signals?.signals) {
      const normalized = signals.signals.map(normalizeSignal)
      const newOnes = normalized.filter(s => !prevSignalIds.current.has(s.id))
      newOnes.forEach(s => {
        if (settings.notifications && !s.executed) {
          notifications.notify(`New ${s.direction} signal`, `${s.symbol} @ ${s.entry}`)
        }
      })
      prevSignalIds.current = new Set(normalized.map(s => s.id))
      refreshSignals(normalized)
    }
  }, [refreshPortfolio, refreshPositions, refreshSignals, refreshHistory, setBackendConnected, settings.notifications])

  const loadPrices = useCallback(async () => {
    try {
      const prices = await priceFeed.fetchPrices(CRYPTO_SYMBOLS)
      if (mountedRef.current && prices) updateLivePrices(prices)
    } catch (_) { /* ignore */ }
  }, [updateLivePrices])

  useEffect(() => {
    mountedRef.current = true
    loadAll()
    loadPrices()

    pollRef.current = setInterval(loadAll, POLL_INTERVAL)
    priceRef.current = setInterval(loadPrices, PRICE_INTERVAL)

    wsService.connect({
      onOpen: () => setWsConnected(true),
      onClose: () => setWsConnected(false),
      onMessage: (msg) => {
        if (!mountedRef.current) return
        if (msg.type === 'signal_update' && msg.signals) {
          refreshSignals(msg.signals.map(normalizeSignal))
        }
        if (msg.type === 'trade_executed' || msg.type === 'auto_executed') {
          loadAll()
        }
        if (msg.type === 'position_update' && msg.positions) {
          refreshPositions(msg.positions)
        }
      },
    })

    return () => {
      mountedRef.current = false
      clearInterval(pollRef.current)
      clearInterval(priceRef.current)
      wsService.disconnect()
    }
  }, [loadAll, loadPrices, setWsConnected, refreshSignals, refreshPositions])
}
