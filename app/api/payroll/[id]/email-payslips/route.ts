import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { sendEmail } from '@/lib/integrations/email'
import { loadAppState } from '@/lib/server-store'
import { loadPayslipDetail } from '@/lib/hr/payroll-reports.server'
import { buildPayslipPdf, payslipFileName } from '@/lib/hr/payslip-pdf'
import { buildPayslipEmail } from '@/lib/hr/payslip-email'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'finance_officer']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const pickEmail = (e: { workEmail: string | null; email: string | null }) =>
  [e.workEmail, e.email].map(v => String(v ?? '').trim()).find(v => EMAIL_RE.test(v)) ?? null

async function companyForPdf() {
  const state = await loadAppState(['deed_companySettings']).catch(() => ({} as Record<string, unknown>))
  const c = (state.deed_companySettings ?? {}) as Record<string, string | undefined>
  return {
    name: c.name || process.env.COMPANY_NAME || 'Deed Technologies',
    address: c.address, city: c.city, phone: c.phone, email: c.email, kraPin: c.kraPin,
  }
}

/** Who would receive a payslip, and who has no usable email. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    const run = await prisma.payrollRun.findUnique({ where: { id }, select: { status: true, runReference: true } })
    if (!run) return NextResponse.json({ error: 'Payroll run not found' }, { status: 404 })
    const slips = await prisma.payslip.findMany({
      where: { payrollRunId: id },
      include: { employee: { select: { employeeNumber: true, workEmail: true, email: true } } },
      orderBy: { employeeName: 'asc' },
    })
    return NextResponse.json({
      runStatus: run.status,
      recipients: slips.map(s => ({
        payslipId: s.id, employeeId: s.employeeId, employeeNo: s.employee.employeeNumber, name: s.employeeName ?? '',
        email: pickEmail(s.employee), net: Number(s.netPay),
      })),
    })
  })
}

/** Email each payslip (PDF attached) to the employee. Posted runs only; optional `payslipIds` to resend a few. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const body = await request.json().catch(() => ({}))
    const only = Array.isArray(body?.payslipIds) ? new Set((body.payslipIds as unknown[]).map(String)) : null

    const run = await prisma.payrollRun.findUnique({ where: { id }, select: { status: true, runReference: true, periodMonth: true, periodYear: true, periodStart: true } })
    if (!run) return NextResponse.json({ error: 'Payroll run not found' }, { status: 404 })
    if (run.status !== 'posted') return NextResponse.json({ error: 'Payslips can be emailed once the payroll is posted' }, { status: 409 })

    const slips = await prisma.payslip.findMany({
      where: { payrollRunId: id, ...(only ? { id: { in: [...only] } } : {}) },
      include: { employee: { select: { workEmail: true, email: true } } },
      orderBy: { employeeName: 'asc' },
    })
    const company = await companyForPdf()
    const month = run.periodMonth ?? String(run.periodStart.getUTCMonth() + 1)
    const year = run.periodYear ?? run.periodStart.getUTCFullYear()

    const results: Array<{ payslipId: string; name: string; email: string | null; ok: boolean; error?: string }> = []
    for (const slip of slips) {
      const name = slip.employeeName ?? ''
      const to = pickEmail(slip.employee)
      if (!to) { results.push({ payslipId: slip.id, name, email: null, ok: false, error: 'No email address on file' }); continue }
      try {
        const detail = await loadPayslipDetail(slip.id)
        if (!detail) throw new Error('Payslip not found')
        const pdf = Buffer.from(buildPayslipPdf(detail, company).output('arraybuffer'))
        const mail = buildPayslipEmail({ companyName: company.name, employeeName: name, month, year, hrEmail: process.env.HR_EMAIL || undefined })
        const sent = await sendEmail({
          to, mailbox: 'hr', subject: mail.subject, html: mail.html, text: mail.text,
          attachments: [{ filename: payslipFileName(detail), content: pdf, contentType: 'application/pdf' }],
        })
        results.push(sent.success ? { payslipId: slip.id, name, email: to, ok: true } : { payslipId: slip.id, name, email: to, ok: false, error: sent.error || 'The email could not be sent' })
      } catch (e) {
        results.push({ payslipId: slip.id, name, email: to, ok: false, error: e instanceof Error ? e.message : 'The email could not be sent' })
      }
    }

    await writeFinancialAudit({
      userId: actor.id, action: 'email_payslips', entityType: 'payroll_run', entityId: id,
      newValues: { run: run.runReference, sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length },
    })
    return NextResponse.json({ results, sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length })
  })
}
