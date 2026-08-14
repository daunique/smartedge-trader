import React, { useMemo, useState, useEffect } from 'react'
import {
  TrendingUp, TrendingDown, Activity, Target, Zap,
  Clock, Shield, X, Flame
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useStore } from '../../store'
import { api } from '../../services/api'
import clsx from 'clsx'
import { format } from 'date-fns'

function EquityChart({ tradeHistory }) {
  const data = useMemo(() => {
    const sorted = [...(tradeHistory || [])].sort((a, b) => new Date(a.date) - new Date(b.date))
    let run = 0
    return sorted.slice(-30).map(t => {
      run += t.pnl || 0
      return { pnl: Math.round(run * 100) / 100, date: format(new Date(t.date), 'MMM d') }
    })
  }, [tradeHistory])

  if (!data.length) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        No closed trades yet
      </div>
    )
  }

  const Tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-bg-elevated border border-bg-border rounded-lg px-3 py-2 shadow-lg">
        <p className="text-xs text-text-muted">{payload[0]?.payload?.date}</p>
        <p className={clsx('text-sm font-bold tabular-nums', payload[0]?.value >= 0 ? 'text-accent-green' : 'text-accent-red')}>
          ${payload[0]?.value?.toLocaleString()}
        </p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="eqg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00D4FF" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#00D4FF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" hide />
        <YAxis hide domain={['auto', 'auto']} />
        <Tooltip content={<Tip />} />
        <Area type="monotone" dataKey="pnl" stroke="#00D4FF" strokeWidth={2} fill="url(#eqg)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function StatPill({ label, value, sub, positive }) {
  return (
    <div className="card card-glow p-3.5 sm:p-4">
      <div className="stat-label mb-1.5">{label}</div>
      <div className={clsx('stat-value', positive === true && 'text-accent-green', positive === false && 'text-accent-red')}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-text-muted mt-1">{sub}</div>}
    </div>
  )
}

function PositionCard({ position }) {
  const isLong = position.direction === 'LONG'
  const closePositionInStore = useStore(s => s.closePosition)
  const [confirming, setConfirming] = useState(false)
  const [closing, setClosing] = useState(false)
  const progress = Math.min(100, Math.max(0, ((position.rrAchieved || 0) / 3) * 100))

  const handleClose = async () => {
    if (!confirming) {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 3500)
      return
    }
    setClosing(true)
    const result = await api.closePosition(position.id, 'manual')
    setClosing(false)
    setConfirming(false)
    if (result?.success) closePositionInStore(position.id)
    else alert(`Close failed: ${result?.error || result?.result?.retMsg || 'unknown'}`)
  }

  return (
    <div className="card p-3.5 border-bg-border/80">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-bold">{position.symbol}</span>
            <span className={isLong ? 'badge-long' : 'badge-short'}>{position.direction}</span>
          </div>
          <div className="text-[11px] text-text-muted mt-1">
            Entry {position.entry} · Mark {position.current}
          </div>
        </div>
        <div className="text-right">
          <div className={clsx('font-display text-base font-bold tabular-nums', position.pnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
            {position.pnl >= 0 ? '+' : ''}${(position.pnl || 0).toFixed(2)}
          </div>
          <div className={clsx('text-[11px]', position.pnl >= 0 ? 'text-accent-green/70' : 'text-accent-red/70')}>
            {(position.pnlPct || 0) >= 0 ? '+' : ''}{(position.pnlPct || 0).toFixed(2)}%
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
          <div className="h-full bg-accent-cyan rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-[11px] text-accent-cyan tabular-nums font-medium">
          {(position.rrAchieved || 0).toFixed(2)}R
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-text-muted">
          SL {position.sl || '—'} · TP {position.tp || '—'}
          {position.status === 'BE' && <span className="ml-1 text-accent-yellow">BE ✓</span>}
        </div>
        <button onClick={handleClose} disabled={closing}
          className={clsx(
            'text-[11px] px-2.5 py-1 rounded-lg border transition-colors',
            confirming
              ? 'bg-accent-red/20 border-accent-red/50 text-accent-red'
              : 'border-bg-border text-text-muted hover:text-accent-red hover:border-accent-red/40',
            closing && 'opacity-50'
          )}>
          {closing ? '…' : confirming ? 'Confirm' : 'Close'}
        </button>
      </div>
    </div>
  )
}

function CandleCountdown() {
  const [left, setLeft] = useState('')
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const d = 3600 - (now.getUTCMinutes() * 60 + now.getUTCSeconds())
      setLeft(`${Math.floor(d / 60)}m ${String(d % 60).padStart(2, '0')}s`)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="card p-3.5 flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-accent-cyan/10 border border-accent-cyan/25 flex items-center justify-center">
        <Clock size={16} className="text-accent-cyan" />
      </div>
      <div>
        <div className="stat-label">Next 1H close</div>
        <div className="font-display text-base font-bold tabular-nums">{left}</div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const {
    portfolioBalance, dailyPnl, dailyPnlPct, weeklyPnl,
    winRate, avgRR, positions, tradeHistory, settings,
    currentStreak, openPnl, totalTrades, executionMode,
  } = useStore()

  const todayTrades = useMemo(() => {
    const n = new Date()
    return (tradeHistory || []).filter(t => {
      const d = new Date(t.date)
      return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
    })
  }, [tradeHistory])

  const todayWins = todayTrades.filter(t => (t.pnl || 0) > 0).length
  const todayLosses = todayTrades.filter(t => (t.pnl || 0) <= 0).length
  const maxTrades = settings.maxTradesPerDay || 4
  const lossUsedPct = Math.min(100, (Math.abs(Math.min(0, dailyPnl)) / (Math.max(portfolioBalance, 1) * (settings.dailyLossLimit || 25) / 100)) * 100)

  return (
    <div className="space-y-4">
      {/* Balance hero */}
      <div className="card card-glow p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="stat-label mb-1">Portfolio</div>
            <div className="font-display text-2xl sm:text-3xl font-bold tabular-nums">
              ${Number(portfolioBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className={clsx('text-sm mt-1.5 font-medium tabular-nums', dailyPnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
              {dailyPnl >= 0 ? '▲' : '▼'} ${Math.abs(dailyPnl).toFixed(2)}
              <span className="text-text-muted font-normal ml-1">({dailyPnlPct.toFixed(2)}% today)</span>
            </div>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-accent-cyan/10 border border-accent-cyan/25 flex items-center justify-center">
            <Zap size={20} className="text-accent-cyan" />
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
        <StatPill label="Open P&L"
          value={`${openPnl >= 0 ? '+' : ''}$${openPnl.toFixed(2)}`}
          sub={`${positions.length} open`}
          positive={openPnl > 0 ? true : openPnl < 0 ? false : null} />
        <StatPill label="Win rate" value={`${winRate}%`} sub={`${totalTrades} trades`} />
        <StatPill label="Avg R" value={avgRR ? `${avgRR.toFixed(2)}R` : '—'} sub={`Today ${todayWins}W / ${todayLosses}L`} />
        <StatPill label="7d P&L"
          value={`${weeklyPnl >= 0 ? '+' : ''}$${weeklyPnl.toFixed(2)}`}
          positive={weeklyPnl > 0 ? true : weeklyPnl < 0 ? false : null} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-display text-sm font-bold">Equity curve</h3>
              <p className="text-[11px] text-text-muted">Last 30 closed trades</p>
            </div>
            <div className={clsx('text-sm font-bold tabular-nums', weeklyPnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
              {weeklyPnl >= 0 ? '+' : ''}{weeklyPnl.toFixed(2)} <span className="text-text-muted font-normal text-xs">7d</span>
            </div>
          </div>
          <div className="h-40 sm:h-48"><EquityChart tradeHistory={tradeHistory} /></div>
        </div>

        <div className="space-y-3">
          <CandleCountdown />
          <div className="card p-3.5">
            <div className="flex items-center justify-between mb-2">
              <span className="stat-label">Streak</span>
              <Flame size={14} className={currentStreak > 0 ? 'text-accent-green' : 'text-accent-red'} />
            </div>
            <div className={clsx('font-display text-2xl font-bold', currentStreak > 0 ? 'text-accent-green' : currentStreak < 0 ? 'text-accent-red' : 'text-text-primary')}>
              {currentStreak === 0 ? '—' : Math.abs(currentStreak)}
            </div>
            <div className="text-[11px] text-text-muted mt-0.5">
              {currentStreak > 0 ? 'Win streak' : currentStreak < 0 ? 'Loss streak' : 'No streak'}
            </div>
          </div>
        </div>
      </div>

      {/* Risk monitor */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Shield size={14} className="text-text-muted" />
          <span className="font-display text-sm font-bold">Daily risk</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex justify-between text-[11px] mb-1.5">
              <span className="text-text-muted">Loss used</span>
              <span className={clsx('font-semibold', lossUsedPct > 75 ? 'text-accent-red' : lossUsedPct > 50 ? 'text-accent-yellow' : 'text-accent-green')}>
                {lossUsedPct.toFixed(0)}% / {settings.dailyLossLimit}%
              </span>
            </div>
            <div className="h-2 bg-bg-elevated rounded-full overflow-hidden">
              <div className={clsx('h-full rounded-full transition-all',
                lossUsedPct > 75 ? 'bg-accent-red' : lossUsedPct > 50 ? 'bg-accent-yellow' : 'bg-accent-green'
              )} style={{ width: `${lossUsedPct}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-[11px] mb-1.5">
              <span className="text-text-muted">Trades today</span>
              <span className={clsx('font-semibold', todayTrades.length >= maxTrades ? 'text-accent-red' : 'text-accent-cyan')}>
                {todayTrades.length} / {maxTrades}
              </span>
            </div>
            <div className="h-2 bg-bg-elevated rounded-full overflow-hidden">
              <div className="h-full bg-accent-cyan rounded-full transition-all"
                style={{ width: `${Math.min(100, (todayTrades.length / maxTrades) * 100)}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Open positions */}
      <div>
        <div className="flex items-center justify-between mb-2.5 px-0.5">
          <h3 className="font-display text-sm font-bold">Open positions</h3>
          <span className="text-[11px] text-text-muted">{positions.length}</span>
        </div>
        {positions.length === 0 ? (
          <div className="card p-8 text-center text-text-muted text-sm">
            No open positions
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {positions.map(p => <PositionCard key={p.id || p.symbol} position={p} />)}
          </div>
        )}
      </div>
    </div>
  )
}
