import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import type { ToolDefinition } from '../types'

const inputSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Optional RepairStatus filter (e.g. intake, in_repair). Omit for all. */
  status: z.string().max(40).optional(),
  limit: z.number().int().min(1).max(50).optional(),
})

/**
 * Count/list repairs booked (intake) in a date range — answers
 * "how many repairs today?" from real Prisma rows, never estimates.
 */
export const summarizeRepairsTool: ToolDefinition = {
  name: 'summarize_repairs',
  description:
    'Count and list repair jobs booked (intake date) within a date range. Use for questions like "how many repairs today/this week?". Returns totals by status plus a sample of job numbers. Read-only — never invents counts.',
  inputSchema: {
    type: 'object',
    properties: {
      fromDate: { type: 'string', description: 'Start date YYYY-MM-DD (Africa/Nairobi). For "today" use today\'s Nairobi date.' },
      toDate: { type: 'string', description: 'End date YYYY-MM-DD (Africa/Nairobi). For "today" use the same date as fromDate.' },
      status: { type: 'string', description: 'Optional status filter: intake, diagnosis, awaiting_parts, in_repair, qc, ready, verified_released, collected, cancelled, unrepairable' },
      limit: { type: 'number', description: 'Max jobs to list in the sample (default 20, max 50)' },
    },
    required: ['fromDate', 'toDate'],
  },
  requiredModule: 'repair',
  requiredPermission: null,
  mutates: false,
  run: async (ctx, rawInput) => {
    const { fromDate, toDate, status, limit } = inputSchema.parse(rawInput)
    const sampleLimit = limit ?? 20

    // Nairobi business day boundaries (Deed operates in Kenya).
    const from = new Date(`${fromDate}T00:00:00+03:00`)
    const to = new Date(`${toDate}T23:59:59.999+03:00`)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      return { ok: false, message: 'Invalid date range. Use YYYY-MM-DD and ensure fromDate ≤ toDate.' }
    }

    const isTechOnly = ctx.user.role === 'technician'
    const where = {
      intakeDate: { gte: from, lte: to },
      ...(status ? { status: status as any } : {}),
      ...(isTechOnly ? { assignedToId: ctx.user.id } : {}),
    }

    const [total, grouped, sample] = await Promise.all([
      prisma.repair.count({ where }),
      prisma.repair.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      prisma.repair.findMany({
        where,
        orderBy: { intakeDate: 'desc' },
        take: sampleLimit,
        select: {
          jobNumber: true,
          status: true,
          intakeDate: true,
          deviceBrand: true,
          deviceModel: true,
          deviceType: true,
          serialNumber: true,
          reportedFault: true,
          client: { select: { name: true, companyName: true } },
          assignedTo: { select: { username: true } },
        },
      }),
    ])

    const byStatus = Object.fromEntries(
      grouped.map(g => [g.status, g._count._all]),
    )

    return {
      ok: true,
      scope: isTechOnly ? 'assigned_to_me_only' : 'all_repairs',
      metric: 'booked_by_intake_date',
      fromDate,
      toDate,
      totalBooked: total,
      byStatus,
      listed: sample.length,
      repairs: sample.map(r => ({
        jobNumber: r.jobNumber,
        status: r.status,
        intakeDate: r.intakeDate.toISOString().slice(0, 10),
        customer: r.client.companyName ?? r.client.name,
        device: [r.deviceBrand, r.deviceModel, r.deviceType].filter(Boolean).join(' ') || null,
        serialNumber: r.serialNumber,
        fault: r.reportedFault,
        technician: r.assignedTo?.username ?? 'Unassigned',
      })),
    }
  },
}
