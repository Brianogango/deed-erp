import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { CpanelError, cleanMailboxName, cpanelConfig, createMailbox, generateMailboxPassword, suggestMailboxName } from '@/lib/integrations/cpanel-email'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'admin_officer']

/** Whether cPanel is configured, and the suggested mailbox name for this employee. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    const cfg = cpanelConfig()
    const employee = await prisma.employee.findUnique({ where: { id }, select: { firstName: true, lastName: true, workEmail: true } })
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    return NextResponse.json({
      configured: !!cfg,
      domain: cfg?.domain ?? null,
      suggested: suggestMailboxName(employee.firstName, employee.lastName),
      existing: employee.workEmail ?? null,
    })
  })
}

/**
 * Creates the work mailbox in cPanel and saves it as the employee's work email.
 * The generated password is returned once in this response; it is never stored or logged.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const cfg = cpanelConfig()
    if (!cfg) return NextResponse.json({ error: 'cPanel is not configured on the server (CPANEL_HOST, CPANEL_USER, CPANEL_API_TOKEN, CPANEL_MAIL_DOMAIN).' }, { status: 503 })

    const body = await request.json().catch(() => ({}))
    const employee = await prisma.employee.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true, workEmail: true, isActive: true } })
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    if (!employee.isActive) return NextResponse.json({ error: 'The employee has exited' }, { status: 400 })
    if (employee.workEmail) return NextResponse.json({ error: `This employee already has a work email (${employee.workEmail}). Clear it on the profile first if it should be replaced.` }, { status: 409 })

    const local = cleanMailboxName(String(body?.name || suggestMailboxName(employee.firstName, employee.lastName)))
    const password = generateMailboxPassword()
    let email: string
    try {
      email = await createMailbox(cfg, local, password)
    } catch (e) {
      const status = e instanceof CpanelError ? e.status : 502
      return NextResponse.json({ error: e instanceof Error ? e.message : 'The mailbox could not be created' }, { status })
    }

    await prisma.employee.update({ where: { id }, data: { workEmail: email } })
    await writeFinancialAudit({
      userId: actor.id, action: 'create_work_mailbox', entityType: 'employee', entityId: id,
      newValues: { email },
    })
    return NextResponse.json({ email, password }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  })
}
