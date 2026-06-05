import React, { useState } from 'react'
import { Activity, Play, Loader, CheckCircle, XCircle } from 'lucide-react'
import { useStore } from '../../store'
import { api } from '../../services/api'
import SignalModal from '../shared/SignalModal'
import clsx from 'clsx'

function SignalCard({ signal }) {
  const { executionMode } = useStore()
  const [executing, setExecuting]   = useState(false)
  const [execResult, setExecResult] = useState(null)
  const [execMsg, setExecMsg]       = useState('')
  const [modalOpen, setModalOpen]   = useState(false)
  const isLong = signal.direction === 'LONG'

  const statusConfig = {
    ACTIVE:  { color: 'text-accent-green',  bg: 'bg-accent-green/10 border-accent-green/20',  label: '● ACTIVE' },
    PENDING: { color: 'text-accent-yellow', bg: 'bg-accent-yellow/10 border-accent-yellow/20', label: '◐ PENDING' },
    WATCH:   { color: 'text-text-secondary', bg: 'bg-bg-border/40 border-bg-border',            label: '○ WATCH' },
  }
  const cfg = statusConfig[signal.status] || statusConfig.WATCH

  const handleExecute = async (e) => {
    e?.stopPropagation()
    if (executing || execResult) return
    setExecuting(true)
    try {
      const result = await api.executeSignal(signal.id)
      if (result?.success) {
        setExecResult('success')
        setExecMsg(`Order placed — ${result.qty} ${signal.symbol}`)
      } else {
        setExecResult('error')
        setExecMsg(result?.reason || result?.error || 'Execution failed')
      }
    } catch {
      setExecResult('error')
      setExecMsg('Network error')
    } finally {
      setExecuting(false)
      setTimeout(() => { setExecResult(null); setExecMsg('') }, 5000)
    }
  }

  return (
    <>
      <div onClick={() => setModalOpen(true)} className={clsx(
        'card p-4 flex flex-col gap-3 cursor-pointer hover:border-accent-cyan/20 transition-all duration-300 animate-slide-up',
        signal.status === 'ACTIVE' && 'border-accent-green/20',
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-bold text-text-primary">{signal.symbol}</span>
            <span className={clsx('text-xs font-body font-semibold', isLong ? 'badge-long' : 'badge-short')}>{signal.direction}</span>
          </div>
          <span className={clsx('font-body text-xs border px-2 py-0.5 rounded', cfg.bg, cfg.color)}>{cfg.label}</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="bg-bg-elevated rounded-lg p-2">
            <div className="font-body text-xs text-text-muted mb-1">ENTRY</div>
            <div className="font-display text-xs font-bold text-text-primary">{Number(signal.entry).toFixed(4)}</div>
          </div>
          <div className="bg-accent-green/5 border border-accent-green/10 rounded-lg p-2">
            <div className="font-body text-xs text-accent-green/60 mb-1">TP</div>
            <div className="font-display text-xs font-bold text-accent-green">{Number(signal.tp).toFixed(4)}</div>
          </div>
          <div className="bg-accent-red/5 border border-accent-red/10 rounded-lg p-2">
            <div className="font-body text-xs text-accent-red/60 mb-1">SL</div>
            <div className="font-display text-xs font-bold text-accent-red">{Number(signal.sl).toFixed(4)}</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="flex justify-between mb-1">
              <span className="font-body text-xs text-text-muted">ML Score</span>
              <span className={clsx('font-body text-xs font-semibold',
                signal.confidence >= 75 ? 'text-accent-green' : 'text-accent-yellow'
              )}>{signal.confidence}%</span>
            </div>
            <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden">
              <div className={clsx('h-full rounded-full',
                signal.confidence >= 75 ? 'bg-accent-green' : 'bg-accent-yellow'
              )} style={{ width: `${signal.confidence}%` }} />
            </div>
          </div>
          <div className="text-right">
            <div className="font-body text-xs text-text-muted">RR</div>
            <div className="font-display text-xs font-bold text-accent-cyan">{signal.rr}</div>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <span className={clsx('font-body text-xs px-2 py-0.5 rounded border',
            signal.vwapAbove ? 'bg-accent-green/5 border-accent-green/20 text-accent-green/80' : 'bg-accent-red/5 border-accent-red/20 text-accent-red/80'
          )}>VWAP {signal.vwapAbove ? '▲' : '▼'}</span>
          <span className={clsx('font-body text-xs px-2 py-0.5 rounded border',
            signal.orbBreak ? 'bg-accent-cyan/5 border-accent-cyan/20 text-accent-cyan/80' : 'bg-bg-border/40 border-bg-border text-text-muted'
          )}>ORB {signal.orbBreak ? '✓' : '—'}</span>
          <span className="font-body text-xs px-2 py-0.5 rounded border bg-accent-purple/5 border-accent-purple/20 text-accent-purple/80">{signal.regime}</span>
        </div>

        {execResult && (
          <div className={clsx('flex items-center gap-2 px-3 py-2 rounded-lg border font-body text-xs',
            execResult === 'success' ? 'bg-accent-green/10 border-accent-green/30 text-accent-green' : 'bg-accent-red/10 border-accent-red/30 text-accent-red'
          )}>
            {execResult === 'success' ? <CheckCircle size={13} /> : <XCircle size={13} />}
            {execMsg}
          </div>
        )}

        {executionMode === 'SEMI-AUTO' && !execResult && (
          <button onClick={handleExecute} disabled={executing}
            className={clsx('w-full flex items-center justify-center gap-2 py-2 rounded-lg border font-body text-sm font-semibold transition-all',
              executing ? 'bg-bg-elevated border-bg-border text-text-muted cursor-not-allowed'
              : isLong ? 'bg-accent-green/10 border-accent-green/30 text-accent-green hover:bg-accent-green/20'
              : 'bg-accent-red/10 border-accent-red/30 text-accent-red hover:bg-accent-red/20'
            )}>
            {executing ? <><Loader size={13} className="animate-spin" />Placing...</> : <><Play size={13} />Execute {signal.direction}</>}
          </button>
        )}
        {executionMode === 'FULL-AUTO' && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-accent-green/5 border border-accent-green/20 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-green live-dot" />
            <span className="font-body text-xs text-accent-green">Auto-executing when ACTIVE</span>
          </div>
        )}
      </div>
      {modalOpen && <SignalModal signal={signal} onClose={() => setModalOpen(false)} onExecute={handleExecute} executionMode={executionMode} />}
    </>
  )
}

export default function Signals() {
  const { signals, executionMode, settings } = useStore()
  const [filter, setFilter] = useState('ALL')
  const filtered = signals.filter(s => {
    if (filter === 'ACTIVE')  return s.status === 'ACTIVE'
    if (filter === 'PENDING') return s.status === 'PENDING'
    if (filter === 'LONG')    return s.direction === 'LONG'
    if (filter === 'SHORT')   return s.direction === 'SHORT'
    return true
  })
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Active',  value: signals.filter(s => s.status === 'ACTIVE').length,  color: 'text-accent-green' },
          { label: 'Pending', value: signals.filter(s => s.status === 'PENDING').length, color: 'text-accent-yellow' },
          { label: 'Total',   value: signals.length,                                     color: 'text-accent-cyan' },
        ].map(s => (
          <div key={s.label} className="card p-4 text-center">
            <div className={clsx('font-display text-2xl font-bold', s.color)}>{s.value}</div>
            <div className="font-body text-xs text-text-muted mt-1">{s.label}</div>
          </div>
        ))}
      </div>
      <div className={clsx('flex items-center gap-3 px-4 py-3 rounded-xl border',
        executionMode === 'FULL-AUTO' ? 'bg-accent-green/5 border-accent-green/20'
        : executionMode === 'SEMI-AUTO' ? 'bg-accent-yellow/5 border-accent-yellow/20'
        : 'bg-bg-elevated border-bg-border'
      )}>
        <span className={clsx('w-2 h-2 rounded-full live-dot',
          executionMode === 'FULL-AUTO' ? 'bg-accent-green' : executionMode === 'SEMI-AUTO' ? 'bg-accent-yellow' : 'bg-text-muted'
        )} />
        <div className="flex-1">
          <div className={clsx('font-body text-sm font-semibold',
            executionMode === 'FULL-AUTO' ? 'text-accent-green' : executionMode === 'SEMI-AUTO' ? 'text-accent-yellow' : 'text-text-secondary'
          )}>{executionMode}</div>
          <div className="font-body text-xs text-text-muted">
            {executionMode === 'FULL-AUTO' ? 'Auto-executing ACTIVE signals within safety limits'
            : executionMode === 'SEMI-AUTO' ? 'Tap Execute on any signal to place order'
            : 'View-only mode — switch to Semi or Full-Auto to trade'}
          </div>
        </div>
        <span className="font-body text-xs text-text-muted">ML ≥ {(settings.mlThreshold * 100).toFixed(0)}%</span>
      </div>
      <div className="flex gap-1 bg-bg-card border border-bg-border rounded-lg p-1 w-fit">
        {['ALL','ACTIVE','PENDING','LONG','SHORT'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={clsx('px-2.5 py-1 rounded-md font-body text-xs transition-all',
              filter === f ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20' : 'text-text-muted hover:text-text-secondary'
            )}>{f}</button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Activity size={32} className="text-text-muted mx-auto mb-3" />
          <p className="font-display text-sm font-bold text-text-primary mb-1">No signals</p>
          <p className="font-body text-xs text-text-muted">Engine scans every 5 min · Signals expire after 4 hours</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(s => <SignalCard key={s.id} signal={s} />)}
        </div>
      )}
    </div>
  )
}
