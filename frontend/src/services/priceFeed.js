/**
 * Bybit public linear ticker WebSocket — throttled UI updates
 */

const BYBIT_WS = 'wss://stream.bybit.com/v5/public/linear'

function toBybitSymbol(s) {
  return String(s || '').replace('/', '').toUpperCase()
}

class BybitPriceFeed {
  constructor() {
    this.ws = null
    this.connected = false
    this.prices = {}
    this.listeners = {}
    this.subscriptions = new Set()
    this.reconnectTimer = null
    this.pingTimer = null
    this._lastEmit = {}
    this._pending = {}
    this._flushTimer = null
  }

  connect(symbols = []) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.subscribe(symbols)
      return
    }

    this.ws = new WebSocket(BYBIT_WS)

    this.ws.onopen = () => {
      this.connected = true
      this.startPing()
      if (symbols.length > 0) this.subscribe(symbols)
      this.emit('connected', {})
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.topic?.startsWith('tickers.')) this.handleTicker(data)
      } catch (_) {}
    }

    this.ws.onclose = () => {
      this.connected = false
      this.stopPing()
      this.emit('disconnected', {})
      this.reconnectTimer = setTimeout(() => this.connect([...this.subscriptions]), 5000)
    }

    this.ws.onerror = () => this.emit('error', {})
  }

  subscribe(symbols) {
    const args = symbols.map(s => `tickers.${toBybitSymbol(s)}`).filter(Boolean)
    if (!args.length) return
    args.forEach(a => this.subscriptions.add(a.replace('tickers.', '')))
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: 'subscribe', args }))
    }
  }

  handleTicker(data) {
    const ticker = data.data
    if (!ticker) return
    const symbol = ticker.symbol
    const price = parseFloat(ticker.lastPrice)
    const change = parseFloat(ticker.price24hPcnt) * 100
    if (!price || isNaN(price)) return

    this.prices[symbol] = { price, change, volume: ticker.volume24h, timestamp: Date.now() }
    this._pending[symbol] = { symbol, price, change, volume: ticker.volume24h }

    // Batch UI updates ≤ 2/sec — stops header "blinking"
    if (!this._flushTimer) {
      this._flushTimer = setTimeout(() => this._flush(), 500)
    }
  }

  _flush() {
    this._flushTimer = null
    const pending = this._pending
    this._pending = {}
    for (const symbol of Object.keys(pending)) {
      const p = pending[symbol]
      const prev = this._lastEmit[symbol]
      // Skip if price unchanged at 4dp (display precision)
      if (prev != null && Math.abs(prev - p.price) < 0.00005) continue
      this._lastEmit[symbol] = p.price
      this.emit('price', p)
      this.emit(`price:${symbol}`, p)
    }
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
    return () => { this.listeners[event] = (this.listeners[event] || []).filter(l => l !== cb) }
  }

  emit(event, data) {
    (this.listeners[event] || []).forEach(cb => cb(data))
  }

  disconnect() {
    clearTimeout(this.reconnectTimer)
    clearTimeout(this._flushTimer)
    this.stopPing()
    this.ws?.close()
  }
}

export const priceFeed = new BybitPriceFeed()
