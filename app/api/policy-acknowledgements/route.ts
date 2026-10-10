import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

const HR_ROLES = ['director', 'admin_officer']

const toClient = (a: { id: string; employeeId: string; policyId: string; policyTitle: string; policyVersion: string; acknowledgedAt: Date }) => ({
  id: a.id, employeeId: a.employeeId, policyId: a.policyId, policyTitle: a.policyTitle,
  policyVersion: a.policyVersion, acknowledgedAt: a.acknowledgedAt.toISOString(),
})

/** Your own sign-offs; HR can pass ?scope=all to see everyone's. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { user } = await getRequiredSession()
    const all = new URL(request.url).searchParams.get('scope') === 'all'
    if (all) {
      await requireRole(HR_ROLES)
      const rows = await prisma.policyAcknowledgement.findMany({ orderBy: { acknowledgedAt: 'desc' }, take: 5000 })
      return NextResponse.json(rows.map(toClient))
    }
    if (!user.employeeId) return NextResponse.json([])
    const rows = await prisma.policyAcknowledgement.findMany({ where: { employeeId: user.employeeId }, orderBy: { acknowledgedAt: 'desc' } })
    return NextResponse.json(rows.map(toClient))
  })
}

/** Record that you have read and accept a policy at its current version. Idempotent. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { user } = await getRequiredSession()
    if (!user.employeeId) return NextResponse.json({ error: 'Your login is not linked to an employee record' }, { status: 400 })
    const body = await request.json().catch(() => ({}))
    const policyId = String(body.policyId ?? '').trim().slice(0, 80)
    const policyTitle = String(body.policyTitle ?? '').trim().slice(0, 200)
    const policyVersion = String(body.policyVersion ?? '').trim().slice(0, 40)
    if (!policyId || !policyTitle || !policyVersion) return NextResponse.json({ error: 'Policy details are missing' }, { status: 400 })

    const row = await prisma.policyAcknowledgement.upsert({
      where: { employeeId_policyId_policyVersion: { employeeId: user.employeeId, policyId, policyVersion } },
      update: {},
      create: { employeeId: user.employeeId, policyId, policyTitle, policyVersion },
    })
    await writeFinancialAudit({
      userId: user.id, action: 'acknowledge_policy', entityType: 'employee', entityId: user.employeeId,
      newValues: { policyId, policyTitle, policyVersion },
    })
    return NextResponse.json(toClient(row), { status: 201 })
  })
}
