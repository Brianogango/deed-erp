import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import {
  hasPermission, SENSITIVE_STORE_KEY_PERMISSIONS, CLIENT_IMMUTABLE_STORE_KEYS, canReadStoreKey,
  CONTENT_FILTERED_STORE_KEYS, filterStoreValueForRole, hasFullStoreContentAccess, mergeFilteredStoreWrite,
} from '@/lib/auth/authorization'
import { loadAppState, saveStoreKeys, getAppStateVersion } from '@/lib/server-store'
import { mergeAppendOnlyJournals } from '@/lib/finance-controls'
import { preserveInvoiceLinesOnStoreWrite, enforcePostedInvoiceImmutability, type RejectedPostedInvoiceEdit } from '@/lib/finance-invoice'
import { mergeProductsStoreWrite } from '@/lib/catalog-merge'
import { appendStoreAudit } from '@/lib/store-audit'
import crypto from 'crypto'

const PROTECTED_NON_EMPTY_ARRAY_KEYS = new Set<string>([
  'deed_repairs_v2',
  'deed_invoices',
  'deed_expenses',
  'deed_outsourceJobs',
  'deed_outsourcePayments',
  'deed_outsourceVendors',
  'deed_purchaseOrders',
  'deed_products',
])

function parseArrayLength(serializedValue: string): number | null {
  try {
    const parsed = JSON.parse(serializedValue)
    return Array.isArray(parsed) ? parsed.length : null
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const keysParam = request.nextUrl.searchParams.get('keys')
  const keys = keysParam
    ? keysParam.split(',').map(key => key.trim()).filter(key => key.startsWith('deed_'))
    : undefined

  // Conditional fetch: the response is fully determined by (requested keys,
  // their updated_at fingerprint, caller identity — role filtering). When the
  // client already holds this exact version in localStorage, answer 304 and
  // skip loading + serializing + transferring the payload entirely.
  let etag: string | undefined
  if (keys?.length) {
    const version = await getAppStateVersion(keys)
    if (version) {
      etag = `W/"${crypto.createHash('md5')
        .update(`${session.user.id}:${session.user.role}:${[...(session.user.modules ?? [])].sort().join(',')}:${keys.join(',')}:${version}`)
        .digest('hex')}"`
      if (request.headers.get('if-none-match') === etag) {
        return new NextResponse(null, { status: 304, headers: { ETag: etag } })
      }
    }
  }

  const state = await loadAppState(keys)
  // Strip permission-gated and collaborative keys the caller isn't allowed to read.
  for (const key of Object.keys(state)) {
    if (!canReadStoreKey(session.user, key)) delete state[key]
  }
  // Content-filtered financial ledgers: each role receives only its slice
  // (repair-linked invoices for workshop roles, own expense claims, ...).
  for (const key of Object.keys(state)) {
    if (CONTENT_FILTERED_STORE_KEYS.has(key)) state[key] = filterStoreValueForRole(session.user, key, state[key]) as typeof state[string]
  }
  return NextResponse.json(state, etag ? { headers: { ETag: etag } } : undefined)
}

export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected object' }, { status: 400 })
  }

  const entries: Record<string, string> = {}
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!k.startsWith('deed_')) continue
    if (CLIENT_IMMUTABLE_STORE_KEYS.has(k)) continue
    entries[k] = typeof v === 'string' ? v : JSON.stringify(v)
  }

  if (Object.keys(entries).length === 0) {
    return NextResponse.json({ error: 'No valid deed_ keys supplied' }, { status: 400 })
  }

  // Permission-gated keys the caller may not write are DROPPED from the batch,
  // not used to reject it wholesale. The client's store-sync flushes every dirty
  // key in one request (e.g. a technician saving a repair diagnosis also carries
  // deed_auditLogs, which is director-only) — a blanket 403 here silently lost
  // the legitimate keys in the same batch (repairs, quotes, ...) even though the
  // caller was fully allowed to write them.
  const deniedKeys = Object.keys(entries).filter(key => {
    const action = SENSITIVE_STORE_KEY_PERMISSIONS[key]
    return action && !hasPermission(session.user, action)
  })
  for (const key of deniedKeys) delete entries[key]

  if (Object.keys(entries).length === 0) {
    await appendStoreAudit(session, [], [], deniedKeys)
    return NextResponse.json(
      { error: `Forbidden — insufficient role to write: ${deniedKeys.join(', ')}`, deniedKeys },
      { status: 403 },
    )
  }

  // Partial-view roles sync back only the slice of deed_invoices/deed_expenses
  // they were served. Merge their rows into the stored ledger by id instead of
  // replacing it, so records outside their view are never deleted.
  const mergeKeys = Object.keys(entries).filter(key =>
    CONTENT_FILTERED_STORE_KEYS.has(key) && !hasFullStoreContentAccess(session.user, key))
  if (mergeKeys.length > 0) {
    const currentState = await loadAppState(mergeKeys)
    for (const key of mergeKeys) {
      let incoming: unknown
      try { incoming = JSON.parse(entries[key]) } catch { continue }
      entries[key] = JSON.stringify(mergeFilteredStoreWrite(currentState[key], incoming))
    }
  }

  // Posted journals are append-only: existing refs cannot be edited or deleted.
  if (entries.deed_journalEntries) {
    const currentState = await loadAppState(['deed_journalEntries'])
    let incoming: unknown
    try { incoming = JSON.parse(entries.deed_journalEntries) } catch {
      delete entries.deed_journalEntries
      deniedKeys.push('deed_journalEntries')
    }
    if (incoming !== undefined) {
      const merged = mergeAppendOnlyJournals(currentState.deed_journalEntries, incoming)
      if (!merged.ok) {
        delete entries.deed_journalEntries
        deniedKeys.push('deed_journalEntries')
        await appendStoreAudit(session, [], [], deniedKeys)
        return NextResponse.json(
          { error: merged.error, deniedKeys },
          { status: 409 },
        )
      }
      entries.deed_journalEntries = JSON.stringify(merged.merged)
    }
  }

  const keysToProtect = Object.keys(entries).filter(key => PROTECTED_NON_EMPTY_ARRAY_KEYS.has(key))
  const skippedKeys: string[] = []
  if (keysToProtect.length > 0) {
    const currentState = await loadAppState(keysToProtect)
    for (const key of keysToProtect) {
      const incomingLength = parseArrayLength(entries[key])
      const currentLength = Array.isArray(currentState[key]) ? currentState[key].length : null
      if (incomingLength === 0 && typeof currentLength === 'number' && currentLength > 0) {
        delete entries[key]
        skippedKeys.push(key)
        continue
      }
      // Product catalog rows created via Prisma must not be dropped by a stale client sync.
      if (key === 'deed_products' && entries[key]) {
        let incoming: unknown
        try { incoming = JSON.parse(entries[key]) } catch { continue }
        entries[key] = JSON.stringify(mergeProductsStoreWrite(currentState[key], incoming))
      }
      // Collaborative ledgers: merge by id so a stale browser cache cannot delete
      // rows that already exist on the server (outsource jobs, repair intakes, …).
      if (
        (
          key === 'deed_outsourceJobs'
          || key === 'deed_outsourcePayments'
          || key === 'deed_outsourceVendors'
          || key === 'deed_repairs_v2'
        )
        && entries[key]
        && Array.isArray(currentState[key])
      ) {
        let incoming: unknown
        try { incoming = JSON.parse(entries[key]) } catch { continue }
        if (Array.isArray(incoming)) {
          const incomingIds = new Set(
            incoming.map((row: { id?: unknown }) => row?.id).filter(id => id != null),
          )
          const serverHasMissing = (currentState[key] as Array<{ id?: unknown }>).some(
            row => row?.id != null && !incomingIds.has(row.id),
          )
          if (serverHasMissing) {
            entries[key] = JSON.stringify(mergeFilteredStoreWrite(currentState[key], incoming))
          }
        }
      }
    }
  }

  // Per-invoice line protection: do not let an empty-line shell overwrite a
  // mirror that already has line items (SO→invoice race / stale client).
  // Posted-invoice immutability (FIN-001): once an invoice is posted, its
  // financial substance (lines/totals/dates/customer/type/ref) can never
  // change through this sync path — only via a credit note, reversal, or
  // the posted→cancelled transition. This runs after the empty-shell guard
  // so a posted invoice is protected regardless of which defect it hit.
  let rejectedPostedInvoiceEdits: RejectedPostedInvoiceEdit[] = []
  if (entries.deed_invoices) {
    const currentInvoices = await loadAppState(['deed_invoices'])
    let incoming: unknown
    try { incoming = JSON.parse(entries.deed_invoices) } catch { incoming = null }
    if (incoming != null) {
      const withPreservedLines = preserveInvoiceLinesOnStoreWrite(currentInvoices.deed_invoices, incoming)
      const guarded = enforcePostedInvoiceImmutability(currentInvoices.deed_invoices, withPreservedLines)
      entries.deed_invoices = JSON.stringify(guarded.merged)
      rejectedPostedInvoiceEdits = guarded.rejected
    }
  }

  const savedKeys = Object.keys(entries)
  if (savedKeys.length === 0) {
    await appendStoreAudit(session, [], skippedKeys, deniedKeys, rejectedPostedInvoiceEdits)
    return NextResponse.json({ ok: true, savedKeys: 0, skippedKeys, deniedKeys, rejectedPostedInvoiceEdits })
  }

  await saveStoreKeys(entries)
  await appendStoreAudit(session, savedKeys, skippedKeys, deniedKeys, rejectedPostedInvoiceEdits)
  return NextResponse.json({ ok: true, savedKeys: savedKeys.length, skippedKeys, deniedKeys, rejectedPostedInvoiceEdits })
}
