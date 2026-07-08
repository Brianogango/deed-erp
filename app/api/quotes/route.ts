import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { isUUID } from '@/lib/utils'
import { saveStoreKeys } from '@/lib/server-store'
import { normalizeQuoteForClient, normalizeQuotesForClient } from '@/lib/quote-normalization'

async function broadcastQuotes() {
  try {
    const all = await prisma.quote.findMany({ include: { items: true, client: true, opportunity: true }, orderBy: { quoteDate: 'desc' } })
    void saveStoreKeys({ deed_quotes: JSON.stringify(normalizeQuotesForClient(all)) })
  } catch {}
}

const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'sales_rep']
// Repair staff generate repair quotes in the Repair module; those syncs must
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

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const quotes = await prisma.quote.findMany({
      include: { items: true, client: true, opportunity: true },
      orderBy: { quoteDate: 'desc' },
    })
    return NextResponse.json(normalizeQuotesForClient(quotes))
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()
    const allowedRoles = isRepairLinked(body) ? REPAIR_WRITE_ROLES : WRITE_ROLES
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const lines: any[] = body.lines ?? body.items ?? []

    const items = mapQuoteItems(lines)
    const declaredTotal = Number(body.totalAmount ?? body.total ?? 0)
    const effectiveTotal = declaredTotal || items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0)
    if (effectiveTotal < 1) {
      return NextResponse.json({ error: 'Quote total must be at least 1 — quotes below this amount cannot be created' }, { status: 400 })
    }

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
        items: { create: items },
      } as any,
      include: { items: true, client: true, opportunity: true },
    })
    void broadcastQuotes()
    return NextResponse.json(normalizeQuoteForClient(quote), { status: 201 })
  })
}
