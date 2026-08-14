import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { getNextDocNumber, type DocKind } from '@/lib/doc-ref-counter'

const VALID_KINDS = new Set<DocKind>([
  'quote',
  'quotation',
  'invoice',
  'sale_order',
  'client',
  'purchase_order',
  'delivery_note',
  'credit_note',
  'vendor_bill',
  'receipt',
  'reconfiguration',
  'pos',
])

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const kind = body?.kind as DocKind | undefined
  if (!kind || !VALID_KINDS.has(kind)) {
    return NextResponse.json({ error: 'Invalid or missing kind' }, { status: 400 })
  }

  try {
    const number = await getNextDocNumber(kind)
    return NextResponse.json({ number })
  } catch (err) {
    console.error('[doc-numbers]', err)
    return NextResponse.json({ error: 'Failed to generate document number' }, { status: 500 })
  }
}
