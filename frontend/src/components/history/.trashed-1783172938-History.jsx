import React, { useState } from 'react'
import { Search, Download, TrendingUp, TrendingDown, CheckCircle, XCircle, Clock, BarChart2 } from 'lucide-react'
import { useStore } from '../../store'
import { format, parseISO } from 'date-fns'
import clsx from 'clsx'

export default function History() {
  const { tradeHistory } = useStore()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('ALL')
  const [sort, setSort]     = useState('date')

  const filtered = tradeHistory
    .filter(t => {
      if (search && !t.symbol.toLowerCase().includes(search.toLowerCase())) return false
      if (filter === 'TP')     return t.status === 'TP'
      if (filter === 'SL')     return t.status === 'SL'
      if (filter === 'CRYPTO') return t.market === 'crypto'
      if (filter === 'FOREX')  return t.market === 'forex'
      return true
    })
    .sort((a, b) => {
      if (sort === 'pnl')  return b.pnl - a.pnl
      if (sort === 'rr')   return parseFloat(b.rr) - parseFloat(a.rr)
      return new Date(b.date) - new Date(a.date)
    })

  const wins     = tradeHistory.filter(t => t.status === 'TP').length
  const losses   = tradeHistory.filter(t => t.status === 'SL').length
  const totalPnl = tradeHistory.reduce((s, t) => s + t.pnl, 0)
  const avgWin   = tradeHistory.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / (wins || 1)
  const avgLoss  = Math.abs(tradeHistory.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0)) / (losses || 1)

  const formatDate = (dateStr) => {
    try {
      const d = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr)
      return format(d, 'MMM d, yyyy · HH:mm:ss')
    } catch { return dateStr }
  }

  const exportCSV = () => {
    const rows = [
      ['Date & Time', 'Symbol', 'Direction', 'Status', 'P&L', 'RR', 'ML Score', 'Duration', 'Market'],
      ...filtered.map(t => [
        formatDate(t.date), t.symbol, t.direction, t.status,
        t.pnl.toFixed(2), t.status === 'TP' ? `1:${t.rr}` : '—',
        `${(t.mlScore * 100).toFixed(0)}%`, t.duration, t.market
      ])
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'smartedge-history.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Summary Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Trades', value: tradeHistory.length, sub: `${wins}W / ${losses}L`, color: 'text-text-primary' },
          { label: 'Total P&L',    value: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(0)}`, sub: 'All time', color: totalPnl >= 0 ? 'text-accent-green' : 'text-accent-red' },
          { label: 'Avg Win',      value: `+$${avgWin.toFixed(0)}`,  sub: 'Per winning trade', color: 'text-accent-green' },
          { label: 'Avg Loss',     value: `-$${avgLoss.toFixed(0)}`, sub: 'Per losing trade',  color: 'text-accent-red' },
        ].map(s => (
          <div key={s.label} className="card p-4">
            <div className="stat-label mb-2">{s.label}</div>
            <div className={clsx('font-display text-xl font-bold', s.color)}>{s.value}</div>
            <div className="font-body text-xs text-text-muted mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-2 bg-bg-card border border-bg-border rounded-lg px-3 py-2 flex-1 min-w-40">
          <Search size={13} className="text-text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search symbol..."
            className="bg-transparent font-body text-sm text-text-primary placeholder-text-muted outline-none flex-1" />
        </div>
        <div className="flex items-center gap-1 bg-bg-card border border-bg-border rounded-lg p-1">
          {['ALL','TP','SL','CRYPTO','FOREX'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={clsx('px-2.5 py-1 rounded-md font-body text-xs transition-all',
                filter === f
                  ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20'
                  : 'text-text-muted hover:text-text-secondary'
              )}>{f}</button>
          ))}
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)}
          className="bg-bg-card border border-bg-border rounded-lg px-3 py-2 font-body text-sm text-text-secondary outline-none">
          <option value="date">Sort: Date</option>
          <option value="pnl">Sort: P&L</option>
          <option value="rr">Sort: RR</option>
        </select>
        <button onClick={exportCSV} className="btn-ghost flex items-center gap-1.5">
          <Download size={13} />
          <span className="hidden sm:inline">Export CSV</span>
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-bg-border bg-bg-elevated/50">
          {[
            { label: 'Symbol',     cls: 'col-span-2' },
            { label: 'Dir',        cls: 'col-span-1' },
            { label: 'Result',     cls: 'col-span-1' },
            { label: 'P&L',        cls: 'col-span-2' },
            { label: 'RR',         cls: 'col-span-1' },
            { label: 'ML',         cls: 'col-span-1 hidden lg:block' },
            { label: 'Duration',   cls: 'col-span-1 hidden lg:block' },
            { label: 'Date & Time',cls: 'col-span-3 hidden md:block' },
          ].map(h => (
            <div key={h.label} className={clsx('font-body text-xs text-text-muted uppercase tracking-wider', h.cls)}>
              {h.label}
            </div>
          ))}
        </div>

        <div className="divide-y divide-bg-border/40 max-h-[60vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center font-body text-sm text-text-muted">No trades found</div>
          ) : filtered.map(trade => (
            <div key={trade.id}
              className="grid grid-cols-12 gap-2 px-4 py-3 hover:bg-bg-elevated/40 transition-colors items-center">
              <div className="col-span-2">
                <div className="font-display text-xs font-bold text-text-primary">{trade.symbol}</div>
                <div className="font-body text-xs text-text-muted capitalize">{trade.market}</div>
              </div>
              <div className="col-span-1">
                <span className={clsx('font-body text-xs font-semibold',
                  trade.direction === 'LONG' ? 'text-accent-green' : 'text-accent-red')}>
                  {trade.direction === 'LONG' ? '▲ L' : '▼ S'}
                </span>
              </div>
              <div className="col-span-1">
                <span className={clsx(
                  'font-body text-xs font-semibold px-1.5 py-0.5 rounded border',
                  trade.status === 'TP'
                    ? 'bg-accent-green/10 text-accent-green border-accent-green/20'
                    : 'bg-accent-red/10 text-accent-red border-accent-red/20'
                )}>
                  {trade.status}
                </span>
              </div>
              <div className="col-span-2">
                <span className={clsx('font-display text-sm font-bold',
                  trade.pnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
                  {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                </span>
              </div>
              <div className="col-span-1">
                <span className="font-body text-xs text-accent-cyan">
                  {trade.status === 'TP' ? `1:${trade.rr}` : '—'}
                </span>
              </div>
              <div className="col-span-1 hidden lg:block">
                <span className={clsx('font-body text-xs',
                  trade.mlScore >= 0.75 ? 'text-accent-green' : 'text-accent-yellow')}>
                  {(trade.mlScore * 100).toFixed(0)}%
                </span>
              </div>
              <div className="col-span-1 hidden lg:block">
                <div className="flex items-center gap-1">
                  <Clock size={10} className="text-text-muted" />
                  <span className="font-body text-xs text-text-muted">{trade.duration}</span>
                </div>
              </div>
              <div className="col-span-3 hidden md:block">
                <span className="font-body text-xs text-text-secondary">
                  {formatDate(trade.date)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-bg-border bg-bg-elevated/30 flex items-center justify-between">
          <span className="font-body text-xs text-text-muted">{filtered.length} trades</span>
          <span className={clsx('font-display text-sm font-bold',
            totalPnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
            Net: {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}
