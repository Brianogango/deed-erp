import 'server-only'
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { uuidFromKey } from '@/lib/accounting/ids'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Row = Record<string, any>

/** JSON text with object keys sorted — the database stores jsonb keys in its own order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${stableJson((value as Row)[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

const date = (v: unknown): Date | null => {
  const s = String(v ?? '')
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** The first serial on a reservation: screens store serial ids in serialNumbers (older rows: serialIds / serialId). */
function firstSerial(r: Row): string | null {
  for (const list of [r.serialNumbers, r.serialIds]) {
    if (Array.isArray(list) && list[0]) return String(list[0])
  }
  return r.serialId ? String(r.serialId) : null
}

/** Table columns for a reservation as the screens saved it; the whole record goes to screen_extras. */
export function reservationColumns(r: Row, productIds: Set<string>, serialIds: Set<string>) {
  const reservedFor = String(r.reservedFor || '')
  const referenceId = r.referenceId ? String(r.referenceId) : ''
  const serial = firstSerial(r)
  return {
    saleOrderId: UUID_RE.test(referenceId) && (reservedFor === 'sale_order' || reservedFor === 'sales_order') ? referenceId : null,
    saleOrderRef: r.referenceRef ? String(r.referenceRef).slice(0, 40) : null,
    productId: r.productId && productIds.has(String(r.productId)) ? String(r.productId) : null,
    serialId: serial && serialIds.has(serial) ? serial : null,
    qty: Math.max(1, Math.floor(Number(r.qty) || 1)),
    location: String(r.location ?? 'warehouse').slice(0, 30),
    reservedFor: reservedFor ? reservedFor.slice(0, 40) : null,
    referenceId: referenceId ? referenceId.slice(0, 80) : null,
    referenceRef: r.referenceRef ? String(r.referenceRef).slice(0, 80) : null,
    status: String(r.status ?? 'reserved').slice(0, 20),
    reservedAt: date(r.reservedDate) ?? new Date(),
    releasedAt: date(r.releasedDate) ?? date(r.fulfilledDate),
    screenExtras: r as Prisma.InputJsonObject,
    removedAt: null,
  }
}

let chain: Promise<unknown> = Promise.resolve()

/**
 * deed_stockReservations → stock_reservations: each reservation kept whole
 * (screen_extras) with its main fields in columns. Only new or changed
 * reservations are written; reservations gone from the list are marked
 * removed (unless the list is clearly partial). Saves run one after another,
 * so two saves close together cannot overwrite each other half-way.
 */
export function mirrorStockReservationsToPrisma(input: unknown, opts: { force?: boolean } = {}): Promise<{ mirrored: number; skipped: number; failed: number; error?: string }> {
  const run = chain.then(() => transferReservations(input, Boolean(opts.force)))
  chain = run.catch(() => null)
  return run
}

async function transferReservations(input: unknown, force: boolean) {
  const result: { mirrored: number; skipped: number; failed: number; error?: string } = { mirrored: 0, skipped: 0, failed: 0 }
  const rows: Row[] = typeof input === 'string' ? JSON.parse(input) : (input as Row[])
  if (!Array.isArray(rows)) return result

  const [existing, products, serials] = await Promise.all([
    prisma.stockReservation.findMany({ where: { blobId: { not: null } }, select: { id: true, blobId: true, screenExtras: true, removedAt: true } }),
    prisma.product.findMany({ select: { id: true } }),
    prisma.serialNumber.findMany({ select: { id: true } }),
  ])
  const productIds = new Set(products.map(p => p.id))
  const serialIds = new Set(serials.map(s => s.id))
  const have = new Map(existing.map(r => [String(r.blobId), r]))
  const listed = new Set<string>()
  const errors: string[] = []

  for (const r of rows) {
    const blobId = String(r?.id ?? '').trim().slice(0, 120)
    if (!blobId) continue
    listed.add(blobId)
    const current = have.get(blobId)
    if (!force && current && current.removedAt === null && stableJson(current.screenExtras) === stableJson(r)) { result.skipped++; continue }
    const data = reservationColumns(r, productIds, serialIds)
    try {
      if (current) await prisma.stockReservation.update({ where: { id: current.id }, data })
      else await prisma.stockReservation.create({ data: { id: uuidFromKey('reservation', blobId), blobId, ...data } })
      result.mirrored++
    } catch (err) {
      // Most often a second active reservation on one serial (one active
      // reservation per serial is enforced by the table): kept without the serial link.
      try {
        const relaxed = { ...data, serialId: null }
        if (current) await prisma.stockReservation.update({ where: { id: current.id }, data: relaxed })
        else await prisma.stockReservation.create({ data: { id: uuidFromKey('reservation', blobId), blobId, ...relaxed } })
        result.mirrored++
      } catch {
        result.failed++
        if (errors.length < 3) errors.push(`${blobId}: ${err instanceof Error ? err.message.split('\n').filter(Boolean).slice(-1)[0] : String(err)}`)
      }
    }
  }

  const active = existing.filter(r => r.removedAt === null)
  const gone = active.filter(r => !listed.has(String(r.blobId)))
  if (gone.length && listed.size >= active.length * 0.9) {
    await prisma.stockReservation.updateMany({ where: { id: { in: gone.map(r => r.id) } }, data: { removedAt: new Date() } })
  }
  if (errors.length) {
    result.error = errors.join(' | ')
    console.error(`[reservation-mirror] ${result.failed} reservation(s) not saved to stock_reservations:`, result.error)
  }
  return result
}
