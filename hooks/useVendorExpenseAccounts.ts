'use client'

import { useCallback, useEffect, useState } from 'react'
import type { VendorExpenseAccounts } from '@/lib/accounting/bill-expense-accounts'

/** Each vendor's default expense account, and a way for Finance to set one. */
export function useVendorExpenseAccounts(enabled = true) {
  const [accounts, setAccounts] = useState<VendorExpenseAccounts>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetch('/api/vendor-expense-accounts')
      .then(res => (res.ok ? res.json() : { accounts: {} }))
      .then((data: { accounts?: VendorExpenseAccounts }) => { if (!cancelled) setAccounts(data.accounts ?? {}) })
      .catch(() => { /* no defaults: bills still work, lines start blank */ })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [enabled])

  /** Saves the vendor's default. Resolves to an error message, or null when saved. */
  const setDefault = useCallback(async (vendorId: string, accountCode: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/vendor-expense-accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorId, accountCode }),
      })
      const data = await res.json().catch(() => ({})) as { accounts?: VendorExpenseAccounts; error?: string }
      if (!res.ok) return data.error || `Could not save (HTTP ${res.status})`
      setAccounts(data.accounts ?? {})
      return null
    } catch {
      return 'Could not reach the server'
    }
  }, [])

  return { accounts, loaded, setDefault }
}
