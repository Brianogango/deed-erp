import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { withApiErrorHandling } from '@/lib/auth/api'
import { getServerSession } from '@/lib/auth/server'
import { reverseJournalEntry } from '@/lib/accounting/journal-service'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/accounting/reverse-duplicate-receipts
 *
 * Reverses named receipt journals that were posted more than once for the same
 * payment (the browser and the server both posted JRN/PAY/<invoice>/<id>).
 * Nothing is deleted: each one gets a REV/ entry through the same
 * reverseJournalEntry the app uses everywhere, dated today.
 *
 * Every item names the invoice, the first 8 characters of the journal id and
 * the amount it expects, and must resolve to exactly ONE live receipt journal
 * of that amount. A request is refused for an invoice if it would leave that
 * invoice with no live receipt journal at all. `apply: false` (the default)
 * only reports what would be reversed.
 *
 * Director session or the internal secret (same as orphaned-invoice-journals).
 */

const Schema = z.object({
  apply: z.boolean().default(false),
  items: z.array(z.object({
    invoiceNumber: z.string().regex(/^[A-Z]{2,6}[\/-][\w\/-]{1,40}$/),
    idPrefix: z.string().regex(/^[0-9a-f]{8}$/i),
    expectAmount: z.number().positive(),
  }).strict()).min(1).max(50),
}).strict()

async function authorize(request: NextRequest): Promise<{ ok: boolean; actorId: string | null }> {
  const secret = process.env.INTERNAL_API_SECRET
  if (secret && request.headers.get('x-internal-secret') === secret) return { ok: true, actorId: null }
  const session = await getServerSession()
  if (session?.user && String(session.user.role) === 'director') return { ok: true, actorId: session.user.id }
  return { ok: false, actorId: null }
}

type Row = { invoiceNumber: string; ref?: string; date?: string; amount?: number; outcome: string; detail?: string }

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const auth = await authorize(request)
    if (!auth.ok) return NextResponse.json({ error: 'Only a director can reverse receipt journals' }, { status: 403 })
    const parsed = Schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'items[{invoiceNumber,idPrefix,expectAmount}] required' }, { status: 422 })
    const { items, apply } = parsed.data

    // Resolve each item to exactly one live receipt journal of the expected amount.
    const resolved: Array<{ item: typeof items[number]; entry: { id: string; ref: string; entryDate: Date; totalDebit: unknown; invoiceId: string | null } }> = []
    const rows: Row[] = []
    for (const item of items) {
      const matches = await prisma.journalEntry.findMany({
        where: { ref: { startsWith: `JRN/PAY/${item.invoiceNumber}/${item.idPrefix.toLowerCase()}` }, isReversed: false },
        select: { id: true, ref: true, entryDate: true, totalDebit: true, invoiceId: true },
      })
      if (matches.length !== 1) {
        rows.push({ invoiceNumber: item.invoiceNumber, outcome: 'skipped', detail: `${matches.length} live journals match ${item.idPrefix}; need exactly 1` })
        continue
      }
      const entry = matches[0]
      const amount = Number(entry.totalDebit)
      if (Math.abs(amount - item.expectAmount) > 0.005) {
        rows.push({ invoiceNumber: item.invoiceNumber, ref: entry.ref, amount, outcome: 'skipped', detail: `amount is ${amount}, expected ${item.expectAmount}` })
        continue
      }
      resolved.push({ item, entry })
    }

    // Never strip an invoice of its last live receipt journal.
    const byInvoice = new Map<string, string[]>()
    for (const r of resolved) byInvoice.set(r.item.invoiceNumber, [...(byInvoice.get(r.item.invoiceNumber) ?? []), r.entry.ref])
    const safe: typeof resolved = []
    for (const [invoiceNumber, refs] of byInvoice) {
      const live = await prisma.journalEntry.count({
        where: { ref: { startsWith: `JRN/PAY/${invoiceNumber}/` }, isReversed: false, NOT: { ref: { in: refs } } },
      })
      if (live < 1) {
        for (const ref of refs) rows.push({ invoiceNumber, ref, outcome: 'skipped', detail: 'would leave the invoice with no live receipt journal' })
        continue
      }
      safe.push(...resolved.filter(r => r.item.invoiceNumber === invoiceNumber))
    }

    for (const { item, entry } of safe) {
      const base = { invoiceNumber: item.invoiceNumber, ref: entry.ref, date: entry.entryDate.toISOString().slice(0, 10), amount: Number(entry.totalDebit) }
      if (!apply) { rows.push({ ...base, outcome: 'would reverse' }); continue }
      try {
        const reversal = await reverseJournalEntry(entry.ref, auth.actorId ?? undefined)
        await writeFinancialAudit({
          userId: auth.actorId,
          action: 'reverse_duplicate_receipt',
          entityType: 'journal_entry',
          entityId: entry.id,
          relatedJournalId: reversal.id,
          oldValues: { ref: entry.ref, isReversed: false },
          newValues: { reversalRef: reversal.ref, reason: 'duplicate receipt journal' },
        })
        rows.push({ ...base, outcome: 'reversed', detail: reversal.ref })
      } catch (err) {
        console.error(`[reverse-duplicate-receipt] ${entry.ref} failed:`, err)
        rows.push({ ...base, outcome: 'skipped', detail: err instanceof Error ? err.message : 'reversal failed' })
      }
    }

    return NextResponse.json({
      apply,
      total: rows.filter(r => r.outcome === (apply ? 'reversed' : 'would reverse')).reduce((s, r) => s + (r.amount ?? 0), 0),
      results: rows,
    })
  })
}
