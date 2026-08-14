import React, { useState } from 'react'
import { Shield, Zap, Bell, Save, CheckCircle, AlertTriangle, Pause, Play } from 'lucide-react'
import { useStore } from '../../store'
import { api } from '../../services/api'
import clsx from 'clsx'

function Toggle({ value, onChange, label, desc }) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-bg-border/50 last:border-0">
      <div className="pr-4">
        <div className="text-sm text-text-primary font-medium">{label}</div>
        {desc && <div className="text-xs text-text-muted mt-0.5">{desc}</div>}
      </div>
      <button type="button" onClick={() => onChange(!value)}
        className={clsx(
          'relative w-11 h-6 rounded-full transition-all border shrink-0',
          value ? 'bg-accent-cyan/25 border-accent-cyan/40' : 'bg-bg-elevated border-bg-border'
        )}>
        <span className={clsx(
          'absolute top-0.5 w-4.5 h-4.5 w-[18px] h-[18px] rounded-full transition-all',
          value ? 'left-[22px] bg-accent-cyan' : 'left-0.5 bg-text-muted'
        )} />
      </button>
    </div>
  )
}

function SliderField({ label, desc, value, min, max, step, unit, onChange, danger }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="py-3.5 border-b border-bg-border/50 last:border-0">
      <div className="flex items-center justify-between mb-2 gap-3">
        <div>
          <div className="text-sm text-text-primary font-medium">{label}</div>
          {desc && <div className="text-xs text-text-muted">{desc}</div>}
        </div>
        <div className={clsx(
          'font-display text-sm font-bold px-2.5 py-1 rounded-lg border tabular-nums shrink-0',
          danger ? 'bg-accent-red/10 border-accent-red/30 text-accent-red' : 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan'
        )}>
          {value}{unit}
        </div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full"
        style={{ background: `linear-gradient(to right, ${danger ? '#FF3D6B' : '#00D4FF'} ${pct}%, #1C2840 ${pct}%)` }}
      />
      <div className="flex justify-between mt-1 text-[10px] text-text-muted">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  )
}

export default function Settings() {
  const {
    settings, updateSettings, backendConnected,
    executionMode, setExecutionMode, systemPaused, setPaused,
  } = useStore()
  const [local, setLocal] = useState(() => {
    const s = { ...settings }
    s.riskPerTrade = { XRPUSDT: Number(s.riskPerTrade?.XRPUSDT) || 10 }
    if (s.beTrigger == null) s.beTrigger = 2.0
    return s
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const update = (key, val) => setLocal(prev => ({ ...prev, [key]: val }))

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      updateSettings(local)
      if (backendConnected) {
        const result = await api.saveSettings(local)
        if (!result?.success) throw new Error('Backend save failed')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2200)
    } catch {
      setError('Saved locally — backend unreachable')
      setSaved(true)
      setTimeout(() => { setSaved(false); setError(null) }, 2800)
    } finally {
      setSaving(false)
    }
  }

  const setMode = async (mode) => {
    setExecutionMode(mode)
    if (backendConnected) await api.setMode(mode)
  }

  const togglePause = async () => {
    const next = !systemPaused
    setPaused(next)
    if (backendConnected) await api.setPause(next)
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <h1 className="font-display text-lg font-bold">Settings</h1>
        <p className="text-xs text-text-muted mt-0.5">Risk, mode & alerts · API keys managed on Render</p>
      </div>

      {/* Mode */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap size={16} className="text-accent-yellow" />
          <h3 className="font-display text-sm font-bold">Execution mode</h3>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {['MANUAL', 'SEMI-AUTO', 'FULL-AUTO'].map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={clsx(
                'py-2.5 rounded-xl text-xs font-semibold border transition-all',
                executionMode === m
                  ? 'bg-accent-cyan/15 border-accent-cyan/40 text-accent-cyan'
                  : 'bg-bg-elevated border-bg-border text-text-muted hover:text-text-secondary'
              )}>{m}</button>
          ))}
        </div>
        <button onClick={togglePause}
          className={clsx(
            'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-all',
            systemPaused
              ? 'bg-accent-green/10 border-accent-green/30 text-accent-green'
              : 'bg-accent-yellow/10 border-accent-yellow/30 text-accent-yellow'
          )}>
          {systemPaused ? <><Play size={14} /> Resume trading</> : <><Pause size={14} /> Pause new trades</>}
        </button>
      </div>

      {/* Risk */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-1">
          <Shield size={16} className="text-accent-cyan" />
          <h3 className="font-display text-sm font-bold">Risk management</h3>
        </div>
        <p className="text-xs text-text-muted mb-2">XRPUSDT only · validated defaults recommended</p>
        <SliderField
          label="Risk per trade"
          desc="Percent of equity risked (validated: 10%)"
          value={local.riskPerTrade?.XRPUSDT ?? 10}
          min={1} max={15} step={0.5} unit="%"
          onChange={v => update('riskPerTrade', { XRPUSDT: v })}
          danger={(local.riskPerTrade?.XRPUSDT ?? 10) > 12}
        />
        <SliderField
          label="Minimum R:R"
          desc="Skip signals below this ratio"
          value={local.minRR} min={1} max={5} step={0.5} unit=":1"
          onChange={v => update('minRR', v)}
        />
        <SliderField
          label="Daily loss limit"
          desc="Stop new trades after this daily loss %"
          value={local.dailyLossLimit} min={5} max={40} step={1} unit="%"
          onChange={v => update('dailyLossLimit', v)}
          danger={local.dailyLossLimit < 10}
        />
        <SliderField
          label="Max trades / day"
          desc="Hard daily execution cap"
          value={local.maxTradesPerDay} min={1} max={10} step={1} unit=""
          onChange={v => update('maxTradesPerDay', v)}
        />
      </div>

      {/* Strategy info */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap size={16} className="text-accent-purple" />
          <h3 className="font-display text-sm font-bold">Strategy (fixed)</h3>
        </div>
        <div className="text-xs text-text-secondary leading-relaxed space-y-1.5 mb-3">
          <p>SMA(50/200) trend · body-ratio &gt; 0.789 entry</p>
          <p>SL 1.5×ATR · TP 4.5×ATR (3:1) · vol filter 60th pctl</p>
          <p>Max leverage 15× · risk-based sizing</p>
        </div>
        <div className="flex items-center justify-between py-2.5 border-t border-bg-border">
          <div>
            <div className="text-sm font-medium">Break-even trigger</div>
            <div className="text-xs text-text-muted">Move SL to BE at this R-multiple</div>
          </div>
          <select
            value={local.beTrigger}
            onChange={e => update('beTrigger', parseFloat(e.target.value))}
            className="bg-bg-elevated border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none"
          >
            <option value={1.5}>1.5R</option>
            <option value={2.0}>2.0R (validated)</option>
            <option value={2.5}>2.5R</option>
          </select>
        </div>
      </div>

      {/* Alerts */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-1">
          <Bell size={16} className="text-accent-orange" />
          <h3 className="font-display text-sm font-bold">Notifications</h3>
        </div>
        <Toggle
          label="Browser notifications"
          desc="Alert on new signals"
          value={!!local.notifications}
          onChange={v => update('notifications', v)}
        />
        <Toggle
          label="Mobile alerts"
          desc="Prefer push-style alerts on mobile"
          value={!!local.mobileAlerts}
          onChange={v => update('mobileAlerts', v)}
        />
      </div>

      <button onClick={handleSave} disabled={saving}
        className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-50">
        {saved ? <><CheckCircle size={16} /> {error || 'Saved'}</> : <><Save size={16} /> {saving ? 'Saving…' : 'Save settings'}</>}
      </button>

      {error && !saved && (
        <div className="flex items-center gap-2 text-xs text-accent-yellow">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      <p className="text-[11px] text-text-muted text-center leading-relaxed">
        Bybit API credentials are configured as Render secrets — not stored in the browser.
      </p>
    </div>
  )
}
