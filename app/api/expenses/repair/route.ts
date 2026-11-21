import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { canonicalRole } from '@/lib/auth/roles'
import { canReimburseExpense } from '@/lib/finance-controls'
import { loadAppStateForWrite, withAppStateKeyLock } from '@/lib/server-store'
import { postExpenseApproval, postExpenseCompanyPayment, postExpenseReimbursement } from '@/lib/accounting/posting-service'
import { roundMoney } from '@/lib/accounting/money'
import type { Claim } from '@/lib/expenses/claim-actions'

export const dynamic = 'force-dynamic'

/**
 * Claims whose books do not match their status, and the fix.
 *
 *   GET  — list them (nothing changes)
 *   POST — post the missing journals
 *
 * Only an approval or payment journal that is truly missing is posted: a
 * journal already filed under the claim (by its id, or its own number when
 * that number is not shared) counts as present. A claim sharing its number
 * with another is listed, not fixed — scripts/repair-expense-numbers.mjs
 * renumbers those first.
 */

type Finding = { id: string; ref: string; status: string; amount: number; missing: 'approval' | 'payment'; fixable: boolean; note?: string }

async function journalFor(id: string, ref: string, prefix: string, refUnique: boolean) {
  const found = await prisma.journalEntry.findFirst({
    where: {
      isReversed: false,
      OR: [
        { ref: { startsWith: prefix }, blobId: { startsWith: id } },
        { ref: { startsWith: prefix }, sourceId: { startsWith: id } },
        ...(refUnique ? [{ ref: `${prefix}${ref}` }] : []),
      ],
    },
    select: { id: true },
  })
  return !!found
}

async function findings(claims: Claim[]): Promise<Finding[]> {
  const refCount = new Map<string, number>()
  for (const c of claims) refCount.set(c.ref, (refCount.get(c.ref) ?? 0) + 1)
  const out: Finding[] = []
  for (const c of claims) {
    if (!['approved', 'paid', 'reimbursed'].includes(c.status)) continue
    const unique = (refCount.get(c.ref) ?? 0) === 1
    const base = { id: c.id, ref: c.ref, status: c.status, amount: roundMoney(c.amount) }
    if (!(await journalFor(c.id, c.ref, 'JRN/EXP/', unique))) {
      out.push({ ...base, missing: 'approval', fixable: unique, note: unique ? undefined : 'Shares its number with another claim — renumber first' })
    }
    if (c.status === 'paid' || c.status === 'reimbursed') {
      const batchPosted = c.paymentBatchRef
        ? !!(await prisma.journalEntry.findFirst({ where: { ref: `JRN/${c.paymentBatchRef}`, isReversed: false }, select: { id: true } }))
        : false
      const prefix = c.status === 'paid' ? 'JRN/EXPPAY/' : 'JRN/RIM/'
      if (!batchPosted && !(await journalFor(c.id, c.ref, prefix, unique))) {
        out.push({
          ...base,
          missing: 'payment',
          fixable: unique && !c.paymentBatchRef,
          note: c.paymentBatchRef ? `Paid with ${c.paymentBatchRef}, whose journal is missing — check it in Finance` : unique ? undefined : 'Shares its number with another claim — renumber first',
        })
      }
    }
  }
  return out
}

async function guard() {
  const user = await requirePermission('expenses.post')
  if (!canReimburseExpense(canonicalRole((user as any).role))) {
    throw Object.assign(new Error('Only Finance or the Director can repair expense journals'), { status: 403 })
  }
  return user
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await guard()
    const state = await loadAppStateForWrite(['deed_expenses'])
    const claims = (Array.isArray(state.deed_expenses) ? state.deed_expenses : []) as Claim[]
    return NextResponse.json({ findings: await findings(claims) })
  })
}

export async function POST() {
  return withApiErrorHandling(async () => {
    const user = await guard()
    return withAppStateKeyLock('deed_expenses', async () => {
      const state = await loadAppStateForWrite(['deed_expenses'])
      const claims = (Array.isArray(state.deed_expenses) ? state.deed_expenses : []) as Claim[]
      const list = await findings(claims)
      const fixed: Finding[] = []
      const failed: Array<Finding & { error: string }> = []
      for (const f of list.filter(x => x.fixable)) {
        const c = claims.find(x => x.id === f.id)!
        try {
          if (f.missing === 'approval') {
            await postExpenseApproval({
              expenseId: c.id, ref: c.ref, description: c.description, amount: roundMoney(c.amount),
              category: c.category, paymentMethod: c.paymentMethod, submittedByName: c.submittedByName,
              date: c.reviewedDate || c.expenseDate, createdById: (user as any).id,
            })
          } else if (c.status === 'reimbursed') {
            await postExpenseReimbursement({
              expenseId: c.id, ref: c.ref, amount: roundMoney(c.amount), submittedByName: c.submittedByName,
              bankAccountId: c.reimbursementBankAccount, date: c.reimbursementDate || c.reviewedDate || c.expenseDate, createdById: (user as any).id,
            })
          } else {
            await postExpenseCompanyPayment({
              expenseId: c.id, ref: c.ref, amount: roundMoney(c.amount), paymentMethod: c.paymentMethod,
              bankAccountId: c.paymentBankAccount, date: c.paidDate || c.reviewedDate || c.expenseDate, createdById: (user as any).id,
            })
          }
          fixed.push(f)
        } catch (err) {
          failed.push({ ...f, error: err instanceof Error ? err.message : 'Could not post' })
        }
      }
      return NextResponse.json({ fixed, failed, notFixable: list.filter(x => !x.fixable) })
    })
  })
}
