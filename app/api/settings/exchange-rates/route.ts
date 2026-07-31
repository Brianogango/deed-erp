import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { FUNCTIONAL_CURRENCY, normalizeCurrencyCode, type CurrencyCode } from '@/lib/currency'

export const dynamic = 'force-dynamic'

function mapRate(row: {
  id: string
  fromCurrency: string
  toCurrency: string
  rate: unknown
  effectiveDate: Date
  source: string | null
  notes: string | null
}) {
  return {
    id: row.id,
    fromCurrency: normalizeCurrencyCode(row.fromCurrency),
    toCurrency: FUNCTIONAL_CURRENCY,
    rate: Number(row.rate),
    effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
    source: row.source ?? undefined,
    notes: row.notes ?? undefined,
  }
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    try {
      const rows = await prisma.exchangeRate.findMany({
        orderBy: [{ fromCurrency: 'asc' }, { effectiveDate: 'desc' }],
      })
      return NextResponse.json({
        functionalCurrency: FUNCTIONAL_CURRENCY,
        rates: rows.map(mapRate),
      })
    } catch {
      return NextResponse.json({
        functionalCurrency: FUNCTIONAL_CURRENCY,
        rates: [{
          id: 'kes-identity',
          fromCurrency: 'KES' as CurrencyCode,
          toCurrency: FUNCTIONAL_CURRENCY,
          rate: 1,
          effectiveDate: '2020-01-01',
          source: 'system',
        }],
      })
    }
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer'])
    const body = await request.json().catch(() => ({}))
    const fromCurrency = normalizeCurrencyCode(body.fromCurrency)
    const rate = Number(body.rate)
    if (!(rate > 0)) {
      return NextResponse.json({ error: 'rate must be a positive number (to KES)' }, { status: 400 })
    }
    if (fromCurrency === FUNCTIONAL_CURRENCY && rate !== 1) {
      return NextResponse.json({ error: 'KES→KES rate must be 1' }, { status: 400 })
    }
    const effectiveDate = new Date(String(body.effectiveDate || new Date().toISOString().slice(0, 10)))
    const row = await prisma.exchangeRate.create({
      data: {
        fromCurrency,
        toCurrency: FUNCTIONAL_CURRENCY,
        rate,
        effectiveDate,
        source: body.source ? String(body.source) : 'manual',
        notes: body.notes ? String(body.notes) : null,
      },
    })
    return NextResponse.json(mapRate(row), { status: 201 })
  })
}
