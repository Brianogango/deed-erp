import { NextRequest, NextResponse } from 'next/server'
import { loadAppState } from '@/lib/server-store'
import { findRepairLinkedInvoice } from '@/lib/portal-invoice-link'
import { DEFAULT_COMPANY_SETTINGS, DEFAULT_BANK_ACCOUNTS } from '@/lib/store'
import { buildDeedDocumentPdf, deedPdfToBuffer } from '@/lib/deed-document-pdf'
import { loadLogoForPdfServer } from '@/lib/pdf-logo.server'
import { customerFacingNotes } from '@/lib/customer-facing-notes'
import { getServerSession } from '@/lib/auth/server'
import { portalDocumentAccessAllowed, isPortalPhoneVerificationRequired } from '@/lib/portal-verify'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/repair/[ref]/invoice-pdf
 * Public — generates and streams the invoice PDF for a completed repair.
 * Only available once the repair has a linked invoice.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } }
) {
  try {
    const ref = decodeURIComponent(params.ref)

    const state = await loadAppState(['deed_repairs_v2', 'deed_invoices', 'deed_companySettings', 'deed_bankAccounts'])
    const repairs = (state['deed_repairs_v2'] ?? []) as any[]
    const invoices = (state['deed_invoices'] ?? []) as any[]
    const savedSettings = state['deed_companySettings'] as Record<string, unknown> | undefined
    const savedBankAccounts = (state['deed_bankAccounts'] ?? DEFAULT_BANK_ACCOUNTS) as any[]

    const co = { ...DEFAULT_COMPANY_SETTINGS, ...(savedSettings ?? {}) }
    const logo = await loadLogoForPdfServer(typeof co.logoUrl === 'string' ? co.logoUrl : null)

    const repair = repairs.find((r: any) => r.ref.toLowerCase() === ref.toLowerCase())
    if (!repair) {
      return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })
    }

    // The ref alone is not a capability — invoice PDFs carry customer PII and
    // commercial detail. Staff session or the registered phone number.
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
    if (!invoice) {
      return NextResponse.json({ error: 'No invoice found for this repair.' }, { status: 404 })
    }

    const lines = (invoice.lines ?? []) as any[]
    const deviceDesc = [repair.deviceBrand, repair.deviceModel, repair.deviceColor].filter(Boolean).join(' ')
    const commercialNotes = customerFacingNotes(invoice.notes)
    const notes = [
      deviceDesc ? `Device: ${deviceDesc}` : '',
      repair.deviceSerial ? `S/N: ${repair.deviceSerial}` : '',
      commercialNotes,
    ].filter(Boolean).join('\n') || undefined

    const doc = buildDeedDocumentPdf(
      {
        title: 'Invoice',
        ref: String(invoice.ref ?? invoice.invoiceNumber ?? '—'),
        date: invoice.date,
        dueLabel: 'Due Date',
        dueDate: invoice.dueDate,
        sourceRef: ref,
        customerName: String(invoice.partnerName ?? repair.customerName ?? '—'),
        customerCountry: 'Kenya',
        customerPhone: repair.customerPhone || undefined,
        lines: lines.map((line: any) => ({
          description: String(line.description ?? line.productName ?? ''),
          qty: Number(line.qty ?? 1),
          unitPrice: Number(line.unitPrice ?? 0),
          taxRate: Number(line.taxRate ?? co.vatRate ?? 16),
          subtotal: Number(line.subtotal ?? line.lineTotal ?? 0),
        })),
        subtotal: Number(invoice.subtotal ?? 0),
        taxTotal: Number(invoice.taxTotal ?? 0),
        total: Number(invoice.total ?? 0),
        amountPaid: Number(invoice.amountPaid ?? 0) || undefined,
        notes,
        paymentCommunication: true,
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
        invoiceFooter: co.invoiceFooter,
        logoDataUrl: logo?.dataUrl,
        logoWidth: logo?.width,
        logoHeight: logo?.height,
        logoFormat: logo?.format,
      },
      savedBankAccounts,
    )

    const filename = `Invoice-${String(invoice.ref ?? ref).replace(/[^\w./-]/g, '-')}.pdf`
    return new NextResponse(deedPdfToBuffer(doc), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[PORTAL_INVOICE_PDF]', err)
    return NextResponse.json({ error: 'Failed to generate invoice PDF.' }, { status: 500 })
  }
}
