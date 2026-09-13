import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { createJournalEntry } from '@/lib/accounting/journal-service'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const manualJournalSchema = z.object({
  ref: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  date: z.string().trim().max(40).optional(),
  journalCode: z.string().trim().max(20).optional(),
  lines: z.array(z.object({
    account: z.string().trim().max(200).optional(),
    accountLabel: z.string().trim().max(200).optional(),
    description: z.string().trim().max(300).optional(),
    label: z.string().trim().max(300).optional(),
    debit: z.coerce.number().finite().nonnegative().max(9_999_999_999.99).default(0),
    credit: z.coerce.number().finite().nonnegative().max(9_999_999_999.99).default(0),
    analyticAccountId: z.string().uuid().nullable().optional(),
  }).strict()).min(2).max(500),
}).strict()

/** Read-only Prisma journals (KES). Never mutates app_state. */
export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const source = searchParams.get('source')
    const q = (searchParams.get('q') || '').trim().toLowerCase()
    const take = Math.min(500, Math.max(1, Number(searchParams.get('limit') || 200)))

    const where: any = { isPosted: true, isReversed: false }
    if (dateFrom || dateTo) {
      where.entryDate = {}
      if (dateFrom) where.entryDate.gte = new Date(`${dateFrom}T00:00:00Z`)
      if (dateTo) where.entryDate.lte = new Date(`${dateTo}T23:59:59Z`)
    }
    if (source && source !== 'all') where.sourceType = source

    const rows = await prisma.journalEntry.findMany({
      where,
      include: { lines: { orderBy: { sortOrder: 'asc' } }, journal: true },
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
      take,
    })

    const mapped = rows
      .filter(e => !q || e.ref.toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q))
      .map(e => ({
        id: e.id,
        ref: e.ref,
        date: e.entryDate.toISOString().slice(0, 10),
        source: e.sourceType || e.journal?.journalType || 'general',
        description: e.description || '',
        status: e.isPosted ? 'posted' : 'draft',
        totalDebit: Number(e.totalDebit),
        totalCredit: Number(e.totalCredit),
        invoiceId: e.invoiceId || undefined,
        paymentId: e.paymentId || undefined,
        sourceId: e.sourceId || undefined,
        payrollRunId: e.sourceType === 'payroll_payment' ? (e.sourceId || undefined) : undefined,
        bankAccountId: e.sourceType === 'payroll_payment' && e.blobId?.startsWith('bank:')
          ? e.blobId.slice('bank:'.length)
          : undefined,
        lines: e.lines.map(l => ({
          id: l.id,
          account: l.accountLabel,
          description: l.label || '',
          debit: Number(l.debit),
          credit: Number(l.credit),
        })),
      }))

    return NextResponse.json({
      currency: 'KES',
      count: mapped.length,
      journals: mapped,
    })
  })
}

/**
 * POST /api/accounting/journals — create a posted journal entry.
 * Enforces fiscal lock (FIN-004) before persisting.
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const parsed = manualJournalSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid manual journal', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 422 },
      )
    }
    const body = parsed.data
    const ref = body.ref
    const description = body.description
    const date = body.date || new Date().toISOString().slice(0, 10)
    const lines = body.lines

    const parsedDate = new Date(String(date).includes('T') ? String(date) : `${date}T00:00:00Z`)
    if (Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: 'Invalid journal date' }, { status: 422 })
    }

    const lock = await checkFiscalLock(date)
    if (!lock.ok) {
      return NextResponse.json({ error: lock.error }, { status: lock.status })
    }

    const entry = await createJournalEntry({
      ref,
      journalCode: body.journalCode || undefined,
      date,
      description,
      // Manual API entries can never impersonate system-generated provenance.
      sourceType: 'manual',
      sourceId: null,
      createdById: actor.id,
      skipIfExists: false,
      lines: lines.map(l => ({
        accountLabel: String(l.account || l.accountLabel || ''),
        label: l.description || l.label || undefined,
        debit: l.debit,
        credit: l.credit,
        analyticAccountId: l.analyticAccountId || null,
      })),
    })

    return NextResponse.json({ journal: entry }, { status: 201 })
  })
}
