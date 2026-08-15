import React from 'react'
import {
  LayoutDashboard, Radio, History as HistoryIcon,
  BarChart3, Settings as SettingsIcon, Activity
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
  { id: 'dashboard',  label: 'Home',     icon: LayoutDashboard },
  { id: 'signals',    label: 'Signals',  icon: Radio },
  { id: 'history',    label: 'History',  icon: HistoryIcon },
  { id: 'statistics', label: 'Stats',    icon: BarChart3 },
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
    backendConnected, executionMode, portfolioBalance, livePrices, systemPaused,
  } = useStore()
  const xrp = livePrices?.XRPUSDT || {}
  const price = xrp.price ?? xrp.last ?? xrp.close
  const change = xrp.change24h ?? xrp.changePct ?? xrp.change

  return (
    <header className="sticky top-0 z-40 bg-[#0B0E11]/95 border-b border-[#1E2329] backdrop-blur-md">
      <div className="max-w-5xl mx-auto h-12 px-3 flex items-center gap-2.5">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded bg-[#F0B90B]/15 flex items-center justify-center">
            <Activity size={14} className="text-[#F0B90B]" />
          </div>
          <div className="leading-none">
            <div className="text-[13px] font-semibold text-[#EAECEF]">SmartEdge</div>
            <div className="text-[9px] text-[#848E9C] tracking-wide">XRPUSDT · 1H</div>
          </div>
        </div>

        <div className="h-5 w-px bg-[#1E2329] mx-0.5" />

        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[10px] text-[#848E9C] font-medium">XRP</span>
          <span className="mono text-[13px] font-semibold text-[#EAECEF]">
            {price != null && Number(price) > 0 ? Number(price).toFixed(4) : '—'}
          </span>
          {change != null && !isNaN(Number(change)) && (
            <span className={clsx('mono text-[11px] font-medium', Number(change) >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]')}>
              {Number(change) >= 0 ? '+' : ''}{Number(change).toFixed(2)}%
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden xs:block mono text-[12px] font-semibold text-[#EAECEF]">
            ${Number(portfolioBalance || 0).toFixed(2)}
          </div>
          <div className={clsx(
            'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border',
            systemPaused
              ? 'border-[#F6465D]/40 text-[#F6465D] bg-[#F6465D]/10'
              : executionMode === 'FULL-AUTO'
                ? 'border-[#0ECB81]/40 text-[#0ECB81] bg-[#0ECB81]/10'
                : 'border-[#F0B90B]/40 text-[#F0B90B] bg-[#F0B90B]/10'
          )}>
            <span className={clsx('w-1.5 h-1.5 rounded-full',
              systemPaused ? 'bg-[#F6465D]' : executionMode === 'FULL-AUTO' ? 'bg-[#0ECB81] live-dot' : 'bg-[#F0B90B]'
            )} />
            {systemPaused ? 'PAUSED' : executionMode}
          </div>
          <div className={clsx('w-2 h-2 rounded-full', backendConnected ? 'bg-[#0ECB81]' : 'bg-[#F6465D]')}
            title={backendConnected ? 'Online' : 'Offline'} />
        </div>
      </div>
    </header>
  )
}

function BottomNav() {
  const { activePage, setActivePage, signals } = useStore()
  const n = (signals || []).filter(s => s.status === 'ACTIVE' && !s.executed).length

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-[#0B0E11] border-t border-[#1E2329] safe-pb md:hidden">
      <div className="flex h-[52px]">
        {NAV.map(({ id, label, icon: Icon }) => {
          const on = activePage === id
          return (
            <button key={id} onClick={() => setActivePage(id)}
              className={clsx(
                'relative flex-1 flex flex-col items-center justify-center gap-0.5',
                on ? 'text-[#F0B90B]' : 'text-[#848E9C]'
              )}>
              <Icon size={18} strokeWidth={on ? 2.2 : 1.7} />
              <span className="text-[10px] font-medium">{label}</span>
              {id === 'signals' && n > 0 && (
                <span className="absolute top-1 right-[22%] min-w-[14px] h-[14px] px-0.5 rounded-full bg-[#F0B90B] text-[9px] font-bold text-[#0B0E11] flex items-center justify-center">
                  {n}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function SideNav() {
  const { activePage, setActivePage, signals } = useStore()
  const n = (signals || []).filter(s => s.status === 'ACTIVE' && !s.executed).length

  return (
    <aside className="hidden md:flex flex-col w-44 shrink-0 border-r border-[#1E2329] min-h-[calc(100dvh-3rem)] sticky top-12 bg-[#0B0E11]">
      <div className="p-2 space-y-0.5">
        {NAV.map(({ id, label, icon: Icon }) => {
          const on = activePage === id
          return (
            <button key={id} onClick={() => setActivePage(id)}
              className={clsx(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded text-[13px] font-medium transition-colors',
                on ? 'bg-[#1E2329] text-[#F0B90B]' : 'text-[#848E9C] hover:text-[#EAECEF] hover:bg-[#161A1E]'
              )}>
              <Icon size={16} />
              {label}
              {id === 'signals' && n > 0 && (
                <span className="ml-auto text-[10px] bg-[#F0B90B] text-[#0B0E11] font-bold px-1.5 rounded">{n}</span>
              )}
            </button>
          )
        })}
      </div>
    </aside>
  )
}

export default function App() {
  const { activePage } = useStore()
  const Page = PAGES[activePage] || Dashboard
  useLiveData()

  return (
    <div className="min-h-dvh flex flex-col bg-[#0B0E11]">
      <TopBar />
      <div className="flex flex-1 max-w-5xl w-full mx-auto">
        <SideNav />
        <main className="flex-1 min-w-0 px-3 py-3 pb-[68px] md:pb-4">
          <Page />
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
