import React, { useMemo, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useStore } from '../../store'
import { api } from '../../services/api'
import clsx from 'clsx'
import { format } from 'date-fns'

function EquityChart({ tradeHistory }) {
  const data = useMemo(() => {
    const sorted = [...(tradeHistory || [])].sort((a, b) => new Date(a.date) - new Date(b.date))
    let run = 0
    return sorted.slice(-60).map(t => {
      run += t.pnl || 0
      return { v: Math.round(run * 100) / 100, d: format(new Date(t.date), 'MM/dd'), full: t.date }
    })
  }, [tradeHistory])

  if (!data.length) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-1 text-[12px] text-[#848E9C]">
        <span className="text-[#F0B90B]/80 font-medium">Equity curve</span>
        <span>No closed trades yet</span>
      </div>
    )
  }

  const Tip = ({ active, payload }) => {
    if (!active || !payload?.[0]) return null
    const v = payload[0].value
    return (
      <div className="bg-[#0B0E11] border border-[#2B3139] rounded-md px-2.5 py-1.5 shadow-lg text-[11px]">
        <div className="text-[#848E9C] mb-0.5">{payload[0].payload.d}</div>
        <div className={clsx('mono font-semibold tabular-nums', v >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]')}>
          {v >= 0 ? '+' : ''}${v.toFixed(2)}
        </div>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F0B90B" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#F0B90B" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1E2329" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="d" tick={{ fill: '#5E6673', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={28} />
        <YAxis tick={{ fill: '#5E6673', fontSize: 10 }} axisLine={false} tickLine={false} width={42} tickFormatter={v => `$${v}`} />
        <Tooltip content={<Tip />} cursor={{ stroke: '#2B3139' }} />
        <Area type="monotone" dataKey="v" stroke="#F0B90B" strokeWidth={2} fill="url(#eqFill)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="rounded-lg border border-[#1E2329] bg-[#0B0E11] px-3 py-3 hover:border-[#2B3139] transition-colors">
      <div className="text-[10px] uppercase tracking-wider text-[#5E6673] font-medium mb-1.5">{label}</div>
      <div className={clsx(
        'mono text-[17px] font-semibold leading-none tabular-nums',
        tone === 'pos' && 'text-[#0ECB81]',
        tone === 'neg' && 'text-[#F6465D]',
        !tone && 'text-[#EAECEF]'
      )}>{value}</div>
      {sub != null && sub !== '' && (
        <div className="text-[10px] text-[#848E9C] mt-1.5 leading-snug">{sub}</div>
      )}
    </div>
  )
}

function PosRow({ p, liveMark }) {
  const closeInStore = useStore(s => s.closePosition)
  const [busy, setBusy] = useState(false)
  const long = p.direction === 'LONG'
  // Prefer Bybit mark on the position (same venue as fill); public feed only as fallback
  const bybitMark = Number(p.current) || 0
  const feedMark = liveMark != null ? Number(liveMark) : 0
  const mark = bybitMark > 0 ? bybitMark : feedMark
  const entry = Number(p.entry) || 0
  const size = Number(p.size) || 0
  const lev = p.leverage != null && Number(p.leverage) > 0 ? Number(p.leverage) : null
  // Bybit unrealisedPnl is authoritative (includes fee accrual rules). Recompute
  // from mark only when we have size/entry — linear USDT: pnl = size * delta.
  const apiPnl = Number(p.pnl)
  let livePnl = apiPnl
  if (entry > 0 && size > 0 && mark > 0) {
    const raw = (long ? (mark - entry) : (entry - mark)) * size
    // If API pnl is missing/zero but price moved, use raw; else prefer API
    if (!Number.isFinite(apiPnl) || (Math.abs(apiPnl) < 1e-8 && Math.abs(raw) > 1e-6)) {
      livePnl = raw
    } else {
      livePnl = apiPnl
    }
  }
  // Stable 1R: prefer server riskPx (TP/3), never use |entry-sl| after BE
  let riskPx = Number(p.riskPx) || 0
  if (riskPx <= 0 && p.tp && entry) riskPx = Math.abs(Number(p.tp) - entry) / 3
  if (riskPx <= 0 && entry) riskPx = entry * 0.01
  const move = mark && entry ? (long ? (mark - entry) : (entry - mark)) : 0
  const rrAchieved = riskPx > 0 ? move / riskPx : Number(p.rrAchieved) || 0
  const rrPct = Math.min(100, Math.max(0, (rrAchieved / 3) * 100))
  const be = p.status === 'BE' || (p.sl && entry && Math.abs(Number(p.sl) - entry) / entry < 0.002)

  const onClose = async () => {
    if (!confirm(`Close ${p.symbol} ${p.direction}?`)) return
    setBusy(true)
    try {
      await api.closePosition(p.id || p.symbol)
      closeInStore?.(p.id || p.symbol)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-[#1E2329] bg-[#0B0E11] p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-[#EAECEF]">{p.symbol}</span>
            <span className={clsx(
              'text-[10px] font-bold px-1.5 py-0.5 rounded',
              long ? 'bg-[#0ECB81]/15 text-[#0ECB81]' : 'bg-[#F6465D]/15 text-[#F6465D]'
            )}>{p.direction}</span>
            {be && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#F0B90B]/15 text-[#F0B90B]">BE</span>
            )}
          </div>
          <div className="text-[10px] text-[#848E9C] mt-1 mono tabular-nums">
            Size {size} · Lev {lev != null ? lev.toFixed(1) : '—'}×
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={clsx('mono text-[15px] font-semibold tabular-nums', livePnl >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]')}>
            {livePnl >= 0 ? '+' : ''}{livePnl.toFixed(2)}
          </div>
          <div className="text-[10px] text-[#848E9C]">Open PnL</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-[#5E6673] text-[10px]">Entry</div>
          <div className="mono text-[#EAECEF] tabular-nums">{entry ? entry.toFixed(4) : '—'}</div>
        </div>
        <div>
          <div className="text-[#5E6673] text-[10px]">Mark</div>
          <div className="mono text-[#EAECEF] tabular-nums">{mark ? mark.toFixed(4) : '—'}</div>
        </div>
        <div>
          <div className="text-[#5E6673] text-[10px]">SL / TP</div>
          <div className="mono text-[#EAECEF] tabular-nums truncate">
            {p.sl ? Number(p.sl).toFixed(4) : '—'} / {p.tp ? Number(p.tp).toFixed(4) : '—'}
          </div>
        </div>
      </div>

      <div>
        <div className="flex justify-between text-[10px] text-[#848E9C] mb-1">
          <span>Progress to 3R</span>
          <span className="mono tabular-nums">{rrAchieved.toFixed(2)}R</span>
        </div>
        <div className="h-1.5 rounded-full bg-[#1E2329] overflow-hidden">
          <div
            className={clsx('h-full rounded-full transition-all', livePnl >= 0 ? 'bg-[#0ECB81]' : 'bg-[#F6465D]')}
            style={{ width: `${rrPct}%` }}
          />
        </div>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onClose}
        className="w-full py-1.5 rounded-md text-[11px] font-semibold border border-[#2B3139] text-[#F6465D] hover:bg-[#F6465D]/10 disabled:opacity-50"
      >
        {busy ? 'Closing…' : 'Close position'}
      </button>
    </div>
  )
}

export default function Dashboard() {
  const {
    portfolioBalance, dailyPnl, dailyPnlPct, weeklyPnl,
    winRate, avgRR, positions, tradeHistory, settings,
    currentStreak, openPnl, totalTrades, livePrices,
  } = useStore()

  const bal = Number(portfolioBalance || 0)
  const dPnl = Number(dailyPnl || 0)
  const dPct = Number(dailyPnlPct || 0)
  const oPnl = useMemo(() => {
    const list = positions || []
    if (!list.length) return Number(openPnl || 0)
    return list.reduce((s, pos) => s + (Number(pos.pnl) || 0), 0)
  }, [positions, openPnl])
  const wPnl = Number(weeklyPnl || 0)

  const recent = useMemo(() => {
    return [...(tradeHistory || [])]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8)
  }, [tradeHistory])

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-[#EAECEF] tracking-tight">Dashboard</h1>
          <p className="text-[12px] text-[#848E9C] mt-0.5">
            XRPUSDT · 1H · Risk {settings?.riskPerTrade?.XRPUSDT ?? 10}% · BE @ 2.0R
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-[#5E6673]">Equity</div>
          <div className="mono text-[22px] font-semibold text-[#EAECEF] tabular-nums leading-none">
            ${bal.toFixed(2)}
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Kpi
          label="Daily PnL"
          value={`${dPnl >= 0 ? '+' : ''}$${dPnl.toFixed(2)}`}
          sub={`${dPct >= 0 ? '+' : ''}${dPct.toFixed(2)}% today`}
          tone={dPnl > 0 ? 'pos' : dPnl < 0 ? 'neg' : undefined}
        />
        <Kpi
          label="Open PnL"
          value={`${oPnl >= 0 ? '+' : ''}$${oPnl.toFixed(2)}`}
          sub={`${(positions || []).length} position(s)`}
          tone={oPnl > 0 ? 'pos' : oPnl < 0 ? 'neg' : undefined}
        />
        <Kpi
          label="Win rate"
          value={`${Number(winRate || 0).toFixed(0)}%`}
          sub={`${totalTrades || 0} closed trades`}
        />
        <Kpi
          label="Avg R:R"
          value={Number(avgRR || 0) ? `1:${Number(avgRR).toFixed(1)}` : '—'}
          sub="Realized exits"
        />
        <Kpi
          label="Streak"
          value={currentStreak || '—'}
          sub="Current run"
          tone={String(currentStreak || '').startsWith('W') ? 'pos' : String(currentStreak || '').startsWith('L') ? 'neg' : undefined}
        />
        <Kpi
          label="Weekly"
          value={`${wPnl >= 0 ? '+' : ''}$${wPnl.toFixed(2)}`}
          sub="Net this week"
          tone={wPnl > 0 ? 'pos' : wPnl < 0 ? 'neg' : undefined}
        />
      </div>

      {/* Chart + positions */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <div className="lg:col-span-3 rounded-lg border border-[#1E2329] bg-[#0B0E11] p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[12px] font-semibold text-[#EAECEF]">Cumulative PnL</h2>
            <span className="text-[10px] text-[#5E6673]">Last 60 closes</span>
          </div>
          <div className="h-[220px] sm:h-[260px]">
            <EquityChart tradeHistory={tradeHistory} />
          </div>
        </div>

        <div className="lg:col-span-2 space-y-2">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="text-[12px] font-semibold text-[#EAECEF]">Open positions</h2>
            <span className="text-[10px] text-[#5E6673]">{(positions || []).length}</span>
          </div>
          {!(positions || []).length ? (
            <div className="rounded-lg border border-dashed border-[#1E2329] bg-[#0B0E11]/50 py-12 text-center text-[12px] text-[#848E9C]">
              No open positions
            </div>
          ) : (
            (positions || []).map(p => {
              const sym = (p.symbol || '').replace('/', '')
              const mark = livePrices?.[sym]?.price ?? livePrices?.[p.symbol]?.price
              return <PosRow key={p.id || p.symbol} p={p} liveMark={mark} />
            })
          )}
        </div>
      </div>

      {/* Recent trades */}
      <div className="rounded-lg border border-[#1E2329] bg-[#0B0E11] overflow-hidden">
        <div className="px-3 py-2.5 border-b border-[#1E2329] flex items-center justify-between">
          <h2 className="text-[12px] font-semibold text-[#EAECEF]">Recent closes</h2>
          <span className="text-[10px] text-[#5E6673]">XRPUSDT</span>
        </div>
        {!recent.length ? (
          <div className="py-10 text-center text-[12px] text-[#848E9C]">No trade history yet</div>
        ) : (
          <div className="divide-y divide-[#1E2329]">
            <div className="hidden sm:grid grid-cols-[88px_1fr_56px_48px_72px] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wide text-[#5E6673]">
              <div>Time</div>
              <div>Pair</div>
              <div>Side</div>
              <div>R</div>
              <div className="text-right">PnL</div>
            </div>
            {recent.map((t, i) => (
              <div
                key={t.id || i}
                className="grid grid-cols-[1fr_auto] sm:grid-cols-[88px_1fr_56px_48px_72px] gap-2 px-3 py-2.5 items-center hover:bg-[#161A1E]/40"
              >
                <div className="text-[11px] text-[#848E9C] mono tabular-nums">
                  {t.date ? format(new Date(t.date), 'MM/dd HH:mm') : '—'}
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[12px] font-medium text-[#EAECEF] truncate">{t.symbol}</span>
                  <span className={clsx(
                    'sm:hidden text-[10px] font-bold px-1 rounded',
                    t.direction === 'LONG' ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                  )}>{t.direction === 'LONG' ? 'L' : 'S'}</span>
                </div>
                <div className="hidden sm:block">
                  <span className={clsx(
                    'text-[10px] font-bold',
                    t.direction === 'LONG' ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                  )}>{t.direction}</span>
                </div>
                <div className="hidden sm:block mono text-[11px] text-[#848E9C]">{t.rr || '—'}</div>
                <div className={clsx(
                  'mono text-[12px] font-semibold text-right tabular-nums',
                  (t.pnl || 0) >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                )}>
                  {(t.pnl || 0) >= 0 ? '+' : ''}{Number(t.pnl || 0).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
