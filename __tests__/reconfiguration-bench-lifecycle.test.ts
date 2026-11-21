import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The bench job's life after it is planned: moving parts, stopping half-way,
 * finishing without moving a part twice, undoing, and reversing. Prisma and
 * the stock helpers are replaced by a small in-memory model.
 */

type Row = Record<string, any>
const db = {
  wo: null as Row | null,
  removal: [] as Row[],
  install: [] as Row[],
  installations: new Map<string, Row>(),
  stock: new Map<string, number>(),
  moves: [] as Row[],
  cost: null as number | null,
  journals: [] as Row[],
  events: new Set<string>(),
  failInstall: false,
}
const key = (productId: string, location: string) => `${productId}@${location}`

const tx = {
  deviceComponentInstallation: {
    update: async ({ where, data }: Row) => { db.installations.set(where.id, { ...db.installations.get(where.id), ...data }) },
    create: async ({ data }: Row) => { const id = `inst-${db.installations.size + 1}`; db.installations.set(id, { id, ...data }); return { id } },
  },
  reconfigurationRemovalLine: {
    update: async ({ where, data }: Row) => { Object.assign(db.removal.find(l => l.id === where.id)!, data) },
  },
  reconfigurationInstallationLine: {
    update: async ({ where, data }: Row) => { Object.assign(db.install.find(l => l.id === where.id)!, data) },
  },
}

vi.mock('@/lib/prisma', () => ({
  default: {
    reconfigurationWorkOrder: {
      findUnique: async () => (db.wo ? { notes: db.wo.notes } : null),
      update: async ({ data }: Row) => {
        const { version, ...rest } = data
        Object.assign(db.wo!, rest)
        if (version?.increment) db.wo!.version += version.increment
      },
      findFirst: async () => null,
    },
    deviceSerialCost: { upsert: async ({ update }: Row) => { db.cost = update.currentCost } },
    deviceConfigurationSnapshot: { updateMany: async () => ({}), update: async () => ({}) },
    journalEntry: { findFirst: async () => db.journals[0] ?? null },
    valuationEvent: {
      findUnique: async ({ where }: Row) => (db.events.has(where.eventKey) ? { id: 'e' } : null),
      create: async ({ data }: Row) => { db.events.add(data.eventKey) },
    },
  },
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: async () => ({ deed_serials: [] }),
  loadAppStateForWrite: async () => ({ deed_serials: [{ id: 'ser-1', serial: 'SN1', specs: '16GB 512GB SSD', salePriceOverride: 50000 }] }),
  saveStoreKeys: async () => ({}),
  withAppStateKeyLock: async (_k: string, fn: () => Promise<unknown>) => fn(),
}))

const createJournalEntry = vi.fn(async (entry: Row) => { db.journals.push(entry) })
vi.mock('@/lib/accounting/journal-service', () => ({ createJournalEntry: (e: Row) => createJournalEntry(e) }))
vi.mock('@/lib/reconfiguration/sales-bridge', () => ({ refreshSaleOrderHostLineAfterReconfig: async () => ({}) }))

const cancelWorkOrder = vi.fn(async (_params?: unknown) => { db.wo!.status = 'cancelled'; return db.wo })
const postReconfigurationValuation = vi.fn(async (_params?: unknown) => ({ ok: true }))
const syncBlobSpecs = vi.fn(async () => ({}))

vi.mock('@/lib/reconfiguration/service', () => ({
  getWorkOrder: async () => ({
    ...db.wo,
    removalLines: db.removal.map(l => ({ ...l, componentProduct: { name: 'RAM 8GB' } })),
    installationLines: db.install.map(l => ({ ...l, componentProduct: { name: 'RAM 16GB' } })),
  }),
  getDeviceConfiguration: async () => ({ blobSerialId: 'ser-1', status: 'available', location: 'warehouse' }),
  cancelWorkOrder: (p: unknown) => cancelWorkOrder(p as never),
  postReconfigurationValuation: (p: unknown) => postReconfigurationValuation(p as never),
  syncBlobSpecs: (...a: unknown[]) => syncBlobSpecs(...(a as [])),
  // Stock: a "consume" needs stock where it comes from; each move runs the
  // caller's same-transaction step, as the real helper does.
  applyStockPlan: async (plan: Row, _cost: number, ctx: Row) => {
    const consume = plan.kind === 'consume_bulk'
    const at = consume ? plan.from : plan.to
    const have = db.stock.get(key(plan.productId, at)) ?? 0
    if (consume && (db.failInstall || have < plan.qty)) throw Object.assign(new Error(`Insufficient stock at ${at}`), { status: 422 })
    db.stock.set(key(plan.productId, at), have + (consume ? -plan.qty : plan.qty))
    const id = `move-${db.moves.length + 1}`
    db.moves.push({ id, kind: plan.kind, productId: plan.productId, at })
    if (ctx?.inTx) await ctx.inTx(tx, id)
    return id
  },
}))

import { finishStuckBenchJob, reverseBenchJob, runBenchJob, undoStuckBenchJob } from '@/lib/reconfiguration/bench-complete'

const RAM8 = 'ram-8'
const RAM16 = 'ram-16'

function seed(version = 2) {
  db.wo = {
    id: 'wo-1', ref: 'RCF/0007', status: 'in_progress', version: 1, serialId: 'ser-1', manufacturerSerial: 'SN1',
    productId: 'prod-1', warehouseLocation: 'warehouse', costBefore: 40000, sellingPriceBefore: 50000,
    labourCost: 0, otherCost: 0, createdAt: new Date('2026-11-20'), currentSnapshotId: 'snap-before', proposedSnapshotId: 'snap-after',
    notes: JSON.stringify({ bench: { version, ram: {}, storage: {}, before: { totalRamGb: 8, ramComposition: [], primaryStorageGb: 512, storageType: 'SSD', displayName: 'HP 840 8GB 512GB SSD' }, proposed: { totalRamGb: 16, ramComposition: [], primaryStorageGb: 512, storageType: 'SSD', displayName: 'HP 840 16GB 512GB SSD' } } }),
  }
  db.removal = [{ id: 'rl-1', installationId: 'inst-old', componentProductId: RAM8, quantity: 1, existingCost: 2000, actualRemovedAt: null, qaStatus: 'pending', destinationLocation: 'pending_testing' }]
  db.install = [{ id: 'il-1', componentProductId: RAM16, quantity: 1, unitCost: 5000, sourceLocation: 'warehouse', targetSlotType: 'ram_slot', targetSlotNumber: 1, requiredSpec: { capacityGb: 16, category: 'ram' }, installedAt: null }]
  db.installations = new Map([['inst-old', { id: 'inst-old', status: 'installed' }]])
  db.stock = new Map([[key(RAM16, 'warehouse'), 1]])
  db.moves = []
  db.cost = null
  db.journals = []
  db.events = new Set()
  db.failInstall = false
}

beforeEach(() => {
  vi.clearAllMocks()
  seed()
})

describe('a bench job that stops half-way', () => {
  it('is kept with what moved, then finished without moving a part twice', async () => {
    db.failInstall = true
    await expect(runBenchJob('wo-1')).rejects.toThrow(/saved half-done/)
    expect(db.wo!.status).toBe('in_progress')
    expect(db.removal[0].actualRemovedAt).toBeTruthy()
    expect(db.install[0].installedAt).toBeNull()
    expect(JSON.parse(db.wo!.notes).bench.stuck.message).toMatch(/Insufficient stock/)
    expect(cancelWorkOrder).not.toHaveBeenCalled()

    db.failInstall = false
    await finishStuckBenchJob('wo-1')
    expect(db.wo!.status).toBe('completed')
    // One pull and one fit in all — the pull was not repeated.
    expect(db.moves.map(m => m.kind)).toEqual(['return_bulk_to_testing', 'consume_bulk'])
    expect(db.stock.get(key(RAM8, 'pending_testing'))).toBe(1)
    expect(db.stock.get(key(RAM16, 'warehouse'))).toBe(0)
    expect(db.cost).toBe(43000)
    expect(postReconfigurationValuation).toHaveBeenCalledTimes(1)
    expect(JSON.parse(db.wo!.notes).bench.stuck).toBeUndefined()
  })

  it('leaves no trace when nothing moved', async () => {
    db.removal = []
    db.failInstall = true
    await expect(runBenchJob('wo-1')).rejects.toThrow(/Insufficient stock/)
    expect(cancelWorkOrder).toHaveBeenCalledTimes(1)
  })

  it('can be undone: the pulled part goes back into the machine', async () => {
    db.failInstall = true
    await expect(runBenchJob('wo-1')).rejects.toThrow()
    db.failInstall = false
    await undoStuckBenchJob('wo-1')
    expect(db.stock.get(key(RAM8, 'pending_testing'))).toBe(0)
    expect(db.installations.get('inst-old')!.status).toBe('installed')
    expect(db.removal[0].actualRemovedAt).toBeNull()
    expect(cancelWorkOrder).toHaveBeenCalledTimes(1)
  })

  it('an older stuck job can only be undone', async () => {
    seed(1)
    await expect(finishStuckBenchJob('wo-1')).rejects.toThrow(/use Undo/)
  })
})

describe('reversing a finished job', () => {
  it('puts the parts back and the machine on its old cost, with the stock entry reversed', async () => {
    await runBenchJob('wo-1')
    expect(db.wo!.status).toBe('completed')
    db.journals = [{ lines: [
      { accountLabel: '1300 Inventory', debit: 5000, credit: 0, label: 'RCF/0007 device cost installed' },
      { accountLabel: '1300 Inventory', debit: 0, credit: 5000, label: 'RCF/0007 components consumed' },
    ] }]

    await expect(reverseBenchJob('wo-1', undefined, '  ')).rejects.toThrow(/Say why/)
    await reverseBenchJob('wo-1', undefined, 'Wrong RAM fitted')

    expect(db.wo!.status).toBe('reversed')
    expect(db.stock.get(key(RAM16, 'warehouse'))).toBe(1)        // fitted stick back on the shelf
    expect(db.stock.get(key(RAM8, 'pending_testing'))).toBe(0)   // pulled stick back in the machine
    expect(db.installations.get('inst-old')!.status).toBe('installed')
    expect(db.cost).toBe(40000)
    const reversal = createJournalEntry.mock.calls.at(-1)![0]
    expect(reversal.ref).toMatch(/\/REV$/)
    expect(reversal.lines.map((l: Row) => [l.debit, l.credit])).toEqual([[0, 5000], [5000, 0]])
  })

  it('only a completed job is reversed', async () => {
    await expect(reverseBenchJob('wo-1', undefined, 'x')).rejects.toThrow(/Only a completed job/)
  })
})
