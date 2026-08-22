import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState } from '@/lib/server-store'
import {
  attributedSales,
  dateInInclusiveRange,
  salesVisibleToViewer,
  summarizeCloserSales,
  type SaleAttributionDoc,
} from '@/lib/sales/rep-sales'

function asDocs(value: unknown): SaleAttributionDoc[] {
  return Array.isArray(value) ? value as SaleAttributionDoc[] : []
}

function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(year, month, 0).getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Posted till tickets + confirmed sale orders grouped by closer.
 * Commission is attached when a ledger row exists; zero-commission sales still appear.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const { searchParams } = new URL(request.url)
    const year = Number(searchParams.get('periodYear') || new Date().getFullYear())
    const month = Number(searchParams.get('periodMonth') || new Date().getMonth() + 1)
    const start = `${year}-${String(month).padStart(2, '0')}-01`
    const end = lastDayOfMonth(year, month)

    const state = await loadAppState(['deed_posOrders', 'deed_saleOrders'])
    const viewer = { id: session.user.id, role: session.user.role }
    const saleOrders = salesVisibleToViewer(viewer, asDocs(state.deed_saleOrders))
    const posOrders = salesVisibleToViewer(viewer, asDocs(state.deed_posOrders))

    const items = attributedSales({ saleOrders, posOrders })
      .filter(sale => dateInInclusiveRange(sale.date, start, end))
      .sort((a, b) => b.date.localeCompare(a.date) || b.ref.localeCompare(a.ref))

    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(items.map(item => item.closerId))] } },
      select: { id: true, employeeId: true, name: true },
    })
    const employeeByUser = new Map(users.map(user => [user.id, user.employeeId]))
    const employeeIds = [...new Set(users.map(user => user.employeeId).filter((id): id is string => Boolean(id)))]

    const ledger = employeeIds.length === 0 ? [] : await prisma.salesCommission.findMany({
      where: { employeeId: { in: employeeIds }, periodYear: year, periodMonth: month },
      select: { employeeId: true, commissionAmount: true },
    })
    const commissionByEmployee = new Map<string, number>()
    for (const row of ledger) {
      commissionByEmployee.set(
        row.employeeId,
        Math.round(((commissionByEmployee.get(row.employeeId) ?? 0) + Number(row.commissionAmount)) * 100) / 100,
      )
    }

    const byCloserMap = new Map<string, {
      closerId: string
      closerName: string
      employeeId?: string
      salesCount: number
      saleAmount: number
      commissionAmount: number
    }>()
    for (const sale of items) {
      const existing = byCloserMap.get(sale.closerId)
      if (existing) {
        existing.salesCount += 1
        existing.saleAmount = Math.round((existing.saleAmount + sale.total) * 100) / 100
      } else {
        const employeeId = employeeByUser.get(sale.closerId) ?? undefined
        byCloserMap.set(sale.closerId, {
          closerId: sale.closerId,
          closerName: sale.closerName,
          employeeId,
          salesCount: 1,
          saleAmount: sale.total,
          commissionAmount: employeeId ? commissionByEmployee.get(employeeId) ?? 0 : 0,
        })
      }
    }

    const byCloser = [...byCloserMap.values()].sort((a, b) => b.saleAmount - a.saleAmount)
    const totals = summarizeCloserSales(items)

    return NextResponse.json({
      periodYear: year,
      periodMonth: month,
      items,
      byCloser,
      summary: {
        salesCount: totals.salesCount,
        saleAmount: totals.saleAmount,
        commissionAmount: byCloser.reduce((sum, row) => sum + row.commissionAmount, 0),
      },
    })
  })
}
