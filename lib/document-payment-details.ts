/**
 * Per-document payment details shown on quotation / proforma / invoice PDFs.
 * Stored in app_state `deed_documentPaymentDetails` keyed by document id.
 */

import type { BankAccount, CompanySettings } from '@/lib/store'

export const DOCUMENT_PAYMENT_DETAILS_KEY = 'deed_documentPaymentDetails'

export type DocumentPaymentDetails = {
  /** When true (default), PDF uses company default: first bank + M-Pesa. */
  useCompanyDefault: boolean
  /** Selected bank account ids (excludes cash). Used when useCompanyDefault is false. */
  bankAccountIds: string[]
  /** Include company M-Pesa paybill block when custom selection is active. */
  includeMpesa: boolean
  /** Optional free-text line(s) under Payment Details. */
  customNote?: string
}

export type DocumentPaymentDetailsMap = Record<string, DocumentPaymentDetails>

export const DEFAULT_DOCUMENT_PAYMENT_DETAILS: DocumentPaymentDetails = {
  useCompanyDefault: true,
  bankAccountIds: [],
  includeMpesa: true,
  customNote: '',
}

export function normalizeDocumentPaymentDetails(
  raw: Partial<DocumentPaymentDetails> | null | undefined,
): DocumentPaymentDetails {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_DOCUMENT_PAYMENT_DETAILS }
  return {
    useCompanyDefault: raw.useCompanyDefault !== false,
    bankAccountIds: Array.isArray(raw.bankAccountIds)
      ? raw.bankAccountIds.map(String).filter(Boolean)
      : [],
    includeMpesa: raw.includeMpesa !== false,
    customNote: typeof raw.customNote === 'string' ? raw.customNote : '',
  }
}

/** Active banks eligible for PDF payment instructions (not cash float). */
export function selectablePaymentBanks(bankAccounts: BankAccount[]): BankAccount[] {
  return (bankAccounts ?? []).filter(
    a => a.active && a.id !== 'cash' && Boolean(a.accountNo),
  )
}

/**
 * Resolve the payment-detail lines for a commercial PDF.
 * Empty / default selection preserves legacy behaviour (first bank + M-Pesa).
 */
export function buildPaymentDetailLines(opts: {
  details?: Partial<DocumentPaymentDetails> | null
  company: Pick<CompanySettings, 'name' | 'mpesaPaybill' | 'mpesaAccount' | 'currency'>
  bankAccounts: BankAccount[]
  documentRef?: string
  paymentCommunication?: boolean
  currency?: string
}): string[] {
  const details = normalizeDocumentPaymentDetails(opts.details)
  const currency = opts.currency || opts.company.currency || 'KES'
  const lines: string[] = []

  if (opts.paymentCommunication || opts.documentRef) {
    lines.push(`Payment Reference: ${opts.documentRef ?? ''}`)
  }

  const banks = selectablePaymentBanks(opts.bankAccounts)
  const selectedBanks = details.useCompanyDefault
    ? banks.slice(0, 1)
    : banks.filter(b => details.bankAccountIds.includes(b.id))

  for (const bank of selectedBanks) {
    const isMpesaBank = bank.id === 'mpesa' || /m-?pesa/i.test(bank.bankName || bank.name || '')
    if (isMpesaBank) {
      // Prefer company paybill settings when the M-Pesa bank row is selected.
      if (opts.company.mpesaPaybill) {
        lines.push('M-PESA:')
        lines.push(`Pay Bill No: ${opts.company.mpesaPaybill}`)
        if (opts.company.mpesaAccount) {
          lines.push(`Account Number: ${opts.company.mpesaAccount} (${currency})`)
        }
      } else if (bank.accountNo) {
        lines.push('M-PESA:')
        lines.push(`Pay Bill No: ${bank.accountNo}`)
      }
      continue
    }
    lines.push('Bank Transfer:')
    lines.push(`Account Name: ${opts.company.name}`)
    lines.push(`Account Number: ${bank.accountNo} (${bank.currency || currency})`)
    if (bank.bankName) lines.push(`Bank: ${bank.bankName}`)
    if (bank.name && bank.name !== bank.bankName) lines.push(`Account: ${bank.name}`)
  }

  const showMpesa = details.useCompanyDefault
    ? Boolean(opts.company.mpesaPaybill)
    : details.includeMpesa && Boolean(opts.company.mpesaPaybill)
  // Avoid duplicating M-Pesa if already rendered from the mpesa bank row.
  const alreadyHasMpesa = lines.some(l => l === 'M-PESA:')
  if (showMpesa && !alreadyHasMpesa && opts.company.mpesaPaybill) {
    lines.push('M-PESA:')
    lines.push(`Pay Bill No: ${opts.company.mpesaPaybill}`)
    if (opts.company.mpesaAccount) {
      lines.push(`Account Number: ${opts.company.mpesaAccount} (${currency})`)
    }
  }

  const note = details.customNote?.trim()
  if (note) {
    for (const part of note.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
      lines.push(part)
    }
  }

  return lines
}

/** Short UI summary of the custom payment note. */
export function summarizePaymentDetails(
  details: Partial<DocumentPaymentDetails> | null | undefined,
  _bankAccounts?: BankAccount[],
  _company?: Pick<CompanySettings, 'mpesaPaybill'>,
): string {
  const d = normalizeDocumentPaymentDetails(details)
  const note = d.customNote?.trim()
  if (note) {
    const first = note.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || note
    return first.length > 80 ? `${first.slice(0, 77)}…` : first
  }
  return 'Company payment defaults'
}
