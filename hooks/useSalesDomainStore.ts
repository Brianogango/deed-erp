/**
 * Sales domain store (phase 2).
 *
 * Prisma APIs are authoritative for sale orders / invoices.
 * This Zustand slice tracks sync + exposes API-first helpers while the
 * monolith Context store still owns UI state and keeps deed_* dual-write.
 * NEVER drop app_state keys from here.
 */
'use client'

import { create } from 'zustand'

type SalesDomainState = {
  lastSyncedAt: string | null
  lastError: string | null
  syncing: boolean
  markSynced: () => void
  refreshSaleOrders: () => Promise<any[]>
  confirmSaleOrder: (id: string, patch?: Record<string, unknown>) => Promise<any>
  cancelSaleOrder: (id: string) => Promise<any>
}

async function readJson(res: Response) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}

export const useSalesDomainStore = create<SalesDomainState>((set) => ({
  lastSyncedAt: null,
  lastError: null,
  syncing: false,
  markSynced: () => set({ lastSyncedAt: new Date().toISOString(), lastError: null }),
  refreshSaleOrders: async () => {
    set({ syncing: true, lastError: null })
    try {
      const res = await fetch('/api/sale-orders')
      const data = await readJson(res)
      const rows = Array.isArray(data) ? data : (data.items || data.orders || [])
      set({ lastSyncedAt: new Date().toISOString(), syncing: false })
      return rows
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh sale orders'
      set({ lastError: message, syncing: false })
      throw err
    }
  },
  confirmSaleOrder: async (id, patch = {}) => {
    set({ syncing: true, lastError: null })
    try {
      const res = await fetch(`/api/sale-orders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'sale', ...patch }),
      })
      const data = await readJson(res)
      set({ lastSyncedAt: new Date().toISOString(), syncing: false })
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Confirm failed'
      set({ lastError: message, syncing: false })
      throw err
    }
  },
  cancelSaleOrder: async (id) => {
    set({ syncing: true, lastError: null })
    try {
      const res = await fetch(`/api/sale-orders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      const data = await readJson(res)
      set({ lastSyncedAt: new Date().toISOString(), syncing: false })
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cancel failed'
      set({ lastError: message, syncing: false })
      throw err
    }
  },
}))

/** Hint for future extraction — keys that must keep dual-writing to app_state. */
export const SALES_BLOB_KEYS = [
  'deed_saleOrders',
  'deed_quotes',
  'deed_invoices',
  'deed_payments',
  'deed_deliveries',
  'deed_stockReservations',
  'deed_approvalRequests',
] as const
