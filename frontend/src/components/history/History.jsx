import React, { useMemo, useState } from 'react'
import { useStore } from '../../store'
import clsx from 'clsx'
import { format } from 'date-fns'

export default function History() {
  const { tradeHistory } = useStore()
  const [filter, setFilter] = useState('ALL')
  const [pair, setPair] = useState('XRP')

  const trades = useMemo(() => {
    let list = [...(tradeHistory || [])].sort((a, b) => new Date(b.date) - new Date(a.date))
    if (pair === 'XRP') list = list.filter(t => String(t.symbol || '').includes('XRP'))
    if (filter === 'WIN') list = list.filter(t => (t.pnl || 0) > 0)
    if (filter === 'LOSS') list = list.filter(t => (t.pnl || 0) <= 0)
    return list
  }, [tradeHistory, filter, pair])

  const net = trades.reduce((s, t) => s + (t.pnl || 0), 0)
  const wins = trades.filter(t => (t.pnl || 0) > 0).length

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-[15px] font-semibold">History</h1>
          <p className="text-[11px] text-[#848E9C]">
            {trades.length} trades · {wins}W ·{' '}
            <span className={clsx('mono font-medium', net >= 0 ? 'pos' : 'neg')}>
              {net >= 0 ? '+' : ''}{net.toFixed(2)}
            </span>
          </p>
        </div>
        <div className="flex gap-1">
          <div className="flex p-0.5 rounded bg-[#161A1E] border border-[#1E2329]">
            {['XRP', 'ALL'].map(p => (
              <button key={p} onClick={() => setPair(p)}
                className={clsx('px-2 py-1 rounded text-[10px] font-semibold',
                  pair === p ? 'bg-[#1E2329] text-[#F0B90B]' : 'text-[#848E9C]')}>{p}</button>
            ))}
          </div>
          <div className="flex p-0.5 rounded bg-[#161A1E] border border-[#1E2329]">
            {['ALL', 'WIN', 'LOSS'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={clsx('px-2 py-1 rounded text-[10px] font-semibold',
                  filter === f ? 'bg-[#1E2329] text-[#F0B90B]' : 'text-[#848E9C]')}>{f}</button>
            ))}
          </div>
        </div>
      </div>

      {trades.length === 0 ? (
        <div className="card py-12 text-center text-[12px] text-[#848E9C]">No trades</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-[72px_1fr_52px_56px] sm:grid-cols-[90px_1fr_56px_48px_48px_64px] gap-0 px-3 py-2 border-b border-[#1E2329] text-[10px] text-[#848E9C] uppercase tracking-wide font-medium">
            <div>Time</div>
            <div>Pair</div>
            <div className="hidden sm:block">Side</div>
            <div className="hidden sm:block">Exit</div>
            <div className="text-right sm:text-left">R</div>
            <div className="text-right">PnL</div>
          </div>
          <div className="divide-y divide-[#1E2329]">
            {trades.map((t, i) => (
              <div key={t.id || i}
                className="grid grid-cols-[72px_1fr_52px_56px] sm:grid-cols-[90px_1fr_56px_48px_48px_64px] gap-0 px-3 py-2.5 items-center hover:bg-[#161A1E]/50">
                <div className="text-[11px] text-[#848E9C] mono">
                  {format(new Date(t.date), 'MM/dd HH:mm')}
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[12px] font-medium truncate">{t.symbol}</span>
                  <span className={clsx('sm:hidden', t.direction === 'LONG' ? 'pill-long' : 'pill-short')}>
                    {t.direction === 'LONG' ? 'L' : 'S'}
                  </span>
                </div>
                <div className="hidden sm:block">
                  <span className={t.direction === 'LONG' ? 'pill-long' : 'pill-short'}>{t.direction}</span>
                </div>
                <div className="hidden sm:block text-[11px] text-[#848E9C]">{t.status}</div>
                <div className="mono text-[11px] text-[#848E9C] text-right sm:text-left">{t.rr || '—'}</div>
                <div className={clsx('mono text-[12px] font-semibold text-right', (t.pnl || 0) >= 0 ? 'pos' : 'neg')}>
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
