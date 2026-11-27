import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UNIT_TEST_CHECKLIST,
  applyTestPatch,
  compareTests,
  computeResult,
  inboundStage,
  isLaptopProduct,
  missingForCompletion,
  newUnitTest,
  readyForSaleCheck,
  summarizeTest,
  testRowLine,
  unitTestSettings,
  type UnitTest,
} from '@/lib/inventory/unit-tests'

const serial = { id: 's1', serial: 'SN1', productId: 'p1', productName: 'HP EliteBook 840 G6' }

function blank(isLaptop = true, previous: UnitTest[] = []): UnitTest {
  return newUnitTest({ id: `t${previous.length + 1}`, serial, isLaptop, checklist: DEFAULT_UNIT_TEST_CHECKLIST, previous, startedAt: '2026-11-27T08:00:00Z', startedByName: 'Brian' })
}

function allPass(t: UnitTest): UnitTest {
  return applyTestPatch(t, {
    checks: t.checks.map(c => ({ ...c, result: c.result ?? 'pass' })),
    batteryHealth: 87,
    batteryCycles: 312,
    storageHealth: 98,
    grade: 'B',
    spec: { matches: true, cpu: 'i5-8365U', ramGb: 16, storageGb: 256 },
    installs: { os: 'Win 11 Pro', osActivated: true, drivers: true, office: true },
  })
}

const settings = unitTestSettings({})

describe('unit test settings', () => {
  it('defaults to 60% fail and 80% note', () => {
    expect(settings.batteryFailBelow).toBe(60)
    expect(settings.batteryNoteBelow).toBe(80)
    expect(settings.checklist.length).toBe(DEFAULT_UNIT_TEST_CHECKLIST.length)
  })
  it('uses an edited checklist and threshold', () => {
    const s = unitTestSettings({ invUnitTestChecklist: [{ id: 'x', label: 'Fan noise', short: 'Fan' }], invBatteryFailBelow: 50 })
    expect(s.checklist.map(i => i.id)).toEqual(['x'])
    expect(s.batteryFailBelow).toBe(50)
  })
})

describe('new test', () => {
  it('numbers tests per unit and marks laptop-only checks N/A on a desktop', () => {
    const desktop = blank(false)
    expect(desktop.number).toBe(1)
    expect(desktop.checks.find(c => c.itemId === 'keyboard')?.result).toBe('na')
    const second = blank(true, [{ ...desktop, status: 'placed' }])
    expect(second.number).toBe(2)
    expect(second.source).toBe('retest')
  })
  it('detects laptops by category or name', () => {
    expect(isLaptopProduct('Laptops', '')).toBe(true)
    expect(isLaptopProduct('Monitors', 'Dell P2419')).toBe(false)
  })
})

describe('result', () => {
  it('passes when everything passes', () => {
    const t = allPass(blank())
    expect(missingForCompletion(t)).toEqual([])
    expect(computeResult(t, settings)).toEqual({ result: 'passed', reasons: [] })
  })
  it('needs battery, grade and spec on a laptop', () => {
    const missing = missingForCompletion(blank())
    expect(missing.join(' ')).toMatch(/Battery/)
    expect(missing.join(' ')).toMatch(/Grade/)
    expect(missing.join(' ')).toMatch(/spec/i)
  })
  it('fails on a low battery and a blocking check, not on a cosmetic one', () => {
    let t = allPass(blank())
    t = applyTestPatch(t, {
      batteryHealth: 41,
      checks: t.checks.map(c => c.itemId === 'keyboard' ? { ...c, result: 'fail', note: '3 dead keys' }
        : c.itemId === 'casing' ? { ...c, result: 'fail', note: 'scratch on lid', cosmetic: true } : c),
    })
    const r = computeResult(t, settings)
    expect(r.result).toBe('failed')
    expect(r.reasons).toEqual(['Battery 41%', 'Keys: 3 dead keys'])
  })
  it('fails on an extra blocking issue', () => {
    const t = applyTestPatch(allPass(blank()), { issues: [{ id: 'i', text: 'Fan noisy', severity: 'blocks_sale' }] })
    expect(computeResult(t, settings).reasons).toEqual(['Fan noisy'])
  })
})

describe('stages and the Ready for Sale gate', () => {
  it('moves awaiting → on bench → tested', () => {
    expect(inboundStage([], 's1')).toBe('awaiting')
    const t = blank()
    expect(inboundStage([t], 's1')).toBe('on_bench')
    expect(inboundStage([{ ...t, status: 'completed', result: 'passed' }], 's1')).toBe('tested')
    expect(inboundStage([{ ...t, status: 'placed', result: 'passed' }], 's1')).toBe('awaiting')
  })
  it('lets only a passing, unplaced test from Inbound into Ready for Sale', () => {
    const passed: UnitTest = { ...allPass(blank()), status: 'completed', result: 'passed' }
    expect(readyForSaleCheck([passed], 's1', 'pending_testing').ok).toBe(true)
    expect(readyForSaleCheck([passed], 's1', 'shop').ok).toBe(false)
    expect(readyForSaleCheck([{ ...passed, status: 'placed' }], 's1', 'pending_testing').ok).toBe(false)
    expect(readyForSaleCheck([], 's1', 'pending_testing').ok).toBe(false)
    const failed: UnitTest = { ...passed, result: 'failed', failReasons: ['Battery 41%'] }
    const r = readyForSaleCheck([failed], 's1', 'pending_testing')
    expect(r.ok).toBe(false)
    expect(r.ok ? '' : r.error).toMatch(/Battery 41%/)
    expect(readyForSaleCheck([{ ...failed, override: { byId: 'u', byName: 'Lead', reason: 'Sell at discount', at: 'x' } }], 's1', 'pending_testing').ok).toBe(true)
  })
})

describe('summary and comparison', () => {
  it('summarises a passed test for the label', () => {
    const t: UnitTest = { ...allPass(blank()), status: 'completed', result: 'passed', completedAt: '2026-11-27T09:00:00Z', testedByName: 'Brian' }
    const s = summarizeTest(t)
    expect(s.headline).toBe('PASSED')
    expect(s.battery).toBe('Battery 87% (312 cyc)')
    expect(s.readings).toEqual(['SSD 98%', 'RAM OK'])
    expect(s.passedCount).toBe(10)
    expect(s.installs).toBe('Win 11 Pro (activated) · Drivers · Office')
    expect(s.dateTester).toBe('27 Nov · Brian')
    expect(testRowLine(t)).toBe('Grade B · Battery 87% (312 cyc) · 10/10 passed')
  })
  it('shows what a repair fixed', () => {
    const before = applyTestPatch(allPass(blank()), { batteryHealth: 41 })
    const k = before.checks.map(c => c.itemId === 'keyboard' ? { ...c, result: 'fail' as const, note: '3 dead keys' } : c)
    const b = applyTestPatch(before, { checks: k })
    const after = applyTestPatch(allPass(blank()), { batteryHealth: 98 })
    const changes = compareTests(b, after)
    expect(changes.map(c => [c.what, c.fixed])).toEqual([['Battery', true], ['Keyboard & touchpad', true]])
  })
})
