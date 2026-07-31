import 'server-only'
import prisma from '@/lib/prisma'
import { extractAccountCode, uuidFromKey } from '@/lib/accounting/ids'

export type JournalLineInput = {
  accountLabel: string
  label?: string
  debit: number
  credit: number
  partnerId?: string | null
}

export type CreateJournalEntryInput = {
  ref: string
  journalCode?: string
  date?: Date | string
  description: string
  sourceType: string
  sourceId?: string | null
  invoiceId?: string | null
  paymentId?: string | null
  blobId?: string | null
  lines: JournalLineInput[]
  createdById?: string | null
  /** When true, skip if ref already exists (idempotent dual-write). */
  skipIfExists?: boolean
}

function round2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100
}

async function resolveAccountId(accountLabel: string): Promise<string | null> {
  const code = extractAccountCode(accountLabel)
  if (!code) return null
  const existing = await prisma.accountCode.findUnique({ where: { code }, select: { id: true } })
  if (existing) return existing.id
  // Auto-create a stub account so journal lines never drop — CoA mirror will enrich later
  const name = accountLabel.includes(' - ') ? accountLabel.split(' - ').slice(1).join(' - ').trim() : accountLabel
  const created = await prisma.accountCode.upsert({
    where: { code },
    create: {
      id: uuidFromKey('account', code),
      code,
      name: name || code,
      accountType: 'asset',
      isActive: true,
    },
    update: {},
    select: { id: true },
  })
  return created.id
}

/**
 * Persist a balanced journal entry. Idempotent on `ref`.
 * Does NOT touch app_state — dual-write callers keep writing blobs separately.
 */
export async function createJournalEntry(params: CreateJournalEntryInput) {
  const totalDebit = round2(params.lines.reduce((s, l) => s + Number(l.debit || 0), 0))
  const totalCredit = round2(params.lines.reduce((s, l) => s + Number(l.credit || 0), 0))
  if (Math.abs(totalDebit - totalCredit) > 0.02) {
    throw new Error(`Unbalanced journal ${params.ref}: debit=${totalDebit} credit=${totalCredit}`)
  }
  if (params.lines.length === 0) {
    throw new Error(`Journal ${params.ref} has no lines`)
  }

  const existing = await prisma.journalEntry.findUnique({ where: { ref: params.ref }, select: { id: true, ref: true } })
  if (existing) {
    if (params.skipIfExists !== false) return existing
    throw new Error(`Journal ref already exists: ${params.ref}`)
  }

  let journalId: string | null = null
  if (params.journalCode) {
    const journal = await prisma.journal.findUnique({ where: { code: params.journalCode }, select: { id: true } })
    journalId = journal?.id ?? null
  }

  const entryDate = params.date
    ? (params.date instanceof Date ? params.date : new Date(String(params.date).includes('T') ? String(params.date) : `${params.date}T00:00:00Z`))
    : new Date()

  const lineCreates = []
  for (let i = 0; i < params.lines.length; i++) {
    const line = params.lines[i]
    const accountId = await resolveAccountId(line.accountLabel)
    lineCreates.push({
      accountId,
      accountLabel: String(line.accountLabel).slice(0, 200),
      label: line.label ? String(line.label).slice(0, 300) : null,
      debit: round2(line.debit),
      credit: round2(line.credit),
      partnerId: line.partnerId || null,
      sortOrder: i,
    })
  }

  return prisma.journalEntry.create({
    data: {
      id: uuidFromKey('journal', params.ref),
      ref: params.ref,
      journalId,
      entryDate,
      description: params.description,
      sourceType: params.sourceType,
      sourceId: params.sourceId ?? null,
      invoiceId: params.invoiceId ?? null,
      paymentId: params.paymentId ?? null,
      blobId: params.blobId ?? null,
      isPosted: true,
      postedAt: new Date(),
      postedById: params.createdById ?? null,
      createdById: params.createdById ?? null,
      totalDebit,
      totalCredit,
      lines: { create: lineCreates },
    },
    include: { lines: true },
  })
}

/** Map store JournalEntry shape → Prisma create. */
export async function persistStoreJournalEntry(entry: {
  id?: string
  ref: string
  date?: string
  source?: string
  description?: string
  invoiceId?: string
  paymentId?: string
  lines: Array<{ account: string; description?: string; debit: number; credit: number }>
  totalDebit?: number
  totalCredit?: number
}, opts?: { createdById?: string; journalCode?: string }) {
  const source = String(entry.source ?? 'manual')
  const journalCode = opts?.journalCode
    ?? (source === 'invoice' || source === 'payment' ? 'SAL'
      : source === 'bill' || source === 'purchase_payment' || source === 'purchase' ? 'PUR'
      : source === 'payroll' ? 'PAY'
      : source === 'pos' ? 'CSH'
      : 'GEN')

  return createJournalEntry({
    ref: entry.ref,
    journalCode,
    date: entry.date,
    description: entry.description || entry.ref,
    sourceType: source,
    sourceId: entry.invoiceId || entry.paymentId || entry.id || null,
    invoiceId: entry.invoiceId || null,
    paymentId: entry.paymentId || null,
    blobId: entry.id || null,
    createdById: opts?.createdById,
    skipIfExists: true,
    lines: entry.lines.map(l => ({
      accountLabel: l.account,
      label: l.description,
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
    })),
  })
}

export async function reverseJournalEntry(ref: string, userId?: string) {
  const original = await prisma.journalEntry.findUniqueOrThrow({
    where: { ref },
    include: { lines: true },
  })
  if (original.isReversed) return original
  const revRef = `REV/${original.ref}`
  const reversal = await createJournalEntry({
    ref: revRef,
    journalCode: undefined,
    description: `Reversal of ${original.ref}`,
    sourceType: original.sourceType || 'manual',
    sourceId: original.sourceId,
    invoiceId: original.invoiceId,
    paymentId: original.paymentId,
    createdById: userId,
    skipIfExists: true,
    lines: original.lines.map(l => ({
      accountLabel: l.accountLabel,
      label: `Reversal: ${l.label ?? ''}`,
      debit: Number(l.credit),
      credit: Number(l.debit),
    })),
  })
  await prisma.journalEntry.update({
    where: { id: original.id },
    data: { isReversed: true },
  })
  await prisma.journalEntry.update({
    where: { id: reversal.id },
    data: { reversalOfId: original.id },
  })
  return reversal
}
