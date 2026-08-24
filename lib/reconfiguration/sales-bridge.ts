/**
 * Sale-order ↔ reconfiguration helpers.
 *
 * Sales no longer auto-creates work orders or blocks delivery. Workshop
 * owns reconfiguration from the Reconfiguration module. These helpers stay
 * for optional /api/sale-orders/:id/reconfiguration and for refreshing the
 * host line description after completeWorkOrder.
 *
 * Specs + inventory change only inside completeWorkOrder.
 */

import 'server-only'
import prisma from '@/lib/prisma'
import {
  applyTargetToWorkOrder,
  createReconfiguration,
  getDeviceConfiguration,
  getWorkOrder,
} from '@/lib/reconfiguration/service'
import {
  mergeEffectsIntoTarget,
  parseProductReconfigEffect,
  type ProductReconfigEffect,
} from '@/lib/reconfiguration/product-effect'
import { specsFromProposed } from '@/lib/reconfiguration/diff-engine'
import {
  applyUnitNameToLineDescription,
  cleanUnitDisplayName,
} from '@/lib/reconfiguration/unit-selling-name'
import { isMutableDraftStatus } from '@/lib/reconfiguration/state-machine'

const TERMINAL = new Set(['completed', 'cancelled', 'reversed'])

export type SaleOrderReconfigLink = {
  saleOrderId: string
  hostSerialId: string
  hostProductId: string | null
  hostLineId: string | null
  effects: ProductReconfigEffect[]
  target: ReturnType<typeof mergeEffectsIntoTarget>
  workOrder: { id: string; ref: string; status: string } | null
  deliveryBlocked: boolean
  message: string
}

async function loadProductMap(productIds: string[]) {
  const ids = [...new Set(productIds.filter(Boolean))]
  if (!ids.length) return new Map<string, { id: string; name: string; specs: unknown; trackingMethod: string | null }>()
  const rows = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, specs: true, trackingMethod: true },
  })
  return new Map(rows.map(r => [r.id, r]))
}

/**
 * Identify the host device line (serialized) and reconfig-effect component lines.
 */
export async function analyzeSaleOrderReconfig(saleOrderId: string): Promise<SaleOrderReconfigLink | null> {
  const order = await prisma.saleOrder.findUnique({
    where: { id: saleOrderId },
    include: { items: true },
  })
  if (!order) return null

  const products = await loadProductMap(order.items.map(i => i.productId).filter(Boolean) as string[])

  const hostItem = order.items.find(item => {
    if (!item.serialNumberId || !item.productId) return false
    const p = products.get(item.productId)
    // Host = serial-tracked product that is NOT itself a reconfig effect part
    if (!p) return Boolean(item.serialNumberId)
    const effect = parseProductReconfigEffect(p)
    if (effect) return false
    const tracking = String(p.trackingMethod || '').toUpperCase()
    return tracking === 'SERIAL' || Boolean(item.serialNumberId)
  })

  if (!hostItem?.serialNumberId) {
    // Effects without a host serial — nothing to bridge yet
    const effectsOnly = order.items
      .map(item => {
        if (!item.productId) return null
        const p = products.get(item.productId)
        return p ? parseProductReconfigEffect(p) : null
      })
      .filter(Boolean) as ProductReconfigEffect[]
    if (!effectsOnly.length) return null
    return {
      saleOrderId,
      hostSerialId: '',
      hostProductId: null,
      hostLineId: null,
      effects: effectsOnly,
      target: null,
      workOrder: null,
      deliveryBlocked: false,
      message: 'Reconfiguration parts are on the order, but no serialized host device is assigned yet. Assign a device serial to create the work order.',
    }
  }

  const effects = order.items
    .filter(item => item.id !== hostItem.id && item.productId)
    .map(item => {
      const p = products.get(item.productId!)
      return p ? parseProductReconfigEffect(p) : null
    })
    .filter(Boolean) as ProductReconfigEffect[]

  const linkedWo = await prisma.reconfigurationWorkOrder.findFirst({
    where: {
      linkedSaleOrderId: saleOrderId,
      serialId: hostItem.serialNumberId,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, ref: true, status: true, linkedSaleOrderId: true },
  })
  const openOnSerial = await prisma.reconfigurationWorkOrder.findFirst({
    where: {
      serialId: hostItem.serialNumberId,
      status: { notIn: [...TERMINAL] as any },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, ref: true, status: true, linkedSaleOrderId: true },
  })
  const activeWo = (openOnSerial && !TERMINAL.has(openOnSerial.status))
    ? openOnSerial
    : linkedWo
  const open = activeWo && !TERMINAL.has(activeWo.status) ? activeWo : null
  const completedLinked = linkedWo?.status === 'completed' ? linkedWo : null

  if (!effects.length) {
    return {
      saleOrderId,
      hostSerialId: hostItem.serialNumberId,
      hostProductId: hostItem.productId,
      hostLineId: hostItem.id,
      effects: [],
      target: null,
      workOrder: open || completedLinked,
      deliveryBlocked: Boolean(open),
      message: open
        ? `Linked reconfiguration ${open.ref} is still ${open.status.replace(/_/g, ' ')}. Complete or cancel it before delivery.`
        : 'No RAM/SSD reconfiguration lines on this order.',
    }
  }

  let device
  try {
    device = await getDeviceConfiguration(hostItem.serialNumberId)
  } catch (err: any) {
    return {
      saleOrderId,
      hostSerialId: hostItem.serialNumberId,
      hostProductId: hostItem.productId,
      hostLineId: hostItem.id,
      effects,
      target: null,
      workOrder: open || completedLinked,
      deliveryBlocked: !completedLinked,
      message: err?.message || 'Could not load device configuration for reconfiguration bridge',
    }
  }

  const target = mergeEffectsIntoTarget({ current: device.current, effects })
  // Completed linked RCF always clears the delivery gate — even if blob specs
  // briefly lag the proposed snapshot.
  const deliveryBlocked = Boolean(open) || (Boolean(target) && !completedLinked)

  return {
    saleOrderId,
    hostSerialId: device.serialId,
    hostProductId: hostItem.productId,
    hostLineId: hostItem.id,
    effects,
    target,
    workOrder: open || completedLinked,
    deliveryBlocked,
    message: completedLinked && !open
      ? `Reconfiguration ${completedLinked.ref} completed — device specs updated; delivery allowed.`
      : !target
        ? 'Reconfiguration lines match the device’s current specs — no work order needed.'
        : open
          ? `Linked ${open.ref} (${open.status.replace(/_/g, ' ')}). Specs change only when this work order is completed.`
          : 'Reconfiguration parts detected — a draft work order will be created/linked. Specs change only after workshop completion.',
  }
}

/**
 * Create or update the draft RCF linked to this sale order from its lines.
 * Safe to call repeatedly (idempotent on linked draft).
 */
export async function syncReconfigurationFromSaleOrder(params: {
  saleOrderId: string
  userId?: string
}): Promise<SaleOrderReconfigLink> {
  const analysis = await analyzeSaleOrderReconfig(params.saleOrderId)
  if (!analysis) {
    return {
      saleOrderId: params.saleOrderId,
      hostSerialId: '',
      hostProductId: null,
      hostLineId: null,
      effects: [],
      target: null,
      workOrder: null,
      deliveryBlocked: false,
      message: 'Sale order not found or has no reconfiguration-relevant lines.',
    }
  }

  if (!analysis.hostSerialId || !analysis.target) {
    return analysis
  }

  // Existing open WO for this serial
  if (analysis.workOrder) {
    const wo = await getWorkOrder(analysis.workOrder.id)
    if (!isMutableDraftStatus(wo.status as any) && wo.status !== 'components_reserved') {
      // Workshop already past draft — do not silently rewrite target
      return {
        ...analysis,
        deliveryBlocked: wo.status !== 'completed',
        message: `Work order ${wo.ref} is ${wo.status.replace(/_/g, ' ')} — target locked. Complete workshop flow to update specs.`,
      }
    }
    // Ensure link + refresh target
    await prisma.reconfigurationWorkOrder.update({
      where: { id: wo.id },
      data: {
        linkedSaleOrderId: params.saleOrderId,
        reason: wo.reason || 'Sales order upgrade/downgrade lines',
        notes: `Synced from sale order ${params.saleOrderId}`,
        updatedById: params.userId || null,
      },
    })
    await applyTargetToWorkOrder(wo.id, analysis.target, params.userId)
    const refreshed = await getWorkOrder(wo.id)
    return {
      ...analysis,
      workOrder: { id: refreshed.id, ref: refreshed.ref, status: refreshed.status },
      deliveryBlocked: true,
      message: `Updated draft ${refreshed.ref} from sale-order lines. Specs change only when completed.`,
    }
  }

  // Create new linked draft
  const created = await createReconfiguration({
    serialId: analysis.hostSerialId,
    transactionType: 'upgrade',
    reason: 'Sales order upgrade/downgrade lines',
    userId: params.userId,
    linkedSaleOrderId: params.saleOrderId,
    linkedClientId: (
      await prisma.saleOrder.findUnique({ where: { id: params.saleOrderId }, select: { clientId: true } })
    )?.clientId ?? null,
    notes: `Auto-created from sale order lines (${analysis.effects.map(e => e.productName).join(', ')})`,
    target: analysis.target,
  })

  return {
    ...analysis,
    workOrder: { id: created.id, ref: created.ref, status: created.status },
    deliveryBlocked: true,
    message: `Created ${created.ref} from sale-order lines. Reserve parts, complete workshop + QA — then specs and inventory update.`,
  }
}

/**
 * Sales no longer gates delivery on reconfiguration. Kept so leftover
 * callers stay permissive.
 */
export async function assertSaleOrderReconfigAllowsDelivery(_saleOrderId?: string | null) {
  return { ok: true as const }
}

/**
 * After RCF complete: rewrite the unit selling name onto every commercial
 * document that still shows the catalog/intake specs.
 *
 * Workshop jobs from the Reconfiguration screen usually have no
 * linkedSaleOrderId — matching by serial is what actually updates the
 * invoice / SO / delivery the customer sees.
 */
export async function refreshSaleOrderHostLineAfterReconfig(workOrderId: string) {
  const wo = await prisma.reconfigurationWorkOrder.findUnique({
    where: { id: workOrderId },
    include: {
      proposedSnapshot: true,
      product: { select: { id: true, name: true } },
      serial: { select: { id: true, serialNumber: true, productId: true } },
    },
  })
  if (!wo) return null

  const snap = wo.proposedSnapshot
  const unitName = cleanUnitDisplayName({
    productName: wo.product?.name,
    displayName: snap?.displayName,
    processor: snap?.processor,
    processorGeneration: snap?.processorGeneration,
    totalRamGb: snap?.totalRamGb,
    primaryStorageGb: snap?.primaryStorageGb,
    storageType: snap?.storageType,
  })
  if (!unitName) return null

  const specs = snap
    ? specsFromProposed({
        processor: snap.processor,
        processorGeneration: snap.processorGeneration,
        totalRamGb: snap.totalRamGb,
        ramComposition: (snap.ramComposition as any) || [],
        primaryStorageGb: snap.primaryStorageGb,
        storageType: snap.storageType,
        displayName: unitName,
      } as any)
    : unitName

  if (snap && snap.displayName !== unitName) {
    await prisma.deviceConfigurationSnapshot.update({
      where: { id: snap.id },
      data: { displayName: unitName },
    })
  }

  const soItems = await prisma.saleOrderItem.findMany({
    where: {
      OR: [
        { serialNumberId: wo.serialId },
        ...(wo.linkedSaleOrderId
          ? [{ saleOrderId: wo.linkedSaleOrderId, productId: wo.productId, serialNumberId: { not: null } }]
          : []),
      ],
    },
  })
  const soIds = [...new Set(soItems.map(i => i.saleOrderId))]
  for (const item of soItems) {
    await prisma.saleOrderItem.update({
      where: { id: item.id },
      data: { description: applyUnitNameToLineDescription(item.description, unitName) },
    })
  }

  const invoiceItems = await prisma.invoiceItem.findMany({
    where: {
      OR: [
        { serialNumberId: wo.serialId },
        ...(soIds.length
          ? [{ invoice: { saleOrderId: { in: soIds } }, productId: wo.productId }]
          : []),
        ...(wo.linkedInvoiceId ? [{ invoiceId: wo.linkedInvoiceId, productId: wo.productId }] : []),
      ],
    },
  })
  for (const item of invoiceItems) {
    await prisma.invoiceItem.update({
      where: { id: item.id },
      data: {
        description: applyUnitNameToLineDescription(item.description, unitName),
        ...(item.serialNumberId ? {} : { serialNumberId: wo.serialId }),
      },
    })
  }

  const deliveryItems = await prisma.deliveryNoteItem.findMany({
    where: {
      OR: [
        { serialNumberId: wo.serialId },
        { serialIds: { has: wo.serialId } },
      ],
    },
  })
  for (const item of deliveryItems) {
    await prisma.deliveryNoteItem.update({
      where: { id: item.id },
      data: {
        description: unitName,
        productName: unitName.slice(0, 200),
        ...(item.serialNumberId ? {} : { serialNumberId: wo.serialId }),
      },
    })
  }

  if (!wo.linkedSaleOrderId && soIds.length === 1) {
    await prisma.reconfigurationWorkOrder.update({
      where: { id: wo.id },
      data: { linkedSaleOrderId: soIds[0] },
    })
  }

  await syncBlobCommercialDocumentsAfterReconfig({
    serialId: wo.serialId,
    manufacturerSerial: wo.manufacturerSerial || wo.serial?.serialNumber || '',
    productId: wo.productId,
    productName: wo.product?.name || unitName,
    unitName,
    specs,
    saleOrderIds: soIds,
  })

  return { description: unitName, saleOrderItemIds: soItems.map(i => i.id), invoiceItemIds: invoiceItems.map(i => i.id) }
}

async function syncBlobCommercialDocumentsAfterReconfig(params: {
  serialId: string
  manufacturerSerial: string
  productId: string
  productName: string
  unitName: string
  specs: string
  saleOrderIds: string[]
}) {
  const { loadAppState, saveStoreKeys } = await import('@/lib/server-store')
  const state = await loadAppState(['deed_serials', 'deed_saleOrders', 'deed_invoices', 'deed_deliveries'])
  const patch: Record<string, string> = {}

  const serials = Array.isArray(state.deed_serials) ? [...(state.deed_serials as any[])] : []
  const sidx = serials.findIndex(
    s => s.id === params.serialId || (params.manufacturerSerial && s.serial === params.manufacturerSerial),
  )
  if (sidx >= 0) {
    serials[sidx] = { ...serials[sidx], specs: params.specs }
    patch.deed_serials = JSON.stringify(serials)
  } else if (params.manufacturerSerial) {
    serials.push({
      id: params.serialId,
      serial: params.manufacturerSerial,
      barcode: params.manufacturerSerial,
      productId: params.productId,
      productName: params.productName,
      specs: params.specs,
      status: 'assigned',
      location: 'warehouse',
      receivedDate: new Date().toISOString().slice(0, 10),
    })
    patch.deed_serials = JSON.stringify(serials)
  }

  const saleOrders = Array.isArray(state.deed_saleOrders) ? [...(state.deed_saleOrders as any[])] : []
  let soChanged = false
  for (const so of saleOrders) {
    if (!Array.isArray(so?.lines)) continue
    let hit = false
    so.lines = so.lines.map((line: any) => {
      const ids = Array.isArray(line.serialIds) ? line.serialIds : []
      if (!ids.includes(params.serialId) && line.serialNumberId !== params.serialId) return line
      hit = true
      return {
        ...line,
        productName: params.unitName,
        description: applyUnitNameToLineDescription(line.description || line.productName, params.unitName),
      }
    })
    if (hit) soChanged = true
  }
  if (soChanged) patch.deed_saleOrders = JSON.stringify(saleOrders)

  const invoices = Array.isArray(state.deed_invoices) ? [...(state.deed_invoices as any[])] : []
  let invChanged = false
  const soIdSet = new Set(params.saleOrderIds)
  for (const inv of invoices) {
    if (!Array.isArray(inv?.lines)) continue
    const onLinkedSo = inv.saleOrderId && soIdSet.has(inv.saleOrderId)
    let hit = false
    inv.lines = inv.lines.map((line: any) => {
      const ids = Array.isArray(line.serialIds) ? line.serialIds : []
      const matchesSerial = ids.includes(params.serialId) || line.serialNumberId === params.serialId
      const matchesHost = onLinkedSo && line.productId === params.productId
      if (!matchesSerial && !matchesHost) return line
      hit = true
      return {
        ...line,
        description: applyUnitNameToLineDescription(line.description, params.unitName),
        ...(matchesSerial ? {} : { serialIds: [params.serialId] }),
      }
    })
    if (hit) invChanged = true
  }
  if (invChanged) patch.deed_invoices = JSON.stringify(invoices)

  const deliveries = Array.isArray(state.deed_deliveries) ? [...(state.deed_deliveries as any[])] : []
  let dnChanged = false
  for (const dn of deliveries) {
    if (!Array.isArray(dn?.lines)) continue
    let hit = false
    dn.lines = dn.lines.map((line: any) => {
      const ids = Array.isArray(line.serialIds) ? line.serialIds : []
      if (!ids.includes(params.serialId)) return line
      hit = true
      return { ...line, productName: params.unitName, description: params.unitName }
    })
    if (hit) dnChanged = true
  }
  if (dnChanged) patch.deed_deliveries = JSON.stringify(deliveries)

  if (Object.keys(patch).length) await saveStoreKeys(patch)
}

/** Repair sale/invoice/delivery descriptions for every completed work order. */
export async function repairAllCompletedReconfigDocuments() {
  const rows = await prisma.reconfigurationWorkOrder.findMany({
    where: { status: 'completed' },
    select: { id: true, ref: true },
    orderBy: { dateCompleted: 'asc' },
  })
  const results = []
  for (const row of rows) {
    const refreshed = await refreshSaleOrderHostLineAfterReconfig(row.id)
    results.push({ ref: row.ref, description: refreshed?.description || null })
  }
  return results
}

/** Sales no longer blocks delivery on reconfiguration. */
export function throwIfDeliveryBlocked(_result: Awaited<ReturnType<typeof assertSaleOrderReconfigAllowsDelivery>>) {
  return
}
