import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { runIntegritySuite } from '@/lib/accounting/integrity-suite'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

const GATE_CONTROL_TYPES = [
  'tb_balanced',
  'ar_vs_gl',
  'ap_vs_gl',
  'inventory_vs_gl',
  'vat_vs_tax_txns',
  'deposits_vs_gl',
  'credits_vs_gl',
  'grni_vs_gl',
  'unposted_journals',
  'unbalanced_journals',
  'payroll_liabilities',
  'outstanding_receipts',
  'outstanding_payments',
  'journal_parity_posted',
  'fiscal_period',
] as const

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const periodEnd = searchParams.get('periodEnd')
    const rows = await prisma.financialReconciliation.findMany({
      where: periodEnd ? { periodEnd: new Date(`${periodEnd}T00:00:00Z`) } : undefined,
      orderBy: { periodEnd: 'desc' },
      take: 100,
    })
    return NextResponse.json({ reconciliations: rows })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const body = await request.json().catch(() => ({}))
    const periodEnd = String(body.periodEnd || '').trim()
    if (!periodEnd) return NextResponse.json({ error: 'periodEnd (YYYY-MM-DD) is required' }, { status: 400 })
    const force = body.force === true && actor.role === 'director'

    const integrity = await runIntegritySuite(periodEnd)
    if (!integrity.allPassed && !force) {
      return NextResponse.json(
        { error: 'Month-end certification blocked: integrity gates failed', integrity },
        { status: 409 },
      )
    }

    const endDate = new Date(`${periodEnd}T00:00:00Z`)
    const result = await prisma.$transaction(async tx => {
      const saved = []
      for (const g of integrity.gates) {
        const controlType = GATE_CONTROL_TYPES.includes(g.id as typeof GATE_CONTROL_TYPES[number])
          ? g.id
          : g.id.slice(0, 50)
        const row = await tx.financialReconciliation.upsert({
          where: { controlType_periodEnd: { controlType, periodEnd: endDate } },
          create: {
            controlType,
            periodEnd: endDate,
            populationCount: g.populationCount,
            ledgerAmount: g.ledgerAmount,
            subledgerAmount: g.subledgerAmount,
            difference: g.difference,
            status: g.passed ? 'signed_off' : 'failed',
            preparedById: actor.id,
            preparedAt: new Date(),
            reviewedById: actor.id,
            reviewedAt: new Date(),
            notes: g.detail || null,
            evidence: { gate: g } as any,
          },
          update: {
            populationCount: g.populationCount,
            ledgerAmount: g.ledgerAmount,
            subledgerAmount: g.subledgerAmount,
            difference: g.difference,
            status: g.passed ? 'signed_off' : 'failed',
            reviewedById: actor.id,
            reviewedAt: new Date(),
            notes: g.detail || null,
            evidence: { gate: g } as any,
          },
        })
        saved.push(row)
      }

      await tx.financialReconciliation.upsert({
        where: { controlType_periodEnd: { controlType: 'month_end_certification', periodEnd: endDate } },
        create: {
          controlType: 'month_end_certification',
          periodEnd: endDate,
          populationCount: integrity.gates.length,
          ledgerAmount: integrity.passedCount,
          subledgerAmount: integrity.gates.length,
          difference: integrity.failedCount,
          status: integrity.allPassed ? 'certified' : 'certified_with_exceptions',
          preparedById: actor.id,
          preparedAt: new Date(),
          reviewedById: actor.id,
          reviewedAt: new Date(),
          notes: force && !integrity.allPassed ? 'Director force-certified with exceptions' : null,
        },
        update: {
          populationCount: integrity.gates.length,
          ledgerAmount: integrity.passedCount,
          subledgerAmount: integrity.gates.length,
          difference: integrity.failedCount,
          status: integrity.allPassed ? 'certified' : 'certified_with_exceptions',
          reviewedById: actor.id,
          reviewedAt: new Date(),
        },
      })

      await writeFinancialAuditInTx(tx, {
        userId: actor.id,
        action: 'month_end_certify',
        entityType: 'financial_reconciliation',
        newValues: { periodEnd, allPassed: integrity.allPassed, force },
      })

      return saved
    }, { isolationLevel: 'Serializable' })

    return NextResponse.json({ ok: true, integrity, reconciliations: result })
  })
}
