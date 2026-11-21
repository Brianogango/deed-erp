import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { userCan } from '@/lib/auth/can'
import { canonicalRole, isDirector } from '@/lib/auth/roles'
import { canReimburseExpense, canReviewExpense } from '@/lib/finance-controls'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { commitPosting, postExpenseApproval, postExpenseCompanyPayment, postExpenseReimbursement } from '@/lib/accounting/posting-service'
import { bankAccountIdForPaymentMethod, bankAccountLabelForId } from '@/lib/accounting/expense-pos-accounts'
import { roundMoney } from '@/lib/accounting/money'
import {
  editClaim,
  payClaims,
  resubmitClaim,
  reviewClaims,
  withdrawClaim,
  type Actor,
  type Claim,
} from '@/lib/expenses/claim-actions'

export const dynamic = 'force-dynamic'

/**
 * POST /api/expenses/actions — everything that changes an expense claim after
 * it is submitted. The claim's status and its journal change together here,
 * under the claims lock, from the server's own copy of the claim (the amount
 * is never taken from the browser).
 *
 *   review    { ids, approved, notes? }                 approve / reject one or many
 *   pay       { ids, method, bankAccountId?, reference?, date, notes? }
 *             one claim: its own payment journal; several: one payment
 *             (EXPB/NNNN), one journal with a line per claim and one bank line
 *   edit      { id, patch }       the claimant, before anyone has acted
 *   withdraw  { id, reason? }     the claimant, before anyone has acted
 *   resubmit  { id, patch?, note? }   a rejected or withdrawn claim, corrected
 */

const patchSchema = z.object({
  category: z.string().min(1).max(60).optional(),
  description: z.string().max(2000).optional(),
  amount: z.number().positive().max(1e9).optional(),
  expenseDate: z.string().max(40).optional(),
  paymentMethod: z.enum(['reimbursement', 'petty_cash', 'mpesa_company', 'company_card']).optional(),
  payeeName: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  receiptFileName: z.string().max(200).optional(),
  receiptFileType: z.string().max(100).optional(),
  receiptFileSize: z.number().int().min(0).max(20_000_000).optional(),
}).strict()

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('review'), ids: z.array(z.string().min(1)).min(1).max(200), approved: z.boolean(), notes: z.string().max(2000).optional() }),
  z.object({
    action: z.literal('pay'),
    ids: z.array(z.string().min(1)).min(1).max(200),
    method: z.string().min(1).max(40),
    bankAccountId: z.string().max(80).optional(),
    reference: z.string().max(120).optional(),
    date: z.string().min(8).max(40),
    notes: z.string().max(2000).optional(),
  }),
  z.object({ action: z.literal('edit'), id: z.string().min(1), patch: patchSchema }),
  z.object({ action: z.literal('withdraw'), id: z.string().min(1), reason: z.string().max(500).optional() }),
  z.object({ action: z.literal('resubmit'), id: z.string().min(1), patch: patchSchema.optional(), note: z.string().max(500).optional() }),
])

function httpError(message: string, status = 422) {
  return Object.assign(new Error(message), { status })
}

async function expenseThresholds() {
  try {
    const rule = await prisma.approvalRule.findUnique({ where: { approvalType: 'expense' } })
    return rule?.isActive && Array.isArray(rule.thresholds) ? rule.thresholds as any : undefined
  } catch {
    return undefined
  }
}

async function assertOpenPeriod(date: string) {
  const parsed = new Date(date.includes('T') ? date : `${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) throw httpError('The date is not valid')
  const lock = await checkFiscalLock(parsed)
  if (!lock.ok) throw httpError(lock.error ?? 'That period is closed', lock.status ?? 409)
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const user = session.user as any
    const role = canonicalRole(user.role)
    const actor: Actor = {
      id: String(user.id),
      name: String(user.name ?? user.username ?? 'Staff'),
      role,
      // The Director is the last approver: nobody else can approve their claims.
      approvesOwn: isDirector(role),
      managesAll: userCan(user, 'expenses.post') && canReviewExpense(role),
    }
    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
    const body = parsed.data

    if (body.action === 'review' && !(userCan(user, 'expenses.post') && canReviewExpense(actor.role))) {
      throw httpError('Only Finance or the Director can review expenses', 403)
    }
    if (body.action === 'pay' && !(userCan(user, 'expenses.post') && canReimburseExpense(actor.role))) {
      throw httpError('Only Finance or the Director can pay expenses', 403)
    }

    const now = new Date().toISOString()
    return withAppStateKeyLock('deed_expenses', async () => {
      const state = await loadAppStateForWrite(['deed_expenses'])
      const claims = (Array.isArray(state.deed_expenses) ? state.deed_expenses : []) as Claim[]
      let next = claims
      let changed: Claim[] = []
      let failed: Array<{ id: string; ref?: string; reason: string }> = []
      let batchRef: string | undefined
      let batchKey: string | undefined

      if (body.action === 'review') {
        const result = reviewClaims(claims, body.ids, { approved: body.approved, notes: body.notes, actor, now })
        failed = result.failed
        // Journals first: idempotent by claim, so a retry after a failed save
        // never posts twice. A refused journal (closed period) refuses the review.
        if (result.fullyApproved.length) {
          await assertOpenPeriod(now)
          await prisma.$transaction(async tx => {
            for (const c of result.fullyApproved) {
              await postExpenseApproval({
                expenseId: c.id, ref: c.ref, description: c.description, amount: roundMoney(c.amount),
                category: c.category, paymentMethod: c.paymentMethod, submittedByName: c.submittedByName,
                date: now, createdById: actor.id, tx,
              })
            }
          })
        }
        next = result.claims
        changed = result.changed
      } else if (body.action === 'pay') {
        await assertOpenPeriod(body.date)
        const picked = claims.filter(c => body.ids.includes(c.id))
        const kindReimburse = picked.length > 0 && picked.every(c => c.paymentMethod === 'reimbursement')
        const bankId = bankAccountIdForPaymentMethod(
          body.method === 'cash' ? 'cash' : body.method === 'mpesa' ? 'mpesa' : kindReimburse ? 'bank_transfer' : body.method,
          body.bankAccountId,
        )
        if (picked.length > 1) {
          // The same claims paid again after a failed save find their batch.
          batchKey = `expb:${createHash('sha1').update([...body.ids].sort().join(',')).digest('hex').slice(0, 24)}`
          const existing = await prisma.journalEntry.findFirst({ where: { blobId: batchKey }, select: { ref: true } }).catch(() => null)
          batchRef = existing?.ref?.replace(/^JRN\//, '') ?? await getNextDocNumber('expense_payment')
        }
        const result = payClaims(claims, body.ids, {
          method: body.method, bankAccountId: bankId, reference: body.reference?.trim() || undefined,
          date: body.date, notes: body.notes, batchRef, actor, now,
        })
        failed = result.failed
        if (failed.length) return NextResponse.json({ error: failed.map(f => f.reason).join('; '), failed }, { status: 422 })
        await prisma.$transaction(async tx => {
          if (result.changed.length === 1) {
            const c = result.changed[0]
            if (result.kind === 'reimbursement') {
              await postExpenseReimbursement({ expenseId: c.id, ref: c.ref, amount: roundMoney(c.amount), submittedByName: c.submittedByName, bankAccountId: bankId, date: body.date, createdById: actor.id, tx })
            } else {
              await postExpenseCompanyPayment({ expenseId: c.id, ref: c.ref, amount: roundMoney(c.amount), paymentMethod: body.method, bankAccountId: bankId, date: body.date, createdById: actor.id, tx })
            }
            return
          }
          // One payment, one journal: a line per claim against what was owed,
          // one bank line for the money that left — as the bank statement shows it.
          const reimburse = result.kind === 'reimbursement'
          await commitPosting({
            ref: `JRN/${batchRef}`,
            source: 'expense',
            description: `${reimburse ? 'Expense reimbursement' : 'Expense payment'} — ${batchRef} (${result.changed.length} claims)`,
            date: body.date,
            blobId: batchKey,
            lines: [
              ...result.changed.map(c => ({
                role: reimburse ? 'employee_reimbursements' as const : 'outstanding_payments' as const,
                description: reimburse ? `Settle reimbursement: ${c.submittedByName} — ${c.ref}` : `Settle approved expense: ${c.ref}`,
                debit: roundMoney(c.amount),
                credit: 0,
              })),
              {
                accountLabel: bankAccountLabelForId(bankId, body.method),
                cashBankAccountId: bankId,
                description: `Paid ${batchRef}${body.reference ? ` (ref ${body.reference})` : ''}`,
                debit: 0,
                credit: result.total,
              },
            ],
            createdById: actor.id,
            journalCode: bankId === 'cash' || bankId === 'mpesa' ? 'CSH' : 'BNK',
            tx,
          })
        })
        next = result.claims
        changed = result.changed
      } else {
        const thresholds = body.action === 'withdraw' ? undefined : await expenseThresholds()
        const result = body.action === 'edit'
          ? editClaim(claims, body.id, body.patch, { actor, now, thresholds })
          : body.action === 'withdraw'
            ? withdrawClaim(claims, body.id, { actor, now, reason: body.reason })
            : resubmitClaim(claims, body.id, body.patch ?? {}, { actor, now, thresholds, note: body.note })
        if (result.error) throw httpError(result.error)
        next = result.claims
        changed = result.changed ? [result.changed] : []
      }

      if (changed.length) await saveStoreKeys({ deed_expenses: JSON.stringify(next) })
      if (!changed.length && failed.length) {
        return NextResponse.json({ error: failed.map(f => f.reason).join('; '), failed }, { status: 422 })
      }
      return NextResponse.json({ claims: changed, failed, batchRef })
    })
  })
}
