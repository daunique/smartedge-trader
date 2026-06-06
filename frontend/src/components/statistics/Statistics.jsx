import React, { useMemo } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend
} from 'recharts'
import { useStore } from '../../store'
import { format, parseISO, subDays, startOfDay } from 'date-fns'
import clsx from 'clsx'

const TOOLTIP = {
  backgroundColor: '#0F1520', border: '1px solid #1C2840',
  borderRadius: '8px', fontFamily: 'IBM Plex Mono', fontSize: '12px', color: '#E8F0FF'
}

const toDate = (d) => {
  try { return typeof d === 'number' ? new Date(d) : parseISO(d) } catch { return new Date() }
}

function KpiCard({ label, value, sub, color }) {
  return (
    <div className="card p-4">
      <div className="stat-label mb-2">{label}</div>
      <div className={clsx('font-display text-xl font-bold', color || 'text-text-primary')}>{value}</div>
      {sub && <div className="font-body text-xs text-text-muted mt-0.5">{sub}</div>}
    </div>
  )
}

export default function Statistics() {
  const { tradeHistory, portfolioBalance } = useStore()

  const trades = useMemo(() =>
    [...tradeHistory].sort((a, b) => toDate(a.date) - toDate(b.date)),
    [tradeHistory]
  )

  const wins   = trades.filter(t => t.status === 'TP')
  const losses = trades.filter(t => t.status === 'SL')
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const winRate  = trades.length > 0 ? ((wins.length / trades.length) * 100).toFixed(1) : 0
  const avgWin   = wins.length   > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
  const avgLoss  = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0
  const expectancy = ((wins.length / (trades.length || 1)) * avgWin) - ((losses.length / (trades.length || 1)) * avgLoss)
  const avgRR    = wins.length > 0 ? (wins.reduce((s, t) => s + parseFloat(t.rr || 0), 0) / wins.length).toFixed(2) : 0

  // Max drawdown
  let peak = 0, maxDD = 0, running = 0
  trades.forEach(t => {
    running += t.pnl
    if (running > peak) peak = running
    const dd = peak > 0 ? ((peak - running) / peak) * 100 : 0
    if (dd > maxDD) maxDD = dd
  })

  // Sharpe (simplified)
  const returns = trades.map(t => t.pnl)
  const meanR   = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0
  const stdR    = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - meanR, 2), 0) / returns.length)
    : 1
  const sharpe  = stdR > 0 ? (meanR / stdR * Math.sqrt(252)).toFixed(2) : 0

  // Equity curve
  const equityData = useMemo(() => {
    let cum = 0
    return trades.map(t => {
      cum += t.pnl
      return { date: format(toDate(t.date), 'MMM d'), pnl: Math.round(cum * 100) / 100, win: t.status === 'TP' }
    })
  }, [trades])

  // Daily PnL last 14 days
  const dailyData = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = startOfDay(subDays(new Date(), 13 - i))
      const dayTrades = trades.filter(t => {
        const td = startOfDay(toDate(t.date))
        return td.getTime() === d.getTime()
      })
      return {
        date:  format(d, 'MMM d'),
        pnl:   Math.round(dayTrades.reduce((s, t) => s + t.pnl, 0) * 100) / 100,
        count: dayTrades.length,
      }
    })
    return days
  }, [trades])

  // Win/Loss pie
  const pieData = [
    { name: 'Wins',   value: wins.length,   fill: '#00FF88' },
    { name: 'Losses', value: losses.length, fill: '#FF3D6B' },
  ]

  // Symbol breakdown
  const symbolData = useMemo(() => {
    const map = {}
    trades.forEach(t => {
      if (!map[t.symbol]) map[t.symbol] = { symbol: t.symbol, wins: 0, losses: 0, pnl: 0 }
      if (t.status === 'TP') map[t.symbol].wins++
      else map[t.symbol].losses++
      map[t.symbol].pnl += t.pnl
    })
    return Object.values(map)
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 8)
      .map(s => ({ ...s, pnl: Math.round(s.pnl * 100) / 100 }))
  }, [trades])

  // Hourly heatmap
  const hourData = useMemo(() => {
    return Array.from({ length: 24 }, (_, h) => {
      const hourTrades = trades.filter(t => toDate(t.date).getUTCHours() === h)
      const hourWins   = hourTrades.filter(t => t.status === 'TP').length
      return {
        hour:   `${h.toString().padStart(2, '0')}:00`,
        trades: hourTrades.length,
        wins:   hourWins,
        pnl:    Math.round(hourTrades.reduce((s, t) => s + t.pnl, 0) * 100) / 100,
      }
    }).filter(h => h.trades > 0)
  }, [trades])

  // Drawdown curve
  const ddData = useMemo(() => {
    let peak2 = 0, cum2 = 0
    return trades.map(t => {
      cum2 += t.pnl
      if (cum2 > peak2) peak2 = cum2
      const dd = peak2 > 0 ? -((peak2 - cum2) / peak2) * 100 : 0
      return { date: format(toDate(t.date), 'MMM d'), dd: Math.round(dd * 100) / 100 }
    })
  }, [trades])

  if (trades.length === 0) {
    return (
      <div className="card p-16 text-center animate-fade-in">
        <div className="font-display text-sm font-bold text-text-primary mb-2">No Trade Data Yet</div>
        <p className="font-body text-xs text-text-muted">Statistics will populate as your Bybit Demo trades complete.</p>
        <p className="font-body text-xs text-text-muted mt-1">Execute signals in Semi-Auto or enable Full-Auto to start.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Win Rate"    value={`${winRate}%`}
          sub={`${wins.length}W / ${losses.length}L`} color="text-accent-green" />
        <KpiCard label="Total Trades" value={trades.length}
          sub="All time" />
        <KpiCard label="Net P&L"     value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`}
          sub="Cumulative" color={totalPnl >= 0 ? 'text-accent-green' : 'text-accent-red'} />
        <KpiCard label="Avg R:R"     value={`1:${avgRR}`}
          sub="Winning trades" color="text-accent-cyan" />
        <KpiCard label="Expectancy"  value={`$${expectancy.toFixed(2)}`}
          sub="Per trade avg" color={expectancy >= 0 ? 'text-accent-green' : 'text-accent-red'} />
        <KpiCard label="Max Drawdown" value={`${maxDD.toFixed(1)}%`}
          sub="Peak to trough" color="text-accent-red" />
      </div>

      {/* Row 2: Equity + Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-4">
          <h3 className="font-display text-sm font-bold text-text-primary mb-1">Equity Curve</h3>
          <p className="font-body text-xs text-text-muted mb-4">Cumulative P&L — {trades.length} trades</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityData}>
                <defs>
                  <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#00D4FF" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#00D4FF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={TOOLTIP} formatter={v => [`$${Number(v).toFixed(2)}`, 'P&L']} />
                <Area type="monotone" dataKey="pnl" stroke="#00D4FF" strokeWidth={2} fill="url(#eq)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="font-display text-sm font-bold text-text-primary mb-1">Win / Loss</h3>
          <p className="font-body text-xs text-text-muted mb-2">{trades.length} total trades</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                  {pieData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP} />
                <Legend iconType="circle" iconSize={8}
                  formatter={v => <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: '#7B8FAB' }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div className="bg-accent-green/5 border border-accent-green/15 rounded-lg p-2 text-center">
              <div className="font-display text-sm font-bold text-accent-green">+${avgWin.toFixed(2)}</div>
              <div className="font-body text-xs text-text-muted">Avg Win</div>
            </div>
            <div className="bg-accent-red/5 border border-accent-red/15 rounded-lg p-2 text-center">
              <div className="font-display text-sm font-bold text-accent-red">-${avgLoss.toFixed(2)}</div>
              <div className="font-body text-xs text-text-muted">Avg Loss</div>
            </div>
          </div>
        </div>
      </div>

      {/* Daily P&L */}
      <div className="card p-4">
        <h3 className="font-display text-sm font-bold text-text-primary mb-1">Daily P&L — Last 14 Days</h3>
        <p className="font-body text-xs text-text-muted mb-4">Green = profitable day · Red = loss day</p>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData} barSize={20}>
              <XAxis dataKey="date" tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={TOOLTIP} formatter={(v, n, p) => [`$${Number(v).toFixed(2)}`, 'P&L']} />
              <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                {dailyData.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? '#00FF88' : '#FF3D6B'} fillOpacity={0.8} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Symbol breakdown + Drawdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="font-display text-sm font-bold text-text-primary mb-1">P&L by Symbol</h3>
          <p className="font-body text-xs text-text-muted mb-4">Net profit per asset</p>
          {symbolData.length === 0 ? (
            <div className="h-40 flex items-center justify-center font-body text-sm text-text-muted">No data</div>
          ) : (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={symbolData} layout="vertical" barSize={12}>
                  <XAxis type="number" tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                  <YAxis type="category" dataKey="symbol" tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#7B8FAB' }} tickLine={false} axisLine={false} width={70} />
                  <Tooltip contentStyle={TOOLTIP} formatter={v => [`$${Number(v).toFixed(2)}`, 'P&L']} />
                  <Bar dataKey="pnl" radius={[0, 3, 3, 0]}>
                    {symbolData.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? '#00FF88' : '#FF3D6B'} fillOpacity={0.8} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="font-display text-sm font-bold text-text-primary mb-1">Drawdown Curve</h3>
          <p className="font-body text-xs text-text-muted mb-4">Max: {maxDD.toFixed(1)}%</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={ddData}>
                <defs>
                  <linearGradient id="dd" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#FF3D6B" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#FF3D6B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                <Tooltip contentStyle={TOOLTIP} formatter={v => [`${Number(v).toFixed(2)}%`, 'Drawdown']} />
                <Area type="monotone" dataKey="dd" stroke="#FF3D6B" strokeWidth={1.5} fill="url(#dd)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Hourly heatmap */}
      {hourData.length > 0 && (
        <div className="card p-4">
          <h3 className="font-display text-sm font-bold text-text-primary mb-1">Performance by Hour (UTC)</h3>
          <p className="font-body text-xs text-text-muted mb-4">Best trading hours based on P&L</p>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourData} barSize={24}>
                <XAxis dataKey="hour" tick={{ fontFamily: 'IBM Plex Mono', fontSize: 9, fill: '#3D4F6B' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: '#3D4F6B' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => [n === 'pnl' ? `$${Number(v).toFixed(2)}` : v, n === 'pnl' ? 'P&L' : 'Trades']} />
                <Bar dataKey="pnl" name="pnl" radius={[3, 3, 0, 0]}>
                  {hourData.map((e, i) => <Cell key={i} fill={e.pnl >= 0 ? '#00D4FF' : '#FF3D6B'} fillOpacity={0.7} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Additional KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Profit Factor"
          value={avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '∞'}
          sub="Win/Loss ratio" color="text-accent-cyan" />
        <KpiCard label="Sharpe Ratio"
          value={sharpe} sub=">1.5 is good"
          color={parseFloat(sharpe) >= 1.5 ? 'text-accent-green' : 'text-accent-yellow'} />
        <KpiCard label="Best Trade"
          value={trades.length > 0 ? `+$${Math.max(...trades.map(t => t.pnl)).toFixed(2)}` : '—'}
          sub="Single trade" color="text-accent-green" />
        <KpiCard label="Worst Trade"
          value={trades.length > 0 ? `$${Math.min(...trades.map(t => t.pnl)).toFixed(2)}` : '—'}
          sub="Single trade" color="text-accent-red" />
      </div>
    </div>
  )
}
