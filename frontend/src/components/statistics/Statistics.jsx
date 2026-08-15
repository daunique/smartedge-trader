import React, { useMemo } from 'react'
import { useStore } from '../../store'
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import clsx from 'clsx'
import { format } from 'date-fns'

function CellMetric({ label, value, sub, tone }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="label mb-1">{label}</div>
      <div className={clsx('mono text-[15px] font-semibold',
        tone === 'pos' && 'text-[#0ECB81]', tone === 'neg' && 'text-[#F6465D]'
      )}>{value}</div>
      {sub && <div className="text-[10px] text-[#848E9C] mt-0.5">{sub}</div>}
    </div>
  )
}

export default function Statistics() {
  const { tradeHistory, winRate, avgRR, totalTrades, weeklyPnl, monthlyPnl, currentStreak, portfolioBalance } = useStore()

  const s = useMemo(() => {
    const trades = (tradeHistory || []).filter(t => String(t.symbol || '').includes('XRP') || true)
    const xrpOnly = trades.filter(t => String(t.symbol || '').includes('XRP'))
    const use = xrpOnly.length ? xrpOnly : trades
    const wins = use.filter(t => (t.pnl || 0) > 0)
    const losses = use.filter(t => (t.pnl || 0) <= 0)
    const gw = wins.reduce((a, t) => a + t.pnl, 0)
    const gl = Math.abs(losses.reduce((a, t) => a + t.pnl, 0))
    const pf = gl > 0 ? gw / gl : gw > 0 ? Infinity : 0
    const aw = wins.length ? gw / wins.length : 0
    const al = losses.length ? gl / losses.length : 0
    const byDay = {}
    use.forEach(t => {
      const k = format(new Date(t.date), 'M/d')
      byDay[k] = (byDay[k] || 0) + (t.pnl || 0)
    })
    const daily = Object.entries(byDay).slice(-14).map(([day, pnl]) => ({ day, pnl: Math.round(pnl * 100) / 100 }))
    return { pf, aw, al, daily, wins: wins.length, losses: losses.length, n: use.length }
  }, [tradeHistory])

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[15px] font-semibold">Performance</h1>
        <p className="text-[11px] text-[#848E9C]">XRPUSDT closed trades</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <CellMetric label="Win rate" value={`${winRate}%`} sub={`${s.wins}W / ${s.losses}L`} />
        <CellMetric label="Profit factor" value={s.pf === Infinity ? '∞' : s.pf.toFixed(2)} tone={s.pf >= 1 ? 'pos' : 'neg'} />
        <CellMetric label="Avg R" value={avgRR ? avgRR.toFixed(2) : '—'} />
        <CellMetric label="Avg win" value={`$${s.aw.toFixed(2)}`} tone="pos" />
        <CellMetric label="Avg loss" value={`$${s.al.toFixed(2)}`} tone="neg" />
        <CellMetric label="Trades" value={String(s.n || totalTrades)} />
        <CellMetric label="Weekly" value={`${weeklyPnl >= 0 ? '+' : ''}${weeklyPnl.toFixed(2)}`} tone={weeklyPnl >= 0 ? 'pos' : 'neg'} />
        <CellMetric label="Monthly" value={`${monthlyPnl >= 0 ? '+' : ''}${monthlyPnl.toFixed(2)}`} tone={monthlyPnl >= 0 ? 'pos' : 'neg'} />
        <CellMetric label="Streak" value={String(currentStreak === 0 ? 0 : Math.abs(currentStreak))}
          sub={currentStreak > 0 ? 'wins' : currentStreak < 0 ? 'losses' : '—'}
          tone={currentStreak > 0 ? 'pos' : currentStreak < 0 ? 'neg' : null} />
      </div>

      <div className="card p-3">
        <div className="text-[12px] font-semibold mb-2">Daily PnL</div>
        {s.daily.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-[12px] text-[#848E9C]">No data</div>
        ) : (
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={s.daily} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="day" tick={{ fill: '#848E9C', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#1E2329', border: '1px solid #2B3139', borderRadius: 4, fontSize: 11 }}
                  formatter={(v) => [`$${v}`, 'PnL']}
                />
                <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                  {s.daily.map((d, i) => (
                    <Cell key={i} fill={d.pnl >= 0 ? '#0ECB81' : '#F6465D'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card px-3 py-2.5 flex items-center justify-between">
        <div>
          <div className="label">Equity</div>
          <div className="mono text-[18px] font-bold">
            ${Number(portfolioBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="text-[11px] text-[#848E9C]">{totalTrades} closed</div>
      </div>
    </div>
  )
}
