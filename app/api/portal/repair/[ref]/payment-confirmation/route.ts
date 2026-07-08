import { NextRequest, NextResponse } from 'next/server'
import { lookupRepair } from '@/lib/portal-repair-server'
import { saveStoreKeys, loadAppState } from '@/lib/server-store'
import { checkRateLimit } from '@/lib/rate-limit'
import prisma from '@/lib/prisma'

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

function dataUrlFor(file: File, buffer: ArrayBuffer) {
  const mime = file.type || 'application/octet-stream'
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
  const confirmationText = String(form.get('confirmationText') ?? '').trim()
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
    if (!screenshot.type.startsWith('image/')) return NextResponse.json({ error: 'Screenshot must be an image file.' }, { status: 400 })
    if (screenshot.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'Screenshot must be 5MB or smaller.' }, { status: 400 })
    const dataUrl = dataUrlFor(screenshot, await screenshot.arrayBuffer())
    await saveStoreKeys({ [paymentProofKey(ref)]: JSON.stringify({ dataUrl, uploadedAt: new Date().toISOString() }) })
    imageUrl = `/api/portal/repair/${encodeURIComponent(ref)}/payment-proof`
  }

  const appState = await loadAppState()
  const repairs = (appState['deed_repairs_v2'] as any[]) || []
  const repairIndex = repairs.findIndex((r: any) => r.ref.toUpperCase() === ref.toUpperCase())
  if (repairIndex === -1) return NextResponse.json({ error: 'Repair could not be synchronized.' }, { status: 404 })

  const targetRepair = repairs[repairIndex]
  const invoices = (appState['deed_invoices'] as any[]) || []
  const invoiceKey = targetRepair.invoiceId ?? targetRepair.linkedInvoiceId
  const invoiceIndex = invoices.findIndex((inv: any) => inv.id === invoiceKey || inv.ref === targetRepair.linkedInvoiceRef || inv.invoiceNumber === targetRepair.linkedInvoiceRef)
  const invoice = invoiceIndex >= 0 ? invoices[invoiceIndex] : null
  const invoiceTotal = Number(invoice?.total ?? invoice?.totalAmount ?? repair.invoiceTotal ?? targetRepair.quote?.approvedTotal ?? targetRepair.quote?.total ?? 0)
  if (!invoiceTotal || invoiceTotal <= 0) return NextResponse.json({ error: 'No payable invoice amount was found for this repair.' }, { status: 409 })

  const parsedAmount = parseAmount(confirmationText)
  const mpesaCode = parseMpesaCode(confirmationText) ?? `MPESA-${Date.now()}`
  const amountMatches = parsedAmount !== null && Math.abs(parsedAmount - invoiceTotal) <= 1
  const strongMatch = amountMatches && !!confirmationText
  const status = strongMatch ? 'auto_paid' : 'pending_review'
  const submittedAt = new Date().toISOString()

  targetRepair.paymentConfirmationText = confirmationText || undefined
  targetRepair.paymentConfirmationImageUrl = imageUrl
  targetRepair.paymentConfirmationStatus = status
  targetRepair.paymentConfirmationSubmittedAt = submittedAt
  targetRepair.paymentReceiptNumber = strongMatch ? mpesaCode : undefined
  targetRepair.paymentConfirmationAmount = parsedAmount ?? undefined
  targetRepair.paymentConfirmationNotes = strongMatch ? 'Auto-matched portal M-PESA confirmation against invoice total.' : 'Submitted from portal; requires finance review because amount/code could not be strongly matched.'

  if (strongMatch) {
    if (invoiceIndex >= 0) {
      invoices[invoiceIndex] = { ...invoice, amountPaid: invoiceTotal, status: 'paid', paymentReference: mpesaCode, paymentMethod: 'mpesa', paymentDate: submittedAt.slice(0, 10) }
    }
    if (invoiceKey) {
      try {
        const systemUser = await prisma.user.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } })
        if (systemUser) {
          const dbInvoice = await prisma.invoice.findUnique({ where: { id: invoiceKey } })
          if (dbInvoice) {
            await prisma.$transaction([
              prisma.payment.create({ data: { invoiceId: dbInvoice.id, amount: invoiceTotal, paymentMethod: 'mpesa', reference: mpesaCode, paidAt: new Date(), notes: `Portal M-PESA confirmation for repair ${ref}`, createdById: systemUser.id } }),
              prisma.invoice.update({ where: { id: dbInvoice.id }, data: { amountPaid: invoiceTotal, status: 'paid' as any } }),
            ])
          }
        }
      } catch (err) {
        console.error('[PORTAL_PAYMENT] Prisma payment posting failed:', err)
      }
    }
  }

  await saveStoreKeys({
    'deed_repairs_v2': JSON.stringify(repairs),
    'deed_invoices': JSON.stringify(invoices),
  })

  const updated = await lookupRepair(ref)
  return NextResponse.json({ repair: updated, status, amountMatches, parsedAmount, invoiceTotal, receiptNumber: targetRepair.paymentReceiptNumber }, { status: 200 })
}
