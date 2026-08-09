import 'server-only'

import prisma from '@/lib/prisma'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { createJournalEntry } from '@/lib/accounting/journal-service'
import { COMPANY_ACCOUNT_FALLBACKS, formatAccountLabel } from '@/lib/product-accounts'
import { applyDeliveryAverage, applyReceiptAverage, round2 } from '@/lib/inventory/valuation-math'
import { checkCompatibility, hasBlockingCompatibilityIssues } from '@/lib/reconfiguration/compatibility'
import {
  calculateMargin,
  calculateRecommendedSellingPrice,
  calculateReconfigCost,
  isBelowMinimumMargin,
  reconfigCompletionEventKey,
  reconfigValuationEventKey,
  reconfigValuationJournalRef,
} from '@/lib/reconfiguration/costing'
import { calculateConfigurationDiff, specsFromProposed } from '@/lib/reconfiguration/diff-engine'
import { buildDisplayName, parseSpecsString } from '@/lib/reconfiguration/display-name'
import { planComponentInstall, planComponentRemoval } from '@/lib/inventory/reconfiguration-stock'
import {
  assertVersion,
  canTransition,
  isMutableDraftStatus,
} from '@/lib/reconfiguration/state-machine'
import { QA_CHECKLIST, type DeviceConfigFields, type InstalledComponentView, type TargetConfigInput } from '@/lib/reconfiguration/types'
import { mirrorStockReservationsToPrisma } from '@/lib/inventory/reservation-mirror'

function dec(n: unknown) {
  return round2(Number(n) || 0)
}

function httpError(message: string, status = 400) {
  const err = new Error(message) as Error & { status: number }
  err.status = status
  return err
}

/**
 * Deterministic reservation id for one installation line of one work order.
 * Both ids are UUIDs (36 chars), so this is always exactly 8+36+1+36 = 81
 * chars — keep ReconfigurationInstallationLine.reservationId and
 * StockReservation.blobId wide enough to hold it (VarChar(120) currently).
 */
export function buildReservationId(workOrderId: string, lineId: string): string {
  return `rsv_rcf_${workOrderId}_${lineId}`
}

async function ensureFeatureEnabled() {
  try {
    const state = await loadAppState(['deed_systemSettings'])
    const ss = state.deed_systemSettings as { reconfigurationEnabled?: boolean } | null
    // Default ON for environments that have not set the flag yet after deploy;
    // set reconfigurationEnabled: false to disable.
    if (ss && ss.reconfigurationEnabled === false) {
      throw httpError('Device reconfiguration is disabled in system settings.', 403)
    }
  } catch (e) {
    if ((e as any)?.status) throw e
  }
}

function mapInstallation(row: any, productName?: string): InstalledComponentView {
  return {
    id: row.id,
    componentProductId: row.componentProductId,
    componentProductName: productName,
    componentSerialId: row.componentSerialId,
    componentSerialText: row.componentSerialText,
    category: row.category,
    slotType: row.slotType,
    slotNumber: row.slotNumber,
    capacityGb: row.capacityGb,
    technology: row.technology,
    quantity: row.quantity,
    removable: row.removable,
    status: row.status,
    costAtInstallation: dec(row.costAtInstallation),
    condition: row.condition,
  }
}

async function resolveBlobSerial(serialId: string) {
  const state = await loadAppState(['deed_serials', 'deed_products'])
  const serials = Array.isArray(state.deed_serials) ? (state.deed_serials as any[]) : []
  const products = Array.isArray(state.deed_products) ? (state.deed_products as any[]) : []
  const blob = serials.find(s => s.id === serialId || s.serial === serialId)
  return { blob, serials, products, state }
}

async function resolvePrismaSerial(serialId: string) {
  // Prefer UUID lookup; fall back to manufacturer serial match
  const byId = await prisma.serialNumber.findUnique({
    where: { id: serialId },
    include: { product: { include: { brand: true } } },
  }).catch(() => null)
  if (byId) return byId
  return prisma.serialNumber.findFirst({
    where: { OR: [{ serialNumber: serialId }, { inventoryBarcode: serialId }] },
    include: { product: { include: { brand: true } } },
  })
}

export async function getDeviceConfiguration(serialId: string) {
  await ensureFeatureEnabled()
  const prismaSerial = await resolvePrismaSerial(serialId)
  const { blob, products } = await resolveBlobSerial(serialId)
  if (!prismaSerial && !blob) throw httpError('Device serial not found', 404)

  const effectiveSerialId = prismaSerial?.id || blob!.id
  const installs = prismaSerial
    ? await prisma.deviceComponentInstallation.findMany({
        where: { serialId: effectiveSerialId, status: 'installed' },
        include: { componentProduct: { select: { id: true, name: true, sku: true } } },
        orderBy: [{ slotType: 'asc' }, { slotNumber: 'asc' }],
      })
    : []

  const snapshot = prismaSerial
    ? await prisma.deviceConfigurationSnapshot.findFirst({
        where: { serialId: effectiveSerialId, isCurrent: true },
      })
    : null

  const cost = prismaSerial
    ? await prisma.deviceSerialCost.findUnique({ where: { serialId: effectiveSerialId } })
    : null

  const activeWo = prismaSerial
    ? await prisma.reconfigurationWorkOrder.findFirst({
        where: {
          serialId: effectiveSerialId,
          status: { notIn: ['completed', 'cancelled', 'reversed'] },
        },
        select: { id: true, ref: true, status: true },
      })
    : null

  const product = products.find((p: any) => p.id === (prismaSerial?.productId || blob?.productId))
  const parsed = parseSpecsString(blob?.specs || snapshot?.displayName || '')
  const current: DeviceConfigFields = snapshot
    ? {
        processor: snapshot.processor,
        processorGeneration: snapshot.processorGeneration,
        totalRamGb: snapshot.totalRamGb,
        ramComposition: (snapshot.ramComposition as any) || [],
        primaryStorageGb: snapshot.primaryStorageGb,
        secondaryStorageGb: snapshot.secondaryStorageGb,
        storageType: snapshot.storageType,
        screenSize: snapshot.screenSize,
        screenResolution: snapshot.screenResolution,
        touchscreen: snapshot.touchscreen,
        graphics: snapshot.graphics,
        operatingSystem: snapshot.operatingSystem,
        keyboardLayout: snapshot.keyboardLayout,
        colour: snapshot.colour,
        includedAccessories: (snapshot.includedAccessories as any) || [],
        batteryCondition: snapshot.batteryCondition,
        grade: snapshot.grade,
        displayName: snapshot.displayName,
      }
    : {
        totalRamGb: parsed.totalRamGb || 0,
        ramComposition: [],
        primaryStorageGb: parsed.primaryStorageGb ?? null,
        storageType: parsed.storageType ?? null,
        processor: parsed.processor ?? null,
        processorGeneration: parsed.processorGeneration ?? null,
        displayName:
          parsed.displayName ||
          buildDisplayName({
            brand: (prismaSerial as any)?.product?.brand?.name,
            model: (prismaSerial as any)?.product?.modelNumber,
            productName: (prismaSerial as any)?.product?.name || blob?.productName || product?.name,
            config: {
              processor: parsed.processor,
              processorGeneration: parsed.processorGeneration,
              totalRamGb: parsed.totalRamGb || 0,
              ramComposition: [],
              primaryStorageGb: parsed.primaryStorageGb,
              storageType: parsed.storageType,
            },
          }),
      }

  return {
    serialId: effectiveSerialId,
    manufacturerSerial: prismaSerial?.serialNumber || blob?.serial || '',
    productId: prismaSerial?.productId || blob?.productId,
    productName: (prismaSerial as any)?.product?.name || blob?.productName || product?.name,
    location: blob?.location || 'warehouse',
    status: blob?.status || prismaSerial?.status || 'available',
    // Prefer the live structured snapshot's displayName over the denormalized
    // blob field — the snapshot is the source of truth completeWorkOrder
    // promotes on every reconfiguration, while deed_serials.specs is a
    // best-effort mirror that can lag behind it (see syncBlobSpecs). Only
    // fall back to the blob string when there is no snapshot at all.
    specs: current.displayName || blob?.specs,
    current,
    installed: installs.map(i => mapInstallation(i, i.componentProduct?.name)),
    costBefore: cost ? dec(cost.currentCost) : dec((prismaSerial as any)?.product?.costPrice || product?.costPrice),
    sellingPriceBefore: dec((prismaSerial as any)?.product?.sellingPrice || product?.salePrice || product?.sellingPrice),
    activeWorkOrder: activeWo,
    blobSerialId: blob?.id || null,
  }
}

export async function seedInstalledComponents(params: {
  serialId: string
  userId?: string
  components: Array<{
    componentProductId: string
    category: string
    slotType: any
    slotNumber: number
    capacityGb?: number
    technology?: string
    quantity?: number
    removable?: boolean
    costAtInstallation?: number
    componentSerialText?: string
    condition?: any
  }>
}) {
  await ensureFeatureEnabled()
  const device = await getDeviceConfiguration(params.serialId)
  const created = []
  for (const c of params.components) {
    const row = await prisma.deviceComponentInstallation.create({
      data: {
        serialId: device.serialId,
        componentProductId: c.componentProductId,
        category: c.category,
        slotType: c.slotType,
        slotNumber: c.slotNumber,
        capacityGb: c.capacityGb ?? null,
        technology: c.technology ?? null,
        quantity: c.quantity ?? 1,
        removable: c.removable ?? true,
        status: 'installed',
        costAtInstallation: c.costAtInstallation ?? 0,
        componentSerialText: c.componentSerialText ?? null,
        condition: c.condition ?? null,
        installedById: params.userId || null,
      },
    })
    created.push(row)
  }

  // Refresh current snapshot from installs
  const installed = created.map(c => mapInstallation(c))
  const totalRam = installed
    .filter(i => i.category === 'ram' || i.slotType === 'ram_slot')
    .reduce((s, i) => s + (Number(i.capacityGb) || 0), 0)
  const storage = installed.find(i => i.category === 'storage' || i.slotType === 'm2_slot' || i.slotType === 'sata_bay')
  const config: DeviceConfigFields = {
    ...device.current,
    totalRamGb: totalRam || device.current.totalRamGb,
    primaryStorageGb: storage?.capacityGb ?? device.current.primaryStorageGb,
    ramComposition: installed
      .filter(i => i.category === 'ram' || i.slotType === 'ram_slot')
      .map(i => ({
        slotType: i.slotType,
        slotNumber: i.slotNumber,
        capacityGb: Number(i.capacityGb) || 0,
        technology: i.technology || undefined,
        removable: i.removable,
        productId: i.componentProductId,
        installationId: i.id,
        componentSerialText: i.componentSerialText || undefined,
      })),
    displayName: '',
  }
  config.displayName = buildDisplayName({
    productName: device.productName,
    config,
  })

  await prisma.deviceConfigurationSnapshot.updateMany({
    where: { serialId: device.serialId, isCurrent: true },
    data: { isCurrent: false },
  })
  await prisma.deviceConfigurationSnapshot.create({
    data: {
      serialId: device.serialId,
      processor: config.processor,
      processorGeneration: config.processorGeneration,
      totalRamGb: config.totalRamGb,
      ramComposition: config.ramComposition as any,
      primaryStorageGb: config.primaryStorageGb,
      secondaryStorageGb: config.secondaryStorageGb,
      storageType: config.storageType,
      displayName: config.displayName,
      source: 'migration',
      isCurrent: true,
      createdById: params.userId || null,
    },
  })

  if (!costExists(device.serialId)) {
    /* noop - helper below */
  }
  await prisma.deviceSerialCost.upsert({
    where: { serialId: device.serialId },
    create: {
      serialId: device.serialId,
      currentCost: device.costBefore,
      updatedById: params.userId || null,
    },
    update: {},
  })

  await syncBlobSpecs(device.blobSerialId || device.serialId, specsFromProposed(config), device.manufacturerSerial)

  return { installed: created, config }
}

async function costExists(_serialId: string) {
  return true
}

// Exported for regression testing (see __tests__/reconfiguration-sync-blob-specs.test.ts).
export async function syncBlobSpecs(serialId: string, specs: string, manufacturerSerial?: string) {
  const state = await loadAppState(['deed_serials'])
  const serials = Array.isArray(state.deed_serials) ? [...(state.deed_serials as any[])] : []
  // A blob deed_serials row is not guaranteed to share the Prisma serial's
  // UUID (legacy/partially-mirrored records) — without the manufacturerSerial
  // fallback this silently no-ops (idx < 0 → return) whenever the ids
  // diverge, leaving deed_serials.specs stuck on the pre-reconfiguration
  // value even though the status update a few lines below in
  // completeWorkOrder DOES fall back to manufacturerSerial and succeeds.
  // That mismatch is exactly what produced "status is available again but
  // specs still show the old config" after a completed reconfiguration.
  const idx = serials.findIndex(
    s => s.id === serialId || s.serial === serialId || (manufacturerSerial && s.serial === manufacturerSerial),
  )
  if (idx < 0) return
  serials[idx] = { ...serials[idx], specs }
  await saveStoreKeys({ deed_serials: JSON.stringify(serials) })
}

export async function createReconfiguration(params: {
  serialId: string
  transactionType: any
  reason: string
  userId?: string
  warehouseLocation?: string
  linkedClientId?: string | null
  linkedQuoteId?: string | null
  linkedSaleOrderId?: string | null
  linkedRepairId?: string | null
  notes?: string | null
  target?: TargetConfigInput
  labourCost?: number
  otherCost?: number
}) {
  await ensureFeatureEnabled()
  const device = await getDeviceConfiguration(params.serialId)

  if (device.activeWorkOrder) {
    throw httpError(`Device already has active reconfiguration ${device.activeWorkOrder.ref}`, 409)
  }
  if (['sold', 'customer'].includes(String(device.status)) || device.location === 'customer') {
    throw httpError(
      'Delivered/sold devices cannot be reconfigured here. Use return, exchange, credit note, or customer-paid upgrade after-sales flow.',
      422,
    )
  }

  // Block if reserved for another SO (unless linked)
  const state = await loadAppState(['deed_stockReservations'])
  const reservations = Array.isArray(state.deed_stockReservations)
    ? (state.deed_stockReservations as any[])
    : []
  const conflicting = reservations.find(
    r =>
      r.status === 'reserved' &&
      (r.serialId === device.serialId || (Array.isArray(r.serialIds) && r.serialIds.includes(device.blobSerialId || device.serialId))) &&
      r.reservedFor === 'sales_order' &&
      (!params.linkedSaleOrderId || r.referenceId !== params.linkedSaleOrderId),
  )
  if (conflicting) {
    throw httpError(`Device is reserved for ${conflicting.referenceRef || 'another sales order'}`, 409)
  }

  const ref = await getNextDocNumber('reconfiguration')
  const wo = await prisma.reconfigurationWorkOrder.create({
    data: {
      ref,
      serialId: device.serialId,
      manufacturerSerial: device.manufacturerSerial,
      productId: device.productId!,
      transactionType: params.transactionType,
      status: 'draft',
      reason: params.reason,
      warehouseLocation: params.warehouseLocation || device.location || 'warehouse',
      linkedClientId: params.linkedClientId || null,
      linkedQuoteId: params.linkedQuoteId || null,
      linkedSaleOrderId: params.linkedSaleOrderId || null,
      linkedRepairId: params.linkedRepairId || null,
      notes: params.notes || null,
      requestedById: params.userId || null,
      createdById: params.userId || null,
      updatedById: params.userId || null,
      costBefore: device.costBefore,
      sellingPriceBefore: device.sellingPriceBefore,
      labourCost: params.labourCost || 0,
      otherCost: params.otherCost || 0,
    },
  })

  // Ensure cost basis row
  await prisma.deviceSerialCost.upsert({
    where: { serialId: device.serialId },
    create: { serialId: device.serialId, currentCost: device.costBefore, updatedById: params.userId || null },
    update: {},
  })

  if (params.target) {
    await applyTargetToWorkOrder(wo.id, params.target, params.userId)
  }

  return getWorkOrder(wo.id)
}

async function applyTargetToWorkOrder(workOrderId: string, target: TargetConfigInput, userId?: string) {
  const wo = await prisma.reconfigurationWorkOrder.findUniqueOrThrow({
    where: { id: workOrderId },
    include: { product: { include: { brand: true } } },
  })
  if (!isMutableDraftStatus(wo.status as any) && wo.status !== 'components_reserved') {
    throw httpError('Target configuration can only be edited in draft/stock-check states', 422)
  }

  const device = await getDeviceConfiguration(wo.serialId)
  const diff = calculateConfigurationDiff({
    installed: device.installed,
    current: device.current,
    target,
    brand: (wo.product as any)?.brand?.name,
    model: wo.product?.modelNumber,
    productName: wo.product?.name,
  })
  const compat = checkCompatibility({
    installed: device.installed,
    target,
    issuesFromDiff: diff.issues,
  })

  if (hasBlockingCompatibilityIssues(compat)) {
    const blocking = compat.filter(i => i.severity === 'error' && !i.overridable)
    throw httpError(blocking.map(i => i.message).join(' ') || 'Configuration change is not possible', 422)
  }

  // Replace lines
  await prisma.reconfigurationRemovalLine.deleteMany({ where: { workOrderId } })
  await prisma.reconfigurationInstallationLine.deleteMany({ where: { workOrderId } })

  for (const r of diff.removals) {
    await prisma.reconfigurationRemovalLine.create({
      data: {
        workOrderId,
        installationId: r.installationId,
        componentProductId: r.componentProductId,
        componentSerialText: r.componentSerialText || null,
        slotType: r.slotType,
        slotNumber: r.slotNumber,
        quantity: 1,
        existingCost: r.existingCost,
        destinationLocation: 'pending_testing',
        disposition: 'pending_testing',
        dataStatus: r.category === 'storage' || r.slotType === 'm2_slot' || r.slotType === 'sata_bay' ? 'unknown' : null,
      },
    })
  }

  for (const i of diff.installations) {
    if (!i.componentProductId) continue
    let unitCost = 0
    try {
      const val = await prisma.productValuation.findUnique({ where: { productId: i.componentProductId } })
      unitCost = val ? dec(val.averageCost) : 0
      if (!unitCost) {
        const p = await prisma.product.findUnique({ where: { id: i.componentProductId } })
        unitCost = dec(p?.costPrice)
      }
    } catch { /* */ }

    await prisma.reconfigurationInstallationLine.create({
      data: {
        workOrderId,
        componentProductId: i.componentProductId,
        requiredSpec: {
          capacityGb: i.requiredCapacityGb,
          category: i.category,
          technology: i.technology,
        },
        sourceLocation: 'warehouse',
        quantity: 1,
        unitCost,
        targetSlotType: i.targetSlotType,
        targetSlotNumber: i.targetSlotNumber,
        compatibilityResult: hasBlockingCompatibilityIssues(compat) ? 'fail' : 'pass',
      },
    })
  }

  // Snapshots
  await prisma.deviceConfigurationSnapshot.updateMany({
    where: { serialId: wo.serialId, isCurrent: true },
    data: { isCurrent: false },
  })
  const currentSnap = await prisma.deviceConfigurationSnapshot.create({
    data: {
      serialId: wo.serialId,
      processor: device.current.processor,
      processorGeneration: device.current.processorGeneration,
      totalRamGb: device.current.totalRamGb,
      ramComposition: (device.current.ramComposition || []) as any,
      primaryStorageGb: device.current.primaryStorageGb,
      secondaryStorageGb: device.current.secondaryStorageGb,
      storageType: device.current.storageType,
      displayName: device.current.displayName,
      source: 'reconfiguration',
      sourceWorkOrderId: workOrderId,
      isCurrent: true,
      createdById: userId || null,
    },
  })
  // Keep isCurrent on live device — proposed is not current yet
  const proposedSnap = await prisma.deviceConfigurationSnapshot.create({
    data: {
      serialId: wo.serialId,
      processor: diff.proposed.processor,
      processorGeneration: diff.proposed.processorGeneration,
      totalRamGb: diff.proposed.totalRamGb,
      ramComposition: diff.proposed.ramComposition as any,
      primaryStorageGb: diff.proposed.primaryStorageGb,
      secondaryStorageGb: diff.proposed.secondaryStorageGb,
      storageType: diff.proposed.storageType,
      displayName: diff.proposed.displayName,
      source: 'reconfiguration',
      sourceWorkOrderId: workOrderId,
      isCurrent: false,
      createdById: userId || null,
    },
  })

  // Restore current flag on currentSnap (we flipped all off)
  await prisma.deviceConfigurationSnapshot.update({
    where: { id: currentSnap.id },
    data: { isCurrent: true },
  })

  const costRemoved = diff.removals.reduce((s, r) => s + r.existingCost, 0)
  const installLines = await prisma.reconfigurationInstallationLine.findMany({ where: { workOrderId } })
  const costInstalled = installLines.reduce((s, l) => s + dec(l.unitCost) * l.quantity, 0)
  const cost = calculateReconfigCost({
    costBefore: dec(wo.costBefore),
    costRemoved,
    costInstalled,
    labourCost: dec(wo.labourCost),
    otherCost: dec(wo.otherCost),
  })
  const price = calculateRecommendedSellingPrice({
    method: (wo.priceMethod as any) || 'cost_plus',
    costAfter: cost.costAfter,
    sellingPriceBefore: dec(wo.sellingPriceBefore),
    markupPct: 25,
  })
  const margin = calculateMargin({ sellingPrice: price.recommended, costAfter: cost.costAfter })

  await prisma.reconfigurationWorkOrder.update({
    where: { id: workOrderId },
    data: {
      currentSnapshotId: currentSnap.id,
      proposedSnapshotId: proposedSnap.id,
      costRemoved: cost.costRemoved,
      costInstalled: cost.costInstalled,
      costAfter: cost.costAfter,
      recommendedSellingPrice: price.recommended,
      priceDifference: round2(price.recommended - dec(wo.sellingPriceBefore)),
      grossMargin: margin.grossMargin,
      grossMarginPct: margin.grossMarginPct,
      priceMethod: price.method,
      status: wo.status === 'draft' ? 'pending_stock_check' : wo.status,
      updatedById: userId || null,
      version: { increment: 1 },
    },
  })

  return { diff, compat, cost, price }
}

export async function getWorkOrder(id: string) {
  const wo = await prisma.reconfigurationWorkOrder.findUnique({
    where: { id },
    include: {
      removalLines: { include: { componentProduct: { select: { id: true, name: true, sku: true } }, installation: true } },
      installationLines: { include: { componentProduct: { select: { id: true, name: true, sku: true } } } },
      approvals: true,
      qaChecks: { orderBy: { checkKey: 'asc' } },
      attachments: true,
      currentSnapshot: true,
      proposedSnapshot: true,
      product: { select: { id: true, name: true, sku: true, modelNumber: true } },
    },
  })
  if (!wo) throw httpError('Work order not found', 404)
  return wo
}

export async function listWorkOrders(filters?: { status?: string; q?: string }) {
  await ensureFeatureEnabled()
  const where: any = {}
  if (filters?.status) where.status = filters.status
  if (filters?.q) {
    where.OR = [
      { ref: { contains: filters.q, mode: 'insensitive' } },
      { manufacturerSerial: { contains: filters.q, mode: 'insensitive' } },
    ]
  }
  return prisma.reconfigurationWorkOrder.findMany({
    where,
    orderBy: { dateRequested: 'desc' },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      proposedSnapshot: { select: { displayName: true, totalRamGb: true, primaryStorageGb: true } },
      currentSnapshot: { select: { displayName: true, totalRamGb: true, primaryStorageGb: true } },
    },
    take: 200,
  })
}

export async function reserveComponents(params: {
  id: string
  version: number
  userId?: string
  installationLineUpdates?: Array<{
    lineId: string
    componentProductId: string
    selectedSerialId?: string | null
    selectedSerialText?: string | null
    sourceLocation?: string
    unitCost?: number
    quantity?: number
  }>
}) {
  await ensureFeatureEnabled()
  const wo = await getWorkOrder(params.id)
  assertVersion(wo.version, params.version)
  if (!canTransition(wo.status as any, 'reserve') && wo.status !== 'pending_stock_check' && wo.status !== 'draft') {
    // allow re-reserve from components_reserved after edits
    if (wo.status !== 'components_reserved') throw httpError(`Cannot reserve from status ${wo.status}`, 422)
  }

  if (params.installationLineUpdates?.length) {
    for (const u of params.installationLineUpdates) {
      await prisma.reconfigurationInstallationLine.update({
        where: { id: u.lineId },
        data: {
          componentProductId: u.componentProductId,
          selectedSerialId: u.selectedSerialId ?? undefined,
          selectedSerialText: u.selectedSerialText ?? undefined,
          sourceLocation: u.sourceLocation || 'warehouse',
          unitCost: u.unitCost ?? undefined,
          quantity: u.quantity ?? undefined,
        },
      })
    }
  }

  const lines = await prisma.reconfigurationInstallationLine.findMany({
    where: { workOrderId: wo.id },
    include: { componentProduct: true },
  })

  const state = await loadAppState(['deed_bulkStock', 'deed_serials', 'deed_stockReservations', 'deed_products'])
  const bulkStock = Array.isArray(state.deed_bulkStock) ? [...(state.deed_bulkStock as any[])] : []
  const serials = Array.isArray(state.deed_serials) ? (state.deed_serials as any[]) : []
  let reservations = Array.isArray(state.deed_stockReservations) ? [...(state.deed_stockReservations as any[])] : []

  // Release prior reservations for this WO
  reservations = reservations.map(r =>
    r.referenceId === wo.id && r.status === 'reserved'
      ? { ...r, status: 'cancelled', releasedDate: new Date().toISOString() }
      : r,
  )

  for (const line of lines) {
    const qty = line.quantity
    const loc = line.sourceLocation || 'warehouse'
    if (line.selectedSerialId) {
      const ser = serials.find(s => s.id === line.selectedSerialId)
      if (!ser || ser.status !== 'available') {
        throw httpError(`Component serial not available for ${line.componentProduct.name}`, 422)
      }
      const already = reservations.find(
        r => r.status === 'reserved' && (r.serialId === ser.id || (Array.isArray(r.serialIds) && r.serialIds.includes(ser.id))),
      )
      if (already && already.referenceId !== wo.id) {
        throw httpError(`Component serial reserved for ${already.referenceRef}`, 409)
      }
    } else {
      const onHand = bulkStock
        .filter(b => b.productId === line.componentProductId && b.location === loc)
        .reduce((s, b) => s + (Number(b.qty) || 0), 0)
      const reservedQty = reservations
        .filter(r => r.status === 'reserved' && r.productId === line.componentProductId && r.location === loc && r.referenceId !== wo.id)
        .reduce((s, r) => s + (Number(r.qty) || 0), 0)
      if (onHand - reservedQty < qty) {
        throw httpError(
          `Insufficient stock for ${line.componentProduct.name} at ${loc} (need ${qty}, free ${Math.max(0, onHand - reservedQty)})`,
          422,
        )
      }
    }

    const reservationId = buildReservationId(wo.id, line.id)
    reservations.push({
      id: reservationId,
      productId: line.componentProductId,
      productName: line.componentProduct.name,
      qty,
      reservedFor: 'reconfiguration',
      referenceId: wo.id,
      referenceRef: wo.ref,
      referenceType: 'reconfiguration',
      serialId: line.selectedSerialId || undefined,
      serialIds: line.selectedSerialId ? [line.selectedSerialId] : [],
      location: loc,
      status: 'reserved',
      reservedDate: new Date().toISOString(),
    })
    await prisma.reconfigurationInstallationLine.update({
      where: { id: line.id },
      data: { reservationId, reservationStatus: 'reserved' },
    })
  }

  await saveStoreKeys({ deed_stockReservations: JSON.stringify(reservations) })
  await mirrorStockReservationsToPrisma(reservations).catch(() => null)

  // If coming from draft, step through pending_stock_check
  let status = wo.status as string
  if (status === 'draft') status = 'pending_stock_check'
  if (status === 'pending_stock_check') status = 'components_reserved'

  await prisma.reconfigurationWorkOrder.update({
    where: { id: wo.id },
    data: {
      status: status as any,
      updatedById: params.userId || null,
      version: { increment: 1 },
    },
  })

  return getWorkOrder(wo.id)
}

export async function submitForApproval(params: { id: string; version: number; userId?: string }) {
  const wo = await getWorkOrder(params.id)
  assertVersion(wo.version, params.version)
  if (!canTransition(wo.status as any, 'submit_approval') && !canTransition(wo.status as any, 'auto_approve')) {
    throw httpError(`Cannot submit approval from ${wo.status}`, 422)
  }
  await prisma.reconfigurationWorkOrder.update({
    where: { id: wo.id },
    data: { status: 'pending_approval', updatedById: params.userId || null, version: { increment: 1 } },
  })
  return getWorkOrder(wo.id)
}

export async function approveWorkOrder(params: {
  id: string
  version: number
  userId?: string
  reason?: string
  compatibilityOverride?: boolean
  compatibilityOverrideReason?: string
  marginOverride?: boolean
  finalSellingPrice?: number
  minMarginPct?: number
}) {
  const wo = await getWorkOrder(params.id)
  assertVersion(wo.version, params.version)
  if (!canTransition(wo.status as any, 'approve')) throw httpError(`Cannot approve from ${wo.status}`, 422)

  const selling = params.finalSellingPrice ?? dec(wo.finalSellingPrice ?? wo.recommendedSellingPrice)
  const margin = calculateMargin({ sellingPrice: selling, costAfter: dec(wo.costAfter) })
  const minMargin = params.minMarginPct ?? 10
  if (isBelowMinimumMargin({ grossMarginPct: margin.grossMarginPct, minMarginPct: minMargin }) && !params.marginOverride) {
    throw httpError(`Gross margin ${margin.grossMarginPct}% is below minimum ${minMargin}%. Override required.`, 422)
  }

  await prisma.reconfigurationApproval.create({
    data: {
      workOrderId: wo.id,
      action: 'approve',
      userId: params.userId || null,
      reason: params.reason || null,
      marginOverride: Boolean(params.marginOverride),
      compatOverride: Boolean(params.compatibilityOverride),
    },
  })

  await prisma.reconfigurationWorkOrder.update({
    where: { id: wo.id },
    data: {
      status: 'approved',
      approverId: params.userId || null,
      finalSellingPrice: selling,
      grossMargin: margin.grossMargin,
      grossMarginPct: margin.grossMarginPct,
      compatibilityOverride: Boolean(params.compatibilityOverride),
      compatibilityOverrideReason: params.compatibilityOverrideReason || null,
      marginOverride: Boolean(params.marginOverride),
      updatedById: params.userId || null,
      version: { increment: 1 },
    },
  })
  return getWorkOrder(wo.id)
}

export async function rejectWorkOrder(params: { id: string; version: number; userId?: string; reason?: string }) {
  const wo = await getWorkOrder(params.id)
  assertVersion(wo.version, params.version)
  if (!canTransition(wo.status as any, 'reject')) throw httpError(`Cannot reject from ${wo.status}`, 422)
  await prisma.reconfigurationApproval.create({
    data: {
      workOrderId: wo.id,
      action: 'reject',
      userId: params.userId || null,
      reason: params.reason || null,
    },
  })
  await prisma.reconfigurationWorkOrder.update({
    where: { id: wo.id },
    data: { status: 'components_reserved', updatedById: params.userId || null, version: { increment: 1 } },
  })
  return getWorkOrder(wo.id)
}

export async function startWork(params: { id: string; version: number; userId?: string }) {
  const wo = await getWorkOrder(params.id)
  assertVersion(wo.version, params.version)
  if (!canTransition(wo.status as any, 'start')) throw httpError(`Cannot start from ${wo.status}`, 422)

  // Re-validate reservations still active
  const state = await loadAppState(['deed_stockReservations', 'deed_serials'])
  const reservations = Array.isArray(state.deed_stockReservations) ? (state.deed_stockReservations as any[]) : []
  const serials = Array.isArray(state.deed_serials) ? [...(state.deed_serials as any[])] : []
  for (const line of wo.installationLines) {
    if (!line.reservationId) continue
    const r = reservations.find(x => x.id === line.reservationId && x.status === 'reserved')
    if (!r) throw httpError(`Reservation lost for ${line.componentProduct.name}. Re-reserve components.`, 422)
  }

  // Stage device
  const idx = serials.findIndex(s => s.id === wo.serialId || s.serial === wo.manufacturerSerial)
  if (idx >= 0) {
    serials[idx] = {
      ...serials[idx],
      status: 'reconfiguration',
      location: 'repair_unit',
    }
    await saveStoreKeys({ deed_serials: JSON.stringify(serials) })
  }

  // Seed QA checklist
  const existingQa = await prisma.reconfigurationQaCheck.count({ where: { workOrderId: wo.id } })
  if (existingQa === 0) {
    await prisma.reconfigurationQaCheck.createMany({
      data: QA_CHECKLIST.map(c => ({
        workOrderId: wo.id,
        checkKey: c.key,
        label: c.label,
        required: c.required,
        result: 'pending',
      })),
    })
  }

  await prisma.reconfigurationWorkOrder.update({
    where: { id: wo.id },
    data: {
      status: 'in_progress',
      dateStarted: new Date(),
      technicianId: params.userId || wo.technicianId,
      updatedById: params.userId || null,
      version: { increment: 1 },
    },
  })
  return getWorkOrder(wo.id)
}

export async function recordRemoval(params: {
  id: string
  version: number
  userId?: string
  lineId: string
  conditionAfterRemoval?: any
  disposition?: any
  dataStatus?: any
  destinationLocation?: string
}) {
  const wo = await getWorkOrder(params.id)
  assertVersion(wo.version, params.version)
  if (wo.status !== 'in_progress' && wo.status !== 'pending_qa') {
    throw httpError('Removals can only be recorded while work is in progress', 422)
  }
  const line = wo.removalLines.find(l => l.id === params.lineId)
  if (!line) throw httpError('Removal line not found', 404)
  if (line.actualRemovedAt) throw httpError('Removal already recorded', 409)

  if ((line.slotType === 'm2_slot' || line.slotType === 'sata_bay' || line.installation?.category === 'storage') && !params.dataStatus && !line.dataStatus) {
    throw httpError('Data status is required when removing storage', 422)
  }

  const disposition = params.disposition || line.disposition || 'pending_testing'
  const dest = params.destinationLocation || (disposition === 'quarantine' ? 'quarantine' : 'pending_testing')
  const plan = planComponentRemoval({
    documentRef: wo.ref,
    productId: line.componentProductId,
    productName: line.componentProduct.name,
    qty: line.quantity,
    componentSerialId: line.installation?.componentSerialId,
    componentSerialText: line.componentSerialText || line.installation?.componentSerialText,
    disposition: dest,
  })

  const moveRef = await applyStockPlan(plan, dec(line.existingCost), { workOrderId: wo.id, userId: params.userId })

  await prisma.deviceComponentInstallation.update({
    where: { id: line.installationId },
    data: {
      status: dest === 'quarantine' ? 'quarantined' : 'removed',
      removedAt: new Date(),
      removedById: params.userId || null,
      removalWorkOrderId: wo.id,
    },
  })

  await prisma.reconfigurationRemovalLine.update({
    where: { id: line.id },
    data: {
      actualRemovedAt: new Date(),
      removedById: params.userId || null,
      conditionAfterRemoval: params.conditionAfterRemoval || line.conditionAfterRemoval,
      disposition: disposition as any,
      destinationLocation: dest,
      dataStatus: (params.dataStatus || line.dataStatus) as any,
      stockMoveRef: moveRef,
      qaStatus: 'pending',
    },
  })

  await prisma.reconfigurationWorkOrder.update({
    where: { id: wo.id },
    data: { version: { increment: 1 }, updatedById: params.userId || null },
  })
  return getWorkOrder(wo.id)
}

export async function recordInstallation(params: {
  id: string
  version: number
  userId?: string
  lineId: string
  selectedSerialText?: string | null
  selectedSerialId?: string | null
  overrideReservedComponent?: boolean
  overrideReason?: string
}) {
  const wo = await getWorkOrder(params.id)
  assertVersion(wo.version, params.version)
  if (wo.status !== 'in_progress' && wo.status !== 'pending_qa') {
    throw httpError('Installations can only be recorded while work is in progress', 422)
  }
  const line = wo.installationLines.find(l => l.id === params.lineId)
  if (!line) throw httpError('Installation line not found', 404)
  if (line.installedAt) throw httpError('Installation already recorded', 409)

  if (
    line.selectedSerialId &&
    params.selectedSerialId &&
    params.selectedSerialId !== line.selectedSerialId &&
    !params.overrideReservedComponent
  ) {
    throw httpError('Installed component differs from reserved component. Override required.', 422)
  }

  // Ensure all removals for same slot done when replacement
  const conflictingRemoval = wo.removalLines.find(
    r =>
      r.slotType === line.targetSlotType &&
      r.slotNumber === line.targetSlotNumber &&
      !r.actualRemovedAt,
  )
  if (conflictingRemoval) {
    throw httpError('Remove the existing component from this slot before installing the replacement', 422)
  }

  const serialId = params.selectedSerialId ?? line.selectedSerialId
  const serialText = params.selectedSerialText ?? line.selectedSerialText
  const plan = planComponentInstall({
    documentRef: wo.ref,
    productId: line.componentProductId,
    productName: line.componentProduct.name,
    qty: line.quantity,
    from: (line.sourceLocation || 'warehouse') as any,
    componentSerialId: serialId,
    componentSerialText: serialText,
  })
  const moveRef = await applyStockPlan(plan, dec(line.unitCost), { workOrderId: wo.id, userId: params.userId })

  // Fulfill reservation
  const state = await loadAppState(['deed_stockReservations'])
  let reservations = Array.isArray(state.deed_stockReservations) ? [...(state.deed_stockReservations as any[])] : []
  if (line.reservationId) {
    reservations = reservations.map(r =>
      r.id === line.reservationId ? { ...r, status: 'fulfilled', releasedDate: new Date().toISOString() } : r,
    )
    await saveStoreKeys({ deed_stockReservations: JSON.stringify(reservations) })
    await mirrorStockReservationsToPrisma(reservations).catch(() => null)
  }

  const spec = (line.requiredSpec || {}) as any
  const installation = await prisma.deviceComponentInstallation.create({
    data: {
      serialId: wo.serialId,
      componentProductId: line.componentProductId,
      componentSerialId: serialId || null,
      componentSerialText: serialText || null,
      category: spec.category || (line.targetSlotType === 'ram_slot' ? 'ram' : 'storage'),
      slotType: line.targetSlotType,
      slotNumber: line.targetSlotNumber,
      capacityGb: spec.capacityGb ?? null,
      technology: spec.technology ?? null,
      quantity: line.quantity,
      removable: true,
      status: 'installed',
      costAtInstallation: dec(line.unitCost),
      sourceStockMoveRef: moveRef,
      installationWorkOrderId: wo.id,
      installedById: params.userId || null,
    },
  })

  await prisma.reconfigurationInstallationLine.update({
    where: { id: line.id },
    data: {
      installedAt: new Date(),
      installedById: params.userId || null,
      selectedSerialId: serialId || null,
      selectedSerialText: serialText || null,
      resultingInstallationId: installation.id,
      reservationStatus: 'fulfilled',
      stockMoveRef: moveRef,
    },
  })

  await prisma.reconfigurationWorkOrder.update({
    where: { id: wo.id },
    data: { version: { increment: 1 }, updatedById: params.userId || null },
  })
  return getWorkOrder(wo.id)
}

/**
 * Bulk (non-serialized) component stock — e.g. RAM/SSD sticks — is written
 * authoritatively to the relational bulk_stock_levels + stock_movements
 * tables (not just the legacy deed_bulkStock/deed_stockMoves blob), so a
 * reconfiguration remove/install is durably recorded in the database. The
 * blob mirror is kept in sync in the same call so existing UI that still
 * reads deed_bulkStock (Inventory, product pickers, availability checks
 * elsewhere in this file) does not regress while it migrates to the new
 * table.
 */
// Exported for regression testing (see __tests__/reconfiguration-bulk-stock-prisma.test.ts).
export async function applyBulkStockPlanToPrisma(
  plan: {
    kind: 'return_bulk_to_testing' | 'consume_bulk'
    productId: string
    qty: number
    reason: string
    documentRef?: string
  } & (
    | { kind: 'return_bulk_to_testing'; to: string }
    | { kind: 'consume_bulk'; from: string }
  ),
  ctx: { unitCost: number; workOrderId?: string; userId?: string; blobId?: string },
): Promise<string> {
  return prisma.$transaction(async tx => {
    const location = plan.kind === 'return_bulk_to_testing' ? plan.to : plan.from
    const existing = await tx.bulkStockLevel.findUnique({
      where: { productId_location: { productId: plan.productId, location } },
    })
    const qtyBefore = existing?.qty ?? 0

    if (plan.kind === 'consume_bulk' && qtyBefore < plan.qty) {
      throw httpError(`Insufficient stock at ${location}`, 422)
    }

    const qtyAfter = plan.kind === 'return_bulk_to_testing' ? qtyBefore + plan.qty : qtyBefore - plan.qty
    if (existing) {
      await tx.bulkStockLevel.update({ where: { id: existing.id }, data: { qty: qtyAfter } })
    } else {
      await tx.bulkStockLevel.create({
        data: { productId: plan.productId, location, qty: Math.max(0, qtyAfter) },
      })
    }

    const move = await tx.stockMovement.create({
      data: {
        productId: plan.productId,
        movementType: plan.kind === 'return_bulk_to_testing' ? 'reconfiguration_in' : 'reconfiguration_out',
        qty: plan.qty,
        qtyBefore,
        qtyAfter: Math.max(0, qtyAfter),
        unitCost: ctx.unitCost || null,
        fromLocation: plan.kind === 'consume_bulk' ? plan.from : null,
        toLocation: plan.kind === 'return_bulk_to_testing' ? plan.to : null,
        referenceType: 'reconfiguration_work_order',
        referenceId: ctx.workOrderId || null,
        documentRef: plan.documentRef || null,
        // Correlates this relational row with its deed_stockMoves blob mirror
        // (same convention as the existing blob→Prisma stock-move backfill),
        // so a future backfill/parity pass never double-imports this move.
        blobId: ctx.blobId || null,
        notes: plan.reason,
        createdById: ctx.userId || null,
      },
    })
    return move.id
  })
}

async function applyStockPlan(
  plan: ReturnType<typeof planComponentRemoval> | ReturnType<typeof planComponentInstall>,
  unitCost: number,
  ctx: { workOrderId?: string; userId?: string } = {},
) {
  const state = await loadAppState(['deed_bulkStock', 'deed_serials', 'deed_stockMoves', 'deed_products'])
  let bulkStock = Array.isArray(state.deed_bulkStock) ? [...(state.deed_bulkStock as any[])] : []
  let serials = Array.isArray(state.deed_serials) ? [...(state.deed_serials as any[])] : []
  let stockMoves = Array.isArray(state.deed_stockMoves) ? [...(state.deed_stockMoves as any[])] : []
  const products = Array.isArray(state.deed_products) ? (state.deed_products as any[]) : []
  const moveId = `sm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()

  if (plan.kind === 'return_bulk_to_testing') {
    // Relational write first — it is now the source of truth and enforces
    // the availability check for consume_bulk below; the blob write that
    // follows is a display-cache mirror, not the record of what happened.
    await applyBulkStockPlanToPrisma(plan, { unitCost, workOrderId: ctx.workOrderId, userId: ctx.userId, blobId: moveId })
    const idx = bulkStock.findIndex(b => b.productId === plan.productId && b.location === plan.to)
    if (idx >= 0) bulkStock[idx] = { ...bulkStock[idx], qty: (Number(bulkStock[idx].qty) || 0) + plan.qty }
    else bulkStock.push({ productId: plan.productId, location: plan.to, qty: plan.qty })
    stockMoves.push({
      id: moveId,
      type: 'in',
      productId: plan.productId,
      productName: plan.productName,
      qty: plan.qty,
      toLocation: plan.to,
      documentRef: plan.documentRef,
      date: now,
      unitCost,
      // Inventory report memos and StockMove typing expect `reason`.
      reason: plan.reason,
      notes: plan.reason,
    })
  } else if (plan.kind === 'consume_bulk') {
    // Throws 'Insufficient stock at <location>' if the relational bulk
    // stock level can't cover it — checked against the DB, not the blob.
    await applyBulkStockPlanToPrisma(plan, { unitCost, workOrderId: ctx.workOrderId, userId: ctx.userId, blobId: moveId })
    const idx = bulkStock.findIndex(b => b.productId === plan.productId && b.location === plan.from)
    const available = idx >= 0 ? Number(bulkStock[idx].qty) || 0 : 0
    bulkStock[idx >= 0 ? idx : bulkStock.length] = idx >= 0
      ? { ...bulkStock[idx], qty: Math.max(0, available - plan.qty) }
      : { productId: plan.productId, location: plan.from, qty: 0 }
    stockMoves.push({
      id: moveId,
      type: 'out',
      productId: plan.productId,
      productName: plan.productName,
      qty: plan.qty,
      fromLocation: plan.from,
      documentRef: plan.documentRef,
      date: now,
      unitCost,
      reason: plan.reason,
      notes: plan.reason,
    })
  } else if (plan.kind === 'return_serial_to_testing') {
    let serIdx = plan.serialId ? serials.findIndex(s => s.id === plan.serialId) : -1
    if (serIdx < 0 && plan.serialNumber) serIdx = serials.findIndex(s => s.serial === plan.serialNumber)
    if (serIdx >= 0) {
      serials[serIdx] = { ...serials[serIdx], location: plan.to, status: 'available' }
    } else if (plan.createIfMissing) {
      const prod = products.find(p => p.id === plan.productId)
      serials.push({
        id: `ser_${Date.now()}`,
        serial: plan.serialNumber || `RCF-${Date.now()}`,
        productId: plan.productId,
        productName: plan.productName || prod?.name,
        location: plan.to,
        status: 'available',
        receivedDate: now,
        barcode: plan.serialNumber || `RCF-${Date.now()}`,
      })
    }
    stockMoves.push({
      id: moveId,
      type: 'in',
      productId: plan.productId,
      productName: plan.productName,
      qty: 1,
      toLocation: plan.to,
      documentRef: plan.documentRef,
      date: now,
      unitCost,
      serialNumbers: plan.serialNumber ? [plan.serialNumber] : [],
      reason: plan.reason,
      notes: plan.reason,
    })
  } else if (plan.kind === 'consume_serial') {
    const serIdx = serials.findIndex(s => s.id === plan.serialId)
    if (serIdx < 0) throw httpError('Component serial not found in stock', 422)
    if (serials[serIdx].status !== 'available' && serials[serIdx].status !== 'assigned') {
      throw httpError('Component serial is not available', 422)
    }
    serials[serIdx] = { ...serials[serIdx], status: 'sold', location: 'repair_unit' }
    stockMoves.push({
      id: moveId,
      type: 'out',
      productId: plan.productId,
      productName: plan.productName,
      qty: 1,
      fromLocation: plan.from,
      documentRef: plan.documentRef,
      date: now,
      unitCost,
      serialNumbers: [plan.serialNumber],
      reason: plan.reason,
      notes: plan.reason,
    })
  }

  await saveStoreKeys({
    deed_bulkStock: JSON.stringify(bulkStock),
    deed_serials: JSON.stringify(serials),
    deed_stockMoves: JSON.stringify(stockMoves),
  })
  return moveId
}

export async function submitQa(params: {
  id: string
  version: number
  userId?: string
  results: Array<{ checkKey: string; result: 'pass' | 'fail' | 'na' | 'pending'; notes?: string | null }>
}) {
  const wo = await getWorkOrder(params.id)
  assertVersion(wo.version, params.version)
  if (wo.status !== 'in_progress' && wo.status !== 'pending_qa') {
    throw httpError('QA can only be submitted in progress', 422)
  }

  // All removals and installs must be done
  if (wo.removalLines.some(l => !l.actualRemovedAt)) {
    throw httpError('Record all component removals before QA', 422)
  }
  if (wo.installationLines.some(l => !l.installedAt)) {
    throw httpError('Record all component installations before QA', 422)
  }

  for (const r of params.results) {
    await prisma.reconfigurationQaCheck.updateMany({
      where: { workOrderId: wo.id, checkKey: r.checkKey },
      data: {
        result: r.result,
        notes: r.notes || null,
        checkedById: params.userId || null,
        checkedAt: new Date(),
      },
    })
  }

  const checks = await prisma.reconfigurationQaCheck.findMany({ where: { workOrderId: wo.id } })
  const failed = checks.some(c => c.required && c.result === 'fail')
  const pending = checks.some(c => c.required && (c.result === 'pending' || !c.result))

  if (failed) {
    await prisma.reconfigurationWorkOrder.update({
      where: { id: wo.id },
      data: { status: 'in_progress', updatedById: params.userId || null, version: { increment: 1 } },
    })
    throw httpError('QA failed — return to technician for rework', 422)
  }
  if (pending) {
    await prisma.reconfigurationWorkOrder.update({
      where: { id: wo.id },
      data: { status: 'pending_qa', updatedById: params.userId || null, version: { increment: 1 } },
    })
    return getWorkOrder(wo.id)
  }

  await prisma.reconfigurationWorkOrder.update({
    where: { id: wo.id },
    data: {
      status: 'pending_qa',
      qaOfficerId: params.userId || null,
      updatedById: params.userId || null,
      version: { increment: 1 },
    },
  })
  return getWorkOrder(wo.id)
}

export async function completeWorkOrder(params: {
  id: string
  version: number
  userId?: string
  finalSellingPrice?: number
  priceMethod?: string
}) {
  await ensureFeatureEnabled()
  const completionKey = reconfigCompletionEventKey(params.id)

  // Idempotent: already completed with same key
  const existing = await prisma.reconfigurationWorkOrder.findUnique({ where: { id: params.id } })
  if (!existing) throw httpError('Work order not found', 404)
  if (existing.status === 'completed' && existing.completionEventKey === completionKey) {
    return getWorkOrder(params.id)
  }
  if (existing.status === 'completed') {
    return getWorkOrder(params.id)
  }

  assertVersion(existing.version, params.version)
  if (!canTransition(existing.status as any, 'complete') && existing.status !== 'pending_qa') {
    throw httpError(`Cannot complete from ${existing.status}`, 422)
  }

  const wo = await getWorkOrder(params.id)

  // Validate QA
  const requiredFailed = wo.qaChecks.filter(c => c.required && c.result !== 'pass' && c.result !== 'na')
  if (requiredFailed.length) {
    throw httpError(`QA incomplete: ${requiredFailed.map(c => c.checkKey).join(', ')}`, 422)
  }
  if (wo.removalLines.some(l => !l.actualRemovedAt) || wo.installationLines.some(l => !l.installedAt)) {
    throw httpError('All removals and installations must be recorded', 422)
  }

  // Lock-ish: update with completion key first (unique) — second caller fails unique or sees completed
  try {
    await prisma.reconfigurationWorkOrder.update({
      where: { id: wo.id },
      data: { completionEventKey: completionKey },
    })
  } catch {
    return getWorkOrder(wo.id)
  }

  const selling = params.finalSellingPrice ?? dec(wo.finalSellingPrice ?? wo.recommendedSellingPrice)
  const margin = calculateMargin({ sellingPrice: selling, costAfter: dec(wo.costAfter) })

  // Promote proposed snapshot to current
  if (wo.proposedSnapshotId) {
    await prisma.deviceConfigurationSnapshot.updateMany({
      where: { serialId: wo.serialId, isCurrent: true },
      data: { isCurrent: false },
    })
    await prisma.deviceConfigurationSnapshot.update({
      where: { id: wo.proposedSnapshotId },
      data: { isCurrent: true },
    })
  }

  const proposed = wo.proposedSnapshot
  if (proposed) {
    await syncBlobSpecs(
      wo.serialId,
      specsFromProposed({
        processor: proposed.processor,
        processorGeneration: proposed.processorGeneration,
        totalRamGb: proposed.totalRamGb,
        ramComposition: (proposed.ramComposition as any) || [],
        primaryStorageGb: proposed.primaryStorageGb,
        storageType: proposed.storageType,
        displayName: proposed.displayName,
      } as any),
      wo.manufacturerSerial,
    )
  }

  // Update device serial cost
  await prisma.deviceSerialCost.upsert({
    where: { serialId: wo.serialId },
    create: {
      serialId: wo.serialId,
      currentCost: dec(wo.costAfter),
      updatedById: params.userId || null,
    },
    update: {
      currentCost: dec(wo.costAfter),
      updatedById: params.userId || null,
    },
  })

  // Release device back to warehouse/available
  const state = await loadAppState(['deed_serials'])
  const serials = Array.isArray(state.deed_serials) ? [...(state.deed_serials as any[])] : []
  const idx = serials.findIndex(s => s.id === wo.serialId || s.serial === wo.manufacturerSerial)
  if (idx >= 0) {
    const nextStatus =
      serials[idx].saleOrderId || serials[idx].status === 'assigned' ? 'assigned' : 'available'
    serials[idx] = {
      ...serials[idx],
      status: nextStatus,
      location: wo.warehouseLocation || 'warehouse',
      salePriceOverride: selling,
    }
    await saveStoreKeys({ deed_serials: JSON.stringify(serials) })
  }

  // Valuation journals (idempotent)
  const valKey = reconfigValuationEventKey(wo.ref)
  await postReconfigurationValuation({
    workOrder: wo,
    eventKey: valKey,
    userId: params.userId,
  })

  await prisma.reconfigurationWorkOrder.update({
    where: { id: wo.id },
    data: {
      status: 'completed',
      dateCompleted: new Date(),
      finalSellingPrice: selling,
      grossMargin: margin.grossMargin,
      grossMarginPct: margin.grossMarginPct,
      priceMethod: params.priceMethod || wo.priceMethod,
      valuationEventKey: valKey,
      updatedById: params.userId || null,
      version: { increment: 1 },
    },
  })

  // Phase E: refresh linked SO host line description to post-upgrade display name
  if (wo.linkedSaleOrderId) {
    try {
      const { refreshSaleOrderHostLineAfterReconfig } = await import('@/lib/reconfiguration/sales-bridge')
      await refreshSaleOrderHostLineAfterReconfig(wo.id)
    } catch (err) {
      console.error('[reconfiguration] SO line refresh after complete failed:', err)
    }
  }

  return getWorkOrder(wo.id)
}

async function postReconfigurationValuation(params: {
  workOrder: Awaited<ReturnType<typeof getWorkOrder>>
  eventKey: string
  userId?: string
}) {
  const { workOrder: wo, eventKey } = params
  try {
    const existing = await prisma.valuationEvent.findUnique({ where: { eventKey } })
    if (existing) return { skipped: true }
  } catch { /* */ }

  const inventoryLabel = formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.inventoryAccountCode, [])
  const adjustmentLabel = formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.adjustmentAccountCode, [])

  // Removed components: increase component inventory value (receipt-like)
  for (const line of wo.removalLines) {
    const qty = line.quantity
    const unitCost = dec(line.existingCost)
    try {
      const val = await prisma.productValuation.findUnique({ where: { productId: line.componentProductId } })
      const currentQty = val?.totalQty ?? 0
      const currentValue = dec(val?.totalValue)
      const next = applyReceiptAverage({ currentQty, currentValue, qty, unitCost })
      await prisma.productValuation.upsert({
        where: { productId: line.componentProductId },
        create: {
          productId: line.componentProductId,
          averageCost: next.averageCost,
          totalQty: next.totalQty,
          totalValue: next.totalValue,
        },
        update: {
          averageCost: next.averageCost,
          totalQty: next.totalQty,
          totalValue: next.totalValue,
        },
      })
    } catch { /* product may be blob-only */ }
  }

  // Installed components: decrease component inventory value (delivery-like)
  for (const line of wo.installationLines) {
    const qty = line.quantity
    try {
      const val = await prisma.productValuation.findUnique({ where: { productId: line.componentProductId } })
      const avg = val ? dec(val.averageCost) : dec(line.unitCost)
      const currentQty = val?.totalQty ?? 0
      const currentValue = dec(val?.totalValue)
      const next = applyDeliveryAverage({ currentQty, currentValue, averageCost: avg, qty })
      if (val) {
        await prisma.productValuation.update({
          where: { productId: line.componentProductId },
          data: {
            averageCost: next.averageCost,
            totalQty: next.totalQty,
            totalValue: next.totalValue,
          },
        })
      }
    } catch { /* */ }
  }

  const costRemoved = dec(wo.costRemoved)
  const costInstalled = dec(wo.costInstalled)
  const labour = dec(wo.labourCost) + dec(wo.otherCost)

  const lines: Array<{ accountLabel: string; debit: number; credit: number; memo: string }> = []
  if (costRemoved > 0) {
    lines.push({ accountLabel: inventoryLabel, debit: costRemoved, credit: 0, memo: `${wo.ref} components returned` })
    lines.push({ accountLabel: inventoryLabel, debit: 0, credit: costRemoved, memo: `${wo.ref} device cost removed` })
  }
  if (costInstalled > 0) {
    lines.push({ accountLabel: inventoryLabel, debit: costInstalled, credit: 0, memo: `${wo.ref} device cost installed` })
    lines.push({ accountLabel: inventoryLabel, debit: 0, credit: costInstalled, memo: `${wo.ref} components consumed` })
  }
  if (labour > 0) {
    lines.push({ accountLabel: inventoryLabel, debit: labour, credit: 0, memo: `${wo.ref} capitalised labour/other` })
    lines.push({ accountLabel: adjustmentLabel, debit: 0, credit: labour, memo: `${wo.ref} labour/other clearing` })
  }

  if (lines.length) {
    try {
      await createJournalEntry({
        ref: reconfigValuationJournalRef(wo.ref),
        date: new Date(),
        description: `Device reconfiguration ${wo.ref}`,
        sourceType: 'reconfiguration',
        sourceId: wo.id,
        journalCode: 'STK',
        lines: lines.map(l => ({
          accountLabel: l.accountLabel,
          debit: l.debit,
          credit: l.credit,
          label: l.memo,
        })),
        createdById: params.userId || null,
        skipIfExists: true,
      })
    } catch (err) {
      console.error('[reconfig valuation journal]', err)
    }
  }

  try {
    await prisma.valuationEvent.create({
      data: {
        eventKey,
        kind: 'reconfiguration',
        productId: wo.productId,
        qty: 1,
        unitCost: dec(wo.costAfter),
        reference: wo.ref,
      },
    })
  } catch { /* unique = already processed */ }

  return { ok: true }
}

export async function cancelWorkOrder(params: { id: string; version: number; userId?: string; reason: string }) {
  const wo = await getWorkOrder(params.id)
  assertVersion(wo.version, params.version)
  if (wo.status === 'completed' || wo.status === 'reversed') {
    throw httpError('Completed work orders cannot be cancelled — create a reversal', 422)
  }
  if (wo.removalLines.some(l => l.actualRemovedAt) || wo.installationLines.some(l => l.installedAt)) {
    throw httpError('Stock has already moved. Complete via exception/reversal workflow instead of cancel.', 422)
  }

  const state = await loadAppState(['deed_stockReservations', 'deed_serials'])
  let reservations = Array.isArray(state.deed_stockReservations) ? [...(state.deed_stockReservations as any[])] : []
  reservations = reservations.map(r =>
    r.referenceId === wo.id && r.status === 'reserved'
      ? { ...r, status: 'cancelled', releasedDate: new Date().toISOString() }
      : r,
  )
  const serials = Array.isArray(state.deed_serials) ? [...(state.deed_serials as any[])] : []
  const idx = serials.findIndex(s => s.id === wo.serialId || s.serial === wo.manufacturerSerial)
  if (idx >= 0 && serials[idx].status === 'reconfiguration') {
    serials[idx] = { ...serials[idx], status: 'available', location: wo.warehouseLocation || 'warehouse' }
  }
  await saveStoreKeys({
    deed_stockReservations: JSON.stringify(reservations),
    deed_serials: JSON.stringify(serials),
  })
  await mirrorStockReservationsToPrisma(reservations).catch(() => null)

  await prisma.reconfigurationWorkOrder.update({
    where: { id: wo.id },
    data: {
      status: 'cancelled',
      notes: [wo.notes, `Cancelled: ${params.reason}`].filter(Boolean).join('\n'),
      updatedById: params.userId || null,
      version: { increment: 1 },
    },
  })
  return getWorkOrder(wo.id)
}

export async function calculateDiffForDevice(params: {
  serialId: string
  target: TargetConfigInput
}) {
  const device = await getDeviceConfiguration(params.serialId)
  const diff = calculateConfigurationDiff({
    installed: device.installed,
    current: device.current,
    target: params.target,
    productName: device.productName,
  })
  const compat = checkCompatibility({
    installed: device.installed,
    target: params.target,
    issuesFromDiff: diff.issues,
  })
  return { device, diff, compat }
}

export { applyTargetToWorkOrder }
