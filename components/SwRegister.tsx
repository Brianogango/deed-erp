'use client'
import { useEffect } from 'react'

export default function SwRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(err => console.warn('[SW] registration failed:', err))
  }, [])
  return null
}
