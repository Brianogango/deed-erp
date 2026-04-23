import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from './auth/server'
import { loadAppState, saveStoreKeys } from './server-store'

type AnyRecord = Record<string, unknown>

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function requireSession() {
  const session = await getServerSession()
  if (!session) return { session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { session, error: null }
}

function readCollection<T extends object>(key: string): T[] {
  const state = loadAppState()
  const raw = state[key]
  return Array.isArray(raw) ? (raw as T[]) : []
}

function writeCollection<T>(key: string, items: T[]): void {
  saveStoreKeys({ [key]: JSON.stringify(items) })
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
    let items = readCollection<T>(config.storeKey)

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
    const { error } = await requireSession()
    if (error) return error

    const body = await parseBody(request)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const items = readCollection<T>(config.storeKey)
    const result = config.build(body, items)
    if (typeof result === 'string') return NextResponse.json({ error: result }, { status: 422 })

    items.push(result)
    writeCollection(config.storeKey, items)
    return NextResponse.json({ item: result }, { status: 201 })
  }
}

/**
 * Returns a PATCH handler for `/api/<resource>/[id]`.
 */
export function makePatchHandler<T extends object>(config: CrudConfig<T>) {
  return async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
    const { error } = await requireSession()
    if (error) return error

    const body = await parseBody(request)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const items = readCollection<T>(config.storeKey)
    const idx = items.findIndex(i => (i as AnyRecord)['id'] === params.id)
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    items[idx] = { ...items[idx], ...body, id: params.id } as T
    writeCollection(config.storeKey, items)
    return NextResponse.json({ item: items[idx] })
  }
}

/**
 * Returns a DELETE handler for `/api/<resource>/[id]`.
 */
export function makeDeleteHandler<T extends object>(config: CrudConfig<T>) {
  return async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
    const { error } = await requireSession()
    if (error) return error

    const items = readCollection<T>(config.storeKey)
    const filtered = items.filter(i => (i as AnyRecord)['id'] !== params.id)
    if (filtered.length === items.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    writeCollection(config.storeKey, filtered)
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
 * Convenience: returns { PATCH, DELETE } for a detail route.
 */
export function makeDetailHandlers<T extends object>(config: CrudConfig<T>) {
  return {
    PATCH: makePatchHandler(config),
    DELETE: makeDeleteHandler(config),
  }
}
