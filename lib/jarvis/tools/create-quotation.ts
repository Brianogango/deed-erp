import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import type { ToolDefinition } from '../types'

const lineInput = z.object({
  productQuery: z.string().min(1).max(200),
  qty: z.number().int().min(1).max(1000),
})

const inputSchema = z.object({
  customerQuery: z.string().min(1).max(200),
  lines: z.array(lineInput).min(1).max(30),
  notes: z.string().max(2000).optional(),
})

async function findClient(customerQuery: string) {
  return prisma.client.findFirst({
    where: {
      OR: [
        { name: { contains: customerQuery, mode: 'insensitive' } },
        { companyName: { contains: customerQuery, mode: 'insensitive' } },
        { phone: { contains: customerQuery } },
        { clientNumber: { contains: customerQuery, mode: 'insensitive' } },
      ],
    },
  })
}

async function findProduct(productQuery: string) {
  return prisma.product.findFirst({
    where: {
      isActive: true,
      OR: [
        { name: { contains: productQuery, mode: 'insensitive' } },
        { sku: { contains: productQuery, mode: 'insensitive' } },
      ],
    },
  })
}

/**
 * Create a real quotation (sale order in quotation status) from a customer
 * name and product/quantity list. Every price comes from a live Product
 * lookup — nothing is invented. The document is created as the calling user
 * and appears in Sales immediately.
 */
export const createQuotationTool: ToolDefinition = {
  name: 'create_quotation',
  description:
    'Create a real quotation for a customer from a list of products and quantities. Looks up real catalog prices — never invents a price. Creates the quotation in Sales as the calling user. Use draft_quotation only when the user wants to review before creating.',
  inputSchema: {
    type: 'object',
    properties: {
      customerQuery: { type: 'string', description: 'Customer/company name, phone, or client number' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            productQuery: { type: 'string', description: 'Product name or SKU' },
            qty: { type: 'number', description: 'Quantity' },
          },
          required: ['productQuery', 'qty'],
        },
      },
      notes: { type: 'string', description: 'Optional notes on the quotation' },
    },
    required: ['customerQuery', 'lines'],
  },
  requiredModule: 'sales',
  requiredPermission: null,
  mutates: true,
  run: async (ctx, rawInput) => {
    const { customerQuery, lines, notes } = inputSchema.parse(rawInput)

    const client = await findClient(customerQuery)
    if (!client) {
      return {
        ok: false,
        message: `No customer found matching "${customerQuery}". Confirm the exact customer name or create the customer first.`,
      }
    }

    const items: Array<Record<string, unknown>> = []
    const unresolved: string[] = []
    for (const line of lines) {
      const product = await findProduct(line.productQuery)
      if (!product) {
        unresolved.push(line.productQuery)
        continue
      }
      const unitPrice = Number(product.sellingPrice)
      items.push({
        productId: product.id,
        description: product.name,
        qty: line.qty,
        unitPrice,
        taxRate: 0,
        discountPct: 0,
        lineTotal: Math.round(unitPrice * line.qty * 100) / 100,
      })
    }
    if (items.length === 0) {
      return {
        ok: false,
        message: `None of the products matched the catalog: ${unresolved.join(', ')}`,
      }
    }

    const subtotal = Math.round(items.reduce((s, l) => s + Number(l.lineTotal), 0) * 100) / 100
    const orderNumber = await getNextDocNumber('quotation')

    const order = await prisma.saleOrder.create({
      data: {
        orderNumber,
        clientId: client.id,
        createdById: ctx.user.id,
        status: 'quotation',
        orderDate: new Date(),
        subtotal,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: subtotal,
        amountPaid: 0,
        notes: notes ?? `Created by DIA for ${ctx.user.name ?? ctx.user.username}`,
        currencyCode: 'KES',
        items: { create: items as any },
      },
      include: { items: true },
    })

    return {
      ok: true,
      created: true,
      ref: order.orderNumber,
      id: order.id,
      customer: client.companyName ?? client.name,
      total: subtotal,
      lines: items.length,
      unresolvedProducts: unresolved.length ? unresolved : undefined,
      message: `Quotation ${order.orderNumber} created for ${client.companyName ?? client.name} — KES ${subtotal.toLocaleString('en-KE')} (${items.length} line${items.length === 1 ? '' : 's'}). Find it in Sales → Quotations.`,
    }
  },
}
