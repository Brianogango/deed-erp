import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import type { ToolDefinition } from '../types'

const inputSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(20).optional(),
})

export const checkInventoryTool: ToolDefinition = {
  name: 'check_inventory',
  description:
    'Look up product stock levels by product name, SKU, or barcode. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Product name, SKU, or barcode' },
      limit: { type: 'number', description: 'Max results (default 8, max 20)' },
    },
    required: ['query'],
  },
  requiredModule: 'inventory',
  requiredPermission: null,
  mutates: false,
  run: async (_ctx, rawInput) => {
    const { query, limit } = inputSchema.parse(rawInput)
    const take = limit ?? 8

    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { sku: { contains: query, mode: 'insensitive' } },
          { barcode: { contains: query, mode: 'insensitive' } },
        ],
      },
      take,
      orderBy: { name: 'asc' },
      include: { stockLevel: true, category: true, brand: true },
    })

    return {
      count: products.length,
      products: products.map(p => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category?.name ?? null,
        brand: p.brand?.name ?? null,
        sellingPrice: p.sellingPrice.toString(),
        trackStock: p.trackStock,
        qtyOnHand: p.stockLevel?.qtyOnHand ?? null,
        qtyReserved: p.stockLevel?.qtyReserved ?? null,
        qtyOnOrder: p.stockLevel?.qtyOnOrder ?? null,
        reorderLevel: p.reorderLevel,
        belowReorderLevel:
          p.trackStock && p.reorderLevel != null && p.stockLevel
            ? p.stockLevel.qtyOnHand <= p.reorderLevel
            : null,
      })),
    }
  },
}
