import 'server-only'
import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { loadAppState, loadAppStateForWrite, notifyStoreKeysChanged, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { nextWarrantyRefs, warrantiesToIssue, type WarrantyRow } from './e-warranty'

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
