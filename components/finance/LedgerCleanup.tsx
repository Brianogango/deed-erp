'use client'

import { useState } from 'react'
import { fmtKes } from '@/lib/store'
import type { DepositDuplicate } from '@/lib/accounting/ledger-cleanup'

type VatGap = { invoiceId: string; ref: string; type: string; vat: number }
type ListGap = { ref: string; date: string; total: number }
type CreditCopy = { ref: string; invoiceRef: string; amount: number; keeps: string }
type CreditUnpaired = { ref: string; invoiceRef: string; amount: number }
type TillGap = { ref: string; date: string; total: number; customer: string; cashier: string; inLedger: boolean }
type Result = { ref: string; status: 'fixed' | 'failed'; message: string }

/**
 * Finance → Accounting → Integrity controls: deposit receipts/refunds booked
 * twice and booked documents with no VAT record (lib/accounting/ledger-cleanup.ts).
 */
export default function LedgerCleanup({ showToast, canApply }: { showToast: (msg: string, type?: 'error' | 'success' | 'info') => void; canApply: boolean }) {
  const [data, setData] = useState<{ deposits: DepositDuplicate[]; vat: VatGap[]; listMissing: ListGap[]; tillMissing: TillGap[]; creditCopies: CreditCopy[]; creditUnpaired: CreditUnpaired[] } | null>(null)
  const [failed, setFailed] = useState<Result[]>([])
  const [busy, setBusy] = useState(false)
  const count = data ? data.deposits.length + data.vat.length + data.listMissing.length + data.tillMissing.length + data.creditCopies.length : 0
  const vatTotal = (data?.vat ?? []).reduce((s, g) => s + g.vat, 0)

  const load = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/accounting/ledger-cleanup', { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
      setData({ deposits: body?.deposits ?? [], vat: body?.vat ?? [], listMissing: body?.listMissing ?? [], tillMissing: body?.tillMissing ?? [], creditCopies: body?.creditCopies ?? [], creditUnpaired: body?.creditUnpaired ?? [] })
    } catch (err) {
      showToast(`Could not check: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const fix = async () => {
    if (!data || !count) return
    if (!window.confirm(`Reverse ${data.deposits.length} duplicate deposit entr${data.deposits.length === 1 ? 'y' : 'ies'} and write VAT records for ${data.vat.length} document${data.vat.length === 1 ? '' : 's'} (${fmtKes(vatTotal)}), and put ${data.listMissing.length} document${data.listMissing.length === 1 ? '' : 's'} missing from the Finance list back on it, reverse ${data.creditCopies.length} customer-credit application${data.creditCopies.length === 1 ? '' : 's'} booked twice, and rebuild ${data.tillMissing.length} till sale invoice${data.tillMissing.length === 1 ? '' : 's'} from their tickets?\n\nThe server's own deposit entry is kept. Reversals are dated today and written to the audit log.`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/accounting/ledger-cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const body = await res.json().catch(() => null) as { results?: Result[]; error?: string } | null
      if (!res.ok) throw new Error(body?.error || `server returned ${res.status}`)
      const results = body?.results ?? []
      setFailed(results.filter(r => r.status === 'failed'))
      const done = results.filter(r => r.status === 'fixed').length
      showToast(`${done} corrected`, results.some(r => r.status === 'failed') ? 'error' : 'success')
      await load()
    } catch (err) {
      showToast(`Could not correct: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-4 mt-4 rounded-2xl border border-border-lt bg-card p-4 sm:mx-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-sm font-extrabold text-text-1">Deposits and credits booked twice, missing VAT records, documents missing from Finance</h3>
          <p className="mt-1 max-w-3xl text-xs text-text-3">
            Deposit receipts and refunds the browser booked beside the server&apos;s own entry, and booked invoices and bills whose VAT
            never reached the VAT records (so the VAT return missed it), and saved documents — often till
            sales (POS) — that the Finance invoice list does not show.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-[11px]" disabled={busy} onClick={() => void load()}>
            {busy && !data ? 'Checking…' : data ? 'Check again' : 'Check'}
          </button>
          {count > 0 && canApply && (
            <button type="button" className="btn-primary text-[11px]" disabled={busy} onClick={() => void fix()}>
              {busy ? 'Correcting…' : `Correct ${count}`}
            </button>
          )}
        </div>
      </div>
      {data && count === 0 && <p className="mt-3 text-xs font-semibold text-emerald-700">Nothing to correct.</p>}
      {data && count > 0 && !canApply && <p className="mt-3 text-xs text-amber-800">A director can apply the correction.</p>}
      {data && data.deposits.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-text-3"><tr><th className="py-1 pr-3">Duplicate entry</th><th className="py-1 pr-3">Date</th><th className="py-1 pr-3 text-right">Amount</th><th className="py-1">Kept</th></tr></thead>
            <tbody>
              {data.deposits.map(d => (
                <tr key={d.ref} className="border-t border-border-lt">
                  <td className="py-1 pr-3 font-mono">{d.ref}</td><td className="py-1 pr-3">{d.date}</td>
                  <td className="py-1 pr-3 text-right">{fmtKes(d.amount)}</td><td className="py-1 font-mono text-text-3">{d.keeps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.vat.length > 0 && (
        <p className="mt-3 text-xs text-text-2">
          {data.vat.length} document{data.vat.length === 1 ? '' : 's'} with {fmtKes(vatTotal)} VAT and no VAT record:{' '}
          <span className="font-mono text-text-3">{data.vat.slice(0, 12).map(g => g.ref).join(', ')}{data.vat.length > 12 ? ` +${data.vat.length - 12} more` : ''}</span>
        </p>
      )}
      {data && data.listMissing.length > 0 && (
        <p className="mt-3 text-xs text-text-2">
          {data.listMissing.length} document{data.listMissing.length === 1 ? '' : 's'} saved but not on the Finance list:{' '}
          <span className="font-mono text-text-3">{data.listMissing.slice(0, 15).map(g => g.ref).join(', ')}{data.listMissing.length > 15 ? ` +${data.listMissing.length - 15} more` : ''}</span>
        </p>
      )}
      {data && data.creditCopies.length > 0 && (
        <p className="mt-3 text-xs text-text-2">
          <span className="font-bold">{data.creditCopies.length} customer-credit application{data.creditCopies.length === 1 ? '' : 's'} booked twice</span> (the browser&apos;s copy is reversed, the payment entry kept):{' '}
          <span className="font-mono text-text-3">{data.creditCopies.map(c => `${c.invoiceRef} ${fmtKes(c.amount)}`).join(', ')}</span>
        </p>
      )}
      {data && data.creditUnpaired.length > 0 && (
        <p className="mt-3 text-xs text-amber-800">
          {data.creditUnpaired.length} credit application{data.creditUnpaired.length === 1 ? '' : 's'} booked only by the browser (not changed — check the customer&apos;s credit):{' '}
          <span className="font-mono">{data.creditUnpaired.map(c => `${c.invoiceRef} ${fmtKes(c.amount)}`).join(', ')}</span>
        </p>
      )}
      {data && data.tillMissing.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <p className="mb-1 text-xs font-bold text-text-2">{data.tillMissing.length} till sale{data.tillMissing.length === 1 ? '' : 's'} with no invoice (rebuilt from the ticket)</p>
          <table className="w-full text-left text-[11px]">
            <thead className="text-text-3"><tr><th className="py-1 pr-3">Ticket</th><th className="py-1 pr-3">Date</th><th className="py-1 pr-3">Customer</th><th className="py-1 pr-3">Cashier</th><th className="py-1 pr-3 text-right">Total</th><th className="py-1">In ledger</th></tr></thead>
            <tbody>
              {data.tillMissing.map(t => (
                <tr key={t.ref} className="border-t border-border-lt">
                  <td className="py-1 pr-3 font-mono">{t.ref}</td><td className="py-1 pr-3">{t.date}</td><td className="py-1 pr-3">{t.customer}</td>
                  <td className="py-1 pr-3">{t.cashier}</td><td className="py-1 pr-3 text-right">{fmtKes(t.total)}</td><td className="py-1">{t.inLedger ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {failed.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-red-700">
          {failed.map(f => <li key={f.ref}>{f.ref}: {f.message}</li>)}
        </ul>
      )}
    </div>
  )
}
