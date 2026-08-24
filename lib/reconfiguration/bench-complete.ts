/**
 * One-shot bench complete: pick the machine, pick pull / swap / add for RAM
 * and/or SSD, post. Skips stock-check → reserve → approve → QA.
 *
 * Stock, snapshots, serial.specs, cost, and the unit selling name still
 * update the same way completeWorkOrder does — this only shortens the
 * operator path. Catalog Product.name is not rewritten.
 */
import 'server-only'

import prisma from '@/lib/prisma'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { round2 } from '@/lib/inventory/valuation-math'
import { planComponentInstall, planComponentRemoval } from '@/lib/inventory/reconfiguration-stock'
import {
  calculateMargin,
  calculateRecommendedSellingPrice,
  calculateReconfigCost,
  reconfigCompletionEventKey,
  reconfigValuationEventKey,
} from '@/lib/reconfiguration/costing'
import { specsFromProposed } from '@/lib/reconfiguration/diff-engine'
import {
  applyBenchJob,
  modulesFromInstalled,
  type BenchActionKind,
  type BenchSlotRequest,
} from '@/lib/reconfiguration/bench-action'
import {
  applyStockPlan,
  cancelWorkOrder,
  getDeviceConfiguration,
  getWorkOrder,
  postReconfigurationValuation,
  syncBlobSpecs,
} from '@/lib/reconfiguration/service'
import type { DeviceConfigFields } from '@/lib/reconfiguration/types'

function dec(n: unknown) {
  return round2(Number(n) || 0)
}

function httpError(message: string, status = 400) {
  const err = new Error(message) as Error & { status: number }
  err.status = status
  return err
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_RE.test(value))
}

export type BenchSlotInput = {
  action: BenchActionKind
  moduleCount?: number
  pullCapacityGb?: number
  incomingProductId?: string
  incomingCapacityGb?: number
  outgoingProductId?: string
  storageType?: string | null
}

export type ApplyBenchParams = {
  serialId: string
  userId?: string
  ram: BenchSlotInput
  storage: BenchSlotInput
  reason?: string
  warehouseLocation?: string
  linkedSaleOrderId?: string | null
  finalSellingPrice?: number | null
  labourCost?: number
  otherCost?: number
  currentRamGb?: number
  currentStorageGb?: number
}

async function partMeta(productId: string) {
  if (!isUuid(productId)) {
    throw httpError('Parts must be a catalog product (RAM or SSD SKU).', 422)
  }
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, sku: true, costPrice: true },
  })
  if (!product) throw httpError('Parts product not found in the catalog.', 422)
  let unitCost = dec(product.costPrice)
  try {
    const val = await prisma.productValuation.findUnique({ where: { productId } })
    if (val && dec(val.averageCost) > 0) unitCost = dec(val.averageCost)
  } catch {
    /* blob-only valuation */
  }
  return { ...product, unitCost }
}

async function assertIncomingStock(productId: string, location: string, qty: number, name: string) {
  const row = await prisma.bulkStockLevel.findUnique({
    where: { productId_location: { productId, location } },
  })
  let prismaQty = row?.qty ?? 0
  if (prismaQty >= qty) return

  // Opening-stock / inventory UI writes deed_bulkStock (+ stock_levels).
  // Bench Apply used to look only at bulk_stock_levels, so a part could show
  // 1 in warehouse and still fail with "have 0".
  const state = await loadAppState(['deed_bulkStock'])
  const blobQty = (Array.isArray(state.deed_bulkStock) ? state.deed_bulkStock : [])
    .filter((b: { productId?: string; location?: string }) => b.productId === productId && b.location === location)
    .reduce((sum: number, b: { qty?: number }) => sum + (Number(b.qty) || 0), 0)
  if (blobQty >= qty) {
    await prisma.bulkStockLevel.upsert({
      where: { productId_location: { productId, location } },
      create: { productId, location, qty: blobQty },
      update: { qty: Math.max(prismaQty, blobQty) },
    })
    return
  }

  throw httpError(
    `Insufficient stock for ${name} at ${location} (need ${qty}, have ${prismaQty}).`,
    422,
  )
}

function toSlotRequest(
  input: BenchSlotInput,
  currentTotalGb: number,
  installed: ReturnType<typeof modulesFromInstalled>,
  incoming?: { productId: string; capacityGb: number; productName?: string },
  outgoingName?: string,
): Omit<BenchSlotRequest, 'slot'> {
  return {
    action: input.action || 'none',
    currentTotalGb,
    moduleCount: input.moduleCount,
    currentModules: installed.length ? installed : undefined,
    pullCapacityGb: input.pullCapacityGb,
    incoming,
    outgoingProductId: input.outgoingProductId,
    outgoingProductName: outgoingName,
    storageType: input.storageType,
  }
}

async function seedDeclaredModule(params: {
  serialId: string
  userId?: string
  slot: 'ram' | 'storage'
  productId: string
  capacityGb: number
  slotNumber: number
  removable?: boolean
}): Promise<string> {
  const row = await prisma.deviceComponentInstallation.create({
    data: {
      serialId: params.serialId,
      componentProductId: params.productId,
      category: params.slot === 'ram' ? 'ram' : 'storage',
      slotType: params.slot === 'ram' ? 'ram_slot' : 'm2_slot',
      slotNumber: params.slotNumber,
      capacityGb: params.capacityGb,
      removable: params.removable !== false,
      status: 'installed',
      installedById: params.userId || null,
    },
  })
  return row.id
}

export async function applyBenchAndComplete(params: ApplyBenchParams) {
  const device = await getDeviceConfiguration(params.serialId)

  if (device.activeWorkOrder) {
    throw httpError(`Device already has active reconfiguration ${device.activeWorkOrder.ref}`, 409)
  }
  if (['sold', 'customer'].includes(String(device.status)) || device.location === 'customer') {
    throw httpError('Delivered/sold devices cannot be reconfigured here.', 422)
  }
  if (!isUuid(device.serialId) || !isUuid(device.productId || '')) {
    throw httpError('This serial is not linked to the catalog yet — receive it into inventory first.', 422)
  }

  const ramInstalled = modulesFromInstalled(device.installed, 'ram')
  const storageInstalled = modulesFromInstalled(device.installed, 'storage')
  const currentRam =
    Number(params.currentRamGb) > 0
      ? Number(params.currentRamGb)
      : Number(device.current.totalRamGb) || ramInstalled.reduce((s, m) => s + m.capacityGb, 0)
  const currentStorage =
    Number(params.currentStorageGb) > 0
      ? Number(params.currentStorageGb)
      : Number(device.current.primaryStorageGb) || storageInstalled.reduce((s, m) => s + m.capacityGb, 0)

  const current = {
    ...device.current,
    totalRamGb: currentRam,
    primaryStorageGb: currentStorage || device.current.primaryStorageGb,
  }

  if ((params.ram.action || 'none') !== 'none' && currentRam <= 0) {
    throw httpError('Could not read RAM from this unit or its product name. Enter current RAM GB.', 422)
  }
  if ((params.storage.action || 'none') !== 'none' && currentStorage <= 0) {
    throw httpError('Could not read SSD from this unit or its product name. Enter current storage GB.', 422)
  }

  const ramOut = params.ram.outgoingProductId ? await partMeta(params.ram.outgoingProductId) : null
  const ramIn = params.ram.incomingProductId ? await partMeta(params.ram.incomingProductId) : null
  const ssdOut = params.storage.outgoingProductId ? await partMeta(params.storage.outgoingProductId) : null
  const ssdIn = params.storage.incomingProductId ? await partMeta(params.storage.incomingProductId) : null

  const ramReq = toSlotRequest(
    params.ram,
    currentRam,
    ramInstalled,
    ramIn
      ? {
          productId: ramIn.id,
          capacityGb: params.ram.incomingCapacityGb || 0,
          productName: ramIn.name,
        }
      : undefined,
    ramOut?.name,
  )
  const storageReq = toSlotRequest(
    params.storage,
    currentStorage,
    storageInstalled,
    ssdIn
      ? {
          productId: ssdIn.id,
          capacityGb: params.storage.incomingCapacityGb || 0,
          productName: ssdIn.name,
        }
      : undefined,
    ssdOut?.name,
  )
  storageReq.storageType = params.storage.storageType || device.current.storageType || 'SSD'

  const job = applyBenchJob({
    productName: device.productName,
    current,
    ram: ramReq,
    storage: storageReq,
  })
  if (job.error) throw httpError(job.error, 422)

  const location = params.warehouseLocation || device.location || 'warehouse'

  // Fail closed on incoming parts before we create a work order.
  for (const move of [...job.ram.installations, ...job.storage.installations]) {
    const meta = await partMeta(move.productId)
    await assertIncomingStock(move.productId, location, 1, meta.name)
  }

  const costInstalled = [...job.ram.installations, ...job.storage.installations].reduce((s, move) => {
    const meta = move.productId === ramIn?.id ? ramIn : move.productId === ssdIn?.id ? ssdIn : null
    return s + (meta?.unitCost || 0)
  }, 0)
  const preCost = calculateReconfigCost({
    costBefore: device.costBefore,
    costRemoved: 0,
    costInstalled,
    labourCost: params.labourCost || 0,
    otherCost: params.otherCost || 0,
  })
  if (preCost.blocked) {
    throw httpError(preCost.reason || 'Reconfiguration would produce a negative device cost.', 422)
  }

  const ref = await getNextDocNumber('reconfiguration')
  const reason = (params.reason || '').trim() || job.reason
  const notes = JSON.stringify({
    bench: {
      version: 1,
      ram: params.ram,
      storage: params.storage,
      nameBefore: job.before.displayName,
      nameAfter: job.after.displayName,
    },
  })

  const wo = await prisma.reconfigurationWorkOrder.create({
    data: {
      ref,
      serialId: device.serialId,
      manufacturerSerial: device.manufacturerSerial,
      productId: device.productId!,
      transactionType: job.transactionType,
      status: 'in_progress',
      reason,
      notes,
      warehouseLocation: location,
      linkedSaleOrderId: isUuid(params.linkedSaleOrderId) ? params.linkedSaleOrderId : null,
      requestedById: params.userId || null,
      technicianId: params.userId || null,
      createdById: params.userId || null,
      updatedById: params.userId || null,
      dateStarted: new Date(),
      costBefore: device.costBefore,
      sellingPriceBefore: device.sellingPriceBefore,
      labourCost: params.labourCost || 0,
      otherCost: params.otherCost || 0,
    },
  })

  await prisma.deviceSerialCost.upsert({
    where: { serialId: device.serialId },
    create: { serialId: device.serialId, currentCost: device.costBefore, updatedById: params.userId || null },
    update: {},
  })

  const proposedConfig: DeviceConfigFields = {
    ...device.current,
    totalRamGb: job.after.ramGb,
    ramComposition: job.ram.remainingModules.map(m => ({
      slotType: 'ram_slot' as const,
      slotNumber: m.slotNumber || 1,
      capacityGb: m.capacityGb,
      removable: m.removable,
      productId: m.productId,
      installationId: m.installationId,
    })),
    primaryStorageGb: job.after.storageGb,
    storageType: job.after.storageType,
    displayName: job.after.displayName,
  }

  await prisma.deviceConfigurationSnapshot.updateMany({
    where: { serialId: device.serialId, isCurrent: true },
    data: { isCurrent: false },
  })
  const currentSnap = await prisma.deviceConfigurationSnapshot.create({
    data: {
      serialId: device.serialId,
      processor: device.current.processor,
      processorGeneration: device.current.processorGeneration,
      totalRamGb: device.current.totalRamGb,
      ramComposition: (device.current.ramComposition || []) as any,
      primaryStorageGb: device.current.primaryStorageGb,
      storageType: device.current.storageType,
      displayName: job.before.displayName,
      source: 'reconfiguration',
      sourceWorkOrderId: wo.id,
      isCurrent: true,
      createdById: params.userId || null,
    },
  })
  const proposedSnap = await prisma.deviceConfigurationSnapshot.create({
    data: {
      serialId: device.serialId,
      processor: proposedConfig.processor,
      processorGeneration: proposedConfig.processorGeneration,
      totalRamGb: proposedConfig.totalRamGb,
      ramComposition: proposedConfig.ramComposition as any,
      primaryStorageGb: proposedConfig.primaryStorageGb,
      storageType: proposedConfig.storageType,
      displayName: proposedConfig.displayName,
      source: 'reconfiguration',
      sourceWorkOrderId: wo.id,
      isCurrent: false,
      createdById: params.userId || null,
    },
  })

  let costRemoved = 0
  let installedCost = 0

  try {
    // Consume incoming parts first so a missing stick/drive fails closed
    // before anything is pulled from the machine.
    for (const move of [...job.ram.installations, ...job.storage.installations]) {
      const meta = await partMeta(move.productId)
      installedCost += meta.unitCost
      const line = await prisma.reconfigurationInstallationLine.create({
        data: {
          workOrderId: wo.id,
          componentProductId: move.productId,
          requiredSpec: {
            capacityGb: move.capacityGb,
            category: move.slot,
          },
          sourceLocation: location,
          quantity: 1,
          unitCost: meta.unitCost,
          targetSlotType: move.slot === 'ram' ? 'ram_slot' : 'm2_slot',
          targetSlotNumber: move.slotNumber,
          compatibilityResult: 'pass',
        },
      })

      const plan = planComponentInstall({
        documentRef: ref,
        productId: move.productId,
        productName: meta.name,
        qty: 1,
        from: location as any,
      })
      const moveRef = await applyStockPlan(plan, meta.unitCost, { workOrderId: wo.id, userId: params.userId })

      const installation = await prisma.deviceComponentInstallation.create({
        data: {
          serialId: device.serialId,
          componentProductId: move.productId,
          category: move.slot === 'ram' ? 'ram' : 'storage',
          slotType: move.slot === 'ram' ? 'ram_slot' : 'm2_slot',
          slotNumber: move.slotNumber,
          capacityGb: move.capacityGb,
          quantity: 1,
          removable: true,
          status: 'installed',
          costAtInstallation: meta.unitCost,
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
          resultingInstallationId: installation.id,
          reservationStatus: 'fulfilled',
          stockMoveRef: moveRef,
        },
      })
    }

    for (const move of [...job.ram.removals, ...job.storage.removals]) {
      const meta = await partMeta(move.productId)
      let installationId = move.installationId
      if (!installationId) {
        installationId = await seedDeclaredModule({
          serialId: device.serialId,
          userId: params.userId,
          slot: move.slot,
          productId: move.productId,
          capacityGb: move.capacityGb,
          slotNumber: move.slotNumber,
        })
      }
      const existing = await prisma.deviceComponentInstallation.findUnique({ where: { id: installationId } })
      const existingCost = dec(existing?.costAtInstallation)
      costRemoved += existingCost

      const removal = await prisma.reconfigurationRemovalLine.create({
        data: {
          workOrderId: wo.id,
          installationId,
          componentProductId: move.productId,
          slotType: move.slot === 'ram' ? 'ram_slot' : 'm2_slot',
          slotNumber: move.slotNumber,
          quantity: 1,
          existingCost,
          destinationLocation: 'pending_testing',
          disposition: 'pending_testing',
          dataStatus: move.slot === 'storage' ? 'unknown' : null,
        },
      })

      const plan = planComponentRemoval({
        documentRef: ref,
        productId: move.productId,
        productName: meta.name,
        qty: 1,
        disposition: 'pending_testing',
      })
      const moveRef = await applyStockPlan(plan, existingCost, { workOrderId: wo.id, userId: params.userId })

      await prisma.deviceComponentInstallation.update({
        where: { id: installationId },
        data: {
          status: 'removed',
          removedAt: new Date(),
          removedById: params.userId || null,
          removalWorkOrderId: wo.id,
        },
      })
      await prisma.reconfigurationRemovalLine.update({
        where: { id: removal.id },
        data: {
          actualRemovedAt: new Date(),
          removedById: params.userId || null,
          stockMoveRef: moveRef,
        },
      })
    }

    for (const m of job.ram.remainingModules) {
      if (m.installationId || !m.productId || !isUuid(m.productId)) continue
      await seedDeclaredModule({
        serialId: device.serialId,
        userId: params.userId,
        slot: 'ram',
        productId: m.productId,
        capacityGb: m.capacityGb,
        slotNumber: m.slotNumber || 1,
      })
    }
    for (const m of job.storage.remainingModules) {
      if (m.installationId || !m.productId || !isUuid(m.productId)) continue
      await seedDeclaredModule({
        serialId: device.serialId,
        userId: params.userId,
        slot: 'storage',
        productId: m.productId,
        capacityGb: m.capacityGb,
        slotNumber: m.slotNumber || 1,
      })
    }
  } catch (err) {
    try {
      const latest = await prisma.reconfigurationWorkOrder.findUnique({ where: { id: wo.id }, select: { version: true } })
      if (latest) {
        await cancelWorkOrder({
          id: wo.id,
          version: latest.version,
          userId: params.userId,
          reason: err instanceof Error ? err.message : 'Bench apply failed',
        })
      }
    } catch {
      /* stock may already have moved — leave the work order for a human */
    }
    throw err
  }

  const cost = calculateReconfigCost({
    costBefore: device.costBefore,
    costRemoved,
    costInstalled: installedCost,
    labourCost: params.labourCost || 0,
    otherCost: params.otherCost || 0,
  })

  const price = calculateRecommendedSellingPrice({
    method: params.finalSellingPrice != null ? 'manual' : 'cost_plus',
    costAfter: cost.costAfter,
    sellingPriceBefore: device.sellingPriceBefore,
    markupPct: 25,
    manualPrice: params.finalSellingPrice ?? undefined,
  })
  const selling =
    params.finalSellingPrice != null && params.finalSellingPrice >= 0
      ? dec(params.finalSellingPrice)
      : price.recommended
  const margin = calculateMargin({ sellingPrice: selling, costAfter: cost.costAfter })
  const completionKey = reconfigCompletionEventKey(wo.id)
  const valKey = reconfigValuationEventKey(ref)

  // Unit identity: blob specs become the new RAM/SSD string. Catalog name stays.
  await syncBlobSpecs(
    device.blobSerialId || device.serialId,
    specsFromProposed(proposedConfig),
    device.manufacturerSerial,
  )

  const state = await loadAppState(['deed_serials'])
  const serials = Array.isArray(state.deed_serials) ? [...(state.deed_serials as any[])] : []
  const idx = serials.findIndex(
    s => s.id === device.serialId || s.id === device.blobSerialId || s.serial === device.manufacturerSerial,
  )
  if (idx >= 0) {
    const nextStatus =
      serials[idx].saleOrderId || serials[idx].status === 'assigned' ? 'assigned' : 'available'
    serials[idx] = {
      ...serials[idx],
      status: nextStatus,
      location: location === 'repair_unit' ? 'warehouse' : location,
      specs: specsFromProposed(proposedConfig),
      salePriceOverride: selling,
    }
    await saveStoreKeys({ deed_serials: JSON.stringify(serials) })
  }

  await prisma.deviceSerialCost.upsert({
    where: { serialId: device.serialId },
    create: {
      serialId: device.serialId,
      currentCost: cost.costAfter,
      updatedById: params.userId || null,
    },
    update: {
      currentCost: cost.costAfter,
      updatedById: params.userId || null,
    },
  })

  await prisma.deviceConfigurationSnapshot.updateMany({
    where: { serialId: device.serialId, isCurrent: true },
    data: { isCurrent: false },
  })
  await prisma.deviceConfigurationSnapshot.update({
    where: { id: proposedSnap.id },
    data: { isCurrent: true },
  })

  await prisma.reconfigurationWorkOrder.update({
    where: { id: wo.id },
    data: {
      status: 'completed',
      dateCompleted: new Date(),
      currentSnapshotId: currentSnap.id,
      proposedSnapshotId: proposedSnap.id,
      costRemoved: cost.costRemoved,
      costInstalled: cost.costInstalled,
      costAfter: cost.costAfter,
      recommendedSellingPrice: price.recommended,
      finalSellingPrice: selling,
      priceDifference: round2(selling - dec(device.sellingPriceBefore)),
      grossMargin: margin.grossMargin,
      grossMarginPct: margin.grossMarginPct,
      priceMethod: params.finalSellingPrice != null ? 'manual' : 'cost_plus',
      completionEventKey: completionKey,
      valuationEventKey: valKey,
      updatedById: params.userId || null,
      version: { increment: 1 },
    },
  })

  const completed = await getWorkOrder(wo.id)
  await postReconfigurationValuation({
    workOrder: completed,
    eventKey: valKey,
    userId: params.userId,
  })

  if (completed.linkedSaleOrderId) {
    try {
      const { refreshSaleOrderHostLineAfterReconfig } = await import('@/lib/reconfiguration/sales-bridge')
      await refreshSaleOrderHostLineAfterReconfig(wo.id)
    } catch (err) {
      console.error('[reconfiguration] SO line refresh after bench complete failed:', err)
    }
  }

  return getWorkOrder(wo.id)
}
