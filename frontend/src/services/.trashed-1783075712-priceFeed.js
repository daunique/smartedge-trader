/**
 * Bybit Public WebSocket Price Feed
 * No API key needed for market data
 * Supports: Crypto (USDT perpetual) + Forex
 */

const BYBIT_WS = 'wss://stream.bybit.com/v5/public/linear'
const BYBIT_WS_SPOT = 'wss://stream.bybit.com/v5/public/spot'

// Bybit symbol format
const toBybitSymbol = (symbol) => symbol.replace('/', '')

class BybitPriceFeed {
  constructor() {
    this.ws = null
    this.listeners = {}
    this.prices = {}
    this.subscriptions = new Set()
    this.connected = false
    this.reconnectTimer = null
    this.pingTimer = null
  }

  connect(symbols = []) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.subscribe(symbols)
      return
    }

    this.ws = new WebSocket(BYBIT_WS)

    this.ws.onopen = () => {
      this.connected = true
      console.log('[BYBIT FEED] Connected')
      this.startPing()
      if (symbols.length > 0) this.subscribe(symbols)
      this.emit('connected', {})
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.topic?.startsWith('tickers.')) {
          this.handleTicker(data)
        }
      } catch (e) {}
    }

    this.ws.onclose = () => {
      this.connected = false
      this.stopPing()
      this.emit('disconnected', {})
      this.reconnectTimer = setTimeout(() => this.connect([...this.subscriptions]), 5000)
    }

    this.ws.onerror = () => {
      this.emit('error', {})
    }
  }

  subscribe(symbols) {
    const args = symbols.map(s => `tickers.${toBybitSymbol(s)}`).filter(Boolean)
    if (args.length === 0) return
    args.forEach(a => this.subscriptions.add(a.replace('tickers.', '')))
    this.ws?.send(JSON.stringify({ op: 'subscribe', args }))
  }

  unsubscribe(symbols) {
    const args = symbols.map(s => `tickers.${toBybitSymbol(s)}`)
    this.ws?.send(JSON.stringify({ op: 'unsubscribe', args }))
  }

  handleTicker(data) {
    const ticker = data.data
    if (!ticker) return
    const symbol = ticker.symbol
    const price = parseFloat(ticker.lastPrice)
    const change = parseFloat(ticker.price24hPcnt) * 100

    this.prices[symbol] = { price, change, volume: ticker.volume24h, timestamp: Date.now() }
    this.emit('price', { symbol, price, change, volume: ticker.volume24h })
    this.emit(`price:${symbol}`, { symbol, price, change })
  }

  startPing() {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 'ping' }))
      }
    }, 20000)
  }

  stopPing() {
    clearInterval(this.pingTimer)
  }

  getPrice(symbol) {
    return this.prices[toBybitSymbol(symbol)] || null
  }

  getAllPrices() {
    return this.prices
  }

  on(event, cb) {
    if (!this.listeners[event]) this.listeners[event] = []
    this.listeners[event].push(cb)
    return () => { this.listeners[event] = this.listeners[event].filter(l => l !== cb) }
  }

  emit(event, data) {
    this.listeners[event]?.forEach(cb => cb(data))
  }

  disconnect() {
    clearTimeout(this.reconnectTimer)
    this.stopPing()
    this.ws?.close()
  }
}

export const priceFeed = new BybitPriceFeed()
