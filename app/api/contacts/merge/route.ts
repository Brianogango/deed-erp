import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

/**
 * Merge duplicate contacts (P1-DEED-006).
 * Director-only until Decision 2 expands the role set.
 * Relinks Prisma FKs from merged → survivor, then archives the merged client.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const user = await requireRole(['director'])
    const body = await request.json() as { survivorId?: string; mergedId?: string }
    const survivorId = String(body.survivorId ?? '')
    const mergedId = String(body.mergedId ?? '')
    if (!survivorId || !mergedId || survivorId === mergedId) {
      return NextResponse.json({ error: 'survivorId and mergedId are required and must differ' }, { status: 400 })
    }

    const [survivor, merged] = await Promise.all([
      prisma.client.findUnique({ where: { id: survivorId } }),
      prisma.client.findUnique({ where: { id: mergedId } }),
    ])
    if (!survivor || !merged) {
      return NextResponse.json({ error: 'One or both contacts not found' }, { status: 404 })
    }

    const relinked: Record<string, number> = {}

    await prisma.$transaction(async (tx) => {
      const ops: Array<[string, Promise<{ count: number }>]> = [
        ['invoices', tx.invoice.updateMany({ where: { clientId: mergedId }, data: { clientId: survivorId } })],
        ['repairs', tx.repair.updateMany({ where: { clientId: mergedId }, data: { clientId: survivorId } })],
        ['saleOrders', tx.saleOrder.updateMany({ where: { clientId: mergedId }, data: { clientId: survivorId } })],
        ['quotes', tx.quote.updateMany({ where: { clientId: mergedId }, data: { clientId: survivorId } })],
        ['deliveries', tx.deliveryNote.updateMany({ where: { clientId: mergedId }, data: { clientId: survivorId } })],
        ['creditNotes', tx.creditNote.updateMany({ where: { clientId: mergedId }, data: { clientId: survivorId } })],
        ['opportunities', tx.opportunity.updateMany({ where: { clientId: mergedId }, data: { clientId: survivorId } })],
        ['contactPersons', tx.contactPerson.updateMany({ where: { clientId: mergedId }, data: { clientId: survivorId } })],
      ]
      for (const [name, promise] of ops) {
        const result = await promise
        relinked[name] = result.count
      }
      await tx.client.update({
        where: { id: mergedId },
        data: {
          isActive: false,
          notes: [merged.notes, `Merged into ${survivor.name} (${survivorId}) on ${new Date().toISOString()}`]
            .filter(Boolean)
            .join('\n'),
        },
      })
    })

    try {
      await writeFinancialAudit({
        userId: user.id,
        action: 'contact_merged',
        entityType: 'client',
        entityId: survivorId,
        oldValues: { mergedId, mergedName: merged.name },
        newValues: { survivorId, survivorName: survivor.name, relinked },
      })
    } catch {
      // best-effort
    }

    return NextResponse.json({ ok: true, survivorId, mergedId, relinked })
  })
}
