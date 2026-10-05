'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFinanceStore, fmtDate, fmtKes } from '@/lib/store'
import { contactPaymentTermsDays } from '@/lib/due-date'
import {
  buildBillInput, dueOccurrences, isVariable, type Frequency, type RecurringBill,
} from '@/lib/recurring/recurring-bills'

const today = () => new Date().toISOString().slice(0, 10)

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  return data as T
}

type FormLine = { description: string; accountCode: string; amount: string }
const blankLine = (): FormLine => ({ description: '', accountCode: '', amount: '' })

export default function RecurringBills() {
  const { contacts, accounts, createManualInvoice, showToast } = useFinanceStore()
  const vendors = useMemo(() => contacts.filter(c => c.isVendor), [contacts])
  const expenseAccounts = useMemo(
    () => (accounts ?? [])
      .filter((a: { code: string; type?: string; isActive?: boolean }) => /^6\d{3}$/.test(String(a.code)) && a.type === 'expense' && a.isActive !== false)
      .sort((a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code)),
    [accounts],
  )

  const [items, setItems] = useState<RecurringBill[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [amounts, setAmounts] = useState<Record<string, string>>({}) // `${id}|${date}|${idx}`
  const [form, setForm] = useState({
    vendorId: '', title: '', frequency: 'monthly' as Frequency, dayOfMonth: '1',
    startDate: today(), endDate: '', vatRate: '0', notes: '',
  })
  const [lines, setLines] = useState<FormLine[]>([blankLine()])

  const load = useCallback(async () => {
    try { setItems((await api<{ items: RecurringBill[] }>('/api/recurring-bills')).items) }
    catch (e) { setItems([]); showToast(e instanceof Error ? e.message : 'Could not load recurring bills', 'error') }
  }, [showToast])
  useEffect(() => { void load() }, [load])

  async function create() {
    setBusy(true)
    try {
      const vendor = vendors.find(v => v.id === form.vendorId)
      await api('/api/recurring-bills', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          vendorName: vendor?.name ?? '',
          dayOfMonth: Number(form.dayOfMonth),
          vatRate: Number(form.vatRate || 0),
          endDate: form.endDate || undefined,
          lines: lines.map(l => ({ description: l.description, accountCode: l.accountCode || undefined, amount: l.amount === '' ? null : Number(l.amount) })),
        }),
      })
      showToast('Recurring bill saved', 'success')
      setShowNew(false)
      setLines([blankLine()])
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not save', 'error') }
    finally { setBusy(false) }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    try { await api(`/api/recurring-bills/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); await load() }
    catch (e) { showToast(e instanceof Error ? e.message : 'Update failed', 'error') }
  }

  async function generate(t: RecurringBill, billDate: string) {
    const variable: Record<number, number> = {}
    t.lines.forEach((l, i) => {
      if (l.amount == null) variable[i] = Number(amounts[`${t.id}|${billDate}|${i}`] || 0)
    })
    const vendor = vendors.find(v => v.id === t.vendorId)
    const input = buildBillInput(t, billDate, variable, contactPaymentTermsDays(vendor, 30))
    if ('error' in input) { showToast(input.error, 'error'); return }
    setBusy(true)
    try {
      const bill = createManualInvoice('vendor_bill', t.vendorId, t.vendorName, input.dueDate, input.lines, input.vatRate, input.notes, input.billDate)
      if (!bill) return
      await api(`/api/recurring-bills/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'recordGenerated', billDate, invoiceId: bill.id, invoiceRef: bill.ref ?? '' }),
      })
      showToast(`Draft bill created for ${input.period}`, 'success')
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not create the bill', 'error') }
    finally { setBusy(false) }
  }

  const input = 'form-input w-full text-[12px]'
  const label = 'text-[11px] font-semibold block mb-1'
  const asOf = today()

  return (
    <div className="mx-auto w-[min(1100px,calc(100%-2rem))] py-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-lg font-black">Recurring bills</h1>
          <p className="text-[12px] opacity-70">Rent, service charge, electricity, water. Each period you generate a draft vendor bill; nothing posts until you review and post it.</p>
        </div>
        <button className="btn-primary text-[12px] px-4 min-h-10" onClick={() => setShowNew(true)}>New recurring bill</button>
      </div>

      {items === null ? <p className="text-[12px]">Loading…</p> : items.length === 0 ? (
        <p className="text-[12px] opacity-70">No recurring bills yet.</p>
      ) : (
        <div className="space-y-3">
          {items.map(t => {
            const due = dueOccurrences(t, asOf)
            const variable = isVariable(t)
            return (
              <div key={t.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-black text-[13px]">{t.ref} · {t.title} <span className={`ml-2 text-[10px] font-bold ${t.paused ? 'text-amber-600' : 'text-emerald-600'}`}>{t.paused ? 'PAUSED' : 'ACTIVE'}</span></p>
                    <p className="text-[11px] opacity-70">{t.vendorName} · {t.frequency} · day {t.dayOfMonth} · from {fmtDate(t.startDate)}{t.endDate ? ` to ${fmtDate(t.endDate)}` : ''}{variable ? ' · amount varies' : ''}</p>
                    <p className="text-[11px] opacity-70">{t.lines.map(l => `${l.description}${l.amount != null ? ` ${fmtKes(l.amount)}` : ''}`).join(' + ')}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-secondary text-[12px] px-3 min-h-9" onClick={() => patch(t.id, { action: t.paused ? 'resume' : 'pause' })}>{t.paused ? 'Resume' : 'Pause'}</button>
                    <button className="btn-secondary text-[12px] px-3 min-h-9" onClick={() => patch(t.id, { action: 'end', endDate: today() })}>End</button>
                  </div>
                </div>

                {due.length > 0 && (
                  <div className="mt-3 rounded-lg bg-amber-50 p-3 space-y-2">
                    <p className="text-[11px] font-bold">Due now</p>
                    {due.map(d => (
                      <div key={d} className="flex flex-wrap items-center gap-2 text-[12px]">
                        <span className="w-28">{fmtDate(d)}</span>
                        {t.lines.map((l, i) => l.amount == null && (
                          <input key={i} type="number" className="form-input text-[12px] w-32" placeholder={`${l.description} amount`}
                            value={amounts[`${t.id}|${d}|${i}`] ?? ''}
                            onChange={e => setAmounts(a => ({ ...a, [`${t.id}|${d}|${i}`]: e.target.value }))} />
                        ))}
                        <button className="btn-primary text-[12px] px-3 min-h-9" disabled={busy} onClick={() => generate(t, d)}>Create draft bill</button>
                      </div>
                    ))}
                  </div>
                )}

                {t.generated.length > 0 && (
                  <p className="mt-3 text-[11px] opacity-70">Generated: {t.generated.slice(-6).map(g => `${g.period} (${g.invoiceRef || 'draft'})`).join(', ')}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="New recurring bill">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 space-y-3 max-h-[90vh] overflow-auto">
            <h2 className="font-black">New recurring bill</h2>
            <div><label className={label}>Vendor *</label>
              <select className={input} value={form.vendorId} onChange={e => setForm(f => ({ ...f, vendorId: e.target.value }))}>
                <option value="">Select vendor</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div><label className={label}>Title *</label><input className={input} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Office rent" /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className={label}>Frequency</label>
                <select className={input} value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value as Frequency }))}>
                  <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option>
                </select>
              </div>
              <div><label className={label}>Day of month</label><input type="number" className={input} value={form.dayOfMonth} onChange={e => setForm(f => ({ ...f, dayOfMonth: e.target.value }))} /></div>
              <div><label className={label}>VAT %</label><input type="number" className={input} value={form.vatRate} onChange={e => setForm(f => ({ ...f, vatRate: e.target.value }))} /></div>
              <div><label className={label}>Start date *</label><input type="date" className={input} value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div><label className={label}>End date</label><input type="date" className={input} value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            <div className="space-y-2">
              <p className={label}>Lines (leave amount blank if it changes every period, e.g. electricity)</p>
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_90px] gap-2">
                  <input className={input} placeholder="Description" value={l.description} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
                  <select className={input} value={l.accountCode} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, accountCode: e.target.value } : x))}>
                    <option value="">Default expense</option>
                    {expenseAccounts.map((a: { code: string; name: string }) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                  <input type="number" className={input} placeholder="Amount" value={l.amount} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                </div>
              ))}
              <button className="text-[11px] font-bold underline" onClick={() => setLines(ls => [...ls, blankLine()])}>+ Add line</button>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary text-[12px] px-4 min-h-10" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn-primary text-[12px] px-4 min-h-10" disabled={busy} onClick={create}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
