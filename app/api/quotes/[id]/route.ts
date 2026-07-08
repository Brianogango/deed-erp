import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling, getRequiredSession } from '@/lib/auth/api'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { saveStoreKeys } from '@/lib/server-store'
import { normalizeQuoteForClient, normalizeQuotesForClient } from '@/lib/quote-normalization'

async function broadcastQuotes() {
  try {
    const all = await prisma.quote.findMany({ include: { items: true, client: true, opportunity: true }, orderBy: { quoteDate: 'desc' } })
    void saveStoreKeys({ deed_quotes: JSON.stringify(normalizeQuotesForClient(all)) })
  } catch {}
}

const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'sales_rep']
// Repair staff revise repair quotes in the Repair module; those syncs must
// not be rejected or the server copy silently goes stale (causing duplicates).
const REPAIR_WRITE_ROLES = [...WRITE_ROLES, 'technical_lead', 'technician']

function isRepairLinked(body: any) {
  return Boolean(body?.repairId || body?.repairRef || body?.source === 'repair' || /repair/i.test(String(body?.opportunityName ?? '')))
}

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
  return lines.map((l: any) => {
    const qty = Number(l.qty ?? 1)
    if (!Number.isFinite(qty) || qty <= 0) {
      throw Object.assign(new Error('Quote line quantity must be greater than zero'), { status: 400 })
    }
    const unitPrice = Number(l.unitPrice ?? 0)
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw Object.assign(new Error('Quote line unit price cannot be negative'), { status: 400 })
    }
    const discountPct = Number(l.discount ?? l.discountPct ?? 0)
    const taxRate = Number(l.taxRate ?? 0)
    const lineSubtotal = Number(l.subtotal ?? l.lineSubtotal ?? Math.round(qty * unitPrice * (1 - discountPct / 100)))
    const lineTax = Number(l.lineTax ?? l.taxAmount ?? Math.round(lineSubtotal * taxRate / 100))
    return {
      description: l.description ?? l.productName ?? '',
      qty,
      unitPrice,
      discountPct,
      taxRate,
      lineSubtotal,
      lineTax,
      lineTotal: Number(l.lineTotal ?? lineSubtotal + lineTax),
      ...(optionalUuid(l.productId) ? { productId: optionalUuid(l.productId) } : {}),
    }
  })
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const quote = await prisma.quote.findUnique({ where: { id: params.id }, include: { items: true, client: true, opportunity: true } })
    if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(normalizeQuoteForClient(quote))
  })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()
    const allowedRoles = isRepairLinked(body) ? REPAIR_WRITE_ROLES : WRITE_ROLES
    if (!allowedRoles.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { lines, items } = body
    const linesData: any[] | undefined = lines ?? items ?? undefined
    const clientId = (body.clientId !== undefined || body.companyId !== undefined || body.customerId !== undefined)
      ? await resolveClientId(prisma, body.clientId ?? body.companyId ?? body.customerId, body)
      : undefined

    // Return a proper 404 (instead of a Prisma 500) so callers can fall back
    // to re-creating a quote that never reached the server.
    const exists = await prisma.quote.findUnique({ where: { id: params.id }, select: { id: true } })
    if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
      include: { items: true, client: true, opportunity: true },
    })
    void broadcastQuotes()
    return NextResponse.json(normalizeQuoteForClient(quote))
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
