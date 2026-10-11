/**
 * Credit facility applications — the rules, kept free of the database so
 * they can be tested and shown on screen exactly as the server applies them.
 *
 * Source documents: Deed Technologies Credit Application Form, Credit Check
 * checklist and Corporate Client Payment Policy Acceptance Form.
 */

export type CreditFacilityStatus =
  | 'draft'           // opened by sales, nothing sent yet
  | 'sent'            // application pack sent to the client
  | 'submitted'       // form and documents back from the client
  | 'under_review'    // finance doing the credit check
  | 'info_requested'  // finance asked the client for more
  | 'recommended'     // finance recommends; above the finance limit, waits for a director
  | 'approved'        // credit active on the customer
  | 'declined'
  | 'withdrawn'
  | 'suspended'       // approved credit put on hold (customer back to pay on receipt)
  | 'revoked'         // approved credit ended

export const OPEN_STATUSES: CreditFacilityStatus[] = ['draft', 'sent', 'submitted', 'under_review', 'info_requested', 'recommended']
export const DECIDED_STATUSES: CreditFacilityStatus[] = ['approved', 'declined', 'withdrawn', 'suspended', 'revoked']

export const STATUS_LABELS: Record<CreditFacilityStatus, string> = {
  draft: 'Draft',
  sent: 'Sent to client',
  submitted: 'Submitted',
  under_review: 'Under review',
  info_requested: 'More info requested',
  recommended: 'Awaiting director',
  approved: 'Approved',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  suspended: 'Suspended',
  revoked: 'Revoked',
}

/** Finance can approve a limit up to this amount on its own; above it a director decides. */
export const FINANCE_APPROVAL_LIMIT = 100_000
/** Payment policy: credit is offered after at least this many paid transactions. */
export const MIN_PAID_TRANSACTIONS = 3
/** Standard terms (credit application form): 30 days from invoice date. */
export const STANDARD_TERMS_DAYS = 30
/** Approved credit is reviewed this many months after the decision. */
export const REVIEW_MONTHS = 12

export type DocumentKind =
  | 'application_form'
  | 'payment_policy_acceptance'
  | 'audited_financials'
  | 'bank_statements'
  | 'bank_reference_letter'
  | 'certificate_of_incorporation'
  | 'tax_compliance_certificate'
  | 'kra_pin_certificate'
  | 'directors_ids'
  | 'business_permit'
  | 'credit_bureau_report'
  | 'other'

export type DocumentRule = { kind: DocumentKind; label: string; required: boolean; expires: boolean; hint?: string }

/** The checklist from the credit application form, plus the two signed forms. */
export const DOCUMENT_RULES: DocumentRule[] = [
  { kind: 'application_form', label: 'Signed credit application form', required: true, expires: false, hint: 'Signed and stamped by the authorised signatories' },
  { kind: 'payment_policy_acceptance', label: 'Signed payment policy acceptance form', required: true, expires: false },
  { kind: 'audited_financials', label: 'Latest audited financial statements', required: true, expires: false, hint: 'Balance sheet, income and cash flow statements, last two years' },
  { kind: 'bank_statements', label: 'Bank statements — last three months', required: true, expires: false },
  { kind: 'bank_reference_letter', label: 'Reference letter from bank', required: true, expires: false },
  { kind: 'certificate_of_incorporation', label: 'Certificate of incorporation', required: true, expires: false },
  { kind: 'tax_compliance_certificate', label: 'VAT / tax compliance certificate', required: true, expires: true, hint: 'Valid for 12 months — record the expiry date' },
  { kind: 'kra_pin_certificate', label: 'KRA PIN certificate', required: true, expires: false },
  { kind: 'directors_ids', label: "Directors' ID / passport copies", required: true, expires: false },
  { kind: 'business_permit', label: 'Valid current business permit', required: true, expires: true, hint: 'Record the expiry date' },
  { kind: 'credit_bureau_report', label: 'Credit bureau report', required: false, expires: false, hint: 'Obtained by Finance' },
  { kind: 'other', label: 'Other', required: false, expires: false },
]

export const DOCUMENT_KINDS = new Set<string>(DOCUMENT_RULES.map(r => r.kind))

export type DocumentStatus = 'received' | 'verified' | 'rejected'

export type ApplicationDocument = {
  kind: string
  status: string
  expiresOn?: string | Date | null
}

/** Finance's credit check (Credit Check checklist, sections 2–6). */
export type CreditAssessment = {
  financialsReviewed?: boolean
  bankStatementsReviewed?: boolean
  taxCompliant?: boolean
  creditBureauChecked?: boolean
  creditBureauNote?: string
  outstandingDebtsNote?: string
  debtToEquity?: string
  courtRecordsClear?: boolean
  bankReferenceVerified?: boolean
  bankReferenceNote?: string
  tradeReferencesChecked?: number
  tradeReferencesNote?: string
  notes?: string
}

export type RiskClass = 'low' | 'medium' | 'high'

const day = (value: string | Date | null | undefined): string => {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

/** Per required document: has a verified, unexpired copy been recorded? */
export function documentChecklist(docs: ApplicationDocument[], today = new Date()) {
  const todayIso = day(today)
  return DOCUMENT_RULES.map(rule => {
    const ofKind = docs.filter(d => d.kind === rule.kind)
    const verified = ofKind.filter(d => d.status === 'verified')
    const current = verified.filter(d => !rule.expires || !d.expiresOn || day(d.expiresOn) >= todayIso)
    const missingExpiry = rule.expires && current.some(d => !d.expiresOn)
    const state: 'verified' | 'expired' | 'received' | 'rejected' | 'missing' =
      current.length ? 'verified'
      : verified.length ? 'expired'
      : ofKind.some(d => d.status === 'received') ? 'received'
      : ofKind.some(d => d.status === 'rejected') ? 'rejected'
      : 'missing'
    return { ...rule, state, count: ofKind.length, missingExpiry }
  })
}

/** Who must decide a limit: finance up to the finance limit, a director above it. */
export function approvalLevel(limit: number): 'finance_officer' | 'director' {
  return Number(limit) > FINANCE_APPROVAL_LIMIT ? 'director' : 'finance_officer'
}

export type ApprovalCheck = {
  /** Things that stop the application being approved at all. */
  blockers: string[]
  /** Who may approve it (after the blockers are cleared). */
  level: 'finance_officer' | 'director'
  /** Fewer paid transactions than the payment policy asks: only a director may approve. */
  policyException: boolean
}

/**
 * Can this application be approved for this limit? Finance approves up to
 * KES 100,000; above that, or when the customer has fewer than three paid
 * transactions (payment policy), only a director can.
 */
export function approvalCheck(input: {
  approvedLimit: number
  approvedTermsDays: number
  riskClass?: string | null
  documents: ApplicationDocument[]
  paidTransactions: number
  today?: Date
}): ApprovalCheck {
  const blockers: string[] = []
  const limit = Number(input.approvedLimit) || 0
  if (limit <= 0) blockers.push('Set the credit limit to approve')
  if (!(Number(input.approvedTermsDays) > 0)) blockers.push('Set the payment terms (days) to approve')
  if (!input.riskClass) blockers.push('Classify the risk (low, medium or high)')
  for (const item of documentChecklist(input.documents, input.today)) {
    if (!item.required) continue
    if (item.state === 'expired') blockers.push(`${item.label}: expired — a current copy is needed`)
    else if (item.state !== 'verified') blockers.push(`${item.label}: not verified`)
    else if (item.missingExpiry) blockers.push(`${item.label}: record its expiry date`)
  }
  const policyException = (Number(input.paidTransactions) || 0) < MIN_PAID_TRANSACTIONS
  const level = policyException ? 'director' : approvalLevel(limit)
  return { blockers, level, policyException }
}

export function canDecide(role: string, level: 'finance_officer' | 'director'): boolean {
  if (role === 'director') return true
  return level === 'finance_officer' && role === 'finance_officer'
}

export type CreditAction =
  | 'mark_sent' | 'submit' | 'start_review' | 'request_info' | 'recommend'
  | 'approve' | 'decline' | 'withdraw' | 'suspend' | 'reinstate' | 'revoke'

/** Status each action moves from → to. */
export const TRANSITIONS: Record<CreditAction, { from: CreditFacilityStatus[]; to: CreditFacilityStatus }> = {
  mark_sent: { from: ['draft'], to: 'sent' },
  submit: { from: ['draft', 'sent', 'info_requested'], to: 'submitted' },
  start_review: { from: ['submitted'], to: 'under_review' },
  request_info: { from: ['submitted', 'under_review', 'recommended'], to: 'info_requested' },
  recommend: { from: ['submitted', 'under_review'], to: 'recommended' },
  approve: { from: ['submitted', 'under_review', 'recommended'], to: 'approved' },
  decline: { from: ['submitted', 'under_review', 'recommended', 'info_requested'], to: 'declined' },
  withdraw: { from: ['draft', 'sent', 'submitted', 'under_review', 'info_requested', 'recommended'], to: 'withdrawn' },
  suspend: { from: ['approved'], to: 'suspended' },
  reinstate: { from: ['suspended'], to: 'approved' },
  revoke: { from: ['approved', 'suspended'], to: 'revoked' },
}

/** Roles that may take each action (on top of the approval-level check). */
export const ACTION_ROLES: Record<CreditAction, string[]> = {
  mark_sent: ['sales_rep', 'finance_officer', 'director', 'admin_officer'],
  submit: ['sales_rep', 'finance_officer', 'director', 'admin_officer'],
  withdraw: ['sales_rep', 'finance_officer', 'director', 'admin_officer'],
  start_review: ['finance_officer', 'director'],
  request_info: ['finance_officer', 'director'],
  recommend: ['finance_officer', 'director'],
  approve: ['finance_officer', 'director'],
  decline: ['finance_officer', 'director'],
  suspend: ['finance_officer', 'director'],
  reinstate: ['director'],
  revoke: ['director'],
}

export function nextStatus(action: CreditAction, from: string): CreditFacilityStatus | null {
  const t = TRANSITIONS[action]
  return t && (t.from as string[]).includes(from) ? t.to : null
}

/** The customer's credit standing that follows from an application's status. */
export function clientCreditStatus(status: CreditFacilityStatus): 'approved' | 'suspended' | 'revoked' | null {
  if (status === 'approved') return 'approved'
  if (status === 'suspended') return 'suspended'
  if (status === 'revoked') return 'revoked'
  return null
}

export function reviewDueFrom(decidedAt: Date, months = REVIEW_MONTHS): string {
  const d = new Date(decidedAt)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

export function nextRef(year: number, lastRef: string | null | undefined): string {
  const m = String(lastRef ?? '').match(/(\d+)$/)
  const n = m ? Number(m[1]) + 1 : 1
  return `CA/${year}/${String(n).padStart(4, '0')}`
}
