import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { createJournalEntryInTx } from '@/lib/accounting/journal-service'
import { labelForRole } from '@/lib/accounting/coa-roles'
import prisma from '@/lib/prisma'
import { notifyPayrollApproved, notifyPayrollPosted, notifyPayrollSubmitted } from '@/lib/notifications/business-events'

const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer']

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['pending_approval'],
  pending_approval: ['approved'],
  approved: ['posted'],
  posted: [],
}

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100
const advanceAmount = (v: unknown) => Array.isArray(v)
  ? money(v.reduce((sum, row: any) => sum + Number(row?.amount ?? row?.deduction ?? 0), 0))
  : 0

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isRoleAllowed(session.user.role, WRITE_ROLES)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  if (body.postedJournalId !== undefined) {
    return NextResponse.json({
      error: 'postedJournalId is system-controlled. Payroll journals are created by the posting transaction.',
    }, { status: 400 })
  }

  const existing = await prisma.payrollRun.findUnique({
    where: { id: params.id },
    include: { payslips: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const nextStatus = body.status as string | undefined
  if (nextStatus !== undefined && nextStatus !== existing.status) {
    const allowed = ALLOWED_TRANSITIONS[existing.status] ?? []
    if (!allowed.includes(nextStatus)) {
      return NextResponse.json({ error: `Illegal payroll status change: ${existing.status} → ${nextStatus}` }, { status: 409 })
    }
  }

  const actorId = /^[0-9a-f-]{36}$/i.test(session.user.id) ? session.user.id : null

  if (nextStatus === 'approved') {
    if (actorId && existing.createdById === actorId) {
      return NextResponse.json({
        error: 'Maker-checker control: the payroll creator cannot approve the same run.',
      }, { status: 409 })
    }

    const updated = await prisma.$transaction(async tx => {
      const row = await tx.payrollRun.update({
        where: { id: params.id },
        data: { status: 'approved', approvedById: actorId, approvedAt: new Date() },
      })
      await writeFinancialAuditInTx(tx, {
        userId: actorId,
        action: 'approve_payroll',
        entityType: 'payroll_run',
        entityId: params.id,
        oldValues: { status: existing.status },
        newValues: { status: 'approved' },
      })
      return row
    }, { isolationLevel: 'Serializable' })

    await notifyPayrollApproved(params.id, actorId)
    return NextResponse.json({ item: { id: updated.id, status: updated.status } })
  }

  if (nextStatus === 'posted') {
    if (!existing.approvedById || !existing.approvedAt) {
      return NextResponse.json({ error: 'Payroll must have an independent approval before posting.' }, { status: 409 })
    }
    if (actorId && (existing.createdById === actorId || existing.approvedById === actorId)) {
      return NextResponse.json({
        error: 'Maker-checker control: payroll creator, approver and poster must be different users.',
      }, { status: 409 })
    }
    if (!existing.payslips.length) {
      return NextResponse.json({ error: 'Cannot post an empty payroll run.' }, { status: 409 })
    }
    if (!existing.statutoryRuleVersionId) {
      return NextResponse.json({
        error: 'Payroll has no statutory rule version. Recalculate the run under a versioned Kenya payroll rule before posting.',
      }, { status: 409 })
    }

    const totals = existing.payslips.reduce((a, p) => {
      a.gross += Number(p.grossPay)
      a.net += Number(p.netPay)
      a.paye += Number(p.paye)
      a.nssf += Number(p.nssf)
      a.shif += Number((p as any).shif || 0)
      a.housing += Number((p as any).housingLevy || 0)
      a.pension += Number((p as any).pensionContribution || 0)
      a.employeeAdvances += Number(p.loanDeductions || 0) + advanceAmount(p.advanceDeductions)
      return a
    }, { gross: 0, net: 0, paye: 0, nssf: 0, shif: 0, housing: 0, pension: 0, employeeAdvances: 0 })

    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] = money(totals[key])
    const knownEmployeeDeductions = money(
      totals.paye + totals.nssf + totals.shif + totals.housing + totals.pension + totals.employeeAdvances,
    )
    const totalEmployeeDeductions = money(totals.gross - totals.net)
    const otherDeductions = money(totalEmployeeDeductions - knownEmployeeDeductions)
    if (otherDeductions < -0.01) {
      return NextResponse.json({
        error: 'Payroll components do not reconcile to gross less net pay. Recalculate before posting.',
        difference: otherDeductions,
      }, { status: 409 })
    }

    // Under the current rule snapshot, employer NSSF matches employee NSSF and
    // employer AHL matches employee AHL. The rule version remains the authority
    // for future rates; these values are snapshotted on this run.
    const employerNssf = totals.nssf
    const employerHousing = totals.housing
    const journalRef = `JRN/PAYROLL/${existing.runReference}`.slice(0, 80)

    const posted = await prisma.$transaction(async tx => {
      const current = await tx.payrollRun.findUniqueOrThrow({ where: { id: params.id } })
      if (current.status !== 'approved') {
        throw new Error('Payroll status changed concurrently; posting aborted.')
      }

      const lines = [
        { accountLabel: labelForRole('salary_expense'), label: `Gross payroll ${existing.runReference}`, debit: totals.gross, credit: 0 },
        ...(employerNssf > 0 ? [{ accountLabel: labelForRole('employer_nssf_expense'), label: 'Employer NSSF', debit: employerNssf, credit: 0 }] : []),
        ...(employerHousing > 0 ? [{ accountLabel: labelForRole('employer_housing_levy_expense'), label: 'Employer Affordable Housing Levy', debit: employerHousing, credit: 0 }] : []),
        { accountLabel: labelForRole('net_payroll_payable'), label: 'Net payroll payable', debit: 0, credit: totals.net },
        ...(totals.paye > 0 ? [{ accountLabel: labelForRole('paye_payable'), label: 'PAYE payable', debit: 0, credit: totals.paye }] : []),
        ...(totals.nssf + employerNssf > 0 ? [{ accountLabel: labelForRole('nssf_payable'), label: 'NSSF employee + employer', debit: 0, credit: money(totals.nssf + employerNssf) }] : []),
        ...(totals.shif > 0 ? [{ accountLabel: labelForRole('shif_payable'), label: 'SHIF payable', debit: 0, credit: totals.shif }] : []),
        ...(totals.housing + employerHousing > 0 ? [{ accountLabel: labelForRole('housing_levy_payable'), label: 'Affordable Housing Levy employee + employer', debit: 0, credit: money(totals.housing + employerHousing) }] : []),
        ...(totals.pension > 0 ? [{ accountLabel: labelForRole('pension_payable'), label: 'Pension payable', debit: 0, credit: totals.pension }] : []),
        ...(totals.employeeAdvances > 0 ? [{ accountLabel: labelForRole('employee_advances'), label: 'Salary advance/loan recovery', debit: 0, credit: totals.employeeAdvances }] : []),
        ...(otherDeductions > 0.009 ? [{ accountLabel: labelForRole('other_payroll_deductions'), label: 'Other payroll deductions', debit: 0, credit: otherDeductions }] : []),
      ]

      const journal = await createJournalEntryInTx(tx, {
        ref: journalRef,
        journalCode: 'PAY',
        date: existing.periodEnd,
        description: `Payroll ${existing.runReference}`,
        sourceType: 'payroll',
        sourceId: existing.id,
        createdById: actorId,
        skipIfExists: false,
        lines,
      })

      const row = await tx.payrollRun.update({
        where: { id: params.id },
        data: {
          status: 'posted',
          postingStatus: 'posted',
          postedJournalId: journal.id,
          postedById: actorId,
          postedAt: new Date(),
          totalGross: totals.gross,
          totalPaye: totals.paye,
          totalNssf: totals.nssf,
          totalShif: totals.shif,
          totalHousingLevy: totals.housing,
          totalEmployerContributions: money(employerNssf + employerHousing),
          totalDeductions: totalEmployeeDeductions,
          totalNet: totals.net,
        },
      })
      await tx.payslip.updateMany({
        where: { payrollRunId: params.id },
        data: { status: 'published' },
      })
      await writeFinancialAuditInTx(tx, {
        userId: actorId,
        action: 'post_payroll',
        entityType: 'payroll_run',
        entityId: params.id,
        relatedJournalId: journal.id,
        oldValues: { status: existing.status },
        newValues: {
          status: 'posted',
          journalId: journal.id,
          totalGross: totals.gross,
          totalNet: totals.net,
          statutoryRuleVersionId: existing.statutoryRuleVersionId,
        },
      })
      return row
    }, { isolationLevel: 'Serializable' })

    await notifyPayrollPosted(params.id, actorId)
    return NextResponse.json({ item: { id: posted.id, status: posted.status, postedJournalId: posted.postedJournalId } })
  }

  if (nextStatus === 'pending_approval' && existing.status === 'draft') {
    const updated = await prisma.$transaction(async tx => {
      const row = await tx.payrollRun.update({ where: { id: params.id }, data: { status: 'pending_approval' } })
      await writeFinancialAuditInTx(tx, {
        userId: actorId,
        action: 'submit_payroll',
        entityType: 'payroll_run',
        entityId: params.id,
        oldValues: { status: existing.status },
        newValues: { status: 'pending_approval' },
      })
      return row
    })
    await notifyPayrollSubmitted(params.id, actorId)
    return NextResponse.json({ item: { id: updated.id, status: updated.status } })
  }

  return NextResponse.json({ item: { id: existing.id, status: existing.status } })
}

export async function PATCH(request: NextRequest, ctx: { params: { id: string } }) {
  return PUT(request, ctx)
}
