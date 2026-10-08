import 'server-only'

import prisma from '@/lib/prisma'

/**
 * Serials and quantity stock as the screens use them, read from
 * serial_numbers and stock_location_levels. The deed_serials /
 * deed_bulkStock copies are still written on every save (and mirrored into
 * the tables before the save returns) until the parity check shows the
 * tables hold exactly what the copies hold; then the copies are frozen.
 *
 * A serial the table could not take (its product is not in the products
 * table) stays listed from the copy.
 */

type Row = Record<string, any>

const asObject = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {})

function toScreenSerial(s: { id: string; serialNumber: string; productId: string; inventoryBarcode: string | null; location: string | null; screenExtras: unknown }): Row {
  const extras = asObject(s.screenExtras)
  return {
    ...extras,
    id: extras.id ?? s.id,
    serial: s.serialNumber,
    productId: s.productId,
    ...(s.inventoryBarcode ? { barcode: s.inventoryBarcode } : {}),
    ...(s.location ? { location: s.location } : {}),
  }
}

async function tableSerials() {
  return prisma.serialNumber.findMany({
    where: { removedAt: null },
    select: { id: true, serialNumber: true, productId: true, inventoryBarcode: true, location: true, screenExtras: true },
    orderBy: { createdAt: 'asc' },
  })
}

export async function loadScreenSerials(screenCopy: unknown): Promise<Row[]> {
  const rows = await tableSerials()
  if (!rows.length) return Array.isArray(screenCopy) ? screenCopy as Row[] : []
  const out = rows.map(toScreenSerial)
  const listed = new Set(rows.map(r => r.serialNumber))
  for (const s of Array.isArray(screenCopy) ? screenCopy as Row[] : []) {
    const serial = String(s?.serial ?? s?.serialNumber ?? '').trim()
    if (serial && !listed.has(serial)) out.push(s)
  }
  return out
}

export async function loadScreenBulkStock(screenCopy: unknown): Promise<Row[]> {
  const rows = await prisma.stockLocationLevel.findMany({ orderBy: [{ productId: 'asc' }, { location: 'asc' }] })
  if (!rows.length) return Array.isArray(screenCopy) ? screenCopy as Row[] : []
  return rows.map(r => ({ productId: r.productId, location: r.location, qty: r.qty }))
}

/** JSON with sorted keys, empty values dropped — how two copies of a row are compared. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort()
      .filter(k => { const v = (value as Row)[k]; return v !== null && v !== undefined && v !== '' })
      .map(k => `${JSON.stringify(k)}:${canonical((value as Row)[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/**
 * Do the tables hold exactly what the copies hold? Read-only; this decides
 * when the copies can be frozen.
 */
export async function stockTableParity(copySerials: unknown, copyBulk: unknown) {
  const serialCopy = (Array.isArray(copySerials) ? copySerials : []) as Row[]
  const tableRows = await tableSerials()
  const table = new Map(tableRows.map(r => [r.serialNumber, toScreenSerial(r)]))
  const copyBySerial = new Map(serialCopy.map(s => [String(s?.serial ?? s?.serialNumber ?? '').trim(), s]))
  const missing: string[] = []
  const differing: Array<{ serial: string; copy: Row; table: Row }> = []
  for (const [serial, row] of copyBySerial) {
    if (!serial) continue
    const t = table.get(serial)
    if (!t) { missing.push(serial); continue }
    const { serialNumber: _a, ...copyRow } = row
    if (canonical(copyRow) !== canonical(t)) differing.push({ serial, copy: row, table: t })
  }
  const extra = [...table.keys()].filter(s => !copyBySerial.has(s))

  const bulk = new Map<string, number>()
  for (const l of (Array.isArray(copyBulk) ? copyBulk : []) as Row[]) {
    if (!l?.productId) continue
    const key = `${l.productId}|${l.location || 'warehouse'}`
    bulk.set(key, (bulk.get(key) ?? 0) + Math.round(Number(l.qty) || 0))
  }
  const levels = await prisma.stockLocationLevel.findMany()
  const levelMap = new Map(levels.map(l => [`${l.productId}|${l.location}`, l.qty]))
  const qtyDiff = [...new Set([...bulk.keys(), ...levelMap.keys()])]
    .filter(k => (bulk.get(k) ?? 0) !== (levelMap.get(k) ?? 0))
    .map(k => ({ productLocation: k, copy: bulk.get(k) ?? 0, table: levelMap.get(k) ?? 0 }))

  return {
    serials: {
      copy: copyBySerial.size, table: table.size,
      missingFromTable: missing.length, onlyInTable: extra.length, differing: differing.length,
      samples: { missing: missing.slice(0, 10), onlyInTable: extra.slice(0, 10), differing: differing.slice(0, 5) },
    },
    quantityStock: { copyRows: bulk.size, tableRows: levelMap.size, differing: qtyDiff.length, samples: qtyDiff.slice(0, 10) },
    sameAsCopies: !missing.length && !extra.length && !differing.length && !qtyDiff.length,
  }
}
