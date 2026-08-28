import 'server-only'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { extractAccountCode, uuidFromKey } from '@/lib/accounting/ids'
import { fiscalLockConflictMessage, isDocumentDateFiscalLocked } from '@/lib/finance-controls'

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
  skipIfExists?: boolean
}

type AccountingDb = typeof prisma | Prisma.TransactionClient

function round2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100
}

async function getFiscalLockDateFrom(db: AccountingDb): Promise<Date | null> {
  const lock = await db.fiscalLock.findFirst({ orderBy: { lockDate: 'desc' } })
  return lock?.lockDate ?? null
}

export async function getFiscalLockDate(): Promise<Date | null> {
  return getFiscalLockDateFrom(prisma)
}

async function assertFiscalPeriodOpenWith(db: AccountingDb, date: Date | string): Promise<void> {
  const lockDate = await getFiscalLockDateFrom(db)
  if (lockDate && isDocumentDateFiscalLocked(date, lockDate)) {
    const err = new Error(fiscalLockConflictMessage(lockDate))
    ;(err as Error & { status?: number }).status = 409
    throw err
  }

  const when = date instanceof Date
    ? date
    : new Date(String(date).includes('T') ? String(date) : `${date}T00:00:00Z`)
  const periodDelegate = (db as { fiscalPeriod?: { findFirst: typeof prisma.fiscalPeriod.findFirst } }).fiscalPeriod
  if (periodDelegate?.findFirst) {
    const period = await periodDelegate.findFirst({
      where: { dateFrom: { lte: when }, dateTo: { gte: when } },
      select: { id: true, name: true, state: true },
    })
    if (period && period.state !== 'open') {
      const err = new Error(`Fiscal period ${period.name} is ${period.state} and cannot accept postings`)
      ;(err as Error & { status?: number }).status = 409
      throw err
    }
  }
}

export async function assertFiscalPeriodOpen(date: Date | string): Promise<void> {
  return assertFiscalPeriodOpenWith(prisma, date)
}

function postingError(message: string, status = 409): Error {
  const err = new Error(message)
  ;(err as Error & { status?: number }).status = status
  return err
}

async function resolveAccountId(db: AccountingDb, accountLabel: string): Promise<string> {
  const code = extractAccountCode(accountLabel)
  if (!code) throw postingError(`Journal account must start with a valid account code: ${accountLabel}`)
  const account = await db.accountCode.findUnique({
    where: { code },
    select: { id: true, isActive: true },
  })
  if (!account) {
    throw postingError(`Unknown account ${code}. Create and approve the account in the Chart of Accounts before posting.`)
  }
  if (!account.isActive) {
    throw postingError(`Inactive account ${code} cannot receive postings.`)
  }
  return account.id
}

function validateJournalLines(ref: string, lines: JournalLineInput[]) {
  if (lines.length < 2) throw postingError(`Journal ${ref} must contain at least two lines`)
  for (const [index, line] of lines.entries()) {
    const debit = round2(line.debit)
    const credit = round2(line.credit)
    if (debit < 0 || credit < 0) throw postingError(`Journal ${ref} line ${index + 1} contains a negative amount`)
    if (debit > 0 && credit > 0) throw postingError(`Journal ${ref} line ${index + 1} cannot contain both debit and credit`)
    if (debit === 0 && credit === 0) throw postingError(`Journal ${ref} line ${index + 1} has no monetary value`)
  }
}

async function createJournalEntryWith(db: AccountingDb, params: CreateJournalEntryInput) {
  validateJournalLines(params.ref, params.lines)
  const totalDebit = round2(params.lines.reduce((s, l) => s + Number(l.debit || 0), 0))
  const totalCredit = round2(params.lines.reduce((s, l) => s + Number(l.credit || 0), 0))
  if (totalDebit <= 0 || totalCredit <= 0) throw postingError(`Zero-value journal is not allowed: ${params.ref}`)
  if (Math.abs(totalDebit - totalCredit) > 0.009) {
    throw postingError(`Unbalanced journal ${params.ref}: debit=${totalDebit} credit=${totalCredit}`)
  }

  const existing = await db.journalEntry.findUnique({ where: { ref: params.ref }, select: { id: true, ref: true } })
  if (existing) {
    if (params.skipIfExists !== false) return existing
    throw postingError(`Journal ref already exists: ${params.ref}`)
  }

  let journalId: string | null = null
  if (params.journalCode) {
    const journal = await db.journal.findUnique({ where: { code: params.journalCode }, select: { id: true } })
    if (!journal) throw postingError(`Unknown journal code: ${params.journalCode}`)
    journalId = journal.id
  }

  const entryDate = params.date
    ? (params.date instanceof Date ? params.date : new Date(String(params.date).includes('T') ? String(params.date) : `${params.date}T00:00:00Z`))
    : new Date()
  await assertFiscalPeriodOpenWith(db, entryDate)

  const lineCreates = []
  for (let i = 0; i < params.lines.length; i++) {
    const line = params.lines[i]
    const accountId = await resolveAccountId(db, line.accountLabel)
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

  try {
    return await db.journalEntry.create({
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
  } catch (err) {
    const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code) : ''
    if (code === 'P2002') {
      if (params.skipIfExists !== false) {
        const raced = await db.journalEntry.findUnique({ where: { ref: params.ref }, select: { id: true, ref: true } })
        if (raced) return raced
      }
      throw postingError(`Journal ref already exists: ${params.ref}`)
    }
    throw err
  }
}

export async function createJournalEntryInTx(tx: Prisma.TransactionClient, params: CreateJournalEntryInput) {
  return createJournalEntryWith(tx, params)
}

export async function createJournalEntry(params: CreateJournalEntryInput) {
  return createJournalEntryWith(prisma, params)
}

export async function persistStoreJournalEntryInTx(
  tx: Prisma.TransactionClient,
  entry: {
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
  },
  opts?: { createdById?: string; journalCode?: string },
) {
  const source = String(entry.source ?? 'manual')
  const journalCode = opts?.journalCode
    ?? (source === 'invoice' || source === 'payment' ? 'SAL'
      : source === 'bill' || source === 'purchase_payment' || source === 'purchase' ? 'PUR'
      : source === 'payroll' ? 'PAY'
      : source === 'pos' ? 'CSH'
      : 'GEN')

  return createJournalEntryInTx(tx, {
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
  return persistStoreJournalEntryInTx(prisma as unknown as Prisma.TransactionClient, entry, opts)
}

export async function reverseJournalEntry(ref: string, userId?: string) {
  const original = await prisma.journalEntry.findUniqueOrThrow({ where: { ref }, include: { lines: true } })
  const prior = await prisma.journalEntry.findFirst({ where: { reversalOfId: original.id } })
  if (prior) return prior

  return prisma.$transaction(async tx => {
    const again = await tx.journalEntry.findFirst({ where: { reversalOfId: original.id } })
    if (again) return again
    const revRef = `REV/${original.ref}`.slice(0, 80)
    const reversal = await createJournalEntryInTx(tx, {
      ref: revRef,
      date: new Date(),
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
    await tx.journalEntry.update({ where: { id: original.id }, data: { isReversed: true } })
    await tx.journalEntry.update({ where: { id: reversal.id }, data: { reversalOfId: original.id } })
    return reversal
  }, { isolationLevel: 'Serializable' })
}
