/**
 * WebSocket — same origin by default (nginx upgrades /ws → backend)
 */
function wsBase() {
  const env = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
  if (env) {
    return env.replace('https://', 'wss://').replace('http://', 'ws://')
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}`
}

class WebSocketService {
  constructor() {
    this.ws = null
    this.listeners = {}
    this.reconnectTimer = null
    this.reconnectDelay = 3000
    this.maxReconnectDelay = 30000
    this.connected = false
    this.manualClose = false
    this._handlers = null
  }

  connect(handlers = {}) {
    this._handlers = handlers
    if (this.ws?.readyState === WebSocket.OPEN) return
    this.manualClose = false
    try {
      this.ws = new WebSocket(`${wsBase()}/ws`)
      this.ws.onopen = () => {
        this.connected = true
        this.reconnectDelay = 3000
        handlers.onOpen?.()
        this.emit('connection', { status: 'connected' })
      }
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          handlers.onMessage?.(data)
          this.emit(data.type, data)
          this.emit('message', data)
        } catch (_) {}
      }
      this.ws.onclose = () => {
        this.connected = false
        handlers.onClose?.()
        if (!this.manualClose) this.scheduleReconnect()
      }
      this.ws.onerror = () => handlers.onClose?.()
    } catch (e) {
      console.error('[WS]', e)
      this.scheduleReconnect()
    }
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay)
      this.connect(this._handlers || {})
    }, this.reconnectDelay)
  }

  on(event, cb) {
    if (!this.listeners[event]) this.listeners[event] = []
    this.listeners[event].push(cb)
    return () => {
      this.listeners[event] = (this.listeners[event] || []).filter(x => x !== cb)
    }
  }

  emit(event, data) {
    (this.listeners[event] || []).forEach(cb => cb(data))
  }

  disconnect() {
    this.manualClose = true
    clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }
}

export const wsService = new WebSocketService()
