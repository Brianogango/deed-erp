'use client'
import { useMemo } from 'react'
import { useAccounting } from './AccountingContext'
import { fmtDate, fmtKes, type JournalEntry } from '@/lib/store'
import { downloadPdf } from '@/lib/pdf'
import type { PdfLine } from '@/lib/pdf'
import { Badge } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'

export default function JournalsTab() {
  const {
    journalEntries, invFilter, journalDate, setJournalDate,
    journalSource, setJournalSource, journalRef, setJournalRef,
    setViewJournal, canViewJournals, hdr,
  } = useAccounting()

  const filteredJournals = useMemo(() => {
    const q = journalRef.toLowerCase()
    return journalEntries.filter(e => {
      if (invFilter !== 'all' && e.status !== invFilter) return false
      if (journalDate && e.date !== journalDate) return false
      if (journalSource !== 'all' && e.source !== journalSource) return false
      if (q && !e.ref.toLowerCase().includes(q)) return false
      return true
    })
  }, [journalEntries, invFilter, journalDate, journalSource, journalRef])

  const buildJournalPdf = (e: JournalEntry): PdfLine[] => hdr([
    { text: `Reference: ${e.ref}`,          x: 40, y: 710, size: 10, bold: true },
    { text: `Date: ${fmtDate(e.date)}`,     x: 40, y: 692, size: 10 },
    { text: `Source: ${e.source}`,          x: 40, y: 674, size: 10 },
    { text: `Description: ${e.description}`,x: 40, y: 656, size: 10 },
    { text: '—'.repeat(75), x: 40, y: 644, size: 10 },
    { text: 'Account',       x: 40,  y: 628, size: 10, bold: true },
    { text: 'Description',   x: 200, y: 628, size: 10, bold: true },
    { text: 'Debit (KSh)',   x: 360, y: 628, size: 10, bold: true },
    { text: 'Credit (KSh)',  x: 450, y: 628, size: 10, bold: true },
    ...e.lines.flatMap((l, i) => [
      { text: l.account,     x: 40,  y: 610 - i * 22, size: 10 },
      { text: l.description, x: 200, y: 610 - i * 22, size: 9 },
      { text: l.debit  ? fmtKes(l.debit)  : '—', x: 360, y: 610 - i * 22, size: 10 },
      { text: l.credit ? fmtKes(l.credit) : '—', x: 450, y: 610 - i * 22, size: 10 },
    ] as PdfLine[]),
    { text: `Total Debit: ${fmtKes(e.totalDebit)}`,   x: 360, y: 200, size: 10, bold: true },
    { text: `Total Credit: ${fmtKes(e.totalCredit)}`, x: 450, y: 200, size: 10, bold: true },
  ] as PdfLine[], `JOURNAL ENTRY — ${e.ref}`, `Date: ${fmtDate(e.date)} · Source: ${e.source}`)

  const columns: ColumnDef<JournalEntry>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '120px',
      render: e => <span className="font-mono text-[11px] font-semibold text-blue-500">{e.ref}</span>,
      accessor: e => e.ref,
      exportValue: e => e.ref,
    },
    {
      key: 'date', label: 'Date', priority: 2, width: '100px',
      render: e => <span className="text-[11px] text-t3">{fmtDate(e.date)}</span>,
      exportValue: e => e.date,
    },
    {
      key: 'description', label: 'Description', priority: 1, width: '1.6fr',
      render: e => <span>{e.description}</span>,
      exportValue: e => e.description,
    },
    {
      key: 'source', label: 'Source', priority: 2, width: '100px',
      render: e => <span className="capitalize text-[11px]">{e.source}</span>,
      exportValue: e => e.source,
    },
    {
      key: 'total', label: 'Total', priority: 1, width: '100px',
      render: e => <span className="font-mono text-[11px]">{fmtKes(e.totalDebit)}</span>,
      exportValue: e => e.totalDebit,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '90px',
      render: e => <Badge status={e.status} />,
      accessor: e => e.status,
      exportValue: e => e.status,
    },
  ]

  if (!canViewJournals) return null

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
        <input className="form-input text-[11px] py-1.5" style={{ width: 140 }} type="date"
          value={journalDate} onChange={e => setJournalDate(e.target.value)} />
        <select className="form-select text-[11px] py-1.5" style={{ width: 130 }}
          value={journalSource} onChange={e => setJournalSource(e.target.value)}>
          <option value="all">All sources</option>
          <option value="payroll">Payroll</option>
          <option value="refund">Refund</option>
          <option value="sales">Sales</option>
          <option value="purchase">Purchase</option>
          <option value="manual">Manual</option>
        </select>
        <input className="form-input text-[11px] py-1.5" style={{ width: 200 }}
          placeholder="Filter by reference..." value={journalRef} onChange={e => setJournalRef(e.target.value)} />
      </div>
      <DataTable
        tableId="journal-entries"
        columns={columns}
        rows={filteredJournals}
        rowKey={e => e.id}
        hideSearch
        emptyMessage="No journal entries found"
        onRowClick={e => setViewJournal(e)}
        rowActions={e => (
          <div className="flex gap-1">
            <button className="text-[9px] px-2 py-0.5 rounded bg-[#E8F3FA] border border-[#A8D4E8] text-brand-navy cursor-pointer"
              onClick={() => setViewJournal(e)}>View</button>
            <button className="text-[9px] px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-t2 cursor-pointer"
              onClick={() => downloadPdf(`${e.ref.replaceAll('/', '-')}.pdf`, buildJournalPdf(e))}>PDF</button>
          </div>
        )}
        exportTitle="Journal Entries"
        exportFilename="journals"
      />
    </>
  )
}
