/**
 * SmartEdge Trader — Push Notification Service
 * Handles: browser notifications, PWA install prompt, alert sounds
 */

class NotificationService {
  constructor() {
    this.permission  = 'default'
    this.installPrompt = null
    this.enabled     = true
    this.init()
  }

  async init() {
    // Capture PWA install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault()
      this.installPrompt = e
      window.dispatchEvent(new CustomEvent('pwa-installable'))
    })

    // Check existing permission
    if ('Notification' in window) {
      this.permission = Notification.permission
    }
  }

  async requestPermission() {
    if (!('Notification' in window)) return false
    if (this.permission === 'granted') return true
    const result = await Notification.requestPermission()
    this.permission = result
    return result === 'granted'
  }

  async notify(title, body, options = {}) {
    if (!this.enabled) return
    const granted = await this.requestPermission()
    if (!granted) return

    const notification = new Notification(title, {
      body,
      icon:   '/icon-192.png',
      badge:  '/icon-192.png',
      tag:    options.tag || 'smartedge',
      silent: options.silent || false,
      ...options,
    })

    notification.onclick = () => {
      window.focus()
      notification.close()
      if (options.onClick) options.onClick()
    }

    // Auto-close after 8 seconds
    setTimeout(() => notification.close(), 8000)
    return notification
  }

  // ── Specific alert types ──────────────────────────────────────
  async signalAlert(signal) {
    return this.notify(
      `🎯 ${signal.symbol} ${signal.direction} Signal`,
      `Entry: ${signal.entry} · TP: ${signal.tp} · SL: ${signal.sl} · ML: ${signal.confidence}%`,
      { tag: `signal-${signal.id}` }
    )
  }

  async tpAlert(symbol, pnl) {
    return this.notify(
      `✅ Take Profit Hit — ${symbol}`,
      `+$${pnl.toFixed(2)} profit secured`,
      { tag: `tp-${symbol}`, silent: false }
    )
  }

  async slAlert(symbol, pnl) {
    return this.notify(
      `🛑 Stop Loss Hit — ${symbol}`,
      `-$${Math.abs(pnl).toFixed(2)} loss · System managed SL`,
      { tag: `sl-${symbol}` }
    )
  }

  async beAlert(symbol) {
    return this.notify(
      `🔒 Break-Even Locked — ${symbol}`,
      'Stop loss moved to entry · No loss possible',
      { tag: `be-${symbol}` }
    )
  }

  async autoExecutedAlert(result) {
    return this.notify(
      `⚡ Auto-Executed — ${result.symbol}`,
      `${result.direction} ${result.qty} @ ${result.entry} · TP: ${result.tp}`,
      { tag: `exec-${result.symbol}` }
    )
  }

  async dailyLimitAlert(pct) {
    return this.notify(
      '⚠️ Daily Loss Limit Approaching',
      `${pct.toFixed(1)}% of daily limit used · Trading paused`,
      { tag: 'daily-limit', silent: false }
    )
  }

  // ── PWA Install ───────────────────────────────────────────────
  async promptInstall() {
    if (!this.installPrompt) return false
    this.installPrompt.prompt()
    const { outcome } = await this.installPrompt.userChoice
    this.installPrompt = null
    return outcome === 'accepted'
  }

  isInstallable() { return !!this.installPrompt }
  isInstalled()   {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true
  }

  setEnabled(v) { this.enabled = v }
}

export const notifications = new NotificationService()
