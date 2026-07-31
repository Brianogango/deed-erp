/**
 * Sales domain store (phase 1 facade).
 *
 * Prisma is already the write path for sale orders / invoices via `/api/sale-orders`
 * and `/api/invoices`. This Zustand slice is the migration seam for eventually
 * moving client sales state out of the monolith `lib/store.tsx` — WITHOUT dropping
 * app_state dual-write (`debouncedServerSync`) until counts are verified.
 *
 * Today it re-exports sales-related helpers and documents the boundary.
 * Mutations still go through the existing Context store / APIs so no data is lost.
 */
'use client'

import { create } from 'zustand'

type SalesDomainState = {
  /** Last time a Prisma-backed sales refresh was requested */
  lastSyncedAt: string | null
  markSynced: () => void
}

export const useSalesDomainStore = create<SalesDomainState>((set) => ({
  lastSyncedAt: null,
  markSynced: () => set({ lastSyncedAt: new Date().toISOString() }),
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
