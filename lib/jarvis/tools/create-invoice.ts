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
  dueInDays: z.number().int().min(0).max(365).optional(),
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
 * Create a draft customer invoice from a customer name and product/quantity
 * list. Prices come from live Product lookups. The invoice stays DRAFT so
 * Finance reviews and posts it — posting is the accounting-controlled step.
 */
export const createInvoiceTool: ToolDefinition = {
  name: 'create_invoice',
  description:
    'Create a draft customer invoice from a customer name and a list of products/quantities. Looks up real catalog prices — never invents a price. The invoice is created as a draft for Finance to review and post. Use this when the user asks to bill or invoice a customer.',
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
      notes: { type: 'string', description: 'Optional notes on the invoice' },
      dueInDays: { type: 'number', description: 'Days until the invoice is due (default 30)' },
    },
    required: ['customerQuery', 'lines'],
  },
  requiredModule: 'accounting',
  requiredPermission: null,
  mutates: true,
  run: async (ctx, rawInput) => {
    const { customerQuery, lines, notes, dueInDays } = inputSchema.parse(rawInput)

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
      const lineSubtotal = Math.round(unitPrice * line.qty * 100) / 100
      items.push({
        productId: product.id,
        description: product.name,
        qty: line.qty,
        unitPrice,
        taxRate: 0,
        taxCategory: 'out_of_scope',
        taxCode: 'out_of_scope',
        discountPct: 0,
        taxableBase: lineSubtotal,
        lineSubtotal,
        lineTax: 0,
        lineTotal: lineSubtotal,
        taxClaimEligible: false,
      })
    }
    if (items.length === 0) {
      return {
        ok: false,
        message: `None of the products matched the catalog: ${unresolved.join(', ')}`,
      }
    }

    const subtotal = Math.round(items.reduce((s, l) => s + Number(l.lineSubtotal), 0) * 100) / 100
    const invoiceNumber = await getNextDocNumber('invoice')
    const dueDate = new Date(Date.now() + (dueInDays ?? 30) * 86400000)

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        clientId: client.id,
        status: 'draft',
        invoiceDate: new Date(),
        dueDate,
        subtotal,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: subtotal,
        amountPaid: 0,
        notes: notes ?? `Created by DIA for ${ctx.user.name ?? ctx.user.username}`,
        currencyCode: 'KES',
        documentType: 'customer_invoice',
        createdById: ctx.user.id,
        items: { create: items as any },
      },
      include: { items: true },
    })

    return {
      ok: true,
      created: true,
      ref: invoice.invoiceNumber,
      id: invoice.id,
      customer: client.companyName ?? client.name,
      total: subtotal,
      lines: items.length,
      status: 'draft',
      unresolvedProducts: unresolved.length ? unresolved : undefined,
      message: `Draft invoice ${invoice.invoiceNumber} created for ${client.companyName ?? client.name} — KES ${subtotal.toLocaleString('en-KE')} (${items.length} line${items.length === 1 ? '' : 's'}). Finance can review and post it from Accounting → Invoices.`,
    }
  },
}
