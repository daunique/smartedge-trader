import React, { useEffect, useState } from 'react'
import { api } from '../../services/api'
import clsx from 'clsx'

function ago(iso) {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 0) return '—'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

export default function StatusStrip() {
  const [st, setSt] = useState(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const d = await api.getStatus()
      if (alive && d) setSt(d)
    }
    load()
    const t = setInterval(load, 15000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  if (!st) return null

  const mode = st.account_mode || 'DEMO'
  const isDemo = String(mode).toUpperCase() !== 'LIVE'
  const lastOrder = st.last_order

  return (
    <div className="space-y-2 mb-4">
      <div className={clsx(
        'rounded-lg px-3 py-2 text-[11px] font-semibold tracking-wide flex items-center justify-between gap-2 border',
        isDemo
          ? 'bg-[#F0B90B]/08 border-[#F0B90B]/25 text-[#F0B90B]'
          : 'bg-[#F6465D]/10 border-[#F6465D]/35 text-[#F6465D]'
      )}>
        <span>{isDemo ? 'DEMO ACCOUNT — paper trading' : 'LIVE ACCOUNT — real funds'}</span>
        <span className="font-medium opacity-90">{st.execution_mode}{st.paused ? ' · PAUSED' : ''}</span>
      </div>

      <div className="rounded-lg border border-[#1E2329] bg-[#0B0E11] px-3 py-2.5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-[10px]">
        <div>
          <div className="text-[#5E6673] uppercase tracking-wider mb-0.5">Scan</div>
          <div className="mono text-[#EAECEF] text-[12px]">{ago(st.last_scan_at)} ago</div>
        </div>
        <div>
          <div className="text-[#5E6673] uppercase tracking-wider mb-0.5">BE monitor</div>
          <div className="mono text-[#EAECEF] text-[12px]">{ago(st.last_be_check_at)} ago</div>
        </div>
        <div>
          <div className="text-[#5E6673] uppercase tracking-wider mb-0.5">Positions</div>
          <div className="mono text-[#EAECEF] text-[12px]">{st.open_positions ?? 0} open</div>
        </div>
        <div>
          <div className="text-[#5E6673] uppercase tracking-wider mb-0.5">Last order</div>
          <div className={clsx(
            'mono text-[12px] truncate',
            lastOrder?.ok ? 'text-[#0ECB81]' : lastOrder ? 'text-[#F6465D]' : 'text-[#848E9C]'
          )}>
            {lastOrder ? `${lastOrder.ok ? 'OK' : 'FAIL'} · ${(lastOrder.msg || '').slice(0, 28)}` : '—'}
          </div>
        </div>
        {st.equity != null && (
          <div className="sm:col-span-2">
            <div className="text-[#5E6673] uppercase tracking-wider mb-0.5">Equity / avail</div>
            <div className="mono text-[#EAECEF] text-[12px]">
              ${Number(st.equity).toFixed(2)}
              {st.available != null && <span className="text-[#848E9C]"> / ${Number(st.available).toFixed(2)}</span>}
            </div>
          </div>
        )}
        {st.last_be_move_at && (
          <div className="sm:col-span-2">
            <div className="text-[#5E6673] uppercase tracking-wider mb-0.5">Last BE move</div>
            <div className="mono text-[#F0B90B] text-[12px]">{st.last_be_symbol} · {ago(st.last_be_move_at)} ago</div>
          </div>
        )}
      </div>
    </div>
  )
}
