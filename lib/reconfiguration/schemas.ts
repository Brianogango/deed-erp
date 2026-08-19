import { z } from 'zod'
import {
  COMPONENT_DISPOSITIONS,
  COMPONENT_SLOT_TYPES,
  DATA_STATUSES,
  PRICE_METHODS,
  RECONFIG_TRANSACTION_TYPES,
} from './types'

export const targetConfigSchema = z.object({
  changeScope: z.enum(['ram', 'storage', 'both']).optional(),
  totalRamGb: z.number().int().min(0),
  primaryStorageGb: z.number().int().min(0),
  secondaryStorageGb: z.number().int().min(0).nullable().optional(),
  storageType: z.string().max(40).nullable().optional(),
  processor: z.string().max(120).nullable().optional(),
  processorGeneration: z.string().max(80).nullable().optional(),
  ramProductId: z.string().uuid().optional(),
  storageProductId: z.string().uuid().optional(),
  secondaryStorageProductId: z.string().uuid().optional(),
  additiveRam: z.boolean().optional(),
})

export const createReconfigSchema = z.object({
  serialId: z.string().min(1),
  transactionType: z.enum(RECONFIG_TRANSACTION_TYPES),
  reason: z.string().min(1).max(2000),
  warehouseLocation: z.string().max(30).optional(),
  linkedClientId: z.string().uuid().optional().nullable(),
  linkedQuoteId: z.string().optional().nullable(),
  linkedSaleOrderId: z.string().uuid().optional().nullable(),
  linkedRepairId: z.string().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  target: targetConfigSchema.optional(),
  labourCost: z.number().min(0).optional(),
  otherCost: z.number().min(0).optional(),
})

export const patchDraftSchema = z.object({
  version: z.number().int().min(1),
  reason: z.string().min(1).max(2000).optional(),
  notes: z.string().max(5000).optional().nullable(),
  transactionType: z.enum(RECONFIG_TRANSACTION_TYPES).optional(),
  target: targetConfigSchema.optional(),
  labourCost: z.number().min(0).optional(),
  otherCost: z.number().min(0).optional(),
  technicianId: z.string().uuid().optional().nullable(),
  priceMethod: z.enum(PRICE_METHODS).optional(),
  finalSellingPrice: z.number().min(0).optional().nullable(),
  markupPct: z.number().optional(),
  fixedDifference: z.number().optional(),
  minMarginPct: z.number().optional(),
})

export const reserveSchema = z.object({
  version: z.number().int().min(1),
  installationLineUpdates: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        componentProductId: z.string().uuid(),
        selectedSerialId: z.string().uuid().optional().nullable(),
        selectedSerialText: z.string().max(120).optional().nullable(),
        sourceLocation: z.string().max(30).optional(),
        unitCost: z.number().min(0).optional(),
        quantity: z.number().int().min(1).optional(),
      }),
    )
    .optional(),
})

export const approvalSchema = z.object({
  version: z.number().int().min(1),
  reason: z.string().max(2000).optional(),
  compatibilityOverride: z.boolean().optional(),
  compatibilityOverrideReason: z.string().max(2000).optional(),
  marginOverride: z.boolean().optional(),
  finalSellingPrice: z.number().min(0).optional(),
})

export const recordRemovalSchema = z.object({
  version: z.number().int().min(1),
  lineId: z.string().uuid(),
  conditionAfterRemoval: z.enum(['A', 'B', 'C', 'parts_only']).optional(),
  disposition: z.enum(COMPONENT_DISPOSITIONS).optional(),
  dataStatus: z.enum(DATA_STATUSES).optional(),
  destinationLocation: z.string().max(30).optional(),
})

export const recordInstallationSchema = z.object({
  version: z.number().int().min(1),
  lineId: z.string().uuid(),
  selectedSerialText: z.string().max(120).optional().nullable(),
  selectedSerialId: z.string().uuid().optional().nullable(),
  /** Allow authorised override when physical unit differs from reservation */
  overrideReservedComponent: z.boolean().optional(),
  overrideReason: z.string().max(2000).optional(),
})

export const submitQaSchema = z.object({
  version: z.number().int().min(1),
  results: z.array(
    z.object({
      checkKey: z.string().min(1),
      result: z.enum(['pass', 'fail', 'na', 'pending']),
      notes: z.string().max(2000).optional().nullable(),
    }),
  ),
})

export const completeSchema = z.object({
  version: z.number().int().min(1),
  finalSellingPrice: z.number().min(0).optional(),
  priceMethod: z.enum(PRICE_METHODS).optional(),
})

/** One slot on the bench form — RAM and SSD share this shape. */
export const benchSlotSchema = z.object({
  action: z.enum(['none', 'pull_one', 'swap', 'add_one']),
  moduleCount: z.number().int().min(1).max(4).optional(),
  pullCapacityGb: z.number().int().min(1).optional(),
  incomingProductId: z.string().uuid().optional(),
  incomingCapacityGb: z.number().int().min(1).optional(),
  outgoingProductId: z.string().uuid().optional(),
  storageType: z.string().max(40).nullable().optional(),
})

/**
 * POST /api/reconfiguration/bench — create + complete in one step.
 * Catalog product name is not sent: the server rewrites unit specs only.
 */
export const applyBenchSchema = z.object({
  serialId: z.string().min(1),
  ram: benchSlotSchema.default({ action: 'none' }),
  storage: benchSlotSchema.default({ action: 'none' }),
  reason: z.string().max(2000).optional(),
  warehouseLocation: z.string().max(30).optional(),
  linkedSaleOrderId: z.string().uuid().optional().nullable(),
  finalSellingPrice: z.number().min(0).optional().nullable(),
  labourCost: z.number().min(0).optional(),
  otherCost: z.number().min(0).optional(),
})

export const cancelSchema = z.object({
  version: z.number().int().min(1),
  reason: z.string().min(1).max(2000),
})

export const reverseSchema = z.object({
  version: z.number().int().min(1),
  reason: z.string().min(1).max(2000),
})

export const seedInstallationSchema = z.object({
  serialId: z.string().min(1),
  components: z.array(
    z.object({
      componentProductId: z.string().uuid(),
      category: z.string().min(1),
      slotType: z.enum(COMPONENT_SLOT_TYPES),
      slotNumber: z.number().int().min(1),
      capacityGb: z.number().int().min(0).optional(),
      technology: z.string().max(60).optional(),
      quantity: z.number().int().min(1).optional(),
      removable: z.boolean().optional(),
      costAtInstallation: z.number().min(0).optional(),
      componentSerialText: z.string().max(120).optional(),
      condition: z.enum(['A', 'B', 'C', 'parts_only']).optional(),
    }),
  ),
})
