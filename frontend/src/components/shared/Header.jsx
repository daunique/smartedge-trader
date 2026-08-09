import React, { useState, useEffect } from 'react'
import { Menu, X, Zap, Shield, AlertTriangle } from 'lucide-react'
import { useStore } from '../../store'
import { api } from '../../services/api'
import clsx from 'clsx'

const MODES = ['MANUAL', 'SEMI-AUTO', 'FULL-AUTO']
const MODE_COLORS = {
  'MANUAL':    'text-text-secondary border-text-muted',
  'SEMI-AUTO': 'text-accent-yellow border-accent-yellow',
  'FULL-AUTO': 'text-accent-green border-accent-green',
}
const MODE_BG = {
  'MANUAL':    'bg-text-muted/10',
  'SEMI-AUTO': 'bg-accent-yellow/10',
  'FULL-AUTO': 'bg-accent-green/10',
}

export default function Header() {
  const {
    executionMode, setExecutionMode,
    accountMode, setAccountMode,
    sidebarOpen, setSidebarOpen,
    systemPaused, setPaused,
    portfolioBalance, dailyPnl, dailyPnlPct,
    backendConnected,
  } = useStore()

  const [time, setTime] = useState(new Date())
  const [showConfirm, setShowConfirm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const handleModeChange = (mode) => {
    if (mode === 'FULL-AUTO') {
      setShowConfirm(mode)
    } else {
      applyMode(mode)
    }
  }

  const applyMode = async (mode) => {
    setExecutionMode(mode)
    setSaving(true)
    try {
      if (backendConnected) {
        await api.setMode(mode)
      }
    } catch (e) {
      console.error('Mode change failed:', e)
    } finally {
      setSaving(false)
    }
  }

  const confirmMode = async () => {
    await applyMode(showConfirm)
    setShowConfirm(null)
  }

  const handlePause = async () => {
    const newPaused = !systemPaused
    setPaused(newPaused)
    if (backendConnected) {
      await api.setPause(newPaused)
    }
  }

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-bg-secondary/95 backdrop-blur-md border-b border-bg-border">
        <div className="flex items-center justify-between h-full px-4 gap-3">

          {/* Left: Hamburger + Logo */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-lg hover:bg-bg-elevated transition-colors lg:hidden"
            >
              {sidebarOpen ? <X size={18} className="text-text-secondary" /> : <Menu size={18} className="text-text-secondary" />}
            </button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-accent-cyan/10 border border-accent-cyan/30 flex items-center justify-center">
                <Zap size={14} className="text-accent-cyan" />
              </div>
              <span className="font-display text-sm font-bold text-text-primary tracking-wider hidden sm:block">
                SMART<span className="text-accent-cyan">EDGE</span>
              </span>
            </div>
          </div>

          {/* Center: Mode Toggle */}
          <div className="flex items-center gap-1 bg-bg-card border border-bg-border rounded-lg p-0.5 relative">
            {saving && (
              <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-accent-cyan animate-pulse" />
            )}
            {MODES.map(mode => (
              <button
                key={mode}
                onClick={() => handleModeChange(mode)}
                className={clsx(
                  'px-2 py-1 rounded-md text-xs font-body font-medium transition-all duration-200',
                  executionMode === mode
                    ? `${MODE_BG[mode]} ${MODE_COLORS[mode]} border`
                    : 'text-text-muted hover:text-text-secondary'
                )}
              >
                <span className="hidden sm:inline">{mode}</span>
                <span className="sm:hidden">{mode === 'MANUAL' ? 'M' : mode === 'SEMI-AUTO' ? 'S' : 'A'}</span>
              </button>
            ))}
          </div>

          {/* Right */}
          <div className="flex items-center gap-2">
            <div className="hidden md:flex flex-col items-end">
              <span className="font-display text-sm font-bold text-text-primary">
                ${portfolioBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
              <span className={clsx('font-body text-xs', dailyPnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
                {dailyPnl >= 0 ? '+' : ''}{dailyPnlPct.toFixed(2)}% today
              </span>
            </div>

            {/* Demo/Live Toggle */}
            <button
              onClick={() => setAccountMode(accountMode === 'DEMO' ? 'LIVE' : 'DEMO')}
              className={clsx(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-body font-semibold transition-all duration-300',
                accountMode === 'LIVE'
                  ? 'bg-accent-green/10 border-accent-green/40 text-accent-green'
                  : 'bg-accent-yellow/10 border-accent-yellow/40 text-accent-yellow'
              )}
            >
              <span className={clsx('w-1.5 h-1.5 rounded-full live-dot',
                accountMode === 'LIVE' ? 'bg-accent-green' : 'bg-accent-yellow'
              )} />
              {accountMode}
            </button>

            {/* Pause/Emergency */}
            <button
              onClick={handlePause}
              className={clsx(
                'p-1.5 rounded-lg border transition-all duration-200',
                systemPaused
                  ? 'bg-accent-red/20 border-accent-red/40 text-accent-red'
                  : 'bg-bg-elevated border-bg-border text-text-secondary hover:border-accent-red/40 hover:text-accent-red'
              )}
              title={systemPaused ? 'Resume System' : 'Pause System'}
            >
              <Shield size={15} />
            </button>

            {/* Clock */}
            <div className="hidden lg:flex items-center gap-1.5 bg-bg-card border border-bg-border rounded-lg px-2.5 py-1.5">
              <span className={clsx('w-1.5 h-1.5 rounded-full live-dot',
                backendConnected ? 'bg-accent-green' : 'bg-accent-yellow'
              )} />
              <span className="font-body text-xs text-text-secondary">
                {time.toUTCString().slice(17, 25)} UTC
              </span>
            </div>
          </div>
        </div>

        {systemPaused && (
          <div className="bg-accent-red/10 border-b border-accent-red/30 px-4 py-1.5 flex items-center gap-2">
            <AlertTriangle size={13} className="text-accent-red" />
            <span className="font-body text-xs text-accent-red">
              SYSTEM PAUSED — No new trades will be executed. Click shield to resume.
            </span>
          </div>
        )}
      </header>

      {/* Full-Auto Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-bg-card border border-accent-yellow/30 rounded-2xl p-6 max-w-sm mx-4 shadow-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-accent-yellow/10 border border-accent-yellow/30 flex items-center justify-center">
                <AlertTriangle size={20} className="text-accent-yellow" />
              </div>
              <div>
                <h3 className="font-display text-sm font-bold text-text-primary">Enable Full Auto?</h3>
                <p className="font-body text-xs text-text-secondary">System will trade autonomously</p>
              </div>
            </div>
            <div className="space-y-2 mb-5">
              {[
                'Min 1:3 R:R enforced (SL=1.5xATR / TP=4.5xATR)',
                'Daily loss limit enforced (20%, safety net only)',
                'Max trades/day respected',
                'Kill switch always active',
                'Break-even auto-triggered at 1:1.5',
              ].map(item => (
                <div key={item} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                  <span className="font-body text-xs text-text-secondary">{item}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowConfirm(null)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={confirmMode} className="flex-1 bg-accent-yellow/10 border border-accent-yellow/40 text-accent-yellow font-body text-sm font-semibold px-4 py-2 rounded-lg hover:bg-accent-yellow/20 transition-all">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
