'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { fmtKes } from '@/lib/store'
import { AGENT_TAG, type AgentCommission, type AgentPayout, type AgentSettings } from '@/lib/agents/agent-commissions'

type Agent = { id: string; name: string; phone: string | null; email: string | null; kraPin: string | null }
type Overview = { agents: Agent[]; commissions: AgentCommission[]; payouts: AgentPayout[]; settings: AgentSettings }
type ContactLike = { id: string; name: string; phone?: string; tags?: string[] }
type MoneyAccount = { code: string; name: string }
type Toast = (msg: string, type?: 'error' | 'success' | 'info') => void

const STATUS_LABEL: Record<AgentCommission['status'], string> = {
  pending: 'Waiting for customer payment',
  due: 'Due',
  paid: 'Paid',
  cancelled: 'Cancelled',
}
const STATUS_TONE: Record<AgentCommission['status'], string> = {
  pending: 'bg-[var(--bg-muted)] text-[var(--text-2)]',
  due: 'bg-amber-50 text-amber-900',
  paid: 'bg-emerald-50 text-emerald-800',
  cancelled: 'bg-red-50 text-red-700',
}
const METHOD_LABEL: Record<AgentPayout['method'], string> = { mpesa: 'M-Pesa', bank: 'Bank', cash: 'Cash' }

const today = () => new Date().toISOString().slice(0, 10)

async function readJson<T>(res: Response): Promise<T> {
  const payload = await res.json().catch(() => null) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(payload?.error || `server returned ${res.status}`)
  return payload as T
}

/**
 * Finance → Bills → Agent commissions. Deed Express agents are independent
 * people who bring customers; the commission agreed on the sale becomes due
 * once the customer has paid in full and is paid out daily or weekly.
 */
export default function AgentCommissions({
  showToast,
  contacts,
  moneyAccounts,
}: {
  showToast: Toast
  contacts: ContactLike[]
  moneyAccounts: MoneyAccount[]
}) {
  const [data, setData] = useState<Overview | null>(null)
  const [busy, setBusy] = useState(false)
  const [agentId, setAgentId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [method, setMethod] = useState<AgentPayout['method']>('mpesa')
  const [reference, setReference] = useState('')
  const [paidAt, setPaidAt] = useState(today())
  const [accountCode, setAccountCode] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newAgent, setNewAgent] = useState({ name: '', phone: '', kraPin: '' })
  const [rateInput, setRateInput] = useState('')
  const [showBill, setShowBill] = useState(false)
  const emptyBill = { agentId: '', amount: '', date: today(), saleRef: '', customerName: '', description: '' }
  const [bill, setBill] = useState(emptyBill)
  const [billFile, setBillFile] = useState<File | null>(null)
  const [billFileKey, setBillFileKey] = useState(0)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const next = await readJson<Overview>(await fetch('/api/agents', { cache: 'no-store' }))
      setData(next)
      setRateInput(String(next.settings.withholdingRate))
    } catch (err) {
      showToast(`Could not load agent commissions: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [showToast])

  useEffect(() => { void load() }, [load])

  const totals = useMemo(() => {
    const byAgent = new Map<string, { due: number; pending: number; paid: number }>()
    for (const row of data?.commissions ?? []) {
      const t = byAgent.get(row.agentId) ?? { due: 0, pending: 0, paid: 0 }
      if (row.status === 'due') t.due += row.amount
      else if (row.status === 'pending') t.pending += row.amount
      else if (row.status === 'paid') t.paid += row.amount
      byAgent.set(row.agentId, t)
    }
    return byAgent
  }, [data])

  const agentRows = useMemo(() => {
    const known = new Map((data?.agents ?? []).map(a => [a.id, a.name]))
    for (const row of data?.commissions ?? []) if (!known.has(row.agentId)) known.set(row.agentId, row.agentName)
    return [...known.entries()].map(([id, name]) => ({ id, name, ...(totals.get(id) ?? { due: 0, pending: 0, paid: 0 }) }))
      .sort((a, b) => b.due - a.due || a.name.localeCompare(b.name))
  }, [data, totals])

  const lines = useMemo(
    () => (data?.commissions ?? []).filter(r => r.agentId === agentId)
      .sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'due' ? -1 : b.status === 'due' ? 1 : 0)),
    [data, agentId],
  )
  const payouts = useMemo(() => (data?.payouts ?? []).filter(p => p.agentId === agentId).slice().reverse(), [data, agentId])

  const settings = data?.settings
  const owed = lines.filter(r => r.status === 'due' && r.amount < 0)
  const chosen = lines.filter(r => selected.has(r.id))
  const gross = [...chosen, ...owed.filter(r => !selected.has(r.id))].reduce((s, r) => s + r.amount, 0)
  const wht = settings?.withholdingEnabled ? Math.round(gross * settings.withholdingRate) / 100 : 0
  const net = gross - wht

  const pickAgent = (id: string) => {
    setAgentId(id)
    const due = (data?.commissions ?? []).filter(r => r.agentId === id && r.status === 'due' && r.amount > 0)
    setSelected(new Set(due.map(r => r.id)))
    setReference('')
  }

  const saveSettings = async (next: Partial<AgentSettings>) => {
    if (!settings) return
    try {
      const out = await readJson<{ settings: AgentSettings }>(await fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, ...next }),
      }))
      setData(d => (d ? { ...d, settings: out.settings } : d))
      setRateInput(String(out.settings.withholdingRate))
      showToast('Agent payout settings saved', 'success')
    } catch (err) {
      showToast(`Could not save settings: ${err instanceof Error ? err.message : 'error'}`, 'error')
    }
  }

  const addAgent = async () => {
    const name = newAgent.name.trim()
    const phone = newAgent.phone.trim()
    if (!name || !phone) { showToast('Agent name and phone are required', 'error'); return }
    const existing = contacts.find(c => c.phone && c.phone.replace(/\D/g, '').slice(-9) === phone.replace(/\D/g, '').slice(-9))
    const tags = [...new Set([...(existing?.tags ?? []), AGENT_TAG])]
    setBusy(true)
    try {
      await readJson(await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(existing
          ? { ...existing, tags, isVendor: true, ...(newAgent.kraPin.trim() ? { kraPin: newAgent.kraPin.trim() } : {}) }
          : { name, phone, type: 'individual', kraPin: newAgent.kraPin.trim() || undefined, tags, isVendor: true, isCustomer: false }),
      }))
      showToast(existing ? `${existing.name} is now a Deed Express agent` : `${name} added as a Deed Express agent`, 'success')
      setNewAgent({ name: '', phone: '', kraPin: '' })
      setShowAdd(false)
      await load()
    } catch (err) {
      showToast(`Could not add agent: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const addBill = async () => {
    if (!bill.agentId) { showToast('Choose the agent', 'error'); return }
    if (!(Number(bill.amount) > 0)) { showToast('Enter the commission amount', 'error'); return }
    const form = new FormData()
    for (const [k, v] of Object.entries(bill)) form.append(k, v)
    if (billFile) form.append('file', billFile)
    setBusy(true)
    try {
      const out = await readJson<{ commission: AgentCommission }>(await fetch('/api/agents/commissions', { method: 'POST', body: form }))
      showToast(`Commission bill ${out.commission.id} added — ${fmtKes(out.commission.amount)} due to ${out.commission.agentName}`, 'success')
      setBill(emptyBill)
      setBillFile(null)
      setBillFileKey(k => k + 1)
      setShowBill(false)
      await load()
      setAgentId(out.commission.agentId)
      setSelected(s => new Set([...s, out.commission.id]))
    } catch (err) {
      showToast(`Could not add commission bill: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const cancelBill = async (row: AgentCommission) => {
    if (!window.confirm(`Cancel commission bill ${row.id} (${fmtKes(row.amount)}) for ${row.agentName}? Its journal is reversed.`)) return
    setBusy(true)
    try {
      await readJson(await fetch(`/api/agents/commissions?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' }))
      showToast(`Commission bill ${row.id} cancelled`, 'success')
      setSelected(s => { const next = new Set(s); next.delete(row.id); return next })
      await load()
    } catch (err) {
      showToast(`Could not cancel: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const pay = async () => {
    if (!chosen.length) { showToast('Tick the commission lines to pay', 'error'); return }
    if (method === 'mpesa' && !reference.trim()) { showToast('Enter the M-Pesa transaction code', 'error'); return }
    const agent = agentRows.find(a => a.id === agentId)
    const whtLine = wht > 0 ? `\nWithholding tax ${fmtKes(wht)} kept for KRA.` : ''
    if (!window.confirm(`Pay ${agent?.name ?? 'agent'} ${fmtKes(net)} by ${METHOD_LABEL[method]}?${whtLine}`)) return
    setBusy(true)
    try {
      const out = await readJson<{ payout: AgentPayout }>(await fetch('/api/agents/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          commissionIds: chosen.map(r => r.id),
          method,
          reference: reference.trim(),
          paidAt,
          bankAccountCode: accountCode || undefined,
        }),
      }))
      showToast(`Payout ${out.payout.ref} recorded — ${fmtKes(out.payout.net)}`, 'success')
      setReference('')
      await load()
      setSelected(new Set())
    } catch (err) {
      showToast(`Could not record payout: ${err instanceof Error ? err.message : 'error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const defaultAccountLabel = method === 'bank' ? '2201 - ABSA Bank (default)' : '2211 - Petty Cash / Mobile Money (default)'

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-primary-600">Deed Express</p>
          <h2 className="mt-1 text-lg font-extrabold text-text-1">Agent commissions</h2>
          <p className="mt-1 max-w-3xl text-xs text-text-3">
            The commission agreed on a sale becomes due when the customer has paid in full (expense 6403, owed in 3314).
            A refund before payout cancels it; a refund after payout is recovered from the agent&apos;s next payout.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary text-[11px]" disabled={busy} onClick={() => { setShowBill(v => !v); setBill(b => ({ ...b, agentId: b.agentId || agentId })) }}>Add commission bill</button>
          <button type="button" className="btn-secondary text-[11px]" disabled={busy} onClick={() => setShowAdd(v => !v)}>Add agent</button>
          <button type="button" className="btn-secondary text-[11px]" disabled={busy} onClick={() => void load()}>{busy ? 'Loading…' : 'Refresh'}</button>
        </div>
      </div>

      {settings && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border-lt bg-card p-3 text-xs">
          <label className="flex items-center gap-2 font-semibold text-text-1">
            <input
              type="checkbox"
              checked={settings.withholdingEnabled}
              onChange={e => void saveSettings({ withholdingEnabled: e.target.checked })}
            />
            Deduct withholding tax from payouts
          </label>
          <label className="flex items-center gap-1 text-text-2">
            Rate
            <input
              className="form-input w-16 text-xs"
              type="number"
              min={0.1}
              max={99}
              step={0.5}
              value={rateInput}
              onChange={e => setRateInput(e.target.value)}
              onBlur={() => { if (Number(rateInput) !== settings.withholdingRate) void saveSettings({ withholdingRate: Number(rateInput) }) }}
            />%
          </label>
          <span className="text-text-3">Withheld tax is credited to 3307 Withholding Tax Payable for remittance to KRA.</span>
        </div>
      )}

      {showAdd && (
        <div className="grid gap-2 rounded-2xl border border-border-lt bg-card p-3 sm:grid-cols-4">
          <input className="form-input text-xs" placeholder="Full name" aria-label="Agent name" value={newAgent.name} onChange={e => setNewAgent(a => ({ ...a, name: e.target.value }))} />
          <input className="form-input text-xs" placeholder="Phone (M-Pesa)" aria-label="Agent phone" value={newAgent.phone} onChange={e => setNewAgent(a => ({ ...a, phone: e.target.value }))} />
          <input className="form-input text-xs" placeholder="KRA PIN (optional)" aria-label="Agent KRA PIN" value={newAgent.kraPin} onChange={e => setNewAgent(a => ({ ...a, kraPin: e.target.value }))} />
          <button type="button" className="btn-primary text-[11px]" disabled={busy} onClick={() => void addAgent()}>Save agent</button>
        </div>
      )}

      {showBill && (
        <div className="space-y-2 rounded-2xl border border-border-lt bg-card p-3">
          <p className="text-xs font-extrabold text-text-1">Commission bill</p>
          <p className="text-[11px] text-text-3">For a commission agreed outside a sale order or the till. It is owed to the agent at once and paid with their next payout.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <select className="form-input text-xs" aria-label="Agent" value={bill.agentId} onChange={e => setBill(b => ({ ...b, agentId: e.target.value }))}>
              <option value="">Choose agent…</option>
              {(data?.agents ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <input className="form-input text-xs" type="number" min={1} placeholder="Commission (KES)" aria-label="Commission amount" value={bill.amount} onChange={e => setBill(b => ({ ...b, amount: e.target.value }))} />
            <input className="form-input text-xs" type="date" aria-label="Bill date" value={bill.date} onChange={e => setBill(b => ({ ...b, date: e.target.value }))} />
            <input className="form-input text-xs" placeholder="Sale / agent invoice no. (optional)" aria-label="Sale or invoice reference" value={bill.saleRef} onChange={e => setBill(b => ({ ...b, saleRef: e.target.value }))} />
            <input className="form-input text-xs" placeholder="Customer (optional)" aria-label="Customer" value={bill.customerName} onChange={e => setBill(b => ({ ...b, customerName: e.target.value }))} />
            <input className="form-input text-xs" placeholder="What it is for (optional)" aria-label="Description" value={bill.description} onChange={e => setBill(b => ({ ...b, description: e.target.value }))} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] text-text-2">
              Attachment (optional) — agent&apos;s invoice, receipt…
              <input key={billFileKey} className="mt-1 block text-[11px]" type="file" aria-label="Attachment" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,application/pdf,image/*" onChange={e => setBillFile(e.target.files?.[0] ?? null)} />
            </label>
            <div className="ml-auto flex gap-2">
              <button type="button" className="btn-secondary text-[11px]" disabled={busy} onClick={() => setShowBill(false)}>Cancel</button>
              <button type="button" className="btn-primary text-[11px]" disabled={busy} onClick={() => void addBill()}>{busy ? 'Saving…' : 'Save bill'}</button>
            </div>
          </div>
          {(data?.agents ?? []).length === 0 && <p className="text-[11px] text-amber-800">No agents yet — add the agent first.</p>}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border-lt bg-card">
        <table className="w-full text-left text-xs">
          <thead className="text-text-3">
            <tr>
              <th className="px-3 py-2 font-semibold">Agent</th>
              <th className="px-3 py-2 text-right font-semibold">Due now</th>
              <th className="px-3 py-2 text-right font-semibold">Waiting for payment</th>
              <th className="px-3 py-2 text-right font-semibold">Paid to date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-lt)]">
            {agentRows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-3 text-text-3">No agents yet. Add one, then pick them on a sale order or at the till under “Brought by agent”.</td></tr>
            )}
            {agentRows.map(a => (
              <tr
                key={a.id}
                className={`cursor-pointer hover:bg-[var(--bg-muted)] ${a.id === agentId ? 'bg-[var(--primary-light)]' : ''}`}
                onClick={() => pickAgent(a.id)}
              >
                <td className="px-3 py-2 font-semibold text-text-1">{a.name}</td>
                <td className="px-3 py-2 text-right font-bold">{fmtKes(a.due)}</td>
                <td className="px-3 py-2 text-right text-text-2">{fmtKes(a.pending)}</td>
                <td className="px-3 py-2 text-right text-text-2">{fmtKes(a.paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {agentId && (
        <div className="space-y-3 rounded-2xl border border-border-lt bg-card p-4">
          <h3 className="text-sm font-extrabold text-text-1">{agentRows.find(a => a.id === agentId)?.name}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-text-3">
                <tr>
                  <th className="py-1.5 pr-2" />
                  <th className="py-1.5 pr-3 font-semibold">Sale</th>
                  <th className="py-1.5 pr-3 font-semibold">Customer</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Sale total</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Commission</th>
                  <th className="py-1.5 pr-3 font-semibold">Status</th>
                  <th className="py-1.5 font-semibold">Earned / paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-lt)]">
                {lines.length === 0 && <tr><td colSpan={7} className="py-2 text-text-3">No sales for this agent yet.</td></tr>}
                {lines.map(r => {
                  const payable = r.status === 'due' && r.amount > 0
                  const forced = r.status === 'due' && r.amount < 0
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="py-1.5 pr-2">
                        {(payable || forced) && (
                          <input
                            type="checkbox"
                            aria-label={`Pay ${r.sourceRef}`}
                            checked={forced || selected.has(r.id)}
                            disabled={forced}
                            onChange={e => setSelected(s => {
                              const next = new Set(s)
                              if (e.target.checked) next.add(r.id); else next.delete(r.id)
                              return next
                            })}
                          />
                        )}
                      </td>
                      <td className="py-1.5 pr-3 font-mono">
                        {r.sourceRef}{r.clawbackOf && <span className="ml-1 font-sans text-red-700">refund recovery</span>}
                        {r.sourceKind === 'manual' && (
                          <span className="block font-sans text-text-3">
                            Bill {r.id}{r.description ? ` · ${r.description}` : ''}
                            {r.attachment && <> · <a className="text-primary-600 underline" href={`/api/agents/commissions?file=${encodeURIComponent(r.id)}`} target="_blank" rel="noreferrer">{r.attachment.name}</a></>}
                            {r.status === 'due' && <> · <button type="button" className="text-red-700 underline" disabled={busy} onClick={() => void cancelBill(r)}>Cancel bill</button></>}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">{r.customerName || '—'}</td>
                      <td className="py-1.5 pr-3 text-right">{r.saleTotal ? fmtKes(r.saleTotal) : '—'}</td>
                      <td className={`py-1.5 pr-3 text-right font-bold ${r.amount < 0 ? 'text-red-700' : ''}`}>{fmtKes(r.amount)}</td>
                      <td className="py-1.5 pr-3">
                        <span className={`rounded-md px-1.5 py-0.5 font-bold ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                        {r.flag && <span className="mt-0.5 block text-amber-800">{r.flag}</span>}
                      </td>
                      <td className="py-1.5 text-text-2">{r.paidAt ?? r.earnedAt ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {lines.some(r => r.status === 'due') && (
            <div className="grid gap-2 border-t border-border-lt pt-3 sm:grid-cols-5">
              <select className="form-input text-xs" aria-label="Payment method" value={method} onChange={e => setMethod(e.target.value as AgentPayout['method'])}>
                <option value="mpesa">M-Pesa</option>
                <option value="bank">Bank transfer</option>
                <option value="cash">Cash</option>
              </select>
              <input
                className="form-input text-xs"
                aria-label="Payment reference"
                placeholder={method === 'mpesa' ? 'M-Pesa code' : 'Reference'}
                value={reference}
                onChange={e => setReference(e.target.value.toUpperCase())}
              />
              <input className="form-input text-xs" type="date" aria-label="Payment date" value={paidAt} onChange={e => setPaidAt(e.target.value)} />
              <select className="form-input text-xs" aria-label="Pay from account" value={accountCode} onChange={e => setAccountCode(e.target.value)}>
                <option value="">{defaultAccountLabel}</option>
                {moneyAccounts.map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
              </select>
              <button type="button" className="btn-primary text-[11px]" disabled={busy || chosen.length === 0 || gross <= 0} onClick={() => void pay()}>
                {busy ? 'Saving…' : `Pay ${fmtKes(Math.max(0, net))}`}
              </button>
              <p className="text-[11px] text-text-3 sm:col-span-5">
                Commission {fmtKes(gross)}{wht > 0 ? ` − withholding tax ${fmtKes(wht)}` : ''} = paid to agent {fmtKes(Math.max(0, net))}.
                {owed.length > 0 && ' Refund recoveries owed by this agent are always deducted.'}
              </p>
            </div>
          )}

          {payouts.length > 0 && (
            <div className="border-t border-border-lt pt-3">
              <h4 className="mb-1 text-xs font-extrabold text-text-1">Payout statements</h4>
              <table className="w-full text-left text-[11px]">
                <thead className="text-text-3">
                  <tr>
                    <th className="py-1 pr-3 font-semibold">Payout</th>
                    <th className="py-1 pr-3 font-semibold">Date</th>
                    <th className="py-1 pr-3 font-semibold">Method</th>
                    <th className="py-1 pr-3 text-right font-semibold">Commission</th>
                    <th className="py-1 pr-3 text-right font-semibold">WHT</th>
                    <th className="py-1 pr-3 text-right font-semibold">Paid</th>
                    <th className="py-1 font-semibold">Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-lt)]">
                  {payouts.map(p => (
                    <tr key={p.id}>
                      <td className="py-1 pr-3 font-mono">{p.ref}</td>
                      <td className="py-1 pr-3">{p.paidAt}</td>
                      <td className="py-1 pr-3">{METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ''}</td>
                      <td className="py-1 pr-3 text-right">{fmtKes(p.gross)}</td>
                      <td className="py-1 pr-3 text-right">{fmtKes(p.withholdingTax)}</td>
                      <td className="py-1 pr-3 text-right font-bold">{fmtKes(p.net)}</td>
                      <td className="py-1 text-text-2">
                        {(data?.commissions ?? []).filter(r => p.commissionIds.includes(r.id)).map(r => r.sourceRef).join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
