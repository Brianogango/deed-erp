import 'server-only'

import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'

export type PrismaStateMap = Record<string, unknown>

function parseStoredValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue
}

function identityCandidate(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  for (const field of ['id', 'ref', 'code', 'key', 'number', 'name']) {
    const candidate = row[field]
    if (typeof candidate === 'string' && candidate.trim()) return `${field}:${candidate.trim()}`
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return `${field}:${candidate}`
  }
  return null
}

function compactRecordKey(base: string): string {
  if (base.length <= 220) return base
  const digest = createHash('sha256').update(base).digest('hex').slice(0, 16)
  return `${base.slice(0, 200)}:${digest}`
}

/**
 * Convert a legacy collection into stable, independently stored rows.
 * The occurrence suffix prevents malformed duplicate ids from violating the
 * database constraint while preserving every submitted record.
 */
export function buildProjectionRows(key: string, values: unknown[]) {
  const seen = new Map<string, number>()
  return values.map((payload, position) => {
    const fallback = `hash:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`
    const base = compactRecordKey(identityCandidate(payload) ?? fallback)
    const occurrence = seen.get(base) ?? 0
    seen.set(base, occurrence + 1)
    return {
      key,
      recordKey: occurrence === 0 ? base : compactRecordKey(`${base}#${occurrence + 1}`),
      position,
      payload: jsonValue(payload),
    }
  })
}

export async function loadPrismaState(keys?: string[]): Promise<PrismaStateMap> {
  const where = keys?.length ? { key: { in: keys } } : undefined
  const keyRows = await prisma.erpStateKey.findMany({
    where,
    select: { key: true, kind: true, value: true },
  })
  if (!keyRows.length) return {}

  const collectionKeys = keyRows.filter(row => row.kind === 'collection').map(row => row.key)
  const records = collectionKeys.length
    ? await prisma.erpStateRecord.findMany({
        where: { key: { in: collectionKeys } },
        orderBy: [{ key: 'asc' }, { position: 'asc' }],
        select: { key: true, payload: true },
      })
    : []

  const grouped = new Map<string, unknown[]>()
  for (const row of records) {
    const list = grouped.get(row.key) ?? []
    list.push(row.payload)
    grouped.set(row.key, list)
  }

  const state: PrismaStateMap = {}
  for (const row of keyRows) {
    state[row.key] = row.kind === 'collection' ? (grouped.get(row.key) ?? []) : row.value
  }
  return state
}

/**
 * Persist every legacy store key in Prisma. Collections are stored one record
 * per row, never as a multi-megabyte JSON array. The key row is also the
 * version/change cursor, including when a collection becomes empty.
 */
export async function savePrismaStateEntries(entries: Record<string, string>): Promise<void> {
  const parsed = Object.entries(entries).map(([key, raw]) => [key, parseStoredValue(raw)] as const)
  if (!parsed.length) return

  await prisma.$transaction(async tx => {
    for (const [key, value] of parsed) {
      if (Array.isArray(value)) {
        await tx.erpStateKey.upsert({
          where: { key },
          create: { key, kind: 'collection', version: 1 },
          update: { kind: 'collection', value: Prisma.DbNull, version: { increment: 1 } },
        })
        const rows = buildProjectionRows(key, value)
        const incomingRecordKeys = rows.map(r => r.recordKey)
        if (rows.length) {
          const recordKeys = rows.map(r => r.recordKey)
          const positions = rows.map(r => r.position)
          const payloads = rows.map(r => JSON.stringify(r.payload))
          await tx.$executeRawUnsafe(
            `INSERT INTO erp_state_records (id, key, record_key, position, payload, created_at, updated_at)
             SELECT gen_random_uuid()::text, $1, unnest($2::text[]), unnest($3::int[]), unnest($4::jsonb[]), NOW(), NOW()
             ON CONFLICT (key, record_key) DO UPDATE SET
               position = EXCLUDED.position,
               payload = EXCLUDED.payload,
               updated_at = NOW()`,
            key, recordKeys, positions, payloads,
          )
        }
        await tx.erpStateRecord.deleteMany({
          where: { key, ...(incomingRecordKeys.length ? { recordKey: { notIn: incomingRecordKeys } } : {}) },
        })
      } else {
        await tx.erpStateRecord.deleteMany({ where: { key } })
        await tx.erpStateKey.upsert({
          where: { key },
          create: { key, kind: 'value', value: jsonValue(value), version: 1 },
          update: { kind: 'value', value: jsonValue(value), version: { increment: 1 } },
        })
      }
    }
  })
}

export async function getPrismaStateVersion(keys: string[]): Promise<string> {
  if (!keys.length) return ''
  const aggregate = await prisma.erpStateKey.aggregate({
    where: { key: { in: keys } },
    _max: { updatedAt: true },
    _sum: { version: true },
    _count: { _all: true },
  })
  if (!aggregate._count._all) return ''
  return `${aggregate._max.updatedAt?.toISOString() ?? ''}:${aggregate._count._all}:${aggregate._sum.version ?? 0}`
}

export async function getLatestPrismaStateUpdatedAt(): Promise<string> {
  const latest = await prisma.erpStateKey.aggregate({ _max: { updatedAt: true } })
  return latest._max.updatedAt?.toISOString() ?? ''
}

export async function getPrismaStateChangedKeysSince(
  sinceUpdatedAt: string,
  keys?: string[],
): Promise<{
  keys: string[]
  latestUpdatedAt: string
}> {
  const parsed = new Date(sinceUpdatedAt)
  const since = Number.isNaN(parsed.getTime()) ? new Date(0) : parsed
  const wanted = keys?.filter(Boolean)
  const rows = await prisma.erpStateKey.findMany({
    where: {
      updatedAt: { gt: since },
      ...(wanted?.length ? { key: { in: wanted } } : {}),
    },
    orderBy: { updatedAt: 'asc' },
    select: { key: true, updatedAt: true },
  })
  return {
    keys: rows.map(row => row.key),
    latestUpdatedAt: rows.at(-1)?.updatedAt.toISOString() ?? sinceUpdatedAt,
  }
}
