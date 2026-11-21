/**
 * What can happen to an expense claim, as plain functions over the list of
 * claims. The server runs these (under the claims lock) and posts the matching
 * journals, so a claim's status and its books change together; the screen
 * only shows the result.
 */
import {
  advanceExpenseApproval,
  buildExpenseApprovalChain,
  canUserReviewExpense,
  expenseChainIsComplete,
  type ExpenseApprovalStep,
} from '@/lib/expense-approval-chain'

export type ClaimStatus = 'submitted' | 'approved' | 'rejected' | 'paid' | 'reimbursed' | 'withdrawn'

export type ClaimHistoryEntry = { date: string; by: string; action: string; note?: string }

export type Claim = {
  id: string
  ref: string
  status: ClaimStatus
  amount: number
  category: string
  description: string
  expenseDate: string
  paymentMethod: string
  payeeName?: string
  notes?: string
  submittedByUserId: string
  submittedByName: string
  approvalChain?: ExpenseApprovalStep[]
  reviewedByUserId?: string
  reviewedByName?: string
  reviewedDate?: string
  reviewNotes?: string
  reimbursementMethod?: string
  reimbursementBankAccount?: string
  reimbursementReference?: string
  reimbursementDate?: string
  paymentBankAccount?: string
  paymentReference?: string
  paidDate?: string
  /** One payment that settled several claims (EXPB/NNNN). */
  paymentBatchRef?: string
  /** Several claims submitted together (a trip): same id and title. */
  reportId?: string
  reportTitle?: string
  history?: ClaimHistoryEntry[]
  [key: string]: unknown
}

export type Actor = {
  id: string
  name: string
  role: string
  /** May approve their own claim (the last approver); decided by the caller from permissions. */
  approvesOwn?: boolean
  /** May change or withdraw anyone's claim (Finance); decided by the caller from permissions. */
  managesAll?: boolean
}

type Failure = { id: string; ref?: string; reason: string }

const isStaffPaid = (c: Pick<Claim, 'paymentMethod'>) => c.paymentMethod === 'reimbursement'

const withHistory = (c: Claim, entry: ClaimHistoryEntry): Claim => ({ ...c, history: [...(c.history ?? []), entry] })

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100

// ── Review (approve / reject), one or many ──────────────────────────────────

export function reviewClaims(
  claims: Claim[],
  ids: string[],
  params: { approved: boolean; notes?: string; actor: Actor; now: string },
): { claims: Claim[]; changed: Claim[]; fullyApproved: Claim[]; failed: Failure[] } {
  const wanted = new Set(ids)
  const changed: Claim[] = []
  const fullyApproved: Claim[] = []
  const failed: Failure[] = []
  const next = claims.map(c => {
    if (!wanted.has(c.id)) return c
    if (c.status !== 'submitted') { failed.push({ id: c.id, ref: c.ref, reason: `${c.ref} is ${c.status}, not waiting for review` }); return c }
    // Nobody approves their own claim — except the last approver.
    if (c.submittedByUserId === params.actor.id && params.approved && !params.actor.approvesOwn) {
      failed.push({ id: c.id, ref: c.ref, reason: `${c.ref} is your own claim — someone else approves it` })
      return c
    }
    if (!canUserReviewExpense(params.actor.role, c.approvalChain)) {
      const pending = c.approvalChain?.find(s => s.status === 'pending')
      failed.push({ id: c.id, ref: c.ref, reason: `${c.ref} needs ${pending?.role?.replace(/_/g, ' ') ?? 'another approver'}` })
      return c
    }
    const chain = c.approvalChain?.length
      ? advanceExpenseApproval({ chain: c.approvalChain, approved: params.approved, reviewerRole: params.actor.role, reviewerName: params.actor.name, reviewedAt: params.now })
      : undefined
    const complete = params.approved && (chain ? expenseChainIsComplete(chain) : true)
    const status: ClaimStatus = !params.approved ? 'rejected' : complete ? 'approved' : 'submitted'
    const final = !params.approved || complete
    const updated = withHistory({
      ...c,
      approvalChain: chain ?? c.approvalChain,
      status,
      reviewedByUserId: final ? params.actor.id : c.reviewedByUserId,
      reviewedByName: final ? params.actor.name : c.reviewedByName,
      reviewedDate: final ? params.now : c.reviewedDate,
      reviewNotes: params.notes?.trim() || c.reviewNotes,
    }, {
      date: params.now,
      by: params.actor.name,
      action: !params.approved ? 'rejected' : complete ? 'approved' : 'approved step',
      note: params.notes?.trim() || undefined,
    })
    changed.push(updated)
    if (complete) fullyApproved.push(updated)
    return updated
  })
  return { claims: next, changed, fullyApproved, failed }
}

// ── Pay / reimburse, one or many in one payment ─────────────────────────────

export function payClaims(
  claims: Claim[],
  ids: string[],
  params: { method: string; bankAccountId: string; reference?: string; date: string; notes?: string; batchRef?: string; actor: Actor; now: string },
): { claims: Claim[]; changed: Claim[]; failed: Failure[]; kind: 'reimbursement' | 'company' | null; total: number } {
  const wanted = new Set(ids)
  const picked = claims.filter(c => wanted.has(c.id))
  const failed: Failure[] = []
  for (const id of ids) if (!picked.some(c => c.id === id)) failed.push({ id, reason: 'Claim not found' })
  for (const c of picked) if (c.status !== 'approved') failed.push({ id: c.id, ref: c.ref, reason: `${c.ref} is ${c.status}, not approved` })
  const kinds = new Set(picked.map(c => (isStaffPaid(c) ? 'reimbursement' : 'company')))
  if (kinds.size > 1) failed.push({ id: '', reason: 'Pay staff reimbursements and company-paid expenses separately' })
  if (failed.length || !picked.length) return { claims, changed: [], failed, kind: null, total: 0 }
  const kind = [...kinds][0] as 'reimbursement' | 'company'
  const changed: Claim[] = []
  const next = claims.map(c => {
    if (!wanted.has(c.id)) return c
    const settled: Claim = kind === 'reimbursement'
      ? { ...c, status: 'reimbursed', reimbursementMethod: params.method, reimbursementBankAccount: params.bankAccountId, reimbursementReference: params.reference, reimbursementDate: params.date }
      : { ...c, status: 'paid', paidDate: params.date, paymentBankAccount: params.bankAccountId, paymentReference: params.reference }
    const updated = withHistory({
      ...settled,
      ...(params.batchRef ? { paymentBatchRef: params.batchRef } : {}),
      reviewNotes: params.notes?.trim() || c.reviewNotes,
    }, {
      date: params.now,
      by: params.actor.name,
      action: kind === 'reimbursement' ? 'reimbursed' : 'paid',
      note: [params.batchRef ? `with ${params.batchRef}` : '', params.reference ? `ref ${params.reference}` : ''].filter(Boolean).join(', ') || undefined,
    })
    changed.push(updated)
    return updated
  })
  return { claims: next, changed, failed, kind, total: money(changed.reduce((s, c) => s + money(c.amount), 0)) }
}

// ── The claimant: edit, withdraw, resubmit ──────────────────────────────────

export type ClaimEdit = Partial<Pick<Claim, 'category' | 'description' | 'amount' | 'expenseDate' | 'paymentMethod' | 'payeeName' | 'notes'>> & {
  /** A receipt attached to a claim that had none (a stored receipt is never replaced). */
  receiptFileName?: string
  receiptFileType?: string
  receiptFileSize?: number
}

function ownOrFinance(c: Claim, actor: Actor) {
  return c.submittedByUserId === actor.id || !!actor.managesAll
}

const noStepTaken = (c: Claim) => !(c.approvalChain ?? []).some(s => s.status !== 'pending')

function applyEdit(c: Claim, patch: ClaimEdit): Claim {
  const next = { ...c }
  if (patch.category !== undefined) next.category = patch.category
  if (patch.description !== undefined) next.description = patch.description.trim()
  if (patch.amount !== undefined) next.amount = money(patch.amount)
  if (patch.expenseDate !== undefined) next.expenseDate = patch.expenseDate
  if (patch.paymentMethod !== undefined) next.paymentMethod = patch.paymentMethod
  if (patch.payeeName !== undefined) next.payeeName = patch.payeeName.trim() || undefined
  if (patch.notes !== undefined) next.notes = patch.notes.trim() || undefined
  if (patch.receiptFileName && !c.receiptFileName) {
    next.receiptFileName = patch.receiptFileName
    next.receiptFileType = patch.receiptFileType
    next.receiptFileSize = patch.receiptFileSize
  }
  return next
}

function validEdit(c: Claim): string | null {
  if (!c.description?.trim()) return 'Describe the expense'
  if (!(money(c.amount) > 0)) return 'The amount must be more than 0'
  if (!c.expenseDate) return 'Choose the expense date'
  if (!c.category) return 'Choose a category'
  return null
}

function describeChanges(before: Claim, after: Claim): string {
  const fields: Array<[keyof Claim, string]> = [['amount', 'amount'], ['category', 'category'], ['description', 'description'], ['expenseDate', 'date'], ['paymentMethod', 'payment'], ['payeeName', 'payee'], ['receiptFileName', 'receipt']]
  return fields.filter(([k]) => before[k] !== after[k]).map(([k, label]) => `${label}: ${String(before[k] ?? '—')} → ${String(after[k] ?? '—')}`).join('; ')
}

/** Change a claim nobody has acted on yet. A new amount may need different approvers. */
export function editClaim(
  claims: Claim[],
  id: string,
  patch: ClaimEdit,
  params: { actor: Actor; now: string; thresholds?: Parameters<typeof buildExpenseApprovalChain>[1] },
): { claims: Claim[]; changed?: Claim; error?: string } {
  const c = claims.find(x => x.id === id)
  if (!c) return { claims, error: 'Claim not found' }
  if (!ownOrFinance(c, params.actor)) return { claims, error: 'Only the person who claimed it can change it' }
  if (c.status !== 'submitted' || !noStepTaken(c)) return { claims, error: `${c.ref} has been reviewed — it can no longer be changed` }
  const edited = applyEdit(c, patch)
  const invalid = validEdit(edited)
  if (invalid) return { claims, error: invalid }
  const changes = describeChanges(c, edited)
  if (!changes) return { claims, changed: c }
  const updated = withHistory({
    ...edited,
    approvalChain: money(edited.amount) !== money(c.amount) ? buildExpenseApprovalChain(money(edited.amount), params.thresholds) : c.approvalChain,
  }, { date: params.now, by: params.actor.name, action: 'edited', note: changes })
  return { claims: claims.map(x => (x.id === id ? updated : x)), changed: updated }
}

/** Take back a claim nobody has acted on yet. */
export function withdrawClaim(
  claims: Claim[],
  id: string,
  params: { actor: Actor; now: string; reason?: string },
): { claims: Claim[]; changed?: Claim; error?: string } {
  const c = claims.find(x => x.id === id)
  if (!c) return { claims, error: 'Claim not found' }
  if (!ownOrFinance(c, params.actor)) return { claims, error: 'Only the person who claimed it can withdraw it' }
  if (c.status !== 'submitted' || !noStepTaken(c)) return { claims, error: `${c.ref} has been reviewed — it can no longer be withdrawn` }
  const updated = withHistory({ ...c, status: 'withdrawn' }, { date: params.now, by: params.actor.name, action: 'withdrawn', note: params.reason?.trim() || undefined })
  return { claims: claims.map(x => (x.id === id ? updated : x)), changed: updated }
}

/** Correct a rejected claim and send it again. It keeps its number; the rejection stays in its history. */
export function resubmitClaim(
  claims: Claim[],
  id: string,
  patch: ClaimEdit,
  params: { actor: Actor; now: string; thresholds?: Parameters<typeof buildExpenseApprovalChain>[1]; note?: string },
): { claims: Claim[]; changed?: Claim; error?: string } {
  const c = claims.find(x => x.id === id)
  if (!c) return { claims, error: 'Claim not found' }
  if (!ownOrFinance(c, params.actor)) return { claims, error: 'Only the person who claimed it can send it again' }
  if (c.status !== 'rejected' && c.status !== 'withdrawn') return { claims, error: `${c.ref} is ${c.status} — only a rejected or withdrawn claim is sent again` }
  const edited = applyEdit(c, patch)
  const invalid = validEdit(edited)
  if (invalid) return { claims, error: invalid }
  const changes = describeChanges(c, edited)
  const updated = withHistory({
    ...edited,
    status: 'submitted',
    approvalChain: buildExpenseApprovalChain(money(edited.amount), params.thresholds),
    reviewedByUserId: undefined,
    reviewedByName: undefined,
    reviewedDate: undefined,
  }, { date: params.now, by: params.actor.name, action: 'sent again', note: [changes, params.note?.trim()].filter(Boolean).join(' · ') || undefined })
  return { claims: claims.map(x => (x.id === id ? updated : x)), changed: updated }
}

// ── Saves from a browser never move a claim backwards ───────────────────────

const RANK: Record<string, number> = { submitted: 0, withdrawn: 1, rejected: 1, approved: 2, paid: 3, reimbursed: 3 }

/** Fields only the server's actions may change once a claim exists. */
const SETTLED_FIELDS = [
  'status', 'approvalChain', 'reviewedByUserId', 'reviewedByName', 'reviewedDate',
  'reimbursementMethod', 'reimbursementBankAccount', 'reimbursementReference', 'reimbursementDate',
  'paymentBankAccount', 'paymentReference', 'paidDate', 'paymentBatchRef', 'history', 'amount',
] as const

/**
 * A browser holding an older copy of the claims list could save it back and
 * undo an approval or a payment the server just recorded (the books would
 * then show a payment the claim does not). For a claim already on the server
 * whose status would go backwards — or an approved / paid claim saved with
 * other money details — the server's status and money fields win.
 */
export function guardClaimRegression<T extends Record<string, any>>(server: T[] | null | undefined, incoming: T[]): T[] {
  const byId = new Map((server ?? []).filter(r => r?.id).map(r => [r.id, r]))
  return incoming.map(row => {
    const was = row?.id ? byId.get(row.id) : undefined
    if (!was) return row
    const from = RANK[String(was.status)] ?? 0
    const to = RANK[String(row.status)] ?? 0
    // Moving forward (an older screen approving or paying) is accepted; a
    // claim still waiting may be saved as it is.
    if (to > from || (to === from && from < 2)) return row
    const kept: Record<string, any> = { ...row }
    for (const f of SETTLED_FIELDS) kept[f] = was[f]
    return kept as T
  })
}
