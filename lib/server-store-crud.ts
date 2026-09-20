import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from './auth/server'
import { isRoleAllowed } from './auth/authorization'
import type { PublicUser } from './auth/types'
import { loadAppState, saveStoreKeys, withAppStateKeyLock } from './server-store'
import { parsePaginationParams, paginateArray } from './api-pagination'
import { resolveRouteParams, type RouteParams } from './route-params'

type AnyRecord = Record<string, unknown>

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function requireSession(allowedRoles?: string[]) {
  const session = await getServerSession()
  if (!session) return { session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (allowedRoles && !isRoleAllowed(session.user.role, allowedRoles)) {
    return { session: null, error: NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 }) }
  }
  return { session, error: null }
}

async function readCollection<T extends object>(key: string): Promise<T[]> {
  const state = await loadAppState([key])
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
  /** Optional: async mutation of POST body before build (e.g. server-side ref allocation). */
  prepareCreate?: (body: AnyRecord) => Promise<AnyRecord | string>
  /** Optional async mutation of a PATCH body after the current row is loaded. */
  preparePatch?: (body: AnyRecord, previous: T) => Promise<AnyRecord | string>
  /**
   * Optional write guard after merge/build. Return an error string to reject
   * with 422. For PATCH, `previous` is the existing row; for POST it is undefined.
   */
  validateWrite?: (next: T, previous: T | undefined) => string | null
  /**
   * Optional hard-delete guard. Return an error string when a record must be
   * preserved (for example because downstream financial/audit documents exist).
   */
  validateDelete?: (existing: T) => string | null
  /** Roles allowed to write (POST/PATCH/DELETE). GET is open to any authenticated user. */
  allowedWriteRoles?: string[]
  /**
   * Optional row-level authorization for detail mutations. Use this for
   * collaborative ledgers where a role may write only records it owns or is
   * assigned to. Returning false produces 403 before any merge/write occurs.
   */
  recordAccess?: (user: PublicUser, record: T, action: 'patch' | 'delete') => boolean
  /**
   * Opt-in: serialize concurrent writers to this collection with a
   * transaction-scoped advisory lock (see withAppStateKeyLock). Without it,
   * two concurrent writes to the same storeKey can silently lose one
   * writer's change (read-modify-write with no row-level locking). Defaults
   * to unset for backward compatibility with existing callers.
   */
  lockKey?: string
  /**
   * Optional best-effort dual-write hook fired after a successful create or
   * patch (never on delete). Runs after the response payload is already
   * built and must never throw or block the request — a mirror failure is
   * a soft dual-write gap, not a reason to fail the blob write that IS the
   * operational source of truth for this collection.
   */
  onWritten?: (item: T, event: 'create' | 'patch') => void | Promise<void>
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

    const { page, limit, sort, order } = parsePaginationParams(searchParams)
    if (sort) {
      items = [...items].sort((a, b) => {
        const av = (a as AnyRecord)[sort]
        const bv = (b as AnyRecord)[sort]
        const as = av == null ? '' : String(av)
        const bs = bv == null ? '' : String(bv)
        const cmp = as.localeCompare(bs, undefined, { numeric: true, sensitivity: 'base' })
        return order === 'asc' ? cmp : -cmp
      })
    }
    const pagePayload = paginateArray(
      config.redact
        ? items.map(item => {
            const copy = { ...item }
            config.redact!.forEach(k => delete (copy as AnyRecord)[k as string])
            return copy
          })
        : items,
      page,
      limit,
    )

    return NextResponse.json(pagePayload)
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

    let preparedBody = body
    if (config.prepareCreate) {
      const prepared = await config.prepareCreate(body)
      if (typeof prepared === 'string') return NextResponse.json({ error: prepared }, { status: 422 })
      preparedBody = prepared
    }

    const run = async () => {
      const items = await readCollection<T>(config.storeKey)
      const result = config.build(preparedBody, items)
      if (typeof result === 'string') return { error: result }

      if (config.validateWrite) {
        const writeError = config.validateWrite(result, undefined)
        if (writeError) return { error: writeError }
      }

      items.push(result)
      await writeCollection(config.storeKey, items)
      return { result }
    }
    const outcome = config.lockKey ? await withAppStateKeyLock(config.lockKey, run) : await run()
    if (outcome.error) return NextResponse.json({ error: outcome.error }, { status: 422 })
    if (outcome.result && config.onWritten) {
      void Promise.resolve(config.onWritten(outcome.result, 'create')).catch(() => {})
    }
    return NextResponse.json({ item: outcome.result }, { status: 201 })
  }
}

/**
 * Returns a PATCH handler for `/api/<resource>/[id]`.
 */
export function makePatchHandler<T extends object>(config: CrudConfig<T>) {
  return async function PATCH(request: NextRequest, { params }: { params: RouteParams<{ id: string }> }) {
    const { session, error } = await requireSession(config.allowedWriteRoles)
    if (error) return error

    const { id } = await resolveRouteParams(params)
    const body = await parseBody(request)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const run = async () => {
      const items = await readCollection<T>(config.storeKey)
      const idx = items.findIndex(i => (i as AnyRecord)['id'] === id)
      if (idx === -1) return { notFound: true as const }

      const previous = items[idx]
      if (config.recordAccess && (!session || !config.recordAccess(session.user, previous, 'patch'))) {
        return { forbidden: true as const }
      }
      let preparedBody = body
      if (config.preparePatch) {
        const prepared = await config.preparePatch(body, previous)
        if (typeof prepared === 'string') return { error: prepared }
        preparedBody = prepared
      }
      const next = { ...previous, ...preparedBody, id } as T
      if (config.validateWrite) {
        const writeError = config.validateWrite(next, previous)
        if (writeError) return { error: writeError }
      }

      items[idx] = next
      await writeCollection(config.storeKey, items)
      return { result: items[idx] }
    }
    const outcome = config.lockKey ? await withAppStateKeyLock(config.lockKey, run) : await run()
    if (outcome.notFound) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (outcome.forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (outcome.error) return NextResponse.json({ error: outcome.error }, { status: 422 })
    if (outcome.result && config.onWritten) {
      void Promise.resolve(config.onWritten(outcome.result, 'patch')).catch(() => {})
    }
    return NextResponse.json({ item: outcome.result })
  }
}

/**
 * Returns a DELETE handler for `/api/<resource>/[id]`.
 */
export function makeDeleteHandler<T extends object>(config: CrudConfig<T>) {
  return async function DELETE(_: NextRequest, { params }: { params: RouteParams<{ id: string }> }) {
    const { session, error } = await requireSession(config.allowedWriteRoles)
    if (error) return error

    const { id } = await resolveRouteParams(params)
    const items = await readCollection<T>(config.storeKey)
    const existing = items.find(i => (i as AnyRecord)['id'] === id)
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (config.recordAccess && (!session || !config.recordAccess(session.user, existing, 'delete'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (config.validateDelete) {
      const deleteError = config.validateDelete(existing)
      if (deleteError) return NextResponse.json({ error: deleteError }, { status: 409 })
    }

    const filtered = items.filter(i => (i as AnyRecord)['id'] !== id)
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
