import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from './auth/server'
import { loadAppState, saveStoreKeys } from './server-store'

type AnyRecord = Record<string, unknown>

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function requireSession(allowedRoles?: string[]) {
  const session = await getServerSession()
  if (!session) return { session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (allowedRoles && !allowedRoles.includes(session.user.role)) {
    return { session: null, error: NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 }) }
  }
  return { session, error: null }
}

async function readCollection<T extends object>(key: string): Promise<T[]> {
  const state = await loadAppState()
  const raw = state[key]
  return Array.isArray(raw) ? (raw as T[]) : []
}

async function writeCollection<T>(key: string, items: T[]): Promise<void> {
  await saveStoreKeys({ [key]: JSON.stringify(items) })
}

function parseBody(request: NextRequest): Promise<AnyRecord | null> {
  return request.json().catch(() => null)
}

// ─── Factory types ────────────────────────────────────────────────────────────

export interface CrudConfig<T extends object> {
  /** localStorage / app_state key, e.g. 'deed_saleOrders' */
  storeKey: string
  /** Build a new item from raw POST body. Must assign a unique id. */
  build: (body: AnyRecord, existing: T[]) => T | string  // string = validation error
  /** Optional: filter items for list endpoint. Default returns all. */
  filter?: (items: T[], params: URLSearchParams) => T[]
  /** Optional: fields to redact from list responses (e.g. sensitive HR data). */
  redact?: (keyof T)[]
  /** Roles allowed to write (POST/PATCH/DELETE). GET is open to any authenticated user. */
  allowedWriteRoles?: string[]
}

// ─── Handler factories ────────────────────────────────────────────────────────

/**
 * Returns a GET handler that lists all items in `storeKey`.
 * Supports ?q= full-text search over string fields when no custom `filter` is provided.
 */
export function makeListHandler<T extends object>(config: CrudConfig<T>) {
  return async function GET(request: NextRequest) {
    const { error } = await requireSession()
    if (error) return error

    const { searchParams } = new URL(request.url)
    let items = await readCollection<T>(config.storeKey)

    if (config.filter) {
      items = config.filter(items, searchParams)
    } else {
      const q = searchParams.get('q')?.toLowerCase()
      if (q) {
        items = items.filter(item =>
          Object.values(item).some(v => typeof v === 'string' && v.toLowerCase().includes(q))
        )
      }
    }

    const page = parseInt(searchParams.get('page') ?? '1', 10)
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '200', 10), 500)
    const total = items.length
    const paginated = items.slice((page - 1) * limit, page * limit)

    const result = config.redact
      ? paginated.map(item => {
          const copy = { ...item }
          config.redact!.forEach(k => delete (copy as AnyRecord)[k as string])
          return copy
        })
      : paginated

    return NextResponse.json({ items: result, total, page, limit })
  }
}

/**
 * Returns a POST handler that appends a new item to `storeKey`.
 */
export function makeCreateHandler<T extends object>(config: CrudConfig<T>) {
  return async function POST(request: NextRequest) {
    const { error } = await requireSession(config.allowedWriteRoles)
    if (error) return error

    const body = await parseBody(request)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const items = await readCollection<T>(config.storeKey)
    const result = config.build(body, items)
    if (typeof result === 'string') return NextResponse.json({ error: result }, { status: 422 })

    items.push(result)
    await writeCollection(config.storeKey, items)
    return NextResponse.json({ item: result }, { status: 201 })
  }
}

/**
 * Returns a PATCH handler for `/api/<resource>/[id]`.
 */
export function makePatchHandler<T extends object>(config: CrudConfig<T>) {
  return async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
    const { error } = await requireSession(config.allowedWriteRoles)
    if (error) return error

    const body = await parseBody(request)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const items = await readCollection<T>(config.storeKey)
    const idx = items.findIndex(i => (i as AnyRecord)['id'] === params.id)
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    items[idx] = { ...items[idx], ...body, id: params.id } as T
    await writeCollection(config.storeKey, items)
    return NextResponse.json({ item: items[idx] })
  }
}

/**
 * Returns a DELETE handler for `/api/<resource>/[id]`.
 */
export function makeDeleteHandler<T extends object>(config: CrudConfig<T>) {
  return async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
    const { error } = await requireSession(config.allowedWriteRoles)
    if (error) return error

    const items = await readCollection<T>(config.storeKey)
    const filtered = items.filter(i => (i as AnyRecord)['id'] !== params.id)
    if (filtered.length === items.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await writeCollection(config.storeKey, filtered)
    return NextResponse.json({ ok: true })
  }
}

/**
 * Convenience: returns { GET, POST } for a collection route.
 */
export function makeCollectionHandlers<T extends object>(config: CrudConfig<T>) {
  return {
    GET: makeListHandler(config),
    POST: makeCreateHandler(config),
  }
}

/**
 * Returns a PUT handler for `/api/<resource>/[id]` — replaces the item (behaves like PATCH merge).
 */
export function makePutHandler<T extends object>(config: CrudConfig<T>) {
  return makePatchHandler(config)
}

/**
 * Convenience: returns { GET_ONE, PATCH, PUT, DELETE } for a detail route.
 * PUT is aliased to PATCH (both do a merge-update so full object replacements work).
 */
export function makeDetailHandlers<T extends object>(config: CrudConfig<T>) {
  const patch = makePatchHandler(config)
  return {
    PATCH: patch,
    PUT: patch,
    DELETE: makeDeleteHandler(config),
  }
}
