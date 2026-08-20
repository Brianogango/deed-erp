'use client'
import { useMemo } from 'react'
import { useAccounting } from './AccountingContext'
import { fmtDate, fmtKes, useFinanceStore } from '@/lib/store'
import { customerCreditBalance } from '@/lib/customer-credit-view'
import { Fa } from '@/components/icons'
import { faUsers } from '@fortawesome/free-solid-svg-icons'
import { Badge, Select } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'

type PartnerTxn = {
  id: string
  ref: string
  date: string
  type: string
  total: number
  amountPaid: number
  status: string
  outstanding: number
  movingBalance: number
}

export default function PartnerLedgerTab() {
  const {
    allInvoices, contacts,
    plPartner, setPlPartner, plDateFrom, setPlDateFrom, plDateTo, setPlDateTo,
  } = useAccounting()
  const { customerCredits } = useFinanceStore()

  const partnerTransactions = useMemo(() => {
    if (!plPartner) return [] as PartnerTxn[]
    const match = plPartner.toLowerCase()
    let running = 0
    return allInvoices
      .filter(i => i.partnerName.toLowerCase().includes(match) || i.partnerId === plPartner)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(i => {
        const amt = i.type === 'customer_invoice' ? i.total : -i.total
        running += amt
        return { ...i, movingBalance: running, outstanding: i.total - i.amountPaid }
      })
  }, [plPartner, allInvoices])

  const filteredPartnerTransactions = useMemo(() =>
    partnerTransactions.filter(t => (!plDateFrom || t.date >= plDateFrom) && (!plDateTo || t.date <= plDateTo)),
  [partnerTransactions, plDateFrom, plDateTo])

  const partnerOptions = useMemo(() =>
    [{ value: '', label: 'Select a partner...' },
     ...Array.from(new Set(allInvoices.map(i => i.partnerName))).map(n => ({ value: n, label: n }))],
  [allInvoices])

  const columns: ColumnDef<PartnerTxn>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '90px',
      render: t => <span className="font-mono text-[11px] text-purple-600">{t.ref}</span>,
      exportValue: t => t.ref,
    },
    {
      key: 'date', label: 'Date', priority: 2, width: '100px',
      render: t => <span className="text-[11px] text-t3">{fmtDate(t.date)}</span>,
      exportValue: t => t.date,
    },
    {
      key: 'type', label: 'Type', priority: 1, width: '80px',
      render: t => (
        <span className={`text-[10px] font-medium ${t.type === 'customer_invoice' ? 'text-green-600' : 'text-amber-500'}`}>
          {t.type === 'customer_invoice' ? 'Invoice' : 'Bill'}
        </span>
      ),
      exportValue: t => t.type === 'customer_invoice' ? 'Invoice' : 'Bill',
    },
    {
      key: 'total', label: 'Total', priority: 1, width: '110px', align: 'right',
      render: t => <span className="font-mono text-[11px]">{fmtKes(t.total)}</span>,
      exportValue: t => t.total,
    },
    {
      key: 'paid', label: 'Paid', priority: 2, width: '110px', align: 'right',
      render: t => <span className="font-mono text-[11px] text-green-600">{fmtKes(t.amountPaid)}</span>,
      exportValue: t => t.amountPaid,
    },
    {
      key: 'outstanding', label: 'Outstanding', priority: 1, width: '110px', align: 'right',
      render: t => (
        <span className={`font-mono text-[11px] ${t.outstanding > 0 ? 'text-red-500' : 'text-green-600'}`}>
          {t.outstanding > 0 ? fmtKes(t.outstanding) : '✓ Paid'}
        </span>
      ),
      exportValue: t => t.outstanding > 0 ? t.outstanding : 0,
    },
    {
      key: 'status', label: 'Status', priority: 2, width: '90px',
      render: t => <Badge status={t.status} />,
      accessor: t => t.status,
      exportValue: t => t.status,
    },
  ]

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
        <Select value={plPartner} onChange={setPlPartner} options={partnerOptions} />
        <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 130 }} value={plDateFrom} onChange={e => setPlDateFrom(e.target.value)} title="From Date" />
        <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 130 }} value={plDateTo} onChange={e => setPlDateTo(e.target.value)} title="To Date" />
        {plPartner && <span className="text-[11px] text-t3">{filteredPartnerTransactions.length} transactions</span>}
      </div>

      {!plPartner ? (
        <div className="py-16 text-center">
          <Fa icon={faUsers} style={{ fontSize: 28, color: 'var(--text-4)', marginBottom: 8 }} />
          <p className="text-xs text-t3">Select a partner to view their ledger</p>
        </div>
      ) : (
        <>
          {/* Partner summary banner */}
          <div className="px-4 py-3 border-b flex gap-6" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-surface)' }}>
            {(() => {
              const contact = contacts.find(c => c.name === plPartner)
              const totalInvoiced = filteredPartnerTransactions.filter(t => t.type === 'customer_invoice').reduce((s, t) => s + t.total, 0)
              const totalBilled   = filteredPartnerTransactions.filter(t => t.type === 'vendor_bill').reduce((s, t) => s + t.total, 0)
              const outstanding   = partnerTransactions.reduce((s, t) => s + t.outstanding, 0)
              const storeCredit = contact ? customerCreditBalance(customerCredits, contact.id) : 0
              return (
                <>
                  <div>
                    <p className="text-[10px] text-t3 mb-0.5">Partner</p>
                    <p className="text-[12px] font-semibold">{plPartner}</p>
                    {contact?.vatNumber && <p className="text-[10px] text-t3">KRA: {contact.vatNumber}</p>}
                  </div>
                  {totalInvoiced > 0 && <div><p className="text-[10px] text-t3 mb-0.5">Total Invoiced (Period)</p><p className="text-[12px] font-mono font-semibold" style={{ color: 'var(--success)' }}>{fmtKes(totalInvoiced)}</p></div>}
                  {totalBilled > 0 && <div><p className="text-[10px] text-t3 mb-0.5">Total Billed (Period)</p><p className="text-[12px] font-mono font-semibold" style={{ color: '#fec84b' }}>{fmtKes(totalBilled)}</p></div>}
                  <div><p className="text-[10px] text-t3 mb-0.5">Overall Outstanding</p><p className="text-xs font-mono font-semibold" style={{ color: outstanding > 0 ? 'var(--danger)' : 'var(--success)' }}>{fmtKes(outstanding)}</p></div>
                  <div><p className="text-[10px] text-t3 mb-0.5">Store credit</p><p className="text-xs font-mono font-semibold" style={{ color: storeCredit > 0 ? 'var(--success)' : 'var(--text-1)' }}>{fmtKes(storeCredit)}</p></div>
                </>
              )
            })()}
          </div>

          <DataTable
            tableId="partner-ledger"
            columns={columns}
            rows={filteredPartnerTransactions}
            rowKey={t => t.id}
            hideSearch
            emptyMessage="No transactions found for this partner or period"
            exportTitle={`Partner Ledger — ${plPartner}`}
            exportFilename={`partner-ledger-${plPartner.replace(/\s+/g, '-')}`}
          />
        </>
      )}
    </>
  )
}
