import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import type { ToolDefinition } from '../types'

const inputSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(20).optional(),
})

export const searchCustomersTool: ToolDefinition = {
  name: 'search_customers',
  description:
    'Search existing ERP customers/companies by name, phone, email, or client number. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name, phone, email, or client number to search for' },
      limit: { type: 'number', description: 'Max results to return (default 8, max 20)' },
    },
    required: ['query'],
  },
  requiredModule: 'crm',
  requiredPermission: null,
  mutates: false,
  run: async (_ctx, rawInput) => {
    const { query, limit } = inputSchema.parse(rawInput)
    const take = limit ?? 8

    const clients = await prisma.client.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { companyName: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } },
          { clientNumber: { contains: query, mode: 'insensitive' } },
        ],
      },
      take,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        clientNumber: true,
        name: true,
        companyName: true,
        email: true,
        phone: true,
        city: true,
        isCustomer: true,
        isVendor: true,
        creditLimit: true,
        creditBalance: true,
      },
    })

    return {
      count: clients.length,
      customers: clients.map(c => ({
        id: c.id,
        clientNumber: c.clientNumber,
        name: c.name,
        companyName: c.companyName,
        email: c.email,
        phone: c.phone,
        city: c.city,
        isCustomer: c.isCustomer,
        isVendor: c.isVendor,
        creditLimit: c.creditLimit.toString(),
        creditBalance: c.creditBalance.toString(),
      })),
    }
  },
}
