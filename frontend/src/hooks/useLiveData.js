import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'
import { api } from '../services/api'
import { wsService } from '../services/websocket'
import { priceFeed } from '../services/priceFeed'
import { notifications } from '../services/notifications'

const CRYPTO_SYMBOLS = ['XRPUSDT']
const POLL_INTERVAL = 4000

const normalizeSignal = (s) => ({
  id: s.id, symbol: s.symbol, direction: s.direction,
  entry: s.entry, tp: s.tp, sl: s.sl, be: s.be,
  rr: s.rr, status: s.status, timeframe: s.timeframe, market: s.market,
  trend: s.trend, entryTrigger: s.entry_trigger || s.entryTrigger, volOk: s.vol_ok,
  atr: s.atr, executed: s.executed,
  lastError: s.last_error || s.lastError || '',
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

async function fetchTickerRest(symbol) {
  try {
    const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`)
    const j = await r.json()
    const t = j?.result?.list?.[0]
    if (!t) return null
    return {
      price: parseFloat(t.lastPrice),
      change24h: parseFloat(t.price24hPcnt) * 100,
      change: parseFloat(t.price24hPcnt) * 100,
    }
  } catch {
    return null
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
      const newOnes = normalized.filter(s => !prevSignalIds.current.has(s.id) && !s.executed)
      newOnes.forEach(s => {
        if (settings.notifications) {
          notifications.notify(`New ${s.direction}`, `${s.symbol} @ ${s.entry}`)
        }
      })
      prevSignalIds.current = new Set(normalized.map(s => s.id))
      refreshSignals(normalized)
    }
  }, [refreshPortfolio, refreshPositions, refreshSignals, refreshHistory, setBackendConnected, settings.notifications])

  const loadPrices = useCallback(async () => {
    const map = {}
    // Prefer live WS cache
    const cached = priceFeed.getAllPrices()
    for (const sym of CRYPTO_SYMBOLS) {
      if (cached[sym]?.price) map[sym] = cached[sym]
    }
    // REST fallback for anything missing
    for (const sym of CRYPTO_SYMBOLS) {
      if (!map[sym]) {
        const t = await fetchTickerRest(sym)
        if (t) map[sym] = t
      }
    }
    if (mountedRef.current && Object.keys(map).length) updateLivePrices(map)
  }, [updateLivePrices])

  useEffect(() => {
    mountedRef.current = true
    loadAll()
    loadPrices()

    // Bybit public ticker stream
    priceFeed.connect(CRYPTO_SYMBOLS)
    const off = priceFeed.on('price', ({ symbol, price, change }) => {
      if (!mountedRef.current) return
      const cur = useStore.getState().livePrices || {}
      updateLivePrices({ ...cur, [symbol]: { price, change, change24h: change } })
    })

    pollRef.current = setInterval(loadAll, POLL_INTERVAL)
    priceRef.current = setInterval(loadPrices, 2000)

    wsService.connect({
      onOpen: () => setWsConnected(true),
      onClose: () => setWsConnected(false),
      onMessage: (msg) => {
        if (!mountedRef.current) return
        if (msg.type === 'signal_update' && msg.signals) {
          refreshSignals(msg.signals.map(normalizeSignal))
        }
        if (msg.type === 'trade_executed' || msg.type === 'auto_executed') loadAll()
        if (msg.type === 'execute_error') loadAll()
        if (msg.type === 'position_update' && msg.positions) refreshPositions(msg.positions)
        if (msg.type === 'signal_update' && msg.signals) {
          refreshSignals(msg.signals.map(normalizeSignal))
        }
      },
    })

    return () => {
      mountedRef.current = false
      clearInterval(pollRef.current)
      clearInterval(priceRef.current)
      off?.()
      priceFeed.disconnect()
      wsService.disconnect()
    }
  }, [loadAll, loadPrices, setWsConnected, refreshSignals, refreshPositions, updateLivePrices])
}
