/**
 * Search everything by what people actually have in hand: a serial off the
 * machine, a phone number, a name, or any document number.
 *
 * The Ctrl+K box only searched what the current page had loaded, so from
 * Sales a repair could not be found and from Repairs a sale order could not.
 * The server answers with this over every collection the person may read.
 *
 * Pure: the route loads and permission-filters the lists.
 */

import { stockStageLabel } from '@/lib/inventory/sellable-stock'

export type SearchHitType = 'repair' | 'sale_order' | 'invoice' | 'serial' | 'contact' | 'delivery' | 'purchase'

export type SearchHit = {
  type: SearchHitType
  id: string
  title: string
  subtitle: string
  badge?: string
  href: string
}

type Row = Record<string, any>
export type SearchSources = {
  repairs?: Row[]
  saleOrders?: Row[]
  invoices?: Row[]
  serials?: Row[]
  contacts?: Row[]
  deliveries?: Row[]
  purchaseOrders?: Row[]
}

const PER_TYPE = 6

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const lower = (v: unknown) => String(v ?? '').toLowerCase()
const compact = (v: unknown) => lower(v).replace(/[\s/_-]/g, '')

/** Inventory tab where a device in this location is shown. */
const STAGE_TAB: Record<string, string> = {
  warehouse: 'warehouse', shop: 'issues', repair_unit: 'refurbishment',
  pending_testing: 'testing', quarantine: 'quarantine', computer_aid: 'computer_aid',
}

export function searchRecords(sources: SearchSources, rawQuery: string, invoiceHref: (id: string) => string): SearchHit[] {
  const q = lower(rawQuery).trim()
  if (q.length < 2) return []
  const qCompact = compact(q)
  const qDigits = digits(q)
  // A phone search needs enough digits not to match every number.
  const phoneMatch = (v: unknown) => qDigits.length >= 6 && digits(v).endsWith(qDigits.slice(-9))
  const text = (...vals: unknown[]) => vals.some(v => lower(v).includes(q))
  const ref = (...vals: unknown[]) => vals.some(v => v && compact(v).includes(qCompact))

  const out: SearchHit[] = []
  const take = (hits: SearchHit[]) => out.push(...hits.slice(0, PER_TYPE))

  take((sources.repairs ?? [])
    .filter(r => ref(r.ref) || text(r.customerName, r.productName) || ref(r.serialNumber) || phoneMatch(r.customerPhone))
    .map(r => ({
      type: 'repair' as const, id: r.id, title: r.ref,
      subtitle: [r.customerName, r.productName, r.serialNumber ? `SN ${r.serialNumber}` : ''].filter(Boolean).join(' · '),
      badge: String(r.status ?? '').replace(/_/g, ' '),
      href: `/repairs?id=${encodeURIComponent(r.id)}`,
    })))

  take((sources.serials ?? [])
    .filter(s => ref(s.serial, s.barcode))
    .map(s => {
      const loc = String(s.location ?? '')
      const href = s.status === 'sold' && s.saleOrderId ? `/sales?id=${encodeURIComponent(s.saleOrderId)}`
        : s.repairId ? `/repairs?id=${encodeURIComponent(s.repairId)}`
          : STAGE_TAB[loc] ? `/inventory?tab=warehouse_view&location=${STAGE_TAB[loc]}&q=${encodeURIComponent(s.serial)}`
            : `/inventory?q=${encodeURIComponent(s.serial)}`
      return {
        type: 'serial' as const, id: s.id, title: s.serial,
        subtitle: [s.productName, s.status === 'sold' ? 'sold' : stockStageLabel(loc)].filter(Boolean).join(' · '),
        badge: s.status === 'sold' ? 'sold' : String(s.status ?? ''),
        href,
      }
    }))

  take((sources.contacts ?? [])
    .filter(c => text(c.name, c.email) || phoneMatch(c.phone))
    .map(c => ({
      type: 'contact' as const, id: c.id, title: c.name,
      subtitle: [c.phone, c.email].filter(Boolean).join(' · '),
      badge: c.isVendor && c.isCustomer ? 'customer & vendor' : c.isVendor ? 'vendor' : 'customer',
      href: `/contacts?id=${encodeURIComponent(c.id)}&contactTab=history`,
    })))

  take((sources.saleOrders ?? [])
    .filter(o => ref(o.ref, o.orderNumber) || text(o.customerName))
    .map(o => ({
      type: 'sale_order' as const, id: o.id, title: o.ref ?? o.orderNumber,
      subtitle: `${o.customerName ?? ''} · KES ${Math.round(Number(o.total ?? 0)).toLocaleString('en-KE')}`,
      badge: String(o.status ?? '').replace(/_/g, ' '),
      href: `/sales?id=${encodeURIComponent(o.id)}`,
    })))

  take((sources.invoices ?? [])
    .filter(i => ref(i.ref) || text(i.partnerName))
    .map(i => ({
      type: 'invoice' as const, id: i.id, title: i.ref,
      subtitle: `${i.type === 'vendor_bill' ? 'Bill' : 'Invoice'} · ${i.partnerName ?? ''} · KES ${Math.round(Number(i.total ?? 0)).toLocaleString('en-KE')}`,
      badge: String(i.status ?? ''),
      href: invoiceHref(i.id),
    })))

  take((sources.deliveries ?? [])
    .filter(d => ref(d.ref) || text(d.customerName))
    .map(d => ({
      type: 'delivery' as const, id: d.id, title: d.ref,
      subtitle: `${d.customerName ?? ''} · ${d.saleOrderRef ?? ''}`,
      badge: String(d.status ?? ''),
      href: `/sales?id=${encodeURIComponent(d.saleOrderId)}`,
    })))

  take((sources.purchaseOrders ?? [])
    .filter(p => ref(p.ref) || text(p.vendorName))
    .map(p => ({
      type: 'purchase' as const, id: p.id, title: p.ref,
      subtitle: `${p.vendorName ?? ''} · KES ${Math.round(Number(p.total ?? 0)).toLocaleString('en-KE')}`,
      badge: String(p.status ?? ''),
      href: `/purchases?id=${encodeURIComponent(p.id)}`,
    })))

  return out
}
