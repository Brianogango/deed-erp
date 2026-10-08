import 'server-only'

import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'

/**
 * Serials, quantity stock and stock moves as the screens use them, read from
 * serial_numbers, stock_location_levels and stock_movements. The
 * deed_serials / deed_bulkStock / deed_stockMoves copies are still written on every save (and mirrored into
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

/**
 * The stock-movement history, newest first, read from stock_movements (each
 * move kept as saved). Moves only the copy has stay listed.
 */
export async function loadScreenStockMoves(screenCopy: unknown): Promise<Row[]> {
  const rows = await prisma.stockMovement.findMany({
    where: { screenExtras: { not: Prisma.DbNull } },
    select: { blobId: true, screenExtras: true },
    orderBy: { createdAt: 'desc' },
  })
  const copy = Array.isArray(screenCopy) ? screenCopy as Row[] : []
  if (!rows.length) return copy
  const out: Row[] = rows.map(r => ({ ...asObject(r.screenExtras), id: asObject(r.screenExtras).id ?? r.blobId }))
  const listed = new Set(out.map(m => String(m.id)))
  for (const m of copy) if (m?.id && !listed.has(String(m.id))) out.push(m)
  return out
}

/** Goods receipts (drafts included) from receipt_documents, newest first. Receipts only the copy has stay listed. */
export async function loadScreenReceipts(screenCopy: unknown): Promise<Row[]> {
  const rows = await prisma.receiptDocument.findMany({ where: { removedAt: null }, select: { id: true, record: true }, orderBy: { receiptDate: 'desc' } })
  const copy = Array.isArray(screenCopy) ? screenCopy as Row[] : []
  if (!rows.length) return copy
  const out: Row[] = rows.map(r => ({ ...asObject(r.record), id: r.id }))
  const listed = new Set(out.map(r => String(r.id)))
  for (const r of copy) if (r?.id && !listed.has(String(r.id))) out.push(r)
  return out
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
export async function stockTableParity(copySerials: unknown, copyBulk: unknown, copyMoves?: unknown, copyReceipts?: unknown) {
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

  const moveCopy = (Array.isArray(copyMoves) ? copyMoves : []) as Row[]
  const moveRows = await prisma.stockMovement.findMany({ where: { blobId: { not: null } }, select: { blobId: true, screenExtras: true } })
  const moveTable = new Map(moveRows.map(m => [String(m.blobId), m.screenExtras]))
  const movesMissing = moveCopy.filter(m => m?.id && !moveTable.has(String(m.id))).map(m => String(m.id))
  const movesDiffering = moveCopy.filter(m => m?.id && moveTable.has(String(m.id)) && canonical(moveTable.get(String(m.id))) !== canonical(m)).map(m => String(m.id))

  const receiptCopy = (Array.isArray(copyReceipts) ? copyReceipts : []) as Row[]
  const receiptRows = await prisma.receiptDocument.findMany({ where: { removedAt: null }, select: { id: true, record: true } })
  const receiptTable = new Map(receiptRows.map(r => [r.id, r.record]))
  const receiptsMissing = receiptCopy.filter(r => r?.id && !receiptTable.has(String(r.id))).map(r => String(r.ref ?? r.id))
  const receiptsDiffering = receiptCopy.filter(r => r?.id && receiptTable.has(String(r.id)) && canonical(receiptTable.get(String(r.id))) !== canonical(r)).map(r => String(r.ref ?? r.id))

  return {
    receipts: { copy: receiptCopy.length, table: receiptTable.size, missingFromTable: receiptsMissing.length, differing: receiptsDiffering.length, samples: { missing: receiptsMissing.slice(0, 5), differing: receiptsDiffering.slice(0, 5) } },
    stockMoves: { copy: moveCopy.length, missingFromTable: movesMissing.length, differing: movesDiffering.length, samples: { missing: movesMissing.slice(0, 5), differing: movesDiffering.slice(0, 5) } },
    serials: {
      copy: copyBySerial.size, table: table.size,
      missingFromTable: missing.length, onlyInTable: extra.length, differing: differing.length,
      samples: { missing: missing.slice(0, 10), onlyInTable: extra.slice(0, 10), differing: differing.slice(0, 5) },
    },
    quantityStock: { copyRows: bulk.size, tableRows: levelMap.size, differing: qtyDiff.length, samples: qtyDiff.slice(0, 10) },
    sameAsCopies: !missing.length && !extra.length && !differing.length && !qtyDiff.length && !movesMissing.length && !movesDiffering.length && !receiptsMissing.length && !receiptsDiffering.length,
  }
}
