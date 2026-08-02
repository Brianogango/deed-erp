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
    if (!verifyPortalDocToken('order', id, token)) {
      return NextResponse.json({ error: 'Invalid or expired link.' }, { status: 401 })
    }

    const state = await loadAppState(['deed_saleOrders', 'deed_deliveries', 'deed_invoices', 'deed_companySettings'])
    const orders = (state['deed_saleOrders'] ?? []) as Array<Record<string, unknown>>
    const order = orders.find(o => o.id === id)
    if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })

    const deliveries = ((state['deed_deliveries'] ?? []) as Array<Record<string, unknown>>)
      .filter(d => d.saleOrderId === id)
      .map(d => ({
        ref: d.ref,
        status: d.status,
        date: d.date || d.scheduledDate || d.validatedAt,
      }))
    const invoices = ((state['deed_invoices'] ?? []) as Array<Record<string, unknown>>)
      .filter(i => i.saleOrderId === id)
      .map(i => ({
        id: i.id,
        ref: i.ref,
        status: i.status,
        total: i.total,
        amountPaid: i.amountPaid,
      }))

    const company = (state['deed_companySettings'] ?? {}) as Record<string, unknown>
    return NextResponse.json({
      order: {
        id: order.id,
        ref: order.ref,
        status: order.status,
        customerName: order.customerName,
        date: order.date,
        deliveryDate: order.deliveryDate,
        subtotal: order.subtotal,
        taxTotal: order.taxTotal,
        total: order.total,
        notes: order.notes,
        lines: order.lines ?? [],
        currencyCode: order.currencyCode || 'KES',
      },
      deliveries,
      invoices,
      company: {
        name: company.name || process.env.PDF_COMPANY_NAME || 'Deed Technologies',
        phone: company.phone,
        email: company.email,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load order' }, { status: 500 })
  }
}
