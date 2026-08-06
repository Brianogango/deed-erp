import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { parsePaginationParams, paginatedResponse } from '@/lib/api-pagination'

const FULL_VIEW_ROLES = ['director', 'finance_officer', 'admin_officer']

function mapCommissionToClient(row: any) {
  const employeeName = row.employee ? `${row.employee.firstName ?? ''} ${row.employee.lastName ?? ''}`.trim() : ''
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: employeeName || row.employeeId,
    invoiceId: row.invoiceId ?? undefined,
    invoiceRef: row.invoice?.invoiceNumber ?? undefined,
    periodMonth: row.periodMonth,
    periodYear: row.periodYear,
    saleAmount: Number(row.saleAmount),
    commissionRate: Number(row.commissionRate),
    commissionAmount: Number(row.commissionAmount),
    isPaid: row.isPaid,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
  }
}

/**
 * Read-only view over SalesCommission rows, written server-side when a
 * customer invoice created from a confirmed Sale Order is posted
 * (see lib/accounting/sales-commission.ts). Finance/Director/Admin see
 * everyone's commissions; anyone else sees only their own.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const { searchParams } = new URL(request.url)
    const { page, limit, skip } = parsePaginationParams(searchParams, { defaultSort: 'createdAt' })

    const canViewAll = FULL_VIEW_ROLES.includes(session.user.role)
    let employeeId = searchParams.get('employeeId') ?? undefined
    if (!canViewAll) {
      const self = await prisma.user.findUnique({ where: { id: session.user.id }, select: { employeeId: true } })
      employeeId = self?.employeeId ?? '__none__'
    }

    const periodYear = searchParams.get('periodYear')
    const periodMonth = searchParams.get('periodMonth')
    const isPaid = searchParams.get('isPaid')

    const where = {
      ...(employeeId ? { employeeId } : {}),
      ...(periodYear ? { periodYear: Number(periodYear) } : {}),
      ...(periodMonth ? { periodMonth: Number(periodMonth) } : {}),
      ...(isPaid !== null ? { isPaid: isPaid === 'true' } : {}),
    }

    const [total, rows] = await Promise.all([
      prisma.salesCommission.count({ where }),
      prisma.salesCommission.findMany({
        where,
        include: {
          employee: { select: { firstName: true, lastName: true } },
          invoice: { select: { invoiceNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ])

    return NextResponse.json(paginatedResponse(rows.map(mapCommissionToClient), total, page, limit))
  })
}
