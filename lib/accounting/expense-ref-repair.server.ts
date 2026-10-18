import 'server-only'
import prisma from '@/lib/prisma'
import { loadAppStateForWrite, saveStoreKeys } from '@/lib/server-store'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import {
  postExpenseApproval,
  postExpenseCompanyPayment,
  postExpenseReimbursement,
} from '@/lib/accounting/posting-service'
import { planExpenseRefRepair, type ClaimPlan, type JournalKind } from '@/lib/accounting/expense-ref-plan'

type Claim = Record<string, unknown> & { id: string; ref: string; status: string; amount: number }

async function loadClaims(): Promise<Claim[]> {
  const state = await loadAppStateForWrite(['deed_expenses'])
  const raw = state['deed_expenses']
  const list = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!Array.isArray(list)) throw new Error('Could not read the expense claims')
  return list as Claim[]
}

async function loadExpenseJournals() {
  const rows = await prisma.journalEntry.findMany({
    where: {
      OR: [
        { ref: { startsWith: 'JRN/EXP/' } },
        { ref: { startsWith: 'JRN/EXPPAY/' } },
        { ref: { startsWith: 'JRN/RIM/' } },
      ],
    },
    select: { ref: true, blobId: true, sourceId: true, totalDebit: true, isReversed: true },
  })
  return rows.map(r => ({ ...r, totalDebit: Number(r.totalDebit) }))
}

const day = (v: unknown) => String(v ?? '').slice(0, 10)

export async function expenseRefPlan(): Promise<ClaimPlan[]> {
  const claims = await loadClaims()
  const plans = planExpenseRefRepair(
    claims.map(c => ({
      id: c.id,
      ref: c.ref,
      status: c.status,
      amount: Number(c.amount) || 0,
      paymentMethod: c.paymentMethod as string | undefined,
      submittedByName: c.submittedByName as string | undefined,
      submittedDate: c.submittedDate as string | undefined,
      createdAt: c.createdAt as string | undefined,
      expenseDate: day(c.expenseDate),
    })),
    await loadExpenseJournals(),
  )
  return plans
}

/**
 * Give every claim that shares its number with another a new EXP number from
 * the server counter. Changes no money: journals already posted stay where
 * they are and still count for the claim that owns them.
 */
export async function renumberDuplicateClaims(): Promise<Array<{ id: string; from: string; to: string }>> {
  const plans = await expenseRefPlan()
  const moving = plans.filter(p => p.newRef)
  if (!moving.length) return []
  const claims = await loadClaims()
  const today = new Date().toISOString().slice(0, 10)
  const changes: Array<{ id: string; from: string; to: string }> = []
  const next = new Map<string, string>()
  for (const p of moving) {
    const to = await getNextDocNumber('expense')
    next.set(p.id, to)
    changes.push({ id: p.id, from: p.ref, to })
  }
  const updated = claims.map(c => {
    const to = next.get(c.id)
    if (!to) return c
    const note = `Renumbered from ${c.ref} on ${today}: that number was on more than one claim.`
    return { ...c, ref: to, notes: c.notes ? `${String(c.notes)}\n${note}` : note }
  })
  await saveStoreKeys({ deed_expenses: JSON.stringify(updated) })
  return changes
}

export type PostOutcome = { id: string; ref: string; kind: JournalKind; ok: boolean; journalRef?: string; error?: string }

/**
 * Post the journals approved / paid claims are missing, for claims dated on or
 * after `since`. `entryDate` decides the journal date: the claim's own dates
 * (expense date for the approval, payment date for the payout) or today.
 * Claims still sharing a number are refused: renumber first.
 */
export async function postMissingExpenseJournals(params: {
  since: string
  entryDate: 'claim_date' | 'today'
  actorId: string | null
}): Promise<PostOutcome[]> {
  const plans = await expenseRefPlan()
  const claims = new Map((await loadClaims()).map(c => [c.id, c]))
  const refCount = new Map<string, number>()
  for (const c of claims.values()) refCount.set(c.ref, (refCount.get(c.ref) ?? 0) + 1)
  const today = new Date().toISOString().slice(0, 10)
  const outcomes: PostOutcome[] = []

  for (const p of plans) {
    if (!p.missing.length) continue
    const c = claims.get(p.id)
    if (!c) continue
    if (day(c.expenseDate) < params.since) continue
    for (const kind of p.missing) {
      if ((refCount.get(c.ref) ?? 0) > 1) {
        outcomes.push({ id: p.id, ref: c.ref, kind, ok: false, error: 'still shares its number — renumber first' })
        continue
      }
      const amount = Number(c.amount) || 0
      const date = params.entryDate === 'today'
        ? today
        : kind === 'approval'
          ? day(c.expenseDate) || today
          : kind === 'payment'
            ? day(c.paidDate) || today
            : day(c.reimbursementDate) || today
      try {
        const journal = await prisma.$transaction(async tx => {
          const posted = kind === 'approval'
            ? await postExpenseApproval({
                expenseId: c.id,
                ref: c.ref,
                description: String(c.description || c.ref),
                amount,
                category: c.category ? String(c.category) : undefined,
                paymentMethod: c.paymentMethod ? String(c.paymentMethod) : undefined,
                submittedByName: c.submittedByName ? String(c.submittedByName) : undefined,
                date,
                createdById: params.actorId ?? undefined,
                tx,
              })
            : kind === 'payment'
              ? await postExpenseCompanyPayment({
                  expenseId: c.id,
                  ref: c.ref,
                  amount,
                  paymentMethod: c.paymentMethod ? String(c.paymentMethod) : undefined,
                  bankAccountId: c.paymentBankAccount ? String(c.paymentBankAccount) : undefined,
                  date,
                  createdById: params.actorId ?? undefined,
                  tx,
                })
              : await postExpenseReimbursement({
                  expenseId: c.id,
                  ref: c.ref,
                  amount,
                  submittedByName: c.submittedByName ? String(c.submittedByName) : undefined,
                  bankAccountId: c.reimbursementBankAccount ? String(c.reimbursementBankAccount) : undefined,
                  date,
                  createdById: params.actorId ?? undefined,
                  tx,
                })
          await writeFinancialAuditInTx(tx, {
            userId: params.actorId,
            action: 'post_missing_expense_journal',
            entityType: 'expense',
            entityId: c.id,
            relatedJournalId: posted && 'id' in posted ? String(posted.id) : null,
            newValues: { kind, ref: c.ref, amount, date, journalRef: posted && 'ref' in posted ? posted.ref : null },
          })
          return posted
        }, { isolationLevel: 'Serializable' })
        outcomes.push({ id: p.id, ref: c.ref, kind, ok: true, journalRef: journal && 'ref' in journal ? String(journal.ref) : undefined })
      } catch (err) {
        outcomes.push({ id: p.id, ref: c.ref, kind, ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
  return outcomes
}
