import React from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, RadialBarChart, RadialBar, Legend
} from 'recharts'
import { useStore } from '../../store'
import { format } from 'date-fns'
import clsx from 'clsx'

const TOOLTIP_STYLE = {
  backgroundColor: '#0F1520',
  border: '1px solid #1C2840',
  borderRadius: '8px',
  fontFamily: 'IBM Plex Mono',
  fontSize: '12px',
  color: '#E8F0FF'
}

export default function Statistics() {
  const {
    tradeHistory, winRate, avgRR, totalTrades,
    maxDrawdown, sharpeRatio, monthlyPnl, weeklyPnl, dailyPnl
  } = useStore()

  // Equity data
  const equityData = tradeHistory.map((t, i) => ({
    i, pnl: t.runningPnl, date: format(new Date(t.date), 'MMM d'), win: t.status === 'TP'
  }))

  // Daily PnL bars
  const dailyData = tradeHistory.slice(-14).map(t => ({
    date: format(new Date(t.date), 'MMM d'),
    pnl: t.pnl,
    color: t.pnl >= 0 ? '#00FF88' : '#FF3D6B'
  }))

  // Win/Loss distribution
  const wins = tradeHistory.filter(t => t.status === 'TP').length
  const losses = tradeHistory.filter(t => t.status === 'SL').length
  const pieData = [
    { name: 'Wins', value: wins, fill: '#00FF88' },
    { name: 'Losses', value: losses, fill: '#FF3D6B' },
  ]

  // ML score buckets
  const mlBuckets = [
    { range: '65–70%', count: tradeHistory.filter(t => t.mlScore >= 0.65 && t.mlScore < 0.70).length },
    { range: '70–75%', count: tradeHistory.filter(t => t.mlScore >= 0.70 && t.mlScore < 0.75).length },
    { range: '75–80%', count: tradeHistory.filter(t => t.mlScore >= 0.75 && t.mlScore < 0.80).length },
    { range: '80–85%', count: tradeHistory.filter(t => t.mlScore >= 0.80 && t.mlScore < 0.85).length },
    { range: '85%+', count: tradeHistory.filter(t => t.mlScore >= 0.85).length },
  ]

  // Hour distribution
  const hourBuckets = Array.from({ length: 8 }, (_, i) => {
    const hour = i + 9
    return {
      hour: `${hour}:00`,
      trades: tradeHistory.filter(t => new Date(t.date).getHours() === hour).length,
      wins: tradeHistory.filter(t => new Date(t.date).getHours() === hour && t.status === 'TP').length,
    }
  })

  const kpis = [
    { label: 'Win Rate', value: `${winRate}%`, color: 'text-accent-green', sub: `${wins}W / ${losses}L` },
    { label: 'Avg R:R', value: `1:${avgRR}`, color: 'text-accent-cyan', sub: 'Average achieved' },
    { label: 'Sharpe Ratio', value: sharpeRatio.toFixed(2), color: 'text-accent-purple', sub: '>2 is excellent' },
    { label: 'Max Drawdown', value: `${maxDrawdown}%`, color: 'text-accent-red', sub: 'Peak to trough' },
    { label: 'Monthly P&L', value: `+$${monthlyPnl.toFixed(0)}`, color: 'text-accent-green', sub: 'Current month' },
    { label: 'Expectancy', value: `$${((wins / totalTrades) * 180 - (losses / totalTrades) * 60).toFixed(0)}`, color: 'text-accent-yellow', sub: 'Per trade avg' },
  ]

  return (
    <div className="space-y-5 animate-fade-in">

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="card p-4">
            <div className="stat-label mb-2">{k.label}</div>
            <div className={clsx('font-display text-xl font-bold', k.color)}>{k.value}</div>
            <div className="font-body text-xs text-text-muted mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Equity Curve */}
        <div className="lg:col-span-2 card p-4">
          <h3 className="font-display text-sm font-bold text-text-primary mb-1">Equity Curve</h3>
          <p className="font-body text-xs text-text-muted mb-4">Cumulative P&L — all trades</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityData}>
                <defs>
                  <linearGradient id="eq2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00D4FF" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#00D4FF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => [`$${v.toFixed(2)}`, 'P&L']} />
                <Area type="monotone" dataKey="pnl" stroke="#00D4FF" strokeWidth={2} fill="url(#eq2)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Win/Loss Pie */}
        <div className="card p-4 flex flex-col">
          <h3 className="font-display text-sm font-bold text-text-primary mb-1">Win / Loss</h3>
          <p className="font-body text-xs text-text-muted mb-4">{totalTrades} total trades</p>
          <div className="flex-1 flex items-center justify-center h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: '#7B8FAB' }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Daily P&L Bars */}
        <div className="card p-4">
          <h3 className="font-display text-sm font-bold text-text-primary mb-1">Daily P&L</h3>
          <p className="font-body text-xs text-text-muted mb-4">Last 14 trades</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} barSize={16}>
                <XAxis dataKey="date" tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => [`$${v.toFixed(2)}`, 'P&L']} />
                <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                  {dailyData.map((entry, i) => <Cell key={i} fill={entry.color} fillOpacity={0.8} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ML Score Distribution */}
        <div className="card p-4">
          <h3 className="font-display text-sm font-bold text-text-primary mb-1">ML Score Distribution</h3>
          <p className="font-body text-xs text-text-muted mb-4">Trades by confidence band</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mlBuckets} barSize={28}>
                <XAxis dataKey="range" tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => [v, 'Trades']} />
                <Bar dataKey="count" fill="#00D4FF" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Hourly Heatmap */}
      <div className="card p-4">
        <h3 className="font-display text-sm font-bold text-text-primary mb-1">Trades by Hour (UTC)</h3>
        <p className="font-body text-xs text-text-muted mb-4">Trading activity distribution</p>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hourBuckets} barSize={32}>
              <XAxis dataKey="hour" tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="wins" name="Wins" fill="#00FF88" fillOpacity={0.7} radius={[2, 2, 0, 0]} stackId="a" />
              <Bar dataKey="trades" name="Total" fill="#00D4FF" fillOpacity={0.3} radius={[2, 2, 0, 0]} stackId="b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
