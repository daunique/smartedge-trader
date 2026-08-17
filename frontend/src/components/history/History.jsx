import React, { useMemo, useState } from 'react'
import { useStore } from '../../store'
import clsx from 'clsx'
import { format } from 'date-fns'
import { Download, X } from 'lucide-react'

function TradeDrawer({ trade, onClose }) {
  if (!trade) return null
  const rows = [
    ['Symbol', trade.symbol],
    ['Side', trade.direction],
    ['Status', trade.status],
    ['PnL', `${(trade.pnl || 0) >= 0 ? '+' : ''}${(trade.pnl || 0).toFixed(4)}`],
    ['R', trade.rr ?? '—'],
    ['Time', trade.date ? format(new Date(trade.date), 'yyyy-MM-dd HH:mm:ss') : '—'],
    ['Duration', trade.duration || '—'],
    ['Market', trade.market || 'crypto'],
    ['Id', trade.id || '—'],
  ]
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <div className="card w-full max-w-md p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Trade detail</h2>
          <button onClick={onClose} className="text-[#848E9C] hover:text-[#EAECEF]"><X size={18} /></button>
        </div>
        <div className="space-y-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 text-[12px] border-b border-[#1E2329] pb-1.5">
              <span className="text-[#848E9C]">{k}</span>
              <span className={clsx('mono text-right break-all',
                k === 'PnL' && (trade.pnl || 0) >= 0 && 'text-[#0ECB81]',
                k === 'PnL' && (trade.pnl || 0) < 0 && 'text-[#F6465D]'
              )}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function exportCsv(trades) {
  const header = ['date', 'symbol', 'direction', 'status', 'pnl', 'rr', 'id']
  const lines = [header.join(',')]
  trades.forEach(t => {
    lines.push([
      t.date || '',
      t.symbol || '',
      t.direction || '',
      t.status || '',
      t.pnl ?? '',
      t.rr ?? '',
      t.id || '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
  })
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `smartedge-xrp-trades-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function History() {
  const { tradeHistory } = useStore()
  const [filter, setFilter] = useState('ALL')
  const [pair, setPair] = useState('XRP')
  const [selected, setSelected] = useState(null)

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
        <div className="flex gap-1 flex-wrap items-center">
          <button onClick={() => exportCsv(trades)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#1E2329] text-[10px] font-semibold text-[#EAECEF] hover:border-[#F0B90B]/40">
            <Download size={12} /> CSV
          </button>
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
              <button key={t.id || i} type="button" onClick={() => setSelected(t)}
                className="w-full text-left grid grid-cols-[72px_1fr_52px_56px] sm:grid-cols-[90px_1fr_56px_48px_48px_64px] gap-0 px-3 py-2.5 items-center hover:bg-[#161A1E]/50">
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
              </button>
            ))}
          </div>
        </div>
      )}

      <TradeDrawer trade={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
