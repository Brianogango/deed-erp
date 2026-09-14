import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { postReceiptValuationFromBlobs } from '@/lib/inventory/valuation-hooks'
import type { Receipt } from '@/lib/store'

const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']

async function mergeReceipt(params: { id: string; body: Record<string, unknown>; userId?: string }) {
  const state = await loadAppState(['deed_receipts'])
  const receipts: Receipt[] = Array.isArray(state.deed_receipts) ? state.deed_receipts as Receipt[] : []
  const idx = receipts.findIndex(r => r.id === params.id)
  if (idx === -1) return { error: 'Not found' as const, status: 404 as const }

  const previous = receipts[idx] as any
  const wasValidated = previous?.status === 'validated'
  const next = { ...previous, ...params.body, id: params.id } as Receipt
  const becomingValidated = !wasValidated && (next as any)?.status === 'validated'

  let valuation: unknown = null
  if (becomingValidated) {
    try {
      valuation = await postReceiptValuationFromBlobs({
        receiptId: params.id,
        userId: params.userId,
        receipt: next as any,
      })
    } catch (err) {
      console.error('[receipt] valuation failed — GRN stays validated:', err)
      valuation = { ok: false, reason: err instanceof Error ? err.message : 'Receipt valuation failed' }
    }
  }

  receipts[idx] = next
  await saveStoreKeys({ deed_receipts: JSON.stringify(receipts) })
  return { item: receipts[idx], valuation }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!WRITE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const result = await mergeReceipt({ id: params.id, body, userId: session.user.id })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return PATCH(request, { params })
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!WRITE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const state = await loadAppState(['deed_receipts'])
  const receipts: any[] = Array.isArray(state.deed_receipts) ? state.deed_receipts as any[] : []
  const existing = receipts.find(r => r.id === params.id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status === 'validated') {
    return NextResponse.json(
      { error: 'Validated receipts cannot be deleted. Post a formal stock and accounting reversal instead.' },
      { status: 409 },
    )
  }
  const filtered = receipts.filter(r => r.id !== params.id)
  await saveStoreKeys({ deed_receipts: JSON.stringify(filtered) })
  return NextResponse.json({ ok: true })
}
