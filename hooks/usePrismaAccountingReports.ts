'use client'

import { useCallback, useEffect, useState } from 'react'
import type { JournalEntry } from '@/lib/store'

type TrialBalanceRow = {
  id: string
  code: string
  name: string
  type: string
  group?: string
  debit: number
  credit: number
}

type TrialBalanceResponse = {
  currency: string
  rows: TrialBalanceRow[]
  totals: { debit: number; credit: number }
  balanced: boolean
}

export function usePrismaAccountingReports(enabled: boolean) {
  const [journals, setJournals] = useState<JournalEntry[]>([])
  const [trialBalance, setTrialBalance] = useState<TrialBalanceResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      const [jRes, tbRes] = await Promise.all([
        fetch('/api/accounting/journals?limit=300'),
        fetch('/api/accounting/trial-balance'),
      ])
      if (!jRes.ok) throw new Error('Failed to load Prisma journals')
      if (!tbRes.ok) throw new Error('Failed to load Prisma trial balance')
      const jData = await jRes.json()
      const tbData = await tbRes.json()
      setJournals(Array.isArray(jData.journals) ? jData.journals : [])
      setTrialBalance(tbData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounting reports')
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { journals, trialBalance, loading, error, refresh }
}

export async function bootstrapCoaClient() {
  const res = await fetch('/api/accounting/bootstrap-coa', { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'CoA bootstrap failed')
  return data
}
