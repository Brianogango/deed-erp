import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import type { ToolDefinition } from '../types'

const inputSchema = z.object({
  query: z.string().min(1).max(100),
})

export const checkWarrantyTool: ToolDefinition = {
  name: 'check_warranty',
  description:
    'Check repair warranty status for a device by repair job number or serial number. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Repair job number or device serial number' },
    },
    required: ['query'],
  },
  requiredModule: 'after_sales',
  requiredPermission: null,
  mutates: false,
  run: async (_ctx, rawInput) => {
    const { query } = inputSchema.parse(rawInput)

    const repair = await prisma.repair.findFirst({
      where: {
        OR: [
          { jobNumber: { equals: query, mode: 'insensitive' } },
          { serialNumber: { equals: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        jobNumber: true,
        serialNumber: true,
        deviceBrand: true,
        deviceModel: true,
        status: true,
        completedDate: true,
        warrantyDays: true,
        warrantyExpiry: true,
      },
    })

    if (!repair) {
      return { found: false, message: `No repair record found matching "${query}"` }
    }

    const now = new Date()
    const isActive = repair.warrantyExpiry ? repair.warrantyExpiry > now : null

    return {
      found: true,
      warranty: {
        jobNumber: repair.jobNumber,
        device: [repair.deviceBrand, repair.deviceModel].filter(Boolean).join(' '),
        repairStatus: repair.status,
        completedDate: repair.completedDate?.toISOString().slice(0, 10) ?? null,
        warrantyDays: repair.warrantyDays,
        warrantyExpiry: repair.warrantyExpiry?.toISOString().slice(0, 10) ?? null,
        isActive,
      },
    }
  },
}
