/**
 * SmartEdge Trader — API Service
 */

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

class ApiService {
  async request(endpoint, options = {}) {
    try {
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      console.error(`[API] ${endpoint} failed:`, err)
      return null
    }
  }

  // ── Portfolio ─────────────────────────────────────────────────
  async getPortfolio()  { return this.request('/api/portfolio') }
  async getPositions()  { return this.request('/api/positions') }
  async getSignals()    { return this.request('/api/signals') }
  async getHistory(limit = 50, offset = 0) {
    return this.request(`/api/history?limit=${limit}&offset=${offset}`)
  }

  // ── Settings ──────────────────────────────────────────────────
  async saveSettings(settings) {
    return this.request('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settings)
    })
  }

  // ── Trade Actions ─────────────────────────────────────────────
  async closePosition(id, reason = 'manual') {
    return this.request(`/api/positions/${id}/close?reason=${reason}`, {
      method: 'POST'
    })
  }

  async executeSignal(signalId) {
    return this.request(`/api/execute/${signalId}`, { method: 'POST' })
  }

  // ── Mode & Control ────────────────────────────────────────────
  async setMode(mode) {
    return this.request(`/api/mode/${mode}`, { method: 'POST' })
  }

  async setPause(paused) {
    return this.request(`/api/pause/${paused}`, { method: 'POST' })
  }

  // ── Health ────────────────────────────────────────────────────
  async ping() { return this.request('/health') }
  async getStatus() { return this.request('/api/status') }
}

export const api = new ApiService()
