'use client'

import { persistClientStoreValue } from '@/lib/client-store-cache'
import { readDirtyStoreKeys } from '@/lib/client-store-hydrate'

const HEAL_FLAG_LS = 'deed_catalog_healed_v1'

function markHealComplete() {
  try {
    window.localStorage.setItem(HEAL_FLAG_LS, new Date().toISOString())
  } catch { /* ignore */ }
}

/** One-shot catalog heals — never block first paint or the products boot GET. */
export function scheduleCatalogHealOnce(): void {
  if (typeof window === 'undefined') return
  try {
    if (window.localStorage.getItem(HEAL_FLAG_LS)) return
  } catch {
    return
  }

  const run = () => {
    void (async () => {
      try {
        const trackingRes = await fetch('/api/products/normalize-serial-tracking', { method: 'POST' })
        const deviceRes = await fetch('/api/products/normalize-device-config', { method: 'POST' })
        // 403 = this session cannot heal (non-write role). Do not persist a
        // browser-wide flag or a later admin login on this machine is skipped.
        if (!trackingRes.ok || !deviceRes.ok) return

        const healed = await deviceRes.json().catch(() => null) as {
          serials?: unknown[]
          serialsUpdated?: number
        } | null
        if (
          Number(healed?.serialsUpdated) > 0
          && Array.isArray(healed?.serials)
          && !readDirtyStoreKeys().has('deed_serials')
        ) {
          const serialized = JSON.stringify(healed.serials)
          persistClientStoreValue('deed_serials', serialized)
          window.dispatchEvent(new CustomEvent('deed_remote_update', { detail: { key: 'deed_serials', value: serialized } }))
        }
        markHealComplete()
      } catch {
        // Network blip: retry on the next full load, do not sticky-skip.
      }
    })()
  }

  window.setTimeout(run, 8_000)
}
