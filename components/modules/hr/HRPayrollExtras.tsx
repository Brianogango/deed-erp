'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Field, Input, Modal, PanelHeader, Select } from '@/components/ui'

const KIND_LABELS: Record<string, string> = {
  earning: 'Bonus or extra pay',
  deduction: 'Deduction',
  benefit_in_kind: 'Non-cash benefit (taxed)',
  insurance_premium: 'Insurance premium (tax relief)',
}
const KIND_HELP: Record<string, string> = {
  earning: 'Added to pay and taxed with it: bonus, commission, overtime, one-off allowance.',
  deduction: 'Taken from net pay after tax: a fine, a recovery, an agreed deduction.',
  benefit_in_kind: 'Taxed but not paid out: use of a company car, free housing. Raises PAYE only.',
  insurance_premium: 'Premium paid for life, health or education insurance. Gives 15% relief on PAYE, up to KSh 5,000 a month.',
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

interface Adjustment { id: string; employeeId: string; employeeName: string; employeeNo: string; year: number; month: number; kind: string; label: string; amount: number; status: string }
interface Loan { id: string; employeeId: string; employeeName: string; employeeNo: string; amount: number; monthlyDeduction: number; outstanding: number; issueDate: string; reason: string; isCleared: boolean; monthsLeft: number }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || 'The request failed')
  return body as T
}

/** One-off pay items for a payroll month. They are picked up when that month's run is created. */
export function PayrollAdjustmentsPanel() {
  const { showToast } = useApp()
  const { employees } = useHrStore()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [items, setItems] = useState<Adjustment[] | null>(null)
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ employeeId: '', kind: 'earning', label: '', amount: '' })

  const load = useCallback(async () => {
    try { setItems(await api<Adjustment[]>(`/api/payroll/adjustments?year=${year}&month=${month}`)) }
    catch (e) { setItems([]); showToast(e instanceof Error ? e.message : 'Could not load pay items', 'error') }
  }, [year, month, showToast])
  useEffect(() => { void load() }, [load])

  const active = useMemo(() => employees.filter(e => e.status === 'active'), [employees])

  const save = async () => {
    const missing: string[] = []
    if (!form.employeeId) missing.push('Employee')
    if (!form.label.trim()) missing.push('Label')
    if (!(Number(form.amount) > 0)) missing.push('Amount')
    if (missing.length) { showToast(`Please fill in: ${missing.join(', ')}`, 'error'); return }
    try {
      await api('/api/payroll/adjustments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, amount: Number(form.amount), year, month }) })
      setForm({ employeeId: '', kind: 'earning', label: '', amount: '' })
      setShow(false)
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not save the item', 'error') }
  }
  const cancel = async (id: string) => {
    try { await api(`/api/payroll/adjustments?id=${id}`, { method: 'DELETE' }); await load() }
    catch (e) { showToast(e instanceof Error ? e.message : 'Could not cancel the item', 'error') }
  }

  return (
    <div className="hr-submodule-panel card overflow-hidden">
      <PanelHeader title="One-off pay and deductions" count={items?.length ?? 0}>
        <select className="form-input text-[11px] py-1.5" value={month} onChange={e => setMonth(Number(e.target.value))}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <input className="form-input text-[11px] py-1.5" style={{ width: 80 }} type="number" value={year} onChange={e => setYear(Number(e.target.value) || year)} />
        <button className="btn-primary text-[11px]" onClick={() => setShow(true)}>+ Add item</button>
      </PanelHeader>
      <div className="p-3 text-xs">
        <p className="mb-2" style={{ color: 'var(--text-4)' }}>Items added here are included when the payroll run for {MONTHS[month - 1]} {year} is created. Add them before creating the run.</p>
        {items === null && <p style={{ color: 'var(--text-4)' }}>Loading…</p>}
        {items?.length === 0 && <p style={{ color: 'var(--text-4)' }}>Nothing added for this month</p>}
        {items?.map(a => (
          <div key={a.id} className="flex items-center justify-between gap-3 py-1.5" style={{ borderTop: '1px solid var(--border-lt)' }}>
            <div>
              <span className="font-semibold">{a.employeeName}</span> · {a.label}
              <div style={{ color: 'var(--text-4)' }}>{KIND_LABELS[a.kind] ?? a.kind} · {a.status === 'applied' ? 'in payroll run' : 'waiting for the run'}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono">{fmtKes(a.amount)}</span>
              {a.status === 'pending' && <button className="text-[10px]" style={{ color: 'var(--danger)' }} onClick={() => cancel(a.id)}>Cancel</button>}
            </div>
          </div>
        ))}
      </div>
      {show && (
        <Modal title="Add pay item" subtitle={`${MONTHS[month - 1]} ${year}`} onClose={() => setShow(false)} width={480}>
          <div className="flex flex-col gap-3">
            <Field label="Employee" required><Select value={form.employeeId} onChange={v => setForm(f => ({ ...f, employeeId: v }))} options={[{ value: '', label: 'Select employee…' }, ...active.map(e => ({ value: e.id, label: `${e.fullName} (${e.employeeNo})` }))]} /></Field>
            <Field label="Type" required><Select value={form.kind} onChange={v => setForm(f => ({ ...f, kind: v }))} options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{KIND_HELP[form.kind]}</p>
            <Field label="Label" required><Input value={form.label} onChange={v => setForm(f => ({ ...f, label: v }))} placeholder="e.g. Q3 sales bonus" /></Field>
            <Field label="Amount (KSh)" required><Input type="number" value={form.amount} onChange={v => setForm(f => ({ ...f, amount: v }))} /></Field>
          </div>
          <div className="hr-modal-actions flex justify-end gap-2 pt-3">
            <button className="btn-secondary px-4 py-2 text-xs" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-xs" onClick={save}>Add item</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/** Staff loans repaid through payroll. */
export function StaffLoansPanel() {
  const { showToast, bankAccounts } = useApp()
  const { employees } = useHrStore()
  const [loans, setLoans] = useState<Loan[] | null>(null)
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ employeeId: '', amount: '', monthlyDeduction: '', issueDate: new Date().toISOString().slice(0, 10), reason: '', bankAccountId: '' })
  const [editing, setEditing] = useState<{ loan: Loan; mode: 'repayment' | 'close'; value: string } | null>(null)

  const load = useCallback(async () => {
    try { setLoans(await api<Loan[]>('/api/employee-loans')) }
    catch (e) { setLoans([]); showToast(e instanceof Error ? e.message : 'Could not load staff loans', 'error') }
  }, [showToast])
  useEffect(() => { void load() }, [load])

  const active = useMemo(() => employees.filter(e => e.status === 'active'), [employees])
  const open = loans?.filter(l => !l.isCleared) ?? []
  const totalOwed = open.reduce((s, l) => s + l.outstanding, 0)

  const save = async () => {
    const missing: string[] = []
    if (!form.employeeId) missing.push('Employee')
    if (!(Number(form.amount) > 0)) missing.push('Loan amount')
    if (!(Number(form.monthlyDeduction) > 0)) missing.push('Monthly repayment')
    if (missing.length) { showToast(`Please fill in: ${missing.join(', ')}`, 'error'); return }
    try {
      await api('/api/employee-loans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, amount: Number(form.amount), monthlyDeduction: Number(form.monthlyDeduction) }) })
      setShow(false)
      setForm(f => ({ ...f, employeeId: '', amount: '', monthlyDeduction: '', reason: '', bankAccountId: '' }))
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not save the loan', 'error') }
  }

  const applyEdit = async () => {
    if (!editing) return
    try {
      await api(`/api/employee-loans/${editing.loan.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing.mode === 'close' ? { action: 'close', reason: editing.value } : { monthlyDeduction: Number(editing.value) }),
      })
      setEditing(null)
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not update the loan', 'error') }
  }

  return (
    <div className="hr-submodule-panel card overflow-hidden">
      <PanelHeader title="Staff loans" count={open.length}>
        <button className="btn-primary text-[11px]" onClick={() => setShow(true)}>+ New loan</button>
      </PanelHeader>
      <div className="p-3 text-xs">
        <p className="mb-2" style={{ color: 'var(--text-4)' }}>Repayments are taken from pay each month and reduce the balance when the payroll run is posted. {open.length > 0 && <>Total owed: <strong>{fmtKes(totalOwed)}</strong>.</>}</p>
        {loans === null && <p style={{ color: 'var(--text-4)' }}>Loading…</p>}
        {loans?.length === 0 && <p style={{ color: 'var(--text-4)' }}>No staff loans</p>}
        {loans?.map(l => (
          <div key={l.id} className="flex items-center justify-between gap-3 py-1.5 flex-wrap" style={{ borderTop: '1px solid var(--border-lt)', opacity: l.isCleared ? 0.6 : 1 }}>
            <div>
              <span className="font-semibold">{l.employeeName}</span> · {fmtKes(l.amount)} issued {fmtDate(l.issueDate)}
              <div style={{ color: 'var(--text-4)' }}>{l.isCleared ? 'Cleared' : `${fmtKes(l.outstanding)} owed · ${fmtKes(l.monthlyDeduction)} a month · about ${l.monthsLeft} months left`}{l.reason ? ` · ${l.reason}` : ''}</div>
            </div>
            {!l.isCleared && (
              <div className="flex gap-2">
                <button className="btn-outline text-[10px]" onClick={() => setEditing({ loan: l, mode: 'repayment', value: String(l.monthlyDeduction) })}>Change repayment</button>
                <button className="btn-outline text-[10px]" onClick={() => setEditing({ loan: l, mode: 'close', value: '' })}>Close loan</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {show && (
        <Modal title="New staff loan" onClose={() => setShow(false)} width={500}>
          <div className="flex flex-col gap-3">
            <Field label="Employee" required><Select value={form.employeeId} onChange={v => setForm(f => ({ ...f, employeeId: v }))} options={[{ value: '', label: 'Select employee…' }, ...active.map(e => ({ value: e.id, label: `${e.fullName} (${e.employeeNo})` }))]} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Loan amount (KSh)" required><Input type="number" value={form.amount} onChange={v => setForm(f => ({ ...f, amount: v }))} /></Field>
              <Field label="Monthly repayment (KSh)" required><Input type="number" value={form.monthlyDeduction} onChange={v => setForm(f => ({ ...f, monthlyDeduction: v }))} /></Field>
            </div>
            <Field label="Date given" required><Input type="date" value={form.issueDate} onChange={v => setForm(f => ({ ...f, issueDate: v }))} /></Field>
            <Field label="Paid from"><Select value={form.bankAccountId} onChange={v => setForm(f => ({ ...f, bankAccountId: v }))} options={[{ value: '', label: 'Do not post a journal (accountant records the payout)' }, ...bankAccounts.filter(a => a.active).map(a => ({ value: a.id, label: a.name }))]} /></Field>
            <Field label="Reason"><Input value={form.reason} onChange={v => setForm(f => ({ ...f, reason: v }))} /></Field>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Choosing an account posts the payout to the ledger (employee loans against that account). Repayments through payroll then clear it. The first repayment is taken from the next payroll run created after the date given.</p>
          </div>
          <div className="hr-modal-actions flex justify-end gap-2 pt-3">
            <button className="btn-secondary px-4 py-2 text-xs" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-xs" onClick={save}>Save loan</button>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title={editing.mode === 'close' ? 'Close loan' : 'Change repayment'} subtitle={editing.loan.employeeName} onClose={() => setEditing(null)} width={420}>
          {editing.mode === 'close'
            ? <Field label="Why is it being closed?" required><Input value={editing.value} onChange={v => setEditing(e => e && { ...e, value: v })} placeholder="e.g. settled in cash, written off" /></Field>
            : <Field label="New monthly repayment (KSh)" required><Input type="number" value={editing.value} onChange={v => setEditing(e => e && { ...e, value: v })} /></Field>}
          {editing.mode === 'close' && <p className="text-[11px] mt-2" style={{ color: 'var(--text-3)' }}>This sets the balance to zero and is recorded in the audit log. It does not post a journal, so tell your accountant if cash was received or the balance was written off.</p>}
          <div className="hr-modal-actions flex justify-end gap-2 pt-3">
            <button className="btn-secondary px-4 py-2 text-xs" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-xs" onClick={applyEdit}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

interface Recipient { payslipId: string; name: string; employeeNo: string; email: string | null }
interface SendResult { payslipId: string; name: string; email: string | null; ok: boolean; error?: string }

/** Email each employee their payslip as a PDF once the run is posted. */
export function EmailPayslipsModal({ runId, runRef, onClose }: { runId: string; runRef: string; onClose: () => void }) {
  const { showToast } = useApp()
  const [recipients, setRecipients] = useState<Recipient[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<SendResult[] | null>(null)

  useEffect(() => {
    api<{ recipients: Recipient[] }>(`/api/payroll/${runId}/email-payslips`)
      .then(d => { setRecipients(d.recipients); setSelected(new Set(d.recipients.filter(r => r.email).map(r => r.payslipId))) })
      .catch(e => showToast(e instanceof Error ? e.message : 'Could not load recipients', 'error'))
  }, [runId, showToast])

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const send = async () => {
    setSending(true)
    try {
      const out = await api<{ results: SendResult[] }>(`/api/payroll/${runId}/email-payslips`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payslipIds: [...selected] }) })
      setResults(out.results)
    } catch (e) { showToast(e instanceof Error ? e.message : 'The payslips could not be sent', 'error') }
    finally { setSending(false) }
  }

  const missing = recipients?.filter(r => !r.email) ?? []
  return (
    <Modal title="Email payslips" subtitle={runRef} onClose={onClose} width={560}>
      {!recipients && <p className="text-xs" style={{ color: 'var(--text-4)' }}>Loading…</p>}
      {recipients && !results && (
        <div className="flex flex-col gap-2 text-xs">
          <p style={{ color: 'var(--text-3)' }}>Each person gets their own payslip as a PDF, sent to their work email (or personal email if there is no work email). The message itself shows no amounts.</p>
          {missing.length > 0 && <p style={{ color: 'var(--warning-text)' }}>No email on file for: {missing.map(m => m.name).join(', ')}. Add one on the employee profile and resend.</p>}
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {recipients.map(r => (
              <label key={r.payslipId} className="flex items-center gap-2 py-1" style={{ opacity: r.email ? 1 : 0.5 }}>
                <input type="checkbox" disabled={!r.email} checked={selected.has(r.payslipId)} onChange={() => toggle(r.payslipId)} />
                <span className="font-semibold">{r.name}</span>
                <span style={{ color: 'var(--text-4)' }}>{r.email ?? 'no email'}</span>
              </label>
            ))}
          </div>
          <div className="hr-modal-actions flex justify-end gap-2 pt-2">
            <button className="btn-secondary px-4 py-2 text-xs" onClick={onClose}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-xs" disabled={sending || selected.size === 0} onClick={send}>{sending ? 'Sending…' : `Send ${selected.size} payslip${selected.size === 1 ? '' : 's'}`}</button>
          </div>
        </div>
      )}
      {results && (
        <div className="flex flex-col gap-2 text-xs">
          <p><strong>{results.filter(r => r.ok).length}</strong> sent, <strong>{results.filter(r => !r.ok).length}</strong> not sent.</p>
          {results.filter(r => !r.ok).map(r => <p key={r.payslipId} style={{ color: 'var(--danger)' }}>{r.name}: {r.error}</p>)}
          <div className="hr-modal-actions flex justify-end pt-2"><button className="btn-primary px-4 py-2 text-xs" onClick={onClose}>Done</button></div>
        </div>
      )}
    </Modal>
  )
}
