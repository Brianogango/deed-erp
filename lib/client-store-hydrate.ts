'use client'

import { persistClientStoreValue } from '@/lib/client-store-cache'
import { rememberServerBaseline } from '@/lib/store-baseline'
import { sameContent } from '@/lib/same-content'
import { claimStoreDownload, holdsStoreCopy, keysNeedingDownload, noteStoreHeld, noteStoreRead, trackStoreDownload } from '@/lib/store-freshness'
import { cacheCollectionsNow, readCachedCollections } from '@/lib/browser-collection-cache'

const ARRAY_STORE_KEYS = /^(deed_repairs_v2|deed_products|deed_invoices|deed_saleOrders|deed_contacts|deed_employees|deed_expenses|deed_purchaseOrders|deed_stockTransfers|deed_serials|deed_accounts|deed_posOrders|deed_deliveries|deed_journalEntries|deed_leaveRequests|deed_opportunities|deed_companies|deed_quotes|deed_holdovers|deed_companyAssets|deed_deposits|deed_buyBacks|deed_warranties|deed_outsourceJobs|deed_outsourceVendors|deed_outsourcePayments|deed_bankAccounts|deed_receipts|deed_customerCredits|deed_workflowApprovals|deed_contracts|deed_customerContracts|deed_employeeAssets|deed_kilimallOrders|deed_payrollRuns)$/

export function readDirtyStoreKeys(): Set<string> {
  try {
    const raw = window.localStorage.getItem('deed_dirty_keys')
    return new Set<string>(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set<string>()
  }
}

/** This browser's stored copy of `key` holds the same data as `serialized`. */
function localCopyMatches(key: string, serialized: string): boolean {
  try {
    const local = window.localStorage.getItem(key)
    if (local === null) return false
    if (local === serialized) return true
    if (Math.abs(local.length - serialized.length) > 64) return false
    return sameContent(JSON.parse(local), JSON.parse(serialized))
  } catch {
    return false
  }
}

function clearDirtyStoreKey(key: string) {
  try {
    const dirty = readDirtyStoreKeys()
    if (!dirty.delete(key)) return
    window.localStorage.setItem('deed_dirty_keys', JSON.stringify([...dirty]))
  } catch { /* the next save clears it */ }
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
): Record<string, string> {
  /** Server copies taken into the store, serialized — what may be cached as-is. */
  const applied: Record<string, string> = {}
  if (!state) return applied
  // Always re-read dirty keys at apply time. The loading gate can release
  // after the critical GET, so the user may edit a deferred collection while
  // that second fetch is still in flight.
  const skip = new Set(dirtyKeys)
  for (const key of readDirtyStoreKeys()) skip.add(key)
  for (const [key, value] of Object.entries(state)) {
    if (!key.startsWith('deed_')) continue
    let serialized: string
    try {
      serialized = typeof value === 'string' ? value : JSON.stringify(value)
    } catch {
      continue
    }
    if (skip.has(key) && localCopyMatches(key, serialized)) {
      // Marked as edited, but this browser's copy holds exactly the server's
      // data: nothing is waiting to be saved. Left marked, the key would never
      // take server updates (or be cached) again.
      clearDirtyStoreKey(key)
      skip.delete(key)
    }
    if (skip.has(key)) {
      // Local edits win on screen, but this is still the server's copy: the
      // pending save is diffed against it (only the changed rows go up), not
      // sent whole.
      rememberServerBaseline(key, serialized)
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
    rememberServerBaseline(key, serialized)
    applied[key] = serialized
    try {
      if (window.localStorage.getItem(key) === serialized) continue
      persistClientStoreValue(key, serialized)
    } catch {
      continue
    }
    window.dispatchEvent(new CustomEvent('deed_remote_update', { detail: { key, value: serialized } }))
  }
  return applied
}

/**
 * Show this browser's cached copies (IndexedDB) of keys localStorage does not
 * hold, before the page asks the server. The request then carries the ETag,
 * so unchanged collections answer 304 instead of downloading again. Cached
 * copies may include unsaved edits, so they never become the save baseline.
 */
export async function preloadCachedCollections(keys: string[]): Promise<void> {
  if (typeof window === 'undefined' || keys.length === 0) return
  const missing = keys.filter(key => {
    if (holdsStoreCopy([key])) return false
    try { return window.localStorage.getItem(key) === null } catch { return true }
  })
  if (!missing.length) return
  const cached = await readCachedCollections(missing)
  const loaded = Object.keys(cached)
  for (const key of loaded) {
    window.dispatchEvent(new CustomEvent('deed_remote_update', { detail: { key, value: cached[key], fromCache: true } }))
  }
  noteStoreHeld(loaded)
}

export async function fetchAndApplyStoreKeys(opts: {
  keys: string[]
  /** Legacy: whole-set ETag slot. Per-key versions (below) replaced it. */
  etagStorageKey: string
  signal?: AbortSignal
}): Promise<'applied' | 'not-modified' | 'error'> {
  const { etagStorageKey, signal } = opts
  if (opts.keys.length === 0) return 'not-modified'

  // Another part of the page may already be downloading some of these: take
  // the rest (claimed in this same tick), and wait for theirs alongside.
  const { mine: keys, others } = claimStoreDownload(opts.keys)
  // A download we waited on can be cancelled (its page was left mid-load):
  // fetch whatever it did not deliver ourselves.
  const delegated = opts.keys.filter(key => !keys.includes(key))
  const settleOthers = async () => {
    await others
    if (signal?.aborted) return
    const missed = keysNeedingDownload(delegated)
    if (missed.length) await fetchAndApplyStoreKeys({ keys: missed, etagStorageKey, signal })
  }
  if (keys.length === 0) {
    await settleOthers()
    return 'not-modified'
  }

  // Tell the server which versions this browser holds; it sends only the
  // collections that changed since. A version is only claimed for a copy we
  // actually have (localStorage, IndexedDB-loaded, or downloaded this session).
  const versions = readKeyVersions()
  const have: Record<string, string> = {}
  for (const key of keys) {
    if (versions[key] && (keysAreCached([key]) || holdsStoreCopy([key]))) have[key] = versions[key]
  }

  const download = (async () => {
    const res = await fetch(`/api/store?keys=${encodeURIComponent(keys.join(','))}`, {
      signal,
      headers: { 'x-store-have': JSON.stringify(have) },
    })
    if (!res.ok) return 'error' as const
    const state = await res.json() as Record<string, unknown>
    const applied = applyHydratedStoreState(state)
    noteStoreRead(keys, res.headers.get('x-store-read-at'))
    const serverVersions = (state.versions && typeof state.versions === 'object' ? state.versions : {}) as Record<string, string>
    const unchanged = Array.isArray(state.unchanged) ? (state.unchanged as string[]) : []
    // A version claims "this browser holds that copy": record it only once
    // the data is stored, so a reload can never pair it with an older copy.
    const stored = await cacheCollectionsNow(applied)
    const nextVersions: Record<string, string> = {}
    for (const key of Object.keys(applied)) {
      if (serverVersions[key] && (stored || keysAreCached([key]))) nextVersions[key] = serverVersions[key]
    }
    writeKeyVersions(nextVersions, keys.filter(key => !unchanged.includes(key) && !(key in nextVersions)))
    return unchanged.length === keys.length ? 'not-modified' as const : 'applied' as const
  })()
  const result = await trackStoreDownload(keys, download)
  await settleOthers()
  return result
}

const KEY_VERSIONS_LS = 'deed_store_key_versions'

function readKeyVersions(): Record<string, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY_VERSIONS_LS) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** Set versions for copies just stored; drop versions for keys we no longer hold as the server has them. */
function writeKeyVersions(set: Record<string, string>, drop: string[]) {
  if (!Object.keys(set).length && !drop.length) return
  const next = { ...readKeyVersions(), ...set }
  for (const key of drop) delete next[key]
  try { window.localStorage.setItem(KEY_VERSIONS_LS, JSON.stringify(next)) } catch { /* optional */ }
}
