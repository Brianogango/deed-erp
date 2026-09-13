import { NextRequest, NextResponse } from 'next/server'
import { loadAppState } from '@/lib/server-store'
import { findRepairLinkedInvoice } from '@/lib/portal-invoice-link'
import { DEFAULT_COMPANY_SETTINGS, DEFAULT_BANK_ACCOUNTS } from '@/lib/store'
import { buildDeedDocumentPdf, deedPdfToBuffer } from '@/lib/deed-document-pdf'
import { loadLogoForPdfServer } from '@/lib/pdf-logo.server'
import { getServerSession } from '@/lib/auth/server'
import { portalDocumentAccessAllowed, isPortalPhoneVerificationRequired } from '@/lib/portal-verify'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } }
) {
  try {
    const ref = decodeURIComponent(params.ref)
    const state = await loadAppState(['deed_repairs_v2', 'deed_invoices', 'deed_companySettings', 'deed_bankAccounts'])
    const repairs = (state.deed_repairs_v2 ?? []) as any[]
    const invoices = (state.deed_invoices ?? []) as any[]
    const co = { ...DEFAULT_COMPANY_SETTINGS, ...((state.deed_companySettings as Record<string, unknown> | undefined) ?? {}) }
    const banks = (state.deed_bankAccounts ?? DEFAULT_BANK_ACCOUNTS) as any[]
    const logo = await loadLogoForPdfServer(typeof co.logoUrl === 'string' ? co.logoUrl : null)

    const repair = repairs.find((r: any) => r.ref?.toLowerCase() === ref.toLowerCase())
    if (!repair) return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })

    // Receipts carry payment detail — ref alone is not a capability.
    const session = await getServerSession().catch(() => null)
    const settingsState = await loadAppState(['deed_systemSettings'])
    const allowed = await portalDocumentAccessAllowed(_req, repair, {
      session,
      phoneVerificationRequired: isPortalPhoneVerificationRequired(settingsState.deed_systemSettings as any),
    })
    if (!allowed) {
      return NextResponse.json({ error: 'Enter the registered phone number to download this document.' }, { status: 403 })
    }

    const invoice = findRepairLinkedInvoice(invoices, repair)

    const paymentStatus = repair.paymentConfirmationStatus
    const isPaid = paymentStatus === 'auto_paid' || paymentStatus === 'paid' || Number(invoice?.amountPaid ?? 0) > 0
    if (!isPaid) return NextResponse.json({ error: 'Payment has not been confirmed for this repair.' }, { status: 409 })

    const amountPaid = Number(invoice?.amountPaid ?? repair.paymentConfirmationAmount ?? invoice?.total ?? invoice?.totalAmount ?? repair.quote?.approvedTotal ?? repair.quote?.total ?? 0)
    const receiptNo = repair.paymentReceiptNumber ?? invoice?.paymentReference ?? `RCPT-${repair.ref}`.replace(/[^\w-]/g, '-')
    const paidAt = repair.paymentConfirmationSubmittedAt ?? invoice?.paymentDate ?? new Date().toISOString()
    const invoiceRef = invoice?.ref ?? invoice?.invoiceNumber ?? repair.linkedInvoiceRef ?? '—'

    const doc = buildDeedDocumentPdf(
      {
        title: 'Receipt',
        ref: String(receiptNo),
        date: paidAt,
        sourceRef: ref,
        customerName: String(repair.customerName ?? '—'),
        customerCountry: 'Kenya',
        customerPhone: repair.customerPhone || undefined,
        partyLabel: 'Received From',
        lines: [{
          description: `Payment for repair services — ${repair.productName || 'Device'}${invoiceRef ? ` (Invoice ${invoiceRef})` : ''}`,
          qty: 1,
          unitPrice: amountPaid,
          taxRate: 0,
          subtotal: amountPaid,
        }],
        subtotal: amountPaid,
        taxTotal: 0,
        total: amountPaid,
        amountPaid,
        notes: `Status: PAID\nMethod: ${invoice?.paymentMethod ?? 'M-Pesa'}\nThis receipt confirms payment received for repair ${ref}.`,
        showPaymentDetails: false,
        showSignature: true,
      },
      {
        name: co.name,
        address: co.address,
        city: co.city,
        phone: co.phone,
        email: co.email,
        website: co.website,
        kraPin: co.kraPin,
        currency: co.currency,
        mpesaPaybill: co.mpesaPaybill,
        mpesaAccount: co.mpesaAccount,
        printTemplate: co.printTemplate,
      invoiceFooter: co.invoiceFooter || `Thank you for choosing ${co.name}.`,
        logoDataUrl: logo?.dataUrl,
        logoWidth: logo?.width,
        logoHeight: logo?.height,
        logoFormat: logo?.format,
      },
      banks,
    )

    return new NextResponse(deedPdfToBuffer(doc), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Receipt-${String(receiptNo).replace(/[^\w./-]/g, '-')}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[PORTAL_RECEIPT_PDF]', err)
    return NextResponse.json({ error: 'Failed to generate receipt PDF.' }, { status: 500 })
  }
}
