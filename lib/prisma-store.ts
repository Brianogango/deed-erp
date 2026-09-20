import 'server-only'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { isBlobKey } from '@/lib/blob-store'

export type StoreMap = Record<string, unknown>

function parseMaybeJson(value: unknown): Prisma.InputJsonValue {
  if (typeof value !== 'string') {
    return (value ?? null) as Prisma.InputJsonValue
  }
  try { return JSON.parse(value) as Prisma.InputJsonValue } catch {
    return value
  }
}

export function storeBackend(): 'prisma' | 'dual' | 'app_state' {
  const raw = String(process.env.STORE_BACKEND || 'prisma').trim().toLowerCase()
  if (raw === 'app_state' || raw === 'blob') return 'app_state'
  if (raw === 'dual') return 'dual'
  return 'prisma'
}

export async function readStoreRecords(keys?: string[]): Promise<StoreMap> {
  const wanted = keys?.filter(key => key && !isBlobKey(key))
  const rows = wanted?.length
    ? await prisma.storeRecord.findMany({ where: { key: { in: wanted } } })
    : wanted && wanted.length === 0
      ? []
      : await prisma.storeRecord.findMany()
  const out: StoreMap = {}
  for (const row of rows) out[row.key] = row.value
  return out
}

export async function writeStoreRecords(entries: Record<string, string>): Promise<void> {
  const pairs = Object.entries(entries).filter(([key]) => key && !isBlobKey(key))
  if (!pairs.length) return
  await prisma.$transaction(
    pairs.map(([key, raw]) =>
      prisma.storeRecord.upsert({
        where: { key },
        create: { key, value: parseMaybeJson(raw) },
        update: { value: parseMaybeJson(raw) },
      }),
    ),
  )
}

export async function storeRecordVersion(keys: string[]): Promise<{ latest: string; n: number }> {
  const wanted = keys.filter(Boolean)
  if (!wanted.length) return { latest: '', n: 0 }
  const agg = await prisma.storeRecord.aggregate({
    where: { key: { in: wanted } },
    _max: { updatedAt: true },
    _count: { _all: true },
  })
  return {
    latest: agg._max.updatedAt ? agg._max.updatedAt.toISOString() : '',
    n: agg._count._all,
  }
}

export async function loadStoreRecordChangesSince(sinceUpdatedAt: string): Promise<{
  changes: StoreMap
  latestUpdatedAt: string
}> {
  const since = Date.parse(sinceUpdatedAt)
  const rows = Number.isFinite(since)
    ? await prisma.storeRecord.findMany({
      where: { updatedAt: { gt: new Date(since) } },
      orderBy: { updatedAt: 'asc' },
    })
    : await prisma.storeRecord.findMany({ orderBy: { updatedAt: 'asc' } })
  const changes: StoreMap = {}
  for (const row of rows) changes[row.key] = row.value
  const latestUpdatedAt = rows.length
    ? rows[rows.length - 1].updatedAt.toISOString()
    : sinceUpdatedAt
  return { changes, latestUpdatedAt }
}

export async function latestStoreRecordUpdatedAt(): Promise<string> {
  const agg = await prisma.storeRecord.aggregate({
    _max: { updatedAt: true },
  })
  return agg._max.updatedAt ? agg._max.updatedAt.toISOString() : ''
}

export async function countStoreRecords(): Promise<number> {
  return prisma.storeRecord.count()
}

export async function deleteStoreRecords(keys: string[]): Promise<number> {
  if (!keys.length) return 0
  const result = await prisma.storeRecord.deleteMany({ where: { key: { in: keys } } })
  return result.count
}
