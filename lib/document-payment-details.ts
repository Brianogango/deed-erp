/**
 * Per-document payment details shown on quotation / proforma / invoice PDFs.
 * Stored in app_state `deed_documentPaymentDetails` keyed by document id.
 *
 * Bank rules:
 * - VAT documents → NCBA (locked)
 * - Non-VAT documents → ABSA, I&M, Equity, or Credit Bank (user choice)
 *
 * Each bank's Bank Transfer block is paired with **that bank's** M-Pesa
 * paybill/account — never the company-wide NCBA default when another bank
 * is selected (the INV mixup that put I&M transfer + NCBA 880100 together).
 *
 * Matching prefers bankName over id (production rows may reuse legacy ids).
 */

import type { BankAccount, CompanySettings } from '@/lib/store'

export const DOCUMENT_PAYMENT_DETAILS_KEY = 'deed_documentPaymentDetails'

export type PaymentBankRole = 'ncba' | 'absa' | 'im' | 'equity' | 'credit'

export type DocumentPaymentDetails = {
  /** When true (default), PDF uses company default: first bank + its M-Pesa. */
  useCompanyDefault: boolean
  /** Selected bank account ids (excludes cash). Used when useCompanyDefault is false. */
  bankAccountIds: string[]
  /** Include the selected bank's M-Pesa paybill block when custom selection is active. */
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

/** Canonical M-Pesa pairs for Deed bank accounts (source of truth for PDF pairing). */
export const BANK_MPESA_BY_ROLE: Record<PaymentBankRole, { paybill: string; account: string }> = {
  ncba: { paybill: '880100', account: '468778' },
  absa: { paybill: '303030', account: '2043953071' },
  im: { paybill: '542542', account: '391572' },
  equity: { paybill: '247247', account: '0020284195905' },
  credit: { paybill: '972700', account: '0131006000351' },
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
  if (/equity/i.test(hay)) return 'equity'
  if (/credit\s*bank/i.test(hay) || /^credit$/i.test(bank.id)) return 'credit'
  // I&M / I and M — avoid matching bare "im" inside other words via bank id only
  if (/i\s*&\s*m|i\s+and\s+m/i.test(hay) || /^(im|iandm|i_m)$/i.test(bank.id)) return 'im'
  return null
}

/** First active bank for each payment role. */
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
  if (role === 'equity') return 'Equity'
  if (role === 'credit') return 'Credit Bank'
  return 'I&M Bank'
}

/**
 * Resolve the M-Pesa paybill/account that belongs with a bank transfer row.
 * Prefer fields on the bank row, then role defaults, then company settings
 * only when the bank itself is NCBA (company defaults are the NCBA pair).
 */
export function resolveBankMpesa(
  bank: Pick<BankAccount, 'id' | 'name' | 'bankName' | 'mpesaPaybill' | 'mpesaAccount'>,
  company?: Pick<CompanySettings, 'mpesaPaybill' | 'mpesaAccount'> | null,
): { paybill: string; account: string } | null {
  const paybill = String(bank.mpesaPaybill || '').replace(/\s+/g, '').trim()
  const account = String(bank.mpesaAccount || '').replace(/\s+/g, '').trim()
  if (paybill) return { paybill, account }

  const role = resolvePaymentBankRole(bank)
  if (role && BANK_MPESA_BY_ROLE[role]) {
    return { ...BANK_MPESA_BY_ROLE[role] }
  }

  if (role === 'ncba' || (!role && company?.mpesaPaybill)) {
    const coPaybill = String(company?.mpesaPaybill || '').replace(/\s+/g, '').trim()
    if (!coPaybill) return null
    return {
      paybill: coPaybill,
      account: String(company?.mpesaAccount || '').replace(/\s+/g, '').trim(),
    }
  }
  return null
}

/** Non-VAT banks staff may pick on a document. */
export const NON_VAT_PAYMENT_ROLES: PaymentBankRole[] = ['absa', 'im', 'equity', 'credit']

/**
 * Align stored payment details to VAT / non-VAT bank rules.
 * Preserves customNote and an existing valid non-VAT choice.
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

  const allowedIds = NON_VAT_PAYMENT_ROLES
    .map(r => roles[r]?.id)
    .filter(Boolean) as string[]
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

  const pick = roles.absa?.id || roles.im?.id || roles.equity?.id || roles.credit?.id || allowedIds[0]
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

function appendMpesaBlock(
  lines: string[],
  mpesa: { paybill: string; account: string },
  currency: string,
) {
  lines.push('M-PESA:')
  lines.push(`Pay Bill No: ${mpesa.paybill}`)
  if (mpesa.account) {
    lines.push(`Account Number: ${mpesa.account} (${currency})`)
  }
}

/**
 * Resolve the payment-detail lines for a commercial PDF.
 * Empty / default selection preserves legacy behaviour (first bank + its M-Pesa).
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

  const banks = selectablePaymentBanks(opts.bankAccounts).filter(b => {
    // Skip standalone Safaricom M-Pesa shells — real banks carry their own paybill.
    if (b.id === 'mpesa' && /m-?pesa|safaricom/i.test(b.bankName || b.name || '')) return false
    return true
  })
  const selectedBanks = details.useCompanyDefault
    ? banks.slice(0, 1)
    : banks.filter(b => details.bankAccountIds.includes(b.id))

  const showMpesa = details.useCompanyDefault
    ? true
    : details.includeMpesa

  for (const bank of selectedBanks) {
    lines.push('Bank Transfer:')
    lines.push(`Account Name: ${opts.company.name}`)
    lines.push(`Account Number: ${bank.accountNo} (${bank.currency || currency})`)
    if (bank.bankName) lines.push(`Bank: ${bank.bankName}`)
    if (bank.name && bank.name !== bank.bankName && !/^deed/i.test(bank.name)) {
      lines.push(`Account: ${bank.name}`)
    }

    if (showMpesa) {
      const mpesa = resolveBankMpesa(bank, opts.company)
      if (mpesa) appendMpesaBlock(lines, mpesa, currency)
    }
  }

  // Company-default path with no selectable banks — fall back to company M-Pesa only.
  if (selectedBanks.length === 0 && showMpesa && opts.company.mpesaPaybill) {
    appendMpesaBlock(lines, {
      paybill: String(opts.company.mpesaPaybill).replace(/\s+/g, ''),
      account: String(opts.company.mpesaAccount || '').replace(/\s+/g, ''),
    }, currency)
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
