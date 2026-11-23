import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { User } from './core'
import { safeLocalStorageSet } from '@/lib/client-store-cache'
import {
  evictRetiredLocalKeys, removeDirtyKeys, RETIRED_LOCAL_KEYS, getDirtyKeys, isServerHydrated,
  markServerHydrated, emitSyncStatus, _pendingSync, _inFlightSyncKeys, flushServerSync,
} from './sync'
import { appStateKeysForRoute } from '@/lib/app-state-hydration'
import { mergeDirtyPosOrdersBlob } from '@/lib/pos-orders-merge'
import { hasSaleOrderDraftEdits } from '@/lib/sale-order-draft-edits'
import { noteStoreChanges, awaitRouteHydration, awaitStoreDownloads, keysChangedSinceRead, noteStoreRead, trackStoreDownload } from '@/lib/store-freshness'
import { startVisiblePoll } from '@/lib/visible-poll'
import { STORE_NOTIFY_BACKUP_POLL_MS, parseStoreSseData, STORE_HELLO_GRACE_MS, nextSseRetryMs } from '@/lib/store-sync-retry'
import { mergeAssignableTechniciansIntoUsers } from '@/lib/repair/assignable-technicians'

/**
 * Keeps this tab in step with the server: the boot hydration from `serverState`,
 * the Server-Sent Events stream that replaced three-second polling, its backup
 * poll and reconnect, and the one-minute refresh of the user list.
 *
 * Mount-only, like the effect it was lifted out of: `serverState` is the boot
 * snapshot and `setUsers` is a stable state setter, so neither re-arms it.
 */
export function useRealtimeSync(
  serverState: Record<string, unknown> | undefined,
  setUsers: Dispatch<SetStateAction<User[]>>,
) {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const arrayCount = (serialized: string | null): number | null => {
      if (!serialized) return null
      try {
        const parsed = JSON.parse(serialized)
        return Array.isArray(parsed) ? parsed.length : null
      } catch {
        return null
      }
    }

    const arrayIds = (serialized: string | null): Set<string> | null => {
      if (!serialized) return null
      try {
        const parsed = JSON.parse(serialized)
        if (!Array.isArray(parsed)) return null
        return new Set(
          parsed
            .map((row: { id?: unknown }) => (row?.id != null ? String(row.id) : ''))
            .filter(Boolean),
        )
      } catch {
        return null
      }
    }

    /** Prefer remote rows on id conflict; keep any local-only rows. */
    const mergeArrayById = (localStr: string | null, remoteStr: string): string => {
      let localArr: Array<{ id?: unknown }> = []
      let remoteArr: Array<{ id?: unknown }> = []
      try { localArr = localStr ? JSON.parse(localStr) : [] } catch { localArr = [] }
      try { remoteArr = JSON.parse(remoteStr) } catch { return remoteStr }
      if (!Array.isArray(localArr)) localArr = []
      if (!Array.isArray(remoteArr)) return remoteStr
      const remoteIds = new Set(
        remoteArr.map(row => (row?.id != null ? String(row.id) : '')).filter(Boolean),
      )
      const merged = [
        ...remoteArr.filter(row => row?.id != null),
        ...localArr.filter(row => row?.id != null && !remoteIds.has(String(row.id))),
      ]
      return JSON.stringify(merged)
    }

    const remoteHasMissingIds = (localStr: string | null, remoteStr: string): boolean => {
      const remoteIds = arrayIds(remoteStr)
      if (!remoteIds || remoteIds.size === 0) return false
      const localIds = arrayIds(localStr)
      if (!localIds || localIds.size === 0) return true
      for (const id of remoteIds) {
        if (!localIds.has(id)) return true
      }
      return false
    }

    const CRITICAL_VISIBILITY_KEYS = [
      'deed_repairs_v2',
      'deed_invoices',
      'deed_expenses',
      'deed_outsourceJobs',
      'deed_outsourcePayments',
      'deed_outsourceStatements',
      'deed_outsourceVendors',
    ] as const
    const CRITICAL_VISIBILITY_KEY_SET = new Set<string>(CRITICAL_VISIBILITY_KEYS)

    // Publish a key to the running app. The localStorage write is a cache and
    // is allowed to fail — the event carries the value, so the in-memory store
    // updates either way. Dropping the event when the cache is full is what
    // made a full quota look like "the ERP stopped seeing new records".
    const publishRemoteKey = (key: string, value: string) => {
      safeLocalStorageSet(key, value)
      window.dispatchEvent(new CustomEvent('deed_remote_update', { detail: { key, value } }))
    }

    // Reclaim space from keys the browser no longer keeps, before any
    // hydration writes compete for the same quota.
    evictRetiredLocalKeys()
    removeDirtyKeys(RETIRED_LOCAL_KEYS)

    // Recovery pass: if browser cache is empty OR missing rows the server has
    // (common after creating an outsource job on another tab/device), pull/merge
    // server truth so Jobs lists stay complete.
    const reconcileCriticalVisibilityKeys = async () => {
      // One batched GET instead of 5 sequential /api/store/<key> round-trips.
      try {
        const path = typeof window !== 'undefined' ? (window.location.pathname || '/') : '/'
        // Route hydration already replaces every clean key with the server
        // copy; only keys with unsaved local edits (which hydration skips)
        // need this merge. Fetching all of them duplicated the page's largest
        // downloads on every load.
        const dirty = getDirtyKeys()
        const needed = CRITICAL_VISIBILITY_KEYS.filter(key => appStateKeysForRoute(path).includes(key) && dirty.has(key))
        if (!needed.length) return
        const res = await fetch(`/api/store?keys=${encodeURIComponent(needed.join(','))}`)
        if (!res.ok) return
        const state = await res.json().catch(() => null) as Record<string, unknown> | null
        if (!state || typeof state !== 'object') return
        for (const key of needed) {
          if (!(key in state)) continue
          try {
            const value = state[key]
            const remoteStr = typeof value === 'string' ? value : JSON.stringify(value ?? null)
            const localStr = window.localStorage.getItem(key)
            const localCount = arrayCount(localStr)
            const remoteCount = arrayCount(remoteStr)
            const missingRemoteRows = remoteHasMissingIds(localStr, remoteStr)
            const shouldRecover = typeof remoteCount === 'number' && remoteCount > 0 && (
              localStr === null
              || localCount === 0
              || missingRemoteRows
              || (typeof localCount === 'number' && remoteCount > localCount)
            )
            if (!shouldRecover) continue
            removeDirtyKeys([key])
            const nextStr = (localStr && typeof localCount === 'number' && localCount > 0 && missingRemoteRows)
              ? mergeArrayById(localStr, remoteStr)
              : remoteStr
            publishRemoteKey(key, nextStr)
          } catch {
            // best effort recovery only
          }
        }
      } catch {
        // best effort recovery only
      }
    }
    void reconcileCriticalVisibilityKeys()

    // 1. Hydrate from serverState immediately on mount.
    //    If there are locally-dirty keys (written while offline with the tab closed),
    //    push them to the server first — then let server state apply normally so the
    //    server remains authoritative after the sync completes.
    if (serverState && Object.keys(serverState).length > 0 && !isServerHydrated()) {
      const dirty = getDirtyKeys()

      // Push any writes that were queued while offline and lost from _pendingSync
      // when the tab closed (they're still in localStorage and marked dirty).
      if (dirty.size > 0) {
        const toSync: Record<string, string> = {}
        dirty.forEach(k => {
          const local = window.localStorage.getItem(k)
          if (local !== null) toSync[k] = local
        })
        if (Object.keys(toSync).length > 0) {
          fetch('/api/store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(toSync),
          }).then(r => { if (r.ok) removeDirtyKeys(Object.keys(toSync)) }).catch(() => {})
        }
      }

      // Apply server state — skip keys that have local dirty writes not yet confirmed.
      // This prevents server state from overwriting repairs/records created while offline.
      for (const [k, v] of Object.entries(serverState)) {
        try {
          const remoteStr = typeof v === 'string' ? v : JSON.stringify(v)
          const localStr  = window.localStorage.getItem(k)
          if (dirty.has(k)) {
            if (k === 'deed_posOrders') {
              publishRemoteKey(k, mergeDirtyPosOrdersBlob(localStr, remoteStr))
              continue
            }
            const localCount = arrayCount(localStr)
            const remoteCount = arrayCount(remoteStr)
            const missingRemoteRows = CRITICAL_VISIBILITY_KEY_SET.has(k) && remoteHasMissingIds(localStr, remoteStr)
            const shouldRecoverFromStaleEmpty = localCount === 0
              && typeof remoteCount === 'number'
              && remoteCount > 0
              && !(k === 'deed_saleOrders' && hasSaleOrderDraftEdits())
            if (!shouldRecoverFromStaleEmpty && !missingRemoteRows) continue // local unsynced write — server state is stale for this key
            // Recover from stale-empty / incomplete local cache and clear dirty flag.
            removeDirtyKeys([k])
            if (missingRemoteRows && localStr && typeof localCount === 'number' && localCount > 0) {
              publishRemoteKey(k, mergeArrayById(localStr, remoteStr))
              continue
            }
          }
          if (localStr !== remoteStr) {
            publishRemoteKey(k, remoteStr)
          }
        } catch (err) { console.warn(`[store] could not hydrate key ${k}`, err) }
      }
      markServerHydrated()
      emitSyncStatus('idle')
    }

    const applyRemoteState = (remoteState: Record<string, unknown>) => {
      const pendingKeys = new Set(Object.keys(_pendingSync))
      const dirtyKeys   = getDirtyKeys()
      for (const [k, v] of Object.entries(remoteState)) {
        if (!k.startsWith('deed_')) continue
        // Per-key isolation. This loop had no try/catch at all, so one failing
        // key — a quota throw on the largest blob, most often — aborted the
        // whole pass, skipped every remaining key, and escaped into the SSE
        // listener, which killed live updates for the rest of the session.
        try {
        // Skip THIS key when it has an unconfirmed local write — other keys in
        // the same SSE payload still apply. One pending key must not freeze the store.
        const remoteStr = typeof v === 'string' ? v : JSON.stringify(v)
        const local = window.localStorage.getItem(k)
        if (pendingKeys.has(k) || dirtyKeys.has(k) || _inFlightSyncKeys.has(k)) {
          if (k === 'deed_posOrders') {
            publishRemoteKey(k, mergeDirtyPosOrdersBlob(local, remoteStr))
            continue
          }
          const localCount = arrayCount(local)
          const remoteCount = arrayCount(remoteStr)
          const missingRemoteRows = CRITICAL_VISIBILITY_KEY_SET.has(k) && remoteHasMissingIds(local, remoteStr)
          // Draft quote line edits may omit localStorage when the blob is large
          // (>512KB). Never treat that as "stale empty" or SSE restores deleted lines.
          const shouldRecoverFromStaleEmpty = localCount === 0
            && typeof remoteCount === 'number'
            && remoteCount > 0
            && !(k === 'deed_saleOrders' && hasSaleOrderDraftEdits())
          if (!shouldRecoverFromStaleEmpty && !missingRemoteRows) continue
          removeDirtyKeys([k])
          if (missingRemoteRows && local && typeof localCount === 'number' && localCount > 0) {
            publishRemoteKey(k, mergeArrayById(local, remoteStr))
            continue
          }
        }
        if (local !== remoteStr) {
          publishRemoteKey(k, remoteStr)
        }
        } catch (err) {
          console.warn(`[store] could not apply remote key ${k}`, err)
        }
      }
    }

    // Conditional requests keep outage recovery cheap, and the in-flight map
    // prevents focus/visibility events from starting duplicate downloads.
    const storeEtags = new Map<string, string>()
    const storeFetchesInFlight = new Map<string, Promise<void>>()
    const fetchStoreKeys = async (keys: string[], changedAt?: Record<string, string>): Promise<void> => {
      let deedKeys = [...new Set(keys.filter(key => key.startsWith('deed_')))].sort()
      if (!deedKeys.length) return
      // A change notice for a copy we downloaded after that change is
      // already satisfied (the stream replays the last minute on connect).
      if (changedAt) {
        noteStoreChanges(changedAt)
        await awaitRouteHydration(deedKeys)
        await awaitStoreDownloads(deedKeys)
        deedKeys = keysChangedSinceRead(deedKeys, changedAt)
        if (!deedKeys.length) return
      }
      const keySet = deedKeys.join(',')
      const existing = storeFetchesInFlight.get(keySet)
      if (existing) return existing

      const request = (async () => {
        try {
          const etag = storeEtags.get(keySet)
          const res = await fetch(`/api/store?keys=${encodeURIComponent(keySet)}`, {
            headers: etag ? { 'If-None-Match': etag } : undefined,
          })
          if (res.status === 304) {
            noteStoreRead(deedKeys, res.headers.get('x-store-read-at'))
            return
          }
          if (!res.ok) return
          const nextEtag = res.headers.get('etag')
          if (nextEtag) storeEtags.set(keySet, nextEtag)
          const payload = await res.json().catch(() => null) as Record<string, unknown> | null
          if (payload && typeof payload === 'object') applyRemoteState(payload)
          noteStoreRead(deedKeys, res.headers.get('x-store-read-at'))
        } catch {
          // best effort — SSE reconnect / backup poll will retry
        }
      })().finally(() => {
        storeFetchesInFlight.delete(keySet)
      })
      storeFetchesInFlight.set(keySet, request)
      return trackStoreDownload(deedKeys, request)
    }

    // 2. SSE stream for real-time store updates — reconnect with backoff so a
    //    dropped socket cannot freeze every key behind one pending EventSource.
    let sseRetryMs = 1000
    let sseTimer: ReturnType<typeof setTimeout> | null = null
    let helloTimer: ReturnType<typeof setTimeout> | null = null
    let source: EventSource | null = null
    let sseClosed = false
    let stopBackupPoll: (() => void) | null = null

    const ensureBackupPoll = (enabled: boolean) => {
      if (enabled) {
        if (stopBackupPoll) return
        stopBackupPoll = startVisiblePoll(
          () => {
            const path = typeof window !== 'undefined' ? (window.location.pathname || '/') : '/'
            const needed = CRITICAL_VISIBILITY_KEYS.filter(key => appStateKeysForRoute(path).includes(key))
            void fetchStoreKeys(needed)
          },
          STORE_NOTIFY_BACKUP_POLL_MS,
        )
        return
      }
      stopBackupPoll?.()
      stopBackupPoll = null
    }

    const connectSse = () => {
      if (sseClosed) return
      try { source?.close() } catch { /* already closed */ }
      if (helloTimer) {
        clearTimeout(helloTimer)
        helloTimer = null
      }
      let heardHello = false
      const watchedKeys = appStateKeysForRoute(
        typeof window !== 'undefined' ? (window.location.pathname || '/') : '/',
      ).join(',')
      source = new EventSource(
        watchedKeys
          ? `/api/store/stream?keys=${encodeURIComponent(watchedKeys)}`
          : '/api/store/stream',
      )
      source.addEventListener('hello', () => {
        heardHello = true
        if (helloTimer) {
          clearTimeout(helloTimer)
          helloTimer = null
        }
        // liveNotify=false is not a broken stream: the server route already
        // falls back to a cursor-based change poll and emits only changed keys.
        ensureBackupPoll(false)
      })
      source.addEventListener('store', (e: Event) => {
        const { state, invalidated, changedAt } = parseStoreSseData((e as MessageEvent).data)
        if (state) applyRemoteState(state)
        if (invalidated.length) {
          const path = typeof window !== 'undefined' ? (window.location.pathname || '/') : '/'
          const needed = new Set(appStateKeysForRoute(path))
          void fetchStoreKeys(invalidated.filter(key => needed.has(key)), changedAt)
        }
      })
      source.onopen = () => {
        sseRetryMs = 1000
        // Stop full-state recovery as soon as the event transport reconnects.
        // The grace timer turns it back on if no protocol hello arrives.
        ensureBackupPoll(false)
        if (helloTimer) clearTimeout(helloTimer)
        helloTimer = setTimeout(() => {
          if (!heardHello) ensureBackupPoll(true)
        }, STORE_HELLO_GRACE_MS)
      }
      source.onerror = () => {
        try { source?.close() } catch { /* ignore */ }
        source = null
        if (helloTimer) {
          clearTimeout(helloTimer)
          helloTimer = null
        }
        ensureBackupPoll(true)
        if (sseClosed) return
        const wait = sseRetryMs
        sseRetryMs = nextSseRetryMs(sseRetryMs)
        sseTimer = setTimeout(connectSse, wait)
      }
    }
    connectSse()

    let lastStreamKeys = appStateKeysForRoute(
      typeof window !== 'undefined' ? (window.location.pathname || '/') : '/',
    ).join(',')
    const onStreamRoute = (e: Event) => {
      const nextPath = (e as CustomEvent).detail?.pathname
      if (typeof nextPath !== 'string') return
      const nextKeys = appStateKeysForRoute(nextPath).join(',')
      if (nextKeys === lastStreamKeys) return
      lastStreamKeys = nextKeys
      connectSse()
    }
    window.addEventListener('deed_route_change', onStreamRoute as EventListener)

    // 2b. When the network comes back, immediately flush any queued writes so data
    //     reaches the server without waiting for the next user interaction.
    const handleOnline = () => void flushServerSync()
    window.addEventListener('online', handleOnline)

    // 3. Sync users list (stored in DB, not app_state) — much less frequent.
    // Only user-account managers may GET /api/users. Everyone else gets
    // colleagues' names from /api/staff, and /api/technicians adds the
    // repair picker details for those who assign repairs.
    // A role that is refused once is refused every minute after: stop asking.
    // These refusals were ~560 of the server's error responses.
    let usersForbidden = false
    let techniciansForbidden = false
    const syncUsers = async () => {
      try {
        const res = usersForbidden ? null : await fetch('/api/users')
        if (res?.status === 403) usersForbidden = true
        if (res?.ok) {
          const data = await res.json()
          const fetched = Array.isArray(data) ? data : (Array.isArray(data.users) ? data.users : null)
          if (fetched) {
            setUsers(prev => JSON.stringify(prev) !== JSON.stringify(fetched)
              ? fetched.map((u: any) => ({ ...u, modules: Array.isArray(u.modules) ? [...u.modules] : [] }))
              : prev)
            return
          }
        }
        const staffRes = await fetch('/api/staff')
        if (staffRes.ok) {
          const staff = ((await staffRes.json())?.staff ?? []) as Array<Record<string, unknown>>
          setUsers(prev => mergeAssignableTechniciansIntoUsers(prev, staff.map((u: any) => ({
            ...u,
            username: u.username || u.id,
            createdAt: u.createdAt || '',
          }))).map(u => Array.isArray(u.modules) ? u : { ...u, modules: [] }))
        }
        if (techniciansForbidden) return
        const techRes = await fetch('/api/technicians')
        if (techRes.status === 403) techniciansForbidden = true
        if (!techRes.ok) return
        const techData = await techRes.json()
        const technicians = Array.isArray(techData?.technicians) ? techData.technicians : []
        if (!technicians.length) return
        setUsers(prev => mergeAssignableTechniciansIntoUsers(
          prev,
          technicians.map((u: any) => ({
            ...u,
            username: u.username || u.id,
            createdAt: u.createdAt || '',
            active: u.active !== false,
            modules: Array.isArray(u.modules) ? [...u.modules] : [],
          })),
        ))
      } catch {}
    }
    syncUsers()
    const usersId = setInterval(syncUsers, 60_000) // Users change rarely — sync every minute

    return () => {
      sseClosed = true
      if (sseTimer) clearTimeout(sseTimer)
      if (helloTimer) clearTimeout(helloTimer)
      stopBackupPoll?.()
      try { source?.close() } catch { /* already closed */ }
      clearInterval(usersId)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('deed_route_change', onStreamRoute as EventListener)
    }  }, [])
}
