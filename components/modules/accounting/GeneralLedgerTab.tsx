'use client'
import { useMemo } from 'react'
import { useAccounting } from './AccountingContext'
import { fmtDate, fmtKes } from '@/lib/store'
import { Fa } from '@/components/icons'
import { faBook } from '@fortawesome/free-solid-svg-icons'
import { Select } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'

type GlRow = {
  id: string
  entryRef: string
  entryDate: string
  description: string
  entryDesc: string
  source: string
  debit: number
  credit: number
  runningBalance: number
}

export default function GeneralLedgerTab() {
  const {
    journalEntries, accounts,
    glAccount, setGlAccount, glDateFrom, setGlDateFrom, glDateTo, setGlDateTo,
  } = useAccounting()

  const glWithBalance = useMemo(() => {
    if (!glAccount) return [] as GlRow[]
    const match = glAccount.toLowerCase()
    let running = 0
    const res: GlRow[] = []
    for (const e of journalEntries) {
      for (const l of e.lines) {
        if (l.account.toLowerCase().includes(match)) {
          running += (l.debit || 0) - (l.credit || 0)
          res.push({
            id: `${e.id}-${l.account}-${res.length}`,
            entryRef: e.ref,
            entryDate: e.date,
            description: l.description,
            entryDesc: e.description,
            source: e.source,
            debit: l.debit || 0,
            credit: l.credit || 0,
            runningBalance: running,
          })
        }
      }
    }
    return res
  }, [glAccount, journalEntries])

  const filteredGlWithBalance = useMemo(() =>
    glWithBalance.filter(l => (!glDateFrom || l.entryDate >= glDateFrom) && (!glDateTo || l.entryDate <= glDateTo)),
  [glWithBalance, glDateFrom, glDateTo])

  const columns: ColumnDef<GlRow>[] = [
    {
      key: 'ref', label: 'Journal ref', priority: 1, width: '120px',
      render: l => <span className="font-mono text-[11px] text-blue-500">{l.entryRef}</span>,
      exportValue: l => l.entryRef,
    },
    {
      key: 'date', label: 'Date', priority: 2, width: '100px',
      render: l => <span className="text-[11px] text-t3">{fmtDate(l.entryDate)}</span>,
      exportValue: l => l.entryDate,
    },
    {
      key: 'description', label: 'Description', priority: 1, width: '1.4fr',
      render: l => <span className="text-[11px]">{l.description || l.entryDesc}</span>,
      exportValue: l => l.description || l.entryDesc,
    },
    {
      key: 'source', label: 'Source', priority: 3, width: '1fr',
      render: l => <span className="text-[11px] capitalize text-t3">{l.source}</span>,
      exportValue: l => l.source,
    },
    {
      key: 'debit', label: 'Debit', priority: 1, width: '100px', align: 'right',
      render: l => <span className="font-mono text-[11px] text-green-600">{l.debit ? fmtKes(l.debit) : '—'}</span>,
      exportValue: l => l.debit || '',
    },
    {
      key: 'credit', label: 'Credit', priority: 1, width: '100px', align: 'right',
      render: l => <span className="font-mono text-[11px] text-red-500">{l.credit ? fmtKes(l.credit) : '—'}</span>,
      exportValue: l => l.credit || '',
    },
    {
      key: 'balance', label: 'Balance', priority: 1, width: '110px', align: 'right',
      render: l => (
        <span className={`font-mono text-[11px] font-semibold ${l.runningBalance < 0 ? 'text-red-500' : ''}`}>
          {fmtKes(l.runningBalance)}
        </span>
      ),
      exportValue: l => l.runningBalance,
    },
  ]

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
        <Select
          value={glAccount} onChange={setGlAccount}
          options={[
            { value: '', label: 'Select an account to view...' },
            ...accounts.map(a => ({ value: a.name, label: `${a.code} — ${a.name}` })),
          ]}
        />
        <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 130 }} value={glDateFrom} onChange={e => setGlDateFrom(e.target.value)} title="From Date" />
        <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 130 }} value={glDateTo} onChange={e => setGlDateTo(e.target.value)} title="To Date" />
        {glAccount && <span className="text-[11px] text-t3">{filteredGlWithBalance.length} entries</span>}
      </div>

      {!glAccount ? (
        <div className="py-16 text-center">
          <Fa icon={faBook} style={{ fontSize: 28, color: 'var(--text-4)', marginBottom: 8 }} />
          <p className="text-xs text-t3">Select an account above to view its ledger</p>
        </div>
      ) : (
        <>
          <DataTable
            tableId="general-ledger"
            columns={columns}
            rows={filteredGlWithBalance}
            rowKey={l => l.id}
            hideSearch
            emptyMessage="No journal lines found for this account or period"
            exportTitle={`General Ledger — ${glAccount}`}
            exportFilename={`gl-${glAccount.replace(/\s+/g, '-')}`}
          />
          {filteredGlWithBalance.length > 0 && (
            <div className="px-4 py-2 border-t border-[var(--border-lt)] text-right text-[11px] font-semibold">
              Closing Balance: <span className="font-mono ml-2 text-purple-600">
                {fmtKes(filteredGlWithBalance[filteredGlWithBalance.length - 1].runningBalance)}
              </span>
            </div>
          )}
        </>
      )}
    </>
  )
}
