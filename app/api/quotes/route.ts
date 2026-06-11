import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { isUUID } from '@/lib/utils'
import { saveStoreKeys } from '@/lib/server-store'

async function broadcastQuotes() {
  try {
    const all = await prisma.quote.findMany({ include: { items: true, client: true, opportunity: true }, orderBy: { quoteDate: 'desc' } })
    void saveStoreKeys({ deed_quotes: JSON.stringify(all) })
  } catch {}
}

const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'sales_rep']

const QUOTE_STATUS_MAP: Record<string, string> = {
  sent:     'pending_approval',
  viewed:   'pending_approval',
  accepted: 'approved',
  expired:  'cancelled',
  revised:  'draft',
}

const VALID_STATUSES = new Set([
  'draft', 'pending_approval', 'approved', 'rejected', 'invoiced',
  'dispatched', 'delivered', 'paid', 'partially_paid', 'cancelled', 'voided',
])

function mapQuoteBodyToDb(body: any, clientId: string) {
  const rawStatus = body.status ?? 'draft'
  const mapped = QUOTE_STATUS_MAP[rawStatus] ?? rawStatus
  const status = VALID_STATUSES.has(mapped) ? mapped : 'draft'

  let quoteDate: Date | undefined
  if (body.quoteDate) quoteDate = new Date(body.quoteDate)
  else if (body.issueDate) quoteDate = new Date(body.issueDate)

  return {
    quoteNumber: body.quoteNumber ?? body.ref,
    clientId,
    assignedToId: body.assignedToId ?? null,
    opportunityId: body.opportunityId ?? null,
    status,
    quoteDate,
    validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
    subject: body.subject ?? null,
    subtotal: Number(body.subtotal ?? 0),
    taxAmount: Number(body.taxAmount ?? body.taxTotal ?? 0),
    discountAmount: Number(body.discountAmount ?? 0),
    discountPct: Number(body.discountPct ?? 0),
    totalAmount: Number(body.totalAmount ?? body.total ?? 0),
    notes: body.notes ?? null,
    internalNotes: body.internalNotes ?? null,
    terms: body.terms ?? null,
  }
}

function mapQuoteItems(lines: any[]) {
  return lines.map((l: any) => ({
    description: l.description ?? l.productName ?? '',
    qty: Number(l.qty ?? 1),
    unitPrice: Number(l.unitPrice ?? 0),
    discountPct: Number(l.discount ?? l.discountPct ?? 0),
    taxRate: Number(l.taxRate ?? 0),
    lineSubtotal: Number(l.subtotal ?? l.lineSubtotal ?? 0),
    lineTax: Number(l.lineTax ?? 0),
    lineTotal: Number(l.lineTotal ?? l.subtotal ?? 0),
    ...(optionalUuid(l.productId) ? { productId: optionalUuid(l.productId) } : {}),
  }))
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const quotes = await prisma.quote.findMany({
      include: { items: true, client: true, opportunity: true },
      orderBy: { quoteDate: 'desc' },
    })
    return NextResponse.json(quotes)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await request.json()
    const lines: any[] = body.lines ?? body.items ?? []
    const clientId = await resolveClientId(prisma, body.clientId ?? body.companyId ?? body.customerId, body)

    let quoteNumber = body.quoteNumber ?? body.ref
    if (!quoteNumber) {
      const count = await prisma.quote.count()
      quoteNumber = `QTE-${String(count + 1).padStart(5, '0')}`
    }

    const mapped = mapQuoteBodyToDb(body, clientId)
    const quote = await prisma.quote.create({
      data: {
        ...(isUUID(body.id) ? { id: body.id } : {}),
        ...mapped,
        quoteNumber,
        createdById: session.user.id,
        items: { create: mapQuoteItems(lines) },
      } as any,
      include: { items: true },
    })
    void broadcastQuotes()
    return NextResponse.json(quote, { status: 201 })
  })
}
