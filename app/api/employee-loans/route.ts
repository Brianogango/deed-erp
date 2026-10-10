import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { createJournalEntryInTx } from '@/lib/accounting/journal-service'
import { cashAccountRoleForBankId, labelForRole } from '@/lib/accounting/coa-roles'

export const dynamic = 'force-dynamic'

const READ_ROLES = ['director', 'admin_officer', 'finance_officer']
const WRITE_ROLES = ['director', 'finance_officer']
const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100

const toClient = (l: { id: string; employeeId: string; amount: unknown; monthlyDeduction: unknown; outstanding: unknown; issueDate: Date; reason: string | null; isCleared: boolean; createdAt: Date; employee?: { firstName: string; lastName: string; employeeNumber: string } | null }) => ({
  id: l.id,
  employeeId: l.employeeId,
  employeeName: l.employee ? `${l.employee.firstName} ${l.employee.lastName}`.trim() : '',
  employeeNo: l.employee?.employeeNumber ?? '',
  amount: Number(l.amount),
  monthlyDeduction: Number(l.monthlyDeduction),
  outstanding: Number(l.outstanding),
  issueDate: l.issueDate.toISOString().slice(0, 10),
  reason: l.reason ?? '',
  isCleared: l.isCleared,
  monthsLeft: Number(l.monthlyDeduction) > 0 ? Math.ceil(Number(l.outstanding) / Number(l.monthlyDeduction)) : 0,
})

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(READ_ROLES)
    const rows = await prisma.employeeLoan.findMany({
      orderBy: [{ isCleared: 'asc' }, { issueDate: 'desc' }],
      take: 500,
      include: { employee: { select: { firstName: true, lastName: true, employeeNumber: true } } },
    })
    return NextResponse.json(rows.map(toClient))
  })
}

/**
 * Record a staff loan. When a bank or cash account is chosen the payout is journalled
 * (Dr employee loans, Cr the account) so the later payroll recoveries have something to clear.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const body = await request.json().catch(() => ({}))
    const amount = money(body.amount)
    const monthly = money(body.monthlyDeduction)
    const issueDate = new Date(`${String(body.issueDate ?? '').slice(0, 10)}T00:00:00Z`)
    const bankAccountId = String(body.bankAccountId ?? '').trim()

    if (!(amount > 0) || amount > 10_000_000) return NextResponse.json({ error: 'Enter the loan amount' }, { status: 400 })
    if (!(monthly > 0) || monthly > amount) return NextResponse.json({ error: 'The monthly repayment must be more than zero and not more than the loan' }, { status: 400 })
    if (Number.isNaN(issueDate.getTime())) return NextResponse.json({ error: 'Enter the date the loan is given' }, { status: 400 })
    const employee = await prisma.employee.findUnique({ where: { id: String(body.employeeId ?? '') }, select: { id: true, isActive: true, basicSalary: true } })
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    if (!employee.isActive) return NextResponse.json({ error: 'That employee has exited' }, { status: 400 })

    const actorId = /^[0-9a-f-]{36}$/i.test(actor.id) ? actor.id : null
    const loan = await prisma.$transaction(async tx => {
      const row = await tx.employeeLoan.create({
        data: {
          employeeId: employee.id, amount, monthlyDeduction: monthly, outstanding: amount, issueDate,
          reason: String(body.reason ?? '').trim().slice(0, 500) || null, createdById: actorId,
        },
        include: { employee: { select: { firstName: true, lastName: true, employeeNumber: true } } },
      })
      let journalRef: string | null = null
      if (bankAccountId) {
        const cashRole = cashAccountRoleForBankId(bankAccountId)
        journalRef = `JRN/LOAN/${row.id.slice(0, 8).toUpperCase()}`
        await createJournalEntryInTx(tx, {
          ref: journalRef,
          journalCode: cashRole === 'cash_mobile' ? 'CSH' : 'BNK',
          date: issueDate,
          description: `Staff loan — ${row.employee?.firstName ?? ''} ${row.employee?.lastName ?? ''}`.trim(),
          sourceType: 'employee_loan',
          sourceId: row.id,
          blobId: `bank:${bankAccountId}`,
          createdById: actorId,
          skipIfExists: true,
          lines: [
            { accountLabel: labelForRole('employee_advances'), label: 'Staff loan issued', debit: amount, credit: 0 },
            { accountLabel: labelForRole(cashRole), label: 'Staff loan paid out', debit: 0, credit: amount },
          ],
        })
      }
      await writeFinancialAuditInTx(tx, {
        userId: actorId, action: 'create_employee_loan', entityType: 'employee', entityId: employee.id,
        newValues: { loanId: row.id, amount, monthlyDeduction: monthly, journalRef },
      })
      return row
    }, { isolationLevel: 'Serializable' })

    return NextResponse.json(toClient(loan), { status: 201 })
  })
}
