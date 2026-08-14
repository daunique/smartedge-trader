import React from 'react'
import {
  LayoutDashboard, Radio, History as HistoryIcon,
  BarChart3, Settings as SettingsIcon, Activity, Wifi, WifiOff
} from 'lucide-react'
import Dashboard from './components/dashboard/Dashboard'
import Signals from './components/signals/Signals'
import History from './components/history/History'
import Statistics from './components/statistics/Statistics'
import Settings from './components/settings/Settings'
import { useLiveData } from './hooks/useLiveData'
import { useStore } from './store'
import clsx from 'clsx'

const NAV = [
  { id: 'dashboard',  label: 'Home',   icon: LayoutDashboard },
  { id: 'signals',    label: 'Signals', icon: Radio },
  { id: 'history',    label: 'History', icon: HistoryIcon },
  { id: 'statistics', label: 'Stats',   icon: BarChart3 },
  { id: 'settings',   label: 'Settings', icon: SettingsIcon },
]

const PAGES = {
  dashboard: Dashboard,
  signals: Signals,
  history: History,
  statistics: Statistics,
  settings: Settings,
}

function TopBar() {
  const {
    backendConnected, wsConnected, executionMode, systemPaused,
    portfolioBalance, livePrices, setPaused, setExecutionMode,
  } = useStore()
  const xrp = livePrices?.XRPUSDT
  const price = xrp?.price ?? xrp?.last ?? null
  const change = xrp?.change24h ?? xrp?.change ?? null

  return (
    <header className="sticky top-0 z-40 border-b border-bg-border/80 bg-[#070A12]/90 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-3 sm:px-5 h-14 flex items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-accent-cyan/15 border border-accent-cyan/30 flex items-center justify-center shrink-0">
            <Activity size={16} className="text-accent-cyan" />
          </div>
          <div className="min-w-0">
            <div className="font-display text-sm font-bold text-text-primary leading-tight">SmartEdge</div>
            <div className="text-[10px] text-text-muted truncate">XRP/USDT · 1H</div>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-3 ml-4 px-3 py-1.5 rounded-xl bg-bg-elevated/60 border border-bg-border">
          <span className="text-xs text-text-muted">XRP</span>
          <span className="font-display text-sm font-bold tabular-nums">
            {price != null ? Number(price).toFixed(4) : '—'}
          </span>
          {change != null && (
            <span className={clsx('text-xs font-medium', Number(change) >= 0 ? 'text-accent-green' : 'text-accent-red')}>
              {Number(change) >= 0 ? '+' : ''}{Number(change).toFixed(2)}%
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bg-elevated border border-bg-border text-xs text-text-secondary">
            <span className="tabular-nums font-display font-semibold text-text-primary">
              ${Number(portfolioBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <div className={clsx(
            'flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-medium',
            executionMode === 'FULL-AUTO'
              ? 'bg-accent-green/10 border-accent-green/30 text-accent-green'
              : executionMode === 'SEMI-AUTO'
                ? 'bg-accent-yellow/10 border-accent-yellow/30 text-accent-yellow'
                : 'bg-bg-elevated border-bg-border text-text-muted'
          )}>
            {executionMode === 'FULL-AUTO' && <span className="w-1.5 h-1.5 rounded-full bg-accent-green live-dot" />}
            {executionMode}
          </div>

          <div title={backendConnected ? 'Backend online' : 'Backend offline'}
            className="w-8 h-8 rounded-lg border border-bg-border bg-bg-elevated flex items-center justify-center">
            {backendConnected || wsConnected
              ? <Wifi size={14} className="text-accent-green" />
              : <WifiOff size={14} className="text-accent-red" />}
          </div>
        </div>
      </div>
    </header>
  )
}

function BottomNav() {
  const { activePage, setActivePage, signals } = useStore()
  const activeSignals = (signals || []).filter(s => s.status === 'ACTIVE' && !s.executed).length

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-bg-border/80 bg-[#070A12]/95 backdrop-blur-xl safe-bottom md:hidden">
      <div className="flex items-stretch justify-around h-16 px-1">
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = activePage === id
          return (
            <button key={id} onClick={() => setActivePage(id)}
              className={clsx(
                'relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors',
                active ? 'text-accent-cyan' : 'text-text-muted'
              )}>
              <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
              <span className="text-[10px] font-medium">{label}</span>
              {id === 'signals' && activeSignals > 0 && (
                <span className="absolute top-2 right-[28%] min-w-[16px] h-4 px-1 rounded-full bg-accent-cyan text-[9px] font-bold text-bg-primary flex items-center justify-center">
                  {activeSignals}
                </span>
              )}
              {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-accent-cyan" />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function SideNav() {
  const { activePage, setActivePage, signals } = useStore()
  const activeSignals = (signals || []).filter(s => s.status === 'ACTIVE' && !s.executed).length

  return (
    <aside className="hidden md:flex flex-col w-52 shrink-0 border-r border-bg-border bg-bg-secondary/40 min-h-[calc(100dvh-3.5rem)] sticky top-14">
      <div className="p-3 space-y-1">
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = activePage === id
          return (
            <button key={id} onClick={() => setActivePage(id)}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all',
                active
                  ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/25'
                  : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary border border-transparent'
              )}>
              <Icon size={18} />
              <span className="font-medium">{label}</span>
              {id === 'signals' && activeSignals > 0 && (
                <span className="ml-auto text-[10px] font-bold bg-accent-cyan text-bg-primary px-1.5 py-0.5 rounded-md">
                  {activeSignals}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="mt-auto p-4 border-t border-bg-border">
        <div className="text-[10px] uppercase tracking-widest text-text-muted mb-1">Strategy</div>
        <div className="text-xs text-text-secondary leading-relaxed">
          SMA 50/200 · Body &gt; 0.789<br />
          SL 1.5× · TP 4.5× · BE 2.0R
        </div>
      </div>
    </aside>
  )
}

export default function App() {
  const { activePage } = useStore()
  const Page = PAGES[activePage] || Dashboard
  useLiveData()

  return (
    <div className="min-h-dvh flex flex-col bg-[#070A12]">
      <TopBar />
      <div className="flex flex-1 max-w-6xl w-full mx-auto">
        <SideNav />
        <main className="flex-1 min-w-0 px-3 sm:px-5 py-4 pb-24 md:pb-6 page-enter">
          <Page />
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
