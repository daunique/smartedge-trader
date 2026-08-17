import React, { useMemo, useState, useEffect } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useStore } from '../../store'
import { api } from '../../services/api'
import clsx from 'clsx'
import { format } from 'date-fns'

function EquityChart({ tradeHistory }) {
  const data = useMemo(() => {
    const sorted = [...(tradeHistory || [])].sort((a, b) => new Date(a.date) - new Date(b.date))
    let run = 0
    return sorted.slice(-40).map(t => {
      run += t.pnl || 0
      return { v: Math.round(run * 100) / 100, d: format(new Date(t.date), 'M/d') }
    })
  }, [tradeHistory])

  if (!data.length) {
    return <div className="h-full flex items-center justify-center text-[12px] text-[#848E9C]">No trade data</div>
  }

  const Tip = ({ active, payload }) => {
    if (!active || !payload?.[0]) return null
    const v = payload[0].value
    return (
      <div className="bg-[#1E2329] border border-[#2B3139] rounded px-2 py-1.5 text-[11px]">
        <div className="text-[#848E9C]">{payload[0].payload.d}</div>
        <div className={clsx('mono font-semibold', v >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]')}>
          ${v.toFixed(2)}
        </div>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F0B90B" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#F0B90B" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="d" hide />
        <YAxis hide domain={['auto', 'auto']} />
        <Tooltip content={<Tip />} />
        <Area type="monotone" dataKey="v" stroke="#F0B90B" strokeWidth={1.5} fill="url(#eq)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="label mb-1">{label}</div>
      <div className={clsx('mono text-[15px] font-semibold leading-tight',
        tone === 'pos' && 'text-[#0ECB81]',
        tone === 'neg' && 'text-[#F6465D]',
        !tone && 'text-[#EAECEF]'
      )}>{value}</div>
      {sub && <div className="text-[10px] text-[#848E9C] mt-0.5">{sub}</div>}
    </div>
  )
}

function PosRow({ p, liveMark }) {
  const closeInStore = useStore(s => s.closePosition)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const long = p.direction === 'LONG'
  const mark = liveMark != null ? liveMark : p.current
  const entry = Number(p.entry) || 0
  const size = Number(p.size) || 0
  const livePnl = (entry && size && mark != null)
    ? (long ? (mark - entry) : (entry - mark)) * size
    : (p.pnl || 0)
  const rr = Math.min(100, Math.max(0, ((p.rrAchieved || 0) / 3) * 100))

  const close = async () => {
    if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 3000); return }
    setBusy(true)
    const r = await api.closePosition(p.id, 'manual')
    setBusy(false); setConfirm(false)
    if (r?.success) closeInStore(p.id)
    else alert(r?.error || 'Close failed')
  }

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">{p.symbol}</span>
          <span className={long ? 'pill-long' : 'pill-short'}>{p.direction}</span>
          {p.status === 'BE' && <span className="text-[10px] text-[#F0B90B] font-medium">BE</span>}
        </div>
        <div className={clsx('mono text-[14px] font-semibold', livePnl >= 0 ? 'pos' : 'neg')}>
          {livePnl >= 0 ? '+' : ''}{livePnl.toFixed(2)}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px] mb-2">
        <div><span className="text-[#848E9C]">Entry </span><span className="mono">{p.entry}</span></div>
        <div><span className="text-[#848E9C]">Mark </span><span className="mono">{mark != null ? Number(mark).toFixed(4) : '—'}</span></div>
        <div className="text-right"><span className="text-[#848E9C]">R </span><span className="mono text-[#F0B90B]">{(p.rrAchieved || 0).toFixed(2)}</span></div>
      </div>
      <div className="h-1 bg-[#1E2329] rounded-full overflow-hidden mb-2">
        <div className="h-full bg-[#F0B90B] rounded-full" style={{ width: `${rr}%` }} />
      </div>
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-[#848E9C] mono">SL {p.sl || '—'} · TP {p.tp || '—'}</div>
        <button onClick={close} disabled={busy}
          className={clsx('text-[11px] px-2 py-1 rounded border font-medium',
            confirm ? 'border-[#F6465D] text-[#F6465D] bg-[#F6465D]/10' : 'border-[#2B3139] text-[#848E9C]'
          )}>{busy ? '…' : confirm ? 'Confirm' : 'Close'}</button>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const {
    portfolioBalance, dailyPnl, dailyPnlPct, weeklyPnl,
    winRate, avgRR, positions, tradeHistory, settings,
    currentStreak, openPnl, totalTrades, livePrices,
  } = useStore()

  const [left, setLeft] = useState('')
  useEffect(() => {
    const t = () => {
      const n = new Date()
      const d = 3600 - (n.getUTCMinutes() * 60 + n.getUTCSeconds())
      setLeft(`${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`)
    }
    t(); const i = setInterval(t, 1000); return () => clearInterval(i)
  }, [])

  const today = useMemo(() => {
    const n = new Date()
    return (tradeHistory || []).filter(t => {
      const d = new Date(t.date)
      return d.toDateString() === n.toDateString()
    })
  }, [tradeHistory])
  const tw = today.filter(t => (t.pnl || 0) > 0).length
  const tl = today.filter(t => (t.pnl || 0) <= 0).length
  const maxT = settings.maxTradesPerDay || 4
  const lossPct = Math.min(100, (Math.abs(Math.min(0, dailyPnl)) / (Math.max(portfolioBalance, 1) * (settings.dailyLossLimit || 25) / 100)) * 100)

  return (
    <div className="space-y-3">
      {/* Equity strip */}
      <div className="card p-3 flex items-end justify-between gap-3">
        <div>
          <div className="label mb-0.5">Equity</div>
          <div className="mono text-[22px] font-bold leading-none tracking-tight">
            ${Number(portfolioBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={clsx('mono text-[12px] font-medium mt-1.5', dailyPnl >= 0 ? 'pos' : 'neg')}>
            {dailyPnl >= 0 ? '+' : ''}{dailyPnl.toFixed(2)}
            <span className="text-[#848E9C] font-normal ml-1">({dailyPnlPct.toFixed(2)}%) today</span>
          </div>
        </div>
        <div className="text-right">
          <div className="label">Next bar</div>
          <div className="mono text-[16px] font-semibold text-[#F0B90B]">{left}</div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi label="Open PnL" value={`${openPnl >= 0 ? '+' : ''}${openPnl.toFixed(2)}`}
          sub={`${positions.length} pos`} tone={openPnl > 0 ? 'pos' : openPnl < 0 ? 'neg' : null} />
        <Kpi label="Win rate" value={`${winRate}%`} sub={`${totalTrades} trades`} />
        <Kpi label="Avg R" value={avgRR ? avgRR.toFixed(2) : '—'} sub={`${tw}W ${tl}L today`} />
        <Kpi label="7D PnL" value={`${weeklyPnl >= 0 ? '+' : ''}${weeklyPnl.toFixed(2)}`}
          tone={weeklyPnl > 0 ? 'pos' : weeklyPnl < 0 ? 'neg' : null} />
      </div>

      {/* Chart */}
      <div className="card p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-semibold text-[#EAECEF]">PnL curve</span>
          <span className={clsx('mono text-[12px] font-medium', weeklyPnl >= 0 ? 'pos' : 'neg')}>
            {weeklyPnl >= 0 ? '+' : ''}{weeklyPnl.toFixed(2)} 7d
          </span>
        </div>
        <div className="h-[140px]"><EquityChart tradeHistory={tradeHistory} /></div>
      </div>

      {/* Risk + streak */}
      <div className="grid grid-cols-2 gap-2">
        <div className="card p-3">
          <div className="label mb-1">Streak</div>
          <div className={clsx('mono text-[20px] font-bold', currentStreak > 0 ? 'pos' : currentStreak < 0 ? 'neg' : '')}>
            {currentStreak === 0 ? '0' : Math.abs(currentStreak)}
          </div>
          <div className="text-[10px] text-[#848E9C]">
            {currentStreak > 0 ? 'wins' : currentStreak < 0 ? 'losses' : 'flat'}
          </div>
        </div>
        <div className="card p-3">
          <div className="label mb-2">Daily risk</div>
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-[#848E9C]">Loss</span>
            <span className="mono">{lossPct.toFixed(0)}/{settings.dailyLossLimit}%</span>
          </div>
          <div className="h-1 bg-[#1E2329] rounded-full overflow-hidden mb-2">
            <div className={clsx('h-full rounded-full', lossPct > 70 ? 'bg-[#F6465D]' : 'bg-[#0ECB81]')}
              style={{ width: `${lossPct}%` }} />
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-[#848E9C]">Trades</span>
            <span className="mono">{today.length}/{maxT}</span>
          </div>
        </div>
      </div>

      {/* Positions */}
      <div>
        <div className="flex items-center justify-between mb-1.5 px-0.5">
          <span className="text-[12px] font-semibold">Positions</span>
          <span className="text-[11px] text-[#848E9C]">{positions.length}</span>
        </div>
        {positions.length === 0 ? (
          <div className="card py-8 text-center text-[12px] text-[#848E9C]">No open positions</div>
        ) : (
          <div className="space-y-2">
            {positions.map(p => {
            const sym = (p.symbol || '').replace('/', '')
            const mark = livePrices?.[sym]?.price ?? livePrices?.[p.symbol]?.price
            return <PosRow key={p.id || p.symbol} p={p} liveMark={mark} />
          })}
          </div>
        )}
      </div>
    </div>
  )
}
