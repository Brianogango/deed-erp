/**
 * Inventory domain store (phase 1 facade).
 *
 * Products/catalog are already Prisma-authoritative via /api/products.
 * This seam documents blob keys that must keep dual-writing and provides
 * API-first helpers for catalog refresh. Full extraction comes after
 * products + movements are proven — never big-bang the 8-store split.
 */
'use client'

import { create } from 'zustand'

type InventoryDomainState = {
  lastSyncedAt: string | null
  lastError: string | null
  syncing: boolean
  markSynced: () => void
  refreshProducts: () => Promise<any[]>
}

async function readJson(res: Response) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}

export const useInventoryDomainStore = create<InventoryDomainState>((set) => ({
  lastSyncedAt: null,
  lastError: null,
  syncing: false,
  markSynced: () => set({ lastSyncedAt: new Date().toISOString(), lastError: null }),
  refreshProducts: async () => {
    set({ syncing: true, lastError: null })
    try {
      const res = await fetch('/api/products')
      const data = await readJson(res)
      const rows = Array.isArray(data) ? data : (data.items || data.products || [])
      set({ lastSyncedAt: new Date().toISOString(), syncing: false })
      return rows
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh products'
      set({ lastError: message, syncing: false })
      throw err
    }
  },
}))

export const INVENTORY_BLOB_KEYS = [
  'deed_products',
  'deed_productPriceHistory',
  'deed_serials',
  'deed_bulkStock',
  'deed_stockTransfers',
  'deed_stockAdjustments',
  'deed_stockReservations',
  'deed_openingStockPosted',
  'deed_purchaseOrders',
  'deed_receipts',
  'deed_refurbishmentJobs',
  'deed_warranties',
] as const
