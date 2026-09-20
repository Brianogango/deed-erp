import { NextRequest, NextResponse } from 'next/server'
import { lookupRepair } from '@/lib/portal-repair-server'
import { findRepairLinkedInvoice } from '@/lib/portal-invoice-link'
import { saveStoreKeys, loadAppState, loadAppStateForWrite, withAppStateKeyLock } from '@/lib/server-store'
import { checkRateLimit } from '@/lib/rate-limit'
import { phoneMatches, isPortalPhoneVerificationRequired } from '@/lib/portal-verify'

function parseAmount(text: string): number | null {
  const patterns = [
    /Ksh\s*([0-9,]+(?:\.\d{1,2})?)/i,
    /KES\s*([0-9,]+(?:\.\d{1,2})?)/i,
    /(?:paid|received|sent)\s+(?:Ksh|KES)?\s*([0-9,]+(?:\.\d{1,2})?)/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return Number(match[1].replace(/,/g, ''))
  }
  return null
}

function parseMpesaCode(text: string): string | null {
  const direct = text.match(/\b([A-Z0-9]{10})\b/)
  return direct ? direct[1] : null
}

function detectImageMime(buffer: ArrayBuffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const b = new Uint8Array(buffer)
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return 'image/png'
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (
    b.length >= 12
    && String.fromCharCode(...b.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...b.slice(8, 12)) === 'WEBP'
  ) return 'image/webp'
  return null
}

function dataUrlFor(mime: string, buffer: ArrayBuffer) {
  return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`
}

function paymentProofKey(ref: string) {
  return `repair_payment_proof_${ref.toUpperCase().replace(/\//g, '_')}`
}

export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
  const rl = await checkRateLimit(`portal-payment:${ip}`, 12, 3600)
  if (!rl.success) return NextResponse.json({ error: 'Too many payment confirmation attempts. Please wait before trying again.' }, { status: 429 })

  const ref = decodeURIComponent(params.ref)
  const repair = await lookupRepair(ref)
  if (!repair) return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })

  const form = await req.formData()
  const confirmationText = String(form.get('confirmationText') ?? '').normalize('NFKC').trim().slice(0, 5_000)
  const screenshot = form.get('screenshot')
  if (!confirmationText && !(screenshot instanceof File && screenshot.size > 0)) {
    return NextResponse.json({ error: 'Paste the M-PESA confirmation message or upload a screenshot.' }, { status: 400 })
  }

  // Store the screenshot under its own app-state key (like repair photos) —
  // NEVER inline in the repair record. A single base64 screenshot inside
  // deed_repairs_v2 bloats every page load, sync, and localStorage write and
  // can push the repairs key past the SSE size cap, stopping live sync.
  let imageUrl: string | undefined
  if (screenshot instanceof File && screenshot.size > 0) {
    if (screenshot.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'Screenshot must be 5MB or smaller.' }, { status: 400 })
    const buffer = await screenshot.arrayBuffer()
    const detectedMime = detectImageMime(buffer)
    if (!detectedMime) {
      return NextResponse.json({ error: 'Screenshot must be a valid PNG, JPEG, or WebP image.' }, { status: 415 })
    }
    // Never trust the browser-supplied MIME header; store the type detected
    // from file signatures so HTML/SVG/polyglot uploads cannot masquerade as screenshots.
    const dataUrl = dataUrlFor(detectedMime, buffer)
    await saveStoreKeys({ [paymentProofKey(ref)]: JSON.stringify({ dataUrl, uploadedAt: new Date().toISOString() }) })
    imageUrl = `/api/portal/repair/${encodeURIComponent(ref)}/payment-proof`
  }

  const appState = await loadAppState(['deed_systemSettings', 'deed_repairs_v2', 'deed_invoices'])

  // Ownership proof (default ON): enforced unless an admin explicitly sets
  // secPortalRequirePhoneVerification to false (SEC-005).
  const settings = appState['deed_systemSettings'] as { secPortalRequirePhoneVerification?: boolean } | undefined
  if (isPortalPhoneVerificationRequired(settings) && !phoneMatches(String(form.get('verifyPhone') ?? '').slice(0, 80), repair.customerPhone)) {
    return NextResponse.json({ error: 'Verification failed. Enter the phone number on this repair to confirm.' }, { status: 403 })
  }
  const repairs = (appState['deed_repairs_v2'] as any[]) || []
  const repairIndex = repairs.findIndex((r: any) => r.ref.toUpperCase() === ref.toUpperCase())
  if (repairIndex === -1) return NextResponse.json({ error: 'Repair could not be synchronized.' }, { status: 404 })

  const targetRepair = repairs[repairIndex]
  const invoices = (appState['deed_invoices'] as any[]) || []
  const invoice = findRepairLinkedInvoice(invoices, targetRepair) ?? null
  // Prefer a real linked invoice; otherwise fall back to the repair quote — never
  // a random unmatched invoice (see findRepairLinkedInvoice).
  const invoiceTotal = Number(invoice?.total ?? invoice?.totalAmount ?? targetRepair.quote?.approvedTotal ?? targetRepair.quote?.total ?? 0)
  if (!invoiceTotal || invoiceTotal <= 0) return NextResponse.json({ error: 'No payable invoice amount was found for this repair.' }, { status: 409 })

  const parsedAmount = parseAmount(confirmationText)
  const mpesaCode = parseMpesaCode(confirmationText)
  const amountMatches = parsedAmount !== null && Math.abs(parsedAmount - invoiceTotal) <= 1
  const submittedAt = new Date().toISOString()

  // Payment confirmations submitted through the portal are NEVER auto-applied to
  // the ledger — forged confirmation text must not be able to mark an invoice
  // paid. The submission is always queued for finance review, which posts the
  // payment through the authenticated /api/invoices/[id]/payments endpoint.
  targetRepair.paymentConfirmationText = confirmationText || undefined
  targetRepair.paymentConfirmationImageUrl = imageUrl
  targetRepair.paymentConfirmationStatus = 'pending_review'
  targetRepair.paymentConfirmationSubmittedAt = submittedAt
  targetRepair.paymentReceiptNumber = mpesaCode ?? undefined
  targetRepair.paymentConfirmationAmount = parsedAmount ?? undefined
  targetRepair.paymentConfirmationNotes = amountMatches
    ? 'Portal M-PESA confirmation received; amount appears to match the invoice. Awaiting finance verification.'
    : 'Portal M-PESA confirmation received; requires finance review to verify the amount and reference.'

  // Persist under the ledger lock against a fresh read (see approve route).
  await withAppStateKeyLock('deed_repairs_v2', async () => {
    const fresh = await loadAppStateForWrite()
    const freshRepairs = Array.isArray(fresh['deed_repairs_v2']) ? fresh['deed_repairs_v2'] as any[] : []
    const idx = freshRepairs.findIndex((r: any) => r.id === targetRepair.id)
    if (idx >= 0) freshRepairs[idx] = targetRepair
    else freshRepairs.unshift(targetRepair)
    await saveStoreKeys({ 'deed_repairs_v2': JSON.stringify(freshRepairs) })
  })

  const updated = await lookupRepair(ref)
  return NextResponse.json({ repair: updated, status: 'pending_review', amountMatches, parsedAmount, invoiceTotal, receiptNumber: mpesaCode ?? undefined }, { status: 200 })
}
