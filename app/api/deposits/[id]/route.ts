import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { readDeposits, writeDeposits } from '@/lib/deposit-store'

export const dynamic = 'force-dynamic'

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
    await getRequiredSession()
    const body = await request.json()
    const deposits = await readDeposits()
    const idx = deposits.findIndex(d => d.id === params.id)
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    deposits[idx] = { ...deposits[idx], ...body, id: params.id }
    await writeDeposits(deposits)
    return NextResponse.json(deposits[idx])
  })
}
