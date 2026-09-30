import { NextRequest, NextResponse } from 'next/server'
import { loadAppState } from '@/lib/server-store'
import { DEFAULT_COMPANY_SETTINGS, DEFAULT_BANK_ACCOUNTS } from '@/lib/store'
import { buildDeedDocumentPdf, deedPdfToBuffer } from '@/lib/deed-document-pdf'
import { loadLogoForPdfServer } from '@/lib/pdf-logo.server'
import { getServerSession } from '@/lib/auth/server'
import { portalDocumentAccessAllowed, isPortalPhoneVerificationRequired } from '@/lib/portal-verify'
import { findRepairByPortalRef } from '@/lib/repair-ref'
import { repairQuoteDocument } from '@/lib/portal/repair-quote-document'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/repair/[ref]/quote-pdf
 * The repair quote as a PDF, like the invoice and receipt downloads. Same
 * gate: a staff session or the phone number registered on the repair.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> }
) {
  const resolvedParams = await params
  try {
    const ref = decodeURIComponent(resolvedParams.ref)
    const state = await loadAppState(['deed_repairs_v2', 'deed_companySettings', 'deed_bankAccounts', 'deed_systemSettings'])
    const repairs = (state.deed_repairs_v2 ?? []) as any[]
    const co = { ...DEFAULT_COMPANY_SETTINGS, ...((state.deed_companySettings as Record<string, unknown> | undefined) ?? {}) }
    const banks = (state.deed_bankAccounts ?? DEFAULT_BANK_ACCOUNTS) as any[]

    const repair = findRepairByPortalRef(repairs, ref)
    if (!repair) return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })

    const session = await getServerSession().catch(() => null)
    const allowed = await portalDocumentAccessAllowed(req, repair, {
      session,
      phoneVerificationRequired: isPortalPhoneVerificationRequired(state.deed_systemSettings as any),
    })
    if (!allowed) {
      return NextResponse.json({ error: 'Enter the registered phone number to download this document.' }, { status: 403 })
    }

    const document = repairQuoteDocument(repair, new Date().toISOString())
    if (!document) return NextResponse.json({ error: 'There is no quote on this repair yet.' }, { status: 404 })

    const logo = await loadLogoForPdfServer(typeof co.logoUrl === 'string' ? co.logoUrl : null)
    const doc = buildDeedDocumentPdf(
      {
        ...document,
        customerName: String(repair.customerName ?? '—'),
        customerCountry: 'Kenya',
        customerPhone: repair.customerPhone || undefined,
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
        printFont: co.printFont,
        printBackground: co.printBackground,
        printPrimaryColor: co.printPrimaryColor,
        printSecondaryColor: co.printSecondaryColor,
        printTagline: co.printTagline,
        printPaperFormat: co.printPaperFormat,
        invoiceFooter: co.invoiceFooter,
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
        'Content-Disposition': `attachment; filename="Quote-${String(document.ref).replace(/[^\w./-]/g, '-')}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[PORTAL_QUOTE_PDF]', err)
    return NextResponse.json({ error: 'Failed to generate quote PDF.' }, { status: 500 })
  }
}
