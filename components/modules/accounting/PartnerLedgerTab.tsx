'use client'
import { useMemo, useState } from 'react'
import { useAccounting } from './AccountingContext'
import { fmtDate, fmtKes, useFinanceStore } from '@/lib/store'
import { customerCreditBalance } from '@/lib/customer-credit-view'
import { Fa } from '@/components/icons'
import { faSearch, faUsers } from '@fortawesome/free-solid-svg-icons'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Badge, Modal } from '@/components/ui'
import { useRouter } from 'next/navigation'
import { financeInvoicePath } from '@/lib/finance-invoice'

type PartnerTxn = {
  id: string
  documentId: string
  documentRef: string
  transactionRef: string
  date: string
  type: 'customer_invoice' | 'vendor_bill' | 'customer_payment' | 'supplier_payment'
  description: string
  debit: number
  credit: number
  outstanding: number | null
  movingBalance: number
  status: string
  sortOrder: number
}

const transactionLabel = (type: PartnerTxn['type']) => {
  if (type === 'customer_invoice') return 'Invoice'
  if (type === 'vendor_bill') return 'Bill'
  if (type === 'customer_payment') return 'Payment received'
  return 'Supplier payment'
}

const invoiceDescription = (invoice: any) => {
  const lineDetails = (invoice.lines ?? [])
    .filter((line: any) => line.lineType !== 'section')
    .map((line: any) => line.description)
    .filter(Boolean)
    .slice(0, 3)
    .join('; ')
  return invoice.subject || lineDetails || invoice.notes
    || (invoice.type === 'customer_invoice' ? 'Customer invoice' : 'Vendor bill')
}

const paymentDescription = (payment: any, incoming: boolean, legacy = false) => {
  if (legacy) return `${incoming ? 'Payment received' : 'Supplier payment'} — legacy paid amount; individual payment details unavailable`
  const method = payment.method ? String(payment.method).replaceAll('_', ' ') : 'unspecified method'
  const reference = payment.reference ? ` · Ref ${payment.reference}` : ''
  const recorder = payment.recordedBy ? ` · Recorded by ${payment.recordedBy}` : ''
  return `${incoming ? 'Payment received' : 'Supplier payment'} via ${method}${reference}${recorder}`
}

export default function PartnerLedgerTab() {
  const {
    allInvoices, contacts,
    plPartner, setPlPartner, plDateFrom, setPlDateFrom, plDateTo, setPlDateTo,
  } = useAccounting()
  const { customerCredits } = useFinanceStore()
  const router = useRouter()
  const [selectedTransaction, setSelectedTransaction] = useState<PartnerTxn | null>(null)

  const partnerNames = useMemo(
    () => Array.from(new Set(allInvoices.map(invoice => invoice.partnerName).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [allInvoices],
  )

  const partnerTransactions = useMemo(() => {
    if (!plPartner.trim()) return [] as PartnerTxn[]
    const match = plPartner.trim().toLowerCase()
    const raw: Omit<PartnerTxn, 'movingBalance'>[] = []

    allInvoices
      .filter(invoice => invoice.partnerName.toLowerCase().includes(match) || invoice.partnerId === plPartner)
      .forEach(invoice => {
        const isCustomer = invoice.type === 'customer_invoice'
        raw.push({
          id: `document-${invoice.id}`,
          documentId: invoice.id,
          documentRef: invoice.ref,
          transactionRef: invoice.ref,
          date: invoice.date,
          type: invoice.type,
          description: invoiceDescription(invoice),
          debit: isCustomer ? Number(invoice.total) || 0 : 0,
          credit: isCustomer ? 0 : Number(invoice.total) || 0,
          outstanding: Math.max(0, (Number(invoice.total) || 0) - (Number(invoice.amountPaid) || 0)),
          status: invoice.status,
          sortOrder: 0,
        })

        const payments = Array.isArray(invoice.payments) ? invoice.payments : []
        let detailedPaid = 0
        payments.forEach((payment: any, index: number) => {
          const amount = Math.max(0, Number(payment.amount) || 0)
          if (!amount) return
          detailedPaid += amount
          raw.push({
            id: `payment-${invoice.id}-${payment.id || index}`,
            documentId: invoice.id,
          documentRef: invoice.ref,
            transactionRef: payment.reference || payment.id || `PAY-${index + 1}`,
            date: payment.date || invoice.date,
            type: isCustomer ? 'customer_payment' : 'supplier_payment',
            description: paymentDescription(payment, isCustomer),
            debit: isCustomer ? 0 : amount,
            credit: isCustomer ? amount : 0,
            outstanding: null,
            status: 'recorded',
            sortOrder: 1 + index,
          })
        })

        // Older records sometimes have only amountPaid. Keep the financial
        // movement visible as a separate line without inventing payment metadata.
        const legacyRemainder = Math.max(0, (Number(invoice.amountPaid) || 0) - detailedPaid)
        if (legacyRemainder > 0.005) {
          raw.push({
            id: `payment-legacy-${invoice.id}`,
            documentId: invoice.id,
          documentRef: invoice.ref,
            transactionRef: `PAID-${invoice.ref}`,
            date: invoice.date,
            type: isCustomer ? 'customer_payment' : 'supplier_payment',
            description: paymentDescription({}, isCustomer, true),
            debit: isCustomer ? 0 : legacyRemainder,
            credit: isCustomer ? legacyRemainder : 0,
            outstanding: null,
            status: 'recorded',
            sortOrder: 99,
          })
        }
      })

    let running = 0
    return raw
      .sort((a, b) =>
        a.date.localeCompare(b.date)
        || a.documentRef.localeCompare(b.documentRef)
        || a.sortOrder - b.sortOrder,
      )
      .map(transaction => {
        running += transaction.debit - transaction.credit
        return { ...transaction, movingBalance: running }
      })
  }, [plPartner, allInvoices])

  const filteredPartnerTransactions = useMemo(
    () => partnerTransactions.filter(transaction =>
      (!plDateFrom || transaction.date >= plDateFrom) && (!plDateTo || transaction.date <= plDateTo),
    ),
    [partnerTransactions, plDateFrom, plDateTo],
  )

  const columns: ColumnDef<PartnerTxn>[] = [
    {
      key: 'date', label: 'Date', priority: 1, width: '100px',
      render: transaction => <span className="text-[11px] text-t3">{fmtDate(transaction.date)}</span>,
      exportValue: transaction => transaction.date,
    },
    {
      key: 'document', label: 'Invoice / bill', priority: 1, width: '110px',
      render: transaction => <span className="font-mono text-[11px] text-purple-600">{transaction.documentRef}</span>,
      exportValue: transaction => transaction.documentRef,
    },
    {
      key: 'transaction', label: 'Transaction ref', priority: 2, width: '120px',
      render: transaction => <span className="font-mono text-[11px]">{transaction.transactionRef}</span>,
      exportValue: transaction => transaction.transactionRef,
    },
    {
      key: 'type', label: 'Type', priority: 1, width: '110px',
      render: transaction => (
        <span className={`text-[10px] font-semibold ${
          transaction.type === 'customer_payment' || transaction.type === 'supplier_payment'
            ? 'text-blue-600'
            : transaction.type === 'customer_invoice' ? 'text-green-600' : 'text-amber-600'
        }`}>
          {transactionLabel(transaction.type)}
        </span>
      ),
      exportValue: transaction => transactionLabel(transaction.type),
    },
    {
      key: 'description', label: 'Description', priority: 1, width: '1.6fr',
      render: transaction => <span className="text-[11px]">{transaction.description}</span>,
      exportValue: transaction => transaction.description,
    },
    {
      key: 'debit', label: 'Debit', priority: 1, width: '105px', align: 'right',
      render: transaction => <span className="font-mono text-[11px]">{transaction.debit ? fmtKes(transaction.debit) : '—'}</span>,
      exportValue: transaction => transaction.debit || '',
    },
    {
      key: 'credit', label: 'Credit', priority: 1, width: '105px', align: 'right',
      render: transaction => <span className="font-mono text-[11px]">{transaction.credit ? fmtKes(transaction.credit) : '—'}</span>,
      exportValue: transaction => transaction.credit || '',
    },
    {
      key: 'balance', label: 'Balance', priority: 1, width: '110px', align: 'right',
      render: transaction => <span className={`font-mono text-[11px] font-semibold ${transaction.movingBalance < 0 ? 'text-amber-600' : ''}`}>{fmtKes(transaction.movingBalance)}</span>,
      exportValue: transaction => transaction.movingBalance,
    },
    {
      key: 'outstanding', label: 'Document due', priority: 2, width: '110px', align: 'right',
      render: transaction => transaction.outstanding == null
        ? <span className="text-[11px] text-t3">—</span>
        : <span className={`font-mono text-[11px] ${transaction.outstanding > 0 ? 'text-red-500' : 'text-green-600'}`}>{transaction.outstanding > 0 ? fmtKes(transaction.outstanding) : '✓ Paid'}</span>,
      exportValue: transaction => transaction.outstanding == null ? '' : transaction.outstanding,
    },
  ]

  const selectedPartnerInvoices = useMemo(() => {
    const match = plPartner.trim().toLowerCase()
    return !match ? [] : allInvoices.filter(invoice =>
      invoice.partnerName.toLowerCase().includes(match) || invoice.partnerId === plPartner,
    )
  }, [allInvoices, plPartner])

  const selectedDocument = selectedTransaction
    ? allInvoices.find(invoice => invoice.id === selectedTransaction.documentId) ?? null
    : null
  const hasPeriodFilter = Boolean(plDateFrom || plDateTo)

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
        <div className="relative min-w-[260px]">
          <Fa icon={faSearch} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-t3 pointer-events-none" />
          <input
            className="form-input w-full text-[11px] py-1.5 pl-8"
            list="partner-ledger-options"
            value={plPartner}
            onChange={event => setPlPartner(event.target.value)}
            placeholder="Search customer or supplier…"
            aria-label="Search customer or supplier ledger"
          />
          <datalist id="partner-ledger-options">
            {partnerNames.map(name => <option key={name} value={name} />)}
          </datalist>
        </div>
        <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 130 }} value={plDateFrom} onChange={event => setPlDateFrom(event.target.value)} title="From Date" />
        <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 130 }} value={plDateTo} onChange={event => setPlDateTo(event.target.value)} title="To Date" />
        {hasPeriodFilter && (
          <button
            type="button"
            className="btn-secondary text-[11px]"
            onClick={() => {
              setPlDateFrom('')
              setPlDateTo('')
            }}
          >
            Clear period
          </button>
        )}
        {plPartner && (
          <button type="button" className="btn-secondary text-[11px]" onClick={() => setPlPartner('')}>
            Change partner
          </button>
        )}
        {plPartner && <span className="text-[11px] text-t3">{filteredPartnerTransactions.length} ledger lines</span>}
      </div>

      {!plPartner ? (
        <div className="py-16 text-center">
          <Fa icon={faUsers} style={{ fontSize: 28, color: 'var(--text-4)', marginBottom: 8 }} />
          <p className="text-xs text-t3">Search for a customer or supplier to view their ledger</p>
        </div>
      ) : (
        <>
          <div className="px-4 py-3 border-b flex gap-6 flex-wrap" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-surface)' }}>
            {(() => {
              const contact = contacts.find(contact => contact.name.toLowerCase() === plPartner.toLowerCase())
              const periodDocuments = selectedPartnerInvoices.filter(invoice =>
                (!plDateFrom || invoice.date >= plDateFrom) && (!plDateTo || invoice.date <= plDateTo),
              )
              const totalInvoiced = periodDocuments.filter(invoice => invoice.type === 'customer_invoice').reduce((sum, invoice) => sum + invoice.total, 0)
              const totalBilled = periodDocuments.filter(invoice => invoice.type === 'vendor_bill').reduce((sum, invoice) => sum + invoice.total, 0)
              const closingBalance = partnerTransactions.at(-1)?.movingBalance || 0
              const storeCredit = contact ? customerCreditBalance(customerCredits, contact.id) : 0
              return (
                <>
                  <div>
                    <p className="text-[10px] text-t3 mb-0.5">Partner</p>
                    <p className="text-[12px] font-semibold">{contact?.name || plPartner}</p>
                    {contact?.vatNumber && <p className="text-[10px] text-t3">KRA: {contact.vatNumber}</p>}
                  </div>
                  {totalInvoiced > 0 && <div><p className="text-[10px] text-t3 mb-0.5">Invoiced in period</p><p className="text-[12px] font-mono font-semibold text-green-600">{fmtKes(totalInvoiced)}</p></div>}
                  {totalBilled > 0 && <div><p className="text-[10px] text-t3 mb-0.5">Billed in period</p><p className="text-[12px] font-mono font-semibold text-amber-600">{fmtKes(totalBilled)}</p></div>}
                  <div><p className="text-[10px] text-t3 mb-0.5">Closing balance</p><p className={`text-xs font-mono font-semibold ${closingBalance < 0 ? 'text-amber-600' : 'text-red-500'}`}>{fmtKes(closingBalance)}</p></div>
                  <div><p className="text-[10px] text-t3 mb-0.5">Store credit</p><p className="text-xs font-mono font-semibold" style={{ color: storeCredit > 0 ? 'var(--success)' : 'var(--text-1)' }}>{fmtKes(storeCredit)}</p></div>
                </>
              )
            })()}
          </div>

          <DataTable
            tableId="partner-ledger"
            columns={columns}
            rows={filteredPartnerTransactions}
            rowKey={transaction => transaction.id}
            onRowClick={transaction => setSelectedTransaction(transaction)}
            rowLabel={transaction => `${transactionLabel(transaction.type)} ${transaction.transactionRef} ${transaction.description}`}
            emptyMessage="No invoice, bill or payment lines found for this partner or period"
            exportTitle={`Partner Ledger — ${plPartner}`}
            exportFilename={`partner-ledger-${plPartner.replace(/\s+/g, '-')}`}
          />

          {selectedTransaction && selectedDocument && (
            <Modal
              title={`${transactionLabel(selectedTransaction.type)} · ${selectedTransaction.transactionRef}`}
              subtitle={`${fmtDate(selectedTransaction.date)} · ${selectedDocument.partnerName}`}
              onClose={() => setSelectedTransaction(null)}
              width={680}
            >
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 border border-[var(--border-lt)] rounded-lg overflow-hidden">
                  <div className="p-3 bg-[var(--bg-surface)]">
                    <p className="text-[9px] uppercase tracking-wide text-t4">Status</p>
                    <div className="mt-1"><Badge status={selectedTransaction.status} /></div>
                  </div>
                  <div className="p-3 border-l border-[var(--border-lt)]">
                    <p className="text-[9px] uppercase tracking-wide text-t4">Debit</p>
                    <p className="mt-1 text-xs font-mono font-semibold">{selectedTransaction.debit ? fmtKes(selectedTransaction.debit) : '—'}</p>
                  </div>
                  <div className="p-3 border-t sm:border-t-0 sm:border-l border-[var(--border-lt)]">
                    <p className="text-[9px] uppercase tracking-wide text-t4">Credit</p>
                    <p className="mt-1 text-xs font-mono font-semibold">{selectedTransaction.credit ? fmtKes(selectedTransaction.credit) : '—'}</p>
                  </div>
                  <div className="p-3 border-t border-l sm:border-t-0 border-[var(--border-lt)]">
                    <p className="text-[9px] uppercase tracking-wide text-t4">Ledger balance</p>
                    <p className="mt-1 text-xs font-mono font-semibold">{fmtKes(selectedTransaction.movingBalance)}</p>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wide font-semibold text-t4 mb-1">Transaction description</p>
                  <p className="text-xs text-t1">{selectedTransaction.description}</p>
                </div>

                <div className="rounded-lg border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-3">
                  <p className="text-[10px] uppercase tracking-wide font-semibold text-t4">Applied document</p>
                  <div className="mt-1 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold text-t1">{selectedTransaction.documentRef}</p>
                      <p className="text-[11px] text-t3">
                        Total {fmtKes(selectedDocument.total)} · Paid {fmtKes(selectedDocument.amountPaid)} · Balance {fmtKes(Math.max(0, selectedDocument.total - selectedDocument.amountPaid))}
                      </p>
                    </div>
                    {selectedTransaction.outstanding != null && (
                      <span className="text-[11px] font-mono font-semibold text-t1">
                        Due {fmtKes(selectedTransaction.outstanding)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-secondary text-[11px]" onClick={() => setSelectedTransaction(null)}>
                    Back to ledger
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-[11px]"
                    onClick={() => router.push(financeInvoicePath(selectedDocument.id))}
                  >
                    Open source {selectedDocument.type === 'customer_invoice' ? 'invoice' : 'bill'}
                  </button>
                </div>
              </div>
            </Modal>
          )}
        </>
      )}
    </>
  )
}
