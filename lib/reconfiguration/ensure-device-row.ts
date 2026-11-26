import 'server-only'

import prisma from '@/lib/prisma'
import { loadAppState } from '@/lib/server-store'
import { serialRow } from '@/lib/blob-transfer'

function httpError(message: string, status: number) {
  const err = new Error(message) as Error & { status: number }
  err.status = status
  return err
}

type Device = { serialId: string; manufacturerSerial: string; productId?: string | null; productName?: string | null }

/**
 * A bench job writes its work order, snapshots, installed parts and cost row
 * against serial_numbers and products. A unit that so far lives only in the
 * app-state copy (deed_serials) can still be picked on the bench, and the
 * first of those writes then failed on a foreign key with a bare
 * "Internal server error". Before any write: copy the unit into
 * serial_numbers when its product is there, or stop and say what is missing.
 */
export async function ensureDeviceInDatabase(device: Device): Promise<void> {
  const label = device.manufacturerSerial || device.serialId
  const existing = await prisma.serialNumber.findUnique({ where: { id: device.serialId }, select: { id: true } })
  if (existing) return

  const product = device.productId
    ? await prisma.product.findUnique({ where: { id: device.productId }, select: { id: true } })
    : null
  if (!product) {
    throw httpError(
      `${label} can't go on the bench yet: its product${device.productName ? ` "${device.productName}"` : ''} is not in the database, so the job cannot be recorded. Open the product in Inventory and save it once, then try again. Nothing was changed.`,
      422,
    )
  }

  const state = await loadAppState(['deed_serials'])
  const rows = Array.isArray(state.deed_serials) ? (state.deed_serials as Record<string, unknown>[]) : []
  const blob = rows.find(r => r.id === device.serialId)
  if (!blob) {
    throw httpError(`${label} was not found in inventory. Refresh the page and pick it again. Nothing was changed.`, 422)
  }
  const data = { ...serialRow(blob), productId: product.id, removedAt: null }
  const clash = data.serialNumber
    ? await prisma.serialNumber.findUnique({ where: { serialNumber: data.serialNumber }, select: { id: true } })
    : null
  if (clash) {
    throw httpError(
      `${label} is recorded twice in inventory (two different units share this serial number). Fix the duplicate in Inventory, then try again. Nothing was changed.`,
      409,
    )
  }
  await prisma.serialNumber.create({ data: { id: device.serialId, ...data } })
}
