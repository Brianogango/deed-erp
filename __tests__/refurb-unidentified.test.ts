/**
 * Machines into Refurbishment without a readable serial: tags, cost split,
 * identification (incl. a machine we had before) and parts harvesting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ state: {} as Record<string, any>, valuations: [] as any[], bumps: [] as any[], assetSeq: {} as Record<string, number> }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-store', () => {
  const read = async (keys: string[]) => Object.fromEntries(keys.map(k => [k, h.state[k] ? JSON.parse(JSON.stringify(h.state[k])) : undefined]))
  return {
    loadAppState: read,
    loadAppStateForWrite: read,
    saveStoreKeys: async (entries: Record<string, string>) => { for (const [k, v] of Object.entries(entries)) h.state[k] = JSON.parse(v) },
    withAppStateKeyLock: async (_k: string, fn: () => Promise<unknown>) => fn(),
  }
})
vi.mock('@/lib/inventory/valuation-hooks', () => ({
  postAdjustmentValuation: vi.fn(async (p: any) => {
    h.valuations.push(p)
    // Source stock is valued at KES 2,000 a unit; adds come back at their cost.
    return { ok: true, result: { totalCost: p.type === 'subtract' ? p.qty * 2000 : p.qty * (p.unitCost ?? 0) } }
  }),
}))
vi.mock('@/lib/inventory/stock-transactions', async () => {
  const real: any = await vi.importActual('@/lib/inventory/stock-transactions')
  return { ...real, bumpPrismaOnHand: vi.fn(async (d: Map<string, number>) => { h.bumps.push(Object.fromEntries(d)) }) }
})
vi.mock('@/lib/prisma', () => ({ default: { $transaction: vi.fn(async () => undefined) } }))
// The real counter lives in Postgres; here it just counts up per prefix.
vi.mock('@/lib/inventory/asset-id.server', async () => {
  const { assetIdPrefix, formatAssetId } = await vi.importActual<typeof import('@/lib/inventory/asset-id')>('@/lib/inventory/asset-id')
  return {
    allocateAssetIds: vi.fn(async (category: string, count: number) => {
      const prefix = assetIdPrefix(category)
      h.assetSeq[prefix] = h.assetSeq[prefix] ?? 0
      return Array.from({ length: count }, () => formatAssetId(prefix, ++h.assetSeq[prefix]))
    }),
  }
})

import { nextIntakeTags, classifySerialMatch, splitUnitCosts, harvestValues, awaitingIdentification } from '@/lib/refurbishment/unidentified'
import { intakeTaggedUnits, identifyTaggedUnit, harvestUnit } from '@/lib/refurbishment/unidentified.server'
import { buildRefurbWeeklyReport, refurbWeekStart, writeOffReason } from '@/lib/refurbishment/weekly-report'

const at = new Date('2026-11-06T09:00:00.000Z')

describe('helpers', () => {
  it('numbers tags per day and never reuses one', () => {
    expect(nextIntakeTags([], 2, at)).toEqual(['UNK-261106-001', 'UNK-261106-002'])
    expect(nextIntakeTags([{ serial: 'UNK-261106-004' }, { serial: 'X', intakeTag: 'UNK-261106-007' }, { serial: 'UNK-261105-099' }], 1, at)).toEqual(['UNK-261106-008'])
    expect(awaitingIdentification({ serial: 'UNK-261106-001' })).toBe(true)
    expect(awaitingIdentification({ serial: '5CG123', identityPending: false })).toBe(false)
  })

  it('splits a stock cost across units, keeping prices set by hand', () => {
    expect(splitUnitCosts(9000, [null, null, null])).toEqual([3000, 3000, 3000])
    expect(splitUnitCosts(9000, [5000, null, null])).toEqual([5000, 2000, 2000])
    expect(splitUnitCosts(0, [1500, null])).toEqual([1500, 0])
  })

  it('a serial we sold before is a returning machine; one in stock is refused', () => {
    const list = [{ id: 'a', serial: 'SOLD1', status: 'sold', location: 'customer' }, { id: 'b', serial: 'HERE1', status: 'available', location: 'warehouse' }]
    expect(classifySerialMatch(list, 'sold1', 'x').kind).toBe('returning')
    expect(classifySerialMatch(list, 'HERE1', 'x').kind).toBe('in_stock')
    expect(classifySerialMatch(list, 'NEW1', 'x').kind).toBe('new')
  })

  it('harvested parts never carry more than the machine cost', () => {
    expect(harvestValues(3000, [{ qty: 2, unitValue: 500 }])).toEqual([500])
    expect(harvestValues(1000, [{ qty: 2, unitValue: 1000 }])).toEqual([500])
    expect(harvestValues(0, [{ qty: 1, unitValue: 800 }])).toEqual([0])
  })
})

beforeEach(() => {
  h.assetSeq = {}
  h.valuations = []
  h.bumps = []
  h.state = {
    deed_products: [
      { id: 'p-unk', name: 'Laptop — unidentified', category: 'Laptops', requiresSerial: true, stockQty: 0 },
      { id: 'p-840', name: 'HP EliteBook 840 G5', requiresSerial: true, stockQty: 3 },
      { id: 'p-scrap', name: 'Scrap laptops', requiresSerial: false, stockQty: 5 },
      { id: 'p-ram', name: '8GB DDR4 RAM', requiresSerial: false, stockQty: 0 },
    ],
    deed_serials: [{ id: 's-old', serial: '5CG999', productId: 'p-840', status: 'sold', location: 'customer', saleOrderId: 'so-1', soldDate: '2025-02-01' }],
    deed_bulkStock: [{ productId: 'p-scrap', location: 'warehouse', qty: 5 }],
    deed_stockMoves: [],
  }
})

describe('intake', () => {
  it('takes units off quantity stock and moves their cost onto tagged units', async () => {
    const out = await intakeTaggedUnits({ userId: 'u', productId: 'p-unk', units: [{ cost: 6000 }, {}, {}], from: { productId: 'p-scrap', location: 'warehouse' }, reference: 'IN-1' }) as any
    expect(out.ok).toBe(true)
    expect(out.serials).toHaveLength(3)
    expect(out.serials[0]).toMatchObject({ identityPending: true, location: 'repair_unit', status: 'refurbishment', productId: 'p-unk' })
    expect(out.serials[0].serial).toMatch(/^UNK-\d{6}-001$/)
    // Each machine gets its sticker number; the barcode is that number.
    expect(out.serials.map((s: any) => s.assetId)).toEqual(['LT000001', 'LT000002', 'LT000003'])
    expect(out.serials[0].barcode).toBe('LT000001')
    expect(out.costs).toEqual([6000, 0, 0]) // stock was worth 6,000 for the 3; one unit priced at 6,000
    expect(h.state.deed_bulkStock[0].qty).toBe(2)
    expect(h.state.deed_products.find((p: any) => p.id === 'p-scrap').stockQty).toBe(2)
    expect(h.state.deed_products.find((p: any) => p.id === 'p-unk').stockQty).toBe(3)
    expect(h.valuations[0]).toMatchObject({ type: 'subtract', productId: 'p-scrap', qty: 3 })
    expect(h.valuations.filter(v => v.type === 'add')).toHaveLength(1)
    expect(h.bumps[0]).toEqual({ 'p-unk': 3, 'p-scrap': -3 })
  })

  it('lands lines in With Issues: known serials kept, typed asset IDs kept, the rest numbered', async () => {
    h.state.deed_serials.push({ id: 's-dt', serial: 'OLD1', productId: 'p-840', status: 'available', location: 'warehouse', assetId: 'DT000005' })
    const out = await intakeTaggedUnits({
      userId: 'u', productId: 'p-unk', reference: 'XL', destination: 'with_issues',
      units: [
        { serial: '5CG777', productId: 'p-840' },
        { serial: '5CG555', assetId: 'dt000006', issue: 'No display', cost: 3000, productId: 'p-840' },
        { issue: 'Dead' },
      ],
    }) as any
    expect(out.ok).toBe(true)
    // No category on the model: numbered as the laptop it was filed under.
    expect(out.serials[0]).toMatchObject({ serial: '5CG777', assetId: 'LT000001' })
    out.serials.shift()
    expect(out.serials[0]).toMatchObject({ serial: '5CG555', assetId: 'DT000006', barcode: 'DT000006', intakeIssue: 'No display', productId: 'p-840', location: 'shop', status: 'available' })
    expect(out.serials[0].identityPending).toBeFalsy()
    expect(out.serials[1]).toMatchObject({ identityPending: true, assetId: 'LT000002', location: 'shop' })
    expect(out.serials[1].serial).toMatch(/^UNK-/)
  })

  it('refuses a taken asset ID and a serial already in stock', async () => {
    h.state.deed_serials.push({ id: 's-dt', serial: 'OLD1', productId: 'p-840', status: 'available', location: 'warehouse', assetId: 'DT000005' })
    expect(await intakeTaggedUnits({ userId: 'u', productId: 'p-unk', reference: 'X', units: [{ assetId: 'DT000005' }] })).toMatchObject({ ok: false })
    expect(await intakeTaggedUnits({ userId: 'u', productId: 'p-840', reference: 'X', units: [{ serial: 'OLD1' }] })).toMatchObject({ ok: false })
  })

  it('refuses more than the stock holds, and a product without serials', async () => {
    expect(await intakeTaggedUnits({ userId: 'u', productId: 'p-unk', units: Array(6).fill({}), from: { productId: 'p-scrap', location: 'warehouse' }, reference: 'X' })).toMatchObject({ ok: false, status: 409 })
    expect(await intakeTaggedUnits({ userId: 'u', productId: 'p-scrap', units: [{}], reference: 'X' })).toMatchObject({ ok: false })
  })
})

describe('identify', () => {
  const tagOne = async () => (await intakeTaggedUnits({ userId: 'u', productId: 'p-unk', units: [{ cost: 4000 }], reference: 'IN' }) as any).serials[0]

  it('records the real serial, keeps the tag as barcode, and moves stock and cost to the model', async () => {
    const tag = await tagOne()
    h.valuations = []
    const out = await identifyTaggedUnit({ userId: 'u', serialId: tag.id, serial: '5CG123ABC', productId: 'p-840', specs: 'i5, 8GB' }) as any
    expect(out.ok).toBe(true)
    expect(out.serial).toMatchObject({ serial: '5CG123ABC', intakeTag: tag.serial, barcode: tag.assetId, assetId: tag.assetId, productId: 'p-840', identityPending: false, specs: 'i5, 8GB' })
    expect(h.state.deed_products.find((p: any) => p.id === 'p-unk').stockQty).toBe(0)
    expect(h.state.deed_products.find((p: any) => p.id === 'p-840').stockQty).toBe(4)
    expect(h.valuations.map(v => `${v.type}:${v.productId}`)).toEqual(['subtract:p-unk', 'add:p-840'])
  })

  it('takes over the record of a machine we sold before, keeping its history', async () => {
    const tag = await tagOne()
    const out = await identifyTaggedUnit({ userId: 'u', serialId: tag.id, serial: '5CG999', productId: 'p-840' }) as any
    expect(out.ok).toBe(true)
    expect(out.removedSerialId).toBe(tag.id)
    expect(out.serial).toMatchObject({ id: 's-old', location: 'repair_unit', status: 'refurbishment', previousSaleOrderId: 'so-1', intakeTag: tag.serial, assetId: tag.assetId })
    expect(h.state.deed_serials.find((s: any) => s.id === tag.id)).toBeUndefined()
  })

  it('refuses a serial already in stock, and the tag itself', async () => {
    h.state.deed_serials.push({ id: 's-here', serial: 'HERE1', productId: 'p-840', status: 'available', location: 'warehouse' })
    const tag = await tagOne()
    expect(await identifyTaggedUnit({ userId: 'u', serialId: tag.id, serial: 'HERE1', productId: 'p-840' })).toMatchObject({ ok: false, status: 409 })
    expect(await identifyTaggedUnit({ userId: 'u', serialId: tag.id, serial: tag.serial })).toMatchObject({ ok: false })
  })
})

describe('harvest', () => {
  it('writes the machine off and puts the kept parts in stock with part of its cost', async () => {
    const tag = (await intakeTaggedUnits({ userId: 'u', productId: 'p-unk', units: [{ cost: 2000 }], reference: 'IN' }) as any).serials[0]
    h.valuations = []
    const out = await harvestUnit({ userId: 'u', serialId: tag.id, reference: 'REF/0009', reason: 'Board dead', parts: [{ productId: 'p-ram', qty: 2, unitValue: 1500 }] }) as any
    expect(out.ok).toBe(true)
    expect(out.machineCost).toBe(2000)
    expect(out.parts[0]).toMatchObject({ qty: 2, unitValue: 1000 }) // capped at the machine's 2,000
    expect(out.partsValue).toBe(2000)
    expect(h.state.deed_serials.find((s: any) => s.id === tag.id).status).toBe('written_off')
    expect(h.state.deed_bulkStock.find((b: any) => b.productId === 'p-ram')).toMatchObject({ location: 'warehouse', qty: 2 })
    expect(h.state.deed_products.find((p: any) => p.id === 'p-ram').stockQty).toBe(2)
    expect(h.valuations.map(v => `${v.type}:${v.productId}`)).toEqual(['subtract:p-unk', 'add:p-ram'])
    expect(h.valuations[1]).toMatchObject({ reversesWriteOff: true, unitCost: 1000, qty: 2 })
  })

  it('refuses serial-tracked parts', async () => {
    const tag = (await intakeTaggedUnits({ userId: 'u', productId: 'p-unk', units: [{}], reference: 'IN' }) as any).serials[0]
    expect(await harvestUnit({ userId: 'u', serialId: tag.id, reference: 'R', reason: 'x', parts: [{ productId: 'p-840', qty: 1, unitValue: 0 }] })).toMatchObject({ ok: false })
  })
})

describe('weekly report', () => {
  it('counts machines awaiting identification and harvested ones', () => {
    const week = refurbWeekStart(at)
    const base = { serialNumber: 'UNK-261106-001', productName: 'Laptop — unidentified', partsNeeded: [] }
    const r = buildRefurbWeeklyReport([
      { ...base, id: '1', ref: 'R1', status: 'in_progress', intakeDate: '2026-11-04T08:00:00Z', assignedTechnicianName: 'T', identityPending: true },
      { ...base, id: '2', ref: 'R2', status: 'written_off', intakeDate: '2026-11-03T08:00:00Z', completedDate: '2026-11-05T08:00:00Z', outcome: 'harvested', harvestedParts: [{ productName: 'RAM', qty: 2 }], harvestPartsValue: 2000, techNotes: 'Harvested for parts: Board dead. Kept: 2× RAM' },
    ] as any, week, at)
    expect(r.pending[0].stage).toBe('Waiting for identification')
    expect(r.totals).toMatchObject({ awaitingIdentification: 1, harvested: 1, harvestPartsValue: 2000 })
    expect(writeOffReason(r.writtenOff[0])).toBe('Harvested for parts (2× RAM) — Board dead')
  })
})
