import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'
import { api } from '../services/api'
import { wsService } from '../services/websocket'
import { priceFeed } from '../services/priceFeed'
import { notifications } from '../services/notifications'

const CRYPTO_SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT']
const POLL_INTERVAL  = 15000
const PRICE_INTERVAL = 1000

const normalizeSignal = (s) => ({
  id: s.id, symbol: s.symbol, direction: s.direction,
  entry: s.entry, tp: s.tp, sl: s.sl, be: s.be,
  rr: s.rr, mlScore: s.ml_score, confidence: s.confidence,
  status: s.status, timeframe: s.timeframe, market: s.market,
  vwapAbove: s.vwap_above, orbBreak: s.orb_break,
  regime: s.regime, atr: s.atr, session: s.session,
  timestamp: new Date(s.timestamp).getTime(),
})

const normalizeTrade = (t) => ({
  id: t.id, symbol: t.symbol, direction: t.direction,
  pnl: t.pnl || 0, runningPnl: t.runningPnl || 0,
  rr: t.rr || '0', mlScore: t.mlScore || t.ml_score || 0,
  status: t.status,
  date: t.date || t.createdTime || new Date().toISOString(),
  market: t.market || 'crypto', duration: t.duration || '—',
  source: 'bybit_demo',
})

export function useLiveData() {
  const {
    setBackendConnected, setWsConnected,
    updateLivePrices, refreshPortfolio,
    refreshPositions, refreshSignals, refreshHistory,
    accountMode, settings, signals: currentSignals,
  } = useStore()

  const pollRef    = useRef(null)
  const priceRef   = useRef(null)
  const mountedRef = useRef(true)
  const prevSignalIds = useRef(new Set())

  // Sync notification enabled state with settings
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
    if (portfolio) refreshPortfolio(portfolio)
    if (positions?.positions) refreshPositions(positions.positions)
    if (history?.trades) refreshHistory(history.trades.map(normalizeTrade))
    if (signals?.signals) {
      const normalized = signals.signals.map(normalizeSignal)
      refreshSignals(normalized)

      // Notify on new ACTIVE signals
      if (settings.notifications) {
        normalized.forEach(sig => {
          if (sig.status === 'ACTIVE' && !prevSignalIds.current.has(sig.id)) {
            notifications.signalAlert(sig)
          }
        })
      }
      prevSignalIds.current = new Set(normalized.map(s => s.id))
    }
  }, [refreshPortfolio, refreshPositions, refreshSignals, refreshHistory, settings.notifications])

  const checkBackend = useCallback(async () => {
    const result = await api.ping()
    if (mountedRef.current) setBackendConnected(!!result)
    return !!result
  }, [setBackendConnected])

  const startWebSocket = useCallback(() => {
    wsService.connect()

    const unsubConn = wsService.on('connection', ({ status }) => {
      if (mountedRef.current) setWsConnected(status === 'connected')
    })

    const unsubPos = wsService.on('position_update', (data) => {
      if (mountedRef.current && data.positions) refreshPositions(data.positions)
    })

    const unsubSig = wsService.on('signal_update', (data) => {
      if (!mountedRef.current || !data.signals) return
      const normalized = data.signals.map(normalizeSignal)
      refreshSignals(normalized)
      // Notify new active signals
      if (settings.notifications) {
        normalized.forEach(sig => {
          if (sig.status === 'ACTIVE' && !prevSignalIds.current.has(sig.id)) {
            notifications.signalAlert(sig)
          }
        })
        prevSignalIds.current = new Set(normalized.map(s => s.id))
      }
    })

    const unsubExec = wsService.on('auto_executed', (data) => {
      if (!mountedRef.current) return
      // Notify auto-execution
      if (settings.notifications && data.result) {
        notifications.autoExecutedAlert(data.result)
      }
      // Reload history
      api.getHistory(200).then(h => {
        if (h?.trades && mountedRef.current) refreshHistory(h.trades.map(normalizeTrade))
      })
    })

    return () => { unsubConn(); unsubPos(); unsubSig(); unsubExec() }
  }, [setWsConnected, refreshPositions, refreshSignals, refreshHistory, settings.notifications])

  const startPriceFeed = useCallback(() => {
    priceFeed.connect(CRYPTO_SYMBOLS)
    priceRef.current = setInterval(() => {
      if (!mountedRef.current) return
      const prices = priceFeed.getAllPrices()
      if (Object.keys(prices).length > 0) updateLivePrices(prices)
    }, PRICE_INTERVAL)
    return () => clearInterval(priceRef.current)
  }, [updateLivePrices])

  useEffect(() => {
    mountedRef.current = true
    let cleanupWs   = () => {}
    let cleanupFeed = () => {}

    const init = async () => {
      const ok = await checkBackend()
      if (ok) {
        await loadAll()
        cleanupWs = startWebSocket()
        pollRef.current = setInterval(loadAll, POLL_INTERVAL)
      }
      cleanupFeed = startPriceFeed()
    }

    init()

    return () => {
      mountedRef.current = false
      cleanupWs(); cleanupFeed()
      clearInterval(pollRef.current)
      wsService.disconnect()
      priceFeed.disconnect()
    }
  }, [accountMode])

  return null
}
