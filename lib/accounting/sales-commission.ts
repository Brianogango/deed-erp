import 'server-only'
import prisma from '@/lib/prisma'

const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100

/**
 * Commission is earned when a customer invoice created from a confirmed Sale
 * Order is posted (draft -> approved). Rate resolution: product override,
 * else the product's category rate, else 0 (no commission — an unconfigured
 * product/category never silently earns commission).
 *
 * Idempotent on invoiceId: posting can only transition draft -> approved once
 * per invoice, but this guards against a retried request creating duplicates.
 */
export async function postSalesCommissionForInvoice(invoiceId: string): Promise<void> {
  const already = await prisma.salesCommission.findFirst({ where: { invoiceId }, select: { id: true } })
  if (already) return

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true },
  })
  if (!invoice || !invoice.saleOrderId) return

  const saleOrder = await prisma.saleOrder.findUnique({
    where: { id: invoice.saleOrderId },
    select: { salespersonId: true },
  })
  if (!saleOrder?.salespersonId) return

  const salesperson = await prisma.user.findUnique({
    where: { id: saleOrder.salespersonId },
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
}
