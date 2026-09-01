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
  sort: undefined,
}

function readPrefs(tableId: string): TablePreferences {
  try {
    const raw = localStorage.getItem(storageKey(tableId))
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw)
    const hasSort = Object.prototype.hasOwnProperty.call(parsed, 'sort')
    const parsedSort = parsed.sort
    const sort = !hasSort
      ? undefined
      : parsedSort === null
        ? null
        : parsedSort
          && typeof parsedSort.key === 'string'
          && (parsedSort.direction === 'asc' || parsedSort.direction === 'desc')
            ? { key: parsedSort.key, direction: parsedSort.direction }
            : undefined
    return {
      visibleColumnKeys: Array.isArray(parsed.visibleColumnKeys) ? parsed.visibleColumnKeys : null,
      density: parsed.density === 'compact' ? 'compact' : 'cozy',
      savedViews: Array.isArray(parsed.savedViews) ? parsed.savedViews : [],
      sort,
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

  const persist = useCallback((update: (prev: TablePreferences) => TablePreferences) => {
    setPrefs(prev => {
      const next = update(prev)
      try {
        localStorage.setItem(storageKey(tableId), JSON.stringify(next))
      } catch {
        // ignore storage failures — preferences are a convenience, not a requirement
      }
      return next
    })
  }, [tableId])

  const setVisibleColumnKeys = useCallback((keys: string[] | null) => {
    persist(prev => ({ ...prev, visibleColumnKeys: keys }))
  }, [persist])

  const setDensity = useCallback((density: 'cozy' | 'compact') => {
    persist(prev => ({ ...prev, density }))
  }, [persist])

  const setSort = useCallback((sort: TablePreferences['sort']) => {
    persist(prev => ({ ...prev, sort }))
  }, [persist])

  const saveView = useCallback((view: SavedView) => {
    persist(prev => ({
      ...prev,
      savedViews: [...prev.savedViews.filter(v => v.id !== view.id), view],
    }))
  }, [persist])

  const deleteView = useCallback((id: string) => {
    persist(prev => ({ ...prev, savedViews: prev.savedViews.filter(v => v.id !== id) }))
  }, [persist])

  return { prefs, hydrated, setVisibleColumnKeys, setDensity, setSort, saveView, deleteView }
}
