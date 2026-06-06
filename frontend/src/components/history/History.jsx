import React, { useState, useMemo } from 'react'
import { Search, Download, Clock, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { useStore } from '../../store'
import { format, parseISO, isToday, isSameDay, startOfDay, subDays } from 'date-fns'
import clsx from 'clsx'

const safeDate = (d) => {
  try {
    if (!d) return new Date()
    const num = Number(d)
    if (!isNaN(num) && num > 1000000000000) return new Date(num)
    if (!isNaN(num) && num > 1000000000) return new Date(num * 1000)
    const parsed = new Date(d)
    return isNaN(parsed.getTime()) ? new Date() : parsed
  } catch { return new Date() }
}

const formatDate = (dateStr) => {
  try {
    return format(safeDate(dateStr), 'MMM d, yyyy · HH:mm:ss')
  } catch { return String(dateStr) }
}

const toDate = (dateStr) => safeDate(dateStr)

export default function History() {
  const { tradeHistory } = useStore()
  const [search, setSearch]         = useState('')
  const [filter, setFilter]         = useState('ALL')
  const [sort, setSort]             = useState('date')
  const [selectedDate, setSelected] = useState(startOfDay(new Date()))
  const [showCalendar, setShowCal]  = useState(false)
  const [calMonth, setCalMonth]     = useState(new Date())

  // Only real trades (from backend) — filter out simulated ones
  // Real trades have proper order IDs (not random generated IDs)
  const realTrades = useMemo(() => {
    return tradeHistory.filter(t => {
      // Keep trades that came from the backend (have proper date strings or timestamps)
      // Exclude mock trades which have randomly generated IDs with Math.random pattern
      return t.id && (t.id.length > 10 || t.source === 'bybit_demo')
    })
  }, [tradeHistory])

  // Filter by selected date
  const dayTrades = useMemo(() => {
    return realTrades.filter(t => isSameDay(toDate(t.date), selectedDate))
  }, [realTrades, selectedDate])

  // Apply search + status filter
  const filtered = useMemo(() => {
    return dayTrades
      .filter(t => {
        if (search && !t.symbol?.toLowerCase().includes(search.toLowerCase())) return false
        if (filter === 'TP')     return t.status === 'TP'
        if (filter === 'SL')     return t.status === 'SL'
        if (filter === 'LONG')   return t.direction === 'LONG'
        if (filter === 'SHORT')  return t.direction === 'SHORT'
        return true
      })
      .sort((a, b) => {
        if (sort === 'pnl') return b.pnl - a.pnl
        return toDate(b.date) - toDate(a.date)
      })
  }, [dayTrades, search, filter, sort])

  // Days that have trades (for calendar dots)
  const datesWithTrades = useMemo(() => {
    return new Set(realTrades.map(t => format(toDate(t.date), 'yyyy-MM-dd')))
  }, [realTrades])

  const dayPnl   = dayTrades.reduce((s, t) => s + t.pnl, 0)
  const dayWins  = dayTrades.filter(t => t.status === 'TP').length
  const dayLoss  = dayTrades.filter(t => t.status === 'SL').length

  // Calendar helpers
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()
  const firstDay    = (y, m) => new Date(y, m, 1).getDay()
  const cy = calMonth.getFullYear()
  const cm = calMonth.getMonth()

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Date selector bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Quick date pills */}
        {[0, 1, 2, 3].map(daysAgo => {
          const d = startOfDay(subDays(new Date(), daysAgo))
          const label = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : format(d, 'MMM d')
          const active = isSameDay(d, selectedDate)
          const hasTrades = datesWithTrades.has(format(d, 'yyyy-MM-dd'))
          return (
            <button key={daysAgo} onClick={() => setSelected(d)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-body text-xs transition-all border',
                active ? 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan'
                : 'bg-bg-card border-bg-border text-text-muted hover:text-text-secondary'
              )}>
              {label}
              {hasTrades && <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />}
            </button>
          )
        })}

        {/* Calendar toggle */}
        <button onClick={() => setShowCal(!showCalendar)}
          className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-body text-xs border transition-all ml-auto',
            showCalendar ? 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan' : 'bg-bg-card border-bg-border text-text-muted'
          )}>
          <Calendar size={13} />
          {format(selectedDate, 'MMM d, yyyy')}
        </button>
      </div>

      {/* Calendar dropdown */}
      {showCalendar && (
        <div className="card p-4 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setCalMonth(new Date(cy, cm - 1))}
              className="p-1.5 hover:bg-bg-elevated rounded-lg transition-colors">
              <ChevronLeft size={16} className="text-text-secondary" />
            </button>
            <span className="font-display text-sm font-bold text-text-primary">
              {format(calMonth, 'MMMM yyyy')}
            </span>
            <button onClick={() => setCalMonth(new Date(cy, cm + 1))}
              className="p-1.5 hover:bg-bg-elevated rounded-lg transition-colors">
              <ChevronRight size={16} className="text-text-secondary" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
              <div key={d} className="text-center font-body text-xs text-text-muted py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDay(cy, cm) }, (_, i) => (
              <div key={`e${i}`} />
            ))}
            {Array.from({ length: daysInMonth(cy, cm) }, (_, i) => {
              const day     = new Date(cy, cm, i + 1)
              const dayStr  = format(day, 'yyyy-MM-dd')
              const hasTr   = datesWithTrades.has(dayStr)
              const isActive = isSameDay(day, selectedDate)
              const isFuture = day > new Date()
              return (
                <button key={i} disabled={isFuture}
                  onClick={() => { setSelected(startOfDay(day)); setShowCal(false) }}
                  className={clsx(
                    'relative flex flex-col items-center justify-center h-8 rounded-lg font-body text-xs transition-all',
                    isFuture ? 'text-text-muted cursor-not-allowed opacity-30'
                    : isActive ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/40'
                    : 'hover:bg-bg-elevated text-text-secondary'
                  )}>
                  {i + 1}
                  {hasTr && !isActive && (
                    <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-accent-green" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Day summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="stat-label mb-2">Trades</div>
          <div className="font-display text-xl font-bold text-text-primary">{dayTrades.length}</div>
          <div className="font-body text-xs text-text-muted">{dayWins}W / {dayLoss}L</div>
        </div>
        <div className="card p-4">
          <div className="stat-label mb-2">Day P&L</div>
          <div className={clsx('font-display text-xl font-bold', dayPnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
            {dayPnl >= 0 ? '+' : ''}${dayPnl.toFixed(2)}
          </div>
          <div className="font-body text-xs text-text-muted">{format(selectedDate, 'MMM d, yyyy')}</div>
        </div>
        <div className="card p-4">
          <div className="stat-label mb-2">Win Rate</div>
          <div className={clsx('font-display text-xl font-bold',
            dayTrades.length === 0 ? 'text-text-muted'
            : dayWins / dayTrades.length >= 0.5 ? 'text-accent-green' : 'text-accent-red'
          )}>
            {dayTrades.length === 0 ? '—' : `${((dayWins / dayTrades.length) * 100).toFixed(0)}%`}
          </div>
          <div className="font-body text-xs text-text-muted">Day win rate</div>
        </div>
        <div className="card p-4">
          <div className="stat-label mb-2">Best Trade</div>
          <div className="font-display text-xl font-bold text-accent-green">
            {dayTrades.length === 0 ? '—' : `+$${Math.max(...dayTrades.map(t => t.pnl)).toFixed(2)}`}
          </div>
          <div className="font-body text-xs text-text-muted">Single trade</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-2 bg-bg-card border border-bg-border rounded-lg px-3 py-2 flex-1 min-w-40">
          <Search size={13} className="text-text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search symbol..."
            className="bg-transparent font-body text-sm text-text-primary placeholder-text-muted outline-none flex-1" />
        </div>
        <div className="flex gap-1 bg-bg-card border border-bg-border rounded-lg p-1">
          {['ALL','TP','SL','LONG','SHORT'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={clsx('px-2.5 py-1 rounded-md font-body text-xs transition-all',
                filter === f ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20' : 'text-text-muted hover:text-text-secondary'
              )}>{f}</button>
          ))}
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)}
          className="bg-bg-card border border-bg-border rounded-lg px-3 py-2 font-body text-sm text-text-secondary outline-none">
          <option value="date">Sort: Time</option>
          <option value="pnl">Sort: P&L</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-bg-border bg-bg-elevated/50">
          {[
            { label: 'Symbol',      cls: 'col-span-2' },
            { label: 'Direction',   cls: 'col-span-1' },
            { label: 'Result',      cls: 'col-span-1' },
            { label: 'P&L',         cls: 'col-span-2' },
            { label: 'RR',          cls: 'col-span-1' },
            { label: 'ML',          cls: 'col-span-1 hidden lg:block' },
            { label: 'Duration',    cls: 'col-span-1 hidden lg:block' },
            { label: 'Time',        cls: 'col-span-3 hidden md:block' },
          ].map(h => (
            <div key={h.label} className={clsx('font-body text-xs text-text-muted uppercase tracking-wider', h.cls)}>{h.label}</div>
          ))}
        </div>

        <div className="divide-y divide-bg-border/40 max-h-[55vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Clock size={24} className="text-text-muted mx-auto mb-2" />
              <p className="font-body text-sm text-text-muted">No trades on {format(selectedDate, 'MMMM d, yyyy')}</p>
              <p className="font-body text-xs text-text-muted mt-1">Green dots on the calendar show days with trades</p>
            </div>
          ) : filtered.map(trade => (
            <div key={trade.id} className="grid grid-cols-12 gap-2 px-4 py-3 hover:bg-bg-elevated/40 transition-colors items-center">
              <div className="col-span-2">
                <div className="font-display text-xs font-bold text-text-primary">{trade.symbol}</div>
                <div className="font-body text-xs text-text-muted capitalize">{trade.market}</div>
              </div>
              <div className="col-span-1">
                <span className={clsx('font-body text-xs font-semibold',
                  trade.direction === 'LONG' ? 'text-accent-green' : 'text-accent-red')}>
                  {trade.direction === 'LONG' ? '▲' : '▼'}
                </span>
              </div>
              <div className="col-span-1">
                <span className={clsx('font-body text-xs font-semibold px-1.5 py-0.5 rounded border',
                  trade.status === 'TP'
                    ? 'bg-accent-green/10 text-accent-green border-accent-green/20'
                    : 'bg-accent-red/10 text-accent-red border-accent-red/20'
                )}>{trade.status}</span>
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
                <span className={clsx('font-body text-xs', trade.mlScore >= 0.75 ? 'text-accent-green' : 'text-accent-yellow')}>
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
                <span className="font-body text-xs text-text-secondary">{formatDate(trade.date)}</span>
              </div>
            </div>
          ))}
        </div>

        {filtered.length > 0 && (
          <div className="px-4 py-2.5 border-t border-bg-border bg-bg-elevated/30 flex items-center justify-between">
            <span className="font-body text-xs text-text-muted">{filtered.length} trades</span>
            <span className={clsx('font-display text-sm font-bold', dayPnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
              Day net: {dayPnl >= 0 ? '+' : ''}${dayPnl.toFixed(2)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
