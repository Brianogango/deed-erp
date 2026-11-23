/**
 * Merging two contacts: point everything that names the duplicate at the
 * contact that stays.
 *
 * A record names a contact through a field ending in "Id" (customerId,
 * vendorId, partnerId, clientId, contactId, companyId…) or a list ending in
 * "Ids". Contact ids are UUIDs, so matching the exact value cannot touch
 * anything else. The name stored next to a relinked id ("customerName" beside
 * "customerId") follows when it was the duplicate's name.
 *
 * Pure: the server applies this to every stored collection.
 */

type Json = unknown

const ID_KEY = /(Id|ID|_id)$/
const IDS_KEY = /(Ids|IDs|_ids)$/

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** "customerId" → ["customerName", "customer"]; "partner_id" → ["partner_name", "partner"]. */
function nameKeysFor(idKey: string): string[] {
  if (idKey.endsWith('_id')) { const base = idKey.slice(0, -3); return [`${base}_name`, base] }
  const base = idKey.replace(/(Id|ID)$/, '')
  return base ? [`${base}Name`, base] : []
}

export type RelinkResult<T = Json> = { value: T; count: number }

export function relinkContact<T = Json>(value: T, mergedId: string, survivorId: string, names?: { merged?: string; survivor?: string }): RelinkResult<T> {
  let count = 0
  const mergedName = norm(names?.merged)
  const survivorName = names?.survivor ?? ''

  const walk = (node: Json): Json => {
    if (Array.isArray(node)) {
      let changed = false
      const out = node.map(item => { const next = walk(item); if (next !== item) changed = true; return next })
      return changed ? out : node
    }
    if (!node || typeof node !== 'object') return node
    const obj = node as Record<string, Json>
    let copy: Record<string, Json> | null = null
    const set = (k: string, v: Json) => { if (!copy) copy = { ...obj }; copy[k] = v }

    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v === mergedId && ID_KEY.test(k) && k !== 'id') {
        set(k, survivorId)
        count++
        if (mergedName && survivorName) {
          for (const nk of nameKeysFor(k)) {
            if (typeof obj[nk] === 'string' && norm(obj[nk]) === mergedName) set(nk, survivorName)
          }
        }
        continue
      }
      if (Array.isArray(v) && IDS_KEY.test(k) && v.includes(mergedId)) {
        const next = [...new Set(v.map(x => (x === mergedId ? survivorId : x)))]
        set(k, next)
        count++
        continue
      }
      if (v && typeof v === 'object') {
        const next = walk(v)
        if (next !== v) set(k, next)
      }
    }
    return copy ?? obj
  }

  const value2 = walk(value) as T
  return { value: value2, count }
}

/** Contact fields the survivor takes from the duplicate when its own are empty. */
export const FILLABLE_CONTACT_FIELDS = [
  'email', 'phone', 'mobile', 'website', 'address', 'postalAddress', 'city', 'country',
  'vatNumber', 'idNumber', 'registrationNumber', 'tradingName', 'jobTitle', 'industry',
  'bankName', 'bankAccount', 'bankBranch',
] as const

export function blanksToFill(survivor: Record<string, unknown>, merged: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of FILLABLE_CONTACT_FIELDS) {
    const mine = String(survivor[f] ?? '').trim()
    const theirs = String(merged[f] ?? '').trim()
    if (!mine && theirs) out[f] = theirs
  }
  return out
}

/** Readable names for the stored collections, for the preview. */
export function collectionLabel(key: string): string {
  const k = key.replace(/^deed_/, '').replace(/_v\d+$/, '')
  const map: Record<string, string> = {
    invoices: 'Invoices and bills', quotes: 'Quotations', saleOrders: 'Sale orders', deliveries: 'Deliveries',
    repairs: 'Repairs', posOrders: 'POS sales', journalEntries: 'Journal entries', deposits: 'Deposits',
    holdovers: 'Holdovers', warranties: 'Warranties', customerCredits: 'Customer credits', purchaseOrders: 'Purchase orders',
    receipts: 'Purchase receipts', returnOrders: 'Returns', refundPayments: 'Refunds', leads: 'CRM leads',
    opportunities: 'Opportunities', serials: 'Serial numbers', documentPaymentDetails: 'Payments',
    expenses: 'Expenses', kilimallOrders: 'Kilimall orders', buyBacks: 'Buy-backs', clientExchanges: 'Exchanges',
  }
  return map[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
}
