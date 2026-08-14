import React, { useState } from 'react'
import { Radio, ArrowUpRight, ArrowDownRight, Zap, Check, X } from 'lucide-react'
import { useStore } from '../../store'
import { api } from '../../services/api'
import clsx from 'clsx'
import { formatDistanceToNow } from 'date-fns'

function SignalCard({ signal }) {
  const { executionMode, dismissSignal, refreshSignals } = useStore()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const isLong = signal.direction === 'LONG'
  const executed = signal.executed

  const execute = async () => {
    setBusy(true)
    setMsg(null)
    const result = await api.executeSignal(signal.id)
    setBusy(false)
    if (result?.success) {
      setMsg(`Filled · qty ${result.qty}`)
      const signals = await api.getSignals()
      if (signals?.signals) refreshSignals(signals.signals)
    } else {
      setMsg(result?.reason || result?.error || 'Failed')
    }
  }

  const age = signal.timestamp
    ? formatDistanceToNow(new Date(signal.timestamp), { addSuffix: true })
    : '—'

  return (
    <div className={clsx(
      'card p-4 transition-all',
      executed ? 'opacity-70' : 'card-glow'
    )}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className={clsx(
            'w-10 h-10 rounded-xl flex items-center justify-center border',
            isLong ? 'bg-accent-green/10 border-accent-green/30' : 'bg-accent-red/10 border-accent-red/30'
          )}>
            {isLong
              ? <ArrowUpRight size={18} className="text-accent-green" />
              : <ArrowDownRight size={18} className="text-accent-red" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-sm font-bold">{signal.symbol}</span>
              <span className={isLong ? 'badge-long' : 'badge-short'}>{signal.direction}</span>
            </div>
            <div className="text-[11px] text-text-muted mt-0.5">{age} · {signal.timeframe || '1H'}</div>
          </div>
        </div>
        {executed ? (
          <span className="text-[10px] font-semibold px-2 py-1 rounded-md bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/25">
            EXECUTED
          </span>
        ) : (
          <span className="text-[10px] font-semibold px-2 py-1 rounded-md bg-accent-green/10 text-accent-green border border-accent-green/25 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-green live-dot" /> LIVE
          </span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          ['Entry', signal.entry],
          ['SL', signal.sl],
          ['TP', signal.tp],
          ['BE', signal.be],
        ].map(([k, v]) => (
          <div key={k} className="bg-bg-elevated/60 rounded-lg p-2 text-center">
            <div className="text-[9px] uppercase tracking-wider text-text-muted mb-0.5">{k}</div>
            <div className="text-xs font-semibold tabular-nums truncate">{v != null ? Number(v).toFixed(4) : '—'}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted mb-3">
        <span className="px-2 py-0.5 rounded-md bg-bg-elevated border border-bg-border">{signal.rr || '1:3.0'}</span>
        {signal.trend && <span className="px-2 py-0.5 rounded-md bg-bg-elevated border border-bg-border">{signal.trend}</span>}
        {signal.entryTrigger && (
          <span className="px-2 py-0.5 rounded-md bg-bg-elevated border border-bg-border truncate max-w-[180px]">
            {signal.entryTrigger}
          </span>
        )}
      </div>

      {msg && (
        <div className={clsx('text-xs mb-3 px-2.5 py-1.5 rounded-lg border',
          msg.startsWith('Filled') ? 'bg-accent-green/10 border-accent-green/25 text-accent-green' : 'bg-accent-red/10 border-accent-red/25 text-accent-red'
        )}>{msg}</div>
      )}

      {!executed && (
        <div className="flex gap-2">
          {(executionMode === 'SEMI-AUTO' || executionMode === 'MANUAL') && (
            <button onClick={execute} disabled={busy}
              className="btn-primary flex-1 flex items-center justify-center gap-1.5 disabled:opacity-50">
              <Zap size={14} />
              {busy ? 'Sending…' : 'Execute'}
            </button>
          )}
          {executionMode === 'FULL-AUTO' && (
            <div className="flex-1 text-center text-xs text-accent-green py-2.5 rounded-xl bg-accent-green/5 border border-accent-green/20">
              Auto-executing…
            </div>
          )}
          <button onClick={() => dismissSignal(signal.id)} className="btn-ghost px-3">
            <X size={14} />
          </button>
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-bold">Live signals</h1>
          <p className="text-xs text-text-muted mt-0.5">XRP/USDT · confluence engine</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <Radio size={14} className="text-accent-cyan" />
          {pending.length} active
        </div>
      </div>

      {active.length === 0 ? (
        <div className="card p-12 text-center">
          <Radio size={28} className="mx-auto text-text-muted mb-3 opacity-50" />
          <div className="text-sm text-text-secondary">No active signals</div>
          <div className="text-xs text-text-muted mt-1">Scanning every 5 min on 1H close</div>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map(s => <SignalCard key={s.id} signal={s} />)}
          {done.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-widest text-text-muted pt-2">Executed</div>
              {done.map(s => <SignalCard key={s.id} signal={s} />)}
            </>
          )}
        </div>
      )}
    </div>
  )
}
