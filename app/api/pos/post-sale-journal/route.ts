import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import prisma from '@/lib/prisma'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { postPosSale } from '@/lib/accounting/posting-service'
import { roundMoney } from '@/lib/accounting/money'

export const dynamic = 'force-dynamic'

const POS_ROLES = ['director', 'finance_officer', 'admin_officer', 'sales_rep', 'kilimall_officer']
const FINANCE_ROLES = new Set(['director', 'finance_officer'])

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

    // Till roles may only post today's sale (a day either side for midnight
    // and timezone edges); backdated or future POS journals are a finance job.
    if (!FINANCE_ROLES.has(String(actor.role))) {
      const days = Math.abs(parsedDate.getTime() - Date.now()) / 86_400_000
      if (days > 1.5) {
        return NextResponse.json({ error: 'POS journals can only be posted for today' }, { status: 422 })
      }
    }

    const revenueLines = Array.isArray(body.revenueLines)
      ? body.revenueLines
          .map((r: { account?: string; amount?: number }) => ({
            account: String(r?.account || '').trim(),
            amount: roundMoney(r?.amount),
          }))
          .filter((r: { account: string; amount: number }) => r.account && r.amount > 0)
      : undefined

    // The request used to choose any account and any split, so a till user
    // could post e.g. Dr Sales Discounts / Cr Cash and write off till cash.
    // A POS sale journal is now held to the shape of a sale: revenue lines
    // credit active revenue accounts only and add up to the subtotal, and
    // loyalty / client credit cannot exceed the sale itself.
    const pointsRedeemed = roundMoney(body.pointsRedeemed)
    const customerCreditAmount = roundMoney(body.customerCreditAmount)
    if (tax < 0 || pointsRedeemed < 0 || customerCreditAmount < 0) {
      return NextResponse.json({ error: 'Amounts cannot be negative' }, { status: 422 })
    }
    if (pointsRedeemed > subtotal || customerCreditAmount > total) {
      return NextResponse.json({ error: 'Loyalty or client credit is larger than the sale' }, { status: 422 })
    }
    if (revenueLines?.length) {
      const revenueTotal = roundMoney(revenueLines.reduce((t: number, r: { amount: number }) => t + r.amount, 0))
      if (Math.abs(revenueTotal - subtotal) > 0.01) {
        return NextResponse.json({ error: 'Revenue lines must add up to the subtotal' }, { status: 422 })
      }
      const codes = [...new Set(revenueLines.map((r: { account: string }) => r.account.split(' - ')[0].trim()))] as string[]
      const accounts = await prisma.accountCode.findMany({
        where: { code: { in: codes } },
        select: { code: true, accountType: true, isActive: true },
      })
      const ok = new Set(accounts.filter(a => a.isActive && String(a.accountType).toLowerCase() === 'revenue').map(a => a.code))
      const bad = codes.filter(c => !ok.has(c))
      if (bad.length) {
        return NextResponse.json({ error: `Not a revenue account: ${bad.join(', ')}` }, { status: 422 })
      }
    }

    const journal = await prisma.$transaction(async tx => {
      const posted = await postPosSale({
        orderId,
        orderRef,
        invoiceId: body.invoiceId ? String(body.invoiceId) : undefined,
        total,
        subtotal,
        tax,
        pointsRedeemed,
        customerCreditAmount,
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
