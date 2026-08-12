/**
 * OFX / CSV bank statement parsers (Finance Phase 12).
 * Normalize to match bank-statement-match helpers.
 */

import { createHash } from 'crypto'

export type ImportedStatementLine = {
  date: string
  amount: number
  payee: string
  memo: string
  fitId?: string
  fingerprint: string
}

export function fingerprintStatementLine(input: {
  bankAccountId: string
  date: string
  amount: number
  payee?: string
  memo?: string
  fitId?: string
}): string {
  const raw = [
    input.bankAccountId,
    input.date,
    Number(input.amount).toFixed(2),
    String(input.payee || '').trim().toLowerCase(),
    String(input.memo || '').trim().toLowerCase(),
    String(input.fitId || '').trim(),
  ].join('|')
  return createHash('sha256').update(raw).digest('hex').slice(0, 40)
}

function parseAmount(raw: string): number {
  const cleaned = String(raw || '').replace(/[, ]/g, '').trim()
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function normalizeDate(raw: string): string {
  const s = String(raw || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  // OFX YYYYMMDD
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  // DD/MM/YYYY or MM/DD/YYYY — prefer ISO if day>12 else assume DD/MM/YYYY (KE)
  const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const y = m[3]
    if (a > 12) return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`
    return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`
  }
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return ''
}

export function parseBankStatementCsv(
  text: string,
  bankAccountId: string,
): ImportedStatementLine[] {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return []

  const header = lines[0].split(/[,;\t]/).map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''))
  const idx = (names: string[]) => header.findIndex(h => names.includes(h))
  const dateIdx = idx(['date', 'posted', 'posting date', 'transaction date', 'valuedate', 'value date'])
  const amountIdx = idx(['amount', 'amt', 'value', 'transaction amount'])
  const debitIdx = idx(['debit', 'withdrawal', 'money out'])
  const creditIdx = idx(['credit', 'deposit', 'money in'])
  const payeeIdx = idx(['payee', 'name', 'counterparty', 'beneficiary', 'description'])
  const memoIdx = idx(['memo', 'narrative', 'details', 'reference', 'ref', 'description'])

  const out: ImportedStatementLine[] = []
  for (const row of lines.slice(1)) {
    const cols = row.match(/("([^"]|"")*"|[^,;\t]+)/g)?.map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim())
      || row.split(/[,;\t]/).map(c => c.trim())
    if (!cols.length) continue
    const date = normalizeDate(dateIdx >= 0 ? cols[dateIdx] : cols[0])
    if (!date) continue
    let amount = 0
    if (amountIdx >= 0) amount = parseAmount(cols[amountIdx])
    else {
      const debit = debitIdx >= 0 ? parseAmount(cols[debitIdx]) : 0
      const credit = creditIdx >= 0 ? parseAmount(cols[creditIdx]) : 0
      amount = credit - debit
    }
    if (!amount) continue
    const payee = payeeIdx >= 0 ? cols[payeeIdx] || '' : ''
    const memo = memoIdx >= 0 ? cols[memoIdx] || '' : payee
    const line = {
      date,
      amount,
      payee,
      memo,
      fingerprint: '',
    }
    line.fingerprint = fingerprintStatementLine({
      bankAccountId,
      date: line.date,
      amount: line.amount,
      payee: line.payee,
      memo: line.memo,
    })
    out.push(line)
  }
  return out
}

export function parseBankStatementOfx(
  text: string,
  bankAccountId: string,
): ImportedStatementLine[] {
  const body = String(text || '')
  const blocks = body.split(/<STMTTRN>/i).slice(1)
  const out: ImportedStatementLine[] = []
  for (const block of blocks) {
    const tag = (name: string) => {
      const m = block.match(new RegExp(`<${name}>([^\\n<]+)`, 'i'))
      return m ? m[1].trim() : ''
    }
    const date = normalizeDate(tag('DTPOSTED').slice(0, 8) || tag('DTPOSTED'))
    const amount = parseAmount(tag('TRNAMT'))
    if (!date || !amount) continue
    const payee = tag('NAME') || tag('PAYEE') || ''
    const memo = tag('MEMO') || ''
    const fitId = tag('FITID') || undefined
    out.push({
      date,
      amount,
      payee,
      memo,
      fitId,
      fingerprint: fingerprintStatementLine({
        bankAccountId,
        date,
        amount,
        payee,
        memo,
        fitId,
      }),
    })
  }
  return out
}

export function detectStatementFormat(text: string): 'ofx' | 'csv' {
  const t = String(text || '').slice(0, 400).toUpperCase()
  if (t.includes('OFXHEADER') || t.includes('<OFX') || t.includes('<STMTTRN>')) return 'ofx'
  return 'csv'
}

export function parseBankStatement(
  text: string,
  bankAccountId: string,
  format?: 'ofx' | 'csv' | 'auto',
): { format: 'ofx' | 'csv'; lines: ImportedStatementLine[] } {
  const fmt = format && format !== 'auto' ? format : detectStatementFormat(text)
  const lines = fmt === 'ofx'
    ? parseBankStatementOfx(text, bankAccountId)
    : parseBankStatementCsv(text, bankAccountId)
  return { format: fmt, lines }
}
