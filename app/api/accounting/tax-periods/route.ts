import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { createJournalEntry } from '@/lib/accounting/journal-service'
import { buildVatControlReport } from '@/lib/accounting/vat-reports.server'
import { buildVatRemittanceLines, vatRemittanceRef } from '@/lib/accounting/vat-remittance'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const rows = await prisma.taxPeriod.findMany({ orderBy: { dateFrom: 'desc' }, take: 48 })
    return NextResponse.json({
      ok: true,
      rows: rows.map(r => ({
        id: r.id,
        code: r.code,
        name: r.name,
        dateFrom: r.dateFrom.toISOString().slice(0, 10),
        dateTo: r.dateTo.toISOString().slice(0, 10),
        status: r.status,
        remittedAt: r.remittedAt,
        remittanceJournalRef: r.remittanceJournalRef,
      })),
    })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer'])
    const body = await request.json().catch(() => ({}))
    const code = String(body.code || '').trim()
    const name = String(body.name || code).trim()
    const dateFrom = String(body.dateFrom || '')
    const dateTo = String(body.dateTo || '')
    if (!code || !dateFrom || !dateTo) {
      return NextResponse.json({ error: 'code, dateFrom, dateTo required' }, { status: 400 })
    }
    const row = await prisma.taxPeriod.create({
      data: {
        code,
        name,
        dateFrom: new Date(`${dateFrom}T00:00:00Z`),
        dateTo: new Date(`${dateTo}T00:00:00Z`),
        status: 'open',
        notes: body.notes ? String(body.notes) : null,
      },
    })
    return NextResponse.json({ ok: true, row }, { status: 201 })
  })
}

/** Remit VAT for a period: POST body { action: 'remit', id, paymentMethod? } */
export async function PUT(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const body = await request.json().catch(() => ({}))
    const id = String(body.id || '')
    const action = String(body.action || 'remit')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const period = await prisma.taxPeriod.findUnique({ where: { id } })
    if (!period) return NextResponse.json({ error: 'Tax period not found' }, { status: 404 })

    if (action === 'etims_export') {
      const vat = await buildVatControlReport({
        dateFrom: period.dateFrom.toISOString().slice(0, 10),
        dateTo: period.dateTo.toISOString().slice(0, 10),
      })
      const log = await prisma.etimsSubmissionLog.create({
        data: {
          taxPeriodId: period.id,
          kind: 'vat_return_export',
          status: 'exported',
          payloadJson: vat as object,
          createdById: actor.id,
        },
      })
      return NextResponse.json({
        ok: true,
        note: 'eTIMS live KRA submission is not wired — export log only',
        logId: log.id,
        payload: vat,
      })
    }

    if (period.remittanceJournalRef) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        journalRef: period.remittanceJournalRef,
      })
    }

    const vat = await buildVatControlReport({
      dateFrom: period.dateFrom.toISOString().slice(0, 10),
      dateTo: period.dateTo.toISOString().slice(0, 10),
    })
    const { lines, vatPayable } = buildVatRemittanceLines({
      taxPeriodCode: period.code,
      outputVat: vat.outputVat,
      inputVat: vat.inputVat,
      paymentMethod: body.paymentMethod || 'bank_transfer',
    })
    if (lines.length === 0) {
      return NextResponse.json({ error: 'No VAT to remit for period' }, { status: 400 })
    }

    const ref = vatRemittanceRef(period.code)
    const entry = await createJournalEntry({
      ref,
      journalCode: 'TAX',
      description: `VAT remittance ${period.code}`,
      sourceType: 'vat_remittance',
      sourceId: period.id,
      createdById: actor.id,
      skipIfExists: true,
      lines: lines.map(l => ({
        accountLabel: l.accountLabel,
        label: l.description,
        debit: l.debit,
        credit: l.credit,
      })),
    })

    await prisma.taxPeriod.update({
      where: { id: period.id },
      data: {
        status: 'remitted',
        remittedAt: new Date(),
        remittanceJournalRef: entry.ref || ref,
      },
    })

    return NextResponse.json({ ok: true, journal: entry, vatPayable }, { status: 201 })
  })
}
