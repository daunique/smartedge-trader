import React, { useEffect, useState } from 'react'
import { api } from '../../services/api'
import clsx from 'clsx'

function ago(iso) {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 0) return '—'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
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
    <div className="space-y-2 mb-3">
      {/* Demo / Live banner */}
      <div className={clsx(
        'rounded px-3 py-1.5 text-[11px] font-semibold tracking-wide flex items-center justify-between gap-2 border',
        isDemo
          ? 'bg-[#F0B90B]/10 border-[#F0B90B]/30 text-[#F0B90B]'
          : 'bg-[#F6465D]/10 border-[#F6465D]/40 text-[#F6465D]'
      )}>
        <span>{isDemo ? 'DEMO ACCOUNT — paper trading only' : '⚠ LIVE ACCOUNT — real funds'}</span>
        <span className="font-normal opacity-80">{st.execution_mode}{st.paused ? ' · PAUSED' : ''}</span>
      </div>

      {/* System status strip */}
      <div className="card px-3 py-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 text-[10px]">
        <div>
          <div className="text-[#848E9C] uppercase tracking-wide">Scan</div>
          <div className="mono text-[#EAECEF]">{ago(st.last_scan_at)}</div>
        </div>
        <div>
          <div className="text-[#848E9C] uppercase tracking-wide">BE monitor</div>
          <div className="mono text-[#EAECEF]">{ago(st.last_be_check_at)}</div>
        </div>
        <div>
          <div className="text-[#848E9C] uppercase tracking-wide">Positions</div>
          <div className="mono text-[#EAECEF]">{st.open_positions ?? 0} open</div>
        </div>
        <div>
          <div className="text-[#848E9C] uppercase tracking-wide">Last order</div>
          <div className={clsx('mono truncate', lastOrder?.ok ? 'text-[#0ECB81]' : lastOrder ? 'text-[#F6465D]' : 'text-[#848E9C]')}>
            {lastOrder
              ? `${lastOrder.ok ? 'OK' : 'FAIL'} · ${lastOrder.msg || ''}`.slice(0, 42)
              : '—'}
          </div>
        </div>
        {st.equity != null && (
          <div className="sm:col-span-2">
            <div className="text-[#848E9C] uppercase tracking-wide">Equity / avail</div>
            <div className="mono text-[#EAECEF]">
              ${Number(st.equity).toFixed(2)}
              {st.available != null && <span className="text-[#848E9C]"> / ${Number(st.available).toFixed(2)}</span>}
            </div>
          </div>
        )}
        {st.last_be_move_at && (
          <div className="sm:col-span-2">
            <div className="text-[#848E9C] uppercase tracking-wide">Last BE move</div>
            <div className="mono text-[#F0B90B]">{st.last_be_symbol} · {ago(st.last_be_move_at)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
