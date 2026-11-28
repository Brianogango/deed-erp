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

type SaleOrderReconfigLink = {
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

  // The machine's own record carries the new name and specs: a warranty, a
  // delivery note or an invoice made after this (the machine was upgraded
  // first and sold later) copies them from here.
  await saveUnitNameOnSerial(wo.serialId, unitName, specs)

  // A line holding several machines is left alone: one upgraded unit does not
  // rename the other fourteen.
  const soItems = (await prisma.saleOrderItem.findMany({
    where: {
      OR: [
        { serialNumberId: wo.serialId },
        { serialIds: { has: wo.serialId } },
        ...(wo.linkedSaleOrderId
          ? [{ saleOrderId: wo.linkedSaleOrderId, productId: wo.productId, serialNumberId: { not: null } }]
          : []),
      ],
    },
  })).filter(i => Number(i.qty ?? 1) <= 1 && (i.serialIds?.length ?? 0) <= 1)
  const soIds = [...new Set(soItems.map(i => i.saleOrderId))]
  const changedSoIds = new Set<string>()
  for (const item of soItems) {
    const description = applyUnitNameToLineDescription(item.description, unitName)
    if (description === item.description) continue
    await prisma.saleOrderItem.update({ where: { id: item.id }, data: { description } })
    changedSoIds.add(item.saleOrderId)
  }

  const invoiceItems = (await prisma.invoiceItem.findMany({
    where: {
      OR: [
        { serialNumberId: wo.serialId },
        ...(soIds.length
          ? [{ invoice: { saleOrderId: { in: soIds } }, productId: wo.productId }]
          : []),
        ...(wo.linkedInvoiceId ? [{ invoiceId: wo.linkedInvoiceId, productId: wo.productId }] : []),
      ],
    },
  })).filter(i => i.serialNumberId === wo.serialId || (Number(i.qty ?? 1) <= 1 && !i.serialNumberId))
  const changedInvoiceIds = new Set<string>()
  for (const item of invoiceItems) {
    const description = applyUnitNameToLineDescription(item.description, unitName)
    if (description === item.description && item.serialNumberId) continue
    await prisma.invoiceItem.update({
      where: { id: item.id },
      data: {
        description,
        ...(item.serialNumberId ? {} : { serialNumberId: wo.serialId }),
      },
    })
    changedInvoiceIds.add(item.invoiceId)
  }

  const deliveryItems = (await prisma.deliveryNoteItem.findMany({
    where: {
      OR: [
        { serialNumberId: wo.serialId },
        { serialIds: { has: wo.serialId } },
      ],
    },
  })).filter(i => (i.serialIds?.length ?? 0) <= 1)
  for (const item of deliveryItems) {
    if (item.description === unitName && item.productName === unitName.slice(0, 200)) continue
    await prisma.deliveryNoteItem.update({
      where: { id: item.id },
      data: {
        description: unitName,
        productName: unitName.slice(0, 200),
        ...(item.serialNumberId ? {} : { serialNumberId: wo.serialId }),
      },
    })
  }

  // Invoice and sale-order screens are cached until the document itself
  // changes; a line edit alone left them showing the old specs.
  const now = new Date()
  if (changedSoIds.size) {
    await prisma.saleOrder.updateMany({ where: { id: { in: [...changedSoIds] } }, data: { updatedAt: now } })
  }
  if (changedInvoiceIds.size) {
    await prisma.invoice.updateMany({ where: { id: { in: [...changedInvoiceIds] } }, data: { updatedAt: now } })
  }

  if (!wo.linkedSaleOrderId && soIds.length === 1) {
    await prisma.reconfigurationWorkOrder.update({
      where: { id: wo.id },
      data: { linkedSaleOrderId: soIds[0] },
    })
  }

  await syncScreenCopiesAfterReconfig({ serialId: wo.serialId, unitName, specs })

  const { notifyStoreKeysChanged } = await import('@/lib/server-store')
  await notifyStoreKeysChanged(['deed_serials', 'deed_saleOrders', 'deed_invoices']).catch(() => {})

  return { description: unitName, saleOrderItemIds: soItems.map(i => i.id), invoiceItemIds: invoiceItems.map(i => i.id) }
}

/** Merge the unit name and specs into the serial's screen fields. */
async function saveUnitNameOnSerial(serialId: string, unitName: string, specs: string) {
  const row = await prisma.serialNumber.findUnique({ where: { id: serialId }, select: { screenExtras: true, notes: true } })
  if (!row) return
  const extras = row.screenExtras && typeof row.screenExtras === 'object' && !Array.isArray(row.screenExtras)
    ? row.screenExtras as Record<string, unknown>
    : {}
  if (extras.specs === specs && extras.unitName === unitName && row.notes === specs) return
  await prisma.serialNumber.update({
    where: { id: serialId },
    data: { screenExtras: { ...extras, specs, unitName } as any, notes: specs },
  })
}

/**
 * The screen copies that are still written: delivery notes, and warranties
 * already issued for this machine (their page shows the name and specs).
 * Sale orders, invoices and serials are read from their tables, updated above.
 */
async function syncScreenCopiesAfterReconfig(params: { serialId: string; unitName: string; specs: string }) {
  const { loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } = await import('@/lib/server-store')

  await withAppStateKeyLock('deed_deliveries', async () => {
    const state = await loadAppStateForWrite(['deed_deliveries'])
    const deliveries = Array.isArray(state.deed_deliveries) ? [...(state.deed_deliveries as any[])] : []
    let changed = false
    for (const dn of deliveries) {
      if (!Array.isArray(dn?.lines)) continue
      dn.lines = dn.lines.map((line: any) => {
        const ids = Array.isArray(line.serialIds) ? line.serialIds : []
        if (!ids.includes(params.serialId) || ids.length > 1) return line
        if (line.productName === params.unitName && line.description === params.unitName) return line
        changed = true
        return { ...line, productName: params.unitName, description: params.unitName }
      })
    }
    if (changed) await saveStoreKeys({ deed_deliveries: JSON.stringify(deliveries) })
  })

  await withAppStateKeyLock('deed_warranties', async () => {
    const state = await loadAppStateForWrite(['deed_warranties'])
    const warranties = Array.isArray(state.deed_warranties) ? (state.deed_warranties as any[]) : []
    let changed = false
    const next = warranties.map(w => {
      if (w?.serialId !== params.serialId || w.status === 'cancelled') return w
      if (w.productName === params.unitName && w.specs === params.specs) return w
      changed = true
      return { ...w, productName: params.unitName, specs: params.specs }
    })
    if (changed) await saveStoreKeys({ deed_warranties: JSON.stringify(next) })
  })
}

/**
 * Put the upgraded name and specs on the documents of machines that were
 * reconfigured before they were sold. Called when a sale order, invoice or
 * delivery is saved and when warranties are issued — the documents made after
 * the reconfiguration took the catalog name. Returns how many machines it
 * refreshed. Never throws: the sale itself has already been saved.
 */
export async function applyReconfiguredUnitNames(serialIds: Array<string | null | undefined>): Promise<number> {
  const ids = [...new Set(serialIds.filter((id): id is string => typeof id === 'string' && UUID.test(id)))]
  if (!ids.length) return 0
  try {
    const orders = await prisma.reconfigurationWorkOrder.findMany({
      where: { serialId: { in: ids }, status: 'completed', proposedSnapshotId: { not: null } },
      select: { id: true, serialId: true, dateCompleted: true, updatedAt: true },
    })
    const latest = new Map<string, { id: string; at: number }>()
    for (const o of orders) {
      const at = (o.dateCompleted ?? o.updatedAt ?? new Date(0)).getTime()
      const have = latest.get(o.serialId)
      if (!have || at > have.at) latest.set(o.serialId, { id: o.id, at })
    }
    let done = 0
    for (const { id } of latest.values()) {
      const r = await refreshSaleOrderHostLineAfterReconfig(id).catch(err => {
        console.error('[reconfig] refreshing documents failed for', id, err)
        return null
      })
      if (r) done += 1
    }
    return done
  } catch (err) {
    console.error('[reconfig] applyReconfiguredUnitNames failed:', err)
    return 0
  }
}

/** Every machine reconfigured and then sold: correct its documents once. */
export async function backfillReconfiguredUnitNames(): Promise<number> {
  const orders = await prisma.reconfigurationWorkOrder.findMany({
    where: { status: 'completed', proposedSnapshotId: { not: null } },
    select: { serialId: true },
  })
  return applyReconfiguredUnitNames(orders.map(o => o.serialId))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const BACKFILL_KEY = 'deed_reconfigDocsBackfill_v1'
let backfillRunning: Promise<unknown> | null = null

/**
 * After warranties are issued: refresh the machines just sold and, the first
 * time this runs, every machine reconfigured before the fix — their invoices
 * and warranties were issued with the catalog specs.
 */
export async function refreshReconfiguredSales(serialIds: Array<string | null | undefined>): Promise<void> {
  await applyReconfiguredUnitNames(serialIds)
  if (backfillRunning) return
  backfillRunning = (async () => {
    const { loadAppState, saveStoreKeys } = await import('@/lib/server-store')
    const state = await loadAppState([BACKFILL_KEY])
    if (state[BACKFILL_KEY]) return
    const count = await backfillReconfiguredUnitNames()
    await saveStoreKeys({ [BACKFILL_KEY]: JSON.stringify({ at: new Date().toISOString(), machines: count }) })
  })().catch(err => {
    console.error('[reconfig] backfill of reconfigured sales failed:', err)
    backfillRunning = null
  })
  await backfillRunning
}
