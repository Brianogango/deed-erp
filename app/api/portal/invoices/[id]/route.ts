import { NextRequest, NextResponse } from 'next/server'
import { verifyPortalDocToken } from '@/lib/portal-document-token'
import { loadAppState } from '@/lib/server-store'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const id = params.id
    const token = request.nextUrl.searchParams.get('token') ?? ''
    if (!verifyPortalDocToken('invoice', id, token)) {
      return NextResponse.json({ error: 'Invalid or expired link.' }, { status: 401 })
    }

    const state = await loadAppState(['deed_invoices', 'deed_companySettings'])
    const invoices = (state['deed_invoices'] ?? []) as Array<Record<string, unknown>>
    const invoice = invoices.find(i => i.id === id)
    if (!invoice) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })

    const company = (state['deed_companySettings'] ?? {}) as Record<string, unknown>
    return NextResponse.json({
      invoice: {
        id: invoice.id,
        ref: invoice.ref,
        status: invoice.status,
        partnerName: invoice.partnerName,
        date: invoice.date,
        dueDate: invoice.dueDate,
        subtotal: invoice.subtotal,
        taxTotal: invoice.taxTotal,
        total: invoice.total,
        amountPaid: invoice.amountPaid,
        notes: invoice.notes,
        lines: invoice.lines ?? [],
        currencyCode: invoice.currencyCode || 'KES',
      },
      company: {
        name: company.name || process.env.PDF_COMPANY_NAME || 'Deed Technologies',
        phone: company.phone,
        email: company.email,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load invoice' }, { status: 500 })
  }
}
