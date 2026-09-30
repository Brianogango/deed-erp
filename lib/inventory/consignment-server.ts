import { accessoriesLabel, normalizeAccessories, type ConsignmentDevice, type ConsignmentStatus } from '@/lib/inventory/consignment'

/**
 * Shapes shared by the consignment API: rows as the register reads them, and
 * the purchase order a Purchase raises.
 *
 * Kept free of Prisma and of the request so the rules can be tested without a
 * database.
 */

const day = (value: unknown): string | null => {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export type ConsignmentRow = {
  id: string
  vendorId: string
  vendorName?: string | null
  assetId?: string | null
  serialNumber: string
  productId?: string | null
  productName?: string | null
  conditionGrade?: string | null
  receivedAt: Date | string
  status: string
  purchasedAt?: Date | string | null
  purchaseOrderId?: string | null
  purchasePrice?: unknown
  returnedAt?: Date | string | null
  notes?: string | null
  accessories?: unknown
}

export type ConsignmentView = ConsignmentDevice & {
  productId: string | null
  purchaseOrderRef?: string | null
}

export function consignmentFromRow(row: ConsignmentRow, purchaseOrderRef?: string | null): ConsignmentView {
  return {
    id: row.id,
    vendorId: row.vendorId,
    vendorName: row.vendorName ?? null,
    assetId: row.assetId ?? null,
    serialNumber: row.serialNumber,
    productId: row.productId ?? null,
    productName: row.productName ?? null,
    conditionGrade: row.conditionGrade ?? null,
    receivedAt: day(row.receivedAt) ?? '',
    status: row.status as ConsignmentStatus,
    purchasedAt: day(row.purchasedAt),
    purchaseOrderId: row.purchaseOrderId ?? null,
    purchasePrice: num(row.purchasePrice),
    returnedAt: day(row.returnedAt),
    notes: row.notes ?? null,
    accessories: normalizeAccessories(row.accessories),
    ...(purchaseOrderRef ? { purchaseOrderRef } : {}),
  }
}

/**
 * The purchase order a Purchase raises: one unit, the agreed price, from the
 * vendor who owns the machine.
 *
 * It is a draft on purpose. Buying the device is the moment it becomes Deed's
 * and may enter stock and the accounts, and that happens the way every other
 * purchase does — confirm the order, receive the serial on a GRN, post the
 * vendor bill. The register only records that the decision was taken and which
 * order carries it.
 */
export function consignmentPurchaseOrderBody(input: {
  device: Pick<ConsignmentDevice, 'serialNumber' | 'assetId' | 'vendorId' | 'vendorName' | 'receivedAt' | 'accessories'>
  productId: string
  productName: string
  price: number
  date: string
}) {
  const { device } = input
  const tag = device.assetId ? `, vendor asset ${device.assetId}` : ''
  return {
    vendorId: device.vendorId,
    vendorName: device.vendorName ?? undefined,
    date: input.date,
    notes: `Consignment purchase — SN ${device.serialNumber}${tag}, held since ${device.receivedAt}, ${accessoriesLabel(device)}. Receive this serial on the GRN.`,
    lines: [{
      productId: input.productId,
      productName: input.productName,
      qty: 1,
      unitPrice: input.price,
      taxRate: 0,
    }],
  }
}

/** Who may see the register: sales too, since they show these machines to clients. */
export const CONSIGNMENT_READ_ROLES = ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead', 'sales_rep']
/** Who may book devices in, buy them, or hand them back. */
export const CONSIGNMENT_WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']
