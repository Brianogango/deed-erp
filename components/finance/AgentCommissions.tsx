'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { fmtKes, type CompanySettings } from '@/lib/store'
import { downloadAgentPayoutStatement } from './agent-payout-statement'
import { AGENT_TAG, type AgentCommission, type AgentPayout, type AgentSettings } from '@/lib/agents/agent-commissions'

type Agent = { id: string; name: string; phone: string | null; email: string | null; kraPin: string | null }
type Overview = { agents: Agent[]; commissions: AgentCommission[]; payouts: AgentPayout[]; settings: AgentSettings; paidSoFar?: Record<string, number> }
type ContactLike = { id: string; name: string; phone?: string; tags?: string[] }
/** One of the business's bank/cash accounts (Finance → Bank accounts). */
type MoneyAccount = { id: string; name: string; bankName?: string }
type Toast = (msg: string, type?: 'error' | 'success' | 'info') => void

const STATUS_LABEL: Record<AgentCommission['status'], string> = {
  pending: 'Waiting for customer payment',
  due: 'Due',
  paid: 'Paid',
  cancelled: 'Cancelled',
}
const METHOD_LABEL: Record<AgentPayout['method'], string> = { mpesa: 'M-Pesa', bank: 'Bank', cash: 'Cash' }

const today = () => new Date().toISOString().slice(0, 10)

async function readJson<T>(res: Response): Promise<T> {
  const payload = await res.json().catch(() => null) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(payload?.error || `server returned ${res.status}`)
  return payload as T
}

/**
 * Finance → Bills → Agent commissions. Deed Xpress agents are independent
 * people who bring customers; the commission agreed on the sale becomes due
 * once the customer has paid in full and is paid out daily or weekly.
 */
export default function AgentCommissions({
  showToast,
  contacts,
  moneyAccounts,
  companySettings,
  limited = false,
}: {
  showToast: Toast
  companySettings?: CompanySettings
  contacts: ContactLike[]
  moneyAccounts: MoneyAccount[]
  /** Admin Officer view: add agents, add and cancel commission bills; no payouts or payout settings. */
  limited?: boolean
}) {
  const [data, setData] = useState<Overview | null>(null)
  const [busy, setBusy] = useState(false)
  const [agentId, setAgentId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [method, setMethod] = useState<AgentPayout['method']>('mpesa')
  const [reference, setReference] = useState('')
  const [paidAt, setPaidAt] = useState(today())
  const [accountId, setAccountId] = useState(() => { try { return localStorage.getItem('deed.agentPayout.account') ?? '' } catch { return '' } })
  const chosenAccount = moneyAccounts.find(a => a.id === accountId)
  const [showAdd, setShowAdd] = useState(false)
  const [newAgent, setNewAgent] = useState({ name: '', phone: '', kraPin: '' })
  const [rateInput, setRateInput] = useState('')
  const [showBill, setShowBill] = useState(false)
  const emptyBill = { agentId: '', amount: '', date: today(), saleRef: '', customerName: '', description: '' }
  const [bill, setBill] = useState(emptyBill)
  const [billFile, setBillFile] = useState<File | null>(null)
  const [billFileKey, setBillFileKey] = useState(0)
  const [listFilter, setListFilter] = useState<'due' | 'all'>('due')
  const [search, setSearch] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showAllPayouts, setShowAllPayouts] = useState(false)

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
    const phones = new Map((data?.agents ?? []).map(a => [a.id, a.phone ?? '']))
    const dueCount = new Map<string, number>()
    const lastPaid = new Map<string, string>()
    for (const row of data?.commissions ?? []) if (row.status === 'due' && row.amount > 0) dueCount.set(row.agentId, (dueCount.get(row.agentId) ?? 0) + 1)
    for (const p of data?.payouts ?? []) if ((lastPaid.get(p.agentId) ?? '') < p.paidAt) lastPaid.set(p.agentId, p.paidAt)
    return [...known.entries()].map(([id, name]) => ({
      id, name, phone: phones.get(id) ?? '', dueCount: dueCount.get(id) ?? 0, lastPaid: lastPaid.get(id) ?? '',
      ...(totals.get(id) ?? { due: 0, pending: 0, paid: 0 }),
    }))
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
      showToast(existing ? `${existing.name} is now a Deed Xpress agent` : `${name} added as a Deed Xpress agent`, 'success')
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
    if (!chosenAccount) { showToast('Choose the account the payout was paid from', 'error'); return }
    if (method === 'mpesa' && !reference.trim()) { showToast('Enter the M-Pesa transaction code', 'error'); return }
    const agent = agentRows.find(a => a.id === agentId)
    const whtLine = wht > 0 ? `\nWithholding tax ${fmtKes(wht)} kept for KRA.` : ''
    if (!window.confirm(`Pay ${agent?.name ?? 'agent'} ${fmtKes(net)} by ${METHOD_LABEL[method]} from ${chosenAccount.name}?${whtLine}`)) return
    try { localStorage.setItem('deed.agentPayout.account', chosenAccount.id) } catch { /* convenience only */ }
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
          bankAccountId: chosenAccount.id,
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

  const month = today().slice(0, 7)
  const kpi = useMemo(() => {
    const rows = data?.commissions ?? []
    const payoutsThisMonth = (data?.payouts ?? []).filter(p => String(p.paidAt).slice(0, 7) === month)
    return {
      due: rows.filter(r => r.status === 'due').reduce((s, r) => s + r.amount, 0),
      dueAgents: new Set(rows.filter(r => r.status === 'due' && r.amount > 0).map(r => r.agentId)).size,
      waiting: rows.filter(r => r.status === 'pending').reduce((s, r) => s + r.amount, 0),
      waitingSales: rows.filter(r => r.status === 'pending').length,
      paidMonth: payoutsThisMonth.reduce((s, p) => s + p.net, 0),
      payoutsMonth: payoutsThisMonth.length,
      whtMonth: payoutsThisMonth.reduce((s, p) => s + p.withholdingTax, 0),
    }
  }, [data, month])

  const q = search.trim().toLowerCase()
  const listed = agentRows
    .filter(a => listFilter === 'all' || a.due !== 0 || a.id === agentId)
    .filter(a => !q || a.name.toLowerCase().includes(q) || a.phone.replace(/\s/g, '').includes(q.replace(/\s/g, '')))
  const toPayCount = agentRows.filter(a => a.due !== 0).length
  const agent = agentRows.find(a => a.id === agentId)
  const agentInfo = (data?.agents ?? []).find(a => a.id === agentId)
  const dueLines = lines.filter(r => r.status === 'due')
  const waitingLines = lines.filter(r => r.status === 'pending')
  const doneLines = lines.filter(r => r.status === 'paid' || r.status === 'cancelled')
  const payableIds = dueLines.filter(r => r.amount > 0).map(r => r.id)
  const allTicked = payableIds.length > 0 && payableIds.every(id => selected.has(id))
  const shownPayouts = showAllPayouts ? payouts : payouts.slice(0, 5)
  const recovery = owed.reduce((s, r) => s + r.amount, 0)
  const dateLabel = (d?: string) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—')

  const statement = async (p: AgentPayout) => {
    if (!companySettings) { showToast('Company settings are still loading — try again', 'error'); return }
    try {
      await downloadAgentPayoutStatement({ payout: p, commissions: data?.commissions ?? [], agent: (data?.agents ?? []).find(a => a.id === p.agentId), company: companySettings })
    } catch {
      showToast('Statement could not be made', 'error')
    }
  }

  return (
    <div className="agc">
      <div className="agc-head">
        <div>
          <p className="agc-kicker">Deed Xpress</p>
          <h2 className="agc-title">Agent commissions</h2>
          <p className="agc-lede">Earned when the customer pays in full (6403, owed in 3314) · paid out from here · a refund after payout comes off the next one</p>
        </div>
        <div className="agc-actions">
          {settings && !limited && (
            <button type="button" className="agc-settings-btn" aria-expanded={showSettings} onClick={() => setShowSettings(v => !v)}>
              ⚙ Payouts: WHT {settings.withholdingEnabled ? 'on' : 'off'} · {settings.withholdingRate}%
            </button>
          )}
          <button type="button" className="btn-secondary text-[11px]" disabled={busy} onClick={() => setShowAdd(v => !v)}>+ Add agent</button>
          <button type="button" className="btn-primary text-[11px]" disabled={busy} onClick={() => { setShowBill(v => !v); setBill(b => ({ ...b, agentId: b.agentId || agentId })) }}>+ Commission bill</button>
          <button type="button" className="agc-icon-btn" disabled={busy} aria-label="Refresh" title="Refresh" onClick={() => void load()}>{busy ? '…' : '↻'}</button>
        </div>
      </div>

      {settings && !limited && showSettings && (
        <div className="agc-panel agc-settings">
          <label className="flex items-center gap-2 font-semibold text-text-1">
            <input type="checkbox" checked={settings.withholdingEnabled} onChange={e => void saveSettings({ withholdingEnabled: e.target.checked })} />
            Deduct withholding tax from payouts
          </label>
          <label className="flex items-center gap-1 text-text-2">
            Rate
            <input
              className="form-input w-16 text-xs" type="number" min={0.1} max={99} step={0.5} value={rateInput}
              onChange={e => setRateInput(e.target.value)}
              onBlur={() => { if (Number(rateInput) !== settings.withholdingRate) void saveSettings({ withholdingRate: Number(rateInput) }) }}
            />%
          </label>
          <span className="text-text-3">Withheld tax is credited to 3307 Withholding Tax Payable for remittance to KRA.</span>
        </div>
      )}

      {showAdd && (
        <div className="agc-panel grid gap-2 sm:grid-cols-4">
          <input className="form-input text-xs" placeholder="Full name" aria-label="Agent name" value={newAgent.name} onChange={e => setNewAgent(a => ({ ...a, name: e.target.value }))} />
          <input className="form-input text-xs" placeholder="Phone (M-Pesa)" aria-label="Agent phone" value={newAgent.phone} onChange={e => setNewAgent(a => ({ ...a, phone: e.target.value }))} />
          <input className="form-input text-xs" placeholder="KRA PIN (optional)" aria-label="Agent KRA PIN" value={newAgent.kraPin} onChange={e => setNewAgent(a => ({ ...a, kraPin: e.target.value }))} />
          <button type="button" className="btn-primary text-[11px]" disabled={busy} onClick={() => void addAgent()}>Save agent</button>
        </div>
      )}

      {showBill && (
        <div className="agc-panel space-y-2">
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

      <div className="agc-tiles">
        <div className="agc-tile"><span className="k">Due now</span><b>{fmtKes(kpi.due)}</b><small>{kpi.dueAgents} {kpi.dueAgents === 1 ? 'agent' : 'agents'} to pay</small></div>
        <div className="agc-tile"><span className="k">Waiting for customer</span><b>{fmtKes(kpi.waiting)}</b><small>{kpi.waitingSales} {kpi.waitingSales === 1 ? 'sale' : 'sales'} not fully paid</small></div>
        <div className="agc-tile"><span className="k">Paid this month</span><b>{fmtKes(kpi.paidMonth)}</b><small>{kpi.payoutsMonth} {kpi.payoutsMonth === 1 ? 'payout' : 'payouts'}</small></div>
        <div className="agc-tile"><span className="k">WHT withheld this month</span><b>{fmtKes(kpi.whtMonth)}</b><small>{settings?.withholdingEnabled ? `at ${settings.withholdingRate}% · for KRA` : 'withholding is off'}</small></div>
      </div>

      <div className="agc-split" data-open={agentId ? '1' : undefined}>
        <section className="agc-card agc-list" aria-label="Agents">
          <div className="agc-list-head">
            <b>Agents</b>
            <span className="agc-seg" role="tablist">
              <button type="button" role="tab" aria-selected={listFilter === 'due'} onClick={() => setListFilter('due')}>To pay · {toPayCount}</button>
              <button type="button" role="tab" aria-selected={listFilter === 'all'} onClick={() => setListFilter('all')}>All · {agentRows.length}</button>
            </span>
          </div>
          <input className="agc-search" placeholder="Search agent or phone…" aria-label="Search agents" value={search} onChange={e => setSearch(e.target.value)} />
          {agentRows.length === 0 && <p className="agc-empty">No agents yet. Add one, then pick them on a sale order or at the till under “Brought by agent”.</p>}
          {agentRows.length > 0 && listed.length === 0 && (
            <p className="agc-empty">{q ? 'No agent matches.' : 'Nobody is owed anything right now.'} <button type="button" className="agc-link" onClick={() => setListFilter('all')}>Show all agents</button></p>
          )}
          {listed.map(a => {
            const nothing = a.due === 0
            return (
              <button key={a.id} type="button" className={`agc-agent${a.id === agentId ? ' is-on' : ''}${nothing ? ' is-dim' : ''}`} onClick={() => pickAgent(a.id)}>
                <span className="agc-av" style={{ background: avatarColor(a.name) }}>{initials(a.name)}</span>
                <span className="agc-agent-main">
                  <span className="agc-agent-name">{a.name}</span>
                  <span className="agc-agent-meta">
                    {[a.phone, a.dueCount ? `${a.dueCount} ${a.dueCount === 1 ? 'sale' : 'sales'} due` : a.lastPaid ? `Last paid ${dateLabel(a.lastPaid)}` : (a.pending ? '' : 'No sales due')].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="agc-agent-amt">
                  {nothing ? <span className="agc-zero">Nothing due</span> : <b>{fmtKes(a.due)}</b>}
                  {a.pending > 0 && <span className="agc-chip agc-chip--wait">+{fmtKes(a.pending)} waiting</span>}
                </span>
              </button>
            )
          })}
        </section>

        <section className="agc-card agc-detail" aria-label="Agent">
          {!agent ? (
            <div className="agc-placeholder">
              <b>Pick an agent</b>
              <span>Their sales due, what is waiting for the customer to pay, and their payouts show here.</span>
            </div>
          ) : (
            <>
              <div className="agc-ahead">
                <button type="button" className="agc-back" onClick={() => setAgentId('')} aria-label="Back to agents">‹</button>
                <span className="agc-av agc-av--lg" style={{ background: avatarColor(agent.name) }}>{initials(agent.name)}</span>
                <div className="min-w-0">
                  <h3>{agent.name}</h3>
                  <p>{[agentInfo?.phone, agentInfo?.kraPin ? `KRA PIN ${agentInfo.kraPin}` : '', agentInfo?.email].filter(Boolean).join(' · ') || 'No contact details'}</p>
                </div>
                <div className="agc-figs">
                  <div><span>Due now</span><b>{fmtKes(agent.due)}</b></div>
                  <div><span>Waiting</span><b>{fmtKes(agent.pending)}</b></div>
                  <div><span>Paid to date</span><b>{fmtKes(agent.paid)}</b></div>
                </div>
              </div>

              <div className="agc-sec">
                <span>Due now · {dueLines.length}</span>
                {!limited && payableIds.length > 1 && (
                  <button type="button" className="agc-link" onClick={() => setSelected(allTicked ? new Set() : new Set(payableIds))}>{allTicked ? 'Clear' : 'Select all'}</button>
                )}
              </div>
              {dueLines.length === 0 ? <p className="agc-empty">Nothing due for {agent.name} right now.</p> : (
                <div className="agc-table-wrap">
                  <table className="agc-table">
                    <thead><tr><th aria-label="Pay" /><th>Sale</th><th>Customer</th><th className="r">Sale total</th><th className="r">Commission</th><th>Earned</th></tr></thead>
                    <tbody>
                      {dueLines.map(r => {
                        const forced = r.amount < 0
                        return (
                          <tr key={r.id}>
                            <td>
                              {!limited && (
                                <input
                                  type="checkbox" aria-label={`Pay ${r.sourceRef}`}
                                  checked={forced || selected.has(r.id)} disabled={forced}
                                  title={forced ? 'A refund recovery is always deducted' : undefined}
                                  onChange={e => setSelected(s => { const next = new Set(s); if (e.target.checked) next.add(r.id); else next.delete(r.id); return next })}
                                />
                              )}
                            </td>
                            <td className="agc-ref" data-label="Sale">
                              {r.sourceKind === 'manual' ? `Bill ${r.id}` : r.sourceRef}
                              {r.clawbackOf && <span className="agc-chip agc-chip--neg">refund recovery</span>}
                              {r.flag && <span className="agc-flag">{r.flag}</span>}
                            </td>
                            <td data-label="Customer">
                              {r.sourceKind === 'manual' ? (
                                <span className="text-text-3">
                                  {[r.sourceRef !== r.id ? r.sourceRef : '', r.customerName, r.description].filter(Boolean).join(' · ') || 'Commission bill'}
                                  {r.attachment && <> · <a className="agc-link" href={`/api/agents/commissions?file=${encodeURIComponent(r.id)}`} target="_blank" rel="noreferrer">📎 {r.attachment.name}</a></>}
                                  <> · <button type="button" className="agc-link agc-link--danger" disabled={busy} onClick={() => void cancelBill(r)}>Cancel bill</button></>
                                </span>
                              ) : (r.customerName || '—')}
                            </td>
                            <td className="r" data-label="Sale total">{r.saleTotal ? fmtKes(r.saleTotal) : '—'}</td>
                            <td className={`r agc-amt${forced ? ' is-neg' : ''}`} data-label="Commission">{forced ? `− ${fmtKes(-r.amount)}` : fmtKes(r.amount)}</td>
                            <td data-label="Earned">{dateLabel(r.earnedAt)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {!limited && dueLines.length > 0 && (
                <div className="agc-paybar">
                  <div className="agc-paymath">
                    <span>
                      {chosen.length} selected · commission {fmtKes(chosen.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0))}
                      {recovery < 0 ? ` − recovery ${fmtKes(-recovery)}` : ''}{wht > 0 ? ` − WHT ${fmtKes(wht)}` : ''}
                    </span>
                    <span>Pay agent <b>{fmtKes(Math.max(0, net))}</b></span>
                  </div>
                  <label className="agc-field"><span>Method</span>
                    <select className="form-input text-xs" value={method} onChange={e => setMethod(e.target.value as AgentPayout['method'])}>
                      <option value="mpesa">M-Pesa</option><option value="bank">Bank transfer</option><option value="cash">Cash</option>
                    </select>
                  </label>
                  <label className="agc-field"><span>{method === 'mpesa' ? 'M-Pesa code' : 'Reference'}</span>
                    <input className="form-input text-xs" value={reference} placeholder={method === 'mpesa' ? 'e.g. TKR8H2LQ0P' : 'Optional'} onChange={e => setReference(e.target.value.toUpperCase())} />
                  </label>
                  <label className="agc-field"><span>Date</span>
                    <input className="form-input text-xs" type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} />
                  </label>
                  <label className="agc-field"><span>Paid from</span>
                    <select className="form-input text-xs" value={chosenAccount ? accountId : ''} onChange={e => setAccountId(e.target.value)}>
                      <option value="">{moneyAccounts.length ? 'Choose account…' : 'No bank/cash accounts — add one in Bank accounts'}</option>
                      {moneyAccounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.bankName && a.bankName !== a.name ? ` · ${a.bankName}` : ''}</option>)}
                    </select>
                  </label>
                  <button type="button" className="agc-pay" disabled={busy || chosen.length === 0 || gross <= 0 || !chosenAccount} onClick={() => void pay()}>
                    {busy ? 'Saving…' : `Pay ${fmtKes(Math.max(0, net))}`}
                  </button>
                </div>
              )}

              {waitingLines.length > 0 && (
                <>
                  <div className="agc-sec"><span>Waiting for the customer to pay · {waitingLines.length}</span></div>
                  <ul className="agc-rows">
                    {waitingLines.map(r => {
                      const paidSoFar = data?.paidSoFar?.[r.id] ?? 0
                      const pct = r.saleTotal > 0 ? Math.min(99, Math.floor((paidSoFar / r.saleTotal) * 100)) : 0
                      return (
                        <li key={r.id}>
                          <span className="agc-ref">{r.sourceRef}</span>
                          <span className="agc-rows-main">
                            {r.customerName || '—'}
                            <small>{paidSoFar > 0 ? ` · paid ${pct}% of ${fmtKes(r.saleTotal)}` : r.saleTotal ? ` · ${fmtKes(r.saleTotal)} not paid yet` : ''}</small>
                            {r.flag && <span className="agc-flag">{r.flag}</span>}
                          </span>
                          <span className="agc-amt">{fmtKes(r.amount)}</span>
                          <span className="agc-chip agc-chip--wait">Waiting</span>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}

              {payouts.length > 0 && (
                <>
                  <div className="agc-sec">
                    <span>Payouts · {payouts.length}</span>
                    {payouts.length > 5 && <button type="button" className="agc-link" onClick={() => setShowAllPayouts(v => !v)}>{showAllPayouts ? 'Show fewer' : 'Show all ›'}</button>}
                  </div>
                  <ul className="agc-rows">
                    {shownPayouts.map(p => (
                      <li key={p.id}>
                        <span className="agc-ref">{p.ref}</span>
                        <span className="agc-rows-main">
                          {dateLabel(p.paidAt)} · {METHOD_LABEL[p.method]}{p.reference ? ` ${p.reference}` : ''}
                          <small>{` · ${p.commissionIds.length} ${p.commissionIds.length === 1 ? 'line' : 'lines'}`}{p.withholdingTax > 0 ? ` · WHT ${fmtKes(p.withholdingTax)}` : ''}{p.paidFrom ? ` · from ${p.paidFrom}` : ''}</small>
                        </span>
                        <span className="agc-amt">{fmtKes(p.net)}</span>
                        <button type="button" className="agc-link" onClick={() => void statement(p)}>Statement ⤓</button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {doneLines.length > 0 && (
                <details className="agc-done">
                  <summary>Paid and cancelled lines · {doneLines.length}</summary>
                  <ul className="agc-rows">
                    {doneLines.map(r => (
                      <li key={r.id}>
                        <span className="agc-ref">{r.sourceKind === 'manual' ? `Bill ${r.id}` : r.sourceRef}</span>
                        <span className="agc-rows-main">{r.customerName || r.description || '—'}<small>{r.paidAt ? ` · paid ${dateLabel(r.paidAt)}` : ''}</small>{r.flag && <span className="agc-flag">{r.flag}</span>}</span>
                        <span className={`agc-amt${r.amount < 0 ? ' is-neg' : ''}`}>{fmtKes(r.amount)}</span>
                        <span className={`agc-chip ${r.status === 'paid' ? 'agc-chip--paid' : 'agc-chip--neg'}`}>{STATUS_LABEL[r.status]}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0d9488', '#4f46e5', '#b45309', '#0891b2']
function avatarColor(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'
}
