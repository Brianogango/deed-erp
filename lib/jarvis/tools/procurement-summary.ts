import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import type { ToolDefinition } from '../types'

const inputSchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
})

export const procurementSummaryTool: ToolDefinition = {
  name: 'procurement_summary',
  description:
    'List stock-tracked products at or below their reorder level, plus currently open purchase orders. Read-only — for recommending what to purchase, never decides or places an order.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max low-stock products to return (default 20, max 50)' },
    },
  },
  requiredModule: 'purchase',
  requiredPermission: null,
  mutates: false,
  run: async (_ctx, rawInput) => {
    const { limit } = inputSchema.parse(rawInput ?? {})
    const take = limit ?? 20

    const lowStock = await prisma.product.findMany({
      where: { isActive: true, trackStock: true },
      include: { stockLevel: true },
    })

    const belowReorder = lowStock
      .filter(p => p.stockLevel && p.reorderLevel != null && p.stockLevel.qtyOnHand <= p.reorderLevel)
      .slice(0, take)
      .map(p => ({
        sku: p.sku,
        name: p.name,
        qtyOnHand: p.stockLevel!.qtyOnHand,
        qtyOnOrder: p.stockLevel!.qtyOnOrder,
        reorderLevel: p.reorderLevel,
        reorderQty: p.reorderQty,
      }))

    const openPOs = await prisma.purchaseOrder.findMany({
      where: { status: { in: ['draft', 'pending_approval', 'approved', 'partially_received'] } },
      include: { supplier: { select: { name: true } } },
      orderBy: { orderDate: 'desc' },
      take: 20,
    })

    return {
      lowStockCount: belowReorder.length,
      lowStockProducts: belowReorder,
      openPurchaseOrders: openPOs.map(po => ({
        poNumber: po.poNumber,
        supplier: po.supplier.name,
        status: po.status,
        totalAmount: po.totalAmount.toString(),
        expectedDate: po.expectedDate?.toISOString().slice(0, 10) ?? null,
      })),
    }
  },
}
