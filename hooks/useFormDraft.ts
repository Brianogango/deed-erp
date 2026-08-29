'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000
const SENSITIVE_KEY = /password|passwd|secret|token|api[_-]?key|authorization|credential/i

export type FormDraftMeta = {
  savedAt: string
  formKey: string
}

export type UseFormDraftResult<T extends Record<string, unknown>> = {
  draft: T | null
  meta: FormDraftMeta | null
  restore: () => T | null
  discard: () => void
  clearOnSubmit: () => void
  hasDraft: boolean
}

function draftStorageKey(userId: string, formKey: string) {
  return `draft_${userId}_${formKey}`
}

/** Strip secrets / excluded keys before persisting a form draft. */
export function sanitizeDraftPayload<T extends Record<string, unknown>>(
  values: T,
  exclude: (keyof T)[] = [],
): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(values)) {
    if (exclude.includes(key as keyof T)) continue
    if (SENSITIVE_KEY.test(key)) continue
    out[key as keyof T] = value as T[keyof T]
  }
  return out
}

export function readFormDraft<T>(userId: string | null | undefined, formKey: string): { values: T; savedAt: string } | null {
  if (!userId || typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(draftStorageKey(userId, formKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { values: T; savedAt: string }
    if (!parsed?.savedAt || !parsed.values) return null
    if (Date.now() - Date.parse(parsed.savedAt) > DRAFT_TTL_MS) {
      localStorage.removeItem(draftStorageKey(userId, formKey))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearFormDraft(userId: string | null | undefined, formKey: string) {
  if (!userId || typeof window === 'undefined') return
  try {
    localStorage.removeItem(draftStorageKey(userId, formKey))
  } catch {
    // ignore
  }
}

/**
 * Debounced localStorage draft for long-running forms (P0-DEED-001).
 * Namespaced per user + formKey. Never persists password/secret fields.
 */
export function useFormDraft<T extends Record<string, unknown>>(
  userId: string | null | undefined,
  formKey: string,
  currentValues: T,
  options?: { exclude?: (keyof T)[]; enabled?: boolean },
): UseFormDraftResult<T> {
  const exclude = options?.exclude ?? []
  const enabled = options?.enabled !== false && Boolean(userId)
  const [draft, setDraft] = useState<T | null>(null)
  const [meta, setMeta] = useState<FormDraftMeta | null>(null)
  const hydrated = useRef(false)
  const skipNextPersist = useRef(false)

  useEffect(() => {
    if (!enabled || hydrated.current) return
    hydrated.current = true
    const existing = readFormDraft<T>(userId, formKey)
    if (existing) {
      setDraft(existing.values)
      setMeta({ savedAt: existing.savedAt, formKey })
    }
  }, [enabled, userId, formKey])

  useEffect(() => {
    if (!enabled || !userId) return
    if (skipNextPersist.current) {
      skipNextPersist.current = false
      return
    }
    const handle = window.setTimeout(() => {
      try {
        const values = sanitizeDraftPayload(currentValues, exclude)
        const savedAt = new Date().toISOString()
        localStorage.setItem(draftStorageKey(userId, formKey), JSON.stringify({ values, savedAt }))
      } catch {
        // quota / private mode
      }
    }, 1000)
    return () => window.clearTimeout(handle)
  }, [currentValues, enabled, userId, formKey, exclude])

  const restore = useCallback(() => {
    if (!draft) return null
    skipNextPersist.current = true
    return draft
  }, [draft])

  const discard = useCallback(() => {
    clearFormDraft(userId, formKey)
    setDraft(null)
    setMeta(null)
  }, [userId, formKey])

  const clearOnSubmit = useCallback(() => {
    clearFormDraft(userId, formKey)
    setDraft(null)
    setMeta(null)
  }, [userId, formKey])

  return {
    draft,
    meta,
    restore,
    discard,
    clearOnSubmit,
    hasDraft: Boolean(draft && meta),
  }
}

/**
 * Clear business + draft keys from localStorage on explicit logout (SEC-004).
 *
 * POS till-session keys are preserved: a till that was opened stays open until
 * someone runs Close Session at end-of-day reconciliation (see lib/pos-session.ts).
 * Auto-logout / inactivity logout must not destroy the open till, so these keys
 * survive logout and re-hydrate on the next login.
 */
const LOGOUT_PRESERVED_KEYS = new Set([
  'deed_posSessionOpen',
  'deed_posSessionId',
  'deed_posSessionOpeningCash',
  'deed_posSessions',
])

export function purgeClientBusinessStorage() {
  if (typeof window === 'undefined') return
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key) continue
    if (LOGOUT_PRESERVED_KEYS.has(key)) continue
    if (key.startsWith('deed_') || key.startsWith('draft_')) keys.push(key)
  }
  for (const key of keys) {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }
}
