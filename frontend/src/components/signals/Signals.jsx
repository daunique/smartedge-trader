import React, { useState } from 'react'
import { useStore } from '../../store'
import { api } from '../../services/api'
import clsx from 'clsx'
import { formatDistanceToNow } from 'date-fns'

function Card({ signal }) {
  const { executionMode, dismissSignal, refreshSignals } = useStore()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const long = signal.direction === 'LONG'
  const done = signal.executed
  const age = signal.timestamp
    ? formatDistanceToNow(new Date(signal.timestamp), { addSuffix: true })
    : '—'

  const run = async () => {
    setBusy(true); setMsg(null)
    const r = await api.executeSignal(signal.id)
    setBusy(false)
    if (r?.success) {
      setMsg(`Filled · ${r.qty}`)
      const s = await api.getSignals()
      if (s?.signals) refreshSignals(s.signals)
    } else setMsg(r?.reason || r?.error || 'Failed')
  }

  return (
    <div className={clsx('card p-3', done && 'opacity-60')}>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">{signal.symbol}</span>
          <span className={long ? 'pill-long' : 'pill-short'}>{signal.direction}</span>
          <span className="text-[10px] text-[#848E9C]">{signal.timeframe || '1H'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {done ? (
            <span className="text-[10px] font-semibold text-[#F0B90B]">FILLED</span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-[#0ECB81]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0ECB81] live-dot" /> LIVE
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5 mb-2.5">
        {[
          ['Entry', signal.entry],
          ['SL', signal.sl],
          ['TP', signal.tp],
          ['BE @', signal.be],
        ].map(([k, v]) => (
          <div key={k} className="bg-[#0B0E11] rounded px-1.5 py-1.5 text-center border border-[#1E2329]">
            <div className="text-[9px] text-[#848E9C] uppercase">{k}</div>
            <div className="mono text-[11px] font-medium truncate">
              {v != null ? Number(v).toFixed(4) : '—'}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2.5 text-[10px] text-[#848E9C]">
        <span className="px-1.5 py-0.5 rounded bg-[#161A1E] border border-[#1E2329]">{signal.rr || '1:3.0'}</span>
        {signal.trend && <span className="px-1.5 py-0.5 rounded bg-[#161A1E] border border-[#1E2329]">{signal.trend}</span>}
        <span className="px-1.5 py-0.5 text-[#848E9C]">{age}</span>
      </div>

      {msg && (
        <div className={clsx('text-[11px] mb-2 px-2 py-1 rounded',
          msg.startsWith('Filled') ? 'bg-[#0ECB81]/10 text-[#0ECB81]' : 'bg-[#F6465D]/10 text-[#F6465D]'
        )}>{msg}</div>
      )}

      {!done && (
        <div className="flex gap-2">
          {(executionMode === 'SEMI-AUTO' || executionMode === 'MANUAL') && (
            <button onClick={run} disabled={busy} className="btn-primary flex-1 disabled:opacity-50">
              {busy ? 'Sending…' : 'Execute'}
            </button>
          )}
          {executionMode === 'FULL-AUTO' && (
            <div className="flex-1 text-center text-[11px] text-[#0ECB81] py-2.5 rounded border border-[#0ECB81]/25 bg-[#0ECB81]/5">
              Auto mode
            </div>
          )}
          <button onClick={() => dismissSignal(signal.id)} className="btn-ghost px-3 text-[12px]">Skip</button>
        </div>
      )}
    </div>
  )
}

export default function Signals() {
  const { signals } = useStore()
  const active = (signals || []).filter(s => s.status === 'ACTIVE')
  const pending = active.filter(s => !s.executed)
  const done = active.filter(s => s.executed)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold">Signals</h1>
          <p className="text-[11px] text-[#848E9C]">XRPUSDT · SMA 50/200 · body-ratio</p>
        </div>
        <span className="text-[11px] text-[#848E9C] mono">{pending.length} live</span>
      </div>

      {active.length === 0 ? (
        <div className="card py-14 text-center">
          <div className="text-[13px] text-[#B7BDC6] mb-1">Waiting for confluence</div>
          <div className="text-[11px] text-[#848E9C]">Engine scans on each 1H close · ~every 5 min</div>
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map(s => <Card key={s.id} signal={s} />)}
          {done.map(s => <Card key={s.id} signal={s} />)}
        </div>
      )}
    </div>
  )
}
