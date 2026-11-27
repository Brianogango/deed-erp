'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UnitTest, UnitTestSettings } from '@/lib/inventory/unit-tests'

/** One line per unit: its newest test (GET /api/inventory/unit-tests). */
export interface UnitTestBrief {
  testId: string
  serialId: string
  number: number
  status: UnitTest['status']
  result: 'passed' | 'passed_override' | 'failed' | 'pending'
  line: string
  grade?: string | null
  batteryHealth?: number | null
  failReasons: string[]
  cosmetic: string[]
  completedAt?: string
  testedByName?: string
  startedByName?: string
  startedAt: string
  placedTo?: string
  source?: UnitTest['source']
  refurbJobRef?: string
  overrideReason?: string
}

export async function unitTestAction<T = { test: UnitTest }>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/inventory/unit-tests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: String((data as { error?: string }).error || 'Could not save the test') }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' }
  }
}

export async function fetchUnitTestHistory(serialId: string): Promise<{ tests: UnitTest[]; settings: UnitTestSettings } | null> {
  try {
    const res = await fetch(`/api/inventory/unit-tests?serialId=${encodeURIComponent(serialId)}`, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json() as { tests: UnitTest[]; settings: UnitTestSettings }
  } catch {
    return null
  }
}

/** The test lines for the Warehouse lists; refreshed on demand and every minute while open. */
export function useUnitTests(enabled: boolean) {
  const [briefs, setBriefs] = useState<UnitTestBrief[]>([])
  const [settings, setSettings] = useState<UnitTestSettings | null>(null)
  const [loaded, setLoaded] = useState(false)
  const busy = useRef(false)

  const refresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      const res = await fetch('/api/inventory/unit-tests', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json() as { briefs?: UnitTestBrief[]; settings?: UnitTestSettings }
      setBriefs(Array.isArray(data.briefs) ? data.briefs : [])
      if (data.settings) setSettings(data.settings)
      setLoaded(true)
    } catch {
      /* keep what we have */
    } finally {
      busy.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    const id = window.setInterval(() => { void refresh() }, 60_000)
    return () => window.clearInterval(id)
  }, [enabled, refresh])

  const bySerial = useMemo(() => new Map(briefs.map(b => [b.serialId, b])), [briefs])
  return { briefs, bySerial, settings, loaded, refresh }
}
