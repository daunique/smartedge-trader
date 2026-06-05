import React from 'react'
import {
  LayoutDashboard, History, BarChart2, Settings,
  Zap, X, ChevronRight, TrendingUp, Activity
} from 'lucide-react'
import { useStore } from '../../store'
import clsx from 'clsx'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, desc: 'Live overview' },
  { id: 'history', label: 'History', icon: History, desc: 'Trade log' },
  { id: 'statistics', label: 'Statistics', icon: BarChart2, desc: 'Performance' },
  { id: 'settings', label: 'Settings', icon: Settings, desc: 'Configuration' },
]

export default function Sidebar() {
  const { activePage, setActivePage, sidebarOpen, setSidebarOpen, positions, signals, winRate, dailyPnl } = useStore()

  const navigate = (page) => {
    setActivePage(page)
    setSidebarOpen(false)
  }

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={clsx(
        'fixed top-14 left-0 bottom-0 z-40 w-56 bg-bg-secondary border-r border-bg-border',
        'flex flex-col transition-transform duration-300 ease-in-out',
        'lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      )}>

        {/* Nav Items */}
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map(({ id, label, icon: Icon, desc }) => (
            <button
              key={id}
              onClick={() => navigate(id)}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group',
                activePage === id
                  ? 'bg-accent-cyan/10 border border-accent-cyan/20 text-accent-cyan'
                  : 'hover:bg-bg-elevated text-text-secondary hover:text-text-primary'
              )}
            >
              <Icon size={16} className={activePage === id ? 'text-accent-cyan' : 'text-text-muted group-hover:text-text-secondary'} />
              <div className="flex-1 text-left">
                <div className={clsx('font-sans text-sm font-medium', activePage === id ? 'text-accent-cyan' : '')}>
                  {label}
                </div>
                <div className="font-body text-xs text-text-muted">{desc}</div>
              </div>
              {activePage === id && <ChevronRight size={12} className="text-accent-cyan/60" />}
            </button>
          ))}
        </nav>

        {/* Quick Stats */}
        <div className="p-3 border-t border-bg-border space-y-2">
          <div className="card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-body text-xs text-text-muted uppercase tracking-wider">Open</span>
              <span className="font-display text-xs font-bold text-accent-cyan">{positions.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-body text-xs text-text-muted uppercase tracking-wider">Signals</span>
              <span className="font-display text-xs font-bold text-accent-yellow">{signals.filter(s => s.status === 'ACTIVE').length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-body text-xs text-text-muted uppercase tracking-wider">Win Rate</span>
              <span className="font-display text-xs font-bold text-accent-green">{winRate}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-body text-xs text-text-muted uppercase tracking-wider">Day P&L</span>
              <span className={clsx('font-display text-xs font-bold', dailyPnl >= 0 ? 'text-accent-green' : 'text-accent-red')}>
                {dailyPnl >= 0 ? '+' : ''}${dailyPnl.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Exchange badge */}
          <div className="flex items-center gap-2 px-3 py-2 bg-bg-elevated rounded-xl border border-bg-border">
            <Activity size={12} className="text-accent-cyan" />
            <span className="font-body text-xs text-text-secondary">Bybit Connected</span>
            <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent-green live-dot" />
          </div>
        </div>
      </aside>
    </>
  )
}
