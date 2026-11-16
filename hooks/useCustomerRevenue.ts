'use client'

import { useEffect, useState } from 'react'
import type { CustomerRevenueResult } from '@/lib/dashboard/customer-revenue'

/**
 * Customers ranked by posted invoice value, from the server. The dashboard
 * does not hold the invoice list, and invoices are where every kind of
 * revenue lands — sales, repairs, the till, and anything Finance raised
 * directly — so the ranking is worked out there.
 */
export function useCustomerRevenue(endMonth: string, months: number, limit = 5): {
  data: CustomerRevenueResult | null
  loading: boolean
  failed: boolean
} {
  const [state, setState] = useState<{ data: CustomerRevenueResult | null; loading: boolean; failed: boolean }>({
    data: null, loading: Boolean(endMonth), failed: false,
  })

  useEffect(() => {
    if (!endMonth) { setState({ data: null, loading: false, failed: false }); return }
    let live = true
    setState(prev => ({ ...prev, loading: true, failed: false }))
    const query = `end=${encodeURIComponent(endMonth)}&months=${months}&limit=${limit}`
    fetch(`/api/dashboard/customer-revenue?${query}`, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: CustomerRevenueResult) => { if (live) setState({ data, loading: false, failed: false }) })
      .catch(() => { if (live) setState({ data: null, loading: false, failed: true }) })
    return () => { live = false }
  }, [endMonth, months, limit])

  return state
}
