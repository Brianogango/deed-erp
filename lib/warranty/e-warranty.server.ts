import 'server-only'
import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { loadAppState, loadAppStateForWrite, notifyStoreKeysChanged, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { nextWarrantyRefs, warrantiesForDocument, warrantiesToIssue, warrantyPath, type DocWarranty, type WarrantyRow, type WarrantySource } from './e-warranty'

const arr = <T,>(v: unknown) => (Array.isArray(v) ? v as T[] : [])

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || ''
  if (!value && process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET is not configured')
  return `e-warranty:${value || 'dev-only'}`
}

const signature = (id: string) => createHmac('sha256', secret()).update(id).digest('base64url').slice(0, 24)

/**
 * The secret part of a warranty's certificate link: its id, signed. Nothing
 * is stored, so a link never changes or goes missing, and it cannot be
 * guessed from a warranty number.
 */
export const warrantyToken = (id: string) => `${id}.${signature(id)}`

function idFromToken(token: string): string | null {
  const clean = String(token ?? '').trim()
  const dot = clean.lastIndexOf('.')
  if (dot < 1) return null
  const id = clean.slice(0, dot)
  const given = Buffer.from(clean.slice(dot + 1))
  const want = Buffer.from(signature(id))
  return given.length === want.length && timingSafeEqual(given, want) ? id : null
}

/** The warranty behind a certificate link, or null. */
export async function warrantyByToken(token: string): Promise<WarrantyRow | null> {
  const id = idFromToken(token)
  if (!id) return null
  const state = await loadAppState(['deed_warranties'])
  return arr<WarrantyRow>(state.deed_warranties).find(w => w.id === id) ?? null
}

/**
 * Issue the warranties still missing for serial-numbered machines sold on a
 * delivery, at the POS or on Kilimall (past sales included). Safe to run any
 * number of times.
 */
export async function syncWarranties(): Promise<{ issued: number; total: number; added: WarrantyRow[] }> {
  const src = await loadAppState(['deed_deliveries', 'deed_posOrders', 'deed_kilimallOrders', 'deed_serials', 'deed_products', 'deed_systemSettings'])
  const settings = (src.deed_systemSettings && typeof src.deed_systemSettings === 'object') ? src.deed_systemSettings as Record<string, unknown> : {}
  return withAppStateKeyLock('deed_warranties', async () => {
    const state = await loadAppStateForWrite(['deed_warranties'])
    const existing = arr<WarrantyRow>(state.deed_warranties)
    const toAdd = warrantiesToIssue(existing, {
      deliveries: arr(src.deed_deliveries),
      posOrders: arr(src.deed_posOrders),
      kilimallOrders: arr(src.deed_kilimallOrders),
      serials: arr(src.deed_serials),
      products: arr(src.deed_products),
      defaultMonths: Number(settings.invDefaultWarrantyMonths) || undefined,
    })
    if (!toAdd.length) return { issued: 0, total: existing.length, added: [] }
    const refs = nextWarrantyRefs(existing, toAdd.length)
    const now = new Date().toISOString()
    const added = toAdd.map((c, i) => ({ ...c, id: randomUUID(), ref: refs[i], issuedAt: now }))
    const next = [...existing, ...added]
    await saveStoreKeys({ deed_warranties: JSON.stringify(next) })
    await notifyStoreKeysChanged(['deed_warranties']).catch(() => {})
    return { issued: added.length, total: next.length, added }
  })
}

export type SaleForWarranty = {
  source: WarrantySource
  id: string
  ref: string
  date?: string
  customerId?: string
  customerName?: string
  lines: Array<{ serialId?: string; productId: string; productName?: string }>
}

export function toDocWarranty(w: WarrantyRow): DocWarranty {
  return {
    id: w.id, ref: w.ref, customerId: w.customerId, customerName: w.customerName,
    productName: w.productName, serialNumber: w.serialNumber,
    startDate: String(w.startDate).slice(0, 10), endDate: String(w.endDate).slice(0, 10), months: w.months,
    status: w.status, path: warrantyPath(warrantyToken(w.id)),
  }
}

/**
 * Issue the warranties for one sale right now — the receipt or invoice being
 * printed carries them — instead of waiting for the saved sale to reach the
 * server. The browser may not have saved the serials as sold yet, so a serial
 * still in stock counts as sold here; the background check later finds these
 * warranties by the same sale and does not issue them again.
 */
export async function issueWarrantiesForSale(sale: SaleForWarranty): Promise<DocWarranty[]> {
  const src = await loadAppState(['deed_serials', 'deed_products', 'deed_systemSettings'])
  const settings = (src.deed_systemSettings && typeof src.deed_systemSettings === 'object') ? src.deed_systemSettings as Record<string, unknown> : {}
  const wanted = new Set(sale.lines.map(l => l.serialId).filter(Boolean) as string[])
  const serials = arr<Record<string, any>>(src.deed_serials).map(s =>
    wanted.has(s.id) && ['available', 'assigned', 'sold'].includes(String(s.status)) ? { ...s, status: 'sold', soldDate: s.soldDate || sale.date } : s)
  const lines = sale.lines.filter(l => l.serialId).map(l => ({ productId: l.productId, productName: l.productName, serialId: l.serialId, serialIds: l.serialId ? [l.serialId] : [] }))
  return withAppStateKeyLock('deed_warranties', async () => {
    const state = await loadAppStateForWrite(['deed_warranties'])
    const existing = arr<WarrantyRow>(state.deed_warranties)
    const sources = {
      deliveries: sale.source === 'delivery' ? [{ id: sale.id, ref: sale.ref, status: 'done', date: sale.date, saleOrderRef: sale.ref, customerId: sale.customerId, customerName: sale.customerName, lines }] : [],
      posOrders: sale.source === 'pos' ? [{ id: sale.id, ref: sale.ref, date: sale.date, customerId: sale.customerId, customerName: sale.customerName, lines }] : [],
      kilimallOrders: [],
      serials: serials as any,
      products: arr<any>(src.deed_products),
      defaultMonths: Number(settings.invDefaultWarrantyMonths) || undefined,
    }
    const toAdd = warrantiesToIssue(existing, sources as any)
    let next = existing
    if (toAdd.length) {
      const refs = nextWarrantyRefs(existing, toAdd.length)
      const now = new Date().toISOString()
      next = [...existing, ...toAdd.map((c, i) => ({ ...c, id: randomUUID(), ref: refs[i], issuedAt: now }))]
      await saveStoreKeys({ deed_warranties: JSON.stringify(next) })
      await notifyStoreKeysChanged(['deed_warranties']).catch(() => {})
    }
    return warrantiesForDocument(next, sale.source === 'pos' ? { posOrderIds: [sale.id], serialIds: [...wanted] } : { deliveryIds: [sale.id], serialIds: [...wanted] }).map(toDocWarranty)
  })
}

/** The warranties on an invoice, POS sale or sale order, with their links. */
export async function documentWarranties(q: { invoiceId?: string; posOrderId?: string; saleOrderId?: string }): Promise<DocWarranty[]> {
  const state = await loadAppState(['deed_warranties', 'deed_posOrders', 'deed_deliveries', 'deed_saleOrders', ...(q.invoiceId ? ['deed_invoices'] : [])])
  const warranties = arr<WarrantyRow>(state.deed_warranties)
  const posOrders = arr<Record<string, any>>(state.deed_posOrders)
  const deliveries = arr<Record<string, any>>(state.deed_deliveries)
  const orders = arr<Record<string, any>>(state.deed_saleOrders)
  const posOrderIds = new Set<string>()
  const saleOrderIds = new Set<string>()
  const serialNumbers: string[] = []
  const serialIds: string[] = []
  if (q.posOrderId) posOrderIds.add(q.posOrderId)
  if (q.saleOrderId) saleOrderIds.add(q.saleOrderId)
  if (q.invoiceId) {
    const inv = arr<Record<string, any>>(state.deed_invoices).find(i => i.id === q.invoiceId)
    if (!inv) return []
    if (inv.saleOrderId) saleOrderIds.add(String(inv.saleOrderId))
    for (const o of posOrders) if (o.invoiceId === inv.id || (inv.ref && o.invoiceRef === inv.ref)) posOrderIds.add(String(o.id))
    for (const l of arr<Record<string, any>>(inv.lines)) {
      if (l.serial) serialNumbers.push(String(l.serial))
      if (l.serialNumber) serialNumbers.push(String(l.serialNumber))
      if (l.serialNumberId) serialIds.push(String(l.serialNumberId))
      if (l.serialId) serialIds.push(String(l.serialId))
    }
  }
  const deliveryIds = deliveries.filter(d => saleOrderIds.has(String(d.saleOrderId))).map(d => String(d.id))
  const saleOrderRefs = orders.filter(o => saleOrderIds.has(String(o.id))).map(o => String(o.ref))
  return warrantiesForDocument(warranties, { posOrderIds: [...posOrderIds], deliveryIds, saleOrderRefs, serialNumbers, serialIds }).map(toDocWarranty)
}
