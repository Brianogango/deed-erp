import 'server-only'
import prisma from '@/lib/prisma'
import { salesCommissionAppliesToInvoice } from '@/lib/sales/commission-closer'

const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100

/**
 * Commission is earned when a customer invoice created from a confirmed Sale
 * Order is posted (draft -> approved). Rate resolution: product override,
 * else the product's category rate, else 0 (no commission — an unconfigured
 * product/category never silently earns commission).
 *
 * Idempotent on invoiceId via an atomic claim (updateMany with a `WHERE
 * commissionComputedAt IS NULL`), not a findFirst-then-create check — a
 * SalesCommission row exists per commission-earning line, so there's no
 * natural per-invoice unique constraint to race against. Two concurrent
 * calls for the same invoice: only one gets `count: 1` and proceeds: the
 * other sees `count: 0` and returns immediately, so duplicate rows can't
 * be created no matter how the caller retries.
 *
 * If anything after the claim throws, the claim is released so a retry can
 * actually compute commission instead of being permanently skipped by a
 * transient failure. The early "legitimately nothing to pay" returns below
 * (no sale order, no salesperson, no employee, no rate) are not errors —
 * those keep the claim, since a retry would reach the same conclusion.
 *
 * POS invoices have no sale order. Pass salespersonUserId (the closer chosen
 * on the till). Without a sale-order salesperson and without that override,
 * this is a silent no-op — cashier createdBy is never treated as the closer.
 */
export async function postSalesCommissionForInvoice(
  invoiceId: string,
  opts?: { salespersonUserId?: string | null },
): Promise<void> {
  const claim = await prisma.invoice.updateMany({
    where: { id: invoiceId, commissionComputedAt: null },
    data: { commissionComputedAt: new Date() },
  })
  if (claim.count === 0) return

  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true },
    })
    if (!invoice) return
    if (!salesCommissionAppliesToInvoice(invoice)) return

    let salespersonId = opts?.salespersonUserId || null
    if (invoice.saleOrderId) {
      const saleOrder = await prisma.saleOrder.findUnique({
        where: { id: invoice.saleOrderId },
        select: { salespersonId: true },
      })
      salespersonId = saleOrder?.salespersonId || salespersonId
    }
    if (!salespersonId) return

    const salesperson = await prisma.user.findUnique({
      where: { id: salespersonId },
      select: { employeeId: true },
    })
    if (!salesperson?.employeeId) return
    const employeeId = salesperson.employeeId

    const productIds = invoice.items.map(i => i.productId).filter((id): id is string => Boolean(id))
    if (productIds.length === 0) return

    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, commissionRatePercent: true, category: { select: { commissionRatePercent: true } } },
    })
    const rateByProductId = new Map(
      products.map(p => [p.id, Number(p.commissionRatePercent ?? p.category?.commissionRatePercent ?? 0)]),
    )

    const now = new Date()
    const rows = invoice.items
      .filter(item => item.productId && (rateByProductId.get(item.productId) ?? 0) > 0)
      .map(item => {
        const rate = rateByProductId.get(item.productId!) ?? 0
        const saleAmount = round2(Number(item.lineSubtotal) || 0)
        return {
          employeeId,
          invoiceId: invoice.id,
          periodMonth: now.getMonth() + 1,
          periodYear: now.getFullYear(),
          saleAmount,
          commissionRate: rate,
          commissionAmount: round2((saleAmount * rate) / 100),
          isPaid: false,
        }
      })
      .filter(row => row.commissionAmount > 0)

    if (rows.length === 0) return

    await prisma.salesCommission.createMany({ data: rows })
  } catch (err) {
    await prisma.invoice.updateMany({
      where: { id: invoiceId },
      data: { commissionComputedAt: null },
    }).catch(() => {})
    throw err
  }
}
