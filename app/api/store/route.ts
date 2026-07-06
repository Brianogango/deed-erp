import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { hasPermission, SENSITIVE_STORE_KEY_PERMISSIONS, CLIENT_IMMUTABLE_STORE_KEYS } from '@/lib/auth/authorization'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

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
}

function parseArrayLength(serializedValue: string): number | null {
  try {
    const parsed = JSON.parse(serializedValue)
    return Array.isArray(parsed) ? parsed.length : null
  } catch {
    return null
  }
}

async function appendStoreAudit(session: Awaited<ReturnType<typeof getServerSession>>, savedKeys: string[], skippedKeys: string[]) {
  if (!session || (savedKeys.length === 0 && skippedKeys.length === 0)) return
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
  const state = await loadAppState(keys)
  return NextResponse.json(state)
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

  const deniedKeys = Object.keys(entries).filter(key => {
    const action = SENSITIVE_STORE_KEY_PERMISSIONS[key]
    return action && !hasPermission(session.user, action)
  })
  if (deniedKeys.length > 0) {
    return NextResponse.json({ error: `Forbidden — insufficient role to write: ${deniedKeys.join(', ')}` }, { status: 403 })
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
    await appendStoreAudit(session, [], skippedKeys)
    return NextResponse.json({ ok: true, savedKeys: 0, skippedKeys })
  }

  await saveStoreKeys(entries)
  await appendStoreAudit(session, savedKeys, skippedKeys)
  return NextResponse.json({ ok: true, savedKeys: savedKeys.length, skippedKeys })
}
