import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { bootstrapChartOfAccounts } from '@/lib/accounting/coa-bootstrap'

export const dynamic = 'force-dynamic'

/** Idempotent CoA bootstrap — never deletes app_state keys. */
export async function POST() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const result = await bootstrapChartOfAccounts()
    return NextResponse.json(result)
  })
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer', 'sales_rep'])
    const { default: prisma } = await import('@/lib/prisma')
    const { loadAppState } = await import('@/lib/server-store')
    const state = await loadAppState(['deed_accounts'])
    const blob = Array.isArray(state.deed_accounts) ? state.deed_accounts.length : 0
    const relational = await prisma.accountCode.count()
    return NextResponse.json({ blobAccounts: blob, prismaAccounts: relational })
  })
}
