import React, { useState } from 'react'
import { useStore } from '../../store'
import { api } from '../../services/api'
import clsx from 'clsx'

function Toggle({ value, onChange, label, desc }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-[#1E2329] last:border-0">
      <div className="pr-3">
        <div className="text-[13px] font-medium">{label}</div>
        {desc && <div className="text-[11px] text-[#848E9C] mt-0.5">{desc}</div>}
      </div>
      <button type="button" onClick={() => onChange(!value)}
        className={clsx('relative w-10 h-5 rounded-full border shrink-0 transition-colors',
          value ? 'bg-[#F0B90B]/20 border-[#F0B90B]/50' : 'bg-[#161A1E] border-[#2B3139]'
        )}>
        <span className={clsx('absolute top-[3px] w-3.5 h-3.5 rounded-full transition-all',
          value ? 'left-[22px] bg-[#F0B90B]' : 'left-[3px] bg-[#848E9C]'
        )} />
      </button>
    </div>
  )
}

function Slider({ label, desc, value, min, max, step, unit, onChange }) {
  return (
    <div className="py-3 border-b border-[#1E2329] last:border-0">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div>
          <div className="text-[13px] font-medium">{label}</div>
          {desc && <div className="text-[11px] text-[#848E9C]">{desc}</div>}
        </div>
        <div className="mono text-[12px] font-semibold text-[#F0B90B] bg-[#F0B90B]/10 border border-[#F0B90B]/25 px-2 py-0.5 rounded">
          {value}{unit}
        </div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))} className="w-full" />
    </div>
  )
}

export default function Settings() {
  const {
    settings, updateSettings, backendConnected,
    executionMode, setExecutionMode, systemPaused, setPaused,
  } = useStore()
  const [local, setLocal] = useState(() => ({
    ...settings,
    riskPerTrade: { XRPUSDT: Number(settings.riskPerTrade?.XRPUSDT) || 10 },
    beTrigger: settings.beTrigger ?? 2.0,
  }))
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const set = (k, v) => setLocal(p => ({ ...p, [k]: v }))

  const save = async () => {
    setSaving(true)
    updateSettings(local)
    try {
      if (backendConnected) await api.saveSettings(local)
      setToast('Saved')
    } catch {
      setToast('Saved locally')
    }
    setSaving(false)
    setTimeout(() => setToast(null), 2000)
  }

  const mode = async (m) => {
    setExecutionMode(m)
    if (backendConnected) await api.setMode(m)
  }
  const pause = async () => {
    const n = !systemPaused
    setPaused(n)
    if (backendConnected) await api.setPause(n)
  }

  return (
    <div className="space-y-3 max-w-lg">
      <div>
        <h1 className="text-[15px] font-semibold">Settings</h1>
        <p className="text-[11px] text-[#848E9C]">API keys are set on Render — not in the browser</p>
      </div>

      <div className="card p-3">
        <div className="text-[12px] font-semibold mb-2 text-[#EAECEF]">Execution</div>
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {['MANUAL', 'SEMI-AUTO', 'FULL-AUTO'].map(m => (
            <button key={m} onClick={() => mode(m)}
              className={clsx('py-2 rounded text-[11px] font-semibold border',
                executionMode === m
                  ? 'border-[#F0B90B] bg-[#F0B90B]/10 text-[#F0B90B]'
                  : 'border-[#1E2329] text-[#848E9C]'
              )}>{m}</button>
          ))}
        </div>
        <button onClick={pause}
          className={clsx('w-full py-2 rounded text-[12px] font-semibold border',
            systemPaused
              ? 'border-[#0ECB81]/40 text-[#0ECB81] bg-[#0ECB81]/10'
              : 'border-[#F0B90B]/40 text-[#F0B90B] bg-[#F0B90B]/10'
          )}>
          {systemPaused ? 'Resume trading' : 'Pause new trades'}
        </button>
      </div>

      <div className="card p-3">
        <div className="text-[12px] font-semibold mb-1">Risk</div>
        <Slider label="Risk / trade" desc="Validated default 10%"
          value={local.riskPerTrade?.XRPUSDT ?? 10} min={1} max={15} step={0.5} unit="%"
          onChange={v => set('riskPerTrade', { XRPUSDT: v })} />
        <Slider label="Min R:R" desc="Skip weaker setups"
          value={local.minRR} min={1} max={5} step={0.5} unit=":1"
          onChange={v => set('minRR', v)} />
        <Slider label="Daily loss limit" desc="Halt new entries after this loss %"
          value={local.dailyLossLimit} min={5} max={40} step={1} unit="%"
          onChange={v => set('dailyLossLimit', v)} />
        <Slider label="Max trades / day"
          value={local.maxTradesPerDay} min={1} max={10} step={1} unit=""
          onChange={v => set('maxTradesPerDay', v)} />
      </div>

      <div className="card p-3">
        <div className="text-[12px] font-semibold mb-2">Strategy</div>
        <div className="text-[11px] text-[#848E9C] leading-relaxed mb-3 space-y-0.5">
          <p>XRPUSDT · SMA(50/200) · body-ratio &gt; 0.789</p>
          <p>SL 1.5×ATR · TP 4.5×ATR · vol ≤ 60th pctl · lev ≤ 15×</p>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium">Break-even</div>
            <div className="text-[11px] text-[#848E9C]">Move SL to BE at R</div>
          </div>
          <select value={local.beTrigger}
            onChange={e => set('beTrigger', parseFloat(e.target.value))}
            className="bg-[#0B0E11] border border-[#1E2329] rounded px-2 py-1.5 text-[12px] outline-none">
            <option value={1.5}>1.5R</option>
            <option value={2.0}>2.0R ✓</option>
            <option value={2.5}>2.5R</option>
          </select>
        </div>
      </div>

      <div className="card p-3">
        <div className="text-[12px] font-semibold mb-1">Alerts</div>
        <Toggle label="Browser notifications" desc="New signal alerts"
          value={!!local.notifications} onChange={v => set('notifications', v)} />
        <Toggle label="Mobile alerts" value={!!local.mobileAlerts}
          onChange={v => set('mobileAlerts', v)} />
      </div>

      <button onClick={save} disabled={saving} className="btn-primary w-full py-3 disabled:opacity-50">
        {toast || (saving ? 'Saving…' : 'Save settings')}
      </button>
    </div>
  )
}
