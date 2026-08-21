'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui'
import { ALL_CATEGORIES } from '@/lib/store'

type CategoryRate = {
  id: string | null
  name: string
  commissionRatePercent: number | null
}

export function CommissionRatesSettings({ showToast }: { showToast: (msg: string, type?: string) => void }) {
  const [items, setItems] = useState<CategoryRate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const refresh = () => {
    fetch('/api/categories')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const loaded: CategoryRate[] = Array.isArray(data?.items) ? data.items : []
        const byName = new Map(loaded.map(item => [item.name, item]))
        setItems(ALL_CATEGORIES.map(name => byName.get(name) ?? { id: null, name, commissionRatePercent: null }))
      })
      .catch(() => setItems(ALL_CATEGORIES.map(name => ({ id: null, name, commissionRatePercent: null }))))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map(item => ({
            name: item.name,
            commissionRatePercent: item.commissionRatePercent,
          })),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `Server error (${res.status})`)
      showToast('Category commission rates saved')
      refresh()
    } catch (err) {
      showToast(`Could not save commission rates: ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pt-1 pb-2">
      <p className="text-[11px] text-[var(--text-3)] leading-relaxed m-0 mb-3">
        Commission is earned when a customer invoice is posted. Rate is the product override, else this
        category %, else none. Repair invoices never earn commission. Closers need an HR employee on their login.
      </p>
      {loading ? (
        <p className="text-[11.5px] text-[var(--text-3)] py-2 m-0">Loading category rates…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--text-3)]">
                <th className="py-1.5 pr-3 font-semibold">Category</th>
                <th className="py-1.5 font-semibold w-36">Commission %</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.name} className="border-t border-[var(--border-lt)]">
                  <td className="py-2 pr-3 text-[var(--text-1)]">{item.name}</td>
                  <td className="py-2">
                    <Input
                      type="number"
                      value={item.commissionRatePercent == null ? '' : String(item.commissionRatePercent)}
                      onChange={v => {
                        const next = [...items]
                        const n = v === '' ? null : Number(v)
                        next[idx] = {
                          ...item,
                          commissionRatePercent: n == null || !Number.isFinite(n) ? null : Math.max(0, Math.min(100, n)),
                        }
                        setItems(next)
                      }}
                      placeholder="None"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end pt-2">
        <button type="button" className="btn-primary text-[11px]" onClick={() => void save()} disabled={loading || saving}>
          {saving ? 'Saving…' : 'Save rates'}
        </button>
      </div>
    </div>
  )
}
