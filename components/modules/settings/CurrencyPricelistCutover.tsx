'use client'

import { useCallback, useEffect, useState } from 'react'
import { Field, Input, Select } from '@/components/ui'
import { BUILTIN_PRICELISTS, type PriceListDef } from '@/lib/pricing/pricelist'
import { FUNCTIONAL_CURRENCY, SUPPORTED_CURRENCIES, type ExchangeRateRow } from '@/lib/currency'

function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between py-3.5 border-b border-gray-50 last:border-0 gap-3 sm:gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-gray-800 leading-tight">{label}</p>
        {desc && <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <div className="flex-shrink-0 w-full sm:w-[340px]">{children}</div>
    </div>
  )
}

export function CurrencyRatesEditor({
  canWrite,
  showToast,
  companyCurrency,
  onCompanyCurrencyChange,
}: {
  canWrite: boolean
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
  companyCurrency: string
  onCompanyCurrencyChange: (v: string) => void
}) {
  const [rates, setRates] = useState<ExchangeRateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fromCurrency, setFromCurrency] = useState('USD')
  const [rate, setRate] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/settings/exchange-rates')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setRates(Array.isArray(data.rates) ? data.rates : [])
    } catch {
      setRates([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const saveRate = async () => {
    if (!canWrite) {
      showToast('Only Director or Finance can set exchange rates', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/settings/exchange-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromCurrency, rate: Number(rate), effectiveDate, source: 'manual' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error || 'Could not save rate', 'error')
        return
      }
      showToast(`${fromCurrency}→KES rate saved`, 'success')
      setRate('')
      await load()
    } catch {
      showToast('Could not save rate', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-1">
      <SettingRow
        label="Functional currency"
        desc="Books, journals, and trial balance stay in KES. Changing display currency does not rewrite history."
      >
        <div className="text-[12px] font-semibold text-gray-700 py-1.5">{FUNCTIONAL_CURRENCY} (locked)</div>
      </SettingRow>
      <SettingRow
        label="Document default currency"
        desc="Stamped onto new quotes, orders, and invoices. Prefer KES until FX posting is live."
      >
        <Select
          value={companyCurrency}
          onChange={onCompanyCurrencyChange}
          options={SUPPORTED_CURRENCIES.map(c => ({
            value: c,
            label: c === 'KES' ? 'KES — Kenyan Shilling' : c === 'USD' ? 'USD — US Dollar' : c === 'EUR' ? 'EUR — Euro' : 'GBP — British Pound',
          }))}
        />
      </SettingRow>
      {companyCurrency !== FUNCTIONAL_CURRENCY && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Display currency is {companyCurrency}. Amounts on new documents will be labeled {companyCurrency};
          set an exchange rate below so base (KES) conversion is snapshot correctly.
          FX revaluation journals are available via Finance → POST /api/accounting/fx-revaluation (Director/Finance).
        </p>
      )}
      <div className="pt-2">
        <p className="text-[12px] font-semibold text-gray-800 mb-2">Exchange rates → KES</p>
        {loading ? (
          <p className="text-[11px] text-gray-400">Loading rates…</p>
        ) : (
          <div className="space-y-2 mb-3">
            {rates.slice(0, 8).map(r => (
              <div key={r.id} className="flex justify-between text-[11px] text-gray-600 border-b border-gray-50 pb-1">
                <span>{r.fromCurrency} → KES</span>
                <span className="font-mono">{Number(r.rate).toLocaleString('en-KE', { maximumFractionDigits: 6 })} · {r.effectiveDate}</span>
              </div>
            ))}
            {rates.length === 0 && <p className="text-[11px] text-gray-400">No rates stored yet (KES identity is implicit).</p>}
          </div>
        )}
        {canWrite && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Field label="From">
              <Select
                value={fromCurrency}
                onChange={setFromCurrency}
                options={SUPPORTED_CURRENCIES.filter(c => c !== 'KES').map(c => ({ value: c, label: c }))}
              />
            </Field>
            <Field label="Rate to KES">
              <Input type="number" value={rate} onChange={setRate} placeholder="e.g. 129.5" />
            </Field>
            <Field label="Effective">
              <Input type="date" value={effectiveDate} onChange={setEffectiveDate} />
            </Field>
            <div className="sm:col-span-3">
              <button
                type="button"
                disabled={saving || !rate}
                onClick={() => void saveRate()}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-navy-500 text-white border-none cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Add rate'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function PricelistsPanel({
  showToast,
}: {
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [lists, setLists] = useState<PriceListDef[]>(BUILTIN_PRICELISTS)
  const [source, setSource] = useState('builtin')

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/settings/pricelists')
        if (!res.ok) return
        const data = await res.json()
        if (Array.isArray(data.priceLists) && data.priceLists.length) {
          setLists(data.priceLists)
          setSource(data.source || 'prisma')
        }
      } catch {
        showToast('Using built-in pricelists (DB unavailable)', 'info')
      }
    })()
  }, [showToast])

  return (
    <div className="py-2 space-y-2">
      <p className="text-[11px] text-gray-400 leading-relaxed">
        Retail / Wholesale / Kilimall map to product selling, wholesale, and Kilimall prices.
        Enable the sales pricelists toggle to pick a list on quotations. Below-list unit prices
        require special_pricing approval (Director). Source: {source}.
      </p>
      {lists.map(l => (
        <div key={l.id || l.code} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
          <div>
            <p className="text-[12.5px] font-semibold text-gray-800">{l.name}</p>
            <p className="text-[11px] text-gray-400">{l.code} · {l.priceSource} · {l.currencyCode}</p>
          </div>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${l.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {l.isActive ? 'Active' : 'Off'}
          </span>
        </div>
      ))}
    </div>
  )
}

export function BlobCutoverPanel({
  canWrite,
  showToast,
}: {
  canWrite: boolean
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<{
    checks?: Array<{
      blobKey: string
      prismaTable: string
      blobCount: number | null
      prismaCount: number | null
      parityOk: boolean
      blockedReason?: string
    }>
    uncertifiedProtectedKeys?: string[]
    allProtectedCertified?: boolean
  } | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/blob-cutover')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error || 'Could not load cutover status', 'error')
        return
      }
      setReport(data)
    } catch {
      showToast('Could not load cutover status', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { void refresh() }, [refresh])

  const run = async (action: string, blobKey?: string) => {
    if (!canWrite) {
      showToast('Director only', 'error')
      return
    }
    setBusyKey(blobKey || action)
    try {
      const res = await fetch('/api/admin/blob-cutover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blobKey ? { action, blobKey } : { action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error || `${action} failed`, 'error')
      } else {
        showToast(data.note || `${action} ok`, 'success')
      }
      await refresh()
    } catch {
      showToast(`${action} failed`, 'error')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="py-2 space-y-3">
      <p className="text-[11px] text-gray-400 leading-relaxed">
        Gated path only: verify parity → certify → archive (copy) → retire live key.
        Products blob ≠ Prisma is a hard stop. Full wipe still blocked until keys are certified
        (or an explicit force phrase on reset).
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canWrite || loading}
          onClick={() => void run('verify')}
          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-navy-500 text-white border-none cursor-pointer disabled:opacity-50"
        >
          {busyKey === 'verify' ? 'Verifying…' : 'Verify all'}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 cursor-pointer"
        >
          Refresh
        </button>
      </div>
      {report?.uncertifiedProtectedKeys && report.uncertifiedProtectedKeys.length > 0 && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Uncertified protected keys: {report.uncertifiedProtectedKeys.join(', ')}
        </p>
      )}
      {report?.allProtectedCertified && (
        <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
          All protected keys certified — archive/retire may proceed per key.
        </p>
      )}
      <div className="space-y-2">
        {(report?.checks || []).map(c => (
          <div key={c.blobKey} className="border border-gray-100 rounded-lg p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[12px] font-semibold text-gray-800">{c.blobKey}</p>
                <p className="text-[11px] text-gray-400">
                  blob {c.blobCount ?? '—'} · {c.prismaTable} {c.prismaCount ?? '—'} ·{' '}
                  <span className={c.parityOk ? 'text-emerald-600' : 'text-red-600'}>
                    {c.parityOk ? 'parity OK' : 'blocked'}
                  </span>
                </p>
                {c.blockedReason && <p className="text-[10px] text-red-500 mt-1">{c.blockedReason}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={!canWrite || !c.parityOk || busyKey === c.blobKey}
                  onClick={() => void run('certify', c.blobKey)}
                  className="text-[10px] font-semibold px-2 py-1 rounded bg-white border border-gray-200 cursor-pointer disabled:opacity-40"
                >
                  Certify
                </button>
                <button
                  type="button"
                  disabled={!canWrite || busyKey === c.blobKey}
                  onClick={() => void run('archive', c.blobKey)}
                  className="text-[10px] font-semibold px-2 py-1 rounded bg-white border border-gray-200 cursor-pointer disabled:opacity-40"
                >
                  Archive
                </button>
              </div>
            </div>
          </div>
        ))}
        {!report?.checks?.length && !loading && (
          <p className="text-[11px] text-gray-400">Run Verify to compare blob vs Prisma counts.</p>
        )}
      </div>
    </div>
  )
}
