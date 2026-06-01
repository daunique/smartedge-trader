import React from 'react'
import Header from './components/shared/Header'
import Sidebar from './components/shared/Sidebar'
import PageTitle from './components/shared/PageTitle'
import Dashboard from './components/dashboard/Dashboard'
import History from './components/history/History'
import Statistics from './components/statistics/Statistics'
import Settings from './components/settings/Settings'
import { useStore } from './store'
import clsx from 'clsx'

const PAGES = {
  dashboard: Dashboard,
  history: History,
  statistics: Statistics,
  settings: Settings,
}

export default function App() {
  const { activePage } = useStore()
  const PageComponent = PAGES[activePage] || Dashboard

  return (
    <div className="min-h-screen bg-bg-primary grid-bg">
      <Header />
      <Sidebar />

      {/* Main content */}
      <main className={clsx(
        'pt-14 transition-all duration-300',
        'lg:ml-56' // sidebar width on desktop
      )}>
        <div className="p-4 md:p-5 max-w-screen-2xl mx-auto">
          <PageTitle page={activePage} />
          <PageComponent />
        </div>
      </main>
    </div>
  )
}
