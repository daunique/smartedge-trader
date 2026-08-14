import React, { useState, useEffect } from 'react'
import {
  TrendingUp, TrendingDown, Activity, Target, Zap,
  Clock, BarChart2, Shield, X
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useStore } from '../../store'
import { api } from '../../services/api'
import clsx from 'clsx'
import { format } from 'date-fns'

function EquityChart() {
  const { tradeHistory } = useStore()
  const data = tradeHistory.slice(-20).map(t => ({
    pnl: t.runningPnl,
    date: format(new Date(t.date), 'MMM d')
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
        <Area type="monotone" dataKey="pnl" stroke="#00D4FF" strokeWidth={1.5} fill="url(#equityGrad)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function StatCard({ label, value, sub, subColor, icon: Icon, iconColor }) {
  return (
    <div className="card p-4 flex flex-col gap-2">
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

function PositionRow({ position }) {
  const isLong   = position.direction === 'LONG'
  const progress = Math.min(100, Math.max(0, (position.rrAchieved / 3) * 100))
  const closePositionInStore = useStore(s => s.closePosition)
  const [closing, setClosing]     = useState(false)
  const [confirming, setConfirming] = useState(false)

  const handleClose = async () => {
    if (!confirming) {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 4000)  // auto-reset if they don't confirm
      return
    }
    setClosing(true)
    const result = await api.closePosition(position.id, 'manual')
    setClosing(false)
    setConfirming(false)
    if (result?.success) {
      closePositionInStore(position.id)
    } else {
      alert(`Failed to close ${position.symbol}: ${result?.error || result?.result?.retMsg || 'unknown error'}`)
    }
  }

  const statusCfg = {
    OPEN: { color: 'text-accent-cyan',   label: 'OPEN' },
    BE:   { color: 'text-accent-yellow', label: 'BE ✓' },
    TP:   { color: 'text-accent-green',  label: 'TP HIT' },
    SL:   { color: 'text-accent-red',    label: 'SL HIT' },
  }
  return (
    <div className="grid grid-cols-12 gap-2 px-4 py-3 hover:bg-bg-elevated/50 transition-colors border-b border-bg-border/50 items-center">
      <div className="col-span-3 sm:col-span-2">
        <div className="font-display text-xs font-bold text-text-primary">{position.symbol}</div>
        <div className={clsx('font-body text-xs', isLong ? 'text-accent-green' : 'text-accent-red')}>{position.direction}</div>
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
        <div className="font-body text-xs text-text-muted mb-1">RR</div>
        <div className="flex items-center gap-1.5">
          <div className="flex-1 h-1 bg-bg-elevated rounded-full overflow-hidden">
            <div className="h-full bg-accent-cyan rounded-full" style={{ width: `${progress}%` }} />
          </div>
          <span className="font-body text-xs text-accent-cyan">{(position.rrAchieved || 0).toFixed(1)}</span>
        </div>
      </div>
      <div className="col-span-2 hidden lg:block">
        <div className={clsx('font-body text-xs font-semibold', statusCfg[position.status]?.color || 'text-text-muted')}>
          {statusCfg[position.status]?.label || position.status}
        </div>
      </div>
      <div className="col-span-4 sm:col-span-2 text-right flex items-center justify-end gap-2">
        <div>
          <div className={clsx('font-display text-sm font-bold', position.pnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
            {position.pnl >= 0 ? '+' : ''}${(position.pnl || 0).toFixed(2)}
          </div>
          <div className={clsx('font-body text-xs', position.pnl >= 0 ? 'text-accent-green/70' : 'text-accent-red/70')}>
            {position.pnl >= 0 ? '+' : ''}{(position.pnlPct || 0).toFixed(2)}%
          </div>
        </div>
        <button onClick={handleClose} disabled={closing}
          title={confirming ? 'Click again to confirm' : 'Close position'}
          className={clsx('shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-colors border',
            confirming ? 'bg-accent-red/20 border-accent-red/50 text-accent-red'
                       : 'bg-bg-elevated border-bg-border text-text-muted hover:text-accent-red hover:border-accent-red/40',
            closing && 'opacity-50 cursor-wait'
          )}>
          <X size={12} />
        </button>
      </div>
    </div>
  )
}

function NextCandleCountdown() {
  // The strategy only re-evaluates on a completed 1H candle -- no session
  // windows, no "market closed" state, this system trades whenever the
  // confluence conditions line up, any hour, any day.
  const [timeLeft, setTimeLeft] = useState('')
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const secsIntoHour = now.getUTCMinutes() * 60 + now.getUTCSeconds()
      const d = 3600 - secsIntoHour
      setTimeLeft(`${Math.floor(d / 60)}m ${d % 60}s`)
    }
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t)
  }, [])
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="stat-label">Next Candle Close</span>
        <Clock size={14} className="text-text-muted" />
      </div>
      <div className="font-body text-xs font-semibold mb-1 text-accent-cyan">1H · XRP/USDT · 24/7</div>
      <div className="font-display text-lg font-bold text-text-primary">{timeLeft}</div>
    </div>
  )
}

function StreakCard({ tradeHistory }) {
  // Calculate current streak and best streak from real data
  const sorted = [...tradeHistory].sort((a, b) => new Date(b.date) - new Date(a.date))

  const isWinTrade = (tr) => (tr.pnl || 0) > 0
  let currentStreak = 0
  let streakType    = null
  for (const tr of sorted) {
    const type = isWinTrade(tr) ? 'W' : 'L'
    if (!streakType) { streakType = type; currentStreak = 1 }
    else if (type === streakType) currentStreak++
    else break
  }

  let bestWin = 0, bestLoss = 0, cur = 0, curType = null
  for (const tr of [...tradeHistory].sort((a, b) => new Date(a.date) - new Date(b.date))) {
    const type = isWinTrade(tr) ? 'W' : 'L'
    if (!curType) { curType = type; cur = 1 }
    else if (type === curType) { cur++ }
    else { curType = type; cur = 1 }
    if (curType === 'W') bestWin  = Math.max(bestWin, cur)
    else                 bestLoss = Math.max(bestLoss, cur)
  }

  const isWin = streakType === 'W'

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="stat-label">Current Streak</span>
        <BarChart2 size={14} className="text-text-muted" />
      </div>
      <div className={clsx('font-display text-2xl font-bold', isWin ? 'text-accent-green' : 'text-accent-red')}>
        {currentStreak} {isWin ? '🔥' : '❄️'}
      </div>
      <div className={clsx('font-body text-xs mt-0.5', isWin ? 'text-accent-green/70' : 'text-accent-red/70')}>
        {isWin ? 'Win' : 'Loss'} streak
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="bg-accent-green/5 border border-accent-green/15 rounded-lg p-2 text-center">
          <div className="font-display text-sm font-bold text-accent-green">{bestWin}</div>
          <div className="font-body text-xs text-text-muted">Best Win</div>
        </div>
        <div className="bg-accent-red/5 border border-accent-red/15 rounded-lg p-2 text-center">
          <div className="font-display text-sm font-bold text-accent-red">{bestLoss}</div>
          <div className="font-body text-xs text-text-muted">Best Loss</div>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const {
    portfolioBalance, dailyPnl, dailyPnlPct,
    weeklyPnl, winRate, avgRR,
    positions, tradeHistory, marketFilter, setMarketFilter,
    executionMode, accountMode, settings,
  } = useStore()

  const totalOpenPnl   = positions.reduce((s, p) => s + (p.pnl || 0), 0)
  const todayTrades    = tradeHistory.filter(t => {
    const d = new Date(t.date)
    const n = new Date()
    return d.getFullYear() === n.getFullYear() &&
           d.getMonth()    === n.getMonth() &&
           d.getDate()     === n.getDate()
  })
  const todayCount     = todayTrades.length
  const maxTrades      = settings.maxTradesPerDay || 3
  const todayWins      = todayTrades.filter(t => t.status === 'TP').length
  const todayLosses    = todayTrades.filter(t => t.status === 'SL').length
  const todayPnl       = todayTrades.reduce((s, t) => s + t.pnl, 0)
  const lossUsedPct    = Math.min(100, (Math.abs(Math.min(0, todayPnl)) / (portfolioBalance * settings.dailyLossLimit / 100 || 1)) * 100)

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Status Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className={clsx(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg border font-body text-xs',
          executionMode === 'FULL-AUTO'  ? 'bg-accent-green/10 border-accent-green/30 text-accent-green'
          : executionMode === 'SEMI-AUTO' ? 'bg-accent-yellow/10 border-accent-yellow/30 text-accent-yellow'
          : 'bg-bg-elevated border-bg-border text-text-secondary'
        )}>
          <Activity size={11} />
          {executionMode}
          {executionMode === 'FULL-AUTO' && <span className="w-1.5 h-1.5 rounded-full bg-accent-green live-dot ml-1" />}
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-bg-elevated border-bg-border font-body text-xs text-text-secondary">
          <span className={clsx('w-1.5 h-1.5 rounded-full live-dot', accountMode === 'LIVE' ? 'bg-accent-green' : 'bg-accent-yellow')} />
          {accountMode} · Bybit
        </div>
        <div className="flex items-center gap-2 ml-auto px-3 py-1.5 rounded-lg border bg-bg-elevated border-bg-border font-body text-xs text-text-secondary">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan" />
          XRP/USDT only
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
        <StatCard label="Daily P&L"
          value={`${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`}
          sub={`${dailyPnlPct.toFixed(2)}% return`}
          subColor={dailyPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}
          icon={dailyPnl >= 0 ? TrendingUp : TrendingDown}
          iconColor={dailyPnl >= 0 ? 'bg-accent-green/10 text-accent-green' : 'bg-accent-red/10 text-accent-red'} />
        <StatCard label="Open P&L"
          value={`${totalOpenPnl >= 0 ? '+' : ''}$${totalOpenPnl.toFixed(2)}`}
          sub={`${positions.length} positions`} subColor="text-text-muted"
          icon={Activity} iconColor="bg-accent-cyan/10 text-accent-cyan" />
        <StatCard label="Win Rate"
          value={`${winRate}%`} sub="All trades" subColor="text-text-muted"
          icon={Target} iconColor="bg-accent-purple/10 text-accent-purple" />
        <StatCard label="Avg RR"
          value={`1:${avgRR}`} sub={`Today: ${todayWins}W/${todayLosses}L`} subColor="text-accent-yellow"
          icon={BarChart2} iconColor="bg-accent-yellow/10 text-accent-yellow" />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display text-sm font-bold text-text-primary">Equity Curve</h3>
              <p className="font-body text-xs text-text-muted">Last 20 trades</p>
            </div>
            <div className={clsx('font-display text-sm font-bold', weeklyPnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
              {weeklyPnl >= 0 ? '+' : ''}${weeklyPnl.toFixed(2)} <span className="font-body text-xs text-text-muted font-normal">7d</span>
            </div>
          </div>
          <div className="h-36"><EquityChart /></div>
        </div>

        <div className="space-y-3">
          <NextCandleCountdown />
          <StreakCard tradeHistory={tradeHistory} />
        </div>
      </div>

      {/* Daily Risk — with real trade count */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="font-display text-sm font-bold text-text-primary">Daily Risk Monitor</span>
          <Shield size={14} className="text-text-muted" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex justify-between mb-1">
              <span className="font-body text-xs text-text-muted">Daily Loss Used</span>
              <span className={clsx('font-body text-xs font-semibold',
                lossUsedPct > 75 ? 'text-accent-red' : lossUsedPct > 50 ? 'text-accent-yellow' : 'text-accent-green'
              )}>{lossUsedPct.toFixed(1)}% / {settings.dailyLossLimit}%</span>
            </div>
            <div className="h-2 bg-bg-elevated rounded-full overflow-hidden">
              <div className={clsx('h-full rounded-full transition-all',
                lossUsedPct > 75 ? 'bg-accent-red' : lossUsedPct > 50 ? 'bg-accent-yellow' : 'bg-accent-green'
              )} style={{ width: `${Math.min(lossUsedPct, 100)}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="font-body text-xs text-text-muted">Trades Today</span>
              <span className={clsx('font-body text-xs font-semibold',
                todayCount >= maxTrades ? 'text-accent-red' : 'text-accent-cyan'
              )}>{todayCount} / {maxTrades}</span>
            </div>
            <div className="h-2 bg-bg-elevated rounded-full overflow-hidden">
              <div className={clsx('h-full rounded-full transition-all',
                todayCount >= maxTrades ? 'bg-accent-red' : 'bg-accent-cyan'
              )} style={{ width: `${Math.min((todayCount / maxTrades) * 100, 100)}%` }} />
            </div>
          </div>
        </div>
        {todayCount > 0 && (
          <div className="mt-3 flex items-center gap-4">
            <span className="font-body text-xs text-text-muted">Today:</span>
            <span className="font-body text-xs text-accent-green">+{todayWins} wins</span>
            <span className="font-body text-xs text-accent-red">-{todayLosses} losses</span>
            <span className={clsx('font-body text-xs font-semibold ml-auto',
              todayPnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
              {todayPnl >= 0 ? '+' : ''}${todayPnl.toFixed(2)}
            </span>
          </div>
        )}
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
