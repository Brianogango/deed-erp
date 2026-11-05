import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import type { ToolDefinition } from '../types'

const inputSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(20).optional(),
})

/** Vendors for purchasing staff, who may not have the CRM customer search. */
export const searchVendorsTool: ToolDefinition = {
  name: 'search_vendors',
  description: 'Search vendors (suppliers) by name, phone, email, KRA PIN or contact number. Read-only. Use before create_purchase_order or create_contact.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Vendor name, phone, email, KRA PIN or contact number' },
      limit: { type: 'number', description: 'Max results (default 8, max 20)' },
    },
    required: ['query'],
  },
  requiredModule: 'purchase',
  requiredPermission: null,
  mutates: false,
  run: async (_ctx, rawInput) => {
    const { query, limit } = inputSchema.parse(rawInput)
    const vendors = await prisma.client.findMany({
      where: {
        isVendor: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { companyName: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } },
          { kraPin: { equals: query, mode: 'insensitive' } },
          { clientNumber: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limit ?? 8,
      orderBy: { name: 'asc' },
      select: { id: true, clientNumber: true, name: true, companyName: true, email: true, phone: true, kraPin: true, city: true },
    })
    return { count: vendors.length, vendors }
  },
}
