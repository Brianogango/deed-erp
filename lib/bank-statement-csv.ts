/**
 * Parse bank statement CSV/TSV into Cashbook statement line drafts.
 * Accepts flexible Kenyan bank export headers (NCBA, Equity, KCB, M-Pesa style).
 */

export type StatementLineCategory =
  | 'bank_charge'
  | 'interest_earned'
  | 'transfer'
  | 'receipt'
  | 'payment'
  | 'other'

export type ParsedBankStatementLine = {
  date: string
  description: string
  reference: string
  debit: number
  credit: number
  balance?: number
  category: StatementLineCategory
}

function parseCSVRows(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const delim = lines[0].includes('\t') && !lines[0].includes(',') ? '\t' : ','
  const headers = splitRow(lines[0], delim).map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(row => {
    const vals = splitRow(row, delim)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? '').trim().replace(/^"|"$/g, '') })
    return obj
  }).filter(r => Object.values(r).some(v => v))
}

function splitRow(row: string, delim: string): string[] {
  const vals: string[] = []
  let curr = ''
  let inQuote = false
  for (let i = 0; i < row.length; i++) {
    const char = row[i]
    if (char === '"') inQuote = !inQuote
    else if (char === delim && !inQuote) { vals.push(curr); curr = '' }
    else curr += char
  }
  vals.push(curr)
  return vals
}

function cell(row: Record<string, string>, ...keys: string[]): string {
  const entries = Object.entries(row)
  for (const key of keys) {
    const hit = entries.find(([k]) => k.toLowerCase().replace(/[_\s]+/g, '') === key.toLowerCase().replace(/[_\s]+/g, ''))
    if (hit?.[1]) return hit[1]
  }
  for (const key of keys) {
    const hit = entries.find(([k]) => k.toLowerCase().includes(key.toLowerCase()))
    if (hit?.[1]) return hit[1]
  }
  return ''
}

function parseAmount(raw: string): number {
  if (!raw) return 0
  const trimmed = raw.trim()
  const parenNeg = /^\(.*\)$/.test(trimmed)
  const n = Number(String(trimmed).replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(n)) return 0
  const signed = parenNeg ? -Math.abs(n) : n
  return Math.round(signed * 100) / 100
}

function parseDate(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
  if (dmy) {
    const dd = dmy[1].padStart(2, '0')
    const mm = dmy[2].padStart(2, '0')
    let yyyy = dmy[3]
    if (yyyy.length === 2) yyyy = `20${yyyy}`
    return `${yyyy}-${mm}-${dd}`
  }
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return ''
}

function inferCategory(description: string, debit: number, credit: number): StatementLineCategory {
  const d = description.toLowerCase()
  if (/bank\s*charge|ledger\s*fee|service\s*fee|excise/.test(d)) return 'bank_charge'
  if (/interest/.test(d)) return 'interest_earned'
  if (/transfer|tfr|ft\b/.test(d)) return 'transfer'
  if (credit > 0) return 'receipt'
  if (debit > 0) return 'payment'
  return 'other'
}

export function bankStatementCsvTemplate(): string {
  return [
    'Date,Description,Reference,Debit,Credit,Balance',
    '2026-08-01,Opening / sample receipt,MPESA-ABC,0,15000,15000',
    '2026-08-02,Vendor payment,CHQ-1001,5000,0,10000',
    '2026-08-03,Bank charges,,50,0,9950',
  ].join('\n')
}

export function parseBankStatementCsv(text: string): {
  lines: ParsedBankStatementLine[]
  errors: string[]
} {
  const rows = parseCSVRows(text)
  const errors: string[] = []
  const lines: ParsedBankStatementLine[] = []

  rows.forEach((row, idx) => {
    const date = parseDate(cell(row, 'Date', 'Txn Date', 'Transaction Date', 'Value Date', 'Posting Date'))
    const description = cell(row, 'Description', 'Narration', 'Particulars', 'Details', 'Memo') || 'Statement line'
    const reference = cell(row, 'Reference', 'Ref', 'Cheque', 'Cheque No', 'Transaction Ref', 'Receipt No')
    let debit = Math.abs(parseAmount(cell(row, 'Debit', 'Withdrawal', 'Money Out', 'Paid Out', 'DR')))
    let credit = Math.abs(parseAmount(cell(row, 'Credit', 'Deposit', 'Money In', 'Paid In', 'CR')))
    const amountRaw = cell(row, 'Amount', 'Txn Amount', 'Transaction Amount')
    if (debit === 0 && credit === 0 && amountRaw) {
      const amt = parseAmount(amountRaw)
      if (amt < 0) debit = Math.abs(amt)
      else if (amt > 0) credit = Math.abs(amt)
    }
    const balanceRaw = cell(row, 'Balance', 'Running Balance', 'Closing Balance')
    const balanceParsed = balanceRaw ? parseAmount(balanceRaw) : undefined
    const balance = balanceParsed != null ? Math.abs(balanceParsed) : undefined

    if (!date) {
      errors.push(`Row ${idx + 2}: missing/invalid date`)
      return
    }
    if (debit === 0 && credit === 0) {
      errors.push(`Row ${idx + 2}: no debit/credit amount`)
      return
    }
    lines.push({
      date,
      description,
      reference,
      debit,
      credit,
      balance,
      category: inferCategory(description, debit, credit),
    })
  })

  return { lines, errors }
}

export function monthFromDate(date: string): string {
  return date.slice(0, 7)
}
