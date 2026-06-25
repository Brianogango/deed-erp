import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import type { ToolDefinition } from '../types'

const inputSchema = z.object({
  query: z.string().min(1).max(100),
})

export const trackRepairTool: ToolDefinition = {
  name: 'track_repair',
  description:
    'Look up a repair job by job number, device serial number, or IMEI. Returns status, technician, parts used, and dates. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Job number (e.g. RPR-00012), serial number, or IMEI' },
    },
    required: ['query'],
  },
  requiredModule: 'repair',
  requiredPermission: null,
  mutates: false,
  run: async (_ctx, rawInput) => {
    const { query } = inputSchema.parse(rawInput)

    const repair = await prisma.repair.findFirst({
      where: {
        OR: [
          { jobNumber: { equals: query, mode: 'insensitive' } },
          { serialNumber: { equals: query, mode: 'insensitive' } },
          { imei: { equals: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { name: true, companyName: true, phone: true } },
        assignedTo: { select: { username: true } },
        parts: { include: { product: { select: { name: true } } } },
        stages: { orderBy: { changedAt: 'desc' }, take: 5 },
      },
    })

    if (!repair) {
      return { found: false, message: `No repair job found matching "${query}"` }
    }

    return {
      found: true,
      repair: {
        jobNumber: repair.jobNumber,
        status: repair.status,
        customer: repair.client.companyName ?? repair.client.name,
        device: [repair.deviceBrand, repair.deviceModel, repair.deviceType].filter(Boolean).join(' '),
        serialNumber: repair.serialNumber,
        reportedFault: repair.reportedFault,
        technician: repair.assignedTo?.username ?? 'Unassigned',
        intakeDate: repair.intakeDate.toISOString().slice(0, 10),
        promisedDate: repair.promisedDate?.toISOString().slice(0, 10) ?? null,
        completedDate: repair.completedDate?.toISOString().slice(0, 10) ?? null,
        estimatedCost: repair.estimatedCost?.toString() ?? null,
        labourCost: repair.labourCost.toString(),
        partsCost: repair.partsCost.toString(),
        partsUsed: repair.parts.map(p => ({ product: p.product.name, qty: p.qty })),
        recentStageHistory: repair.stages.map(s => ({
          status: s.status,
          notes: s.notes,
          changedAt: s.changedAt.toISOString(),
        })),
      },
    }
  },
}
