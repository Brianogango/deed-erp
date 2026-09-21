import 'server-only'

import prisma from '@/lib/prisma'
import { publishNotificationEvent } from './service'
import { defaultNotificationPolicy } from './registry'
import { runIntegritySuite } from '@/lib/accounting/integrity-suite'

const DAY = 86_400_000
const HOUR = 3_600_000
const now = () => new Date()
const plusDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY)
const minusDays = (date: Date, days: number) => new Date(date.getTime() - days * DAY)
const dateOnly = (date: Date) => date.toISOString().slice(0, 10)

async function publishCondition(input: Parameters<typeof publishNotificationEvent>[0] & { stateVersion?: string | Date | null }) {
  if (input.entityType && input.entityId) {
    const open = await prisma.notificationEvent.findFirst({
      where: {
        eventType: input.eventType,
        entityType: input.entityType,
        entityId: input.entityId,
        resolvedAt: null,
      },
      select: { id: true },
    })
    if (open) return false

    const policy = defaultNotificationPolicy(input.eventType)
    if (policy.cooldownHours) {
      const cooldownCutoff = new Date(Date.now() - policy.cooldownHours * HOUR)
      const recent = await prisma.notificationEvent.findFirst({
        where: {
          eventType: input.eventType,
          entityType: input.entityType,
          entityId: input.entityId,
          createdAt: { gte: cooldownCutoff },
        },
        select: { id: true },
      })
      if (recent) return false
    }
  }
  const stateVersion = input.stateVersion instanceof Date
    ? input.stateVersion.toISOString()
    : String(input.stateVersion || dateOnly(now()))
  await publishNotificationEvent({
    ...input,
    idempotencyKey: input.idempotencyKey || `condition:${input.eventType}:${input.entityType || 'global'}:${input.entityId || 'global'}:${stateVersion}`,
  })
  return true
}

async function resolveInactive(eventType: string, entityType: string, activeIds: string[]) {
  const where: any = {
    eventType,
    entityType,
    resolvedAt: null,
    ...(activeIds.length ? { entityId: { notIn: activeIds } } : {}),
  }
  const open = await prisma.notificationEvent.findMany({ where, select: { id: true } })
  if (!open.length) return 0
  const ids = open.map(row => row.id)
  const resolvedAt = new Date()
  await prisma.$transaction([
    prisma.notificationEvent.updateMany({ where: { id: { in: ids } }, data: { resolvedAt } }),
    prisma.notificationRecipient.updateMany({ where: { eventId: { in: ids }, resolvedAt: null }, data: { resolvedAt } }),
  ])
  return ids.length
}

async function scanCrm() {
  const current = now()
  const opportunities = await prisma.opportunity.findMany({
    where: { stage: { notIn: ['won', 'lost', 'closed', 'cancelled'] } },
    select: {
      id: true, name: true, stage: true, closeDate: true, updatedAt: true,
      assignedToId: true, createdById: true,
    },
  })

  const staleIds: string[] = []
  const closeIds: string[] = []
  let emitted = 0
  for (const opp of opportunities) {
    const users = [opp.assignedToId, opp.createdById].filter(Boolean) as string[]
    if (opp.updatedAt <= minusDays(current, 7)) {
      staleIds.push(opp.id)
      if (await publishCondition({
        eventType: 'crm.opportunity.stale',
        entityType: 'opportunity',
        entityId: opp.id,
        userIds: users,
        title: `Opportunity needs follow-up: ${opp.name}`,
        body: `No update has been recorded on this opportunity for at least 7 days.`,
        actionUrl: `/crm?opportunity=${opp.id}`,
        idempotencyKey: '',
        stateVersion: opp.updatedAt,
      })) emitted++
    }
    if (opp.closeDate && opp.closeDate >= current && opp.closeDate <= plusDays(current, 2)) {
      closeIds.push(opp.id)
      if (await publishCondition({
        eventType: 'crm.opportunity.close_due',
        entityType: 'opportunity',
        entityId: opp.id,
        userIds: users,
        title: `Opportunity close date approaching: ${opp.name}`,
        body: `Expected close date is ${dateOnly(opp.closeDate)}.`,
        actionUrl: `/crm?opportunity=${opp.id}`,
        idempotencyKey: '',
        stateVersion: opp.closeDate,
      })) emitted++
    }
  }
  await resolveInactive('crm.opportunity.stale', 'opportunity', staleIds)
  await resolveInactive('crm.opportunity.close_due', 'opportunity', closeIds)

  const approvalQuotes = await prisma.quote.findMany({
    where: { status: 'pending_approval' },
    select: { id: true, quoteNumber: true, assignedToId: true, createdById: true, updatedAt: true },
  })
  const approvalIds = approvalQuotes.map(q => q.id)
  for (const quote of approvalQuotes) {
    if (await publishCondition({
      eventType: 'sales.quote.approval_required',
      entityType: 'quote',
      entityId: quote.id,
      userIds: [quote.assignedToId, quote.createdById],
      title: `Quotation approval required — ${quote.quoteNumber}`,
      body: `Quotation ${quote.quoteNumber} is awaiting approval.`,
      actionUrl: `/sales?quote=${quote.id}`,
      idempotencyKey: '',
      stateVersion: quote.updatedAt,
    })) emitted++
  }
  await resolveInactive('sales.quote.approval_required', 'quote', approvalIds)

  const expiring = await prisma.quote.findMany({
    where: {
      validUntil: { gte: current, lte: plusDays(current, 3) },
      status: { in: ['approved'] },
    },
    select: { id: true, quoteNumber: true, validUntil: true, assignedToId: true, createdById: true, updatedAt: true },
  })
  const expiringIds = expiring.map(q => q.id)
  for (const quote of expiring) {
    if (await publishCondition({
      eventType: 'sales.quote.expiring',
      entityType: 'quote',
      entityId: quote.id,
      userIds: [quote.assignedToId, quote.createdById],
      title: `Quotation expiring — ${quote.quoteNumber}`,
      body: `Quotation ${quote.quoteNumber} expires on ${quote.validUntil ? dateOnly(quote.validUntil) : 'soon'}.`,
      actionUrl: `/sales?quote=${quote.id}`,
      idempotencyKey: '',
      stateVersion: quote.validUntil || quote.updatedAt,
    })) emitted++
  }
  await resolveInactive('sales.quote.expiring', 'quote', expiringIds)
  return emitted
}

async function scanRepairs() {
  const current = now()
  let emitted = 0
  const activeStatuses = ['intake', 'diagnosis', 'awaiting_parts', 'in_repair', 'qc', 'ready'] as any

  const repairs = await prisma.repair.findMany({
    where: { status: { in: activeStatuses } },
    include: { client: { select: { name: true, email: true, phone: true, phoneAlt: true } } },
  })

  const unassignedIds: string[] = []
  const diagnosisIds: string[] = []
  const slaIds: string[] = []
  const readyIds: string[] = []
  const uncollectedIds: string[] = []

  for (const repair of repairs) {
    const ref = repair.jobNumber
    if (!repair.assignedToId && ['intake', 'diagnosis'].includes(String(repair.status))) {
      unassignedIds.push(repair.id)
      if (await publishCondition({
        eventType: 'repair.unassigned',
        entityType: 'repair',
        entityId: repair.id,
        title: `Unassigned repair — ${ref}`,
        body: `${repair.deviceBrand || ''} ${repair.deviceModel || repair.deviceType} requires technician assignment.`.trim(),
        actionUrl: `/repairs?id=${repair.id}`,
        idempotencyKey: '',
        stateVersion: repair.createdAt,
      })) emitted++
    }

    if (String(repair.status) === 'diagnosis' && repair.intakeDate <= minusDays(current, 2)) {
      diagnosisIds.push(repair.id)
      if (await publishCondition({
        eventType: 'repair.diagnosis_overdue',
        entityType: 'repair',
        entityId: repair.id,
        userIds: [repair.assignedToId],
        title: `Diagnosis overdue — ${ref}`,
        body: `This repair has remained in diagnosis for more than 48 hours.`,
        actionUrl: `/repairs?id=${repair.id}`,
        idempotencyKey: '',
        stateVersion: repair.updatedAt,
      })) emitted++
    }

    if (repair.promisedDate && repair.promisedDate < current && !['ready', 'collected', 'verified_released'].includes(String(repair.status))) {
      slaIds.push(repair.id)
      if (await publishCondition({
        eventType: 'repair.sla_breach',
        entityType: 'repair',
        entityId: repair.id,
        userIds: [repair.assignedToId],
        title: `Repair SLA breached — ${ref}`,
        body: `Promised date ${dateOnly(repair.promisedDate)} has passed. Current stage: ${String(repair.status).replaceAll('_', ' ')}.`,
        actionUrl: `/repairs?id=${repair.id}`,
        idempotencyKey: '',
        stateVersion: repair.promisedDate,
      })) emitted++
    }

    if (String(repair.status) === 'ready') {
      readyIds.push(repair.id)
      if (await publishCondition({
        eventType: 'repair.ready',
        entityType: 'repair',
        entityId: repair.id,
        externalRecipients: [{
          name: repair.client.name,
          email: repair.client.email,
          phone: repair.client.phone || repair.client.phoneAlt,
          channels: ['email', 'whatsapp', 'sms'],
        }],
        title: `Your repair ${ref} is ready`,
        body: `Hello ${repair.client.name}, your ${repair.deviceBrand || ''} ${repair.deviceModel || repair.deviceType} is ready. Please contact Deed Technologies to arrange collection.`.trim(),
        actionUrl: `/portal/repair/${encodeURIComponent(ref)}`,
        idempotencyKey: '',
        stateVersion: repair.updatedAt,
      })) emitted++

      const readySince = repair.completedDate || repair.updatedAt
      if (readySince <= minusDays(current, 3)) {
        uncollectedIds.push(repair.id)
        if (await publishCondition({
          eventType: 'repair.uncollected',
          entityType: 'repair',
          entityId: repair.id,
          externalRecipients: [{
            name: repair.client.name,
            email: repair.client.email,
            phone: repair.client.phone || repair.client.phoneAlt,
            channels: ['email', 'whatsapp', 'sms'],
          }],
          title: `Repair awaiting collection — ${ref}`,
          body: `Your device has been ready for collection for more than 3 days. Please contact Deed Technologies to arrange collection.`,
          actionUrl: `/portal/repair/${encodeURIComponent(ref)}`,
          idempotencyKey: '',
          stateVersion: readySince,
        })) emitted++
      }
    }
  }

  await resolveInactive('repair.unassigned', 'repair', unassignedIds)
  await resolveInactive('repair.diagnosis_overdue', 'repair', diagnosisIds)
  await resolveInactive('repair.sla_breach', 'repair', slaIds)
  await resolveInactive('repair.ready', 'repair', readyIds)
  await resolveInactive('repair.uncollected', 'repair', uncollectedIds)
  return emitted
}

async function scanPurchasing() {
  const current = now()
  let emitted = 0

  const approval = await prisma.purchaseOrder.findMany({
    where: { status: 'sent', approvedAt: null },
    select: { id: true, poNumber: true, createdById: true, updatedAt: true },
  })
  for (const po of approval) {
    if (await publishCondition({
      eventType: 'purchase.po_approval_required',
      entityType: 'purchase_order',
      entityId: po.id,
      userIds: [po.createdById],
      title: `Purchase order approval required — ${po.poNumber}`,
      body: `Purchase order ${po.poNumber} is awaiting approval.`,
      actionUrl: `/purchase?po=${po.id}`,
      idempotencyKey: '',
      stateVersion: po.updatedAt,
    })) emitted++
  }
  await resolveInactive('purchase.po_approval_required', 'purchase_order', approval.map(p => p.id))

  const overdue = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: ['confirmed', 'partial'] },
      expectedDate: { lt: current },
    },
    select: { id: true, poNumber: true, expectedDate: true, createdById: true, updatedAt: true },
  })
  for (const po of overdue) {
    if (await publishCondition({
      eventType: 'purchase.po_overdue',
      entityType: 'purchase_order',
      entityId: po.id,
      userIds: [po.createdById],
      title: `Purchase order overdue — ${po.poNumber}`,
      body: `Expected receipt date ${po.expectedDate ? dateOnly(po.expectedDate) : 'has passed'}.`,
      actionUrl: `/purchase?po=${po.id}`,
      idempotencyKey: '',
      stateVersion: po.expectedDate || po.updatedAt,
    })) emitted++
  }
  await resolveInactive('purchase.po_overdue', 'purchase_order', overdue.map(p => p.id))

  const grns = await prisma.goodsReceivedNote.findMany({
    where: { po: { status: { not: 'received' } } },
    select: { id: true, grnNumber: true, createdById: true, createdAt: true },
    take: 100,
    orderBy: { createdAt: 'desc' },
  })
  for (const grn of grns) {
    if (await publishCondition({
      eventType: 'purchase.grn_validation_required',
      entityType: 'grn',
      entityId: grn.id,
      userIds: [grn.createdById],
      title: `Receipt review required — ${grn.grnNumber}`,
      body: `Goods receipt ${grn.grnNumber} has been recorded while its purchase order is not yet fully received.`,
      actionUrl: `/purchase?receipt=${grn.id}`,
      idempotencyKey: '',
      stateVersion: grn.createdAt,
    })) emitted++
  }
  await resolveInactive('purchase.grn_validation_required', 'grn', grns.map(g => g.id))

  const vendorBills = await prisma.invoice.findMany({
    where: {
      documentType: 'vendor_bill',
      postingStatus: 'posted',
      dueDate: { not: null },
    },
    select: {
      id: true, invoiceNumber: true, dueDate: true, totalAmount: true, amountPaid: true,
      paymentBlocked: true, updatedAt: true,
    },
  })
  const dueIds: string[] = []
  const blockedIds: string[] = []
  for (const bill of vendorBills) {
    const balance = Number(bill.totalAmount) - Number(bill.amountPaid)
    if (balance <= 0.01) continue
    if (bill.paymentBlocked) {
      blockedIds.push(bill.id)
      if (await publishCondition({
        eventType: 'purchase.vendor_bill_blocked',
        entityType: 'invoice',
        entityId: bill.id,
        title: `Vendor bill blocked — ${bill.invoiceNumber}`,
        body: `Vendor bill ${bill.invoiceNumber} is blocked with KES ${Math.round(balance).toLocaleString('en-KE')} outstanding.`,
        actionUrl: `/accounting?invoice=${bill.id}`,
        idempotencyKey: '',
        stateVersion: bill.updatedAt,
      })) emitted++
    }
    if (bill.dueDate && bill.dueDate <= plusDays(current, 3)) {
      dueIds.push(bill.id)
      if (await publishCondition({
        eventType: 'purchase.vendor_bill_due',
        entityType: 'invoice',
        entityId: bill.id,
        title: `Vendor bill due — ${bill.invoiceNumber}`,
        body: `KES ${Math.round(balance).toLocaleString('en-KE')} is due by ${dateOnly(bill.dueDate)}.`,
        actionUrl: `/accounting?invoice=${bill.id}`,
        idempotencyKey: '',
        stateVersion: bill.dueDate,
      })) emitted++
    }
  }
  await resolveInactive('purchase.vendor_bill_blocked', 'invoice', blockedIds)
  await resolveInactive('purchase.vendor_bill_due', 'invoice', dueIds)
  return emitted
}

async function scanInventory() {
  let emitted = 0
  const products = await prisma.product.findMany({
    where: { isActive: true, trackStock: true },
    select: {
      id: true, sku: true, name: true, reorderLevel: true, updatedAt: true,
      stockLevel: { select: { qtyOnHand: true, updatedAt: true } },
      productValuation: { select: { totalQty: true, totalValue: true, lastUpdated: true } },
    },
  })

  const lowIds: string[] = []
  const valuationIds: string[] = []
  for (const product of products) {
    const level = product.stockLevel?.qtyOnHand ?? 0
    const reorder = product.reorderLevel ?? 0
    if (level <= reorder) {
      lowIds.push(product.id)
      if (await publishCondition({
        eventType: 'inventory.low_stock',
        entityType: 'product',
        entityId: product.id,
        title: `Low stock — ${product.name}`,
        body: `${product.sku}: ${level} on hand; reorder level is ${reorder}.`,
        actionUrl: `/inventory?product=${product.id}`,
        idempotencyKey: '',
        stateVersion: product.stockLevel?.updatedAt || product.updatedAt,
      })) emitted++
    }

    if (product.productValuation && product.stockLevel &&
        Number(product.productValuation.totalQty) !== Number(product.stockLevel.qtyOnHand)) {
      valuationIds.push(product.id)
      if (await publishCondition({
        eventType: 'inventory.valuation_exception',
        entityType: 'product',
        entityId: product.id,
        title: `Inventory valuation mismatch — ${product.name}`,
        body: `Stock ledger shows ${product.stockLevel.qtyOnHand} units while valuation shows ${product.productValuation.totalQty} units.`,
        actionUrl: `/accounting?tab=integrity`,
        idempotencyKey: '',
        stateVersion: product.productValuation.lastUpdated,
      })) emitted++
    }
  }
  await resolveInactive('inventory.low_stock', 'product', lowIds)
  await resolveInactive('inventory.valuation_exception', 'product', valuationIds)
  return emitted
}

async function scanDelivery() {
  const current = now()
  let emitted = 0
  const rows = await prisma.deliveryNote.findMany({
    where: { status: { notIn: ['cancelled'] } },
    include: { client: { select: { name: true, email: true, phone: true, phoneAlt: true } } },
  })
  const dispatchedIds: string[] = []
  const failedIds: string[] = []
  const overdueIds: string[] = []
  const podIds: string[] = []

  for (const row of rows) {
    const status = String(row.status).toLowerCase()
    const recipient = {
      name: row.customerName || row.client?.name || 'Customer',
      email: row.client?.email || null,
      phone: row.recipientPhone || row.client?.phone || row.client?.phoneAlt || null,
      channels: ['email', 'whatsapp', 'sms'] as const,
    }
    if (status === 'dispatched') {
      dispatchedIds.push(row.id)
      if (await publishCondition({
        eventType: 'delivery.dispatched',
        entityType: 'delivery',
        entityId: row.id,
        externalRecipients: [recipient as any],
        title: `Delivery dispatched — ${row.dnNumber}`,
        body: `Your delivery ${row.dnNumber} has been dispatched.${row.trackingNumber ? ` Tracking: ${row.trackingNumber}.` : ''}`,
        actionUrl: null,
        idempotencyKey: '',
        stateVersion: row.updatedAt,
      })) emitted++
    }
    if (['failed', 'exception'].includes(status)) {
      failedIds.push(row.id)
      if (await publishCondition({
        eventType: 'delivery.failed',
        entityType: 'delivery',
        entityId: row.id,
        title: `Delivery failed — ${row.dnNumber}`,
        body: `Delivery ${row.dnNumber} is in status “${row.status}” and requires action.`,
        actionUrl: `/delivery?id=${row.id}`,
        idempotencyKey: '',
        stateVersion: row.updatedAt,
      })) emitted++
    }
    if (row.deliveryDate && row.deliveryDate < current && !['delivered', 'completed'].includes(status)) {
      overdueIds.push(row.id)
      if (await publishCondition({
        eventType: 'delivery.overdue',
        entityType: 'delivery',
        entityId: row.id,
        title: `Delivery overdue — ${row.dnNumber}`,
        body: `Planned delivery date ${dateOnly(row.deliveryDate)} has passed.`,
        actionUrl: `/delivery?id=${row.id}`,
        idempotencyKey: '',
        stateVersion: row.deliveryDate,
      })) emitted++
    }
    if (['delivered', 'completed'].includes(status) && !row.signatureUrl) {
      podIds.push(row.id)
      if (await publishCondition({
        eventType: 'delivery.pod_missing',
        entityType: 'delivery',
        entityId: row.id,
        title: `Proof of delivery missing — ${row.dnNumber}`,
        body: `Delivery is marked complete but no recipient signature/proof is attached.`,
        actionUrl: `/delivery?id=${row.id}`,
        idempotencyKey: '',
        stateVersion: row.updatedAt,
      })) emitted++
    }
  }

  await resolveInactive('delivery.dispatched', 'delivery', dispatchedIds)
  await resolveInactive('delivery.failed', 'delivery', failedIds)
  await resolveInactive('delivery.overdue', 'delivery', overdueIds)
  await resolveInactive('delivery.pod_missing', 'delivery', podIds)
  return emitted
}

async function scanFinance() {
  const current = now()
  let emitted = 0
  const invoices = await prisma.invoice.findMany({
    where: { postingStatus: 'posted' },
    select: {
      id: true, invoiceNumber: true, documentType: true, dueDate: true,
      totalAmount: true, amountPaid: true, updatedAt: true,
      etimsTransmissionStatus: true, invoiceDate: true,
    },
  })
  const overdueIds: string[] = []
  const allocationIds: string[] = []
  const vatIds: string[] = []

  for (const inv of invoices) {
    const total = Number(inv.totalAmount)
    const paid = Number(inv.amountPaid)
    const balance = total - paid
    if (inv.documentType === 'customer_invoice' && inv.dueDate && inv.dueDate < current && balance > 0.01) {
      overdueIds.push(inv.id)
      if (await publishCondition({
        eventType: 'finance.invoice_overdue',
        entityType: 'invoice',
        entityId: inv.id,
        title: `Invoice overdue — ${inv.invoiceNumber}`,
        body: `KES ${Math.round(balance).toLocaleString('en-KE')} remains outstanding after the due date ${dateOnly(inv.dueDate)}.`,
        actionUrl: `/accounting?invoice=${inv.id}`,
        idempotencyKey: '',
        stateVersion: inv.updatedAt,
      })) emitted++
    }
    if (paid > total + 0.01 || paid < -0.01) {
      allocationIds.push(inv.id)
      if (await publishCondition({
        eventType: 'finance.payment_allocation_exception',
        entityType: 'invoice',
        entityId: inv.id,
        title: `Payment allocation exception — ${inv.invoiceNumber}`,
        body: `Invoice total is KES ${Math.round(total).toLocaleString('en-KE')} but recorded paid amount is KES ${Math.round(paid).toLocaleString('en-KE')}.`,
        actionUrl: `/accounting?invoice=${inv.id}`,
        idempotencyKey: '',
        stateVersion: inv.updatedAt,
      })) emitted++
    }
    if (['failed', 'error'].includes(String(inv.etimsTransmissionStatus).toLowerCase())) {
      vatIds.push(inv.id)
      if (await publishCondition({
        eventType: 'finance.vat_exception',
        entityType: 'invoice',
        entityId: inv.id,
        title: `eTIMS transmission exception — ${inv.invoiceNumber}`,
        body: `Invoice ${inv.invoiceNumber} has eTIMS status “${inv.etimsTransmissionStatus}”.`,
        actionUrl: '/accounting?tab=vat',
        idempotencyKey: '',
        stateVersion: inv.updatedAt,
      })) emitted++
    }
  }
  await resolveInactive('finance.invoice_overdue', 'invoice', overdueIds)
  await resolveInactive('finance.payment_allocation_exception', 'invoice', allocationIds)
  await resolveInactive('finance.vat_exception', 'invoice', vatIds)

  const unreconciled = await prisma.bankStatementLine.aggregate({
    where: {
      reconciliationStatus: 'unreconciled',
      transactionDate: { lte: minusDays(current, 3) },
    },
    _count: true,
    _sum: { amount: true },
  })
  if (unreconciled._count > 0) {
    if (await publishCondition({
      eventType: 'finance.bank_reconciliation_exception',
      entityType: 'bank_reconciliation',
      entityId: 'unreconciled',
      title: 'Bank reconciliation items require attention',
      body: `${unreconciled._count} bank statement item(s) have remained unreconciled for more than 3 days.`,
      actionUrl: '/accounting?tab=cashbook',
      idempotencyKey: '',
      stateVersion: dateOnly(current),
    })) emitted++
  } else {
    await resolveInactive('finance.bank_reconciliation_exception', 'bank_reconciliation', [])
  }

  try {
    const integrity = await runIntegritySuite(dateOnly(current))
    if (!integrity.allPassed) {
      if (await publishCondition({
        eventType: 'finance.integrity_failure',
        entityType: 'finance_integrity',
        entityId: 'current',
        title: 'Finance integrity controls failing',
        body: `${integrity.failedCount} of ${integrity.gates.length} finance integrity controls are failing.`,
        actionUrl: '/accounting?tab=integrity',
        idempotencyKey: '',
        stateVersion: dateOnly(current),
        metadata: {
          failedGates: integrity.gates.filter(g => !g.passed).map(g => ({ id: g.id, name: g.name, detail: g.detail })),
        },
      })) emitted++
    } else {
      await resolveInactive('finance.integrity_failure', 'finance_integrity', [])
    }
  } catch (error) {
    console.error('[notifications] finance integrity scan failed', error)
  }

  const lastDay = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate()
  if (current.getUTCDate() >= lastDay - 2) {
    await publishNotificationEvent({
      eventType: 'finance.month_end_action',
      entityType: 'accounting_period',
      entityId: current.toISOString().slice(0, 7),
      title: 'Month-end close actions due',
      body: 'Review bank reconciliation, receivables/payables, VAT/eTIMS, inventory valuation and finance integrity before period close.',
      actionUrl: '/accounting',
      idempotencyKey: `finance-month-end:${current.toISOString().slice(0, 7)}`,
    })
  }

  return emitted
}

function nairobiClock() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const pick = (type: string) => parts.find(p => p.type === type)?.value || ''
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    weekday: pick('weekday'),
    hour: Number(pick('hour') || 0),
  }
}

async function scanHr() {
  const current = now()
  let emitted = 0
  const contracts = await prisma.employee.findMany({
    where: { isActive: true, endDate: { gte: current, lte: plusDays(current, 30) } },
    select: { id: true, firstName: true, lastName: true, endDate: true, updatedAt: true },
  })
  for (const emp of contracts) {
    if (await publishCondition({
      eventType: 'hr.contract.expiring',
      entityType: 'employee',
      entityId: emp.id,
      title: `Employment end date approaching — ${emp.firstName} ${emp.lastName}`,
      body: `Employment end date is ${emp.endDate ? dateOnly(emp.endDate) : 'within 30 days'}.`,
      actionUrl: `/hr?employee=${emp.id}`,
      idempotencyKey: '',
      stateVersion: emp.endDate || emp.updatedAt,
    })) emitted++
  }
  await resolveInactive('hr.contract.expiring', 'employee', contracts.map(e => e.id))

  const payroll = await prisma.payrollRun.findMany({
    where: { status: 'pending_approval', approvedAt: null },
    select: { id: true, runReference: true, createdById: true, createdAt: true },
  })
  for (const run of payroll) {
    if (await publishCondition({
      eventType: 'hr.payroll.approval_required',
      entityType: 'payroll_run',
      entityId: run.id,
      userIds: [run.createdById],
      title: `Payroll approval required — ${run.runReference}`,
      body: `Payroll run ${run.runReference} is waiting for approval.`,
      actionUrl: `/hr?tab=payroll&run=${run.id}`,
      idempotencyKey: '',
      stateVersion: run.createdAt,
    })) emitted++
  }
  await resolveInactive('hr.payroll.approval_required', 'payroll_run', payroll.map(p => p.id))

  const clock = nairobiClock()
  if (['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(clock.weekday) && clock.hour >= 10) {
    const workDate = new Date(`${clock.date}T00:00:00.000Z`)
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: {
        id: true, firstName: true, lastName: true,
        user: { select: { id: true } },
        attendance: { where: { workDate }, select: { id: true } },
      },
    })
    const missing = employees.filter(emp => emp.attendance.length === 0 && emp.user?.id)
    for (const emp of missing) {
      if (await publishCondition({
        eventType: 'hr.attendance.missing',
        entityType: 'employee_attendance',
        entityId: `${emp.id}:${clock.date}`,
        userIds: [emp.user?.id],
        title: 'Attendance record missing',
        body: `No attendance record is present for ${clock.date}. If you are working today, please complete the required attendance process.`,
        actionUrl: '/hr?tab=self_service',
        idempotencyKey: '',
        stateVersion: clock.date,
      })) emitted++
    }
  }
  return emitted
}

async function scanAftersales() {
  const current = now()
  let emitted = 0
  const assets = await prisma.customerAsset.findMany({
    where: {
      status: 'active',
      warrantyEnd: { gte: current, lte: plusDays(current, 30) },
    },
    include: {
      customer: { select: { name: true, email: true, phone: true, phoneAlt: true } },
      product: { select: { name: true } },
    },
  })
  for (const asset of assets) {
    if (await publishCondition({
      eventType: 'aftersales.warranty.expiring',
      entityType: 'customer_asset',
      entityId: asset.id,
      externalRecipients: [{
        name: asset.customer.name,
        email: asset.customer.email,
        phone: asset.customer.phone || asset.customer.phoneAlt,
        channels: ['email', 'whatsapp', 'sms'],
      }],
      title: `Warranty expiring — ${asset.product.name}`,
      body: `The warranty for ${asset.product.name}${asset.serialNumber ? ` (S/N ${asset.serialNumber})` : ''} expires on ${asset.warrantyEnd ? dateOnly(asset.warrantyEnd) : 'soon'}.`,
      actionUrl: null,
      idempotencyKey: '',
      stateVersion: asset.warrantyEnd,
    })) emitted++
  }
  await resolveInactive('aftersales.warranty.expiring', 'customer_asset', assets.map(a => a.id))
  return emitted
}

async function safeDomain(name: string, fn: () => Promise<number>) {
  try {
    return { name, emitted: await fn(), ok: true }
  } catch (error) {
    console.error(`[notifications] ${name} scan failed`, error)
    return { name, emitted: 0, ok: false, error: error instanceof Error ? error.message : 'scan_failed' }
  }
}

export async function scanOperationalNotificationEvents() {
  const results = []
  for (const [name, fn] of [
    ['crm', scanCrm],
    ['repairs', scanRepairs],
    ['purchasing', scanPurchasing],
    ['inventory', scanInventory],
    ['delivery', scanDelivery],
    ['finance', scanFinance],
    ['hr', scanHr],
    ['aftersales', scanAftersales],
  ] as const) {
    results.push(await safeDomain(name, fn))
  }
  return {
    scannedAt: new Date().toISOString(),
    emitted: results.reduce((sum, row) => sum + row.emitted, 0),
    domains: results,
  }
}
