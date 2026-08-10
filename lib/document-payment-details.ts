/**
 * Per-document payment details shown on quotation / proforma / invoice PDFs.
 * Stored in app_state `deed_documentPaymentDetails` keyed by document id.
 *
 * Bank rules:
 * - VAT documents → NCBA (locked)
 * - Non-VAT documents → ABSA or I&M (user choice)
 * Matching prefers bankName over id (production rows may reuse legacy ids).
 */

import type { BankAccount, CompanySettings } from '@/lib/store'

export const DOCUMENT_PAYMENT_DETAILS_KEY = 'deed_documentPaymentDetails'

export type PaymentBankRole = 'ncba' | 'absa' | 'im'

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
    a => a.active && a.id !== 'cash' && Boolean(a.accountNo) && !/^cash$/i.test(a.bankName || ''),
  )
}

export function documentHasVat(doc: {
  taxTotal?: number | null
  taxAmount?: number | null
  lines?: Array<{ taxRate?: number | null; lineType?: string }> | null
}): boolean {
  if (Number(doc.taxTotal) > 0 || Number(doc.taxAmount) > 0) return true
  return (doc.lines ?? []).some(
    l => l.lineType !== 'section' && Number(l.taxRate) > 0,
  )
}

export function resolvePaymentBankRole(bank: Pick<BankAccount, 'id' | 'name' | 'bankName'>): PaymentBankRole | null {
  const hay = `${bank.id} ${bank.bankName} ${bank.name}`
  if (/ncba/i.test(hay)) return 'ncba'
  if (/absa/i.test(hay)) return 'absa'
  // I&M / I and M — avoid matching bare "im" inside other words via bank id only
  if (/i\s*&\s*m|i\s+and\s+m/i.test(hay) || /^(im|iandm|i_m)$/i.test(bank.id)) return 'im'
  return null
}

/** First active bank for each payment role (NCBA / ABSA / I&M). */
export function banksByPaymentRole(
  bankAccounts: BankAccount[],
): Partial<Record<PaymentBankRole, BankAccount>> {
  const out: Partial<Record<PaymentBankRole, BankAccount>> = {}
  for (const bank of selectablePaymentBanks(bankAccounts)) {
    const role = resolvePaymentBankRole(bank)
    if (!role || out[role]) continue
    out[role] = bank
  }
  return out
}

export function paymentRoleLabel(role: PaymentBankRole): string {
  if (role === 'ncba') return 'NCBA'
  if (role === 'absa') return 'ABSA'
  return 'I&M Bank'
}

/**
 * Align stored payment details to VAT / non-VAT bank rules.
 * Preserves customNote and an existing valid non-VAT choice (ABSA vs I&M).
 */
export function alignPaymentDetailsToTax(
  existing: Partial<DocumentPaymentDetails> | null | undefined,
  isVat: boolean,
  bankAccounts: BankAccount[],
): DocumentPaymentDetails {
  const current = normalizeDocumentPaymentDetails(existing)
  const roles = banksByPaymentRole(bankAccounts)
  const note = current.customNote ?? ''

  if (isVat) {
    const ncba = roles.ncba
    if (!ncba) {
      return {
        useCompanyDefault: true,
        bankAccountIds: [],
        includeMpesa: true,
        customNote: note,
      }
    }
    if (
      !current.useCompanyDefault
      && current.bankAccountIds.length === 1
      && current.bankAccountIds[0] === ncba.id
      && current.includeMpesa
    ) {
      return current
    }
    return {
      useCompanyDefault: false,
      bankAccountIds: [ncba.id],
      includeMpesa: true,
      customNote: note,
    }
  }

  const allowedIds = [roles.absa?.id, roles.im?.id].filter(Boolean) as string[]
  if (!allowedIds.length) {
    return {
      useCompanyDefault: true,
      bankAccountIds: [],
      includeMpesa: true,
      customNote: note,
    }
  }

  const currentId = current.bankAccountIds[0]
  if (!current.useCompanyDefault && currentId && allowedIds.includes(currentId) && current.includeMpesa) {
    return current
  }

  const pick = roles.absa?.id || roles.im!.id
  return {
    useCompanyDefault: false,
    bankAccountIds: [pick],
    includeMpesa: true,
    customNote: note,
  }
}

export function paymentDetailsEqual(
  a: DocumentPaymentDetails,
  b: DocumentPaymentDetails,
): boolean {
  return (
    a.useCompanyDefault === b.useCompanyDefault
    && a.includeMpesa === b.includeMpesa
    && (a.customNote || '') === (b.customNote || '')
    && a.bankAccountIds.length === b.bankAccountIds.length
    && a.bankAccountIds.every((id, i) => id === b.bankAccountIds[i])
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
    const isMpesaBank = bank.id === 'mpesa' && /m-?pesa/i.test(bank.bankName || bank.name || '')
    if (isMpesaBank) {
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
    // Skip rows that are actually M-Pesa by name when selected as a "bank"
    if (/m-?pesa/i.test(bank.bankName || '') && !/absa|ncba|i\s*&\s*m|equity|kcb/i.test(bank.bankName || '')) {
      continue
    }
    lines.push('Bank Transfer:')
    lines.push(`Account Name: ${opts.company.name}`)
    lines.push(`Account Number: ${bank.accountNo} (${bank.currency || currency})`)
    if (bank.bankName) lines.push(`Bank: ${bank.bankName}`)
    if (bank.name && bank.name !== bank.bankName && !/^deed/i.test(bank.name)) {
      lines.push(`Account: ${bank.name}`)
    }
  }

  const showMpesa = details.useCompanyDefault
    ? Boolean(opts.company.mpesaPaybill)
    : details.includeMpesa && Boolean(opts.company.mpesaPaybill)
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

/** Short UI summary of selected bank + optional note. */
export function summarizePaymentDetails(
  details: Partial<DocumentPaymentDetails> | null | undefined,
  bankAccounts?: BankAccount[],
  _company?: Pick<CompanySettings, 'mpesaPaybill'>,
): string {
  const d = normalizeDocumentPaymentDetails(details)
  const banks = bankAccounts ? selectablePaymentBanks(bankAccounts) : []
  let bankLabel = 'Company payment defaults'
  if (!d.useCompanyDefault && d.bankAccountIds.length) {
    const selected = banks.filter(b => d.bankAccountIds.includes(b.id))
    if (selected.length) {
      bankLabel = selected
        .map(b => {
          const role = resolvePaymentBankRole(b)
          return role ? paymentRoleLabel(role) : (b.bankName || b.name)
        })
        .join(' · ')
    }
  } else if (d.useCompanyDefault && banks[0]) {
    const role = resolvePaymentBankRole(banks[0])
    bankLabel = role ? paymentRoleLabel(role) : (banks[0].bankName || banks[0].name)
  }

  const note = d.customNote?.trim()
  if (note) {
    const first = note.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || note
    const short = first.length > 48 ? `${first.slice(0, 45)}…` : first
    return `${bankLabel} — ${short}`
  }
  return bankLabel
}
