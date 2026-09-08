'use client'
import { useEffect, useMemo, useState } from 'react'
import { useAccounting } from './AccountingContext'
import { fmtDate, fmtKes } from '@/lib/store'
import { Fa } from '@/components/icons'
import { faBook, faChevronDown, faXmark } from '@fortawesome/free-solid-svg-icons'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Badge, Modal } from '@/components/ui'
import { useUrlUiState } from '@/hooks/useUrlRecordId'

type GlRow = {
  id: string
  accountCode: string
  accountName: string
  entryRef: string
  entryDate: string
  description: string
  entryDesc: string
  source: string
  debit: number
  credit: number
  runningBalance: number
}

type PrismaGlLine = {
  id: string
  entryRef: string
  entryDate: string
  description: string
  label: string
  sourceType: string
  debit: number
  credit: number
  runningBalance: number
}

export default function GeneralLedgerTab() {
  const {
    journalEntries, accounts,
    glAccount, setGlAccount, glDateFrom, setGlDateFrom, glDateTo, setGlDateTo,
  } = useAccounting()

  const initialAccount = accounts.find(a => a.code === glAccount || a.name === glAccount)?.code
    || (glAccount && /^\d/.test(glAccount) ? glAccount : '')
  const [selectedAccountParam, setSelectedAccountParam] = useUrlUiState('glAccounts', initialAccount)
  const selectedAccountCodes = useMemo(
    () => Array.from(new Set(selectedAccountParam.split(',').map(code => code.trim()).filter(Boolean))),
    [selectedAccountParam],
  )
  const [accountSearch, setAccountSearch] = useState('')
  const [accountPickerOpen, setAccountPickerOpen] = useState(false)
  const [sourceValue, setSourceValue] = useUrlUiState('glBook', 'prisma')
  const source: 'blob' | 'prisma' = sourceValue === 'blob' ? 'blob' : 'prisma'
  const setSource = (next: 'blob' | 'prisma') => setSourceValue(next)
  const [selectedLine, setSelectedLine] = useState<GlRow | null>(null)
  const [prismaLines, setPrismaLines] = useState<GlRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedAccounts = useMemo(
    () => selectedAccountCodes.map(code => accounts.find(a => a.code === code)).filter(Boolean) as typeof accounts,
    [accounts, selectedAccountCodes],
  )
  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase()
    if (!query) return accounts
    return accounts.filter(account =>
      account.code.toLowerCase().includes(query) || account.name.toLowerCase().includes(query),
    )
  }, [accounts, accountSearch])

  const updateSelectedAccounts = (codes: string[]) => {
    const unique = Array.from(new Set(codes))
    setSelectedAccountParam(unique.join(','))
    // Preserve the existing shared finance filter contract for older links/bookmarks.
    setGlAccount(unique[0] || '')
  }

  useEffect(() => {
    if (source !== 'prisma' || selectedAccountCodes.length === 0) {
      setPrismaLines([])
      setError(null)
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const results = await Promise.all(selectedAccountCodes.map(async accountCode => {
          const params = new URLSearchParams({ accountCode })
          if (glDateFrom) params.set('dateFrom', glDateFrom)
          if (glDateTo) params.set('dateTo', glDateTo)
          const res = await fetch(`/api/accounting/general-ledger?${params}`)
          if (!res.ok) throw new Error(`Failed to load account ${accountCode}`)
          const data = await res.json()
          const account = accounts.find(item => item.code === accountCode)
          return (Array.isArray(data.lines) ? data.lines : []).map((line: PrismaGlLine) => ({
            id: `${accountCode}-${line.id}`,
            accountCode,
            accountName: account?.name || accountCode,
            entryRef: line.entryRef,
            entryDate: line.entryDate,
            description: line.label || line.description,
            entryDesc: line.description,
            source: line.sourceType,
            debit: line.debit,
            credit: line.credit,
            runningBalance: line.runningBalance,
          }))
        }))
        if (!cancelled) {
          setPrismaLines(results.flat().sort((a, b) =>
            a.entryDate.localeCompare(b.entryDate)
            || a.accountCode.localeCompare(b.accountCode)
            || a.entryRef.localeCompare(b.entryRef),
          ))
        }
      } catch (err) {
        if (!cancelled) {
          setPrismaLines([])
          setError(err instanceof Error ? err.message : 'Failed to load general ledger')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [source, selectedAccountCodes, glDateFrom, glDateTo, accounts])

  const blobRows = useMemo(() => {
    if (selectedAccountCodes.length === 0) return [] as GlRow[]
    const selected = selectedAccounts.map(account => ({
      code: account.code,
      name: account.name,
      codeMatch: account.code.toLowerCase(),
      nameMatch: account.name.toLowerCase(),
    }))
    const balances = new Map<string, number>()
    const rows: GlRow[] = []
    for (const entry of [...journalEntries].sort((a, b) => a.date.localeCompare(b.date))) {
      for (const line of entry.lines) {
        const lineAccount = String(line.account || '').toLowerCase()
        const account = selected.find(item =>
          lineAccount.includes(item.codeMatch) || lineAccount.includes(item.nameMatch),
        )
        if (!account) continue
        const runningBalance = (balances.get(account.code) || 0) + (line.debit || 0) - (line.credit || 0)
        balances.set(account.code, runningBalance)
        rows.push({
          id: `${account.code}-${entry.id}-${rows.length}`,
          accountCode: account.code,
          accountName: account.name,
          entryRef: entry.ref,
          entryDate: entry.date,
          description: line.description,
          entryDesc: entry.description,
          source: entry.source,
          debit: line.debit || 0,
          credit: line.credit || 0,
          runningBalance,
        })
      }
    }
    return rows.filter(line =>
      (!glDateFrom || line.entryDate >= glDateFrom) && (!glDateTo || line.entryDate <= glDateTo),
    )
  }, [selectedAccountCodes, selectedAccounts, journalEntries, glDateFrom, glDateTo])

  const rows = source === 'prisma' ? prismaLines : blobRows

  const columns: ColumnDef<GlRow>[] = [
    {
      key: 'account', label: 'Account', priority: 1, width: '150px',
      render: line => <span className="text-[11px]"><strong>{line.accountCode}</strong> — {line.accountName}</span>,
      exportValue: line => `${line.accountCode} — ${line.accountName}`,
    },
    {
      key: 'ref', label: 'Journal ref', priority: 1, width: '120px',
      render: line => <span className="font-mono text-[11px] text-blue-500">{line.entryRef}</span>,
      exportValue: line => line.entryRef,
    },
    {
      key: 'date', label: 'Date', priority: 2, width: '100px',
      render: line => <span className="text-[11px] text-t3">{fmtDate(line.entryDate)}</span>,
      exportValue: line => line.entryDate,
    },
    {
      key: 'description', label: 'Description', priority: 1, width: '1.4fr',
      render: line => <span className="text-[11px]">{line.description || line.entryDesc}</span>,
      exportValue: line => line.description || line.entryDesc,
    },
    {
      key: 'source', label: 'Source', priority: 3, width: '1fr',
      render: line => <span className="text-[11px] capitalize text-t3">{line.source}</span>,
      exportValue: line => line.source,
    },
    {
      key: 'debit', label: 'Debit', priority: 1, width: '100px', align: 'right',
      render: line => <span className="font-mono text-[11px] text-green-600">{line.debit ? fmtKes(line.debit) : '—'}</span>,
      exportValue: line => line.debit || '',
    },
    {
      key: 'credit', label: 'Credit', priority: 1, width: '100px', align: 'right',
      render: line => <span className="font-mono text-[11px] text-red-500">{line.credit ? fmtKes(line.credit) : '—'}</span>,
      exportValue: line => line.credit || '',
    },
    {
      key: 'balance', label: 'Account balance', priority: 1, width: '120px', align: 'right',
      render: line => <span className={`font-mono text-[11px] font-semibold ${line.runningBalance < 0 ? 'text-red-500' : ''}`}>{fmtKes(line.runningBalance)}</span>,
      exportValue: line => line.runningBalance,
    },
  ]

  const exportAccountLabel = selectedAccounts.length === 1
    ? `${selectedAccounts[0].code} — ${selectedAccounts[0].name}`
    : `${selectedAccounts.length} selected accounts`

  const closingBalances = useMemo(() => {
    const values = new Map<string, GlRow>()
    rows.forEach(row => values.set(row.accountCode, row))
    return Array.from(values.values()).sort((a, b) => a.accountCode.localeCompare(b.accountCode))
  }, [rows])

  const selectedJournal = selectedLine
    ? journalEntries.find(entry => entry.ref === selectedLine.entryRef) ?? null
    : null
  const hasPeriodFilter = Boolean(glDateFrom || glDateTo)

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
        <div className="relative min-w-[260px]">
          <button
            type="button"
            className="form-select w-full text-left flex items-center justify-between gap-2 text-[11px] py-1.5"
            onClick={() => setAccountPickerOpen(open => !open)}
            aria-haspopup="listbox"
            aria-expanded={accountPickerOpen}
          >
            <span className="truncate">
              {selectedAccounts.length === 0
                ? 'Select or search accounts…'
                : selectedAccounts.length === 1
                  ? `${selectedAccounts[0].code} — ${selectedAccounts[0].name}`
                  : `${selectedAccounts.length} accounts selected`}
            </span>
            <Fa icon={faChevronDown} />
          </button>
          {accountPickerOpen && (
            <div className="absolute z-[100] top-full left-0 mt-1 w-[360px] max-w-[90vw] rounded-md border bg-white shadow-lg" style={{ borderColor: 'var(--border)' }}>
              <div className="p-2 border-b" style={{ borderColor: 'var(--border-lt)' }}>
                <input
                  autoFocus
                  className="form-input w-full text-[11px] py-1.5"
                  placeholder="Search account code or name…"
                  value={accountSearch}
                  onChange={event => setAccountSearch(event.target.value)}
                />
              </div>
              <div className="max-h-64 overflow-y-auto p-1" role="listbox" aria-multiselectable="true">
                {filteredAccounts.map(account => {
                  const checked = selectedAccountCodes.includes(account.code)
                  return (
                    <label key={account.code} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-muted)] cursor-pointer text-[11px]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => updateSelectedAccounts(
                          checked
                            ? selectedAccountCodes.filter(code => code !== account.code)
                            : [...selectedAccountCodes, account.code],
                        )}
                      />
                      <span><strong>{account.code}</strong> — {account.name}</span>
                    </label>
                  )
                })}
                {filteredAccounts.length === 0 && <p className="px-2 py-4 text-center text-[11px] text-t3">No accounts match your search</p>}
              </div>
              <div className="flex items-center justify-between gap-2 p-2 border-t" style={{ borderColor: 'var(--border-lt)' }}>
                <button type="button" className="sp-btn text-[11px]" onClick={() => updateSelectedAccounts([])}>
                  <Fa icon={faXmark} /> Clear
                </button>
                <button type="button" className="sp-btn sp-btn-primary text-[11px]" onClick={() => setAccountPickerOpen(false)}>Done</button>
              </div>
            </div>
          )}
        </div>
        <select className="form-select text-[11px] py-1.5" value={source} onChange={event => setSource(event.target.value as 'blob' | 'prisma')} aria-label="General ledger source">
          <option value="prisma">Prisma (KES posted)</option>
          <option value="blob">Client blob</option>
        </select>
        <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 130 }} value={glDateFrom} onChange={event => setGlDateFrom(event.target.value)} title="From Date" />
        <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 130 }} value={glDateTo} onChange={event => setGlDateTo(event.target.value)} title="To Date" />
        {hasPeriodFilter && (
          <button
            type="button"
            className="btn-secondary text-[11px]"
            onClick={() => {
              setGlDateFrom('')
              setGlDateTo('')
            }}
          >
            Clear period
          </button>
        )}
        {selectedAccountCodes.length > 0 && <span className="text-[11px] text-t3">{rows.length} entries</span>}
        {source === 'prisma' && loading && <span className="text-[11px] text-t3">Loading…</span>}
        {source === 'prisma' && error && <span className="text-[11px] text-red-500">{error}</span>}
      </div>

      {selectedAccountCodes.length === 0 ? (
        <div className="py-16 text-center">
          <Fa icon={faBook} style={{ fontSize: 28, color: 'var(--text-4)', marginBottom: 8 }} />
          <p className="text-xs text-t3">Select one or several accounts to view their ledger</p>
        </div>
      ) : (
        <>
          <DataTable
            tableId="general-ledger"
            columns={columns}
            rows={rows}
            rowKey={line => line.id}
            onRowClick={line => setSelectedLine(line)}
            rowLabel={line => `${line.entryRef} ${line.accountCode} ${line.description || line.entryDesc}`}
            emptyMessage={source === 'prisma' ? 'No posted Prisma lines for the selected accounts or period' : 'No journal lines found for the selected accounts or period'}
            exportTitle={`General Ledger — ${exportAccountLabel}`}
            exportFilename={`general-ledger-${selectedAccountCodes.join('-')}`}
          />
          {selectedLine && (
            <Modal
              title={`Ledger movement ${selectedLine.entryRef}`}
              subtitle={`${fmtDate(selectedLine.entryDate)} · ${selectedLine.accountCode} — ${selectedLine.accountName}`}
              onClose={() => setSelectedLine(null)}
              width={760}
            >
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 border border-[var(--border-lt)] rounded-lg overflow-hidden">
                  <div className="p-3 bg-[var(--bg-surface)]">
                    <p className="text-[9px] uppercase tracking-wide text-t4">Source</p>
                    <p className="mt-1 text-xs font-semibold capitalize text-t1">{selectedLine.source}</p>
                  </div>
                  <div className="p-3 border-t sm:border-t-0 sm:border-l border-[var(--border-lt)]">
                    <p className="text-[9px] uppercase tracking-wide text-t4">Debit / Credit</p>
                    <p className="mt-1 text-xs font-mono text-t1">
                      {selectedLine.debit ? fmtKes(selectedLine.debit) : '—'} / {selectedLine.credit ? fmtKes(selectedLine.credit) : '—'}
                    </p>
                  </div>
                  <div className="p-3 border-t sm:border-t-0 sm:border-l border-[var(--border-lt)]">
                    <p className="text-[9px] uppercase tracking-wide text-t4">Running balance</p>
                    <p className={`mt-1 text-xs font-bold font-mono ${selectedLine.runningBalance < 0 ? 'text-red-500' : 'text-t1'}`}>
                      {fmtKes(selectedLine.runningBalance)}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wide font-semibold text-t4 mb-1">Movement description</p>
                  <p className="text-xs text-t1">{selectedLine.description || selectedLine.entryDesc || 'No description'}</p>
                </div>

                {selectedJournal && (
                  <div className="border border-[var(--border-lt)] rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between gap-3 px-3 py-2 bg-[var(--bg-surface)]">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide font-semibold text-t4">Originating accounting entry</p>
                        <p className="text-xs text-t1">{selectedJournal.description}</p>
                      </div>
                      <Badge status={selectedJournal.status} />
                    </div>
                    <div className="divide-y divide-[var(--border-lt)]">
                      {selectedJournal.lines.map((line, index) => (
                        <div key={`${line.account}-${index}`} className="grid grid-cols-[minmax(0,1fr)_100px_100px] gap-3 px-3 py-2 text-[11px]">
                          <div className="min-w-0">
                            <p className="font-semibold text-t1 truncate">{line.account}</p>
                            <p className="text-t3 truncate">{line.description || '—'}</p>
                          </div>
                          <span className="text-right font-mono">{line.debit ? fmtKes(line.debit) : '—'}</span>
                          <span className="text-right font-mono">{line.credit ? fmtKes(line.credit) : '—'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!selectedJournal && (
                  <p className="rounded-lg border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-2 text-[11px] text-t3">
                    This movement is from the official ledger. Its reference and source are shown above; the legacy mirror has no additional entry detail.
                  </p>
                )}

                <div className="flex justify-end">
                  <button type="button" className="btn-primary text-[11px]" onClick={() => setSelectedLine(null)}>
                    Back to ledger
                  </button>
                </div>
              </div>
            </Modal>
          )}

          {closingBalances.length > 0 && (
            <div className="px-4 py-2 border-t border-[var(--border-lt)] flex flex-wrap justify-end gap-x-5 gap-y-1 text-[11px]">
              {closingBalances.map(line => (
                <span key={line.accountCode}>
                  <strong>{line.accountCode} closing:</strong>{' '}
                  <span className={`font-mono font-semibold ${line.runningBalance < 0 ? 'text-red-500' : 'text-purple-600'}`}>{fmtKes(line.runningBalance)}</span>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
