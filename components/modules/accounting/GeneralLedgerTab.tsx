'use client'
import { useMemo } from 'react'
import { useAccounting } from './AccountingContext'
import { fmtDate, fmtKes } from '@/lib/store'
import { Fa } from '@/components/icons'
import { faBook } from '@fortawesome/free-solid-svg-icons'
import { ExportButtons, Select } from '@/components/ui'

export default function GeneralLedgerTab() {
  const {
    journalEntries, accounts,
    glAccount, setGlAccount, glDateFrom, setGlDateFrom, glDateTo, setGlDateTo,
  } = useAccounting()

  const glWithBalance = useMemo(() => {
    if (!glAccount) return []
    const match = glAccount.toLowerCase()
    let running = 0
    const res: any[] = []
    for (const e of journalEntries) {
      for (const l of e.lines) {
        if (l.account.toLowerCase().includes(match)) {
          running += (l.debit || 0) - (l.credit || 0)
          res.push({ ...l, entryRef: e.ref, entryDate: e.date, entryDesc: e.description, source: e.source, runningBalance: running })
        }
      }
    }
    return res
  }, [glAccount, journalEntries])

  const filteredGlWithBalance = useMemo(() =>
    glWithBalance.filter(l => (!glDateFrom || l.entryDate >= glDateFrom) && (!glDateTo || l.entryDate <= glDateTo)),
  [glWithBalance, glDateFrom, glDateTo])

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
        <div className="ml-auto">
          <ExportButtons
            title={`General Ledger — ${glAccount}`}
            filename={`gl-${glAccount.replace(/\s+/g, '-')}`}
            headers={['Journal Ref', 'Date', 'Description', 'Source', 'Debit (KES)', 'Credit (KES)', 'Balance (KES)']}
            rows={filteredGlWithBalance.map((l: any) => [l.entryRef, fmtDate(l.entryDate), l.description || l.entryDesc, l.source, l.debit || '', l.credit || '', l.runningBalance])}
          />
        </div>
      </div>

      {!glAccount ? (
        <div className="py-16 text-center">
          <Fa icon={faBook} style={{ fontSize: 28, color: 'var(--text-4)', marginBottom: 8 }} />
          <p className="text-xs text-t3">Select an account above to view its ledger</p>
        </div>
      ) : filteredGlWithBalance.length === 0 ? (
        <p className="py-10 text-center text-xs text-t3">No journal lines found for this account or period</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div style={{ minWidth: 720 }}>
              <div className="table-head" style={{ gridTemplateColumns: '120px 100px 1.4fr 1fr 100px 100px 110px' }}>
                <span>Journal Ref</span><span>Date</span><span>Description</span><span>Source</span><span>Debit</span><span>Credit</span><span>Balance</span>
              </div>
              {filteredGlWithBalance.map((l: any, i: number) => (
                <div key={i} className="table-row" style={{ gridTemplateColumns: '120px 100px 1.4fr 1fr 100px 100px 110px' }}>
                  <span className="font-mono text-[11px] text-blue-500">{l.entryRef}</span>
                  <span className="text-[11px] text-t3">{fmtDate(l.entryDate)}</span>
                  <span className="text-[11px]">{l.description || l.entryDesc}</span>
                  <span className="text-[11px] capitalize text-t3">{l.source}</span>
                  <span className="font-mono text-[11px] text-green-600">{l.debit ? fmtKes(l.debit) : '—'}</span>
                  <span className="font-mono text-[11px] text-red-500">{l.credit ? fmtKes(l.credit) : '—'}</span>
                  <span className={`font-mono text-[11px] font-semibold ${l.runningBalance < 0 ? 'text-red-500' : ''}`}>
                    {fmtKes(l.runningBalance)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="px-4 py-2 border-t border-[var(--border-lt)] text-right text-[11px] font-semibold">
            Closing Balance: <span className="font-mono ml-2 text-purple-600">
              {fmtKes(filteredGlWithBalance.length > 0
                ? filteredGlWithBalance[filteredGlWithBalance.length - 1].runningBalance
                : (glWithBalance[glWithBalance.length - 1]?.runningBalance ?? 0))}
            </span>
          </div>
        </>
      )}
    </>
  )
}
