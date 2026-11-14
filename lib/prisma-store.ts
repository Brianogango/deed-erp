import 'server-only'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { isBlobKey } from '@/lib/blob-store'

type StoreMap = Record<string, unknown>

function parseMaybeJson(value: unknown): Prisma.InputJsonValue {
  if (typeof value !== 'string') {
    return (value ?? null) as Prisma.InputJsonValue
  }
  try { return JSON.parse(value) as Prisma.InputJsonValue } catch {
    return value
  }
}

// One flag governs every storage layer — see lib/store-backend.ts.
export { storeBackend } from '@/lib/store-backend'

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

export async function countStoreRecords(): Promise<number> {
  return prisma.storeRecord.count()
}

