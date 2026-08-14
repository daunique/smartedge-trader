import React, { useState } from 'react'
import {
  Shield, Zap, Settings2, Key, Bell, Eye, EyeOff,
  Save, RotateCcw, AlertTriangle, CheckCircle, ChevronDown
} from 'lucide-react'
import { useStore } from '../../store'
import { api } from '../../services/api'
import clsx from 'clsx'

function Toggle({ value, onChange, label, desc }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-bg-border/50">
      <div>
        <div className="font-sans text-sm text-text-primary">{label}</div>
        {desc && <div className="font-body text-xs text-text-muted mt-0.5">{desc}</div>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={clsx(
          'relative w-10 h-5 rounded-full transition-all duration-300 border',
          value ? 'bg-accent-cyan/20 border-accent-cyan/40' : 'bg-bg-elevated border-bg-border'
        )}
      >
        <div className={clsx(
          'absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300',
          value ? 'left-5 bg-accent-cyan' : 'left-0.5 bg-text-muted'
        )} />
      </button>
    </div>
  )
}

function SliderField({ label, desc, value, min, max, step, unit, onChange, danger }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="py-3 border-b border-bg-border/50">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="font-sans text-sm text-text-primary">{label}</div>
          {desc && <div className="font-body text-xs text-text-muted">{desc}</div>}
        </div>
        <div className={clsx(
          'font-display text-sm font-bold px-2.5 py-1 rounded-lg border',
          danger ? 'bg-accent-red/10 border-accent-red/30 text-accent-red'
                 : 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan'
        )}>
          {value}{unit}
        </div>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, ${danger ? '#FF3D6B' : '#00D4FF'} ${pct}%, #1C2840 ${pct}%)`
        }}
      />
      <div className="flex justify-between mt-1">
        <span className="font-body text-xs text-text-muted">{min}{unit}</span>
        <span className="font-body text-xs text-text-muted">{max}{unit}</span>
      </div>
    </div>
  )
}

function SelectField({ label, desc, value, options, onChange }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-bg-border/50">
      <div>
        <div className="font-sans text-sm text-text-primary">{label}</div>
        {desc && <div className="font-body text-xs text-text-muted mt-0.5">{desc}</div>}
      </div>
      <div className="relative">
        <select
          value={value} onChange={e => onChange(e.target.value)}
          className="bg-bg-elevated border border-bg-border rounded-lg px-3 py-1.5 font-body text-sm text-text-primary outline-none appearance-none pr-7 cursor-pointer"
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
      </div>
    </div>
  )
}

export default function Settings() {
  const { settings, updateSettings, accountMode, setAccountMode, backendConnected } = useStore()
  const [showKey, setShowKey]       = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [saved, setSaved]           = useState(false)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState(null)
  const [local, setLocal]           = useState(() => {
    const s = { ...settings }
    const rpt = s.riskPerTrade
    s.riskPerTrade = (rpt && typeof rpt === 'object')
      ? { XRPUSDT: Number(rpt.XRPUSDT) || 10 }
      : { XRPUSDT: 10 }
    if (s.beTrigger == null) s.beTrigger = 2.0
    return s
  })

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
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError('Save failed — settings stored locally only')
      setSaved(true)
      setTimeout(() => { setSaved(false); setError(null) }, 3000)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => setLocal({ ...settings })

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl">

      {/* Connection status */}
      <div className={clsx(
        'flex items-center gap-2 px-3 py-2 rounded-lg border font-body text-xs',
        backendConnected
          ? 'bg-accent-green/5 border-accent-green/20 text-accent-green'
          : 'bg-accent-yellow/5 border-accent-yellow/20 text-accent-yellow'
      )}>
        <span className={clsx('w-1.5 h-1.5 rounded-full live-dot',
          backendConnected ? 'bg-accent-green' : 'bg-accent-yellow'
        )} />
        {backendConnected ? 'Connected to backend — settings will sync' : 'Backend offline — settings saved locally only'}
      </div>

      {/* Risk Management */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={16} className="text-accent-cyan" />
          <h3 className="font-display text-sm font-bold text-text-primary">Risk Management</h3>
        </div>
        <SliderField label="Risk Per Trade" desc="XRPUSDT — % of equity risked per trade (validated: 10%)"
          value={(local.riskPerTrade && local.riskPerTrade.XRPUSDT) || 10} min={1} max={15} step={0.5} unit="%"
          onChange={v => update('riskPerTrade', { XRPUSDT: v })}
          danger={((local.riskPerTrade && local.riskPerTrade.XRPUSDT) || 10) > 12} />
        <SliderField label="Minimum R:R Ratio" desc="Skip signals below this threshold (strategy targets 3:1)"
          value={local.minRR} min={1} max={5} step={0.5} unit=":1"
          onChange={v => update('minRR', v)} />
        <SliderField label="Daily Loss Limit" desc="Pause new trades if realized daily loss exceeds this % of equity"
          value={local.dailyLossLimit} min={5} max={40} step={1} unit="%"
          onChange={v => update('dailyLossLimit', v)}
          danger={local.dailyLossLimit < 10} />
        <SliderField label="Max Trades Per Day" desc="Hard cap on daily executions"
          value={local.maxTradesPerDay} min={1} max={10} step={1} unit=""
          onChange={v => update('maxTradesPerDay', v)} />
      </div>

      {/* Strategy */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={16} className="text-accent-yellow" />
          <h3 className="font-display text-sm font-bold text-text-primary">Strategy Parameters</h3>
        </div>
        <div className="py-3 border-b border-bg-border/50 font-body text-xs text-text-muted leading-relaxed">
          XRPUSDT only — SMA(50/200) trend, body-ratio &gt; 0.789 entry, SL 1.5×ATR,
          TP 4.5×ATR (3:1), skip high-vol (ATR% &gt; 60th pctl). Risk-based size, max 15× leverage.
        </div>
        <SelectField label="Break-Even Trigger" desc="Move SL to breakeven when this R-multiple is reached"
          value={local.beTrigger}
          options={[
            {value:1.5, label:'At 1.5R'},
            {value:2.0, label:'At 2.0R (validated)'},
            {value:2.5, label:'At 2.5R'},
          ]}
          onChange={v => update('beTrigger', parseFloat(v))} />
      </div>

      {/* Exchange */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Settings2 size={16} className="text-accent-purple" />
          <h3 className="font-display text-sm font-bold text-text-primary">Exchange Configuration</h3>
        </div>
        <div className="flex items-center justify-between py-3 border-b border-bg-border/50">
          <div>
            <div className="font-sans text-sm text-text-primary">Account Mode</div>
            <div className="font-body text-xs text-text-muted">Switch between demo and live trading</div>
          </div>
          <div className="flex items-center gap-1 bg-bg-elevated border border-bg-border rounded-lg p-0.5">
            {['DEMO', 'LIVE'].map(m => (
              <button key={m} onClick={() => setAccountMode(m)}
                className={clsx(
                  'px-3 py-1.5 rounded-md font-body text-xs font-semibold transition-all',
                  accountMode === m
                    ? m === 'LIVE'
                      ? 'bg-accent-green/10 text-accent-green border border-accent-green/30'
                      : 'bg-accent-yellow/10 text-accent-yellow border border-accent-yellow/30'
                    : 'text-text-muted hover:text-text-secondary'
                )}>{m}</button>
            ))}
          </div>
        </div>
        <div className="py-3 border-b border-bg-border/50">
          <div className="font-sans text-sm text-text-primary mb-2">Bybit API Key</div>
          <div className="flex items-center gap-2 bg-bg-elevated border border-bg-border rounded-lg px-3 py-2">
            <Key size={13} className="text-text-muted flex-shrink-0" />
            <input type={showKey ? 'text' : 'password'}
              value={local.apiKey}
              onChange={e => update('apiKey', e.target.value)}
              placeholder="Enter your Bybit API key"
              className="bg-transparent font-body text-sm text-text-primary placeholder-text-muted outline-none flex-1 min-w-0" />
            <button onClick={() => setShowKey(!showKey)} className="text-text-muted hover:text-text-secondary">
              {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </div>
        <div className="py-3">
          <div className="font-sans text-sm text-text-primary mb-2">Bybit API Secret</div>
          <div className="flex items-center gap-2 bg-bg-elevated border border-bg-border rounded-lg px-3 py-2">
            <Key size={13} className="text-text-muted flex-shrink-0" />
            <input type={showSecret ? 'text' : 'password'}
              value={local.apiSecret}
              onChange={e => update('apiSecret', e.target.value)}
              placeholder="Enter your Bybit API secret"
              className="bg-transparent font-body text-sm text-text-primary placeholder-text-muted outline-none flex-1 min-w-0" />
            <button onClick={() => setShowSecret(!showSecret)} className="text-text-muted hover:text-text-secondary">
              {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            <AlertTriangle size={11} className="text-accent-yellow" />
            <span className="font-body text-xs text-accent-yellow/70">
              Use read + trade permissions only. Never enable withdrawals.
            </span>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Bell size={16} className="text-accent-orange" />
          <h3 className="font-display text-sm font-bold text-text-primary">Notifications</h3>
        </div>
        <Toggle value={local.notifications} onChange={v => update('notifications', v)}
          label="Browser Notifications" desc="Alerts for signals, TP/SL hits, and daily limits" />
        <Toggle value={local.mobileAlerts} onChange={v => update('mobileAlerts', v)}
          label="Mobile Push Alerts" desc="Push notifications via PWA install" />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent-red/10 border border-accent-red/30 rounded-lg">
          <AlertTriangle size={13} className="text-accent-red" />
          <span className="font-body text-xs text-accent-red">{error}</span>
        </div>
      )}

      {/* Save / Reset */}
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving}
          className={clsx(
            'flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-body text-sm font-semibold transition-all duration-300',
            saved
              ? 'bg-accent-green/10 border border-accent-green/30 text-accent-green'
              : 'bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan hover:bg-accent-cyan/20'
          )}>
          {saving ? (
            <span className="w-4 h-4 border-2 border-accent-cyan/30 border-t-accent-cyan rounded-full animate-spin" />
          ) : saved ? <CheckCircle size={15} /> : <Save size={15} />}
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
        </button>
        <button onClick={handleReset} className="btn-ghost flex items-center gap-2 py-3 px-5">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
    </div>
  )
}
