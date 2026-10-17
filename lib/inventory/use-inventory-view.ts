'use client'

import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_VIEW_PREFS, normalizeViewPrefs, type InventoryViewPrefs } from './view-prefs'

const STORAGE_KEY = 'deed_inventory_view_v1'

/**
 * One shared set of display choices for Catalog, Product Master and Warehouse,
 * remembered per browser. Condition is shared so "Refurbished" stays on when
 * you move between the three tabs.
 */
export function useInventoryView() {
  const [prefs, setPrefs] = useState<InventoryViewPrefs>(DEFAULT_VIEW_PREFS)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setPrefs(normalizeViewPrefs(JSON.parse(raw)))
    } catch {
      // Preferences are a convenience — fall back to the defaults.
    }
  }, [])

  const update = useCallback((patch: Partial<InventoryViewPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore storage failures
      }
      return next
    })
  }, [])

  const reset = useCallback(() => update({ ...DEFAULT_VIEW_PREFS }), [update])

  return { prefs, update, reset }
}
