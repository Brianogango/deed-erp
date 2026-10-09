import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { sendEmail } from '@/lib/integrations/email'
import { buildWelcomeEmail } from '@/lib/hr/welcome-email'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'admin_officer']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Sends the new-hire welcome email to the employee's personal address (falling back to the work address). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const body = await request.json().catch(() => ({}))
    const note = String(body?.note ?? '').slice(0, 1500)

    const employee = await prisma.employee.findUnique({
      where: { id },
      include: { department: { select: { name: true } } },
    })
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    const to = [employee.email, employee.workEmail].map(v => String(v ?? '').trim()).find(v => EMAIL_RE.test(v))
    if (!to) return NextResponse.json({ error: 'Add a personal or work email address to the employee first' }, { status: 400 })

    const company = process.env.COMPANY_NAME || 'Deed Technologies'
    const mail = buildWelcomeEmail({
      companyName: company,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      jobTitle: employee.jobTitle ?? undefined,
      department: employee.department?.name ?? undefined,
      startDate: employee.startDate.toISOString().slice(0, 10),
      workEmail: employee.workEmail ?? undefined,
      hrEmail: process.env.HR_EMAIL || undefined,
      note,
    })

    const result = await sendEmail({ to, mailbox: 'hr', subject: mail.subject, html: mail.html, text: mail.text })
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'The email could not be sent' }, { status: 502 })
    }
    await writeFinancialAudit({
      userId: actor.id, action: 'send_welcome_email', entityType: 'employee', entityId: id,
      newValues: { to, messageId: result.messageId ?? null },
    })
    return NextResponse.json({ ok: true, to })
  })
}
