/**
 * Vendor devices held at the shop that Deed has not bought.
 *
 * A vendor drops laptops off so they can be shown to clients. Deed buys one
 * only when a client agrees; anything unsold is collected by the vendor. The
 * same shape as the Computer Aid arrangement — devices on the floor, paid for
 * on sell-through rather than on arrival.
 *
 * These are NOT Deed's inventory. The vendor still owns them, so they must
 * stay out of stock valuation, out of COGS and off the balance sheet until a
 * purchase actually happens. That is why this is a custody register and not a
 * serial_numbers row: everything that reads serial_numbers treats what it
 * finds as Deed's stock, and a device parked there would be counted as an
 * asset the company does not own.
 *
 * The register answers one question — what is on our floor, whose is it, and
 * since when — and records the two ways a device leaves: bought, or collected.
 * Pure, with no storage of its own, so the rules can be tested and the
 * persistence chosen separately.
 */

export type ConsignmentStatus =
  /** Physically here, owned by the vendor. */
  | 'at_shop'
  /** Bought from the vendor; from here it is ordinary stock. */
  | 'purchased'
  /** Collected by the vendor, unsold. */
  | 'returned'

export type ConsignmentDevice = {
  id: string
  vendorId: string
  vendorName?: string | null
  /** The vendor's own asset tag. How they identify the machine. */
  assetId?: string | null
  serialNumber: string
  productName?: string | null
  conditionGrade?: string | null
  receivedAt: string
  status: ConsignmentStatus
  purchasedAt?: string | null
  purchaseOrderId?: string | null
  purchasePrice?: number | null
  returnedAt?: string | null
  notes?: string | null
  /**
   * What came with the machine — charger above all. Recorded at book-in so the
   * same things go back when the vendor collects, and so a buyer knows whether
   * a charger is included.
   */
  accessories?: string[]
}

type ConsignmentReceiptInput = {
  vendorId?: string | null
  vendorName?: string | null
  assetId?: string | null
  serialNumber?: string | null
  productName?: string | null
  conditionGrade?: string | null
  receivedAt?: string | null
  notes?: string | null
  accessories?: unknown
}

type ConsignmentResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string }

const text = (v: unknown) => String(v ?? '').trim()

/** The accessories the book-in form offers as checkboxes. Anything else is typed. */
export const CONSIGNMENT_ACCESSORIES = ['Charger', 'Bag', 'Mouse', 'Box'] as const

/**
 * Accessories as a clean list: trimmed, blanks dropped, one entry per item
 * whatever its case, and the standard names spelt the standard way.
 */
export function normalizeAccessories(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    const name = text(raw)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const standard = CONSIGNMENT_ACCESSORIES.find(a => a.toLowerCase() === key)
    out.push(standard ?? name)
  }
  return out
}

export function hasCharger(device: Pick<ConsignmentDevice, 'accessories'>): boolean {
  return (device.accessories ?? []).some(a => a.toLowerCase() === 'charger')
}

/** "with charger, bag" / "no accessories" — how a device is described on lists and orders. */
export function accessoriesLabel(device: Pick<ConsignmentDevice, 'accessories'>): string {
  const list = device.accessories ?? []
  return list.length ? `with ${list.join(', ').toLowerCase()}` : 'no accessories'
}

/** Serials are compared case-insensitively — vendors are inconsistent about case. */
function normalizeSerial(serial: unknown): string {
  return text(serial).toUpperCase()
}

function isAtShop(device: Pick<ConsignmentDevice, 'status'>): boolean {
  return device.status === 'at_shop'
}

/** Devices physically on the floor right now. */
export function openConsignments(devices: ConsignmentDevice[]): ConsignmentDevice[] {
  return (devices ?? []).filter(isAtShop)
}

export function consignmentsForVendor(vendorId: string, devices: ConsignmentDevice[]): ConsignmentDevice[] {
  const id = text(vendorId)
  if (!id) return []
  return openConsignments(devices).filter(d => text(d.vendorId) === id)
}

/**
 * Book a device in.
 *
 * Vendor, serial and received date are required: without the vendor nobody
 * knows whose machine it is, without the serial it cannot be identified at
 * collection, and without the date there is no custody trail. The asset tag is
 * recorded when the vendor supplies one but does not block a receipt — a
 * device physically in the shop should be on the register even if it arrived
 * untagged, and `missingAssetId` marks those for chasing.
 */
export function recordConsignmentReceipt(
  input: ConsignmentReceiptInput,
  existing: ConsignmentDevice[],
  id: string,
): ConsignmentResult<ConsignmentDevice> {
  const vendorId = text(input.vendorId)
  if (!vendorId) return { ok: false, reason: 'Choose the vendor this device belongs to.' }

  const serialNumber = normalizeSerial(input.serialNumber)
  if (!serialNumber) return { ok: false, reason: 'A serial number is required to book a device in.' }

  const receivedAt = text(input.receivedAt)
  if (!receivedAt) return { ok: false, reason: 'Record the date the device arrived.' }

  // The same machine cannot be here twice. A duplicate almost always means it
  // was booked in before and never checked out, which is exactly the state the
  // register exists to prevent.
  const clash = openConsignments(existing).find(d => normalizeSerial(d.serialNumber) === serialNumber)
  if (clash) {
    return {
      ok: false,
      reason: `${serialNumber} is already booked in${clash.vendorName ? ` from ${clash.vendorName}` : ''} since ${clash.receivedAt}.`,
    }
  }

  return {
    ok: true,
    value: {
      id,
      vendorId,
      vendorName: text(input.vendorName) || null,
      assetId: text(input.assetId) || null,
      serialNumber,
      productName: text(input.productName) || null,
      conditionGrade: text(input.conditionGrade) || null,
      receivedAt,
      status: 'at_shop',
      notes: text(input.notes) || null,
      accessories: normalizeAccessories(input.accessories),
    },
  }
}

/** A device on the floor with no vendor asset tag recorded. */
export function missingAssetId(device: ConsignmentDevice): boolean {
  return isAtShop(device) && !text(device.assetId)
}

/**
 * Buy it. This is the moment the device becomes Deed's, so it is also the
 * moment it may enter stock and the accounts — never before.
 */
export function purchaseConsignment(
  device: ConsignmentDevice,
  opts: { at: string; purchaseOrderId?: string | null; price?: number | null },
): ConsignmentResult<ConsignmentDevice> {
  if (!device) return { ok: false, reason: 'Device not found.' }
  if (device.status === 'purchased') return { ok: false, reason: `${device.serialNumber} has already been purchased.` }
  if (device.status === 'returned') return { ok: false, reason: `${device.serialNumber} was returned to the vendor and is no longer here.` }

  const at = text(opts?.at)
  if (!at) return { ok: false, reason: 'Record the purchase date.' }

  const price = Number(opts?.price)
  if (opts?.price != null && (!Number.isFinite(price) || price < 0)) {
    return { ok: false, reason: 'The purchase price must be a positive amount.' }
  }

  return {
    ok: true,
    value: {
      ...device,
      status: 'purchased',
      purchasedAt: at,
      purchaseOrderId: text(opts?.purchaseOrderId) || null,
      purchasePrice: opts?.price == null ? null : price,
    },
  }
}

/**
 * Accessories that came in with the device but are not going back with it.
 * A missing charger on collection is a dispute with the vendor later, so it is
 * written into the record at the moment it is noticed.
 */
function missingOnReturn(device: Pick<ConsignmentDevice, 'accessories'>, returned: unknown): string[] {
  const back = new Set(normalizeAccessories(returned).map(a => a.toLowerCase()))
  return (device.accessories ?? []).filter(a => !back.has(a.toLowerCase()))
}

/** The vendor collects it unsold. The check-out half of the custody trail. */
export function returnConsignment(
  device: ConsignmentDevice,
  opts: { at: string; notes?: string | null; accessoriesReturned?: unknown },
): ConsignmentResult<ConsignmentDevice> {
  if (!device) return { ok: false, reason: 'Device not found.' }
  if (device.status === 'purchased') {
    return { ok: false, reason: `${device.serialNumber} was purchased and is Deed's stock — return it through the normal returns process.` }
  }
  if (device.status === 'returned') return { ok: false, reason: `${device.serialNumber} has already been collected.` }

  const at = text(opts?.at)
  if (!at) return { ok: false, reason: 'Record the date the vendor collected it.' }

  const note = text(opts?.notes)
  // Only checked when the caller says what went back; an older client that
  // sends no list does not have every accessory recorded as missing.
  const missing = opts?.accessoriesReturned === undefined ? [] : missingOnReturn(device, opts.accessoriesReturned)
  const missingNote = missing.length ? `Not returned with the device: ${missing.join(', ')}` : ''
  const added = [note, missingNote].filter(Boolean).join('\n')
  return {
    ok: true,
    value: {
      ...device,
      status: 'returned',
      returnedAt: at,
      notes: added ? [device.notes, added].filter(Boolean).join('\n') : device.notes ?? null,
    },
  }
}

type ConsignmentSummary = {
  vendorId: string
  vendorName: string | null
  atShop: number
  untagged: number
  oldestReceivedAt: string | null
}

/** What is on the floor, per vendor — the register's headline view. */
export function summariseConsignments(devices: ConsignmentDevice[]): ConsignmentSummary[] {
  const byVendor = new Map<string, ConsignmentSummary>()
  for (const device of openConsignments(devices)) {
    const key = text(device.vendorId)
    const row = byVendor.get(key) ?? {
      vendorId: key,
      vendorName: device.vendorName ?? null,
      atShop: 0,
      untagged: 0,
      oldestReceivedAt: null,
    }
    row.atShop += 1
    if (missingAssetId(device)) row.untagged += 1
    if (!row.oldestReceivedAt || device.receivedAt < row.oldestReceivedAt) {
      row.oldestReceivedAt = device.receivedAt
    }
    byVendor.set(key, row)
  }
  return Array.from(byVendor.values()).sort((a, b) => b.atShop - a.atShop)
}
