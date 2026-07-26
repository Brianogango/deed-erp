import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import type { ToolDefinition } from '../types'

const inputSchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
})

export const overduePaymentsTool: ToolDefinition = {
  name: 'overdue_payments',
  description:
    'List invoices that are past their due date and not fully paid, ordered by how overdue they are. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max invoices to return (default 15, max 50)' },
    },
  },
  requiredModule: 'accounting',
  requiredPermission: null,
  mutates: false,
  run: async (_ctx, rawInput) => {
    const { limit } = inputSchema.parse(rawInput ?? {})
    const take = limit ?? 15
    const today = new Date()

    // Overdue = posted document + past due + residual balance. Payment
    // progress is derived from amount_paid (checked below), never from the
    // stored status; drafts and cancelled/voided documents are never overdue.
    const invoices = await prisma.invoice.findMany({
      where: {
        dueDate: { lt: today },
        status: { notIn: ['draft', 'cancelled', 'voided'] },
      },
      orderBy: { dueDate: 'asc' },
      take,
      include: { client: { select: { name: true, companyName: true, phone: true } } },
    })

    const overdue = invoices
      .map(inv => {
        const balance = Number(inv.totalAmount) - Number(inv.amountPaid)
        if (balance <= 0) return null
        const daysOverdue = inv.dueDate
          ? Math.floor((today.getTime() - inv.dueDate.getTime()) / 86_400_000)
          : null
        return {
          invoiceNumber: inv.invoiceNumber,
          customer: inv.client.companyName ?? inv.client.name,
          customerPhone: inv.client.phone,
          dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? null,
          daysOverdue,
          totalAmount: inv.totalAmount.toString(),
          balanceDue: balance.toFixed(2),
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    const totalOutstanding = overdue.reduce((sum, i) => sum + Number(i.balanceDue), 0)

    return { count: overdue.length, totalOutstanding: totalOutstanding.toFixed(2), invoices: overdue }
  },
}
