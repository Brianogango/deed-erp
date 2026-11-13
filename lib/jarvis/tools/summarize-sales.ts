import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import type { ToolDefinition } from '../types'
import { userCan } from '@/lib/auth/can'

/** Quotes, drafts and cancelled orders are not sales. */
const NOT_SALES = ['quotation', 'quotation_sent', 'sent', 'draft', 'cancelled', 'canceled', 'cancel', 'void', 'voided', 'expired', 'rejected']

const inputSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ownOnly: z.boolean().optional(),
})

export const summarizeSalesTool: ToolDefinition = {
  name: 'summarize_sales',
  description:
    'Summarize sale orders within a date range: total value, order count, and top products. Read-only, computed from real records — never estimated.',
  inputSchema: {
    type: 'object',
    properties: {
      fromDate: { type: 'string', description: 'Start date, YYYY-MM-DD' },
      toDate: { type: 'string', description: 'End date, YYYY-MM-DD' },
    },
    required: ['fromDate', 'toDate'],
  },
  requiredModule: 'sales',
  requiredPermission: null,
  mutates: false,
  run: async (ctx, rawInput) => {
    const { fromDate, toDate } = inputSchema.parse(rawInput)

    // Confirmed sales only; sales reps see their own orders.
    const ownOnly = !userCan(ctx.user, 'sales.view_all')
    const orders = await prisma.saleOrder.findMany({
      where: {
        orderDate: { gte: new Date(fromDate), lte: new Date(`${toDate}T23:59:59`) },
        status: { notIn: NOT_SALES },
        ...(ownOnly ? { OR: [{ createdById: ctx.user.id }, { salespersonId: ctx.user.id }] } : {}),
      },
      include: { items: { include: { product: { select: { name: true } } } } },
    })

    const productTotals = new Map<string, number>()
    let totalValue = 0
    for (const order of orders) {
      totalValue += Number(order.totalAmount)
      for (const item of order.items) {
        const name = item.product?.name ?? item.description ?? 'Unknown item'
        productTotals.set(name, (productTotals.get(name) ?? 0) + Number(item.lineTotal ?? 0))
      }
    }

    const topProducts = Array.from(productTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value]) => ({ name, value: value.toFixed(2) }))

    return {
      scope: ownOnly ? 'your_orders' : 'all_confirmed_orders',
      fromDate,
      toDate,
      orderCount: orders.length,
      totalValue: totalValue.toFixed(2),
      topProducts,
    }
  },
}
