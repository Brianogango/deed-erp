'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useApp, useFinanceStore, fmtDate, fmtKes, type Invoice } from '@/lib/store'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { StatusBadge } from '@/components/erp'
import { Field, Input, Modal, Select } from '@/components/ui'
import { useUrlUiState } from '@/hooks/useUrlRecordId'
import { financeInvoicePath } from '@/lib/finance-invoice'
import { invoiceDocState } from '@/lib/odoo-sales-flow'
import { isVendorCreditNote, vendorCreditSummary } from '@/lib/finance/vendor-credit-note'

/**
 * Supplier credit notes (VCN/…): what a supplier owes back or takes off, kept
 * apart from bills. A credit is applied to one of that supplier's unpaid bills
 * (no money moves) or refunded by the supplier (money in).
 */
type Row = { inv: Invoice; amount: number; applied: number; refunded: number; open: number; usedOn: string }
type Action = { kind: 'apply' | 'refund'; row: Row }

const MANAGE_ROLES = ['director', 'finance_officer', 'admin_officer']

export default function SupplierCreditsTab() {
  const { users, currentUserId, showToast } = useApp() as any
  const { invoices, bankAccounts } = useFinanceStore() as any
  const router = useRouter()
  const [search, setSearch] = useUrlUiState('vcQ', '')
  const [status, setStatus] = useUrlUiState('vcStatus', 'open')
  const [action, setAction] = useState<Action | null>(null)
  const [billId, setBillId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('bank_transfer')
  const [bankAccountId, setBankAccountId] = useState('')
  const [reference, setReference] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const user = (users as Array<{ id: string; role?: string }> | undefined)?.find(u => u.id === currentUserId) ?? null
  const canManage = MANAGE_ROLES.includes(String(user?.role ?? ''))

  const rows: Row[] = useMemo(() => (invoices as Invoice[])
    .filter(inv => isVendorCreditNote(inv) && invoiceDocState(inv.status) !== 'cancelled')
    .map(inv => {
      const s = vendorCreditSummary(inv as any, invoices as any)
      return {
        inv,
        amount: s.amount,
        applied: Math.max(0, s.applied - s.refunded),
        refunded: s.refunded,
        open: invoiceDocState(inv.status) === 'posted' ? s.remaining : 0,
        usedOn: s.usedOn.map(u => u.billRef).join(', '),
      }
    })
    .sort((a, b) => String(b.inv.date).localeCompare(String(a.inv.date))), [invoices])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (status === 'open' && !(r.open > 0)) return false
      if (status === 'used' && r.open > 0) return false
      if (status === 'draft' && invoiceDocState(r.inv.status) !== 'draft') return false
      if (!q) return true
      return [r.inv.ref, r.inv.partnerName, r.inv.notes, r.usedOn].some(v => String(v || '').toLowerCase().includes(q))
    })
  }, [rows, search, status])

  const openTotal = rows.reduce((s, r) => s + r.open, 0)
  const suppliers = new Set(rows.filter(r => r.open > 0).map(r => r.inv.partnerId)).size

  const openBillsFor = (credit: Invoice) => (invoices as Invoice[]).filter(b =>
    b.type === 'vendor_bill' && Number(b.total) > 0 && b.partnerId === credit.partnerId
    && invoiceDocState(b.status) === 'posted' && Number(b.total) - Number(b.amountPaid || 0) > 0.009)

  const start = (kind: Action['kind'], row: Row) => {
    setAction({ kind, row })
    const bills = openBillsFor(row.inv)
    setBillId(bills[0]?.id ?? '')
    setAmount(String(kind === 'apply' && bills[0] ? Math.min(row.open, Number(bills[0].total) - Number(bills[0].amountPaid || 0)) : row.open))
    setMethod('bank_transfer'); setBankAccountId(''); setReference(''); setError('')
  }

  const submit = async () => {
    if (!action) return
    const value = Number(amount)
    if (!(value > 0)) { setError('Enter an amount'); return }
    if (value > action.row.open + 0.009) { setError(`Only ${fmtKes(action.row.open)} of this credit is left`); return }
    if (action.kind === 'apply' && !billId) { setError('Pick the bill to use the credit on'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/invoices/${action.row.inv.id}/supplier-credit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action.kind === 'apply'
          ? { action: 'apply', billId, amount: value }
          : { action: 'refund', amount: value, paymentMethod: method, bankAccountId: bankAccountId || undefined, reference: reference || undefined }),
      })
      const data = await res.json().catch(() => null) as { error?: string; applied?: number; refunded?: number; billRef?: string } | null
      if (!res.ok) { setError(data?.error || 'Could not save'); return }
      showToast?.(action.kind === 'apply'
        ? `${fmtKes(data?.applied ?? value)} of ${action.row.inv.ref} used on ${data?.billRef ?? 'the bill'}`
        : `Refund of ${fmtKes(data?.refunded ?? value)} recorded on ${action.row.inv.ref}`)
      setAction(null)
    } catch {
      setError('Could not reach the server — nothing was changed')
    } finally {
      setSaving(false)
    }
  }

  const columns: ColumnDef<Row>[] = [
    {
      key: 'ref', label: 'Credit', priority: 1, width: '130px',
      render: r => <span className="font-mono text-[11px] font-semibold text-primary-600">{r.inv.ref}</span>,
      exportValue: r => r.inv.ref,
    },
    {
      key: 'supplier', label: 'Supplier', priority: 1, width: '1.4fr',
      render: r => <span className="text-xs font-medium text-t1 truncate">{r.inv.partnerName || '—'}</span>,
      exportValue: r => r.inv.partnerName ?? '',
    },
    {
      key: 'source', label: 'From', priority: 2, width: '1.2fr',
      render: r => <span className="text-[11px] text-t2 truncate">{String(r.inv.notes ?? '').split('\n')[0] || '—'}</span>,
      exportValue: r => String(r.inv.notes ?? '').split('\n')[0],
    },
    {
      key: 'date', label: 'Date', priority: 3, width: '100px',
      render: r => <span className="text-[11px] text-t3">{fmtDate(r.inv.date)}</span>,
      exportValue: r => r.inv.date,
    },
    {
      key: 'amount', label: 'Amount', priority: 2, width: '110px', align: 'right',
      render: r => <span className="font-mono text-[11px]">{fmtKes(r.amount)}</span>,
      exportValue: r => r.amount,
    },
    {
      key: 'used', label: 'Used on bills', priority: 2, width: '1.2fr',
      render: r => <span className="text-[11px] text-t2 truncate" title={r.usedOn}>{r.applied > 0 ? `${fmtKes(r.applied)}${r.usedOn ? ` · ${r.usedOn}` : ''}` : '—'}</span>,
      exportValue: r => r.applied,
    },
    {
      key: 'refunded', label: 'Refunded', priority: 3, width: '100px', align: 'right',
      render: r => <span className="font-mono text-[11px] text-t2">{r.refunded > 0 ? fmtKes(r.refunded) : '—'}</span>,
      exportValue: r => r.refunded,
    },
    {
      key: 'open', label: 'Open', priority: 1, width: '110px', align: 'right',
      render: r => <span className="font-mono text-[11px] font-semibold" style={{ color: r.open > 0 ? 'var(--success)' : 'var(--text-3)' }}>{fmtKes(r.open)}</span>,
      exportValue: r => r.open,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '110px',
      render: r => {
        const draft = invoiceDocState(r.inv.status) === 'draft'
        const label = draft ? 'Draft' : r.open <= 0 ? (r.refunded > 0 && r.applied <= 0 ? 'Refunded' : 'Used') : r.open < r.amount ? 'Part used' : 'Open'
        return <StatusBadge status={draft ? 'draft' : r.open <= 0 ? 'done' : 'active'} label={label} size="xs" />
      },
      exportValue: r => (r.open > 0 ? 'Open' : 'Used'),
    },
    {
      key: 'actions', label: '', priority: 1, width: '190px',
      render: r => canManage && r.open > 0 ? (
        <span className="flex gap-1.5" onClick={e => e.stopPropagation()}>
          <button type="button" className="btn-secondary px-2 py-1 text-[11px]" onClick={() => start('apply', r)}>Use on a bill</button>
          <button type="button" className="btn-secondary px-2 py-1 text-[11px]" onClick={() => start('refund', r)}>Refund received</button>
        </span>
      ) : null,
    },
  ]

  const bills = action ? openBillsFor(action.row.inv) : []

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap gap-6 border-b px-4 py-3" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-surface)' }}>
        <div>
          <p className="mb-0.5 text-[10px] text-t3">Open supplier credit</p>
          <p className="font-mono text-base font-semibold" style={{ color: openTotal > 0 ? 'var(--success)' : 'var(--text-1)' }}>{fmtKes(openTotal)}</p>
        </div>
        <div>
          <p className="mb-0.5 text-[10px] text-t3">Suppliers owing us</p>
          <p className="text-base font-semibold text-t1">{suppliers}</p>
        </div>
        <p className="max-w-xl self-center text-[11px] text-t3">
          Credit from goods returned on a bill or a price reduced after billing. Use it on one of the supplier&apos;s unpaid bills, or record the refund when they pay it back.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: 'var(--border-lt)' }}>
        <input className="form-input min-w-[240px] text-[11px]" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search supplier, credit or bill…" aria-label="Search supplier credits" />
        <select className="form-select text-[11px]" value={status} onChange={e => setStatus(e.target.value)} aria-label="Credit status">
          <option value="open">Open credit</option>
          <option value="used">Used or refunded</option>
          <option value="draft">Draft</option>
          <option value="all">All</option>
        </select>
      </div>

      <DataTable
        tableId="finance-supplier-credits-v1"
        columns={columns}
        rows={filtered}
        rowKey={r => r.inv.id}
        onRowClick={r => router.push(financeInvoicePath(r.inv.id))}
        rowLabel={r => `${r.inv.ref} ${r.inv.partnerName ?? ''}`}
        emptyMessage={status === 'open' ? 'No open supplier credit' : 'No supplier credits'}
        hideSearch
        exportTitle="Supplier credits"
        exportFilename="supplier-credits"
      />

      {action && (
        <Modal
          title={action.kind === 'apply' ? 'Use credit on a bill' : 'Refund received from supplier'}
          subtitle={`${action.row.inv.ref} · ${action.row.inv.partnerName} · ${fmtKes(action.row.open)} open`}
          onClose={() => { if (!saving) setAction(null) }}
          width={480}
        >
          <div className="flex flex-col gap-3">
            {action.kind === 'apply' ? (
              bills.length ? (
                <Field label="Bill" required hint="Unpaid confirmed bills from this supplier. No money moves; the bill's balance goes down.">
                  <Select
                    value={billId}
                    onChange={v => {
                      setBillId(v)
                      const b = bills.find(x => x.id === v)
                      if (b) setAmount(String(Math.min(action.row.open, Number(b.total) - Number(b.amountPaid || 0))))
                    }}
                    options={bills.map(b => ({ value: b.id, label: `${b.ref} · ${fmtDate(b.date)} · owes ${fmtKes(Number(b.total) - Number(b.amountPaid || 0))}` }))}
                  />
                </Field>
              ) : (
                <p className="text-[11px] text-t3">{action.row.inv.partnerName} has no unpaid confirmed bill to use this on. Keep it open for their next bill, or record a refund.</p>
              )
            ) : (
              <>
                <Field label="Paid by" required>
                  <Select value={method} onChange={setMethod} options={[
                    { value: 'bank_transfer', label: 'Bank transfer' },
                    { value: 'mpesa', label: 'M-Pesa' },
                    { value: 'cash', label: 'Cash' },
                    { value: 'cheque', label: 'Cheque' },
                  ]} />
                </Field>
                {Array.isArray(bankAccounts) && bankAccounts.length > 0 && (
                  <Field label="Into account">
                    <Select value={bankAccountId} onChange={setBankAccountId} options={[{ value: '', label: 'Default for this method' }, ...bankAccounts.filter((a: any) => a.active !== false).map((a: any) => ({ value: a.id, label: a.name || a.bankName || a.id }))]} />
                  </Field>
                )}
                <Field label="Reference">
                  <Input value={reference} onChange={setReference} placeholder="e.g. M-Pesa code or bank ref" />
                </Field>
              </>
            )}
            {(action.kind === 'refund' || bills.length > 0) && (
              <Field label="Amount" required>
                <Input type="number" value={amount} onChange={setAmount} />
              </Field>
            )}
            {error && <p className="text-[11px]" style={{ color: 'var(--danger)' }}>{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-outline" onClick={() => setAction(null)} disabled={saving}>Cancel</button>
              {(action.kind === 'refund' || bills.length > 0) && (
                <button type="button" className="btn-primary" onClick={() => void submit()} disabled={saving}>
                  {saving ? 'Saving…' : action.kind === 'apply' ? 'Use credit' : 'Record refund'}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
