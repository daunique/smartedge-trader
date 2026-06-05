import React from 'react'
import Header from './components/shared/Header'
import Sidebar from './components/shared/Sidebar'
import PageTitle from './components/shared/PageTitle'
import PWABanner from './components/shared/PWABanner'
import Dashboard from './components/dashboard/Dashboard'
import Signals from './components/signals/Signals'
import History from './components/history/History'
import Statistics from './components/statistics/Statistics'
import Settings from './components/settings/Settings'
import { useLiveData } from './hooks/useLiveData'
import { useStore } from './store'
import clsx from 'clsx'

const PAGES = {
  dashboard:  Dashboard,
  signals:    Signals,
  history:    History,
  statistics: Statistics,
  settings:   Settings,
}

function ConnectionBanner() {
  const { backendConnected } = useStore()
  if (backendConnected) return null
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-accent-yellow/10 border border-accent-yellow/30 rounded-lg px-3 py-2 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-yellow live-dot" />
        <span className="font-body text-xs text-accent-yellow">Connecting...</span>
      </div>
    </div>
  )
}

export default function App() {
  const { activePage } = useStore()
  const PageComponent = PAGES[activePage] || Dashboard
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
      <PWABanner />
    </div>
  )
}
