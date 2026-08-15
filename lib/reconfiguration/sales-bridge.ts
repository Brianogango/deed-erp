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
 * After RCF complete: refresh host SO line description from proposed display name.
 */
export async function refreshSaleOrderHostLineAfterReconfig(workOrderId: string) {
  const wo = await prisma.reconfigurationWorkOrder.findUnique({
    where: { id: workOrderId },
    include: { proposedSnapshot: true },
  })
  if (!wo?.linkedSaleOrderId || !wo.proposedSnapshot?.displayName) return null

  const order = await prisma.saleOrder.findUnique({
    where: { id: wo.linkedSaleOrderId },
    include: { items: true },
  })
  if (!order) return null

  const host = order.items.find(i => i.serialNumberId === wo.serialId)
    || order.items.find(i => i.productId === wo.productId && i.serialNumberId)
  if (!host) return null

  await prisma.saleOrderItem.update({
    where: { id: host.id },
    data: { description: wo.proposedSnapshot.displayName },
  })
  return { lineId: host.id, description: wo.proposedSnapshot.displayName }
}

/** Sales no longer blocks delivery on reconfiguration. */
export function throwIfDeliveryBlocked(_result: Awaited<ReturnType<typeof assertSaleOrderReconfigAllowsDelivery>>) {
  return
}
