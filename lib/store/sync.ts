import { useState, useEffect, useRef } from 'react'
import { hasSaleOrderDraftEdits } from '@/lib/sale-order-draft-edits'
import { isPrismaRestSotStoreKey } from '@/lib/domain-source-of-truth'
import { isKnownClientAppStateKey } from '@/lib/app-state-hydration'
import { forgetServerBaseline, rememberServerBaseline, serverBaselineFor, deltaDisabledFor, patchServerBaseline } from '@/lib/store-baseline'
import { deniedSaveMessage } from '@/lib/store-denied-message'
import { computeCollectionDelta, upsertOnlyDelta, type CollectionDelta } from '@/lib/store-delta'
import { nextSyncRetryMs } from '@/lib/store-sync-retry'
import { parseStoredState } from '@/lib/safe-local-state'
import { persistClientStoreValue } from '@/lib/client-store-cache'
import { reportingFetch } from '@/lib/save-failure'

/** Browser cache and server sync for store keys: dirty-key tracking, debounced flush, retries and the useLS hook. */

// ─── Server sync (debounced, 500ms) ──────────────────────────────────────────
export const _pendingSync: Record<string, string> = {}

export let _syncTimer: ReturnType<typeof setTimeout> | null = null

export let _syncRetryTimer: ReturnType<typeof setTimeout> | null = null

export let _syncRetryDelayMs = 500

export let _flushInFlight = false

export const _inFlightSyncKeys = new Set<string>()

export let _syncInstalled = false

export let _serverHydrated = false

export const isServerHydrated = () => _serverHydrated

export const markServerHydrated = () => { _serverHydrated = true }

export const SYNC_STATUS_EVENT = 'deed_sync_status'

export const LAST_SYNC_AT_LS = 'deed_last_synced_at'

// ── Dirty key tracking ────────────────────────────────────────────────────────
// Persisted in localStorage so a page-reload still knows which keys need to be
// pushed to the server before accepting remote state — even after _pendingSync
// was cleared from memory (e.g. the tab was closed while offline).
export const DIRTY_KEYS_LS = 'deed_dirty_keys'

export type SyncStage = 'idle' | 'syncing' | 'synced' | 'error' | 'conflict'

/**
 * True once the store holds real data: warm localStorage cache (instant) or
 * the first server hydration completes. KPI surfaces gate on this so a cold
 * device shows a skeleton instead of flashing zeros while the boot fetch is
 * in flight. A 4s cap guarantees the page never traps on the skeleton.
 *
 * Dashboard imports this hook. Leaving it unexported crashes `/` with
 * "useStoreHydrated is not a function" after the KPI-coherence merge.
 */
export function useStoreHydrated(): boolean {
  const [hydrated, setHydrated] = useState<boolean>(() => {
    if (_serverHydrated) return true
    if (typeof window === 'undefined') return false
    return Boolean(window.localStorage.getItem(LAST_SYNC_AT_LS))
  })
  useEffect(() => {
    if (hydrated) return
    const done = () => setHydrated(true)
    const onStatus = (e: Event) => {
      const stage = (e as CustomEvent).detail?.stage
      if (stage === 'idle' || stage === 'synced' || stage === 'error') done()
    }
    window.addEventListener(SYNC_STATUS_EVENT, onStatus)
    const timeout = window.setTimeout(done, 4000)
    return () => {
      window.removeEventListener(SYNC_STATUS_EVENT, onStatus)
      window.clearTimeout(timeout)
    }
  }, [hydrated])
  return hydrated
}

export function emitSyncStatus(stage: SyncStage, extras?: { skippedKeys?: string[]; deniedKeys?: string[]; message?: string }) {
  if (typeof window === 'undefined') return
  const pendingKeys = Object.keys(_pendingSync).length
  const lastSyncedAt = window.localStorage.getItem(LAST_SYNC_AT_LS) || null
  window.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT, {
    detail: {
      stage,
      pendingKeys,
      lastSyncedAt,
      skippedKeys: extras?.skippedKeys ?? [],
      deniedKeys: extras?.deniedKeys ?? [],
      message: extras?.message ?? '',
      timestamp: new Date().toISOString(),
    },
  }))
}

export function getDirtyKeys(): Set<string> {
  try {
    if (typeof window === 'undefined') return new Set()
    const raw = localStorage.getItem(DIRTY_KEYS_LS)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch { return new Set() }
}

export function addDirtyKey(key: string) {
  try {
    const keys = getDirtyKeys()
    keys.add(key)
    localStorage.setItem(DIRTY_KEYS_LS, JSON.stringify([...keys]))
  } catch {}
}

export function removeDirtyKeys(keys: string[]) {
  try {
    const dirty = getDirtyKeys()
    keys.forEach(k => dirty.delete(k))
    localStorage.setItem(DIRTY_KEYS_LS, JSON.stringify([...dirty]))
  } catch {}
}

/** Latest in-memory deed_saleOrders JSON — prefer over stale localStorage while drafting. */
export let _latestSaleOrdersSnapshot: string | null = null

export function rememberSaleOrdersSnapshot(serialized: string | null | undefined) {
  if (typeof serialized === 'string' && serialized.length > 0) {
    _latestSaleOrdersSnapshot = serialized
  }
}

/** Clear keys from the pending queue after the server confirms receipt. */
export function markKeysSynced(saved: Record<string, string>) {
  // Only remove from _pendingSync once the server has confirmed receipt. If a
  // newer write arrived for the same key while in-flight, leave it queued.
  Object.keys(saved).forEach(k => {
    if (_pendingSync[k] === saved[k]) delete _pendingSync[k]
  })
  removeDirtyKeys(Object.keys(saved))
  // Draft quotation line edits stay dirty until Save. Prefer the in-memory
  // snapshot — localStorage can still hold a pre-edit blob after a large write.
  if (hasSaleOrderDraftEdits()) {
    addDirtyKey('deed_saleOrders')
    try {
      const snap = _latestSaleOrdersSnapshot
        ?? (typeof window !== 'undefined' ? window.localStorage.getItem('deed_saleOrders') : null)
      if (snap) _pendingSync['deed_saleOrders'] = snap
    } catch { /* ignore */ }
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LAST_SYNC_AT_LS, new Date().toISOString())
  }
}

export function canQueueStoreSync(key: string) {
  // Keep this list aligned with CLIENT_IMMUTABLE_STORE_KEYS in authorization.ts.
  // Do not import that module here — it is server-only and breaks the client bundle.
  if (key === 'deed_auditLogs' || key === 'deed_audit_timeline_v1') return false
  // Prisma REST owns these writes; posting a blob shape here drifted SoT.
  if (isPrismaRestSotStoreKey(key)) return false
  return isKnownClientAppStateKey(key)
}

export function dropUnsyncablePendingKeys(entries: Record<string, string>) {
  const dropped = Object.keys(entries).filter(key => !canQueueStoreSync(key))
  if (dropped.length === 0) return entries
  dropped.forEach(key => { if (_pendingSync[key] === entries[key]) delete _pendingSync[key] })
  removeDirtyKeys(dropped)
  const kept: Record<string, string> = {}
  Object.keys(entries).forEach(key => {
    if (canQueueStoreSync(key)) kept[key] = entries[key]
  })
  return kept
}

/**
 * Fallback when the server rejects a multi-key batch wholesale (e.g. a 409
 * optimistic-concurrency conflict, or a single malformed/append-only key).
 * Retrying the same batch forever lets one poisoned key block every co-bundled
 * key — exactly how a stale journal ledger once stranded POS orders and
 * invoices. Reissue each key on its own so healthy keys still flush and only
 * the genuinely failing key stays queued for the next retry.
 */
export async function flushKeysIndividually(entries: Record<string, string>) {
  const failedKeys: string[] = []
  const refusedKeys: string[] = []
  await Promise.all(Object.keys(entries).map(async key => {
    try {
      const { body: oneBody, deltaKeys: oneDelta } = buildSyncBody({ [key]: entries[key] })
      const res = await fetch('/api/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(oneBody),
      })
      if (!res.ok && oneDelta.length) forgetServerBaseline(oneDelta)
      if (res.status === 401) {
        if (typeof window !== 'undefined') window.location.href = '/login'
        return
      }
      // 2xx = saved; 400/403 = this key can never succeed for this payload or
      // session. Leave the retry queue so one unknown/immutable key cannot
      // keep splitting every later flush into a parallel POST storm.
      if (res.ok) rememberServerBaseline(key, entries[key])
      if (res.ok || res.status === 403 || res.status === 400) {
        if (res.status === 403) refusedKeys.push(key)
        markKeysSynced({ [key]: entries[key] })
      } else {
        failedKeys.push(key)
      }
    } catch {
      failedKeys.push(key)
    }
  }))
  if (refusedKeys.length > 0) {
    emitSyncStatus('error', { deniedKeys: refusedKeys, message: deniedSaveMessage(refusedKeys) ?? '' })
  } else if (failedKeys.length > 0) {
    emitSyncStatus('error', {
      message: `Some changes could not be saved yet: ${failedKeys.join(', ')}. Retrying automatically.`,
    })
  } else {
    emitSyncStatus('synced')
  }
}

// Changed-records-only saves (lib/store-delta.ts, lib/store-baseline.ts).
// A collection is never sent whole when it can be helped: the server deletes
// every record a whole list leaves out, so a tab that loaded before someone
// else added a record would delete it. Known to this tab → its own adds,
// edits and removals only; nothing known yet → add-or-update only.
export function buildSyncBody(entries: Record<string, string>): { body: Record<string, unknown>; deltaKeys: string[] } {
  const body: Record<string, unknown> = {}
  const delta: Record<string, CollectionDelta> = {}
  for (const [key, value] of Object.entries(entries)) {
    const baseline = serverBaselineFor(key)
    const d = baseline
      ? computeCollectionDelta(baseline, value)
      : (deltaDisabledFor(key) ? null : upsertOnlyDelta(value))
    if (d) delta[key] = d
    else body[key] = value
  }
  const deltaKeys = Object.keys(delta)
  if (deltaKeys.length) body._delta = delta
  return { body, deltaKeys }
}

export async function flushServerSync() {
  if (_flushInFlight) return
  if (Object.keys(_pendingSync).length === 0) return
  const entries = dropUnsyncablePendingKeys({ ..._pendingSync })
  if (Object.keys(entries).length === 0) {
    emitSyncStatus('synced')
    return
  }
  emitSyncStatus('syncing')
  _flushInFlight = true
  Object.keys(entries).forEach(k => _inFlightSyncKeys.add(k))
  // Do NOT clear _pendingSync before the fetch resolves — keeping entries here
  // blocks applyRemoteState from overwriting local changes with a stale SSE push
  // that arrives during the in-flight window. Other keys not in this batch still
  // merge from SSE.
  const scheduleRetry = () => {
    if (_syncRetryTimer) clearTimeout(_syncRetryTimer)
    _syncRetryDelayMs = nextSyncRetryMs(_syncRetryDelayMs)
    _syncRetryTimer = setTimeout(() => { void flushServerSync() }, _syncRetryDelayMs)
  }
  const clearInFlight = () => {
    Object.keys(entries).forEach(k => _inFlightSyncKeys.delete(k))
    _flushInFlight = false
  }
  try {
    const { body: syncBody, deltaKeys } = buildSyncBody(entries)
    const res = await fetch('/api/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(syncBody),
    })
    // Any refusal of a changed-records save: send those keys whole from now on.
    if (!res.ok && deltaKeys.length) forgetServerBaseline(deltaKeys)
    if (res.status === 401) {
      // Session expired — redirect to login so user can re-authenticate and data re-syncs on next mount
      if (typeof window !== 'undefined') window.location.href = '/login'
      return
    }
    if (res.status === 403) {
      // Every key in the batch was permission-denied. Drop them from the retry
      // queue — retrying can never succeed for this session and a stuck queue
      // blocks later legitimate writes from flushing.
      const payload = await res.json().catch(() => null) as { deniedKeys?: string[] } | null
      const denied = payload?.deniedKeys ?? Object.keys(entries)
      denied.forEach(k => { if (_pendingSync[k] === entries[k]) delete _pendingSync[k] })
      removeDirtyKeys(denied)
      emitSyncStatus('error', { deniedKeys: denied, message: deniedSaveMessage(denied) ?? '' })
      return
    }
    if (!res.ok) {
      // The server responded but rejected the whole batch (e.g. a 409
      // optimistic-concurrency conflict or one malformed key). Isolate the
      // failure so a single key cannot hold every co-bundled key hostage.
      if (Object.keys(entries).length > 1) {
        await flushKeysIndividually(entries)
        return
      }
      throw new Error(`Sync failed: ${res.status}`)
    }
    const payload = await res.json().catch(() => null) as { skippedKeys?: string[]; deniedKeys?: string[] } | null
    markKeysSynced(entries)
    Object.entries(entries).forEach(([k, v]) => rememberServerBaseline(k, v))
    _syncRetryDelayMs = 500
    if (_syncRetryTimer) {
      clearTimeout(_syncRetryTimer)
      _syncRetryTimer = null
    }
    // The server saves what the role may write and drops the rest, so a mixed
    // batch still answers 200. Reporting that as "synced" is how refused
    // changes used to vanish without anyone knowing.
    const deniedKeys = payload?.deniedKeys ?? []
    if (deniedKeys.length > 0) {
      emitSyncStatus('error', { deniedKeys, message: deniedSaveMessage(deniedKeys) ?? '' })
      return
    }
    const skippedKeys = payload?.skippedKeys ?? []
    if (skippedKeys.length > 0) {
      emitSyncStatus('conflict', {
        skippedKeys,
        message: 'Server rejected stale local data for protected keys.',
      })
      return
    }
    emitSyncStatus('synced')
    if (Object.keys(_pendingSync).length > 0) {
      _syncRetryTimer = setTimeout(() => { void flushServerSync() }, 0)
    }
  } catch {
    // offline or failed — entries remain in _pendingSync; retry with backoff
    emitSyncStatus('error', { message: 'Unable to sync pending changes. Retry will happen automatically.' })
    scheduleRetry()
  } finally {
    clearInFlight()
  }
}

export function debouncedServerSync(key: string, value: string) {
  if (!canQueueStoreSync(key)) {
    delete _pendingSync[key]
    removeDirtyKeys([key])
    return
  }
  _pendingSync[key] = value
  addDirtyKey(key)
  emitSyncStatus('syncing')
  _syncRetryDelayMs = 500
  if (_syncRetryTimer) {
    clearTimeout(_syncRetryTimer)
    _syncRetryTimer = null
  }
  if (_syncTimer) clearTimeout(_syncTimer)
  _syncTimer = setTimeout(flushServerSync, 500)

  // Register beforeunload once so data always syncs when the user closes/navigates away
  if (typeof window !== 'undefined' && !_syncInstalled) {
    _syncInstalled = true
    window.addEventListener('beforeunload', () => {
      if (Object.keys(_pendingSync).length === 0) return
      const entries = { ..._pendingSync }
      const body = JSON.stringify(buildSyncBody(entries).body)
      // sendBeacon is fire-and-forget and survives page unload
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' })
        navigator.sendBeacon('/api/store', blob)
      } else {
        sync('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
      }
    })
  }
}

// ─── Persistence helper ───────────────────────────────────────────────────────
// ─── Profile image compression (max 200×200px, ~80 KB) ───────────────────────
export function compressProfileImage(dataUrl: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const MAX = 200
      const ratio = Math.min(MAX / img.width, MAX / img.height, 1)
      const w = Math.round(img.width * ratio)
      const h = Math.round(img.height * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      // Compress until under 80 KB
      let q = 0.82
      let result = canvas.toDataURL('image/jpeg', q)
      while (result.length > 80 * 1024 && q > 0.2) {
        q = Math.round((q - 0.1) * 10) / 10
        result = canvas.toDataURL('image/jpeg', q)
      }
      resolve(result)
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

// ─── Fetch freshness helpers (5-minute stale cache) ─────────────────────────
export const FETCH_STALE_MS = 5 * 60 * 1000

export function isFresh(key: string): boolean {
  try {
    const ts = localStorage.getItem(`${key}__ts`)
    return !!ts && Date.now() - Number(ts) < FETCH_STALE_MS
  } catch { return false }
}

export function stampCache(key: string) {
  try { localStorage.setItem(`${key}__ts`, String(Date.now())) } catch {}
}

/**
 * Persists state to localStorage under the given key.
 * Falls back to `seed` on first load or if storage is unavailable.
 * Also syncs changes back to the server via a debounced POST.
 *
 * Array seeds reject non-array stored JSON (common corruption that used to
 * crash the authenticated shell with a blank white page after login).
 */
/**
 * How many audit entries the session keeps in memory. The durable record is
 * written server-side by /api/audit/commercial; this is only a live mirror.
 */
export const SESSION_AUDIT_LOG_LIMIT = 200

/**
 * Keys the browser must not keep. deed_auditLogs was persisted by every client
 * until it filled the quota; existing browsers still carry that copy, so it is
 * evicted once on boot rather than waiting for a cache clear.
 */
export const RETIRED_LOCAL_KEYS = ['deed_auditLogs']

export function evictRetiredLocalKeys() {
  if (typeof window === 'undefined') return
  for (const key of RETIRED_LOCAL_KEYS) {
    try {
      if (window.localStorage.getItem(key) !== null) {
        window.localStorage.removeItem(key)
      }
    } catch { /* private mode / blocked storage — nothing to reclaim */ }
  }
}

export function useLS<T>(
  key: string,
  seed: T,
  opts?: { mergeRemote?: (local: T, remote: T) => T },
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return seed
    try {
      const stored = window.localStorage.getItem(key)
      const { value, corrupted } = parseStoredState(stored, seed)
      if (corrupted) {
        try { window.localStorage.removeItem(key) } catch { /* ignore */ }
      }
      return value
    } catch {
      return seed
    }
  })

  const isFirstRender = useRef(true)
  const skipNextSync = useRef(false)
  const mergeRemoteRef = useRef(opts?.mergeRemote)
  mergeRemoteRef.current = opts?.mergeRemote

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (skipNextSync.current) {
      skipNextSync.current = false
      return
    }
    let serialized: string | undefined
    try { serialized = JSON.stringify(state) } catch { return }
    // Skip localStorage for large values — avoids quota errors and slow reads/writes.
    // The server (app_state) and SSE still keep this data in sync across devices.
    persistClientStoreValue(key, serialized)
    // Exactly what the server already holds (e.g. a re-merge that changed
    // nothing): no save. Uploading it anyway sent the whole product list on
    // every page load and made every other open session download it again.
    // (Not while a save of this key is in flight: that save may hold an edit
    // this value undoes.) An edit undone before its save went out is dropped.
    if (serialized === serverBaselineFor(key) && !_inFlightSyncKeys.has(key)) {
      delete _pendingSync[key]
      removeDirtyKeys([key])
      return
    }
    debouncedServerSync(key, serialized)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const seedRef = useRef(seed)
  seedRef.current = seed

  // Listen for cross-device updates (from our polling) or cross-tab updates
  useEffect(() => {
    const handleUpdate = (newValue: string, fromCache = false) => {
      const { value, corrupted } = parseStoredState(newValue, seedRef.current)
      if (corrupted) {
        try { window.localStorage.removeItem(key) } catch { /* ignore */ }
        return
      }
      // A browser-cache copy may hold unsaved edits: never a save baseline.
      if (!fromCache) rememberServerBaseline(key, newValue)
      skipNextSync.current = true
      setState(prev => {
        const merge = mergeRemoteRef.current
        return merge ? merge(prev, value) : value
      })
    }
    const handleStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) handleUpdate(e.newValue)
    }
    const handleCustom = (e: CustomEvent) => {
      if (e.detail?.key === key && e.detail?.value) handleUpdate(e.detail.value, e.detail.fromCache === true)
    }

    // A full record replacing its slimmed list row (lib/full-record.ts):
    // the server already has it, so this is not an edit to save.
    const handlePatchRows = (e: CustomEvent) => {
      if (e.detail?.key !== key || !Array.isArray(e.detail?.rows)) return
      const rows = e.detail.rows as Array<{ id?: unknown }>
      const byId = new Map(rows.map(row => [String(row.id), row]))
      patchServerBaseline(key, rows)
      skipNextSync.current = true
      setState(prev => (Array.isArray(prev)
        ? (prev as unknown[]).map(row => byId.get(String((row as { id?: unknown })?.id)) ?? row) as unknown as T
        : prev))
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener('deed_remote_update', handleCustom as EventListener)
    window.addEventListener('deed_patch_rows', handlePatchRows as EventListener)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('deed_remote_update', handleCustom as EventListener)
      window.removeEventListener('deed_patch_rows', handlePatchRows as EventListener)
    }
  }, [key])

  return [state, setState]
}

// Fire-and-forget server sync — swallows network errors so local state is never blocked
// Background writes: a refusal is reported to the person (lib/save-failure.ts)
// instead of being discarded — it used to look exactly like success.
export const sync = (url: string, opts: RequestInit) => reportingFetch(url, opts)
