'use client'

/**
 * Open a slimmed record (lib/store-slim.ts): fetch the full row once and
 * swap it into the store without it counting as an edit.
 */

import { useEffect } from 'react'
import { isSlimRow } from '@/lib/store-slim'

export const PATCH_ROWS_EVENT = 'deed_patch_rows'

const inflight = new Map<string, Promise<Record<string, unknown> | null>>()

/** The full row, or null when it cannot be loaded (the slim row stays). */
export function loadFullRecord(key: string, id: string): Promise<Record<string, unknown> | null> {
  const slot = `${key}:${id}`
  const existing = inflight.get(slot)
  if (existing) return existing
  const work = fetch(`/api/store/record?key=${encodeURIComponent(key)}&id=${encodeURIComponent(id)}`)
    .then(async res => (res.ok ? ((await res.json()) as { row?: Record<string, unknown> }).row ?? null : null))
    .catch(() => null)
    .then(row => {
      if (row && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(PATCH_ROWS_EVENT, { detail: { key, rows: [row] } }))
      }
      return row
    })
    .finally(() => { inflight.delete(slot) })
  inflight.set(slot, work)
  return work
}

/** While a slimmed row is on screen, load its full version. */
export function useFullRecord(key: string, row: { id?: unknown } | null | undefined) {
  const id = row?.id != null ? String(row.id) : ''
  const slim = isSlimRow(row)
  useEffect(() => {
    if (id && slim) void loadFullRecord(key, id)
  }, [key, id, slim])
}
