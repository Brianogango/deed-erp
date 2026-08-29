import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { isUUID } from '@/lib/utils'
import { computeInvoiceTotals, clampAmountPaid, computeInvoiceLineMoney, inferInvoiceLineTaxCategory } from '@/lib/finance-invoice'
import { assertBillableQty } from '@/lib/purchase/three-way-match'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { parsePaginationParams, paginatedResponse } from '@/lib/api-pagination'
import { isPosInvoiceWrite, POS_INVOICE_WRITE_ROLES, salesCommissionAppliesToInvoice } from '@/lib/sales/commission-closer'
import { ensurePrismaPurchaseOrder } from '@/lib/purchase/po-prisma-sync'

// technical_lead: repair quotes create/update their linked invoice (see recordRepairBilling).
const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer', 'technical_lead']
// Repair staff trigger repair invoices from the Repair module; those syncs
// must not be rejected or the server copy silently goes stale.
const REPAIR_WRITE_ROLES = [...WRITE_ROLES, 'technician']

function isRepairLinked(body: any) {
  return Boolean(body?.repairId || body?.repairRef || /repair/i.test(String(body?.notes ?? '')))
}

function invoiceWriteRoles(body: any) {
  if (isRepairLinked(body)) return REPAIR_WRITE_ROLES
  if (isPosInvoiceWrite(body)) return [...POS_INVOICE_WRITE_ROLES]
  return WRITE_ROLES
}

// Map frontend status aliases to valid DocumentStatus enum values. The stored
// status is a pure document state; payment progress ('paid'/'partially_paid')
// is derived from amount_paid at read time, so legacy payment statuses
// collapse onto the posted state.
const INVOICE_STATUS_MAP: Record<string, string> = {
  posted:         'approved',
  paid:           'approved',
  partially_paid: 'approved',
  overdue:        'approved',
  partial:        'approved',
  pending:        'pending_approval',
  sent:           'pending_approval',
  open:           'approved',
}

// A vendor credit/debit note (e.g. a Return-to-Vendor credit) is booked as a
// negative-total Invoice — money flows the opposite direction of a normal
// bill. Rather than loosening the shared money-math clamps (which exist to
// stop a tampered payload from posting a negative-priced *normal* invoice),
// isCreditNote computes through the same safe, clamped pipeline using each
// line's absolute value, then flips the sign only on the final stored
// numbers. Regular invoices/bills are completely unaffected.
function mapInvoiceBodyToDb(body: any, clientId: string) {
  const rawStatus = body.status ?? 'draft'
  const status = INVOICE_STATUS_MAP[rawStatus] ?? rawStatus
  const isCreditNote = Boolean(body.isCreditNote)

  // Date handling: accept date/invoiceDate aliases
  let invoiceDate: Date | undefined
  if (body.invoiceDate) invoiceDate = new Date(body.invoiceDate)
  else if (body.date) invoiceDate = new Date(body.date)

  // Totals are recomputed from line items server-side; client-supplied
  // subtotal/total are ignored so a tampered payload cannot post an invoice
  // whose header does not tie back to qty × unitPrice.
  const lines: any[] = body.lines ?? body.items ?? []
  const absLines = isCreditNote ? lines.map(absLine) : lines
  const totals = computeInvoiceTotals(absLines, {
    headerTax: Math.abs(Number(body.taxAmount ?? body.taxTotal) || 0),
    discount: body.discountAmount,
  })
  const sign = isCreditNote ? -1 : 1

  return {
    invoiceNumber: body.invoiceNumber ?? body.ref,
    clientId,
    saleOrderId: optionalUuid(body.saleOrderId) ?? null,
    purchaseOrderId: optionalUuid(body.purchaseOrderId) ?? null,
    repairId: optionalUuid(body.repairId) ?? null,
    quoteId: optionalUuid(body.quoteId) ?? null,
    status,
    invoiceDate,
    dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
    subject: body.subject ?? null,
    subtotal: totals.subtotal * sign,
    taxAmount: totals.taxAmount * sign,
    discountAmount: totals.discountAmount,
    totalAmount: totals.totalAmount * sign,
    amountPaid: isCreditNote ? Math.min(0, Number(body.amountPaid) || 0) : clampAmountPaid(body.amountPaid, totals.totalAmount),
    notes: body.notes ?? null,
    invoiceAddress: body.invoiceAddress ?? null,
    deliveryAddress: body.deliveryAddress ?? null,
    paymentBlocked: Boolean(body.paymentBlocked),
    isPosInvoice: Boolean(body.isPosInvoice),
  }
}

function absLine(l: any) {
  return { ...l, qty: Math.abs(Number(l.qty) || 0), unitPrice: Math.abs(Number(l.unitPrice) || 0) }
}

function mapInvoiceItems(lines: any[], isCreditNote = false) {
  const sign = isCreditNote ? -1 : 1
  return lines.map((l: any, index: number) => {
    const isSection = l.lineType === 'section' || l.type === 'section'
    if (isSection) {
      return {
        description: String(l.description ?? l.desc ?? '').trim() || 'Section',
        qty: 0,
        unitPrice: 0,
        discountPct: 0,
        taxRate: 0,
        taxCategory: 'out_of_scope',
        taxCode: 'SECTION',
        taxableBase: 0,
        taxClaimEligible: false,
        lineSubtotal: 0,
        lineTax: 0,
        lineTotal: 0,
        sortOrder: index,
        productId: undefined as string | undefined,
        serialNumberId: undefined as string | undefined,
      }
    }
    const taxCategory = inferInvoiceLineTaxCategory(l.taxCategory ?? l.taxCode, Number(l.taxRate) || 0)
    const money = computeInvoiceLineMoney(isCreditNote ? absLine(l) : {
      qty: l.qty,
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
      discountPct: l.discountPct ?? l.discount,
      subtotal: l.subtotal,
      lineSubtotal: l.lineSubtotal,
    })
    return {
      description: l.description ?? '',
      qty: money.qty || 1,
      unitPrice: money.unitPrice * sign,
      discountPct: money.discountPct,
      taxRate: money.taxRate,
      taxCategory,
      taxCode: taxCategory === 'standard_16' ? 'VAT16' : taxCategory,
      taxableBase: money.lineSubtotal,
      taxClaimEligible: taxCategory === 'standard_16' || taxCategory === 'zero_rated',
      lineSubtotal: money.lineSubtotal * sign,
      lineTax: money.lineTax * sign,
      lineTotal: money.lineTotal * sign,
      sortOrder: index,
      productId: optionalUuid(l.productId) ?? undefined,
      serialNumberId: optionalUuid(l.serialNumberId ?? l.serialId) ?? undefined,
    }
  })
}

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const q = searchParams.get('q')?.trim()
    const { page, limit, skip, sort, order } = parsePaginationParams(searchParams, {
      defaultSort: 'invoiceDate',
      allowedSorts: ['invoiceDate', 'createdAt', 'updatedAt', 'totalAmount', 'invoiceNumber'],
    })

    const where: Record<string, unknown> = {
      ...(status ? { status: INVOICE_STATUS_MAP[status] ?? status } : {}),
      ...(q
        ? {
            OR: [
              { invoiceNumber: { contains: q, mode: 'insensitive' } },
              { subject: { contains: q, mode: 'insensitive' } },
              { notes: { contains: q, mode: 'insensitive' } },
              { client: { name: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }

    const [total, invoices] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        include: { items: true },
        orderBy: { [sort ?? 'invoiceDate']: order },
        skip,
        take: limit,
      }),
    ])

    return NextResponse.json(paginatedResponse(invoices, total, page, limit))
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const body = await request.json()
    const actor = await requireRole(invoiceWriteRoles(body))
    const lines: any[] = body.lines ?? body.items ?? []
    const isCreditNote = Boolean(body.isCreditNote)

    const items = mapInvoiceItems(lines, isCreditNote)
    const rawDeclaredTotal = Number(body.totalAmount ?? body.total) || 0
    if (!isCreditNote && rawDeclaredTotal < 0) {
      return NextResponse.json({ error: 'Invoice total cannot be negative' }, { status: 400 })
    }
    if (isCreditNote && rawDeclaredTotal > 0) {
      return NextResponse.json({ error: 'A credit note total must not be positive' }, { status: 400 })
    }
    const declaredTotal = Math.abs(rawDeclaredTotal)
    const effectiveTotal = declaredTotal || items.reduce((sum, item) => sum + Math.abs(Number(item.lineTotal) || 0), 0)
    if (effectiveTotal < 1) {
      return NextResponse.json({ error: 'Invoice total must be at least 1 — invoices below this amount cannot be created' }, { status: 400 })
    }

    const clientId = await resolveClientId(prisma, body.clientId ?? body.partnerId, body)

    const invoiceDate = body.invoiceDate ?? body.date ?? new Date().toISOString().slice(0, 10)
    const lock = await checkFiscalLock(invoiceDate)
    if (!lock.ok) {
      return NextResponse.json({ error: lock.error }, { status: lock.status })
    }

    let invoiceNumber = body.invoiceNumber ?? body.ref
    if (!invoiceNumber) {
      invoiceNumber = await getNextDocNumber('invoice')
    }

    const invoiceData = {
      ...(isUUID(body.id) ? { id: body.id } : {}),
      ...mapInvoiceBodyToDb(body, clientId),
      invoiceNumber,
      createdById: actor.id,
      items: { create: items },
    } as any

    // Server-side 3-way match: a vendor bill tied to a PO can only bill up to
    // (received − already billed) per line — client-side assertBillableQty
    // checks are UX only and a tampered POST could otherwise bill quantities
    // that were never received. Validating and advancing qtyBilled in one
    // transaction with the invoice create closes that gap; qtyBilled is a
    // monotonic counter so this deliberately never touches
    // PurchaseOrder.lockVersion (matches the GRN receiving pattern).
    const purchaseOrderId = optionalUuid(body.purchaseOrderId)
    let invoice
    if (!isCreditNote && purchaseOrderId) {
      // A blob-only PO (created while a product was missing from Prisma) must
      // not fail the bill — materialize it first, then run the 3-way match.
      // When the PO exists under a twin id (blob-first create, then API
      // re-create), the twin's Prisma id wins for the FK and the match.
      const resolvedPoId = await ensurePrismaPurchaseOrder(purchaseOrderId, actor.id)
      if (resolvedPoId && resolvedPoId !== purchaseOrderId) {
        invoiceData.purchaseOrderId = resolvedPoId
      }
      const effectivePoId = resolvedPoId ?? purchaseOrderId
      try {
        invoice = await prisma.$transaction(async tx => {
          const [po, activeBills] = await Promise.all([
            tx.purchaseOrder.findUnique({ where: { id: effectivePoId }, include: { items: true } }),
            tx.invoice.findMany({
              where: {
                purchaseOrderId: effectivePoId,
                status: { notIn: ['cancelled', 'voided'] },
                totalAmount: { gt: 0 },
              },
              include: { items: true },
            }),
          ])
          const matchedItems = po
            ? items
                .filter(item => item.productId)
                .map(item => ({ item, poItem: po.items.find(i => i.productId === item.productId) }))
                .filter((m): m is { item: typeof items[number]; poItem: NonNullable<typeof m.poItem> } => Boolean(m.poItem))
            : []
          const activeBilledByProduct = new Map<string, number>()
          for (const bill of activeBills) {
            for (const line of bill.items) {
              if (!line.productId) continue
              activeBilledByProduct.set(
                line.productId,
                (activeBilledByProduct.get(line.productId) ?? 0) + Math.max(0, Math.floor(Number(line.qty) || 0)),
              )
            }
          }

          for (const { item, poItem } of matchedItems) {
            const alreadyBilled = activeBilledByProduct.get(poItem.productId) ?? 0
            assertBillableQty({ qtyReceived: poItem.qtyReceived, qtyBilled: alreadyBilled }, Number(item.qty) || 0)
          }

          const created = await tx.invoice.create({ data: invoiceData, include: { items: true } })

          for (const { item, poItem } of matchedItems) {
            const qty = Math.max(0, Math.floor(Number(item.qty) || 0))
            const alreadyBilled = activeBilledByProduct.get(poItem.productId) ?? 0
            await tx.purchaseOrderItem.update({
              where: { id: poItem.id },
              data: { qtyBilled: Math.min(poItem.qtyOrdered, alreadyBilled + qty) },
            })
          }

          return created
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Three-way match failed'
        return NextResponse.json({ error: message }, { status: 400 })
      }
    } else {
      invoice = await prisma.invoice.create({ data: invoiceData, include: { items: true } })
    }

    await writeFinancialAudit({
      userId: actor.id,
      action: 'create_invoice',
      entityType: 'invoice',
      entityId: invoice.id,
      newValues: { invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount, status: invoice.status },
    })

    // POS invoices are created already posted, so they never hit the
    // draft → approved PATCH that posts commission for quotations.
    const createdPosted = invoice.status === 'approved' || invoice.status === 'invoiced'
    const isVendor = Boolean(isCreditNote) || body.type === 'vendor_bill'

    // An invoice created already-posted (repair billing, SO fast-path) must
    // post its GL journal here — it never passes through the PUT posting
    // path. POS invoices are excluded: their tender journal posts via
    // /api/pos/post-sale-journal (Dr bank / Cr revenue, no AR).
    if (createdPosted && !isVendor && !invoice.isPosInvoice) {
      try {
        const { buildInvoiceJournalInput, allocateInvoiceJournalRef } = await import('@/lib/accounting/invoice-journals')
        const { createJournalEntry } = await import('@/lib/accounting/journal-service')
        const journalInput = await buildInvoiceJournalInput({
          id: invoice.id,
          ref: invoice.invoiceNumber,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          totalAmount: Number(invoice.totalAmount),
          subtotal: Number(invoice.subtotal),
          taxAmount: Number(invoice.taxAmount),
          type: 'customer_invoice',
          repairId: invoice.repairId ?? undefined,
          partnerName: body.partnerName ?? body.clientName,
          lines: (invoice.items ?? []).map(i => ({
            productId: i.productId ?? undefined,
            qty: Number(i.qty),
            unitPrice: Number(i.unitPrice),
            subtotal: Number(i.lineSubtotal),
            description: i.description,
          })),
        }, { createdById: actor.id })
        journalInput.skipIfExists = true
        journalInput.ref = await allocateInvoiceJournalRef(journalInput.ref)
        const journal = await createJournalEntry(journalInput)
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            postingStatus: 'posted',
            postedJournalEntryId: journal.id,
            postedAt: new Date(),
            postedById: actor.id,
            documentType: 'customer_invoice',
          },
        })
      } catch (err) {
        // The invoice exists; a journal failure must not roll it back — the
        // blob journal mirror remains the fallback.
        console.error('[invoice] GL journal for posted-at-create invoice failed:', err)
      }
    }

    if (createdPosted && !isVendor && salesCommissionAppliesToInvoice(invoice) && (isPosInvoiceWrite(body) || invoice.saleOrderId)) {
      try {
        const { postSalesCommissionForInvoice } = await import('@/lib/accounting/sales-commission')
        await postSalesCommissionForInvoice(invoice.id, {
          salespersonUserId: optionalUuid(body.salespersonId) ?? null,
        })
      } catch (err) {
        console.error('[invoice] sales commission calculation failed:', err)
      }
    }

    return NextResponse.json(invoice, { status: 201 })
  })
}
