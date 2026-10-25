import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import type { ToolDefinition } from '../types'
import { hasFullStoreContentAccess } from '@/lib/auth/authorization'

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
      query: { type: 'string', description: 'Job number (e.g. REP-7K3M9X2Q or REP/0275), serial number, or IMEI' },
    },
    required: ['query'],
  },
  requiredModule: 'repair',
  requiredPermission: null,
  mutates: false,
  run: async (ctx, rawInput) => {
    const { query } = inputSchema.parse(rawInput)
    // Technicians see only jobs assigned to them or booked by them, as in
    // GET /api/repairs.
    const ownJobsOnly = !hasFullStoreContentAccess(ctx.user, 'deed_repairs_v2')

    const repair = await prisma.repair.findFirst({
      where: {
        OR: [
          { jobNumber: { equals: query, mode: 'insensitive' } },
          { serialNumber: { equals: query, mode: 'insensitive' } },
          { imei: { equals: query, mode: 'insensitive' } },
        ],
        ...(ownJobsOnly
          ? { AND: [{ OR: [{ assignedToId: ctx.user.id }, { payload: { path: ['createdByUserId'], equals: ctx.user.id } }] }] }
          : {}),
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
