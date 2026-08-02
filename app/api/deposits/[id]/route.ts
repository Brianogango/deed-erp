import { NextResponse } from 'next/server'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { readDeposits, writeDeposits } from '@/lib/deposit-store'

export const dynamic = 'force-dynamic'

const DEPOSIT_WRITE_ROLES = ['director', 'admin_officer', 'finance_officer']

export async function GET(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const deposits = await readDeposits()
    const deposit = deposits.find(d => d.id === params.id)
    if (!deposit) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(deposit)
  })
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requireRole(DEPOSIT_WRITE_ROLES)
    const body = await request.json()
    const deposits = await readDeposits()
    const idx = deposits.findIndex(d => d.id === params.id)
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Whitelist editable fields only. Monetary fields (totalValue, totalPaid,
    // balance, payments) stay owned by payments/complete/cancel — except
    // deposit→invoice applications which record down-payment applications.
    const patch: Record<string, unknown> = {}
    if (typeof body.notes === 'string') patch.notes = body.notes
    if (typeof body.dueDate === 'string') patch.dueDate = body.dueDate
    if (typeof body.customerPhone === 'string') patch.customerPhone = body.customerPhone
    if (typeof body.saleOrderId === 'string') patch.saleOrderId = body.saleOrderId
    if (typeof body.saleOrderRef === 'string') patch.saleOrderRef = body.saleOrderRef
    if (typeof body.appliedAmount === 'number' && Number.isFinite(body.appliedAmount) && body.appliedAmount >= 0) {
      patch.appliedAmount = body.appliedAmount
    }
    if (Array.isArray(body.applications)) patch.applications = body.applications
    if (body.status === 'completed' && body.completedAt) {
      patch.status = 'completed'
      patch.completedAt = body.completedAt
    }

    deposits[idx] = { ...deposits[idx], ...patch, id: params.id }
    await writeDeposits(deposits)
    return NextResponse.json(deposits[idx])
  })
}
