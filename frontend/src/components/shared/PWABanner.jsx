import React, { useState, useEffect } from 'react'
import { Smartphone, X, Download, Bell, BellOff } from 'lucide-react'
import { notifications } from '../../services/notifications'
import { useStore } from '../../store'
import clsx from 'clsx'

export default function PWABanner() {
  const { settings, updateSettings } = useStore()
  const [showInstall, setShowInstall]   = useState(false)
  const [showNotifReq, setShowNotifReq] = useState(false)
  const [notifGranted, setNotifGranted] = useState(false)
  const [installed, setInstalled]       = useState(false)
  const [dismissed, setDismissed]       = useState(false)

  useEffect(() => {
    // Check if already installed
    setInstalled(notifications.isInstalled())

    // Listen for installable event
    const onInstallable = () => {
      if (!notifications.isInstalled()) setShowInstall(true)
    }
    window.addEventListener('pwa-installable', onInstallable)

    // Check notification permission
    if ('Notification' in window) {
      setNotifGranted(Notification.permission === 'granted')
      if (Notification.permission === 'default' && settings.notifications) {
        setTimeout(() => setShowNotifReq(true), 3000)
      }
    }

    return () => window.removeEventListener('pwa-installable', onInstallable)
  }, [])

  const handleInstall = async () => {
    const accepted = await notifications.promptInstall()
    if (accepted) { setInstalled(true); setShowInstall(false) }
  }

  const handleNotifAllow = async () => {
    const granted = await notifications.requestPermission()
    setNotifGranted(granted)
    setShowNotifReq(false)
    if (granted) updateSettings({ notifications: true })
  }

  const handleNotifDeny = () => {
    setShowNotifReq(false)
    updateSettings({ notifications: false })
  }

  if (dismissed) return null

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 max-w-xs">

      {/* Notification permission request */}
      {showNotifReq && !notifGranted && (
        <div className="bg-bg-card border border-accent-cyan/30 rounded-xl p-4 shadow-card animate-slide-up">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center flex-shrink-0">
              <Bell size={16} className="text-accent-cyan" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display text-xs font-bold text-text-primary">Enable Alerts?</p>
              <p className="font-body text-xs text-text-muted mt-0.5">
                Get notified when signals fire, TP/SL hits, or daily limits are reached.
              </p>
              <div className="flex gap-2 mt-3">
                <button onClick={handleNotifAllow}
                  className="flex-1 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan font-body text-xs font-semibold py-1.5 rounded-lg hover:bg-accent-cyan/20 transition-all">
                  Allow
                </button>
                <button onClick={handleNotifDeny}
                  className="px-3 bg-bg-elevated border border-bg-border text-text-muted font-body text-xs py-1.5 rounded-lg hover:border-accent-red/30 hover:text-accent-red transition-all">
                  No thanks
                </button>
              </div>
            </div>
            <button onClick={() => setShowNotifReq(false)} className="text-text-muted hover:text-text-secondary">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* PWA Install prompt */}
      {showInstall && !installed && (
        <div className="bg-bg-card border border-accent-purple/30 rounded-xl p-4 shadow-card animate-slide-up">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-purple/10 border border-accent-purple/20 flex items-center justify-center flex-shrink-0">
              <Smartphone size={16} className="text-accent-purple" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display text-xs font-bold text-text-primary">Install App</p>
              <p className="font-body text-xs text-text-muted mt-0.5">
                Add SmartEdge to your home screen for faster access and offline support.
              </p>
              <div className="flex gap-2 mt-3">
                <button onClick={handleInstall}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-accent-purple/10 border border-accent-purple/30 text-accent-purple font-body text-xs font-semibold py-1.5 rounded-lg hover:bg-accent-purple/20 transition-all">
                  <Download size={12} /> Install
                </button>
                <button onClick={() => { setShowInstall(false); setDismissed(true) }}
                  className="px-3 bg-bg-elevated border border-bg-border text-text-muted font-body text-xs py-1.5 rounded-lg hover:border-bg-border transition-all">
                  Later
                </button>
              </div>
            </div>
            <button onClick={() => setShowInstall(false)} className="text-text-muted hover:text-text-secondary">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Notification status indicator (when granted) */}
      {notifGranted && settings.notifications && !showNotifReq && !showInstall && false && (
        <div className="flex items-center gap-2 bg-bg-card border border-accent-green/20 rounded-lg px-3 py-2">
          <Bell size={12} className="text-accent-green" />
          <span className="font-body text-xs text-accent-green">Alerts active</span>
        </div>
      )}
    </div>
  )
}
