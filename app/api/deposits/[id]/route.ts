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
    // balance, payments) and status are owned by the payments/complete/cancel
    // endpoints — accepting them here would allow arbitrary balance rewrites.
    const patch: Record<string, unknown> = {}
    if (typeof body.notes === 'string') patch.notes = body.notes
    if (typeof body.dueDate === 'string') patch.dueDate = body.dueDate
    if (typeof body.customerPhone === 'string') patch.customerPhone = body.customerPhone

    deposits[idx] = { ...deposits[idx], ...patch, id: params.id }
    await writeDeposits(deposits)
    return NextResponse.json(deposits[idx])
  })
}
