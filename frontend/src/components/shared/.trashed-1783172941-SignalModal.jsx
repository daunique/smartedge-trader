import React from 'react'
import {
  X, TrendingUp, TrendingDown, Target, Zap,
  Clock, BarChart2, Shield, Activity, CheckCircle
} from 'lucide-react'
import clsx from 'clsx'
import { format } from 'date-fns'

export default function SignalModal({ signal, onClose, onExecute, executionMode }) {
  if (!signal) return null

  const isLong   = signal.direction === 'LONG'
  const risk     = Math.abs(signal.entry - signal.sl)
  const reward   = Math.abs(signal.tp - signal.entry)
  const rrNum    = risk > 0 ? (reward / risk).toFixed(2) : '—'
  const beLevel  = signal.be || (isLong
    ? signal.entry + risk
    : signal.entry - risk)

  const formatPrice = (p) => {
    const n = Number(p)
    return n > 100 ? n.toFixed(2) : n > 1 ? n.toFixed(4) : n.toFixed(6)
  }

  const formatTime = (ts) => {
    try {
      return format(new Date(ts), 'MMM d, yyyy · HH:mm:ss')
    } catch { return '—' }
  }

  const confluences = [
    { label: 'VWAP Alignment', met: signal.vwapAbove === isLong, desc: isLong ? 'Price above VWAP — bullish' : 'Price below VWAP — bearish' },
    { label: 'ORB Breakout',   met: signal.orbBreak, desc: 'Price broke opening range boundary' },
    { label: 'ML Filter',      met: signal.confidence >= 65, desc: `Confidence score: ${signal.confidence}%` },
    { label: 'Trending Regime',met: signal.regime === 'TRENDING', desc: `Current regime: ${signal.regime}` },
    { label: 'Min RR Met',     met: parseFloat(rrNum) >= 2, desc: `R:R ratio: 1:${rrNum}` },
  ]

  const confluenceScore = confluences.filter(c => c.met).length

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={onClose}>
      <div
        className="bg-bg-card border border-bg-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md mx-0 sm:mx-4 max-h-[92vh] overflow-y-auto shadow-card animate-slide-up"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className={clsx(
          'flex items-center justify-between p-4 border-b border-bg-border sticky top-0 bg-bg-card rounded-t-2xl',
        )}>
          <div className="flex items-center gap-3">
            <div className={clsx(
              'w-10 h-10 rounded-xl flex items-center justify-center border',
              isLong ? 'bg-accent-green/10 border-accent-green/30' : 'bg-accent-red/10 border-accent-red/30'
            )}>
              {isLong ? <TrendingUp size={18} className="text-accent-green" /> : <TrendingDown size={18} className="text-accent-red" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-base font-bold text-text-primary">{signal.symbol}</h2>
                <span className={clsx('font-body text-xs font-semibold px-2 py-0.5 rounded border',
                  isLong ? 'badge-long' : 'badge-short')}>{signal.direction}</span>
              </div>
              <p className="font-body text-xs text-text-muted">{signal.timeframe} · {signal.market?.toUpperCase()} · {signal.regime}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-elevated transition-colors">
            <X size={16} className="text-text-muted" />
          </button>
        </div>

        <div className="p-4 space-y-4">

          {/* ML Score */}
          <div className="card-elevated p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-body text-xs text-text-muted uppercase tracking-wider">ML Confidence</span>
              <span className={clsx('font-display text-lg font-bold',
                signal.confidence >= 75 ? 'text-accent-green'
                : signal.confidence >= 60 ? 'text-accent-yellow' : 'text-accent-red'
              )}>{signal.confidence}%</span>
            </div>
            <div className="h-2 bg-bg-primary rounded-full overflow-hidden">
              <div className={clsx('h-full rounded-full transition-all duration-700',
                signal.confidence >= 75 ? 'bg-accent-green'
                : signal.confidence >= 60 ? 'bg-accent-yellow' : 'bg-accent-red'
              )} style={{ width: `${signal.confidence}%` }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="font-body text-xs text-text-muted">Min: 55%</span>
              <span className="font-body text-xs text-text-muted">Target: 75%+</span>
            </div>
          </div>

          {/* Price Levels */}
          <div>
            <h3 className="font-body text-xs text-text-muted uppercase tracking-wider mb-2">Price Levels</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="card-elevated p-3">
                <div className="font-body text-xs text-text-muted mb-1">Entry Price</div>
                <div className="font-display text-sm font-bold text-text-primary">{formatPrice(signal.entry)}</div>
              </div>
              <div className={clsx('card-elevated p-3 border', isLong ? 'border-accent-green/20' : 'border-accent-red/20')}>
                <div className="font-body text-xs text-text-muted mb-1">Take Profit</div>
                <div className={clsx('font-display text-sm font-bold', isLong ? 'text-accent-green' : 'text-accent-red')}>
                  {formatPrice(signal.tp)}
                </div>
                <div className="font-body text-xs text-text-muted mt-0.5">
                  +{((Math.abs(signal.tp - signal.entry) / signal.entry) * 100).toFixed(2)}%
                </div>
              </div>
              <div className="card-elevated p-3 border border-accent-red/20">
                <div className="font-body text-xs text-text-muted mb-1">Stop Loss</div>
                <div className="font-display text-sm font-bold text-accent-red">{formatPrice(signal.sl)}</div>
                <div className="font-body text-xs text-text-muted mt-0.5">
                  -{((Math.abs(signal.entry - signal.sl) / signal.entry) * 100).toFixed(2)}%
                </div>
              </div>
              <div className="card-elevated p-3 border border-accent-yellow/20">
                <div className="font-body text-xs text-text-muted mb-1">Break-Even</div>
                <div className="font-display text-sm font-bold text-accent-yellow">{formatPrice(beLevel)}</div>
                <div className="font-body text-xs text-text-muted mt-0.5">Auto-triggered</div>
              </div>
            </div>
          </div>

          {/* RR + ATR */}
          <div className="grid grid-cols-3 gap-2">
            <div className="card-elevated p-3 text-center">
              <div className="font-body text-xs text-text-muted mb-1">R:R Ratio</div>
              <div className="font-display text-base font-bold text-accent-cyan">1:{rrNum}</div>
            </div>
            <div className="card-elevated p-3 text-center">
              <div className="font-body text-xs text-text-muted mb-1">ATR</div>
              <div className="font-display text-base font-bold text-text-primary">{formatPrice(signal.atr || 0)}</div>
            </div>
            <div className="card-elevated p-3 text-center">
              <div className="font-body text-xs text-text-muted mb-1">Confluence</div>
              <div className={clsx('font-display text-base font-bold',
                confluenceScore >= 4 ? 'text-accent-green'
                : confluenceScore >= 3 ? 'text-accent-yellow' : 'text-accent-red'
              )}>{confluenceScore}/5</div>
            </div>
          </div>

          {/* Confluence Checklist */}
          <div>
            <h3 className="font-body text-xs text-text-muted uppercase tracking-wider mb-2">Confluence Checklist</h3>
            <div className="space-y-2">
              {confluences.map(c => (
                <div key={c.label} className={clsx(
                  'flex items-center gap-3 p-2.5 rounded-lg border',
                  c.met
                    ? 'bg-accent-green/5 border-accent-green/15'
                    : 'bg-bg-elevated border-bg-border'
                )}>
                  <div className={clsx('w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0',
                    c.met ? 'bg-accent-green/20' : 'bg-bg-primary')}>
                    {c.met
                      ? <CheckCircle size={12} className="text-accent-green" />
                      : <div className="w-2 h-2 rounded-full bg-text-muted" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={clsx('font-body text-xs font-semibold',
                      c.met ? 'text-text-primary' : 'text-text-muted')}>{c.label}</div>
                    <div className="font-body text-xs text-text-muted truncate">{c.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Timestamp */}
          <div className="flex items-center gap-2 text-text-muted">
            <Clock size={12} />
            <span className="font-body text-xs">Signal generated: {formatTime(signal.timestamp)}</span>
          </div>

          {/* Execute Button */}
          {executionMode === 'SEMI-AUTO' && (
            <button
              onClick={() => { onExecute(signal); onClose() }}
              className={clsx(
                'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-body text-sm font-semibold transition-all',
                isLong
                  ? 'bg-accent-green/10 border border-accent-green/30 text-accent-green hover:bg-accent-green/20'
                  : 'bg-accent-red/10 border border-accent-red/30 text-accent-red hover:bg-accent-red/20'
              )}>
              <Zap size={15} />
              Execute {signal.direction} — {signal.symbol}
            </button>
          )}
          {executionMode === 'FULL-AUTO' && (
            <div className="flex items-center justify-center gap-2 py-3 bg-accent-green/5 border border-accent-green/20 rounded-xl">
              <span className="w-2 h-2 rounded-full bg-accent-green live-dot" />
              <span className="font-body text-sm text-accent-green">Full-Auto will execute this signal</span>
            </div>
          )}
          {executionMode === 'MANUAL' && (
            <div className="flex items-center justify-center gap-2 py-3 bg-bg-elevated border border-bg-border rounded-xl">
              <span className="font-body text-sm text-text-muted">Switch to Semi-Auto or Full-Auto to execute</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
