'use client'

import { useEffect, useState } from 'react'
import { isInstalledApp, pushSupportedHere, subscribeDeviceToPush } from '@/lib/notifications/push-client'

const DISMISS_KEY = 'deed_push_nudge_dismissed_at'
const QUIET_DAYS = 7

/**
 * A one-time card in the installed app (home-screen icon) when alerts are not
 * on for this device: one tap turns them on, so new alerts show as a number on
 * the app icon, like other phone apps. "Not now" hides it for a week.
 */
export default function PushNudge({ userId, showToast }: { userId?: string | null; showToast: (msg: string, type?: 'success' | 'error' | 'info') => void }) {
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!userId || !isInstalledApp() || !pushSupportedHere()) return
    if (Notification.permission === 'denied') return
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) || 0)
      if (at && Date.now() - at < QUIET_DAYS * 86400000) return
    } catch { /* storage blocked: still offer it */ }
    let cancelled = false
    void (async () => {
      try {
        const config = await fetch('/api/notifications/endpoints', { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
        if (!config?.vapidPublicKey) return
        const registration = await navigator.serviceWorker.getRegistration('/')
        const sub = await registration?.pushManager.getSubscription()
        if (!cancelled && !sub) setShow(true)
      } catch { /* offline: ask another time */ }
    })()
    return () => { cancelled = true }
  }, [userId])

  if (!show) return null
  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* ignore */ }
    setShow(false)
  }
  const turnOn = async () => {
    setBusy(true)
    try {
      await subscribeDeviceToPush()
      setShow(false)
      showToast('Alerts are on: new ones show on the app icon, even when the app is closed', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not turn on alerts', 'error')
      if (Notification.permission === 'denied') setShow(false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="push-nudge" role="dialog" aria-label="Turn on alerts">
      <span className="push-nudge__icon" aria-hidden="true">
        <span className="push-nudge__dot">3</span>
      </span>
      <span className="push-nudge__copy">
        <b>Turn on alerts</b>
        New alerts show as a number on the Deed ERP icon, even when the app is closed.
      </span>
      <span className="push-nudge__actions">
        <button type="button" className="push-nudge__later" onClick={dismiss} disabled={busy}>Not now</button>
        <button type="button" className="push-nudge__on" onClick={() => void turnOn()} disabled={busy}>{busy ? 'Turning on…' : 'Turn on'}</button>
      </span>
    </div>
  )
}
