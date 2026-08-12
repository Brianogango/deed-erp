'use client'
import { useEffect, useMemo, useState } from 'react'
import { useAccounting } from './AccountingContext'
import { fmtDate, fmtKes } from '@/lib/store'
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

  const [prismaRows, setPrismaRows] = useState<PartnerTxn[] | null>(null)
  const [prismaLoading, setPrismaLoading] = useState(false)
  const [prismaError, setPrismaError] = useState<string | null>(null)
  const usePrisma = true

  useEffect(() => {
    if (!usePrisma || !plPartner) {
      setPrismaRows(null)
      return
    }
    let cancelled = false
    setPrismaLoading(true)
    setPrismaError(null)
    const qs = new URLSearchParams()
    // Prefer contact id when plPartner matches a contact id; else name search.
    const contact = contacts.find(c => c.id === plPartner || c.name === plPartner)
    if (contact?.id) qs.set('partnerId', contact.id)
    else qs.set('partnerName', plPartner)
    if (plDateFrom) qs.set('dateFrom', plDateFrom)
    if (plDateTo) qs.set('dateTo', plDateTo)
    void fetch(`/api/accounting/partner-ledger?${qs}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
        if (!cancelled) setPrismaRows(Array.isArray(data.rows) ? data.rows : [])
      })
      .catch(err => {
        if (!cancelled) {
          setPrismaRows(null)
          setPrismaError(err instanceof Error ? err.message : 'Prisma partner ledger failed')
        }
      })
      .finally(() => { if (!cancelled) setPrismaLoading(false) })
    return () => { cancelled = true }
  }, [plPartner, plDateFrom, plDateTo, contacts, usePrisma])

  const blobPartnerTransactions = useMemo(() => {
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

  const partnerTransactions = (usePrisma && prismaRows && !prismaError) ? prismaRows : blobPartnerTransactions

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
      render: t => <span className="font-mono text-[11px]">{fmtKes(t.outstanding)}</span>,
      exportValue: t => t.outstanding,
    },
    {
      key: 'balance', label: 'Running', priority: 2, width: '110px', align: 'right',
      render: t => <span className="font-mono text-[11px] font-semibold">{fmtKes(t.movingBalance)}</span>,
      exportValue: t => t.movingBalance,
    },
    {
      key: 'status', label: 'Status', priority: 3, width: '90px',
      render: t => <Badge status={t.status} />,
      exportValue: t => t.status,
    },
  ]

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
        <Select value={plPartner} onChange={setPlPartner} options={partnerOptions} />
        <span className="text-[11px] text-t3">SoT: Prisma invoices (blob fallback)</span>
        <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 130 }} value={plDateFrom} onChange={e => setPlDateFrom(e.target.value)} />
        <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 130 }} value={plDateTo} onChange={e => setPlDateTo(e.target.value)} />
        {prismaLoading && <span className="text-[11px] text-t3">Loading…</span>}
        {prismaError && <span className="text-[11px] text-red-500">{prismaError}</span>}
      </div>
      {!plPartner ? (
        <div className="py-16 text-center">
          <Fa icon={faUsers} style={{ fontSize: 28, color: 'var(--text-4)', marginBottom: 8 }} />
          <p className="text-xs text-t3">Select a partner to view their ledger</p>
        </div>
      ) : (
        <DataTable
          tableId="partner-ledger"
          columns={columns}
          rows={filteredPartnerTransactions}
          rowKey={t => t.id}
          hideSearch
          emptyMessage="No partner transactions"
          exportTitle={`Partner ledger — ${plPartner}`}
          exportFilename={`partner-ledger-${plPartner}`}
        />
      )}
    </>
  )
}
