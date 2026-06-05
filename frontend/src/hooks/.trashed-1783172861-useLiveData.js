/**
 * useLiveData — Master data connection hook
 * Connects API + WebSocket + Bybit price feed to Zustand store
 */

import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'
import { api } from '../services/api'
import { wsService } from '../services/websocket'
import { priceFeed } from '../services/priceFeed'

const CRYPTO_SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT']
const POLL_INTERVAL  = 10000
const PRICE_INTERVAL = 500

// Normalize signal from backend engine format → frontend store format
const normalizeSignal = (s) => ({
  id:         s.id,
  symbol:     s.symbol,
  direction:  s.direction,
  entry:      s.entry,
  tp:         s.tp,
  sl:         s.sl,
  rr:         s.rr,
  mlScore:    s.ml_score,
  confidence: s.confidence,
  status:     s.status,
  timeframe:  s.timeframe,
  market:     s.market,
  vwapAbove:  s.vwap_above,
  orbBreak:   s.orb_break,
  regime:     s.regime,
  timestamp:  new Date(s.timestamp).getTime(),
})

export function useLiveData() {
  const {
    setBackendConnected, setWsConnected,
    updateLivePrices, refreshPortfolio,
    refreshPositions, refreshSignals,
    accountMode,
  } = useStore()

  const pollRef    = useRef(null)
  const priceRef   = useRef(null)
  const mountedRef = useRef(true)

  const checkBackend = useCallback(async () => {
    const result = await api.ping()
    if (mountedRef.current) setBackendConnected(!!result)
    return !!result
  }, [setBackendConnected])

  const loadAll = useCallback(async () => {
    const [portfolio, positions, signals] = await Promise.all([
      api.getPortfolio(),
      api.getPositions(),
      api.getSignals(),
    ])
    if (!mountedRef.current) return
    if (portfolio) refreshPortfolio(portfolio)
    if (positions?.positions) refreshPositions(positions.positions)
    if (signals?.signals) refreshSignals(signals.signals.map(normalizeSignal))
  }, [refreshPortfolio, refreshPositions, refreshSignals])

  const startWebSocket = useCallback(() => {
    wsService.connect()

    const unsubConn = wsService.on('connection', ({ status }) => {
      if (mountedRef.current) setWsConnected(status === 'connected')
    })

    const unsubPos = wsService.on('position_update', (data) => {
      if (!mountedRef.current) return
      if (data.positions) refreshPositions(data.positions)
    })

    const unsubSig = wsService.on('signal_update', (data) => {
      if (!mountedRef.current) return
      if (data.signals) refreshSignals(data.signals.map(normalizeSignal))
    })

    const unsubPort = wsService.on('portfolio_update', (data) => {
      if (!mountedRef.current) return
      refreshPortfolio(data)
    })

    return () => { unsubConn(); unsubPos(); unsubSig(); unsubPort() }
  }, [setWsConnected, refreshPositions, refreshSignals, refreshPortfolio])

  const startPriceFeed = useCallback(() => {
    priceFeed.connect(CRYPTO_SYMBOLS)
    priceRef.current = setInterval(() => {
      if (!mountedRef.current) return
      const prices = priceFeed.getAllPrices()
      if (Object.keys(prices).length > 0) updateLivePrices(prices)
    }, PRICE_INTERVAL)
    return () => clearInterval(priceRef.current)
  }, [updateLivePrices])

  const startPolling = useCallback(() => {
    pollRef.current = setInterval(loadAll, POLL_INTERVAL)
    return () => clearInterval(pollRef.current)
  }, [loadAll])

  useEffect(() => {
    mountedRef.current = true
    let cleanupWs   = () => {}
    let cleanupFeed = () => {}
    let cleanupPoll = () => {}

    const init = async () => {
      const ok = await checkBackend()
      if (ok) {
        await loadAll()
        cleanupWs   = startWebSocket()
        cleanupPoll = startPolling()
      } else {
        console.warn('[DATA] Backend unavailable — running on mock data')
      }
      cleanupFeed = startPriceFeed()
    }

    init()

    return () => {
      mountedRef.current = false
      cleanupWs(); cleanupFeed(); cleanupPoll()
      wsService.disconnect()
      priceFeed.disconnect()
    }
  }, [accountMode])

  return null
}
