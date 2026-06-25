import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
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

// Returns a draft shaped exactly like the body POST /api/quotes already
// accepts. JARVIS never calls that endpoint itself — the chat UI shows this
// draft and the human clicks "Save as draft quote", which fires the
// existing, already-permission-checked endpoint from their own browser
// session. Every price/qty here comes from a real Product lookup; nothing
// is invented.
export const draftQuotationTool: ToolDefinition = {
  name: 'draft_quotation',
  description:
    'Build a draft quotation from a customer name and a list of products/quantities. Looks up real prices from the product catalog — never invents a price. Returns a draft for the user to review and save themselves; does not create anything in the ERP.',
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
      notes: { type: 'string', description: 'Optional notes to include on the quote' },
    },
    required: ['customerQuery', 'lines'],
  },
  requiredModule: 'sales',
  requiredPermission: null,
  mutates: false,
  run: async (_ctx, rawInput) => {
    const { customerQuery, lines, notes } = inputSchema.parse(rawInput)

    const client = await prisma.client.findFirst({
      where: {
        OR: [
          { name: { contains: customerQuery, mode: 'insensitive' } },
          { companyName: { contains: customerQuery, mode: 'insensitive' } },
          { phone: { contains: customerQuery } },
          { clientNumber: { contains: customerQuery, mode: 'insensitive' } },
        ],
      },
    })

    if (!client) {
      return {
        ok: false,
        message: `No customer found matching "${customerQuery}". Ask the user to confirm the exact customer name, or create the customer first.`,
      }
    }

    const resolvedLines: Array<Record<string, unknown>> = []
    const unresolved: string[] = []

    for (const line of lines) {
      const product = await prisma.product.findFirst({
        where: {
          isActive: true,
          OR: [
            { name: { contains: line.productQuery, mode: 'insensitive' } },
            { sku: { contains: line.productQuery, mode: 'insensitive' } },
          ],
        },
      })
      if (!product) {
        unresolved.push(line.productQuery)
        continue
      }
      const unitPrice = Number(product.sellingPrice)
      const lineSubtotal = Math.round(unitPrice * line.qty * 100) / 100
      resolvedLines.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        qty: line.qty,
        unitPrice,
        discount: 0,
        taxRate: 0,
        subtotal: lineSubtotal,
        lineTotal: lineSubtotal,
      })
    }

    if (resolvedLines.length === 0) {
      return {
        ok: false,
        message: `None of the requested products could be matched in the catalog: ${unresolved.join(', ')}`,
      }
    }

    const subtotal = resolvedLines.reduce((s, l) => s + Number(l.lineTotal), 0)

    return {
      ok: true,
      unresolvedProducts: unresolved,
      draftQuote: {
        status: 'draft',
        clientId: client.id,
        companyId: client.id,
        companyName: client.companyName ?? client.name,
        subtotal,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: subtotal,
        notes: notes ?? null,
        lines: resolvedLines,
      },
    }
  },
}
