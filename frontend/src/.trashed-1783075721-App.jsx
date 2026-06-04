import React from 'react'
import Header from './components/shared/Header'
import Sidebar from './components/shared/Sidebar'
import PageTitle from './components/shared/PageTitle'
import Dashboard from './components/dashboard/Dashboard'
import History from './components/history/History'
import Statistics from './components/statistics/Statistics'
import Settings from './components/settings/Settings'
import { useLiveData } from './hooks/useLiveData'
import { useStore } from './store'
import clsx from 'clsx'

const PAGES = {
  dashboard: Dashboard,
  history: History,
  statistics: Statistics,
  settings: Settings,
}

function ConnectionBanner() {
  const { backendConnected, wsConnected, livePrices } = useStore()
  const hasPrices = Object.keys(livePrices).length > 0

  if (backendConnected && wsConnected) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {!backendConnected && (
        <div className="bg-accent-yellow/10 border border-accent-yellow/30 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-yellow live-dot" />
          <span className="font-body text-xs text-accent-yellow">Running on demo data</span>
        </div>
      )}
      {hasPrices && (
        <div className="bg-accent-green/10 border border-accent-green/30 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green live-dot" />
          <span className="font-body text-xs text-accent-green">Live prices connected</span>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const { activePage } = useStore()
  const PageComponent = PAGES[activePage] || Dashboard

  // Start live data connection
  useLiveData()

  return (
    <div className="min-h-screen bg-bg-primary grid-bg">
      <Header />
      <Sidebar />
      <main className={clsx('pt-14 transition-all duration-300', 'lg:ml-56')}>
        <div className="p-4 md:p-5 max-w-screen-2xl mx-auto">
          <PageTitle page={activePage} />
          <PageComponent />
        </div>
      </main>
      <ConnectionBanner />
    </div>
  )
}
