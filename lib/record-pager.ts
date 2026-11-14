'use client'

import { useSyncExternalStore } from 'react'

/**
 * Odoo-style record pager: opening a record from a list remembers that
 * list's order (after its filters and sorting), so the record screen can step
 * to the previous / next one — "3 / 16 ‹ ›" — without going back.
 *
 * One list at a time (the last one a record was opened from), kept for the
 * browser tab (sessionStorage) so a refresh keeps it.
 */
const KEY = 'deed_record_pager'
let ids: string[] = []
const listeners = new Set<() => void>()

function load() {
  try {
    const raw = sessionStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === 'string')
  } catch { /* no storage: the pager just hides */ }
}
if (typeof window !== 'undefined') load()

/** Call when a record is opened from a list: the list's ids, in the order shown. */
export function rememberRecordList(list: readonly string[]) {
  ids = list.filter(Boolean).slice(0, 5000)
  try { sessionStorage.setItem(KEY, JSON.stringify(ids)) } catch { /* ignore */ }
  listeners.forEach(fn => fn())
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const snapshot = () => ids
const serverSnapshot = (): string[] => []

/** Where `currentId` sits in a list (wraps around); null when it is not in it or alone. */
export function pagerFor(list: readonly string[], currentId: string | null | undefined) {
  const index = currentId ? list.indexOf(currentId) : -1
  if (index < 0 || list.length < 2) return null
  return {
    position: index + 1,
    total: list.length,
    prevId: list[(index - 1 + list.length) % list.length],
    nextId: list[(index + 1) % list.length],
  }
}

/** The pager for `currentId` in the list a record was last opened from. */
export function useRecordPager(currentId: string | null | undefined) {
  return pagerFor(useSyncExternalStore(subscribe, snapshot, serverSnapshot), currentId)
}
