import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling, getRequiredSession } from '@/lib/auth/api'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { saveStoreKeys } from '@/lib/server-store'

async function broadcastQuotes() {
  try {
    const all = await prisma.quote.findMany({ include: { items: true, client: true }, orderBy: { quoteDate: 'desc' } })
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

function mapQuoteUpdateToDb(body: any, clientId?: string) {
  const data: Record<string, any> = {}

  if (clientId) data.clientId = clientId
  if (body.assignedToId !== undefined) data.assignedToId = optionalUuid(body.assignedToId) ?? null
  if (body.opportunityId !== undefined) data.opportunityId = optionalUuid(body.opportunityId) ?? null
  if (body.status !== undefined) {
    const mapped = QUOTE_STATUS_MAP[body.status] ?? body.status
    if (VALID_STATUSES.has(mapped)) data.status = mapped
  }
  if (body.quoteDate ?? body.issueDate) {
    data.quoteDate = new Date(body.quoteDate ?? body.issueDate)
  }
  if (body.validUntil) data.validUntil = new Date(body.validUntil)
  if (body.subject !== undefined) data.subject = body.subject ?? null
  if (body.subtotal !== undefined) data.subtotal = Number(body.subtotal)
  if (body.taxAmount !== undefined) data.taxAmount = Number(body.taxAmount)
  if (body.discountAmount !== undefined) data.discountAmount = Number(body.discountAmount)
  if (body.discountPct !== undefined) data.discountPct = Number(body.discountPct)
  if (body.totalAmount !== undefined || body.total !== undefined)
    data.totalAmount = Number(body.totalAmount ?? body.total)
  if (body.notes !== undefined) data.notes = body.notes ?? null
  if (body.internalNotes !== undefined) data.internalNotes = body.internalNotes ?? null
  if (body.terms !== undefined) data.terms = body.terms ?? null

  return data
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

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const quote = await prisma.quote.findUnique({ where: { id: params.id }, include: { items: true } })
    if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(quote)
  })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const { lines, items } = body
    const linesData: any[] | undefined = lines ?? items ?? undefined
    const clientId = (body.clientId !== undefined || body.companyId !== undefined || body.customerId !== undefined)
      ? await resolveClientId(prisma, body.clientId ?? body.companyId ?? body.customerId, body)
      : undefined

    const quote = await prisma.quote.update({
      where: { id: params.id },
      data: {
        ...mapQuoteUpdateToDb(body, clientId),
        ...(linesData !== undefined ? {
          items: {
            deleteMany: {},
            create: mapQuoteItems(linesData),
          }
        } : {}),
      },
      include: { items: true },
    })
    void broadcastQuotes()
    return NextResponse.json(quote)
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return PUT(request, { params })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await prisma.quote.delete({ where: { id: params.id } })
    void broadcastQuotes()
    return NextResponse.json({ ok: true })
  })
}
