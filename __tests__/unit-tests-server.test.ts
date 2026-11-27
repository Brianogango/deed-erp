import { beforeEach, describe, expect, it, vi } from 'vitest'

const store: Record<string, any> = {}
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-store', () => ({
  loadAppState: async (keys: string[]) => Object.fromEntries(keys.map(k => [k, store[k] ?? (k === 'deed_systemSettings' ? {} : [])])),
  loadAppStateForWrite: async (keys: string[]) => Object.fromEntries(keys.map(k => [k, store[k] ?? []])),
  saveStoreKeys: async (e: Record<string, string>) => { for (const [k, v] of Object.entries(e)) store[k] = JSON.parse(v) },
  notifyStoreKeysChanged: async () => {},
  withAppStateKeyLock: async (_k: string, fn: () => Promise<unknown>) => fn(),
}))

import {
  briefs,
  markUnitTestsPlaced,
  overrideUnitTest,
  saveUnitTest,
  startUnitTest,
  testGateError,
} from '@/lib/inventory/unit-tests.server'

const tester = { id: 'u1', name: 'Brian' }
const lead = { id: 'u2', name: 'Lead' }

function fillPassing(test: any, battery = 87): any {
  return {
    checks: test.checks.map((c: any) => ({ ...c, result: c.result ?? 'pass' })),
    batteryHealth: battery,
    grade: 'B',
    spec: { matches: true },
  }
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  store.deed_serials = [
    { id: 's1', serial: 'SN1', productId: 'p1', productName: 'HP EliteBook 840 G6', location: 'pending_testing', status: 'available', assetId: 'LT000124' },
    { id: 's2', serial: 'SN2', productId: 'p1', productName: 'HP EliteBook 840 G6', location: 'warehouse', status: 'available' },
  ]
  store.deed_products = [{ id: 'p1', name: 'HP EliteBook 840 G6', category: 'Laptops' }]
  store.deed_unitTests = []
})

describe('test bench on the server', () => {
  it('starts only for a unit in Inbound, and returns the open test again', async () => {
    const r = await startUnitTest('s1', tester)
    expect(r.ok && r.value.number).toBe(1)
    const again = await startUnitTest('s1', tester)
    expect(again.ok && again.value.id).toBe(r.ok && r.value.id)
    const out = await startUnitTest('s2', tester)
    expect(out.ok).toBe(false)
  })

  it('refuses to finish an incomplete test, and works out the result', async () => {
    const r = await startUnitTest('s1', tester)
    if (!r.ok) throw new Error(r.error)
    const early = await saveUnitTest(r.value.id, {}, { complete: true }, tester)
    expect(early.ok).toBe(false)
    const done = await saveUnitTest(r.value.id, fillPassing(r.value, 41), { complete: true }, tester)
    expect(done.ok && done.value.result).toBe('failed')
    expect(done.ok && done.value.failReasons).toEqual(['Battery 41%'])
  })

  it('blocks Ready for Sale without a passing test, allows it after, and uses the test up', async () => {
    const lines = [{ serialIds: ['s1'] }]
    expect(await testGateError('pending_testing', 'warehouse', lines)).toMatch(/no passing test/)
    const r = await startUnitTest('s1', tester)
    if (!r.ok) throw new Error(r.error)
    expect(await testGateError('pending_testing', 'warehouse', lines)).toMatch(/still on the test bench/)
    await saveUnitTest(r.value.id, fillPassing(r.value), { complete: true }, tester)
    expect(await testGateError('pending_testing', 'warehouse', lines)).toBeNull()
    // Not gated: bulk lines, other destinations, returns from customers.
    expect(await testGateError('pending_testing', 'warehouse', [{ serialIds: [] }])).toBeNull()
    expect(await testGateError('customer', 'warehouse', lines)).toBeNull()
    expect(await testGateError('pending_testing', 'shop', lines)).toBeNull()
    // With Issues straight back to sale: never.
    expect(await testGateError('shop', 'warehouse', lines)).toMatch(/no passing test/)

    await markUnitTestsPlaced('pending_testing', 'warehouse', ['s1'], tester)
    expect(store.deed_unitTests[0].status).toBe('placed')
    expect(store.deed_unitTests[0].placedTo).toBe('warehouse')
    expect(await testGateError('pending_testing', 'warehouse', lines)).toMatch(/no passing test/)
    expect(briefs(store.deed_unitTests)[0]).toMatchObject({ serialId: 's1', result: 'passed', status: 'placed' })
  })

  it('lets the Technical lead pass a failed unit with a reason', async () => {
    const r = await startUnitTest('s1', tester)
    if (!r.ok) throw new Error(r.error)
    await saveUnitTest(r.value.id, fillPassing(r.value, 55), { complete: true }, tester)
    expect(await testGateError('pending_testing', 'warehouse', [{ serialIds: ['s1'] }])).toMatch(/failed its test \(Battery 55%\)/)
    expect((await overrideUnitTest(r.value.id, 'no', lead)).ok).toBe(false)
    const o = await overrideUnitTest(r.value.id, 'Sell at a discount, battery disclosed', lead)
    expect(o.ok && o.value.override?.byName).toBe('Lead')
    expect(await testGateError('pending_testing', 'warehouse', [{ serialIds: ['s1'] }])).toBeNull()
  })

  it('cancels a test left on the bench when the unit leaves Inbound', async () => {
    const r = await startUnitTest('s1', tester)
    if (!r.ok) throw new Error(r.error)
    await markUnitTestsPlaced('pending_testing', 'quarantine', ['s1'], tester)
    expect(store.deed_unitTests[0].status).toBe('cancelled')
  })
})
