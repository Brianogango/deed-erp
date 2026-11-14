'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFinanceStore, fmtDate, fmtKes } from '@/lib/store'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { faCreditCard } from '@fortawesome/free-solid-svg-icons'
import { EmptyState, StatusBadge } from '@/components/erp'
import { Modal, Field, Input, Select } from '@/components/ui'
import { useCan } from '@/hooks/useCan'
import { useUrlUiState } from '@/hooks/useUrlRecordId'
import { financeInvoicePath } from '@/lib/finance-invoice'
import {
  customerCreditSourceLabel,
  customerCreditStatusLabel,
  totalOpenStoreCredit,
  type CustomerCreditLike,
} from '@/lib/customer-credit-view'

export default function CustomerCreditsTab() {
  const { customerCredits, invoices, bankAccounts, showToast } = useFinanceStore()
  const router = useRouter()
  const can = useCan()
  const [refund, setRefund] = useState({ amount: '', method: '', bankAccountId: '', reference: '', date: '' })
  const [refunding, setRefunding] = useState(false)
  const activeBanks = bankAccounts.filter(a => a.active)
  const [creditSearch, setCreditSearch] = useUrlUiState('creditQ', '')
  const [creditStatus, setCreditStatus] = useUrlUiState('creditStatus', 'all')
  const [selectedCredit, setSelectedCredit] = useState<CustomerCreditLike | null>(null)
  const openTotal = useMemo(() => totalOpenStoreCredit(customerCredits), [customerCredits])
  const clientsWithCredit = useMemo(() => {
    const ids = new Set(
      customerCredits
        .filter(c => c.status === 'available' || c.status === 'partially_used')
        .filter(c => (Number(c.balance) || 0) > 0)
        .map(c => c.customerId),
    )
    return ids.size
  }, [customerCredits])

  const filteredCredits = useMemo(() => {
    const query = creditSearch.trim().toLowerCase()
    return customerCredits.filter(credit => {
      const isOpen = credit.status === 'available' || credit.status === 'partially_used'
      if (creditStatus === 'open' && !isOpen) return false
      if (creditStatus !== 'all' && creditStatus !== 'open' && credit.status !== creditStatus) return false
      if (!query) return true
      return [
        credit.ref,
        credit.customerName,
        customerCreditSourceLabel(credit),
        credit.notes,
      ].some(value => String(value || '').toLowerCase().includes(query))
    })
  }, [creditSearch, creditStatus, customerCredits])

  const selectedInvoice = selectedCredit?.sourceInvoiceRef
    ? invoices.find(invoice => invoice.ref === selectedCredit.sourceInvoiceRef) ?? null
    : null

  const columns: ColumnDef<CustomerCreditLike>[] = [
    {
      key: 'ref', label: 'Credit', priority: 1, width: '120px',
      render: c => <span className="font-mono text-[11px] font-semibold text-primary-600">{c.ref}</span>,
      exportValue: c => c.ref ?? '',
    },
    {
      key: 'customer', label: 'Client', priority: 1, width: '1.4fr',
      render: c => <span className="text-xs font-medium text-t1 truncate">{c.customerName || '—'}</span>,
      exportValue: c => c.customerName ?? '',
    },
    {
      key: 'source', label: 'Source', priority: 2, width: '1.2fr',
      render: c => <span className="text-[11px] text-t2 truncate">{customerCreditSourceLabel(c)}</span>,
      exportValue: c => customerCreditSourceLabel(c),
    },
    {
      key: 'date', label: 'Date', priority: 3, width: '100px',
      render: c => <span className="text-[11px] text-t3">{c.createdAt ? fmtDate(c.createdAt) : '—'}</span>,
      exportValue: c => c.createdAt ?? '',
    },
    {
      key: 'amount', label: 'Issued', priority: 2, width: '110px', align: 'right',
      render: c => <span className="font-mono text-[11px]">{fmtKes(c.amount)}</span>,
      exportValue: c => c.amount ?? 0,
    },
    {
      key: 'balance', label: 'Remaining', priority: 1, width: '110px', align: 'right',
      render: c => (
        <span className="font-mono text-[11px] font-semibold" style={{ color: (Number(c.balance) || 0) > 0 ? 'var(--success)' : 'var(--text-3)' }}>
          {fmtKes(c.balance)}
        </span>
      ),
      exportValue: c => c.balance ?? 0,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '110px',
      render: c => (
        <StatusBadge
          status={c.status === 'available' ? 'active' : c.status === 'partially_used' ? 'warning' : c.status === 'void' ? 'cancelled' : 'draft'}
          label={customerCreditStatusLabel(c.status)}
          size="xs"
        />
      ),
      accessor: c => c.status,
      exportValue: c => customerCreditStatusLabel(c.status),
    },
  ]

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap gap-6 border-b px-4 py-3" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-surface)' }}>
        <div>
          <p className="mb-0.5 text-[10px] text-t3">Open store credit</p>
          <p className="font-mono text-base font-semibold" style={{ color: openTotal > 0 ? 'var(--success)' : 'var(--text-1)' }}>{fmtKes(openTotal)}</p>
        </div>
        <div>
          <p className="mb-0.5 text-[10px] text-t3">Clients with credit</p>
          <p className="text-base font-semibold text-t1">{clientsWithCredit}</p>
        </div>
        <p className="max-w-xl self-center text-[11px] text-t3">
          Credit from buy-backs, returns, credit notes and cancelled paid invoices. Apply it on a posted unpaid invoice, or refund it.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: 'var(--border-lt)' }}>
        <input
          className="form-input min-w-[240px] text-[11px]"
          value={creditSearch}
          onChange={event => setCreditSearch(event.target.value)}
          placeholder="Search client, credit or source…"
          aria-label="Search customer credits"
        />
        <select className="form-select text-[11px]" value={creditStatus} onChange={event => setCreditStatus(event.target.value)} aria-label="Credit status">
          <option value="open">Available credit</option>
          <option value="all">All statuses</option>
          <option value="used">Used</option>
          <option value="void">Void</option>
        </select>
        {(creditSearch || creditStatus !== 'all') && (
          <button type="button" className="btn-secondary text-[11px]" onClick={() => { setCreditSearch(''); setCreditStatus('all') }}>
            Clear filters
          </button>
        )}
        <span className="ml-auto text-[10px] text-t3">{filteredCredits.length} credit{filteredCredits.length === 1 ? '' : 's'}</span>
      </div>

      {customerCredits.length === 0 ? (
        <EmptyState
          title="No customer credits yet"
          description="Credits will appear here after an After-Sales buy-back is added as credit or a credit note is issued on a posted invoice."
          icon={<Fa icon={faCreditCard} />}
          className="m-4"
        />
      ) : (
        <DataTable
          tableId="customer-credits"
          columns={columns}
          rows={filteredCredits}
          rowKey={c => String(c.id || c.ref)}
          onRowClick={credit => setSelectedCredit(credit)}
          rowLabel={credit => `${credit.ref || ''} ${credit.customerName || ''} ${customerCreditSourceLabel(credit)}`}
          emptyMessage="No credits match these filters"
          hideSearch
          exportTitle="Customer store credit"
          exportFilename="customer-credits"
        />
      )}

      {selectedCredit && (
        <Modal
          title={`Customer credit ${selectedCredit.ref || ''}`}
          subtitle={selectedCredit.customerName || 'Customer credit'}
          onClose={() => setSelectedCredit(null)}
          width={620}
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 border border-[var(--border-lt)] rounded-lg overflow-hidden">
              <div className="p-3 bg-[var(--bg-surface)]">
                <p className="text-[9px] uppercase tracking-wide text-t4">Status</p>
                <div className="mt-1">
                  <StatusBadge
                    status={selectedCredit.status === 'available' ? 'active' : selectedCredit.status === 'partially_used' ? 'warning' : selectedCredit.status === 'void' ? 'cancelled' : 'draft'}
                    label={customerCreditStatusLabel(selectedCredit.status)}
                    size="xs"
                  />
                </div>
              </div>
              <div className="p-3 border-t sm:border-t-0 sm:border-l border-[var(--border-lt)]">
                <p className="text-[9px] uppercase tracking-wide text-t4">Issued</p>
                <p className="mt-1 text-sm font-mono font-semibold">{fmtKes(selectedCredit.amount)}</p>
              </div>
              <div className="p-3 border-t sm:border-t-0 sm:border-l border-[var(--border-lt)]">
                <p className="text-[9px] uppercase tracking-wide text-t4">Remaining</p>
                <p className="mt-1 text-sm font-mono font-semibold text-[var(--success)]">{fmtKes(selectedCredit.balance)}</p>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-3 text-xs">
              <p className="text-[9px] uppercase tracking-wide font-semibold text-t4">Credit source</p>
              <p className="mt-1 font-semibold text-t1">{customerCreditSourceLabel(selectedCredit)}</p>
              {selectedCredit.createdAt && <p className="mt-1 text-[11px] text-t3">Created {fmtDate(selectedCredit.createdAt)}</p>}
              {selectedCredit.notes && <p className="mt-2 text-[11px] text-t2">{selectedCredit.notes}</p>}
            </div>

            {(selectedCredit.refunds?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-[var(--border-lt)] px-3 py-3 text-[11px]">
                <p className="text-[9px] uppercase tracking-wide font-semibold text-t4">Refunded</p>
                {selectedCredit.refunds!.map(r => (
                  <p key={r.id} className="mt-1 text-t2">
                    {fmtDate(r.date)} · <span className="font-mono">{fmtKes(r.amount)}</span> · {r.method.replace('_', ' ')}{r.reference ? ` · ${r.reference}` : ''}{r.refundedBy ? ` · ${r.refundedBy}` : ''}
                  </p>
                ))}
              </div>
            )}

            <p className="text-[11px] text-t3">
              Use the credit on a posted unpaid invoice of this customer (Apply credit on the invoice), or pay it back below.
            </p>

            {can('customer_credits.refund') && (selectedCredit.status === 'available' || selectedCredit.status === 'partially_used') && (Number(selectedCredit.balance) || 0) > 0 && (
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--border-lt)] p-3 sm:grid-cols-2">
                <p className="text-[9px] uppercase tracking-wide font-semibold text-t4 sm:col-span-2">Refund to the customer</p>
                <Field label={`Amount (up to ${fmtKes(selectedCredit.balance)})`}>
                  <Input type="number" value={refund.amount} onChange={v => setRefund(r => ({ ...r, amount: v }))} placeholder="0.00" />
                </Field>
                <Field label="Date">
                  <Input type="date" value={refund.date} onChange={v => setRefund(r => ({ ...r, date: v }))} />
                </Field>
                <Field label="Paid by *">
                  <Select value={refund.method} onChange={v => setRefund(r => ({ ...r, method: v }))} options={[
                    { value: '', label: 'Select…' },
                    { value: 'mpesa', label: 'M-Pesa' },
                    { value: 'bank_transfer', label: 'Bank transfer' },
                    { value: 'cash', label: 'Cash' },
                    { value: 'cheque', label: 'Cheque' },
                  ]} />
                </Field>
                {activeBanks.length > 0 && (
                  <Field label="Paid from">
                    <Select value={refund.bankAccountId} onChange={v => setRefund(r => ({ ...r, bankAccountId: v }))} options={[
                      { value: '', label: 'Select account…' },
                      ...activeBanks.map(b => ({ value: b.id, label: b.bankName || b.id })),
                    ]} />
                  </Field>
                )}
                <div className="sm:col-span-2">
                  <Field label="Reference">
                    <Input value={refund.reference} onChange={v => setRefund(r => ({ ...r, reference: v }))} placeholder="M-Pesa code, cheque no…" />
                  </Field>
                </div>
                <div className="flex justify-end sm:col-span-2">
                  <button
                    type="button"
                    className="btn-primary text-[11px] disabled:opacity-40"
                    disabled={refunding || !(Number(refund.amount) > 0) || !refund.method}
                    onClick={async () => {
                      setRefunding(true)
                      try {
                        const res = await fetch(`/api/customer-credits/${encodeURIComponent(String(selectedCredit.id))}/refund`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ amount: Number(refund.amount), method: refund.method, bankAccountId: refund.bankAccountId || undefined, reference: refund.reference || undefined, date: refund.date || undefined }),
                        })
                        const data = await res.json().catch(() => null) as { error?: string; refunded?: number; balance?: number } | null
                        if (!res.ok) throw new Error(data?.error || `Refund failed (${res.status})`)
                        showToast(`Refunded ${fmtKes(data?.refunded ?? 0)} to ${selectedCredit.customerName || 'the customer'}`, 'success')
                        setRefund({ amount: '', method: '', bankAccountId: '', reference: '', date: '' })
                        setSelectedCredit(null)
                      } catch (err) {
                        showToast(err instanceof Error ? err.message : 'Refund failed', 'error')
                      } finally {
                        setRefunding(false)
                      }
                    }}
                  >
                    {refunding ? 'Refunding…' : 'Record refund'}
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              {selectedCredit.customerId && (
                <button type="button" className="btn-secondary text-[11px]" onClick={() => router.push(`/contacts?id=${encodeURIComponent(selectedCredit.customerId || '')}`)}>
                  Open customer
                </button>
              )}
              {selectedInvoice && (
                <button type="button" className="btn-primary text-[11px]" onClick={() => router.push(financeInvoicePath(selectedInvoice.id))}>
                  Open source invoice
                </button>
              )}
              <button type="button" className={selectedInvoice ? 'btn-secondary text-[11px]' : 'btn-primary text-[11px]'} onClick={() => setSelectedCredit(null)}>
                Back to credits
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
