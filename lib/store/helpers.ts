import { type Holdover, type Product } from './inventory'
import { type InvoiceType, type JournalEntry, type Account, type Invoice } from './finance'
import { uid } from './ids'
import { upsertBulkStock as _upsertBulkStock, calcStockByLocation as _calcStockByLocation } from '@/lib/business-logic'
import { type SaleOrder } from './sales'
import { markSaleOrderDraftEdit, saleOrderLinesFingerprint } from '@/lib/sale-order-draft-edits'
import { rememberSaleOrdersSnapshot, _pendingSync, addDirtyKey } from './sync'
import { persistClientStoreValue } from '@/lib/client-store-cache'
import { normalizeSaleOrdersForClient } from '@/lib/odoo-sales-flow'
import { allocateDocNumber } from '@/lib/doc-numbers'
import { saleOrderPersistBody } from '@/lib/sale-order-persist'
import { type RepairStatus } from '@/lib/repair-types'
import { type POLine } from './purchasing'
import { type LocationId } from './core'
import { formatKeInteger } from '@/lib/intl-cache'
import { userCan } from '@/lib/auth/can'

/** Module-level helpers of the store: totals, stock by location, document refs and saves to the server. */

/**
 * Roles the server sends customer invoices to (see invoiceSliceForRole). For
 * anyone else the screen holds no customer invoices, so counting live ones
 * would read as "none" and drop a credit note that is owed.
 */
export const seesCustomerInvoices = (user: { role?: string } | null | undefined) => userCan(user, 'accounting.customer_invoices.view')

export const LOCATIONS: Record<LocationId, { name: string; icon: string; color: string }> = {
  warehouse:         { name: 'Warehouse (Main)',  icon: '🏭', color: '#875BF7' },
  shop:              { name: 'With Issues',        icon: '⚠️',  color: '#F59E0B' },
  repair_unit:       { name: 'Repair Unit',       icon: '🔧', color: '#F04438' },
  computer_aid:      { name: 'Computer Aid',      icon: '🤝', color: '#0EA5E9' },
  computer_aid_collected: { name: 'Computer Aid — Collected', icon: '✅', color: '#12B76A' },
  computer_aid_issues: { name: 'Computer Aid — With Issues', icon: '⚠️', color: '#F79009' },
  vendor:            { name: 'Vendor',            icon: '🚚', color: '#F79009' },
  customer:          { name: 'Customer',          icon: '👤', color: '#2E90FA' },
  employee:          { name: 'Employee Asset',    icon: '🧑', color: '#7F56D9' },
  pending_testing:   { name: 'Inbound — Awaiting tests', icon: '🧪', color: '#0EA5E9' },
  quarantine:        { name: 'Inbound — Rejected', icon: '🚫', color: '#DC2626' },
}

// Comprehensive Repair Status Flow
export const REPAIR_TERMINAL_STATUSES: RepairStatus[] = ['closed', 'cancelled', 'declined', 'unrepairable', 'returned', 'retained']

export const normalizeProductIdentity = (value: unknown) => String(value ?? '').trim().toLowerCase()

export function findProductIdentityDuplicate(products: Product[], product: Partial<Product>, excludeId?: string) {
  const name = normalizeProductIdentity(product.name)
  const sku = normalizeProductIdentity(product.sku)
  const barcode = normalizeProductIdentity(product.barcode)
  const allowSharedName = !!(product as Partial<Product> & { parentId?: string }).parentId
  return products.find(existing => {
    if (excludeId && existing.id === excludeId) return false
    return (
      (!allowSharedName && !!name && normalizeProductIdentity(existing.name) === name) ||
      (!!sku && normalizeProductIdentity(existing.sku) === sku) ||
      (!!barcode && normalizeProductIdentity(existing.barcode) === barcode)
    )
  })
}

export function productCreateLockKey(product: Partial<Product>) {
  return [
    normalizeProductIdentity(product.name),
    normalizeProductIdentity(product.sku),
    normalizeProductIdentity(product.barcode),
  ].join('|')
}

export const addDays = (d: string, n: number) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10) }

// Document numbers come from the server (lib/doc-numbers.ts); the per-browser
// counters that lived here repeated across browsers (ADJ/0001, TR/0001…).

/**
 * Ask the server to issue the warranties for machines just sold. It reads the
 * saved sale, so it runs once the save has had time to reach the server, and
 * again a little later in case it had not. Safe to repeat.
 */
export let warrantySyncTimers: ReturnType<typeof setTimeout>[] = []

/** Hand warranties the server just issued to open screens (merged by id). */
export function announceIssuedWarranties(out: { added?: unknown[] } | null | undefined) {
  if (typeof window === 'undefined' || !Array.isArray(out?.added) || !out.added.length) return
  window.dispatchEvent(new CustomEvent('deed:warranties-issued', { detail: out.added }))
}

export function requestWarrantySync() {
  if (typeof window === 'undefined') return
  warrantySyncTimers.forEach(clearTimeout)
  const run = () => { void fetch('/api/warranties/sync', { method: 'POST' }).then(r => r.json()).then(announceIssuedWarranties).catch(() => {}) }
  warrantySyncTimers = [setTimeout(run, 8_000), setTimeout(run, 45_000)]
}

/** Repairs whose invoice is being created right now (see createInvoiceFromRepair). */
export const repairInvoiceInFlight = new Map<string, Promise<Invoice | null>>()

/** Allocate a Kilimall order / dispatch / settlement ref from the server-side atomic counter. */
export async function fetchNextKilimallRef(kind: 'kilimall_order' | 'kilimall_dispatch' | 'kilimall_settlement'): Promise<string | null> {
  try {
    return await allocateDocNumber(kind)
  } catch {
    return null
  }
}

/** Allocate a delivery-job ref from the server-side atomic counter. */
export async function fetchNextDeliveryRef(): Promise<string | null> {
  try {
    return await allocateDocNumber('delivery_job')
  } catch {
    return null
  }
}

// Draft invoices carry a placeholder reference; the official INV/BILL number
// is assigned from the per-year sequence only when the invoice is posted
// (Odoo: posting assigns the official number).
export const draftInvoiceRef = (type: InvoiceType) =>
  `DRAFT/${type === 'vendor_bill' ? 'BILL' : 'INV'}/${uid().slice(0, 8).toUpperCase()}`

export const isDraftInvoiceRef = (ref: string | undefined) => Boolean(ref?.startsWith('DRAFT/'))

export const calcSO = (lines: Array<{ subtotal: number; taxRate: number }>) => {
  const sub = lines.reduce((a, l) => a + l.subtotal, 0)
  const tax = lines.reduce((a, l) => a + Math.round(l.subtotal * l.taxRate / 100), 0)
  return { subtotal: sub, taxTotal: tax, total: sub + tax }
}

export const calcPO = (lines: POLine[]) => {
  const sub = lines.reduce((a, l) => a + l.subtotal, 0)
  const tax = lines.reduce((a, l) => a + Math.round(l.subtotal * l.taxRate / 100), 0)
  return { subtotal: sub, taxTotal: tax, total: sub + tax }
}

export const calcStockByLocation = _calcStockByLocation

export const upsertBulkStock = _upsertBulkStock

export const DATA_VERSION = 'v4'

/**
 * Save a newly created invoice/bill to the invoices table and TELL the user if
 * it does not land. This used to be fire-and-forget `sync`, so a failed save
 * left a posted bill that existed only on screen (and was later dropped by the
 * list rebuild). Retries only when no response arrived or the gateway failed
 * (502/503/504); on a retry a "already exists" answer counts as success.
 */
export const saveInvoiceToServer = async (
  invoice: unknown,
  onFailure: (message: string) => void,
): Promise<boolean> => {
  const ref = String((invoice as { ref?: unknown })?.ref ?? 'document')
  const delays = [0, 1500, 4000]
  let lastError = ''
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await new Promise(resolve => setTimeout(resolve, delays[attempt]))
    try {
      const res = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoice) })
      if (res.ok) return true
      const payload = await res.json().catch(() => null) as { error?: string } | null
      lastError = payload?.error || `server returned ${res.status}`
      if (attempt > 0 && (res.status === 409 || /already exists|unique/i.test(lastError))) return true
      if (![502, 503, 504].includes(res.status)) break
    } catch {
      lastError = 'no connection to the server'
    }
  }
  onFailure(`${ref} was NOT saved to the server (${lastError}). Do not close this tab; tell Finance so it can be re-saved.`)
  return false
}

/**
 * A write whose failure the user is told about.
 *
 * `sync` above discards everything — it does not even read res.ok — so a 403,
 * a 404 or a 500 looks exactly like success and the caller's toast still says
 * "saved". Use this wherever the user is being told their change was stored.
 */
export const syncOrWarn = (
  url: string,
  opts: RequestInit,
  onFailure: (message: string) => void,
  fallbackMessage: string,
) => {
  void fetch(url, opts)
    .then(async res => {
      if (res.ok) return
      const payload = await res.json().catch(() => null) as { error?: string } | null
      onFailure(payload?.error || fallbackMessage)
    })
    .catch(() => onFailure(fallbackMessage))
}

/**
 * Post a journal this action built into journal_entries.
 *
 * These flows had no server endpoint of their own, so the only thing putting
 * their entries in the ledger was the blob mirror replaying
 * deed_journalEntries — which made the blob load-bearing for the Trial
 * Balance, the P&L and the Balance Sheet. The route dedupes on ref, so the
 * local copy and this post describe the same entry rather than two.
 */
export type SystemJournalKind =
  | 'fixed_asset'
  | 'pos_session'
  | 'rma_refund'
  | 'buyback_credit'
  | 'sale_order_credit_note'
  | 'invoice_adjustment'

export const postSystemJournal = (
  kind: SystemJournalKind,
  journal: JournalEntry,
  onFailure: (message: string) => void,
) => {
  syncOrWarn('/api/accounting/system-journals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind,
      id: journal.id,
      ref: journal.ref,
      date: journal.date,
      description: journal.description,
      invoiceId: (journal as JournalEntry & { invoiceId?: string }).invoiceId,
      lines: journal.lines.map(l => ({
        account: l.account,
        description: l.description,
        debit: l.debit,
        credit: l.credit,
      })),
    }),
  }, onFailure, `${journal.ref} was not posted to the ledger — please retry`)
}

/** Save a holdover (holdovers table). Resolves to the saved record, or an error message. */
export async function saveHoldoverToServer(method: 'POST' | 'PATCH', url: string, body: Partial<Holdover>): Promise<Holdover | string> {
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.id) return data as Holdover
    return String(data?.error ?? `server returned ${res.status}`)
  } catch {
    return 'check your connection and try again'
  }
}

/** Save an account to the chart (account_codes). Resolves to an error message, or null when saved. */
export async function saveAccountToServer(method: 'POST' | 'PUT', url: string, account: Account): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(account),
    })
    if (res.ok) return null
    const data = await res.json().catch(() => null)
    return String(data?.error ?? `server returned ${res.status}`)
  } catch {
    return 'check your connection and try again'
  }
}

export async function patchSaleOrderPersist(
  id: string,
  order: Record<string, unknown>,
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/sale-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(saleOrderPersistBody(order)),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, error: String(data?.error ?? `Could not save quotation (${res.status})`) }
    }
    return { ok: true, data }
  } catch {
    return { ok: false, error: 'Could not save quotation — check your connection and try again' }
  }
}

/** Apply a draft quotation line edit locally and block stale remote sync. */
export function applyLocalDraftSaleOrder(
  soRef: React.MutableRefObject<SaleOrder[]>,
  setSaleOrders: React.Dispatch<React.SetStateAction<SaleOrder[]>>,
  orderId: string,
  updated: SaleOrder,
) {
  markSaleOrderDraftEdit(orderId)
  soRef.current = soRef.current.map(s => (s.id === orderId ? updated : s))
  setSaleOrders(prev => {
    const next = prev.map(s => (s.id === orderId ? updated : s))
    try {
      const serialized = JSON.stringify(next)
      rememberSaleOrdersSnapshot(serialized)
      _pendingSync['deed_saleOrders'] = serialized
      addDirtyKey('deed_saleOrders')
      if (typeof window !== 'undefined') {
        persistClientStoreValue('deed_saleOrders', serialized)
      }
    } catch { /* ignore quota / circular */ }
    return next
  })
}

/**
 * Merge Prisma PATCH response into local SO state.
 * Only lockVersion (+ optional lines/totals) — never wholesale-replace the row,
 * or a slower notes keystroke response can clobber a newer local edit.
 */
export function applySaleOrderPersistResult(
  setSaleOrders: React.Dispatch<React.SetStateAction<SaleOrder[]>>,
  soRef: React.MutableRefObject<SaleOrder[]>,
  id: string,
  data: any,
  opts?: { syncLines?: boolean; expectedLinesFingerprint?: string },
) {
  if (!data || typeof data !== 'object') return
  const [normalized] = normalizeSaleOrdersForClient([data]) as SaleOrder[]
  if (!normalized) return
  setSaleOrders(cur => {
    const next = cur.map(s => {
      if (s.id !== id) return s
      const withLock = {
        ...s,
        lockVersion: normalized.lockVersion ?? s.lockVersion,
      }
      if (!opts?.syncLines || !Array.isArray(normalized.lines)) return withLock
      // A slower PATCH must not restore products the user already removed.
      if (
        opts.expectedLinesFingerprint
        && saleOrderLinesFingerprint(s.lines) !== opts.expectedLinesFingerprint
      ) {
        return withLock
      }
      return {
        ...withLock,
        lines: normalized.lines,
        subtotal: normalized.subtotal ?? s.subtotal,
        taxTotal: normalized.taxTotal ?? s.taxTotal,
        total: normalized.total ?? s.total,
        discountAmount: normalized.discountAmount ?? s.discountAmount,
      }
    })
    soRef.current = next
    return next
  })
}

/** Prevents concurrent confirmSO races from creating duplicate waiting DNs. */
export const confirmingSaleOrderIds = new Set<string>()

// Coerce defensively: amounts synced from the server sometimes arrive as
// strings (Prisma Decimal) or undefined — never render "KSh NaN".
export const fmtKes = (n: number | string | null | undefined) => {
  const v = typeof n === 'string' ? Number(n.replace(/,/g, '')) : Number(n ?? 0)
  return `KSh ${formatKeInteger(Math.round(Number.isFinite(v) ? v : 0))}`
}
