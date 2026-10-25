import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { canAccessRecord, isRoleAllowed } from '@/lib/auth/authorization'

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

// A receipt is a picture or a PDF (the upload screen says so). The type is
// read from the file's first bytes, never from the uploader: a stored
// text/html "receipt" would otherwise run as a page on this origin when
// finance opens it.
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024
function detectReceiptType(b: Buffer): string | null {
  if (b.length >= 4 && b.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif'
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|hevc|heif|mif1|msf1)$/.test(b.subarray(8, 12).toString('latin1'))) return 'image/heic'
  return null
}

const RECEIPT_ADMIN_ROLES = ['director', 'finance_officer', 'admin_officer']

/**
 * Who may read or attach the receipt of an expense: the claimant and the
 * finance roles (canAccessRecord 'expense'). For an id with no claim on the
 * server yet (the receipt is uploaded as the claim is created), anyone may
 * attach and only the finance roles may read.
 */
async function expenseAccess(user: { id: string; role: string }, expenseId: string): Promise<'ok' | 'denied' | 'unknown'> {
  const state = await loadAppState(['deed_expenses']).catch(() => ({} as Record<string, unknown>))
  const expenses = Array.isArray(state.deed_expenses) ? state.deed_expenses as Array<Record<string, unknown>> : []
  const expense = expenses.find(e => e?.id === expenseId)
  if (!expense) return 'unknown'
  return canAccessRecord(user.role, 'expense', expense, user.id) ? 'ok' : 'denied'
}

/**
 * GET /api/expense-receipts/[expenseId]
 * Serves the receipt file directly as binary (image/pdf/etc.) so the browser
 * can display or download it without needing the base64 data URL in the component.
 * The claimant and the finance roles may fetch it.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ expenseId: string }> }
) {
  const resolvedParams = await params
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const access = await expenseAccess(session.user, resolvedParams.expenseId)
  if (access === 'denied' || (access === 'unknown' && !isRoleAllowed(session.user.role, RECEIPT_ADMIN_ROLES))) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }
  try {
    const state = await loadAppState([receiptKey(resolvedParams.expenseId)])
    const dataUrl = state[receiptKey(resolvedParams.expenseId)] as string | undefined
    if (!dataUrl) {
      return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
    }
    const parsed = parseDataUrl(dataUrl)
    if (!parsed) {
      return NextResponse.json({ error: 'Unsupported receipt format' }, { status: 415 })
    }
    // Receipts stored before the upload check are served by what they
    // really are; anything that is not a picture or PDF only downloads.
    const realType = detectReceiptType(parsed.buffer)
    const body = parsed.buffer.buffer.slice(parsed.buffer.byteOffset, parsed.buffer.byteOffset + parsed.buffer.byteLength)
    return new NextResponse(body as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': realType ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        ...(realType ? {} : { 'Content-Disposition': 'attachment; filename="receipt.bin"' }),
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
  { params }: { params: Promise<{ expenseId: string }> }
) {
  const resolvedParams = await params
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
  const parsed = typeof body.dataUrl === 'string' ? parseDataUrl(body.dataUrl) : null
  const realType = parsed ? detectReceiptType(parsed.buffer) : null
  if (!parsed || !realType) {
    return NextResponse.json({ error: 'The receipt must be an image or PDF file' }, { status: 415 })
  }
  if (parsed.buffer.length > MAX_RECEIPT_BYTES) {
    return NextResponse.json({ error: 'The receipt must be under 8 MB' }, { status: 413 })
  }
  if (await expenseAccess(session.user, resolvedParams.expenseId) === 'denied') {
    return NextResponse.json({ error: 'You can only attach a receipt to your own claim' }, { status: 403 })
  }
  try {
    // A receipt is proof for an expense someone approved or paid against, so
    // once stored it is never replaced: anyone signed in used to be able to
    // overwrite any claim's receipt. Only a missing one can be attached again.
    const key = receiptKey(resolvedParams.expenseId)
    const existing = (await loadAppState([key]))[key]
    if (typeof existing === 'string' && existing) {
      return NextResponse.json({ error: 'This expense already has a receipt' }, { status: 409 })
    }
    await saveStoreKeys({ [key]: `data:${realType};base64,${parsed.buffer.toString('base64')}` })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to save receipt' }, { status: 500 })
  }
}

/**
 * DELETE /api/expense-receipts/[expenseId]
 * Removes the receipt for an expense. Finance and Directors only.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ expenseId: string }> }
) {
  const resolvedParams = await params
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!['director', 'finance_officer'].includes(String(session.user.role))) {
    return NextResponse.json({ error: 'Only Finance or a Director can remove a receipt' }, { status: 403 })
  }
  try {
    await saveStoreKeys({ [receiptKey(resolvedParams.expenseId)]: '' })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete receipt' }, { status: 500 })
  }
}
