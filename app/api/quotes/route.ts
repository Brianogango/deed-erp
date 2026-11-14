import { userCan } from '@/lib/auth/can'
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { resolveClientId } from '@/lib/legacy-compat'
import { isUUID } from '@/lib/utils'
import { normalizeQuoteForClient, normalizeQuotesForClient } from '@/lib/quote-normalization'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { mergeScreenExtras, QUOTE_EXTRA_KEYS } from '@/lib/screen-extras'
import { broadcastQuotes, isRepairLinked, QUOTE_STATUS_MAP, VALID_STATUSES, mapQuoteItems } from '@/lib/api-shared/quotes'

// Repair staff generate repair quotes in the Repair module; those syncs must
// not be rejected or the server copy silently goes stale (causing duplicates).

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
    if (!userCan(session.user, isRepairLinked(body) ? 'repair.quotes.edit' : 'sales.quotes.create')) {
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
      quoteNumber = await getNextDocNumber('quote')
    }

    const mapped = mapQuoteBodyToDb(body, clientId)
    const quote = await prisma.quote.create({
      data: {
        ...(isUUID(body.id) ? { id: body.id } : {}),
        ...mapped,
        quoteNumber,
        createdById: session.user.id,
        screenExtras: mergeScreenExtras(null, body, QUOTE_EXTRA_KEYS) ?? undefined,
        items: { create: items },
      } as any,
      include: { items: true, client: true, opportunity: true },
    })
    void broadcastQuotes()
    return NextResponse.json(normalizeQuoteForClient(quote), { status: 201 })
  })
}
