import 'server-only'

import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { bumpPrismaOnHand } from '@/lib/inventory/stock-transactions'
import { serialDeleteBlockers } from './serial-delete'

/** Statuses counted as on hand (lib/business-logic.ts ACTIVE_SERIAL_STATUSES). */
const ON_HAND = new Set(['available', 'assigned', 'under_repair', 'refurbishment', 'reconfiguration', 'in_stock'])

const list = (v: unknown) => (Array.isArray(v) ? v : []) as Array<Record<string, any>>

export type SerialDeleteResult = {
  deleted: Array<{ id: string; serial: string; productName: string }>
  refused: Array<{ id: string; serial: string; why: string }>
  jobsRemoved: number
}

/**
 * Delete chosen units from the system: gone from inventory, With Issues and
 * refurbishment (their jobs too). Units a sale, invoice, delivery, receipt,
 * POS sale, Kilimall order, warranty or repair names are refused. The caller
 * holds the serials lock.
 *
 * What stays, on purpose: one stock movement per unit ("Deleted from the
 * system") so quantity history still adds up, and the audit entry. No journal
 * is posted; a unit with a cost that left is a write-off, not a delete.
 */
export async function deleteSerialsFromSystem(params: {
  serialIds: string[]
  reason: string
  userId: string
  reference: string
}): Promise<SerialDeleteResult> {
  const state = await loadAppState([
    'deed_serials', 'deed_products', 'deed_stockMoves', 'deed_refurbishmentJobs',
    'deed_saleOrders', 'deed_deliveries', 'deed_invoices', 'deed_receipts', 'deed_posOrders',
    'deed_kilimallOrders', 'deed_kilimallDispatches', 'deed_warranties', 'deed_repairs_v2',
  ])
  const serials = list(state.deed_serials)
  const wanted = new Set(params.serialIds)
  const chosen = serials.filter(s => wanted.has(String(s.id)))
  const blockers = serialDeleteBlockers(chosen, {
    saleOrders: list(state.deed_saleOrders),
    deliveries: list(state.deed_deliveries),
    invoices: list(state.deed_invoices),
    receipts: list(state.deed_receipts),
    posOrders: list(state.deed_posOrders),
    kilimallOrders: list(state.deed_kilimallOrders),
    kilimallDispatches: list(state.deed_kilimallDispatches),
    warranties: list(state.deed_warranties),
    repairs: list(state.deed_repairs_v2),
  })

  const result: SerialDeleteResult = { deleted: [], refused: [], jobsRemoved: 0 }
  const found = new Set(chosen.map(s => String(s.id)))
  for (const id of wanted) if (!found.has(id)) result.refused.push({ id, serial: id, why: 'Not found' })

  const goingIds = new Set<string>()
  for (const s of chosen) {
    const why = blockers.get(String(s.id))
    if (why) { result.refused.push({ id: String(s.id), serial: String(s.serial ?? s.id), why }); continue }
    goingIds.add(String(s.id))
  }
  if (!goingIds.size) return result

  const going = chosen.filter(s => goingIds.has(String(s.id)))
  const products = list(state.deed_products).map(p => ({ ...p }))
  const onHand = new Map<string, number>()
  const now = new Date().toISOString()
  const moves = going.map(s => {
    const productName = String(s.productName || products.find(p => p.id === s.productId)?.name || 'Device')
    const counted = ON_HAND.has(String(s.status))
    if (counted) onHand.set(String(s.productId), (onHand.get(String(s.productId)) ?? 0) - 1)
    result.deleted.push({ id: String(s.id), serial: String(s.serial ?? s.id), productName })
    return {
      id: randomUUID(),
      type: counted ? 'out' : 'adjustment',
      productId: s.productId,
      productName,
      qty: counted ? 1 : 0,
      reason: `Deleted from the system: ${params.reason}`,
      fromLocation: s.location,
      toLocation: 'deleted',
      serialNumbers: [String(s.serial ?? s.id)],
      date: now,
      userId: params.userId,
      documentRef: params.reference,
    }
  })
  for (const [productId, delta] of onHand) {
    const i = products.findIndex(p => p.id === productId)
    if (i >= 0) products[i] = { ...products[i], stockQty: Math.max(0, Number(products[i].stockQty ?? 0) + delta) }
  }
  const jobs = list(state.deed_refurbishmentJobs)
  const keptJobs = jobs.filter(j => !goingIds.has(String(j.serialId)))
  result.jobsRemoved = jobs.length - keptJobs.length

  // Marked removed in the serials table: every screen leaves removed units out,
  // and documents that printed the number keep their text.
  await prisma.serialNumber.updateMany({
    where: { OR: [{ id: { in: [...goingIds].filter(isUuid) } }, { serialNumber: { in: going.map(s => String(s.serial ?? '')).filter(Boolean) } }] },
    data: { removedAt: new Date() },
  })
  if (onHand.size) await bumpPrismaOnHand(onHand)
  await saveStoreKeys({
    deed_serials: JSON.stringify(serials.filter(s => !goingIds.has(String(s.id)))),
    deed_products: JSON.stringify(products),
    deed_stockMoves: JSON.stringify([...moves, ...list(state.deed_stockMoves)]),
    ...(result.jobsRemoved ? { deed_refurbishmentJobs: JSON.stringify(keptJobs) } : {}),
  }, { allowBulkDelete: ['deed_serials', 'deed_refurbishmentJobs'] })
  return result
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
