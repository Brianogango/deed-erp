import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

// Each expense receipt is stored under its own app_state key:
//   expense_receipt_<expenseId>
// This keeps receipt blobs out of the deed_expenses array so the
// main expenses list stays small and loads instantly.
function receiptKey(expenseId: string) {
  return `expense_receipt_${expenseId}`
}

function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]*)$/)
  if (!match) return null
  try {
    return { contentType: match[1] || 'application/octet-stream', buffer: Buffer.from(match[2], 'base64') }
  } catch {
    return null
  }
}

/**
 * GET /api/expense-receipts/[expenseId]
 * Serves the receipt file directly as binary (image/pdf/etc.) so the browser
 * can display or download it without needing the base64 data URL in the component.
 * Any authenticated user may fetch receipts.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { expenseId: string } }
) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const state = await loadAppState([receiptKey(params.expenseId)])
    const dataUrl = state[receiptKey(params.expenseId)] as string | undefined
    if (!dataUrl) {
      return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
    }
    const parsed = parseDataUrl(dataUrl)
    if (!parsed) {
      return NextResponse.json({ error: 'Unsupported receipt format' }, { status: 415 })
    }
    const body = parsed.buffer.buffer.slice(parsed.buffer.byteOffset, parsed.buffer.byteOffset + parsed.buffer.byteLength)
    return new NextResponse(body as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': parsed.contentType,
        // Receipts are immutable once uploaded — cache aggressively
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Content-Length': String(parsed.buffer.length),
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load receipt' }, { status: 500 })
  }
}

/**
 * POST /api/expense-receipts/[expenseId]
 * Body: { dataUrl: string }
 * Saves the receipt for an expense. Called by the client when submitting
 * an expense with a receipt attachment.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { expenseId: string } }
) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: { dataUrl?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.dataUrl) {
    return NextResponse.json({ error: 'dataUrl is required' }, { status: 400 })
  }
  try {
    await saveStoreKeys({ [receiptKey(params.expenseId)]: body.dataUrl })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to save receipt' }, { status: 500 })
  }
}

/**
 * DELETE /api/expense-receipts/[expenseId]
 * Removes the receipt for an expense.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { expenseId: string } }
) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    await saveStoreKeys({ [receiptKey(params.expenseId)]: '' })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete receipt' }, { status: 500 })
  }
}
