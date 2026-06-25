'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SavedView, TablePreferences } from './types'

function storageKey(tableId: string) {
  // v2: reset legacy per-table visibility/view blobs that can hide too many
  // columns after the responsive-table migration.
  return `deed_table_prefs_v2_${tableId}`
}

const DEFAULT_PREFS: TablePreferences = {
  visibleColumnKeys: null,
  density: 'cozy',
  savedViews: [],
}

function readPrefs(tableId: string): TablePreferences {
  try {
    const raw = localStorage.getItem(storageKey(tableId))
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw)
    return {
      visibleColumnKeys: Array.isArray(parsed.visibleColumnKeys) ? parsed.visibleColumnKeys : null,
      density: parsed.density === 'compact' ? 'compact' : 'cozy',
      savedViews: Array.isArray(parsed.savedViews) ? parsed.savedViews : [],
    }
  } catch {
    return DEFAULT_PREFS
  }
}

// Generalizes the per-table column-width persistence already used by the
// existing Table() component (deed_table_widths_*) to also cover visible
// columns, density, and saved views — one storage shape per table.
export function useTablePreferences(tableId: string) {
  const [prefs, setPrefs] = useState<TablePreferences>(DEFAULT_PREFS)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setPrefs(readPrefs(tableId))
    setHydrated(true)
  }, [tableId])

  const persist = useCallback((next: TablePreferences) => {
    setPrefs(next)
    try {
      localStorage.setItem(storageKey(tableId), JSON.stringify(next))
    } catch {
      // ignore storage failures — preferences are a convenience, not a requirement
    }
  }, [tableId])

  const setVisibleColumnKeys = useCallback((keys: string[] | null) => {
    persist({ ...prefs, visibleColumnKeys: keys })
  }, [prefs, persist])

  const setDensity = useCallback((density: 'cozy' | 'compact') => {
    persist({ ...prefs, density })
  }, [prefs, persist])

  const saveView = useCallback((view: SavedView) => {
    persist({ ...prefs, savedViews: [...prefs.savedViews.filter(v => v.id !== view.id), view] })
  }, [prefs, persist])

  const deleteView = useCallback((id: string) => {
    persist({ ...prefs, savedViews: prefs.savedViews.filter(v => v.id !== id) })
  }, [prefs, persist])

  return { prefs, hydrated, setVisibleColumnKeys, setDensity, saveView, deleteView }
}
