/**
 * SmartEdge Trader — API Service
 * Empty BASE_URL = same origin (nginx proxies /api → backend on Fly)
 */
const BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

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

  async getPortfolio()  { return this.request('/api/portfolio') }
  async getPositions()  { return this.request('/api/positions') }
  async getSignals()    { return this.request('/api/signals') }
  async getHistory(limit = 50, offset = 0) {
    return this.request(`/api/history?limit=${limit}&offset=${offset}`)
  }
  async getStatus() { return this.request('/api/status') }
  async ping() { return this.request('/health') }

  async saveSettings(settings) {
    return this.request('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settings)
    })
  }

  async closePosition(id, reason = 'manual') {
    return this.request(`/api/positions/${id}/close?reason=${encodeURIComponent(reason)}`, {
      method: 'POST'
    })
  }

  async executeSignal(signalId) {
    return this.request(`/api/execute/${signalId}`, { method: 'POST' })
  }

  async setMode(mode) {
    return this.request(`/api/mode/${mode}`, { method: 'POST' })
  }

  async setPause(paused) {
    return this.request(`/api/pause/${paused}`, { method: 'POST' })
  }
}

export const api = new ApiService()
