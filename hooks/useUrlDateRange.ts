'use client'

import { useCallback, useMemo } from 'react'
import { useUrlUiPatch, useUrlUiState } from '@/hooks/useUrlRecordId'
import { ALL_DATES, type DateRange, type DateRangePreset } from '@/lib/data-table/date-filter'

const DEFAULT_KEYS = { preset: 'period', from: 'from', to: 'to' } as const

/**
 * A period filter held in the URL, so a narrowed list can be reloaded, shared
 * or reached from a link. The preset and the two custom dates are written in
 * one patch, so they can never disagree, and the caller's page key is cleared
 * with them.
 */
export function useUrlDateRange(opts?: {
  /** Query keys, for a screen that carries two independent periods. */
  keys?: { preset: string; from: string; to: string }
  /** Keys to clear whenever the period changes — normally the page number. */
  resets?: Record<string, string | null>
  /** Called before the URL is written, e.g. to reset a page held in state. */
  onChange?: () => void
}): [DateRange, (next: DateRange) => void] {
  const keys = opts?.keys ?? DEFAULT_KEYS
  const resets = opts?.resets
  const onChange = opts?.onChange
  const [preset] = useUrlUiState(keys.preset, 'all')
  const [from] = useUrlUiState(keys.from, '')
  const [to] = useUrlUiState(keys.to, '')
  const patchUi = useUrlUiPatch()

  const range = useMemo<DateRange>(
    () => (preset && preset !== 'all'
      ? { preset: preset as DateRangePreset, from: from || undefined, to: to || undefined }
      : ALL_DATES),
    [preset, from, to],
  )

  const setRange = useCallback((next: DateRange) => {
    onChange?.()
    patchUi({
      ...resets,
      [keys.preset]: next.preset === 'all' ? null : next.preset,
      [keys.from]: next.preset === 'custom' ? next.from ?? null : null,
      [keys.to]: next.preset === 'custom' ? next.to ?? null : null,
    })
  }, [keys.preset, keys.from, keys.to, onChange, patchUi, resets])

  return [range, setRange]
}
