'use client'

import { useEffect, useState } from 'react'
import type { SaleOrder } from '@/lib/store'

/**
 * Sale orders for the dashboard and its sales widgets, from
 * /api/dashboard/sale-orders (only the fields they read). One download is
 * shared by every widget on the page; refreshed every minute and when the
 * tab comes back.
 */
let cache: SaleOrder[] | null = null
let inFlight: Promise<void> | null = null
let lastLoad = 0
const listeners = new Set<(rows: SaleOrder[]) => void>()

function load(force = false): Promise<void> {
  if (inFlight) return inFlight
  if (!force && cache && Date.now() - lastLoad < 15_000) return Promise.resolve()
  inFlight = fetch('/api/dashboard/sale-orders', { cache: 'no-store' })
    .then(res => (res.ok ? res.json() : null))
    .then(data => {
      if (!data || !Array.isArray(data.saleOrders)) return
      cache = data.saleOrders as SaleOrder[]
      lastLoad = Date.now()
      for (const listener of listeners) listener(cache)
    })
    .catch(() => { /* keeps the last rows */ })
    .finally(() => { inFlight = null })
  return inFlight
}

const EMPTY: SaleOrder[] = []

export function useDashboardSaleOrders(): SaleOrder[] {
  const [rows, setRows] = useState<SaleOrder[]>(cache ?? EMPTY)
  useEffect(() => {
    listeners.add(setRows)
    if (cache) setRows(cache)
    void load()
    const refresh = () => { if (document.visibilityState !== 'hidden') void load(true) }
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      listeners.delete(setRows)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return rows
}
