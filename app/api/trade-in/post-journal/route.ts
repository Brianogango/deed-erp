import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { createJournalEntry } from '@/lib/accounting/journal-service'
import {
  assertBuyBackLinesBalanced,
  buildBuyBackPayoutLines,
  buildBuyBackStockLines,
  buyBackPayoutRef,
  buyBackStockRef,
} from '@/lib/accounting/buyback-journals'
import { isAccountingPostingEngineEnabled, commitPosting } from '@/lib/accounting/posting-service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/trade-in/post-journal
 * Body: { buyBack, stage: 'payout' | 'stock' }
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const body = await request.json().catch(() => ({}))
    const stage = String(body.stage || '').toLowerCase()
    const bb = body.buyBack || body
    if (!bb?.ref || !Array.isArray(bb.lines)) {
      return NextResponse.json({ error: 'buyBack with ref and lines required' }, { status: 400 })
    }
    if (stage !== 'payout' && stage !== 'stock') {
      return NextResponse.json({ error: 'stage must be payout or stock' }, { status: 400 })
    }

    const lines = stage === 'payout'
      ? buildBuyBackPayoutLines(bb, body.paymentMethod || bb.paymentMethod)
      : buildBuyBackStockLines(bb)
    if (lines.length === 0) {
      return NextResponse.json({ error: 'Nothing to post (zero amount)' }, { status: 400 })
    }
    assertBuyBackLinesBalanced(lines, bb.ref)

    const ref = stage === 'payout' ? buyBackPayoutRef(bb.ref) : buyBackStockRef(bb.ref)
    const description = stage === 'payout'
      ? `Buy-back payout ${bb.ref} — ${bb.customerName}`
      : `Buy-back stock-in ${bb.ref}`

    if (isAccountingPostingEngineEnabled()) {
      const entry = await commitPosting({
        ref,
        source: 'buyback',
        description,
        date: body.date,
        blobId: bb.id,
        createdById: actor.id,
        lines: lines.map(l => ({
          role: l.role,
          accountLabel: l.accountLabel,
          description: l.description,
          debit: l.debit,
          credit: l.credit,
        })),
      })
      return NextResponse.json({ ok: true, journal: entry, engine: true }, { status: 201 })
    }

    const entry = await createJournalEntry({
      ref,
      journalCode: 'MISC',
      description,
      sourceType: 'buyback',
      sourceId: bb.id,
      createdById: actor.id,
      skipIfExists: true,
      lines: lines.map(l => ({
        accountLabel: l.accountLabel,
        label: l.description,
        debit: l.debit,
        credit: l.credit,
      })),
    })
    return NextResponse.json({ ok: true, journal: entry, engine: false }, { status: 201 })
  })
}
