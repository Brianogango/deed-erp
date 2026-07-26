import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import type { ToolDefinition } from '../types'

const inputSchema = z.object({
  invoiceNumber: z.string().min(1).max(60),
})

export const explainInvoiceTool: ToolDefinition = {
  name: 'explain_invoice',
  description:
    'Look up a single invoice by its invoice number and return its line items, payments, and balance. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      invoiceNumber: { type: 'string', description: 'Invoice number, e.g. INV-2026-0042' },
    },
    required: ['invoiceNumber'],
  },
  requiredModule: 'accounting',
  requiredPermission: null,
  mutates: false,
  run: async (_ctx, rawInput) => {
    const { invoiceNumber } = inputSchema.parse(rawInput)

    const invoice = await prisma.invoice.findFirst({
      where: { invoiceNumber: { equals: invoiceNumber, mode: 'insensitive' } },
      include: {
        client: { select: { name: true, companyName: true, phone: true, email: true } },
        items: true,
        payments: { orderBy: { paidAt: 'desc' }, where: { isVoided: false } },
      },
    })

    if (!invoice) {
      return { found: false, message: `No invoice found with number ${invoiceNumber}` }
    }

    const balanceDue = Number(invoice.totalAmount) - Number(invoice.amountPaid)

    return {
      found: true,
      invoice: {
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
        dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
        customer: invoice.client.companyName ?? invoice.client.name,
        subtotal: invoice.subtotal.toString(),
        taxAmount: invoice.taxAmount.toString(),
        discountAmount: invoice.discountAmount.toString(),
        totalAmount: invoice.totalAmount.toString(),
        amountPaid: invoice.amountPaid.toString(),
        balanceDue: balanceDue.toFixed(2),
        lineItems: invoice.items.map(i => ({
          description: i.description,
          qty: i.qty,
          unitPrice: i.unitPrice.toString(),
          lineTotal: i.lineTotal.toString(),
        })),
        payments: invoice.payments.map(p => ({
          amount: p.amount.toString(),
          method: p.paymentMethod,
          date: p.paidAt.toISOString().slice(0, 10),
        })),
      },
    }
  },
}
