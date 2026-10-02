'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFinanceStore, fmtDate, fmtKes } from '@/lib/store'
import { loanOutstanding, interestPaid, principalRepaid, type Loan } from '@/lib/loans/loans'

const today = () => new Date().toISOString().slice(0, 10)

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  return data as T
}

export default function Loans() {
  const { bankAccounts, showToast } = useFinanceStore()
  const banks = useMemo(() => bankAccounts.filter(a => a.active), [bankAccounts])
  const [loans, setLoans] = useState<Loan[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [repayFor, setRepayFor] = useState<Loan | null>(null)

  const [nl, setNl] = useState({ lender: '', principal: '', interestRate: '', termMonths: '', startDate: today(), bankAccountId: '', notes: '', drawdownBooked: false })
  const [rp, setRp] = useState({ date: today(), principal: '', interest: '', bankAccountId: '' })

  const load = useCallback(async () => {
    try { setLoans((await api<{ loans: Loan[] }>('/api/loans')).loans) }
    catch (e) { setLoans([]); showToast(e instanceof Error ? e.message : 'Could not load loans', 'error') }
  }, [showToast])
  useEffect(() => { void load() }, [load])

  const totals = useMemo(() => ({
    owed: (loans ?? []).reduce((s, l) => s + loanOutstanding(l), 0),
    interest: (loans ?? []).reduce((s, l) => s + interestPaid(l), 0),
  }), [loans])

  async function createLoan() {
    setBusy(true)
    try {
      await api('/api/loans', {
        method: 'POST',
        body: JSON.stringify({
          lender: nl.lender, principal: Number(nl.principal), startDate: nl.startDate,
          interestRate: nl.interestRate === '' ? undefined : Number(nl.interestRate),
          termMonths: nl.termMonths === '' ? undefined : Number(nl.termMonths),
          bankAccountId: nl.bankAccountId || undefined, notes: nl.notes || undefined,
          drawdownBooked: nl.drawdownBooked,
        }),
      })
      showToast('Loan recorded', 'success')
      setShowNew(false)
      setNl({ lender: '', principal: '', interestRate: '', termMonths: '', startDate: today(), bankAccountId: '', notes: '', drawdownBooked: false })
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not record the loan', 'error') }
    finally { setBusy(false) }
  }

  async function repay() {
    if (!repayFor) return
    setBusy(true)
    try {
      await api(`/api/loans/${repayFor.id}/repay`, {
        method: 'POST',
        body: JSON.stringify({
          date: rp.date, principal: Number(rp.principal || 0), interest: Number(rp.interest || 0),
          bankAccountId: rp.bankAccountId || undefined,
        }),
      })
      showToast('Repayment posted', 'success')
      setRepayFor(null)
      setRp({ date: today(), principal: '', interest: '', bankAccountId: '' })
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not post the repayment', 'error') }
    finally { setBusy(false) }
  }

  const input = 'form-input w-full text-[12px]'
  const label = 'text-[11px] font-semibold block mb-1'

  return (
    <div className="mx-auto w-[min(1100px,calc(100%-2rem))] py-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-lg font-black">Loans</h1>
          <p className="text-[12px] opacity-70">A loan is a liability (3401 Bank Loan). Receiving it is not income; repaying principal is not an expense; interest is (6701).</p>
        </div>
        <button className="btn-primary text-[12px] px-4 min-h-10" onClick={() => setShowNew(true)}>Record a loan</button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="rounded-xl border p-3"><p className="text-[10px] uppercase font-bold opacity-60">Principal still owed</p><p className="text-lg font-black">{fmtKes(totals.owed)}</p></div>
        <div className="rounded-xl border p-3"><p className="text-[10px] uppercase font-bold opacity-60">Interest paid to date</p><p className="text-lg font-black">{fmtKes(totals.interest)}</p></div>
      </div>

      {loans === null ? <p className="text-[12px]">Loading…</p> : loans.length === 0 ? (
        <p className="text-[12px] opacity-70">No loans recorded yet.</p>
      ) : (
        <div className="space-y-3">
          {loans.map(l => (
            <div key={l.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-black text-[13px]">{l.ref} · {l.lender} <span className={`ml-2 text-[10px] font-bold ${l.status === 'settled' ? 'text-emerald-600' : 'text-amber-600'}`}>{l.status === 'settled' ? 'SETTLED' : 'ACTIVE'}</span></p>
                  <p className="text-[11px] opacity-70">Started {fmtDate(l.startDate)}{l.interestRate != null ? ` · ${l.interestRate}% p.a.` : ''}{l.termMonths ? ` · ${l.termMonths} months` : ''}{l.drawdownBooked ? ' · receipt booked elsewhere' : ''}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase font-bold opacity-60">Owed</p>
                  <p className="font-black">{fmtKes(loanOutstanding(l))} <span className="text-[11px] font-semibold opacity-60">of {fmtKes(l.principal)}</span></p>
                </div>
                {l.status === 'active' && <button className="btn-secondary text-[12px] px-3 min-h-9" onClick={() => { setRepayFor(l); setRp(r => ({ ...r, bankAccountId: l.bankAccountId ?? '' })) }}>Record repayment</button>}
              </div>
              {l.repayments.length > 0 && (
                <table className="w-full text-[11px] mt-3">
                  <thead><tr className="text-left opacity-60"><th>Date</th><th>Ref</th><th className="text-right">Principal</th><th className="text-right">Interest</th></tr></thead>
                  <tbody>{l.repayments.map(r => (
                    <tr key={r.id}><td>{fmtDate(r.date)}</td><td>{r.ref}</td><td className="text-right">{fmtKes(r.principal)}</td><td className="text-right">{fmtKes(r.interest)}</td></tr>
                  ))}</tbody>
                  <tfoot><tr className="font-bold"><td colSpan={2}>Total</td><td className="text-right">{fmtKes(principalRepaid(l))}</td><td className="text-right">{fmtKes(interestPaid(l))}</td></tr></tfoot>
                </table>
              )}
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Record a loan">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 space-y-3 max-h-[90vh] overflow-auto">
            <h2 className="font-black">Record a loan</h2>
            <div><label className={label}>Lender *</label><input className={input} value={nl.lender} onChange={e => setNl(f => ({ ...f, lender: e.target.value }))} placeholder="e.g. NCBA Bank" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Amount received (KSh) *</label><input type="number" className={input} value={nl.principal} onChange={e => setNl(f => ({ ...f, principal: e.target.value }))} /></div>
              <div><label className={label}>Date received *</label><input type="date" className={input} value={nl.startDate} onChange={e => setNl(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div><label className={label}>Interest rate % p.a.</label><input type="number" className={input} value={nl.interestRate} onChange={e => setNl(f => ({ ...f, interestRate: e.target.value }))} /></div>
              <div><label className={label}>Term (months)</label><input type="number" className={input} value={nl.termMonths} onChange={e => setNl(f => ({ ...f, termMonths: e.target.value }))} /></div>
            </div>
            <div><label className={label}>Paid into</label>
              <select className={input} value={nl.bankAccountId} onChange={e => setNl(f => ({ ...f, bankAccountId: e.target.value }))}>
                <option value="">Select bank / cash account</option>
                {banks.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></div>
            <div><label className={label}>Notes</label><input className={input} value={nl.notes} onChange={e => setNl(f => ({ ...f, notes: e.target.value }))} /></div>
            <label className="flex items-start gap-2 text-[11px]"><input type="checkbox" checked={nl.drawdownBooked} onChange={e => setNl(f => ({ ...f, drawdownBooked: e.target.checked }))} />
              <span>The money was already booked in the books (existing loan). Record it here without posting the receipt again.</span></label>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary text-[12px] px-3 min-h-9" onClick={() => setShowNew(false)} disabled={busy}>Cancel</button>
              <button className="btn-primary text-[12px] px-4 min-h-9" onClick={createLoan} disabled={busy}>{busy ? 'Saving…' : 'Save loan'}</button>
            </div>
          </div>
        </div>
      )}

      {repayFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Record repayment">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 space-y-3">
            <h2 className="font-black">Repayment — {repayFor.ref} · {repayFor.lender}</h2>
            <p className="text-[11px] opacity-70">Still owed: {fmtKes(loanOutstanding(repayFor))}. Split the instalment from the bank statement into principal and interest.</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Date *</label><input type="date" className={input} value={rp.date} onChange={e => setRp(f => ({ ...f, date: e.target.value }))} /></div>
              <div><label className={label}>Paid from</label>
                <select className={input} value={rp.bankAccountId} onChange={e => setRp(f => ({ ...f, bankAccountId: e.target.value }))}>
                  <option value="">Select account</option>
                  {banks.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select></div>
              <div><label className={label}>Principal (KSh)</label><input type="number" className={input} value={rp.principal} onChange={e => setRp(f => ({ ...f, principal: e.target.value }))} /></div>
              <div><label className={label}>Interest (KSh)</label><input type="number" className={input} value={rp.interest} onChange={e => setRp(f => ({ ...f, interest: e.target.value }))} /></div>
            </div>
            <p className="text-[11px] font-semibold">Total leaving the bank: {fmtKes((Number(rp.principal) || 0) + (Number(rp.interest) || 0))}</p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary text-[12px] px-3 min-h-9" onClick={() => setRepayFor(null)} disabled={busy}>Cancel</button>
              <button className="btn-primary text-[12px] px-4 min-h-9" onClick={repay} disabled={busy}>{busy ? 'Posting…' : 'Post repayment'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
