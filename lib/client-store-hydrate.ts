'use client'

import { persistClientStoreValue } from '@/lib/client-store-cache'

const ARRAY_STORE_KEYS = /^(deed_repairs_v2|deed_products|deed_invoices|deed_saleOrders|deed_contacts|deed_employees|deed_expenses|deed_purchaseOrders|deed_stockTransfers|deed_serials|deed_accounts|deed_posOrders|deed_deliveries|deed_journalEntries|deed_leaveRequests|deed_opportunities|deed_companies|deed_quotes|deed_holdovers|deed_companyAssets|deed_deposits|deed_buyBacks|deed_warranties|deed_outsourceJobs|deed_outsourceVendors|deed_outsourcePayments|deed_bankAccounts|deed_receipts|deed_customerCredits|deed_workflowApprovals|deed_contracts|deed_customerContracts|deed_employeeAssets|deed_kilimallOrders|deed_payrollRuns)$/

export function readDirtyStoreKeys(): Set<string> {
  try {
    const raw = window.localStorage.getItem('deed_dirty_keys')
    return new Set<string>(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set<string>()
  }
}

export function keysAreCached(keys: string[]): boolean {
  if (keys.length === 0) return true
  try {
    return keys.every(key => window.localStorage.getItem(key) !== null)
  } catch {
    return false
  }
}

/** Apply a GET /api/store payload into localStorage and notify the client store. */
export function applyHydratedStoreState(
  state: Record<string, unknown> | null | undefined,
  dirtyKeys?: Set<string>,
): void {
  if (!state) return
  // Always re-read dirty keys at apply time. The loading gate can release
  // after the critical GET, so the user may edit a deferred collection while
  // that second fetch is still in flight.
  const skip = new Set(dirtyKeys)
  for (const key of readDirtyStoreKeys()) skip.add(key)
  for (const [key, value] of Object.entries(state)) {
    if (!key.startsWith('deed_') || skip.has(key)) continue
    let serialized: string
    try {
      serialized = typeof value === 'string' ? value : JSON.stringify(value)
    } catch {
      continue
    }
    if (ARRAY_STORE_KEYS.test(key)) {
      try {
        const parsed = typeof value === 'string' ? JSON.parse(serialized) : value
        if (!Array.isArray(parsed)) continue
        // Never replace a populated cache with an empty GET — that is the KPI
        // 0-flash across navigations when a page of the collection 404s or
        // returns `{ items: [] }` before the real page lands.
        if (parsed.length === 0) {
          const existing = window.localStorage.getItem(key)
          if (existing) {
            try {
              const localParsed = JSON.parse(existing)
              if (Array.isArray(localParsed) && localParsed.length > 0) continue
            } catch {
              /* existing blob unreadable — allow empty */
            }
          }
        }
      } catch {
        continue
      }
    }
    try {
      if (window.localStorage.getItem(key) === serialized) continue
      persistClientStoreValue(key, serialized)
    } catch {
      continue
    }
    window.dispatchEvent(new CustomEvent('deed_remote_update', { detail: { key, value: serialized } }))
  }
}

export async function fetchAndApplyStoreKeys(opts: {
  keys: string[]
  etagStorageKey: string
  signal?: AbortSignal
}): Promise<'applied' | 'not-modified' | 'error'> {
  const { keys, etagStorageKey, signal } = opts
  if (keys.length === 0) return 'not-modified'

  const storedEtag = (() => {
    try { return window.localStorage.getItem(etagStorageKey) } catch { return null }
  })()
  const cached = keysAreCached(keys)

  const res = await fetch(`/api/store?keys=${encodeURIComponent(keys.join(','))}`, {
    signal,
    headers: storedEtag && cached ? { 'If-None-Match': storedEtag } : undefined,
  })
  if (res.status === 304) return 'not-modified'
  if (!res.ok) return 'error'
  const etag = res.headers.get('etag')
  try {
    if (etag) window.localStorage.setItem(etagStorageKey, etag)
  } catch { /* storage full — conditional fetch just won't apply next time */ }
  const state = await res.json() as Record<string, unknown>
  applyHydratedStoreState(state)
  return 'applied'
}
