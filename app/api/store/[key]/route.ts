import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import {
  hasPermission, SENSITIVE_STORE_KEY_PERMISSIONS, CLIENT_IMMUTABLE_STORE_KEYS, canReadStoreKey,
  CONTENT_FILTERED_STORE_KEYS, filterStoreValueForRole, hasFullStoreContentAccess, mergeFilteredStoreWrite,
} from '@/lib/auth/authorization'
import { preserveInvoiceLinesOnStoreWrite, preservePostedInvoicePaymentProgress, enforcePostedInvoiceImmutability } from '@/lib/finance-invoice'
import { mergeSaleOrdersStoreWrite } from '@/lib/sale-order-store-merge'
import { mergeRepairsStoreWrite } from '@/lib/repair-store-merge'
import { mergePosOrdersStoreWrite } from '@/lib/pos-orders-merge'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { appendStoreAudit } from '@/lib/store-audit'

type Params = { params: { key: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key   = decodeURIComponent(params.key)

  if (!canReadStoreKey(session.user, key)) {
    return NextResponse.json({ error: `Forbidden — insufficient role to read: ${key}` }, { status: 403 })
  }

  const state = await loadAppState([key])
  const value = filterStoreValueForRole(session.user, key, state[key] ?? null)

  return NextResponse.json({ key, value })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { value: unknown } | null = null
  try { body = await request.json() } catch {}
  if (!body || !('value' in body)) {
    return NextResponse.json({ error: 'Expected { value: ... }' }, { status: 400 })
  }

  const key = decodeURIComponent(params.key)

  if (CLIENT_IMMUTABLE_STORE_KEYS.has(key)) {
    return NextResponse.json({ error: `Forbidden — ${key} is server-managed and cannot be written by a client` }, { status: 403 })
  }

  const restrictedAction = SENSITIVE_STORE_KEY_PERMISSIONS[key]
  if (restrictedAction && !hasPermission(session.user, restrictedAction)) {
    return NextResponse.json({ error: `Forbidden — insufficient role to write: ${key}` }, { status: 403 })
  }

  let value = typeof body.value === 'string' ? body.value : JSON.stringify(body.value)
  // Partial-view roles merge into the ledger by id instead of replacing it
  // (their client only ever holds the slice they were served).
  if (CONTENT_FILTERED_STORE_KEYS.has(key) && !hasFullStoreContentAccess(session.user, key)) {
    let incoming: unknown
    try { incoming = JSON.parse(value) } catch { incoming = null }
    const currentState = await loadAppState([key])
    value = JSON.stringify(mergeFilteredStoreWrite(currentState[key], incoming))
  }
  let rejectedPostedInvoiceEdits: ReturnType<typeof enforcePostedInvoiceImmutability>['rejected'] = []
  if (key === 'deed_invoices') {
    let incoming: unknown
    try { incoming = JSON.parse(value) } catch { incoming = null }
    const currentState = await loadAppState([key])
    const withPreservedLines = preserveInvoiceLinesOnStoreWrite(currentState[key], incoming)
    // Posted-invoice immutability (FIN-001) — same guard as POST /api/store;
    // a single-key PUT must not be a weaker path to the same tampering.
    const guarded = enforcePostedInvoiceImmutability(currentState[key], withPreservedLines)
    value = JSON.stringify(preservePostedInvoicePaymentProgress(currentState[key], guarded.merged))
    rejectedPostedInvoiceEdits = guarded.rejected
  }
  if (key === 'deed_saleOrders') {
    let incoming: unknown
    try { incoming = JSON.parse(value) } catch { incoming = null }
    const currentState = await loadAppState([key])
    value = JSON.stringify(mergeSaleOrdersStoreWrite(currentState[key], incoming))
  }
  if (key === 'deed_repairs_v2') {
    let incoming: unknown
    try { incoming = JSON.parse(value) } catch { incoming = null }
    const currentState = await loadAppState([key])
    value = JSON.stringify(mergeRepairsStoreWrite(currentState[key], incoming))
  }
  if (key === 'deed_posOrders') {
    let incoming: unknown
    try { incoming = JSON.parse(value) } catch { incoming = null }
    const currentState = await loadAppState([key])
    value = JSON.stringify(mergePosOrdersStoreWrite(currentState[key], incoming))
  }
  await saveStoreKeys({ [key]: value })
  if (rejectedPostedInvoiceEdits.length > 0) {
    await appendStoreAudit(session, [key], [], [], rejectedPostedInvoiceEdits)
  }

  return NextResponse.json({ ok: true, key, ...(rejectedPostedInvoiceEdits.length > 0 ? { rejectedPostedInvoiceEdits } : {}) })
}
