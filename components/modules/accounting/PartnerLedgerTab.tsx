'use client'
import { useMemo } from 'react'
import { useAccounting } from './AccountingContext'
import { fmtDate, fmtKes } from '@/lib/store'
import { Fa } from '@/components/icons'
import { faUsers } from '@fortawesome/free-solid-svg-icons'
import { Badge, ExportButtons, Select } from '@/components/ui'

export default function PartnerLedgerTab() {
  const {
    allInvoices, contacts,
    plPartner, setPlPartner, plDateFrom, setPlDateFrom, plDateTo, setPlDateTo,
  } = useAccounting()

  const partnerTransactions = useMemo(() => {
    if (!plPartner) return []
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

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
        <Select value={plPartner} onChange={setPlPartner} options={partnerOptions} />
        <input type="date" className="form-input text-11 py-1.5" style={{ width: 130 }} value={plDateFrom} onChange={e => setPlDateFrom(e.target.value)} title="From Date" />
        <input type="date" className="form-input text-11 py-1.5" style={{ width: 130 }} value={plDateTo} onChange={e => setPlDateTo(e.target.value)} title="To Date" />
        {plPartner && <span className="text-11 text-t3">{filteredPartnerTransactions.length} transactions</span>}
        {plPartner && (
          <div className="ml-auto">
            <ExportButtons
              title={`Partner Ledger — ${plPartner}`}
              filename={`partner-ledger-${plPartner.replace(/\s+/g, '-')}`}
              headers={['Ref', 'Date', 'Type', 'Total (KES)', 'Paid (KES)', 'Outstanding (KES)', 'Status']}
              rows={filteredPartnerTransactions.map(t => [t.ref, fmtDate(t.date), t.type === 'customer_invoice' ? 'Invoice' : 'Bill', t.total, t.amountPaid, t.outstanding > 0 ? t.outstanding : 0, t.status])}
            />
          </div>
        )}
      </div>

      {!plPartner ? (
        <div className="py-16 text-center">
          <Fa icon={faUsers} style={{ fontSize: 28, color: 'var(--text-4)', marginBottom: 8 }} />
          <p className="text-xs text-t3">Select a partner to view their ledger</p>
        </div>
      ) : filteredPartnerTransactions.length === 0 ? (
        <p className="py-10 text-center text-xs text-t3">No transactions found for this partner or period</p>
      ) : (
        <>
          {/* Partner summary banner */}
          <div className="px-4 py-3 border-b flex gap-6" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-surface)' }}>
            {(() => {
              const contact = contacts.find(c => c.name === plPartner)
              const totalInvoiced = filteredPartnerTransactions.filter(t => t.type === 'customer_invoice').reduce((s, t) => s + t.total, 0)
              const totalBilled   = filteredPartnerTransactions.filter(t => t.type === 'vendor_bill').reduce((s, t) => s + t.total, 0)
              const outstanding   = partnerTransactions.reduce((s, t) => s + t.outstanding, 0)
              return (
                <>
                  <div>
                    <p className="text-10 text-t3 mb-0.5">Partner</p>
                    <p className="text-12 font-semibold">{plPartner}</p>
                    {contact?.vatNumber && <p className="text-10 text-t3">KRA: {contact.vatNumber}</p>}
                  </div>
                  {totalInvoiced > 0 && <div><p className="text-10 text-t3 mb-0.5">Total Invoiced (Period)</p><p className="text-12 font-mono font-semibold" style={{ color: '#10B981' }}>{fmtKes(totalInvoiced)}</p></div>}
                  {totalBilled > 0 && <div><p className="text-10 text-t3 mb-0.5">Total Billed (Period)</p><p className="text-12 font-mono font-semibold" style={{ color: '#fec84b' }}>{fmtKes(totalBilled)}</p></div>}
                  <div><p className="text-10 text-t3 mb-0.5">Overall Outstanding</p><p className="text-12 font-mono font-semibold" style={{ color: outstanding > 0 ? '#EF4444' : '#10B981' }}>{fmtKes(outstanding)}</p></div>
                </>
              )
            })()}
          </div>

          <div className="overflow-x-auto">
            <div style={{ minWidth: 700 }}>
              <div className="table-head" style={{ gridTemplateColumns: '90px 100px 80px 110px 110px 110px 90px' }}>
                <span>Ref</span><span>Date</span><span>Type</span><span>Total</span><span>Paid</span><span>Outstanding</span><span>Status</span>
              </div>
              {filteredPartnerTransactions.map(t => (
                <div key={t.id} className="table-row" style={{ gridTemplateColumns: '90px 100px 80px 110px 110px 110px 90px' }}>
                  <span className="font-mono text-11 text-purple-600">{t.ref}</span>
                  <span className="text-11 text-t3">{fmtDate(t.date)}</span>
                  <span className={`text-10 font-medium ${t.type === 'customer_invoice' ? 'text-green-600' : 'text-amber-500'}`}>
                    {t.type === 'customer_invoice' ? 'Invoice' : 'Bill'}
                  </span>
                  <span className="font-mono text-11">{fmtKes(t.total)}</span>
                  <span className="font-mono text-11 text-green-600">{fmtKes(t.amountPaid)}</span>
                  <span className={`font-mono text-11 ${t.outstanding > 0 ? 'text-red-500' : 'text-green-600'}`}>
                    {t.outstanding > 0 ? fmtKes(t.outstanding) : '✓ Paid'}
                  </span>
                  <Badge status={t.status} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  )
}
