import React, { useState, useEffect } from 'react'
import {
  TrendingUp, TrendingDown, Activity, Target, Zap,
  Clock, ChevronUp, ChevronDown, AlertCircle, CheckCircle,
  XCircle, MinusCircle, BarChart2, Shield, ArrowUpRight, ArrowDownRight
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts'
import { useStore } from '../../store'
import clsx from 'clsx'
import { format } from 'date-fns'

// ─── Equity Chart ───────────────────────────────────────────────
function EquityChart() {
  const { tradeHistory } = useStore()
  const data = tradeHistory.slice(-20).map((t, i) => ({
    i, pnl: t.runningPnl, date: format(new Date(t.date), 'MMM d')
  }))

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-bg-elevated border border-bg-border rounded-lg px-3 py-2">
        <p className="font-body text-xs text-text-secondary">{payload[0]?.payload?.date}</p>
        <p className={clsx('font-display text-sm font-bold', payload[0]?.value >= 0 ? 'text-accent-green' : 'text-accent-red')}>
          ${payload[0]?.value?.toLocaleString()}
        </p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#00D4FF" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#00D4FF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" hide />
        <YAxis hide domain={['auto', 'auto']} />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone" dataKey="pnl"
          stroke="#00D4FF" strokeWidth={1.5}
          fill="url(#equityGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ─── Stat Card ───────────────────────────────────────────────────
function StatCard({ label, value, sub, subColor, icon: Icon, iconColor, glow }) {
  return (
    <div className={clsx('card p-4 flex flex-col gap-2 relative overflow-hidden', glow)}>
      <div className="flex items-center justify-between">
        <span className="stat-label">{label}</span>
        <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center', iconColor)}>
          <Icon size={14} />
        </div>
      </div>
      <div>
        <div className="stat-value">{value}</div>
        {sub && <div className={clsx('font-body text-xs mt-0.5', subColor || 'text-text-muted')}>{sub}</div>}
      </div>
    </div>
  )
}

// ─── Signal Card ─────────────────────────────────────────────────
function SignalCard({ signal }) {
  const { dismissSignal, executionMode } = useStore()
  const isLong = signal.direction === 'LONG'

  const statusConfig = {
    ACTIVE: { color: 'text-accent-green', bg: 'bg-accent-green/10 border-accent-green/20', label: '● ACTIVE' },
    PENDING: { color: 'text-accent-yellow', bg: 'bg-accent-yellow/10 border-accent-yellow/20', label: '◐ PENDING' },
    WATCH: { color: 'text-text-secondary', bg: 'bg-bg-border/40 border-bg-border', label: '○ WATCH' },
  }

  const cfg = statusConfig[signal.status]

  return (
    <div className={clsx(
      'card p-4 flex flex-col gap-3 hover:border-accent-cyan/20 transition-all duration-300 animate-slide-up',
      signal.status === 'ACTIVE' && 'border-accent-green/20'
    )}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm font-bold text-text-primary">{signal.symbol}</span>
          <span className={clsx('text-xs font-body font-semibold', isLong ? 'badge-long' : 'badge-short')}>
            {signal.direction}
          </span>
          <span className="font-body text-xs text-text-muted">{signal.market.toUpperCase()}</span>
        </div>
        <span className={clsx('font-body text-xs border px-2 py-0.5 rounded', cfg.bg, cfg.color)}>
          {cfg.label}
        </span>
      </div>

      {/* Price Levels */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-bg-elevated rounded-lg p-2">
          <div className="font-body text-xs text-text-muted mb-1">ENTRY</div>
          <div className="font-display text-xs font-bold text-text-primary">{signal.entry}</div>
        </div>
        <div className="bg-accent-green/5 border border-accent-green/10 rounded-lg p-2">
          <div className="font-body text-xs text-accent-green/60 mb-1">TP</div>
          <div className="font-display text-xs font-bold text-accent-green">{signal.tp}</div>
        </div>
        <div className="bg-accent-red/5 border border-accent-red/10 rounded-lg p-2">
          <div className="font-body text-xs text-accent-red/60 mb-1">SL</div>
          <div className="font-display text-xs font-bold text-accent-red">{signal.sl}</div>
        </div>
      </div>

      {/* ML Score + RR */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="font-body text-xs text-text-muted">ML Score</span>
            <span className={clsx('font-body text-xs font-semibold',
              signal.mlScore >= 0.75 ? 'text-accent-green' : signal.mlScore >= 0.65 ? 'text-accent-yellow' : 'text-accent-red'
            )}>{signal.confidence}%</span>
          </div>
          <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden">
            <div
              className={clsx('h-full rounded-full transition-all duration-500',
                signal.mlScore >= 0.75 ? 'bg-accent-green' : signal.mlScore >= 0.65 ? 'bg-accent-yellow' : 'bg-accent-red'
              )}
              style={{ width: `${signal.confidence}%` }}
            />
          </div>
        </div>
        <div className="text-right">
          <div className="font-body text-xs text-text-muted">RR</div>
          <div className="font-display text-xs font-bold text-accent-cyan">{signal.rr}</div>
        </div>
      </div>

      {/* Confluence */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={clsx('font-body text-xs px-2 py-0.5 rounded border',
          signal.vwapAbove ? 'bg-accent-green/5 border-accent-green/20 text-accent-green/80' : 'bg-accent-red/5 border-accent-red/20 text-accent-red/80'
        )}>
          VWAP {signal.vwapAbove ? '▲' : '▼'}
        </span>
        <span className={clsx('font-body text-xs px-2 py-0.5 rounded border',
          signal.orbBreak ? 'bg-accent-cyan/5 border-accent-cyan/20 text-accent-cyan/80' : 'bg-bg-border/40 border-bg-border text-text-muted'
        )}>
          ORB {signal.orbBreak ? '✓' : '—'}
        </span>
        <span className="font-body text-xs px-2 py-0.5 rounded border bg-accent-purple/5 border-accent-purple/20 text-accent-purple/80">
          {signal.regime}
        </span>
      </div>

      {/* Action */}
      {executionMode !== 'FULL-AUTO' && signal.status === 'ACTIVE' && (
        <div className="flex gap-2">
          <button className="flex-1 bg-accent-green/10 border border-accent-green/30 text-accent-green font-body text-xs font-semibold py-1.5 rounded-lg hover:bg-accent-green/20 transition-all">
            Execute
          </button>
          <button onClick={() => dismissSignal(signal.id)} className="px-3 bg-bg-elevated border border-bg-border text-text-muted font-body text-xs py-1.5 rounded-lg hover:border-accent-red/30 hover:text-accent-red transition-all">
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Position Row ─────────────────────────────────────────────────
function PositionRow({ position }) {
  const isLong = position.direction === 'LONG'
  const progress = Math.min(100, Math.max(0, (position.rrAchieved / 3) * 100))

  const statusConfig = {
    OPEN: { color: 'text-accent-cyan', label: 'OPEN' },
    BE: { color: 'text-accent-yellow', label: 'BE ✓' },
    TP: { color: 'text-accent-green', label: 'TP HIT' },
    SL: { color: 'text-accent-red', label: 'SL HIT' },
  }

  return (
    <div className="grid grid-cols-12 gap-2 px-4 py-3 hover:bg-bg-elevated/50 transition-colors border-b border-bg-border/50 items-center">
      <div className="col-span-3 sm:col-span-2">
        <div className="font-display text-xs font-bold text-text-primary">{position.symbol}</div>
        <div className={clsx('font-body text-xs', isLong ? 'text-accent-green' : 'text-accent-red')}>
          {position.direction}
        </div>
      </div>
      <div className="col-span-2 hidden sm:block">
        <div className="font-body text-xs text-text-muted">Entry</div>
        <div className="font-body text-xs text-text-primary">{position.entry}</div>
      </div>
      <div className="col-span-2 hidden md:block">
        <div className="font-body text-xs text-text-muted">Current</div>
        <div className="font-body text-xs text-text-primary">{position.current}</div>
      </div>
      <div className="col-span-3 sm:col-span-2">
        <div className="font-body text-xs text-text-muted mb-1">RR Progress</div>
        <div className="flex items-center gap-1.5">
          <div className="flex-1 h-1 bg-bg-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-cyan rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="font-body text-xs text-accent-cyan">{position.rrAchieved.toFixed(1)}</span>
        </div>
      </div>
      <div className="col-span-2 hidden lg:block">
        <div className="font-body text-xs text-text-muted">Status</div>
        <div className={clsx('font-body text-xs font-semibold', statusConfig[position.status]?.color)}>
          {statusConfig[position.status]?.label}
        </div>
      </div>
      <div className="col-span-4 sm:col-span-2 text-right">
        <div className={clsx('font-display text-sm font-bold', position.pnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
          {position.pnl >= 0 ? '+' : ''}${position.pnl.toFixed(2)}
        </div>
        <div className={clsx('font-body text-xs', position.pnl >= 0 ? 'text-accent-green/70' : 'text-accent-red/70')}>
          {position.pnl >= 0 ? '+' : ''}{position.pnlPct.toFixed(2)}%
        </div>
      </div>
    </div>
  )
}

// ─── ORB Countdown ────────────────────────────────────────────────
function OrbCountdown() {
  const [timeLeft, setTimeLeft] = useState('')
  const [phase, setPhase] = useState('')

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const utcH = now.getUTCHours()
      const utcM = now.getUTCMinutes()
      const utcS = now.getUTCSeconds()
      const totalSecs = utcH * 3600 + utcM * 60 + utcS

      // NY open = 14:30 UTC, ORB end = 14:45 UTC
      const nyOpen = 14 * 3600 + 30 * 60
      const orbEnd = nyOpen + 15 * 60
      const execEnd = nyOpen + 2 * 3600

      if (totalSecs < nyOpen) {
        const diff = nyOpen - totalSecs
        const h = Math.floor(diff / 3600), m = Math.floor((diff % 3600) / 60), s = diff % 60
        setTimeLeft(`${h}h ${m}m ${s}s`)
        setPhase('PRE-MARKET')
      } else if (totalSecs < orbEnd) {
        const diff = orbEnd - totalSecs
        const m = Math.floor(diff / 60), s = diff % 60
        setTimeLeft(`${m}m ${s}s`)
        setPhase('ORB FORMING')
      } else if (totalSecs < execEnd) {
        const diff = execEnd - totalSecs
        const h = Math.floor(diff / 3600), m = Math.floor((diff % 3600) / 60), s = diff % 60
        setTimeLeft(`${h}h ${m}m ${s}s`)
        setPhase('EXECUTION')
      } else {
        setTimeLeft('CLOSED')
        setPhase('NO TRADES')
      }
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  const phaseColor = {
    'PRE-MARKET': 'text-text-secondary',
    'ORB FORMING': 'text-accent-yellow',
    'EXECUTION': 'text-accent-green',
    'NO TRADES': 'text-text-muted',
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="stat-label">ORB Window</span>
        <Clock size={14} className="text-text-muted" />
      </div>
      <div className={clsx('font-body text-xs font-semibold mb-1', phaseColor[phase])}>{phase}</div>
      <div className="font-display text-lg font-bold text-text-primary">{timeLeft}</div>
      <div className="mt-2 h-1 bg-bg-elevated rounded-full overflow-hidden">
        <div className={clsx(
          'h-full rounded-full',
          phase === 'EXECUTION' ? 'bg-accent-green' : phase === 'ORB FORMING' ? 'bg-accent-yellow' : 'bg-text-muted'
        )} style={{ width: phase === 'EXECUTION' ? '60%' : phase === 'ORB FORMING' ? '30%' : '10%' }} />
      </div>
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────
export default function Dashboard() {
  const {
    portfolioBalance, dailyPnl, dailyPnlPct,
    weeklyPnl, winRate, avgRR, currentStreak,
    positions, signals, marketFilter, setMarketFilter,
    executionMode, accountMode, settings
  } = useStore()

  const filteredSignals = signals.filter(s =>
    marketFilter === 'ALL' || s.market === marketFilter.toLowerCase()
  )

  const totalOpenPnl = positions.reduce((s, p) => s + p.pnl, 0)

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Status Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className={clsx(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg border font-body text-xs',
          executionMode === 'FULL-AUTO' ? 'bg-accent-green/10 border-accent-green/30 text-accent-green' :
          executionMode === 'SEMI-AUTO' ? 'bg-accent-yellow/10 border-accent-yellow/30 text-accent-yellow' :
          'bg-bg-elevated border-bg-border text-text-secondary'
        )}>
          <Activity size={11} />
          {executionMode}
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-bg-elevated border-bg-border font-body text-xs text-text-secondary">
          <span className={clsx('w-1.5 h-1.5 rounded-full live-dot', accountMode === 'LIVE' ? 'bg-accent-green' : 'bg-accent-yellow')} />
          {accountMode} · Bybit
        </div>
        <div className="flex items-center gap-1 ml-auto">
          {['ALL', 'CRYPTO', 'FOREX'].map(f => (
            <button
              key={f}
              onClick={() => setMarketFilter(f)}
              className={clsx(
                'px-2.5 py-1 rounded-lg font-body text-xs transition-all',
                marketFilter === f ? 'bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan' : 'text-text-muted hover:text-text-secondary'
              )}
            >{f}</button>
          ))}
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="card p-4 col-span-2">
          <div className="flex items-center justify-between mb-2">
            <span className="stat-label">Portfolio Balance</span>
            <Zap size={14} className="text-accent-cyan" />
          </div>
          <div className="font-display text-2xl font-bold text-text-primary">
            ${portfolioBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div className={clsx('font-body text-xs mt-1', dailyPnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
            {dailyPnl >= 0 ? '▲' : '▼'} ${Math.abs(dailyPnl).toFixed(2)} ({dailyPnlPct.toFixed(2)}%) today
          </div>
        </div>

        <StatCard label="Daily P&L" value={`${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`}
          sub={`${dailyPnlPct.toFixed(2)}% return`}
          subColor={dailyPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}
          icon={dailyPnl >= 0 ? TrendingUp : TrendingDown}
          iconColor={dailyPnl >= 0 ? 'bg-accent-green/10 text-accent-green' : 'bg-accent-red/10 text-accent-red'} />

        <StatCard label="Open P&L" value={`${totalOpenPnl >= 0 ? '+' : ''}$${totalOpenPnl.toFixed(2)}`}
          sub={`${positions.length} positions`}
          subColor="text-text-muted"
          icon={Activity}
          iconColor="bg-accent-cyan/10 text-accent-cyan" />

        <StatCard label="Win Rate" value={`${winRate}%`}
          sub="Last 30 trades"
          subColor="text-text-muted"
          icon={Target}
          iconColor="bg-accent-purple/10 text-accent-purple" />

        <StatCard label="Avg RR" value={`1:${avgRR}`}
          sub={`Streak: ${currentStreak} wins`}
          subColor="text-accent-yellow"
          icon={BarChart2}
          iconColor="bg-accent-yellow/10 text-accent-yellow" />
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Equity Curve */}
        <div className="lg:col-span-2 card p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display text-sm font-bold text-text-primary">Equity Curve</h3>
              <p className="font-body text-xs text-text-muted">Last 20 trades</p>
            </div>
            <div className={clsx('font-display text-sm font-bold', weeklyPnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
              +${weeklyPnl.toFixed(2)} <span className="font-body text-xs text-text-muted font-normal">7d</span>
            </div>
          </div>
          <div className="h-36">
            <EquityChart />
          </div>
        </div>

        {/* ORB + Risk */}
        <div className="space-y-3">
          <OrbCountdown />
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="stat-label">Daily Risk</span>
              <Shield size={14} className="text-text-muted" />
            </div>
            <div className="space-y-2">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="font-body text-xs text-text-muted">Loss Used</span>
                  <span className="font-body text-xs text-accent-green">0.8% / 2%</span>
                </div>
                <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                  <div className="h-full bg-accent-green rounded-full" style={{ width: '40%' }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="font-body text-xs text-text-muted">Trades Today</span>
                  <span className="font-body text-xs text-accent-cyan">1 / {settings.maxTradesPerDay}</span>
                </div>
                <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                  <div className="h-full bg-accent-cyan rounded-full" style={{ width: `${(1 / settings.maxTradesPerDay) * 100}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Signals */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-sm font-bold text-text-primary">
            Live Signals <span className="text-text-muted font-body font-normal text-xs ml-2">{filteredSignals.length} active</span>
          </h3>
          <span className="font-body text-xs text-text-muted">ML threshold: {(settings.mlThreshold * 100).toFixed(0)}%</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {filteredSignals.map(s => <SignalCard key={s.id} signal={s} />)}
        </div>
      </div>

      {/* Open Positions */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
          <h3 className="font-display text-sm font-bold text-text-primary">
            Open Positions <span className="text-accent-cyan ml-1">{positions.length}</span>
          </h3>
          <span className={clsx('font-display text-sm font-bold', totalOpenPnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
            {totalOpenPnl >= 0 ? '+' : ''}${totalOpenPnl.toFixed(2)}
          </span>
        </div>
        {positions.length === 0 ? (
          <div className="px-4 py-8 text-center font-body text-sm text-text-muted">No open positions</div>
        ) : (
          positions.map(p => <PositionRow key={p.id} position={p} />)
        )}
      </div>
    </div>
  )
}
