import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import prisma from '@/lib/prisma'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { postPosSale } from '@/lib/accounting/posting-service'
import { roundMoney } from '@/lib/accounting/money'

export const dynamic = 'force-dynamic'

const POS_ROLES = ['director', 'finance_officer', 'admin_officer', 'sales_rep', 'kilimall_officer']

/**
 * POST /api/pos/post-sale-journal
 * Dual-write POS sale journals through the posting engine.
 *
 * Body: {
 *   orderId: string,
 *   orderRef: string,
 *   invoiceId?: string,
 *   total: number,
 *   subtotal: number,
 *   tax?: number,
 *   pointsRedeemed?: number,
 *   customerCreditAmount?: number,
 *   paymentMethod?: string,
 *   bankAccountId?: string,
 *   customerName?: string,
 *   revenueLines?: Array<{ account: string; amount: number }>,
 *   date?: string
 * }
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(POS_ROLES)

    const body = await request.json().catch(() => ({}))
    const orderId = String(body.orderId || '').trim()
    const orderRef = String(body.orderRef || '').trim()
    const total = roundMoney(body.total)
    const subtotal = roundMoney(body.subtotal)
    const tax = roundMoney(body.tax)
    if (!orderId || !orderRef || total < 0 || subtotal < 0) {
      return NextResponse.json({ error: 'orderId, orderRef, total, and subtotal are required' }, { status: 400 })
    }

    const date = String(body.date || '').trim() || new Date().toISOString().slice(0, 10)
    const parsedDate = new Date(date.includes('T') ? date : `${date}T00:00:00Z`)
    if (Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: 'POS posting date is invalid' }, { status: 422 })
    }
    const lock = await checkFiscalLock(parsedDate)
    if (!lock.ok) {
      return NextResponse.json({ error: lock.error }, { status: lock.status })
    }

    const revenueLines = Array.isArray(body.revenueLines)
      ? body.revenueLines
          .map((r: { account?: string; amount?: number }) => ({
            account: String(r?.account || '').trim(),
            amount: roundMoney(r?.amount),
          }))
          .filter((r: { account: string; amount: number }) => r.account && r.amount > 0)
      : undefined

    const journal = await prisma.$transaction(async tx => {
      const posted = await postPosSale({
        orderId,
        orderRef,
        invoiceId: body.invoiceId ? String(body.invoiceId) : undefined,
        total,
        subtotal,
        tax,
        pointsRedeemed: roundMoney(body.pointsRedeemed),
        customerCreditAmount: roundMoney(body.customerCreditAmount),
        paymentMethod: body.paymentMethod ? String(body.paymentMethod) : undefined,
        bankAccountId: body.bankAccountId ? String(body.bankAccountId) : undefined,
        customerName: body.customerName ? String(body.customerName) : undefined,
        revenueLines,
        date,
        createdById: actor.id,
        tx,
      })

      await writeFinancialAuditInTx(tx, {
        userId: actor.id,
        action: 'post_pos_sale_engine',
        entityType: 'pos_order',
        entityId: orderId,
        relatedJournalId: posted && 'id' in posted ? String(posted.id) : null,
        newValues: {
          orderRef,
          total,
          journalRef: posted && 'ref' in posted ? posted.ref : null,
        },
      })
      return posted
    }, { isolationLevel: 'Serializable' })

    return NextResponse.json({ journal, skipped: false })
  })
}
