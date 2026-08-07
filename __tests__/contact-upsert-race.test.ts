import { describe, expect, it, vi, beforeEach } from 'vitest'
import { upsertContact } from '@/lib/contact-prisma'

function buildMockPrisma() {
  const rows: any[] = []
  const executed: Array<{ query: string; values: unknown[] }> = []
  // Simulates real Postgres advisory-lock blocking: a second call requesting
  // the same key awaits the first holder's release instead of proceeding
  // concurrently (unlike a naive mock that just invokes the callback inline).
  const locks = new Map<string, Promise<void>>()
  const acquireLock = async (key: string): Promise<() => void> => {
    while (locks.has(key)) {
      await locks.get(key)
    }
    let release!: () => void
    locks.set(key, new Promise(resolve => { release = resolve }))
    return () => { locks.delete(key); release() }
  }
  const client = {
    findFirst: vi.fn(async (args: any) => {
      const email = args?.where?.email?.equals?.toLowerCase()
      if (email) return rows.find(r => r.email?.toLowerCase() === email) ?? null
      const or = args?.where?.OR
      if (or) {
        const needle = or[0]?.phone?.contains
        return rows.find(r => r.phone?.includes(needle)) ?? null
      }
      const name = args?.where?.name?.equals?.toLowerCase()
      if (name) return rows.find(r => r.name?.toLowerCase() === name) ?? null
      return null
    }),
    findUnique: vi.fn(async (args: any) => rows.find(r => r.id === args?.where?.id) ?? null),
    findMany: vi.fn(async () => rows),
    count: vi.fn(async () => rows.length),
    create: vi.fn(async (args: any) => {
      const row = { id: `client-${rows.length + 1}`, createdAt: new Date(), ...args.data }
      rows.push(row)
      return row
    }),
    update: vi.fn(async (args: any) => {
      const idx = rows.findIndex(r => r.id === args.where.id)
      rows[idx] = { ...rows[idx], ...args.data }
      return rows[idx]
    }),
    delete: vi.fn(),
  }
  let pendingRelease: (() => void) | null = null
  const self: any = {
    client,
    $executeRawUnsafe: vi.fn(async (query: string, ...values: unknown[]) => {
      executed.push({ query, values })
      if (query.includes('pg_advisory_xact_lock')) {
        pendingRelease = await acquireLock(String(values[0]))
      }
      return 1
    }),
    $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
      try {
        return await fn(self)
      } finally {
        pendingRelease?.()
        pendingRelease = null
      }
    }),
  }
  return { prisma: self, rows, executed }
}

vi.mock('@/lib/server-store', () => ({
  loadAppState: vi.fn().mockResolvedValue({}),
  saveStoreKeys: vi.fn().mockResolvedValue(undefined),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('upsertContact — identity race guard', () => {
  it('acquires an advisory lock keyed by normalized email before find-then-create', async () => {
    const { prisma, executed } = buildMockPrisma()
    await upsertContact(prisma, { name: 'Acme Ltd', email: 'Info@Acme.com' })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(executed).toHaveLength(1)
    expect(executed[0].query).toContain('pg_advisory_xact_lock')
    expect(executed[0].values[0]).toBe('contact:email:info@acme.com')
  })

  it('falls back to phone, then name, when email is absent', async () => {
    const { prisma, executed } = buildMockPrisma()
    await upsertContact(prisma, { name: 'Jane Doe', phone: '+254 712 345 678' })
    expect(executed[0].values[0]).toBe('contact:phone:712345678')

    executed.length = 0
    await upsertContact(prisma, { name: 'No Contact Info Co' })
    expect(executed[0].values[0]).toBe('contact:name:company:no contact info co')
  })

  // Regression: find-then-create without a lock lets two concurrent requests
  // for the SAME identity both see "nothing exists yet" and each create a
  // separate Client row for what should be one contact. Serializing the two
  // calls (as a real Postgres advisory lock would across connections) must
  // produce exactly one row, with the second call updating it instead of
  // duplicating it.
  it('produces exactly one contact when two concurrent upserts race on the same email', async () => {
    const { prisma, rows } = buildMockPrisma()
    // Simulate two requests reaching this function back-to-back — since our
    // mock $transaction executes synchronously in sequence (like the real
    // pg_advisory_xact_lock would serialize them), the second call's
    // findExistingContact must observe the first call's committed row.
    await Promise.all([
      upsertContact(prisma, { name: 'Acme Ltd', email: 'info@acme.com' }),
      upsertContact(prisma, { name: 'Acme Ltd', email: 'info@acme.com' }),
    ])
    expect(rows).toHaveLength(1)
  })

  it('falls back to unlocked upsert when the caller has no $transaction (test doubles)', async () => {
    const { prisma, rows } = buildMockPrisma()
    delete (prisma as any).$transaction
    const result = await upsertContact(prisma, { name: 'Beta Ltd', email: 'hello@beta.com' })
    expect(typeof result).toBe('object')
    expect(rows).toHaveLength(1)
  })
})
