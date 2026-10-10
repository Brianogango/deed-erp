import 'server-only'
import prisma from '@/lib/prisma'
import type { Goal } from '@/lib/hr/appraisals'

export const HR_ROLES = ['director', 'admin_officer']

type Row = Awaited<ReturnType<typeof loadRows>>[number]

async function loadRows(where: object) {
  return prisma.appraisal.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    take: 1000,
    include: { employee: { select: { firstName: true, lastName: true, employeeNumber: true, jobTitle: true, managerId: true } } },
  })
}

export const toClientAppraisal = (a: Row) => ({
  id: a.id,
  cycleId: a.cycleId,
  employeeId: a.employeeId,
  employeeName: `${a.employee.firstName} ${a.employee.lastName}`.trim(),
  employeeNo: a.employee.employeeNumber,
  jobTitle: a.employee.jobTitle ?? '',
  managerEmployeeId: a.employee.managerId ?? null,
  reviewerName: a.reviewerName ?? '',
  status: a.status,
  goals: (Array.isArray(a.goals) ? a.goals : []) as unknown as Goal[],
  selfComments: a.selfComments ?? '',
  managerComments: a.managerComments ?? '',
  strengths: a.strengths ?? '',
  improvements: a.improvements ?? '',
  selfRating: a.selfRating,
  managerRating: a.managerRating,
  finalRating: a.finalRating,
  employeeAckAt: a.employeeAckAt ? a.employeeAckAt.toISOString() : null,
  updatedAt: a.updatedAt.toISOString(),
})

export const toClientCycle = (c: { id: string; name: string; periodStart: Date; periodEnd: Date; status: string }) => ({
  id: c.id, name: c.name, periodStart: c.periodStart.toISOString().slice(0, 10), periodEnd: c.periodEnd.toISOString().slice(0, 10), status: c.status,
})

/** HR sees every review; everyone else sees their own and the ones for people who report to them. */
export async function appraisalsFor(user: { employeeId?: string | null }, isHr: boolean) {
  if (isHr) return (await loadRows({})).map(toClientAppraisal)
  if (!user.employeeId) return []
  const rows = await loadRows({ OR: [{ employeeId: user.employeeId }, { employee: { managerId: user.employeeId } }] })
  return rows.map(toClientAppraisal)
}
