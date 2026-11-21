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
import { loadAppState, loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { createJournalEntry } from '@/lib/accounting/journal-service'
import { round2 } from '@/lib/inventory/valuation-math'
import { planComponentInstall, planComponentRemoval } from '@/lib/inventory/reconfiguration-stock'
import {
  calculateMargin,
  calculateRecommendedSellingPrice,
  calculateReconfigCost,
  defaultPriceAfterBench,
  reconfigCompletionEventKey,
  reconfigValuationEventKey,
  reconfigValuationJournalRef,
} from '@/lib/reconfiguration/costing'
import { specsFromProposed } from '@/lib/reconfiguration/diff-engine'
import { snapshotTextFields } from '@/lib/reconfiguration/snapshot-write'
import {
  applyBenchJob,
  modulesFromInstalled,
  remainingModulesToSeed,
  reuseSeededInstallId,
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
import { readBenchNotes, type BenchNotes } from '@/lib/reconfiguration/bench-notes'

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

type BenchSlotInput = {
  action: BenchActionKind
  moduleCount?: number
  pullCapacityGb?: number
  incomingProductId?: string
  incomingCapacityGb?: number
  outgoingProductId?: string
  storageType?: string | null
}

type ApplyBenchParams = {
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
  const slotType = params.slot === 'ram' ? 'ram_slot' : 'm2_slot'
  const existing = await prisma.deviceComponentInstallation.findFirst({
    where: {
      serialId: params.serialId,
      slotType,
      slotNumber: params.slotNumber,
      status: 'installed',
    },
    select: { id: true, componentProductId: true },
  })
  const reuseId = reuseSeededInstallId(existing, params.productId)
  if (reuseId) return reuseId
  if (existing) {
    throw httpError(
      `Slot ${slotType} ${params.slotNumber} already has another part installed. Pull or swap it before seeding this module.`,
      409,
    )
  }
  const row = await prisma.deviceComponentInstallation.create({
    data: {
      serialId: params.serialId,
      componentProductId: params.productId,
      category: params.slot === 'ram' ? 'ram' : 'storage',
      slotType,
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

  const notes = JSON.stringify({
    bench: {
      version: 2,
      ram: params.ram,
      storage: params.storage,
      nameBefore: job.before.displayName,
      nameAfter: job.after.displayName,
      // What the finish step needs, so a stuck job can be finished later.
      finalSellingPrice: params.finalSellingPrice ?? null,
      before: current,
      proposed: proposedConfig,
    },
  } satisfies { bench: BenchNotes })

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

  await prisma.deviceConfigurationSnapshot.updateMany({
    where: { serialId: device.serialId, isCurrent: true },
    data: { isCurrent: false },
  })
  const currentSnap = await prisma.deviceConfigurationSnapshot.create({
    data: {
      serialId: device.serialId,
      ...snapshotTextFields({
        processor: device.current.processor,
        processorGeneration: device.current.processorGeneration,
        storageType: device.current.storageType,
        displayName: job.before.displayName,
      }),
      totalRamGb: device.current.totalRamGb,
      ramComposition: (device.current.ramComposition || []) as any,
      primaryStorageGb: device.current.primaryStorageGb,
      source: 'reconfiguration',
      sourceWorkOrderId: wo.id,
      isCurrent: true,
      createdById: params.userId || null,
    },
  })
  const proposedSnap = await prisma.deviceConfigurationSnapshot.create({
    data: {
      serialId: device.serialId,
      ...snapshotTextFields({
        processor: proposedConfig.processor,
        processorGeneration: proposedConfig.processorGeneration,
        storageType: proposedConfig.storageType,
        displayName: proposedConfig.displayName,
      }),
      totalRamGb: proposedConfig.totalRamGb,
      ramComposition: proposedConfig.ramComposition as any,
      primaryStorageGb: proposedConfig.primaryStorageGb,
      source: 'reconfiguration',
      sourceWorkOrderId: wo.id,
      isCurrent: false,
      createdById: params.userId || null,
    },
  })

  await prisma.reconfigurationWorkOrder.update({
    where: { id: wo.id },
    data: {
      currentSnapshotId: currentSnap.id,
      proposedSnapshotId: proposedSnap.id,
      version: { increment: 1 },
    },
  })

  // ── Plan: every part to pull and fit is written down before any moves ──
  // A job that stops half-way then knows exactly what is still owed.
  for (const move of [...job.ram.removals, ...job.storage.removals]) {
    const installationId = move.installationId || await seedDeclaredModule({
      serialId: device.serialId,
      userId: params.userId,
      slot: move.slot,
      productId: move.productId,
      capacityGb: move.capacityGb,
      slotNumber: move.slotNumber,
    })
    const existing = await prisma.deviceComponentInstallation.findUnique({ where: { id: installationId } })
    await prisma.reconfigurationRemovalLine.create({
      data: {
        workOrderId: wo.id,
        installationId,
        componentProductId: move.productId,
        slotType: move.slot === 'ram' ? 'ram_slot' : 'm2_slot',
        slotNumber: move.slotNumber,
        quantity: 1,
        existingCost: dec(existing?.costAtInstallation),
        destinationLocation: 'pending_testing',
        disposition: 'pending_testing',
        dataStatus: move.slot === 'storage' ? 'unknown' : null,
      },
    })
  }
  for (const move of [...job.ram.installations, ...job.storage.installations]) {
    const meta = await partMeta(move.productId)
    await prisma.reconfigurationInstallationLine.create({
      data: {
        workOrderId: wo.id,
        componentProductId: move.productId,
        requiredSpec: { capacityGb: move.capacityGb, category: move.slot },
        sourceLocation: location,
        quantity: 1,
        unitCost: meta.unitCost,
        targetSlotType: move.slot === 'ram' ? 'ram_slot' : 'm2_slot',
        targetSlotNumber: move.slotNumber,
        compatibilityResult: 'pass',
      },
    })
  }
  for (const m of remainingModulesToSeed(job.ram.remainingModules, job.ram.installations)) {
    if (!isUuid(m.productId)) continue
    await seedDeclaredModule({ serialId: device.serialId, userId: params.userId, slot: 'ram', productId: m.productId, capacityGb: m.capacityGb, slotNumber: m.slotNumber || 1 })
  }
  for (const m of remainingModulesToSeed(job.storage.remainingModules, job.storage.installations)) {
    if (!isUuid(m.productId)) continue
    await seedDeclaredModule({ serialId: device.serialId, userId: params.userId, slot: 'storage', productId: m.productId, capacityGb: m.capacityGb, slotNumber: m.slotNumber || 1 })
  }

  return runBenchJob(wo.id, params.userId)
}

// ── Running, finishing, undoing and reversing a bench job ────────────────────

async function writeBenchNotes(id: string, patch: Partial<BenchNotes>) {
  const wo = await prisma.reconfigurationWorkOrder.findUnique({ where: { id }, select: { notes: true } })
  const bench = readBenchNotes(wo?.notes)
  if (!bench) return
  await prisma.reconfigurationWorkOrder.update({
    where: { id },
    data: { notes: JSON.stringify({ bench: { ...bench, ...patch } }) },
  })
}

function configFromSnapshot(snap: Record<string, any> | null | undefined): DeviceConfigFields | null {
  if (!snap) return null
  return {
    processor: snap.processor,
    processorGeneration: snap.processorGeneration,
    totalRamGb: Number(snap.totalRamGb) || 0,
    ramComposition: Array.isArray(snap.ramComposition) ? snap.ramComposition : [],
    primaryStorageGb: snap.primaryStorageGb,
    secondaryStorageGb: snap.secondaryStorageGb,
    storageType: snap.storageType,
    screenSize: snap.screenSize,
    screenResolution: snap.screenResolution,
    touchscreen: snap.touchscreen,
    graphics: snap.graphics,
    operatingSystem: snap.operatingSystem,
    keyboardLayout: snap.keyboardLayout,
    colour: snap.colour,
    batteryCondition: snap.batteryCondition,
    grade: snap.grade,
    displayName: snap.displayName,
  }
}

const partMoved = (wo: Awaited<ReturnType<typeof getWorkOrder>>) =>
  wo.removalLines.some(l => l.actualRemovedAt) || wo.installationLines.some(l => l.installedAt)

/**
 * Move every part the job still owes. Each move commits together with its
 * line's "done" mark, so running this again after a failure skips what is
 * already done and never moves a part twice.
 */
async function runBenchMoves(id: string, userId?: string) {
  const wo = await getWorkOrder(id)
  for (const line of wo.removalLines) {
    if (line.actualRemovedAt) continue
    const plan = planComponentRemoval({
      documentRef: wo.ref,
      productId: line.componentProductId,
      productName: line.componentProduct?.name ?? 'Part',
      qty: line.quantity,
      disposition: 'pending_testing',
    })
    await applyStockPlan(plan, dec(line.existingCost), {
      workOrderId: wo.id,
      userId,
      inTx: async (tx, movementId) => {
        await tx.deviceComponentInstallation.update({
          where: { id: line.installationId },
          data: { status: 'removed', removedAt: new Date(), removedById: userId || null, removalWorkOrderId: wo.id },
        })
        await tx.reconfigurationRemovalLine.update({
          where: { id: line.id },
          data: { actualRemovedAt: new Date(), removedById: userId || null, stockMoveRef: movementId.slice(0, 80) },
        })
      },
    })
  }
  for (const line of wo.installationLines) {
    if (line.installedAt) continue
    const plan = planComponentInstall({
      documentRef: wo.ref,
      productId: line.componentProductId,
      productName: line.componentProduct?.name ?? 'Part',
      qty: line.quantity,
      from: (line.sourceLocation || wo.warehouseLocation || 'warehouse') as any,
    })
    await applyStockPlan(plan, dec(line.unitCost), {
      workOrderId: wo.id,
      userId,
      inTx: async (tx, movementId) => {
        const spec = (line.requiredSpec ?? {}) as { capacityGb?: number; category?: string }
        const installation = await tx.deviceComponentInstallation.create({
          data: {
            serialId: wo.serialId,
            componentProductId: line.componentProductId,
            category: spec.category === 'ram' ? 'ram' : 'storage',
            slotType: line.targetSlotType ?? (spec.category === 'ram' ? 'ram_slot' : 'm2_slot'),
            slotNumber: line.targetSlotNumber ?? 1,
            capacityGb: Number(spec.capacityGb) || null,
            quantity: 1,
            removable: true,
            status: 'installed',
            costAtInstallation: line.unitCost,
            sourceStockMoveRef: movementId.slice(0, 80),
            installationWorkOrderId: wo.id,
            installedById: userId || null,
          },
        })
        await tx.reconfigurationInstallationLine.update({
          where: { id: line.id },
          data: {
            installedAt: new Date(),
            installedById: userId || null,
            resultingInstallationId: installation.id,
            reservationStatus: 'fulfilled',
            stockMoveRef: movementId.slice(0, 80),
          },
        })
      },
    })
  }
}

/** Move what is owed, then finish. A job stopped half-way is kept for Finish or Undo. */
export async function runBenchJob(id: string, userId?: string) {
  const wo = await getWorkOrder(id)
  if (wo.status === 'completed') return wo
  if (wo.status !== 'in_progress' || !readBenchNotes(wo.notes)) {
    throw httpError(`${wo.ref} is not a bench job waiting to finish`, 422)
  }
  try {
    await runBenchMoves(id, userId)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The parts could not be moved'
    const fresh = await getWorkOrder(id)
    if (!partMoved(fresh)) {
      // Nothing moved: no trace of the job is left.
      await cancelWorkOrder({ id, version: fresh.version, userId, reason: message }).catch(() => null)
      throw err
    }
    await writeBenchNotes(id, { stuck: { message, at: new Date().toISOString() } })
    throw httpError(`${message}. ${wo.ref} is saved half-done: open it and press Finish once the cause is fixed, or Undo to put the parts back.`, 422)
  }
  await writeBenchNotes(id, { stuck: undefined })
  return finishBenchJob(id, userId)
}

/**
 * Specs, cost, price, snapshot, journal: every step can run again safely, so
 * a job that stopped here is finished by running it again.
 */
async function finishBenchJob(id: string, userId?: string) {
  const wo = await getWorkOrder(id)
  if (wo.status === 'completed') return wo
  const bench = readBenchNotes(wo.notes)
  const proposed = bench?.proposed ?? configFromSnapshot(wo.proposedSnapshot)
  if (!proposed) throw httpError(`${wo.ref} has no target configuration to finish with`, 422)
  const location = wo.warehouseLocation || 'warehouse'

  const cost = calculateReconfigCost({
    costBefore: dec(wo.costBefore),
    costRemoved: wo.removalLines.reduce((sum, l) => sum + dec(l.existingCost), 0),
    costInstalled: wo.installationLines.reduce((sum, l) => sum + dec(l.unitCost), 0),
    labourCost: dec(wo.labourCost),
    otherCost: dec(wo.otherCost),
  })
  const fallback = defaultPriceAfterBench({
    sellingPriceBefore: dec(wo.sellingPriceBefore),
    costBefore: dec(wo.costBefore),
    costAfter: cost.costAfter,
  })
  const manualPrice = bench?.finalSellingPrice
  const manual = manualPrice != null && manualPrice >= 0
  const price = manual
    ? calculateRecommendedSellingPrice({ method: 'manual', costAfter: cost.costAfter, manualPrice })
    : { recommended: fallback.price, method: fallback.method }
  const selling = manual ? dec(manualPrice) : price.recommended
  const margin = calculateMargin({ sellingPrice: selling, costAfter: cost.costAfter })
  const completionKey = reconfigCompletionEventKey(wo.id)
  const valKey = reconfigValuationEventKey(wo.ref)

  const device = await getDeviceConfiguration(wo.serialId)
  const specs = specsFromProposed(proposed)
  await syncBlobSpecs(device.blobSerialId || wo.serialId, specs, wo.manufacturerSerial)
  await setBlobSerial([wo.serialId, device.blobSerialId], wo.manufacturerSerial, serial => ({
    ...serial,
    status: serial.saleOrderId || serial.status === 'assigned' ? 'assigned' : 'available',
    location: location === 'repair_unit' ? 'warehouse' : location,
    specs,
    salePriceOverride: selling,
  }))

  await prisma.deviceSerialCost.upsert({
    where: { serialId: wo.serialId },
    create: { serialId: wo.serialId, currentCost: cost.costAfter, updatedById: userId || null },
    update: { currentCost: cost.costAfter, updatedById: userId || null },
  })
  if (wo.proposedSnapshotId) {
    await prisma.deviceConfigurationSnapshot.updateMany({ where: { serialId: wo.serialId, isCurrent: true }, data: { isCurrent: false } })
    await prisma.deviceConfigurationSnapshot.update({ where: { id: wo.proposedSnapshotId }, data: { isCurrent: true } })
  }

  await prisma.reconfigurationWorkOrder.update({
    where: { id: wo.id },
    data: {
      status: 'completed',
      dateCompleted: new Date(),
      costRemoved: cost.costRemoved,
      costInstalled: cost.costInstalled,
      costAfter: cost.costAfter,
      recommendedSellingPrice: price.recommended,
      finalSellingPrice: selling,
      priceDifference: round2(selling - dec(wo.sellingPriceBefore)),
      grossMargin: margin.grossMargin,
      grossMarginPct: margin.grossMarginPct,
      priceMethod: manual ? 'manual' : fallback.method,
      completionEventKey: completionKey,
      valuationEventKey: valKey,
      updatedById: userId || null,
      version: { increment: 1 },
    },
  })

  const completed = await getWorkOrder(wo.id)
  await postReconfigurationValuation({ workOrder: completed, eventKey: valKey, userId })

  try {
    const { refreshSaleOrderHostLineAfterReconfig } = await import('@/lib/reconfiguration/sales-bridge')
    await refreshSaleOrderHostLineAfterReconfig(wo.id)
  } catch (err) {
    console.error('[reconfiguration] commercial document refresh after bench complete failed:', err)
  }

  return getWorkOrder(wo.id)
}

/** Change the machine's row in the serials list, under the stock lock. */
async function setBlobSerial(
  ids: Array<string | null | undefined>,
  manufacturerSerial: string | null | undefined,
  change: (serial: Record<string, any>) => Record<string, any>,
) {
  await withAppStateKeyLock('deed_serials', async () => {
    const state = await loadAppStateForWrite(['deed_serials'])
    const serials = Array.isArray(state.deed_serials) ? [...(state.deed_serials as any[])] : []
    const idx = serials.findIndex(s => ids.includes(s.id) || (manufacturerSerial && s.serial === manufacturerSerial))
    if (idx < 0) return
    serials[idx] = change(serials[idx])
    await saveStoreKeys({ deed_serials: JSON.stringify(serials) })
  })
}

/** Finish a job that stopped half-way: move what is still owed, then finish. */
export async function finishStuckBenchJob(id: string, userId?: string) {
  const wo = await getWorkOrder(id)
  // Jobs started before the plan was written up front only list the parts
  // they got to: finishing one could complete it with a part missing.
  if ((readBenchNotes(wo.notes)?.version ?? 1) < 2) {
    throw httpError(`${wo.ref} was started before jobs could be resumed — use Undo to put its parts back, then do the job again`, 422)
  }
  return runBenchJob(id, userId)
}


/**
 * Undo a job that stopped half-way: put back every part that moved, then
 * cancel it. The machine is as it was and can be reconfigured again.
 */
export async function undoStuckBenchJob(id: string, userId?: string, reason = 'Undone after it stopped half-way') {
  const wo = await getWorkOrder(id)
  if (wo.status !== 'in_progress' || !readBenchNotes(wo.notes)) {
    throw httpError(`${wo.ref} is not a bench job that stopped half-way`, 422)
  }
  await putPartsBack(wo, userId)
  const fresh = await getWorkOrder(id)
  if (fresh.proposedSnapshotId) {
    await prisma.deviceConfigurationSnapshot.update({ where: { id: fresh.proposedSnapshotId }, data: { isCurrent: false } })
  }
  if (fresh.currentSnapshotId) {
    await prisma.deviceConfigurationSnapshot.updateMany({ where: { serialId: fresh.serialId, isCurrent: true }, data: { isCurrent: false } })
    await prisma.deviceConfigurationSnapshot.update({ where: { id: fresh.currentSnapshotId }, data: { isCurrent: true } })
  }
  return cancelWorkOrder({ id, version: fresh.version, userId, reason })
}

/**
 * Every part this job moved goes back: fitted parts return to the shelf they
 * came from, pulled parts go back into the machine from wherever they are now.
 * Each step commits with its line, so a second run skips what is done.
 */
async function putPartsBack(wo: Awaited<ReturnType<typeof getWorkOrder>>, userId?: string) {
  const shelf = (wo.warehouseLocation || 'warehouse') as string
  for (const line of wo.installationLines) {
    if (!line.installedAt) continue
    const plan = {
      kind: 'return_bulk_to_testing' as const,
      productId: line.componentProductId,
      productName: line.componentProduct?.name ?? 'Part',
      qty: line.quantity,
      // Never used: back on the shelf it came from, ready to fit again.
      to: (line.sourceLocation || shelf) as 'pending_testing',
      documentRef: wo.ref,
      reason: `Put back — ${wo.ref} undone`,
    }
    await applyStockPlan(plan, dec(line.unitCost), {
      workOrderId: wo.id,
      userId,
      inTx: async tx => {
        if (line.resultingInstallationId) {
          await tx.deviceComponentInstallation.update({
            where: { id: line.resultingInstallationId },
            data: { status: 'removed', removedAt: new Date(), removedById: userId || null, removalWorkOrderId: wo.id },
          })
        }
        await tx.reconfigurationInstallationLine.update({
          where: { id: line.id },
          data: { installedAt: null, reservationStatus: 'released' },
        })
      },
    })
  }
  for (const line of wo.removalLines) {
    if (!line.actualRemovedAt) continue
    // Where the pulled part sits now: tested parts may have moved on.
    const from = line.qaStatus === 'passed' ? shelf : line.qaStatus === 'failed' ? 'quarantine' : (line.destinationLocation || 'pending_testing')
    const plan = planComponentInstall({
      documentRef: wo.ref,
      productId: line.componentProductId,
      productName: line.componentProduct?.name ?? 'Part',
      qty: line.quantity,
      from: from as any,
    })
    try {
      await applyStockPlan(plan, dec(line.existingCost), {
        workOrderId: wo.id,
        userId,
        inTx: async tx => {
          await tx.deviceComponentInstallation.update({
            where: { id: line.installationId },
            data: { status: 'installed', removedAt: null, removedById: null, removalWorkOrderId: null },
          })
          await tx.reconfigurationRemovalLine.update({
            where: { id: line.id },
            data: { actualRemovedAt: null, stockMoveRef: null, qaStatus: 'pending', disposition: 'pending_testing', destinationLocation: 'pending_testing' },
          })
        },
      })
    } catch (err) {
      const name = line.componentProduct?.name ?? 'the pulled part'
      throw httpError(`${name} is no longer in ${from.replace(/_/g, ' ')} (it may have been used or sold), so it cannot go back into the machine. ${err instanceof Error ? err.message : ''}`.trim(), 422)
    }
  }
}

/**
 * Reverse a finished job: the parts go back, the machine returns to its old
 * specs, cost and price, and the stock value entry is reversed. Only the
 * machine's latest job, and only while the machine is still ours.
 */
export async function reverseBenchJob(id: string, userId?: string, reason = '') {
  const wo = await getWorkOrder(id)
  if (wo.status !== 'completed') throw httpError(`Only a completed job can be reversed (${wo.ref} is ${wo.status})`, 422)
  if (!reason.trim()) throw httpError('Say why the job is reversed', 422)
  const later = await prisma.reconfigurationWorkOrder.findFirst({
    where: { serialId: wo.serialId, id: { not: wo.id }, status: { notIn: ['cancelled', 'reversed'] }, createdAt: { gt: wo.createdAt } },
    select: { ref: true },
  })
  if (later) throw httpError(`${later.ref} was done on this machine after ${wo.ref}: reverse that one first`, 409)
  const device = await getDeviceConfiguration(wo.serialId)
  if (['sold', 'customer'].includes(String(device.status)) || device.location === 'customer') {
    throw httpError('The machine has been sold — it cannot be put back', 422)
  }

  await putPartsBack(wo, userId)

  const bench = readBenchNotes(wo.notes)
  const before = bench?.before ?? configFromSnapshot(wo.currentSnapshot)
  const specs = before ? specsFromProposed(before) : null
  if (specs) await syncBlobSpecs(device.blobSerialId || wo.serialId, specs, wo.manufacturerSerial)
  await setBlobSerial([wo.serialId, device.blobSerialId], wo.manufacturerSerial, serial => {
    const next: Record<string, any> = { ...serial, ...(specs ? { specs } : {}) }
    if (dec(wo.sellingPriceBefore) > 0) next.salePriceOverride = dec(wo.sellingPriceBefore)
    else delete next.salePriceOverride
    return next
  })
  await prisma.deviceSerialCost.upsert({
    where: { serialId: wo.serialId },
    create: { serialId: wo.serialId, currentCost: dec(wo.costBefore), updatedById: userId || null },
    update: { currentCost: dec(wo.costBefore), updatedById: userId || null },
  })
  if (wo.currentSnapshotId) {
    await prisma.deviceConfigurationSnapshot.updateMany({ where: { serialId: wo.serialId, isCurrent: true }, data: { isCurrent: false } })
    await prisma.deviceConfigurationSnapshot.update({ where: { id: wo.currentSnapshotId }, data: { isCurrent: true } })
  }

  await reverseReconfigurationValuation(wo, userId)

  await prisma.reconfigurationWorkOrder.update({
    where: { id: wo.id },
    data: {
      status: 'reversed',
      notes: JSON.stringify({ bench: { ...(bench ?? { version: 2, ram: null, storage: null }), reversed: { reason: reason.trim(), at: new Date().toISOString(), byUserId: userId ?? null } } }),
      updatedById: userId || null,
      version: { increment: 1 },
    },
  })

  try {
    const { refreshSaleOrderHostLineAfterReconfig } = await import('@/lib/reconfiguration/sales-bridge')
    await refreshSaleOrderHostLineAfterReconfig(wo.id)
  } catch (err) {
    console.error('[reconfiguration] commercial document refresh after reversal failed:', err)
  }
  return getWorkOrder(wo.id)
}

/** The completion's stock value entry, undone: same lines, sides swapped. */
async function reverseReconfigurationValuation(wo: Awaited<ReturnType<typeof getWorkOrder>>, userId?: string) {
  const eventKey = `${reconfigValuationEventKey(wo.ref)}:reversed`
  try {
    if (await prisma.valuationEvent.findUnique({ where: { eventKey } })) return
  } catch { /* */ }
  const original = await prisma.journalEntry.findFirst({
    where: { ref: reconfigValuationJournalRef(wo.ref) },
    include: { lines: true },
  }).catch(() => null)
  if (original?.lines?.length) {
    try {
      await createJournalEntry({
        ref: `${reconfigValuationJournalRef(wo.ref)}/REV`.slice(0, 80),
        date: new Date(),
        description: `Reversal of device reconfiguration ${wo.ref}`,
        sourceType: 'reconfiguration',
        sourceId: wo.id,
        journalCode: 'STK',
        lines: original.lines.map(l => ({
          accountLabel: l.accountLabel,
          partnerId: l.partnerId,
          analyticAccountId: l.analyticAccountId,
          debit: dec(l.credit),
          credit: dec(l.debit),
          label: `Reversal: ${l.label ?? wo.ref}`,
        })),
        createdById: userId || null,
        skipIfExists: true,
      })
    } catch (err) {
      console.error('[reconfig reversal journal]', err)
    }
  }
  try {
    await prisma.valuationEvent.create({
      data: { eventKey, kind: 'reconfiguration', productId: wo.productId, qty: 1, unitCost: dec(wo.costBefore), reference: `${wo.ref} reversed` },
    })
  } catch { /* already recorded */ }
}

/**
 * A part pulled from a machine, tested: passed → shelf stock to sell or fit
 * again; failed → quarantine. It used to wait in "awaiting tests" forever.
 */
export async function recordPulledPartTest(params: { workOrderId: string; lineId: string; passed: boolean; userId?: string }) {
  const wo = await getWorkOrder(params.workOrderId)
  const line = wo.removalLines.find(l => l.id === params.lineId)
  if (!line) throw httpError('That part is not on this job', 404)
  if (!line.actualRemovedAt) throw httpError('That part was not pulled out', 422)
  if (line.qaStatus === 'passed' || line.qaStatus === 'failed') return wo
  const to = params.passed ? (wo.warehouseLocation || 'warehouse') : 'quarantine'
  const from = line.destinationLocation || 'pending_testing'
  const name = line.componentProduct?.name ?? 'Part'
  await withAppStateKeyLock('deed_serials', async () => {
    await prisma.$transaction(async tx => {
      const fromRow = await tx.bulkStockLevel.findUnique({ where: { productId_location: { productId: line.componentProductId, location: from } } })
      if ((fromRow?.qty ?? 0) < line.quantity) throw httpError(`${name} is no longer in ${from.replace(/_/g, ' ')}`, 422)
      await tx.bulkStockLevel.update({ where: { id: fromRow!.id }, data: { qty: fromRow!.qty - line.quantity } })
      const toRow = await tx.bulkStockLevel.findUnique({ where: { productId_location: { productId: line.componentProductId, location: to } } })
      if (toRow) await tx.bulkStockLevel.update({ where: { id: toRow.id }, data: { qty: toRow.qty + line.quantity } })
      else await tx.bulkStockLevel.create({ data: { productId: line.componentProductId, location: to, qty: line.quantity } })
      await tx.stockMovement.create({
        data: {
          productId: line.componentProductId,
          movementType: 'transfer',
          qty: line.quantity,
          qtyBefore: fromRow!.qty,
          qtyAfter: fromRow!.qty - line.quantity,
          unitCost: dec(line.existingCost) || null,
          fromLocation: from,
          toLocation: to,
          referenceType: 'reconfiguration_work_order',
          referenceId: wo.id,
          documentRef: wo.ref,
          notes: `${name} pulled in ${wo.ref} tested: ${params.passed ? 'passed' : 'failed'}`,
          createdById: params.userId || null,
        },
      })
      await tx.reconfigurationRemovalLine.update({
        where: { id: line.id },
        data: {
          qaStatus: params.passed ? 'passed' : 'failed',
          disposition: params.passed ? 'ready_for_sale' : 'quarantine',
          destinationLocation: to,
        },
      })
    })
    // The stock screens read the blob copy: move it there too.
    const state = await loadAppStateForWrite(['deed_bulkStock', 'deed_stockMoves'])
    const bulk = Array.isArray(state.deed_bulkStock) ? [...(state.deed_bulkStock as any[])] : []
    const bump = (location: string, delta: number) => {
      const i = bulk.findIndex(b => b.productId === line.componentProductId && b.location === location)
      if (i >= 0) bulk[i] = { ...bulk[i], qty: Math.max(0, (Number(bulk[i].qty) || 0) + delta) }
      else if (delta > 0) bulk.push({ productId: line.componentProductId, location, qty: delta })
    }
    bump(from, -line.quantity)
    bump(to, line.quantity)
    const moves = Array.isArray(state.deed_stockMoves) ? [...(state.deed_stockMoves as any[])] : []
    moves.push({
      id: `sm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'transfer',
      productId: line.componentProductId,
      productName: name,
      qty: line.quantity,
      fromLocation: from,
      toLocation: to,
      documentRef: wo.ref,
      date: new Date().toISOString(),
      reason: `Pulled in ${wo.ref}, tested ${params.passed ? 'good' : 'faulty'}`,
    })
    await saveStoreKeys({ deed_bulkStock: JSON.stringify(bulk), deed_stockMoves: JSON.stringify(moves) }, { bulkStockBase: state.deed_bulkStock })
  })
  return getWorkOrder(params.workOrderId)
}
