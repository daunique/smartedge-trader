/**
 * SmartEdge Trader — WebSocket Service
 * Real-time position updates, signals, and price feeds
 */

const WS_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000')
  .replace('https://', 'wss://')
  .replace('http://', 'ws://')

class WebSocketService {
  constructor() {
    this.ws = null
    this.listeners = {}
    this.reconnectTimer = null
    this.reconnectDelay = 3000
    this.maxReconnectDelay = 30000
    this.connected = false
    this.manualClose = false
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return
    this.manualClose = false

    try {
      this.ws = new WebSocket(`${WS_URL}/ws`)

      this.ws.onopen = () => {
        console.log('[WS] Connected')
        this.connected = true
        this.reconnectDelay = 3000
        this.emit('connection', { status: 'connected' })
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          this.emit(data.type, data)
          this.emit('message', data)
        } catch (e) {
          console.error('[WS] Parse error:', e)
        }
      }

      this.ws.onclose = () => {
        this.connected = false
        this.emit('connection', { status: 'disconnected' })
        if (!this.manualClose) this.scheduleReconnect()
      }

      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err)
        this.emit('connection', { status: 'error' })
      }

    } catch (err) {
      console.error('[WS] Failed to connect:', err)
      this.scheduleReconnect()
    }
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      console.log(`[WS] Reconnecting...`)
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay)
      this.connect()
    }, this.reconnectDelay)
  }

  disconnect() {
    this.manualClose = true
    clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.connected = false
  }

  // ── Event System ──────────────────────────────────────────────
  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = []
    this.listeners[event].push(callback)
    return () => this.off(event, callback)
  }

  off(event, callback) {
    if (!this.listeners[event]) return
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback)
  }

  emit(event, data) {
    this.listeners[event]?.forEach(cb => cb(data))
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  isConnected() { return this.connected }
}

export const wsService = new WebSocketService()
