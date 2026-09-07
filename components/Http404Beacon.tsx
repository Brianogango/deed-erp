'use client'

import { useEffect } from 'react'

/** Same-origin page-404 beacon. No body dump, path only. */
export function Http404Beacon() {
  useEffect(() => {
    const path = window.location.pathname.slice(0, 160) || '/unknown'
    void fetch('/api/metrics/http', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, status: 404 }),
      keepalive: true,
    }).catch(() => {})
  }, [])
  return null
}
