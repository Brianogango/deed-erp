import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import {
  hasPermission, SENSITIVE_STORE_KEY_PERMISSIONS, CLIENT_IMMUTABLE_STORE_KEYS, canReadStoreKey,
  CONTENT_FILTERED_STORE_KEYS, filterStoreValueForRole, hasFullStoreContentAccess, mergeFilteredStoreWrite,
} from '@/lib/auth/authorization'
import { loadAppState, saveStoreKeys, getAppStateVersion } from '@/lib/server-store'
import crypto from 'crypto'

const PROTECTED_NON_EMPTY_ARRAY_KEYS = new Set<string>([
  'deed_repairs_v2',
  'deed_invoices',
  'deed_expenses',
  'deed_outsourceJobs',
  'deed_outsourcePayments',
  'deed_outsourceVendors',
  'deed_purchaseOrders',
])
const IMMUTABLE_AUDIT_KEY = 'deed_audit_timeline_v1'
const MAX_AUDIT_ROWS = 600

type StoreAuditEntry = {
  id: string
  at: string
  actor: { id: string; username: string; role: string; name?: string }
  source: 'store_sync'
  savedKeys: string[]
  skippedKeys: string[]
  deniedKeys?: string[]
}

function parseArrayLength(serializedValue: string): number | null {
  try {
    const parsed = JSON.parse(serializedValue)
    return Array.isArray(parsed) ? parsed.length : null
  } catch {
    return null
  }
}

async function appendStoreAudit(session: Awaited<ReturnType<typeof getServerSession>>, savedKeys: string[], skippedKeys: string[], deniedKeys: string[] = []) {
  if (!session || (savedKeys.length === 0 && skippedKeys.length === 0 && deniedKeys.length === 0)) return
  const current = await loadAppState([IMMUTABLE_AUDIT_KEY])
  const existing = Array.isArray(current[IMMUTABLE_AUDIT_KEY]) ? current[IMMUTABLE_AUDIT_KEY] as StoreAuditEntry[] : []
  const entry: StoreAuditEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    actor: {
      id: session.user.id,
      username: session.user.username,
      role: session.user.role,
      name: session.user.name || undefined,
    },
    source: 'store_sync',
    savedKeys,
    skippedKeys,
    ...(deniedKeys.length > 0 ? { deniedKeys } : {}),
  }
  const next = [...existing, entry].slice(-MAX_AUDIT_ROWS)
  await saveStoreKeys({ [IMMUTABLE_AUDIT_KEY]: JSON.stringify(next) })
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
      }
    }
  }

  const savedKeys = Object.keys(entries)
  if (savedKeys.length === 0) {
    await appendStoreAudit(session, [], skippedKeys, deniedKeys)
    return NextResponse.json({ ok: true, savedKeys: 0, skippedKeys, deniedKeys })
  }

  await saveStoreKeys(entries)
  await appendStoreAudit(session, savedKeys, skippedKeys, deniedKeys)
  return NextResponse.json({ ok: true, savedKeys: savedKeys.length, skippedKeys, deniedKeys })
}
