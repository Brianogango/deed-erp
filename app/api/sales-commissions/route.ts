import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { parsePaginationParams, paginatedResponse } from '@/lib/api-pagination'
import {
  summarizeCommissions,
  type CommissionRowView,
} from '@/lib/accounting/sales-commission-view'

const FULL_VIEW_ROLES = ['director', 'finance_officer', 'admin_officer']

function employeeDisplayName(employee: { firstName?: string | null; lastName?: string | null } | null | undefined, fallback: string) {
  const name = `${employee?.firstName ?? ''} ${employee?.lastName ?? ''}`.trim()
  return name || fallback
}

export function mapCommissionToClient(
  row: {
    id: string
    employeeId: string
    invoiceId?: string | null
    periodMonth: number
    periodYear: number
    saleAmount: unknown
    commissionRate: unknown
    commissionAmount: unknown
    isPaid: boolean
    createdAt?: Date | string | null
    employee?: { firstName?: string | null; lastName?: string | null } | null
    invoice?: { invoiceNumber?: string | null } | null
  },
  salespersonName?: string,
): CommissionRowView {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: salespersonName || employeeDisplayName(row.employee, row.employeeId),
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
 * customer invoice is posted (see lib/accounting/sales-commission.ts).
 * Finance/Director/Admin see everyone's commissions; anyone else sees only their own.
 *
 * Query: periodYear, periodMonth, employeeId, isPaid=true|false, summary=1
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const { searchParams } = new URL(request.url)
    const { page, limit, skip } = parsePaginationParams(searchParams, { defaultSort: 'createdAt' })
    const wantSummary = searchParams.get('summary') === '1'

    const canViewAll = FULL_VIEW_ROLES.includes(session.user.role)
    let employeeId = searchParams.get('employeeId')?.trim() || undefined
    if (!canViewAll) {
      const self = await prisma.user.findUnique({ where: { id: session.user.id }, select: { employeeId: true } })
      employeeId = self?.employeeId ?? '__none__'
    }

    const periodYear = searchParams.get('periodYear')
    const periodMonth = searchParams.get('periodMonth')
    const isPaidRaw = searchParams.get('isPaid')

    const where = {
      ...(employeeId ? { employeeId } : {}),
      ...(periodYear ? { periodYear: Number(periodYear) } : {}),
      ...(periodMonth ? { periodMonth: Number(periodMonth) } : {}),
      ...(isPaidRaw === 'true' || isPaidRaw === 'false' ? { isPaid: isPaidRaw === 'true' } : {}),
    }

    const include = {
      employee: { select: { firstName: true, lastName: true } },
      invoice: { select: { invoiceNumber: true } },
    } as const

    const [total, rows] = await Promise.all([
      prisma.salesCommission.count({ where }),
      prisma.salesCommission.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        ...(wantSummary ? {} : { skip, take: limit }),
      }),
    ])

    const items = rows.map(row => mapCommissionToClient(row))
    const body = wantSummary
      ? { items, total: items.length, page: 1, limit: items.length, totalPages: 1, summary: summarizeCommissions(items) }
      : { ...paginatedResponse(items, total, page, limit) }

    return NextResponse.json(body)
  })
}
