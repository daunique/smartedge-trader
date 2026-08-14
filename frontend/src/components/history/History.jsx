import React, { useMemo, useState } from 'react'
import { useStore } from '../../store'
import clsx from 'clsx'
import { format } from 'date-fns'

export default function History() {
  const { tradeHistory } = useStore()
  const [filter, setFilter] = useState('ALL')

  const trades = useMemo(() => {
    let list = [...(tradeHistory || [])].sort((a, b) => new Date(b.date) - new Date(a.date))
    if (filter === 'WIN') list = list.filter(t => (t.pnl || 0) > 0)
    if (filter === 'LOSS') list = list.filter(t => (t.pnl || 0) <= 0)
    return list
  }, [tradeHistory, filter])

  const totals = useMemo(() => {
    const pnl = trades.reduce((s, t) => s + (t.pnl || 0), 0)
    const wins = trades.filter(t => (t.pnl || 0) > 0).length
    return { pnl, wins, n: trades.length }
  }, [trades])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-lg font-bold">Trade history</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {totals.n} trades · {totals.wins}W · net{' '}
            <span className={totals.pnl >= 0 ? 'text-accent-green' : 'text-accent-red'}>
              {totals.pnl >= 0 ? '+' : ''}${totals.pnl.toFixed(2)}
            </span>
          </p>
        </div>
        <div className="flex gap-1 p-1 rounded-xl bg-bg-elevated border border-bg-border">
          {['ALL', 'WIN', 'LOSS'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                filter === f ? 'bg-accent-cyan/15 text-accent-cyan' : 'text-text-muted hover:text-text-secondary'
              )}>{f}</button>
          ))}
        </div>
      </div>

      {trades.length === 0 ? (
        <div className="card p-12 text-center text-sm text-text-muted">No trades yet</div>
      ) : (
        <div className="card overflow-hidden">
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-bg-border text-[10px] uppercase tracking-wider text-text-muted">
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Pair</th>
                  <th className="px-4 py-3 font-medium">Side</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">R</th>
                  <th className="px-4 py-3 font-medium text-right">PnL</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={t.id || i} className="border-b border-bg-border/50 hover:bg-bg-elevated/40">
                    <td className="px-4 py-3 text-xs text-text-secondary whitespace-nowrap">
                      {format(new Date(t.date), 'MMM d, HH:mm')}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold">{t.symbol}</td>
                    <td className="px-4 py-3">
                      <span className={t.direction === 'LONG' ? 'badge-long' : 'badge-short'}>{t.direction}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-secondary">{t.status}</td>
                    <td className="px-4 py-3 text-xs tabular-nums text-text-secondary">{t.rr}</td>
                    <td className={clsx('px-4 py-3 text-xs font-bold tabular-nums text-right',
                      (t.pnl || 0) >= 0 ? 'text-accent-green' : 'text-accent-red')}>
                      {(t.pnl || 0) >= 0 ? '+' : ''}{(t.pnl || 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-bg-border/50">
            {trades.map((t, i) => (
              <div key={t.id || i} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">{t.symbol}</span>
                    <span className={t.direction === 'LONG' ? 'badge-long' : 'badge-short'}>{t.direction}</span>
                  </div>
                  <div className="text-[11px] text-text-muted mt-0.5">
                    {format(new Date(t.date), 'MMM d · HH:mm')} · {t.status}
                  </div>
                </div>
                <div className={clsx('text-sm font-bold tabular-nums',
                  (t.pnl || 0) >= 0 ? 'text-accent-green' : 'text-accent-red')}>
                  {(t.pnl || 0) >= 0 ? '+' : ''}{(t.pnl || 0).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
