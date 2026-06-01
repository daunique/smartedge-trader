import React from 'react'

const PAGE_META = {
  dashboard: { title: 'Dashboard', sub: 'Live trading overview' },
  history: { title: 'Trade History', sub: 'Complete execution log' },
  statistics: { title: 'Statistics', sub: 'Performance analytics' },
  settings: { title: 'Settings', sub: 'System configuration' },
}

export default function PageTitle({ page }) {
  const meta = PAGE_META[page] || PAGE_META.dashboard
  return (
    <div className="mb-5">
      <h1 className="font-display text-lg font-bold text-text-primary tracking-wide">{meta.title}</h1>
      <p className="font-body text-xs text-text-muted mt-0.5">{meta.sub}</p>
    </div>
  )
}
