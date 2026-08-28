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

type PlRow = { code: string; name: string; type: string; group: string; amount: number }

export type ProfitLossResponse = {
  currency: string
  dateFrom: string | null
  dateTo: string | null
  view?: 'management' | 'flat'
  revenue: PlRow[]
  expenses: PlRow[]
  totalRevenue: number
  totalExpenses: number
  netProfit: number
  /** Management view fields (Phase 8) */
  otherIncome?: PlRow[]
  totalOtherIncome?: number
  totalIncome?: number
  cogs?: PlRow[]
  totalCogs?: number
  grossProfit?: number
  operatingExpenses?: PlRow[]
  totalOperating?: number
  financeCosts?: PlRow[]
  totalFinance?: number
  byGroup?: Array<{ group: string; section: string; amount: number }>
}

type BsRow = { code: string; name: string; type: string; group: string; amount: number }

type BalanceSheetResponse = {
  currency: string
  asOf: string
  assets: BsRow[]
  liabilities: BsRow[]
  equity: BsRow[]
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  balanced: boolean
}

export type VatControlResponse = {
  currency: string
  dateFrom: string | null
  dateTo: string | null
  outputVatCode: string
  inputVatCode: string
  outputVat: number
  inputVat: number
  vatPayable: number
  source: 'gl' | 'invoices' | 'tax_transactions'
  taxableSales?: number
  taxablePurchases?: number
  draft?: {
    periodLabel: string
    boxes: Array<{ code: string; label: string; amount: number }>
    netPayable: number
  }
}

export type PrismaReportFlags = {
  trialBalance?: boolean
  profitLoss?: boolean
  balanceSheet?: boolean
  vatControl?: boolean
  /** Optional period for P&L (and future dated reports). */
  plDateFrom?: string | null
  plDateTo?: string | null
  plView?: 'management' | 'flat'
}

export function usePrismaAccountingReports(enabled: boolean, flags: PrismaReportFlags = {}) {
  const [journals, setJournals] = useState<JournalEntry[]>([])
  const [trialBalance, setTrialBalance] = useState<TrialBalanceResponse | null>(null)
  const [profitLoss, setProfitLoss] = useState<ProfitLossResponse | null>(null)
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetResponse | null>(null)
  const [vatControl, setVatControl] = useState<VatControlResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      const fetches: Promise<Response>[] = [fetch('/api/accounting/journals?limit=300')]
      if (flags.trialBalance !== false) fetches.push(fetch(`/api/accounting/trial-balance?asOf=${new Date().toISOString().slice(0, 10)}`))
      if (flags.profitLoss) {
        const qs = new URLSearchParams()
        qs.set('view', flags.plView || 'management')
        if (flags.plDateFrom) qs.set('dateFrom', flags.plDateFrom)
        if (flags.plDateTo) qs.set('dateTo', flags.plDateTo)
        fetches.push(fetch(`/api/accounting/profit-loss?${qs.toString()}`))
      }
      if (flags.balanceSheet) fetches.push(fetch(`/api/accounting/balance-sheet?asOf=${new Date().toISOString().slice(0, 10)}`))
      if (flags.vatControl) fetches.push(fetch('/api/accounting/vat-control?draft=1'))

      const responses = await Promise.all(fetches)
      let idx = 0
      const jRes = responses[idx++]
      if (!jRes.ok) throw new Error('Failed to load Prisma journals')
      const jData = await jRes.json()
      setJournals(Array.isArray(jData.journals) ? jData.journals : [])

      if (flags.trialBalance !== false) {
        const tbRes = responses[idx++]
        if (!tbRes.ok) throw new Error('Failed to load Prisma trial balance')
        setTrialBalance(await tbRes.json())
      }

      if (flags.profitLoss) {
        const plRes = responses[idx++]
        if (!plRes.ok) throw new Error('Failed to load Prisma P&L')
        setProfitLoss(await plRes.json())
      }

      if (flags.balanceSheet) {
        const bsRes = responses[idx++]
        if (!bsRes.ok) throw new Error('Failed to load Prisma balance sheet')
        setBalanceSheet(await bsRes.json())
      }

      if (flags.vatControl) {
        const vatRes = responses[idx++]
        if (!vatRes.ok) throw new Error('Failed to load Prisma VAT control')
        setVatControl(await vatRes.json())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounting reports')
    } finally {
      setLoading(false)
    }
  }, [
    enabled,
    flags.trialBalance,
    flags.profitLoss,
    flags.balanceSheet,
    flags.vatControl,
    flags.plDateFrom,
    flags.plDateTo,
    flags.plView,
  ])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { journals, trialBalance, profitLoss, balanceSheet, vatControl, loading, error, refresh }
}

export async function bootstrapCoaClient() {
  const res = await fetch('/api/accounting/bootstrap-coa', { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'CoA bootstrap failed')
  return data
}
