import { NextRequest, NextResponse } from 'next/server'
import { loadAppState } from '@/lib/server-store'
import { getServerSession } from '@/lib/auth/server'
import { portalDocumentAccessAllowed, isPortalPhoneVerificationRequired } from '@/lib/portal-verify'

export const dynamic = 'force-dynamic'

function paymentProofKey(ref: string) {
  return `repair_payment_proof_${decodeURIComponent(ref).toUpperCase().replace(/\//g, '_')}`
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
 * GET /api/portal/repair/[ref]/payment-proof
 * Serves the M-PESA payment confirmation screenshot for a repair.
 * Screenshots are stored under their own app-state key so the repairs blob
 * stays small; legacy repairs with an inline data URL are still supported.
 */
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  try {
    const ref = decodeURIComponent(params.ref)
    const key = paymentProofKey(ref)
    const state = await loadAppState([key, 'deed_repairs_v2', 'deed_systemSettings'])

    // Payment screenshots are customer PII — ref alone is not a capability.
    const repairs = (state['deed_repairs_v2'] as any[]) || []
    const repairForGate = repairs.find((r: any) => String(r.ref ?? '').toLowerCase() === ref.toLowerCase())
    const session = await getServerSession().catch(() => null)
    const allowed = await portalDocumentAccessAllowed(_req, repairForGate, {
      session,
      phoneVerificationRequired: isPortalPhoneVerificationRequired(state['deed_systemSettings'] as any),
    })
    if (!allowed) {
      return NextResponse.json({ error: 'Enter the registered phone number to view this document.' }, { status: 403 })
    }

    let dataUrl: string | undefined
    const stored = state[key] as { dataUrl?: string } | undefined
    if (stored?.dataUrl) {
      dataUrl = stored.dataUrl
    } else {
      // Legacy fallback: screenshot embedded directly in the repair record
      const repair = repairForGate
      const inline = repair?.paymentConfirmationImageUrl
      if (typeof inline === 'string' && inline.startsWith('data:')) dataUrl = inline
    }

    if (!dataUrl) return NextResponse.json({ error: 'Payment proof not found.' }, { status: 404 })

    const parsed = parseDataUrl(dataUrl)
    if (!parsed) return NextResponse.json({ error: 'Unsupported image format.' }, { status: 415 })

    const body = parsed.buffer.buffer.slice(parsed.buffer.byteOffset, parsed.buffer.byteOffset + parsed.buffer.byteLength)
    return new NextResponse(body as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': parsed.contentType,
        'Content-Length': String(parsed.buffer.length),
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    console.error('[PORTAL_PAYMENT_PROOF]', err)
    return NextResponse.json({ error: 'Failed to load payment proof.' }, { status: 500 })
  }
}
