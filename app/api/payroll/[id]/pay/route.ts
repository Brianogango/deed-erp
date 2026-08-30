import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { createJournalEntryInTx } from '@/lib/accounting/journal-service'
import { cashAccountRoleForBankId, labelForRole } from '@/lib/accounting/coa-roles'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const PAY_ROLES = ['director', 'finance_officer']

const money = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(PAY_ROLES)
    const body = await request.json().catch(() => ({}))

    const bankAccountId = String(body.bankAccountId || 'ncba').trim() || 'ncba'
    const reference = String(body.reference || '').trim()
    const paymentDateRaw = String(body.paymentDate || '').trim()
    const paymentDate = paymentDateRaw
      ? new Date(paymentDateRaw.includes('T') ? paymentDateRaw : `${paymentDateRaw}T00:00:00Z`)
      : new Date()

    if (Number.isNaN(paymentDate.getTime())) {
      return NextResponse.json({ error: 'Invalid payroll payment date' }, { status: 400 })
    }

    const payroll = await prisma.payrollRun.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        runReference: true,
        status: true,
        totalNet: true,
      },
    })
    if (!payroll) return NextResponse.json({ error: 'Payroll run not found' }, { status: 404 })
    if (payroll.status !== 'posted') {
      return NextResponse.json({ error: 'Payroll must be posted before payment' }, { status: 409 })
    }

    const amount = money(payroll.totalNet)
    if (amount <= 0) {
      return NextResponse.json({ error: 'Payroll has no positive net amount to pay' }, { status: 409 })
    }

    const journalRef = `JRN/PAYROLL-PAY/${payroll.runReference}`.slice(0, 80)
    const actorId = /^[0-9a-f-]{36}$/i.test(actor.id) ? actor.id : null
    const cashRole = cashAccountRoleForBankId(bankAccountId)
    const journalCode = cashRole === 'cash_mobile' ? 'CSH' : 'BNK'

    const journal = await prisma.$transaction(async tx => {
      const posted = await createJournalEntryInTx(tx, {
        ref: journalRef,
        journalCode,
        date: paymentDate,
        description: `Payroll payment — ${payroll.runReference}`,
        sourceType: 'payroll_payment',
        sourceId: payroll.id,
        createdById: actorId,
        skipIfExists: true,
        lines: [
          {
            accountLabel: labelForRole('net_payroll_payable'),
            label: `Settle net payroll ${payroll.runReference}`,
            debit: amount,
            credit: 0,
          },
          {
            accountLabel: labelForRole(cashRole),
            label: reference
              ? `Payroll payment ${payroll.runReference} — ${reference}`
              : `Payroll payment ${payroll.runReference}`,
            debit: 0,
            credit: amount,
          },
        ],
      })

      await tx.payslip.updateMany({
        where: { payrollRunId: payroll.id },
        data: {
          paymentStatus: 'paid',
          paidAt: paymentDate,
          paymentReference: reference || null,
        },
      })

      await writeFinancialAuditInTx(tx, {
        userId: actorId,
        action: 'pay_payroll',
        entityType: 'payroll_run',
        entityId: payroll.id,
        relatedJournalId: posted.id,
        newValues: {
          amount,
          bankAccountId,
          reference: reference || null,
          paymentDate: paymentDate.toISOString(),
          journalRef,
        },
      })

      return posted
    }, { isolationLevel: 'Serializable' })

    return NextResponse.json({
      ok: true,
      journal: {
        id: journal.id,
        ref: journal.ref,
        bankAccountId,
        amount,
        paymentDate: paymentDate.toISOString(),
      },
    })
  })
}
