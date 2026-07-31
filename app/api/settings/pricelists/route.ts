import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { BUILTIN_PRICELISTS } from '@/lib/pricing/pricelist'
import { FUNCTIONAL_CURRENCY, normalizeCurrencyCode } from '@/lib/currency'

export const dynamic = 'force-dynamic'

function mapPriceList(row: {
  id: string
  code: string
  name: string
  currencyCode: string
  priceSource: string
  isActive: boolean
  sortOrder: number
}) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    currencyCode: normalizeCurrencyCode(row.currencyCode),
    priceSource: row.priceSource,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  }
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    try {
      const rows = await prisma.priceList.findMany({ orderBy: { sortOrder: 'asc' } })
      if (rows.length === 0) {
        return NextResponse.json({
          functionalCurrency: FUNCTIONAL_CURRENCY,
          priceLists: BUILTIN_PRICELISTS,
          source: 'builtin',
        })
      }
      return NextResponse.json({
        functionalCurrency: FUNCTIONAL_CURRENCY,
        priceLists: rows.map(mapPriceList),
        source: 'prisma',
      })
    } catch {
      return NextResponse.json({
        functionalCurrency: FUNCTIONAL_CURRENCY,
        priceLists: BUILTIN_PRICELISTS,
        source: 'builtin',
      })
    }
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer'])
    const body = await request.json().catch(() => ({}))
    const code = String(body.code || '').trim().toUpperCase()
    const name = String(body.name || '').trim()
    if (!code || !name) {
      return NextResponse.json({ error: 'code and name are required' }, { status: 400 })
    }
    const row = await prisma.priceList.upsert({
      where: { code },
      create: {
        code,
        name,
        currencyCode: normalizeCurrencyCode(body.currencyCode),
        priceSource: String(body.priceSource || 'fixed'),
        isActive: body.isActive !== false,
        sortOrder: Number(body.sortOrder) || 100,
        notes: body.notes ? String(body.notes) : null,
      },
      update: {
        name,
        currencyCode: normalizeCurrencyCode(body.currencyCode),
        priceSource: String(body.priceSource || 'fixed'),
        isActive: body.isActive !== false,
        sortOrder: Number(body.sortOrder) || 100,
        notes: body.notes ? String(body.notes) : null,
      },
    })
    return NextResponse.json(mapPriceList(row), { status: 201 })
  })
}
