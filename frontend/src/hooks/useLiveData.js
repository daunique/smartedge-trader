/**
 * useLiveData — Master data connection hook
 * Connects API + WebSocket + Bybit price feed to Zustand store
 * Falls back to mock data if backend is unavailable
 */

import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'
import { api } from '../services/api'
import { wsService } from '../services/websocket'
import { priceFeed } from '../services/priceFeed'

// Symbols to subscribe to
const CRYPTO_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']
const FOREX_SYMBOLS  = [] // Bybit linear handles these

const POLL_INTERVAL  = 10000  // 10s polling fallback
const PRICE_INTERVAL = 500    // 500ms price update to store

export function useLiveData() {
  const {
    setBackendConnected,
    setWsConnected,
    updateLivePrices,
    refreshPortfolio,
    refreshPositions,
    refreshSignals,
    accountMode,
  } = useStore()

  const pollRef    = useRef(null)
  const priceRef   = useRef(null)
  const mountedRef = useRef(true)

  // ── 1. Check backend health ───────────────────────────────────
  const checkBackend = useCallback(async () => {
    const result = await api.ping()
    if (mountedRef.current) {
      setBackendConnected(!!result)
    }
    return !!result
  }, [setBackendConnected])

  // ── 2. Load all data from API ─────────────────────────────────
  const loadAll = useCallback(async () => {
    const [portfolio, positions, signals] = await Promise.all([
      api.getPortfolio(),
      api.getPositions(),
      api.getSignals(),
    ])

    if (!mountedRef.current) return

    if (portfolio) refreshPortfolio(portfolio)
    if (positions?.positions) refreshPositions(positions.positions)
    if (signals?.signals) refreshSignals(signals.signals)
  }, [refreshPortfolio, refreshPositions, refreshSignals])

  // ── 3. Start WebSocket (real-time backend updates) ────────────
  const startWebSocket = useCallback(() => {
    wsService.connect()

    const unsubConn = wsService.on('connection', ({ status }) => {
      if (mountedRef.current) setWsConnected(status === 'connected')
    })

    const unsubMsg = wsService.on('position_update', (data) => {
      if (!mountedRef.current) return
      if (data.positions) refreshPositions(data.positions)
    })

    const unsubSignal = wsService.on('signal_update', (data) => {
      if (!mountedRef.current) return
      if (data.signals) refreshSignals(data.signals)
    })

    const unsubPortfolio = wsService.on('portfolio_update', (data) => {
      if (!mountedRef.current) return
      refreshPortfolio(data)
    })

    return () => {
      unsubConn()
      unsubMsg()
      unsubSignal()
      unsubPortfolio()
    }
  }, [setWsConnected, refreshPositions, refreshSignals, refreshPortfolio])

  // ── 4. Start Bybit price feed ─────────────────────────────────
  const startPriceFeed = useCallback(() => {
    priceFeed.connect(CRYPTO_SYMBOLS)

    // Batch price updates every 500ms to avoid too many re-renders
    const unsubPrice = priceFeed.on('price', () => {})

    priceRef.current = setInterval(() => {
      if (!mountedRef.current) return
      const prices = priceFeed.getAllPrices()
      if (Object.keys(prices).length > 0) {
        updateLivePrices(prices)
      }
    }, PRICE_INTERVAL)

    return () => {
      unsubPrice()
      clearInterval(priceRef.current)
    }
  }, [updateLivePrices])

  // ── 5. Polling fallback (if WS drops) ────────────────────────
  const startPolling = useCallback(() => {
    pollRef.current = setInterval(loadAll, POLL_INTERVAL)
    return () => clearInterval(pollRef.current)
  }, [loadAll])

  // ── Mount / Unmount ───────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true

    let cleanupWs = () => {}
    let cleanupFeed = () => {}
    let cleanupPoll = () => {}

    const init = async () => {
      const backendOk = await checkBackend()

      if (backendOk) {
        await loadAll()
        cleanupWs   = startWebSocket()
        cleanupPoll = startPolling()
      } else {
        console.warn('[DATA] Backend unavailable — running on mock data')
      }

      // Always start price feed (public, no auth needed)
      cleanupFeed = startPriceFeed()
    }

    init()

    return () => {
      mountedRef.current = false
      cleanupWs()
      cleanupFeed()
      cleanupPoll()
      wsService.disconnect()
      priceFeed.disconnect()
    }
  }, [accountMode])

  return null
}
