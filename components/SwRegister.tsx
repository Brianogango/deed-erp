'use client'
import { useEffect } from 'react'

export default function SwRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(registration => registration.update().catch(() => {}))
      .catch(err => console.warn('[SW] registration failed:', err))

    // When an UPDATED worker takes control (e.g. the v3 worker replacing the
    // v2 one that served stale pre-cached HTML), reload once so this tab
    // picks up fresh HTML whose fingerprinted assets actually exist.
    // hadController distinguishes an upgrade from the very first install,
    // where clients.claim() also fires controllerchange but no reload is needed.
    const hadController = !!navigator.serviceWorker.controller
    let refreshed = false
    const onControllerChange = () => {
      if (refreshed || !hadController) return
      refreshed = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
  }, [])
  return null
}
