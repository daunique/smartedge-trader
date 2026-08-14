import React, { useMemo } from 'react'
import { useStore } from '../../store'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import clsx from 'clsx'
import { format } from 'date-fns'

function Metric({ label, value, sub, good }) {
  return (
    <div className="card p-4">
      <div className="stat-label mb-1">{label}</div>
      <div className={clsx('stat-value', good === true && 'text-accent-green', good === false && 'text-accent-red')}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-text-muted mt-1">{sub}</div>}
    </div>
  )
}

export default function Statistics() {
  const {
    tradeHistory, winRate, avgRR, totalTrades,
    weeklyPnl, monthlyPnl, currentStreak, portfolioBalance,
  } = useStore()

  const stats = useMemo(() => {
    const trades = tradeHistory || []
    const wins = trades.filter(t => (t.pnl || 0) > 0)
    const losses = trades.filter(t => (t.pnl || 0) <= 0)
    const grossWin = wins.reduce((s, t) => s + t.pnl, 0)
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
    const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0
    const avgWin = wins.length ? grossWin / wins.length : 0
    const avgLoss = losses.length ? grossLoss / losses.length : 0
    const expect = totalTrades
      ? (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss
      : 0

    // daily pnl bars last 14 days
    const byDay = {}
    trades.forEach(t => {
      const key = format(new Date(t.date), 'MMM d')
      byDay[key] = (byDay[key] || 0) + (t.pnl || 0)
    })
    const daily = Object.entries(byDay).slice(-14).map(([day, pnl]) => ({ day, pnl: Math.round(pnl * 100) / 100 }))

    return { pf, avgWin, avgLoss, expect, daily, wins: wins.length, losses: losses.length }
  }, [tradeHistory, winRate, totalTrades])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-lg font-bold">Statistics</h1>
        <p className="text-xs text-text-muted mt-0.5">Performance overview · XRP/USDT</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <Metric label="Win rate" value={`${winRate}%`} sub={`${stats.wins}W / ${stats.losses}L`} good={winRate >= 40} />
        <Metric label="Profit factor" value={stats.pf === Infinity ? '∞' : stats.pf.toFixed(2)} good={stats.pf >= 1.5} />
        <Metric label="Avg R" value={avgRR ? avgRR.toFixed(2) : '—'} />
        <Metric label="Expectancy" value={`$${stats.expect.toFixed(2)}`} sub="Per trade" good={stats.expect > 0} />
        <Metric label="Avg win" value={`$${stats.avgWin.toFixed(2)}`} good />
        <Metric label="Avg loss" value={`$${stats.avgLoss.toFixed(2)}`} good={false} />
        <Metric label="Weekly P&L" value={`${weeklyPnl >= 0 ? '+' : ''}$${weeklyPnl.toFixed(2)}`} good={weeklyPnl > 0} />
        <Metric label="Monthly P&L" value={`${monthlyPnl >= 0 ? '+' : ''}$${monthlyPnl.toFixed(2)}`} good={monthlyPnl > 0} />
        <Metric label="Streak" value={currentStreak === 0 ? '—' : Math.abs(currentStreak)}
          sub={currentStreak > 0 ? 'Wins' : currentStreak < 0 ? 'Losses' : 'Flat'}
          good={currentStreak > 0} />
      </div>

      <div className="card p-4">
        <h3 className="font-display text-sm font-bold mb-3">Daily P&L</h3>
        {stats.daily.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-sm text-text-muted">No data</div>
        ) : (
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.daily} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="day" tick={{ fill: '#3D4F6B', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{ background: '#141C2B', border: '1px solid #1C2840', borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => [`$${v}`, 'PnL']}
                />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {stats.daily.map((d, i) => (
                    <Cell key={i} fill={d.pnl >= 0 ? '#00FF88' : '#FF3D6B'} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="stat-label mb-1">Equity</div>
        <div className="font-display text-xl font-bold tabular-nums">
          ${Number(portfolioBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </div>
        <div className="text-[11px] text-text-muted mt-1">{totalTrades} closed trades total</div>
      </div>
    </div>
  )
}
