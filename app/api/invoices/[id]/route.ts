import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { computeInvoiceTotals, computeInvoiceLineMoney, inferInvoiceLineTaxCategory, invoiceLineMissingTaxCategory, postedInvoicePutDecision, stripPostedInvoiceEconomicFields, POSTED_INVOICE_ECONOMIC_PUT_KEYS, PRISMA_POSTED_INVOICE_STATUSES } from '@/lib/finance-invoice'
import { writeFinancialAudit, writeFinancialAuditInTx } from '@/lib/finance-audit'
import { lockVersionMismatch, nextLockVersion, readExpectedVersion } from '@/lib/optimistic-lock'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { resolveBlobInvoiceMirror } from '@/lib/accounting/resolve-invoice-mirror'
import { salesCommissionAppliesToInvoice } from '@/lib/sales/commission-closer'
import { createJournalEntryInTx } from '@/lib/accounting/journal-service'
import { buildInvoiceJournalInput, allocateInvoiceJournalRef } from '@/lib/accounting/invoice-journals'
import { ensurePrismaPurchaseOrder } from '@/lib/purchase/po-prisma-sync'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'

function rethrowInvoicePostingError(err: unknown): never {
  if (err && typeof err === 'object' && 'status' in err && typeof (err as { status?: unknown }).status === 'number') {
    throw err
  }
  const message = err instanceof Error ? err.message : 'Invoice journal posting failed'
  if (
    /Unknown journal code|Unknown account|Inactive account|Fiscal period|Unbalanced journal|Journal ref already exists|Zero-value journal|Journal account must start|no positive posting amount/i.test(message)
  ) {
    throw Object.assign(new Error(message), { status: 409 })
  }
  throw err
}

// technical_lead: repair quotes create/update their linked invoice (see recordRepairBilling).
const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer', 'technical_lead']
// Repair staff revise repair invoices via quote revisions in the Repair
// module; those syncs must not be rejected or the invoice goes stale.
const REPAIR_WRITE_ROLES = [...WRITE_ROLES, 'technician']

function isRepairLinked(body: any) {
  return Boolean(body?.repairId || body?.repairRef || /repair/i.test(String(body?.notes ?? '')))
}

// The stored status is a pure document state; payment progress
// ('paid'/'partially_paid') is derived from amount_paid at read time, so
// legacy payment statuses collapse onto the posted state.
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

const VALID_STATUSES = new Set([
  'draft', 'pending_approval', 'approved', 'rejected', 'invoiced',
  'dispatched', 'delivered', 'cancelled', 'voided',
])

function mapInvoiceUpdateToDb(body: any, clientId?: string) {
  const rawStatus = body.status
  const mappedStatus = rawStatus ? (INVOICE_STATUS_MAP[rawStatus] ?? rawStatus) : undefined
  const status = mappedStatus && VALID_STATUSES.has(mappedStatus) ? mappedStatus : undefined

  let invoiceDate: Date | undefined
  if (body.invoiceDate) invoiceDate = new Date(body.invoiceDate)
  else if (body.date) invoiceDate = new Date(body.date)

  // When line items are supplied, recompute all totals server-side. Never accept
  // header totals or `amountPaid` directly on update — amountPaid is owned by the
  // payments endpoint, and totals must always tie back to the line items.
  const lines: any[] | undefined = body.lines ?? body.items ?? undefined
  const totals = lines !== undefined
    ? computeInvoiceTotals(lines, { headerTax: body.taxAmount ?? body.taxTotal, discount: body.discountAmount })
    : undefined

  const data: Record<string, any> = {
    clientId,
    saleOrderId: body.saleOrderId !== undefined ? optionalUuid(body.saleOrderId) ?? null : undefined,
    repairId: body.repairId !== undefined ? optionalUuid(body.repairId) ?? null : undefined,
    subject: body.subject ?? undefined,
    subtotal: totals?.subtotal,
    taxAmount: totals?.taxAmount,
    discountAmount: totals?.discountAmount,
    totalAmount: totals?.totalAmount,
    notes: body.notes ?? undefined,
    dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
    invoiceDate,
    status,
    invoiceAddress: body.invoiceAddress ?? undefined,
    deliveryAddress: body.deliveryAddress ?? undefined,
    paymentBlocked: body.paymentBlocked !== undefined ? Boolean(body.paymentBlocked) : undefined,
    // A number is assigned when the draft is posted; accept it on update.
    invoiceNumber: body.invoiceNumber ?? body.ref ?? undefined,
  }
  Object.keys(data).forEach(k => data[k] === undefined && delete data[k])
  return data
}

function mapInvoiceItems(lines: any[]) {
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
      }
    }
    const taxCategory = inferInvoiceLineTaxCategory(l.taxCategory ?? l.taxCode, Number(l.taxRate) || 0)
    // A positive numeric rate with no picker value is Kenya standard-rated VAT
    // (PO bills only carry taxRate). 0% + no category stays out of scope.
    const effectiveTaxRate = taxCategory === 'standard_16'
      ? Number(l.taxRate ?? 16)
      : 0
    const money = computeInvoiceLineMoney({
      qty: l.qty,
      unitPrice: l.unitPrice,
      taxRate: effectiveTaxRate,
      discountPct: l.discountPct ?? l.discount,
      subtotal: l.subtotal,
      lineSubtotal: l.lineSubtotal,
    })
    return {
      description: l.description ?? '',
      qty: money.qty || 1,
      unitPrice: money.unitPrice,
      discountPct: money.discountPct,
      taxRate: money.taxRate,
      taxCategory,
      taxCode: taxCategory === 'standard_16' ? 'VAT16' : taxCategory,
      taxableBase: money.lineSubtotal,
      taxClaimEligible: taxCategory === 'standard_16' || taxCategory === 'zero_rated',
      lineSubtotal: money.lineSubtotal,
      lineTax: money.lineTax,
      lineTotal: money.lineTotal,
      sortOrder: index,
      ...(optionalUuid(l.productId) ? { productId: optionalUuid(l.productId) } : {}),
      ...(optionalUuid(l.purchaseOrderItemId ?? l.poItemId) ? { purchaseOrderItemId: optionalUuid(l.purchaseOrderItemId ?? l.poItemId) } : {}),
      ...(optionalUuid(l.grnItemId ?? l.receiptLineId) ? { grnItemId: optionalUuid(l.grnItemId ?? l.receiptLineId) } : {}),
      ...(optionalUuid(l.serialNumberId ?? l.serialId) ? { serialNumberId: optionalUuid(l.serialNumberId ?? l.serialId) } : {}),
    }
  })
}

export async function GET(_: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const { id } = await resolveRouteParams(params)
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { items: true },
    })
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(invoice)
  })
}

export async function PUT(request: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { id } = await resolveRouteParams(params)
    const body = await request.json()
    // Repair authorization is derived from the persisted Repair relation, never
    // from caller-supplied notes/repair-looking references.
    const actor = await requireRole(REPAIR_WRITE_ROLES)
    let lines: any[] | undefined = body.lines ?? body.items ?? undefined
    const clientId = (body.clientId !== undefined || body.partnerId !== undefined)
      ? await resolveClientId(prisma, body.clientId ?? body.partnerId, body)
      : undefined

    const before = await prisma.invoice.findUnique({
      where: { id: id },
      include: { items: true },
    })
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (actor.role === 'technician' && !before.repairId) {
      return NextResponse.json({ error: 'Technicians may only update invoices linked to an actual Repair record' }, { status: 403 })
    }

    const beforeIsPosted = PRISMA_POSTED_INVOICE_STATUSES.has(String(before.status))
    const putDecision = postedInvoicePutDecision({
      prismaStatus: before.status,
      amountPaid: Number(before.amountPaid),
      nextStatus: typeof body.status === 'string' ? body.status : undefined,
      role: actor.role,
    })
    if (putDecision.kind === 'forbidden' || putDecision.kind === 'reject') {
      return NextResponse.json({ error: putDecision.error }, { status: putDecision.status })
    }
    if (putDecision.kind === 'reversal') {
      const lock = await checkFiscalLock(before.invoiceDate)
      if (!lock.ok) {
        return NextResponse.json({ error: lock.error }, { status: lock.status })
      }
      stripPostedInvoiceEconomicFields(body)
      lines = undefined
    } else if (beforeIsPosted) {
      const attemptedEconomicMutation = POSTED_INVOICE_ECONOMIC_PUT_KEYS.some(
        k => Object.prototype.hasOwnProperty.call(body, k),
      )
      const attemptedStatusMutation = body.status !== undefined &&
        (INVOICE_STATUS_MAP[body.status] ?? body.status) !== before.status
      if (attemptedEconomicMutation || attemptedStatusMutation) {
        return NextResponse.json({
          error: 'Posted invoices are immutable. Use a credit/debit note or reversal workflow and issue a replacement document.',
        }, { status: 409 })
      }
    }

    const expectedVersion = readExpectedVersion(body)
    if (lockVersionMismatch(before.lockVersion, expectedVersion)) {
      return NextResponse.json(
        { error: 'Record was modified by another user', lockVersion: before.lockVersion },
        { status: 409 },
      )
    }

    // Never wipe existing line items with an empty payload — empty shells from
    // store sync must not destroy the Prisma ledger.
    if (Array.isArray(lines) && lines.length === 0 && (before?.items?.length ?? 0) > 0) {
      lines = undefined
      delete body.lines
      delete body.items
    }

    const data = mapInvoiceUpdateToDb(body, putDecision.kind === 'reversal' ? undefined : clientId)
    // The official number is assigned when a draft is posted. Once assigned it
    // is immutable — posted invoices can never be renumbered.
    if (data.invoiceNumber !== undefined && before && before.status !== 'draft' && data.invoiceNumber !== before.invoiceNumber) {
      delete data.invoiceNumber
    }
    if (putDecision.kind === 'reversal') {
      data.postingStatus = 'unposted'
      data.postedJournalEntryId = null
    }

    const willBecomePosted = before.status === 'draft'
      && (data.status === 'approved' || data.status === 'invoiced')
    // Resolved Prisma PO id for the vendor-bill path (twin-id safe).
    let vendorPoId: string | null = null
    if (willBecomePosted) {
      const postDate = data.invoiceDate ?? before.invoiceDate ?? new Date()
      const lock = await checkFiscalLock(postDate)
      if (!lock.ok) {
        return NextResponse.json({ error: lock.error }, { status: lock.status })
      }

      // Phase 3: server 3-way match before posting a vendor bill linked to a PO.
      const preMirror = await resolveBlobInvoiceMirror(id)
      const willBeVendor = body.type === 'vendor_bill' || preMirror.type === 'vendor_bill'
      const rawPoId = optionalUuid(body.purchaseOrderId)
        ?? preMirror.purchaseOrderId
        ?? null
      // Resolve blob-only / twin-id POs onto the Prisma record before matching.
      const poId = rawPoId ? (await ensurePrismaPurchaseOrder(rawPoId, actor.id)) ?? rawPoId : null
      vendorPoId = poId
      if (willBeVendor && poId) {
        try {
          const { assertVendorBillThreeWayMatchServer } = await import('@/lib/purchase/assert-bill-match.server')
          const billLines = (lines ?? preMirror.lines ?? before.items).map((l: any) => ({
            purchaseOrderItemId: l?.purchaseOrderItemId ?? l?.poItemId ?? undefined,
            productId: l?.productId ?? undefined,
            qty: Number(l?.qty) || 0,
            description: l?.description,
          }))
          await assertVendorBillThreeWayMatchServer({
            purchaseOrderId: poId,
            billLines,
            excludeBillId: id,
          })
        } catch (err: any) {
          const status = typeof err?.status === 'number' ? err.status : 409
          return NextResponse.json({ error: err?.message || '3-way match failed' }, { status })
        }
      }
    }

    const willPostNow = before.status === 'draft'
      && (data.status === 'approved' || data.status === 'invoiced')

    // Build the canonical journal from server-resolved facts before entering the
    // transaction; persistence itself occurs inside the same DB transaction.
    let postingJournal: Awaited<ReturnType<typeof buildInvoiceJournalInput>> | null = null
    let postingInvoiceType: 'customer_invoice' | 'vendor_bill' = 'customer_invoice'
    let postingPurchaseOrderId: string | null = null
    let postingBillLines: any[] = []
    let postingMirror: Awaited<ReturnType<typeof resolveBlobInvoiceMirror>> | null = null
    if (willPostNow) {
      // Posting assigns the official number. A client-allocated number can
      // collide with an existing document (stale local counters) — the unique
      // invoice_number constraint would otherwise surface as a bare 500.
      const chosenNumber = String(data.invoiceNumber ?? before.invoiceNumber)
      const numberClash = await prisma.invoice.findFirst({
        where: { invoiceNumber: chosenNumber, id: { not: id } },
        select: { id: true },
      })
      if (numberClash) {
        const kind = (body.type === 'vendor_bill' || before.documentType === 'vendor_bill') ? 'vendor_bill' : 'invoice'
        const { getNextDocNumber } = await import('@/lib/doc-ref-counter')
        data.invoiceNumber = await getNextDocNumber(kind)
      }

      // Infer statutory category from taxRate so PO bills and older drafts
      // (taxRate 16, category not_selected) can post. Mapping used to zero
      // VAT on those rows; inferInvoiceLineTaxCategory keeps 16% as standard_16.
      const taxCheckItems = (lines !== undefined ? lines : before.items).map((item: any) => ({
        ...item,
        taxCategory: inferInvoiceLineTaxCategory(item.taxCategory ?? item.taxCode, Number(item.taxRate) || 0),
      }))
      const unresolvedTax = taxCheckItems.some((item: any) => invoiceLineMissingTaxCategory(item))
      if (unresolvedTax) {
        return NextResponse.json({
          error: 'Tax category must be selected on every posting line. A 0% amount is not automatically zero-rated VAT.',
        }, { status: 409 })
      }

      postingMirror = await resolveBlobInvoiceMirror(before.id)
      postingInvoiceType = body.type === 'vendor_bill' || postingMirror.type === 'vendor_bill'
        ? 'vendor_bill'
        : 'customer_invoice'
      const normalizedItems = lines !== undefined
        ? mapInvoiceItems(lines)
        : before.items.map(i => ({
            productId: i.productId ?? undefined,
            qty: Number(i.qty),
            unitPrice: Number(i.unitPrice),
            subtotal: Number(i.lineSubtotal),
            description: i.description,
          }))
      try {
        postingJournal = await buildInvoiceJournalInput({
          id: before.id,
          ref: String(data.invoiceNumber ?? before.invoiceNumber),
          invoiceNumber: String(data.invoiceNumber ?? before.invoiceNumber),
          invoiceDate: data.invoiceDate ?? before.invoiceDate,
          totalAmount: Number(data.totalAmount ?? before.totalAmount),
          subtotal: Number(data.subtotal ?? before.subtotal),
          taxAmount: Number(data.taxAmount ?? before.taxAmount),
          type: postingInvoiceType,
          repairId: before.repairId ?? undefined,
          purchaseOrderId: (postingPurchaseOrderId = vendorPoId ?? optionalUuid(body.purchaseOrderId) ?? postingMirror.purchaseOrderId ?? null) ?? undefined,
          partnerName: postingMirror.partnerName,
          clientName: postingMirror.clientName,
          lines: normalizedItems.map((i: any) => ({
            productId: i.productId ?? undefined,
            qty: Number(i.qty),
            unitPrice: Number(i.unitPrice),
            subtotal: Number(i.lineSubtotal ?? i.subtotal),
            description: i.description,
          })),
        }, { createdById: actor.id })
        postingJournal.ref = await allocateInvoiceJournalRef(postingJournal.ref)
      } catch (err) {
        rethrowInvoicePostingError(err)
      }
      postingBillLines = normalizedItems.map((i: any) => ({
        purchaseOrderItemId: i.purchaseOrderItemId ?? undefined,
        grnItemId: i.grnItemId ?? undefined,
        productId: i.productId ?? undefined,
        qty: Number(i.qty),
        unitPrice: Number(i.unitPrice),
        taxRate: Number(i.taxRate),
        description: i.description,
      }))
    }

    const invoice = await prisma.$transaction(async tx => {
      const claimed = await tx.invoice.updateMany({
        where: { id: id, lockVersion: before.lockVersion },
        data: {
          ...data,
          lockVersion: nextLockVersion(before.lockVersion),
          ...(willPostNow ? { postingStatus: 'posting' } : {}),
        },
      })
      if (claimed.count !== 1) {
        const err = new Error('Record was modified by another user')
        ;(err as Error & { status?: number }).status = 409
        throw err
      }

      if (lines !== undefined) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } })
        const mapped = mapInvoiceItems(lines)
        if (mapped.length) {
          await tx.invoiceItem.createMany({
            data: mapped.map((item: any) => ({ ...item, invoiceId: id })),
          })
        }
      }

      if (postingInvoiceType === 'vendor_bill' && postingPurchaseOrderId) {
        const { assertVendorBillThreeWayMatchInTx } = await import('@/lib/purchase/assert-bill-match.server')
        await assertVendorBillThreeWayMatchInTx(tx, {
          purchaseOrderId: postingPurchaseOrderId,
          vendorId: before.clientId,
          billLines: postingBillLines,
          excludeBillId: id,
        })
      }

      let journalId: string | null = null
      if (postingJournal) {
        const journal = await createJournalEntryInTx(tx, postingJournal).catch(rethrowInvoicePostingError)
        journalId = journal.id
        await tx.invoice.update({
          where: { id },
          data: {
            postingStatus: 'posted',
            postedJournalEntryId: journal.id,
            postedAt: new Date(),
            postedById: actor.id,
            documentType: postingInvoiceType,
          },
        })

        const postedItems = await tx.invoiceItem.findMany({ where: { invoiceId: id } })
        const partner = before.clientId
          ? await tx.client.findUnique({ where: { id: before.clientId }, select: { kraPin: true } })
          : null
        const taxPoint = data.invoiceDate ?? before.invoiceDate ?? new Date()
        for (const item of postedItems) {
          const category = String((item as any).taxCategory || 'not_selected')
          await tx.taxTransaction.upsert({
            where: {
              sourceType_sourceId_sourceLineId: {
                sourceType: postingInvoiceType === 'vendor_bill' ? 'vendor_bill' : 'invoice',
                sourceId: id,
                sourceLineId: item.id,
              },
            },
            update: {
              direction: postingInvoiceType === 'vendor_bill' ? 'input' : 'output',
              taxCategory: category,
              taxRate: item.taxRate,
              taxableBase: (item as any).taxableBase ?? item.lineSubtotal,
              taxAmount: item.lineTax,
              taxPoint,
              taxPeriod: new Date(taxPoint).toISOString().slice(0, 7),
              partnerPin: partner?.kraPin ?? null,
              transmissionStatus: postingInvoiceType === 'vendor_bill' ? 'pending_evidence' : 'pending',
              inputClaimEligible: postingInvoiceType === 'vendor_bill'
                ? Boolean((item as any).taxClaimEligible)
                : false,
              journalEntryId: journal.id,
            },
            create: {
              sourceType: postingInvoiceType === 'vendor_bill' ? 'vendor_bill' : 'invoice',
              sourceId: id,
              sourceLineId: item.id,
              direction: postingInvoiceType === 'vendor_bill' ? 'input' : 'output',
              taxCategory: category,
              taxRate: item.taxRate,
              taxableBase: (item as any).taxableBase ?? item.lineSubtotal,
              taxAmount: item.lineTax,
              taxPoint,
              taxPeriod: new Date(taxPoint).toISOString().slice(0, 7),
              partnerPin: partner?.kraPin ?? null,
              transmissionStatus: postingInvoiceType === 'vendor_bill' ? 'pending_evidence' : 'pending',
              inputClaimEligible: postingInvoiceType === 'vendor_bill'
                ? Boolean((item as any).taxClaimEligible)
                : false,
              journalEntryId: journal.id,
            },
          })
        }
      }

      await writeFinancialAuditInTx(tx, {
        userId: actor.id,
        action: willPostNow ? 'post_invoice' : 'update_invoice',
        entityType: 'invoice',
        entityId: id,
        relatedJournalId: journalId,
        oldValues: { status: before.status, totalAmount: Number(before.totalAmount), amountPaid: Number(before.amountPaid), lockVersion: before.lockVersion },
        newValues: { status: data.status ?? before.status, totalAmount: Number(data.totalAmount ?? before.totalAmount), lockVersion: nextLockVersion(before.lockVersion) },
      })

      return tx.invoice.findUniqueOrThrow({
        where: { id: id },
        include: { items: true },
      })
    }, { isolationLevel: 'Serializable' })

    const mirror = await resolveBlobInvoiceMirror(invoice.id)
    const invoiceType = body.type === 'vendor_bill' || mirror.type === 'vendor_bill'
      ? 'vendor_bill'
      : 'customer_invoice'
    const purchaseOrderId = optionalUuid(body.purchaseOrderId)
      ?? mirror.purchaseOrderId
      ?? undefined

    const becamePosted = willPostNow
    if (becamePosted && invoiceType === 'customer_invoice' && salesCommissionAppliesToInvoice(invoice)) {
      try {
        const { postSalesCommissionForInvoice } = await import('@/lib/accounting/sales-commission')
        await postSalesCommissionForInvoice(invoice.id)
      } catch (err) {
        console.error('[invoice] sales commission calculation failed:', err)
      }
    }

    // Reset draft / unpaid cancel / void → reverse the posting journal in Prisma
    const leftPosted = before
      && PRISMA_POSTED_INVOICE_STATUSES.has(String(before.status))
      && (invoice.status === 'draft' || invoice.status === 'cancelled' || invoice.status === 'voided')
    if (leftPosted && Number(before.amountPaid) <= 0) {
      try {
        const { reverseInvoiceJournalInPrisma } = await import('@/lib/accounting/invoice-journals')
        await reverseInvoiceJournalInPrisma({
          id: invoice.id,
          ref: before.invoiceNumber || invoice.invoiceNumber,
          invoiceNumber: before.invoiceNumber || invoice.invoiceNumber,
        }, actor.id)
      } catch (err) {
        console.error('[invoice] journal reverse failed:', err)
      }
    }

    // Keep the deed_invoices blob aligned with Prisma after Reset to Draft /
    // cancel so a later store sync does not resurrect the posted status.
    if (leftPosted) {
      try {
        const { refreshInvoicesBlob } = await import('@/lib/documents-broadcast.server')
        await refreshInvoicesBlob()
      } catch (err) {
        console.error('[invoice] invoices blob refresh failed:', err)
      }
    }

    // Paid customer invoice cancel → credit liability journal (creditRef from body/notes)
    const paidCancel = before
      && (before.status === 'approved' || before.status === 'invoiced')
      && (invoice.status === 'cancelled' || invoice.status === 'voided')
      && Number(before.amountPaid) > 0
      && invoiceType === 'customer_invoice'
    if (paidCancel) {
      const creditRefMatch = String(body.notes || invoice.notes || '').match(/credit note\s+([A-Z0-9/-]+)/i)
      const creditRef = typeof body.creditRef === 'string' && body.creditRef
        ? body.creditRef
        : creditRefMatch?.[1]
      if (creditRef) {
        try {
          const { postCustomerCreditJournalToPrisma } = await import('@/lib/accounting/invoice-journals')
          await postCustomerCreditJournalToPrisma({
            invoice: {
              id: invoice.id,
              ref: before.invoiceNumber || invoice.invoiceNumber,
              invoiceNumber: before.invoiceNumber || invoice.invoiceNumber,
              totalAmount: Number(before.totalAmount),
              subtotal: Number(before.subtotal),
              taxAmount: Number(before.taxAmount),
              partnerName: mirror.partnerName,
              clientName: mirror.clientName,
              type: 'customer_invoice',
            },
            creditRef,
            amount: Math.min(Number(before.amountPaid), Number(before.totalAmount)),
            createdById: actor.id,
          })
        } catch (err) {
          console.error('[invoice] customer credit journal dual-write failed:', err)
        }
      }
    }

    return NextResponse.json(invoice)
  })
}

export async function PATCH(request: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return PUT(request, { params })
}

// Invoices are financial records and are never hard-deleted — doing so would
// destroy audit history and break GL reconciliation. Instead we transition the
// invoice to a terminal `voided`/`cancelled` status and record who did it.
// A fully-paid invoice cannot be voided; it must be credited/refunded instead.
export async function DELETE(_: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const { id } = await resolveRouteParams(params)

    const invoice = await prisma.invoice.findUnique({ where: { id } })
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    if (Number(invoice.amountPaid) > 0) {
      return NextResponse.json(
        { error: 'Paid invoices cannot be voided. Issue a credit note or refund instead.' },
        { status: 409 },
      )
    }
    if (invoice.status === 'voided' || invoice.status === 'cancelled') {
      return NextResponse.json({ ok: true, invoice })
    }

    const voided = await prisma.invoice.update({
      where: { id },
      data: { status: 'voided' as any },
    })

    if (Number(invoice.amountPaid) <= 0) {
      try {
        const { reverseInvoiceJournalInPrisma } = await import('@/lib/accounting/invoice-journals')
        await reverseInvoiceJournalInPrisma({
          id: invoice.id,
          ref: invoice.invoiceNumber,
          invoiceNumber: invoice.invoiceNumber,
        }, actor.id)
      } catch (err) {
        console.error('[invoice] void journal reverse failed:', err)
      }
    }

    await writeFinancialAudit({
      userId: actor.id,
      action: 'void_invoice',
      entityType: 'invoice',
      entityId: invoice.id,
      oldValues: { status: invoice.status, totalAmount: invoice.totalAmount },
      newValues: { status: 'voided' },
    })

    return NextResponse.json({ ok: true, invoice: voided })
  })
}
