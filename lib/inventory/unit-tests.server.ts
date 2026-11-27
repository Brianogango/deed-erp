import 'server-only'

import { randomUUID } from 'crypto'
import { loadAppState, loadAppStateForWrite, notifyStoreKeysChanged, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import {
  TEST_GATED_FROM,
  applyTestPatch,
  computeResult,
  effectiveResult,
  isLaptopProduct,
  mayTestUnit,
  missingForCompletion,
  newUnitTest,
  readyForSaleCheck,
  summarizeTest,
  testRowLine,
  testsForSerial,
  unitTestSettings,
  type UnitTest,
} from '@/lib/inventory/unit-tests'

/** Test records live on the server only: the screens read and change them through /api/inventory/unit-tests. */
export const UNIT_TESTS_KEY = 'deed_unitTests'

type Actor = { id: string; name: string }
type Row = Record<string, any>

const arr = <T = Row>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

export async function loadUnitTests(): Promise<UnitTest[]> {
  const state = await loadAppState([UNIT_TESTS_KEY])
  return arr<UnitTest>(state[UNIT_TESTS_KEY])
}

async function save(next: UnitTest[]): Promise<void> {
  await saveStoreKeys({ [UNIT_TESTS_KEY]: JSON.stringify(next) })
  await notifyStoreKeysChanged([UNIT_TESTS_KEY]).catch(() => {})
}

type Fail = { ok: false; error: string; status: number }
const fail = (error: string, status = 422): Fail => ({ ok: false, error, status })

/** Change the tests under the lock; `fn` returns the new list or an error. */
async function mutate<T>(fn: (tests: UnitTest[]) => Promise<{ ok: true; tests: UnitTest[]; value: T } | Fail> | ({ ok: true; tests: UnitTest[]; value: T } | Fail)): Promise<{ ok: true; value: T } | Fail> {
  return withAppStateKeyLock(UNIT_TESTS_KEY, async () => {
    const state = await loadAppStateForWrite([UNIT_TESTS_KEY])
    const tests = arr<UnitTest>(state[UNIT_TESTS_KEY])
    const r = await fn(tests)
    if (!r.ok) return r
    await save(r.tests)
    return { ok: true as const, value: r.value }
  })
}

export async function loadTestSettings() {
  const s = await loadAppState(['deed_systemSettings'])
  const sys = s.deed_systemSettings && typeof s.deed_systemSettings === 'object' ? s.deed_systemSettings as Record<string, unknown> : {}
  return unitTestSettings(sys)
}

/**
 * The Technical lead gives units waiting in Inbound to a tester. A unit
 * already on someone's bench is moved only if `force` (reassign).
 */
export async function assignUnitTests(serialIds: string[], tech: Actor, actor: Actor): Promise<{ ok: true; value: { assigned: number; skipped: string[] } } | Fail> {
  const src = await loadAppState(['deed_serials', 'deed_products'])
  const serials = arr(src.deed_serials)
  const products = arr(src.deed_products)
  const at = new Date().toISOString()
  return mutate(tests => {
    let next = tests
    const skipped: string[] = []
    let assigned = 0
    for (const id of serialIds) {
      const serial = serials.find(s => s.id === id)
      if (!serial || serial.location !== 'pending_testing') { skipped.push(serial?.serial || id); continue }
      const mine = testsForSerial(next, id)
      if (mine.some(t => t.status === 'completed')) { skipped.push(`${serial.serial} (already tested)`); continue }
      const open = mine.find(t => t.status === 'assigned' || t.status === 'in_progress')
      const assign = { assignedToId: tech.id, assignedToName: tech.name, assignedAt: at, assignedByName: actor.name }
      if (open) {
        next = next.map(t => (t.id === open.id ? { ...t, ...assign } : t))
      } else {
        const product = products.find(p => p.id === serial.productId)
        const t = newUnitTest({
          id: randomUUID(),
          serial: { id: serial.id, serial: serial.serial, productId: serial.productId, productName: serial.productName, assetId: serial.assetId },
          isLaptop: isLaptopProduct(product?.category, serial.productName || product?.name),
          checklist: [],
          previous: next,
          startedAt: at,
        })
        next = [...next, { ...t, status: 'assigned' as const, startedAt: '', startedById: undefined, startedByName: undefined, ...assign }]
      }
      assigned++
    }
    if (!assigned) return fail(skipped.length ? `Nothing assigned: ${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} not waiting for a test.` : 'Pick units to assign.')
    return { ok: true, tests: next, value: { assigned, skipped } }
  })
}

/** Take a unit back from its tester before they start (back to unassigned). */
export async function unassignUnitTest(serialId: string): Promise<{ ok: true; value: null } | Fail> {
  return mutate(tests => {
    const a = testsForSerial(tests, serialId).find(t => t.status === 'assigned')
    if (!a) return fail('This unit is not waiting with a tester (a started test is taken off the bench instead).')
    return { ok: true, tests: tests.filter(t => t.id !== a.id), value: null }
  })
}

/** Put a unit on the test bench (it must be in Inbound). */
export async function startUnitTest(serialId: string, actor: Actor, opts: { canAssign?: boolean } = { canAssign: true }): Promise<{ ok: true; value: UnitTest } | Fail> {
  const src = await loadAppState(['deed_serials', 'deed_products', 'deed_refurbishmentJobs'])
  const serial = arr(src.deed_serials).find(s => s.id === serialId)
  if (!serial) return fail('Unit not found', 404)
  if (serial.location !== 'pending_testing') return fail(`${serial.serial} is not in Inbound — only units awaiting tests go to the test bench.`)
  if (['sold', 'written_off'].includes(String(serial.status))) return fail(`${serial.serial} is ${serial.status}.`)
  const product = arr(src.deed_products).find(p => p.id === serial.productId)
  const settings = await loadTestSettings()
  return mutate(tests => {
    if (!mayTestUnit(tests, serialId, actor.id, !!opts.canAssign)) {
      return fail(`${serial.serial} has not been given to you. The Technical lead assigns units for testing.`, 403)
    }
    const mine = testsForSerial(tests, serialId)
    const open = mine.find(t => t.status === 'in_progress')
    if (open) return { ok: true, tests, value: open }
    const waiting = mine.find(t => t.status === 'assigned')
    if (mine.some(t => t.status === 'completed')) return fail(`${serial.serial} has been tested and is waiting to be placed. Reopen its test to change it.`)
    const lastPlaced = mine.find(t => t.status === 'placed')
    const job = arr(src.deed_refurbishmentJobs)
      .filter(j => j.serialId === serialId && j.status === 'transferred')
      .sort((a, b) => String(b.transferDate ?? '').localeCompare(String(a.transferDate ?? '')))[0]
    const afterRepair = !!job && (!lastPlaced || String(job.transferDate ?? '') > String(lastPlaced.placedAt ?? ''))
    const fresh = newUnitTest({
      id: waiting?.id ?? randomUUID(),
      serial: { id: serial.id, serial: serial.serial, productId: serial.productId, productName: serial.productName, assetId: serial.assetId },
      isLaptop: isLaptopProduct(product?.category, serial.productName || product?.name),
      checklist: settings.checklist,
      previous: waiting ? tests.filter(x => x.id !== waiting.id) : tests,
      startedAt: new Date().toISOString(),
      startedById: actor.id,
      startedByName: actor.name,
      ...(afterRepair ? { source: 'retest_after_repair' as const, refurbJobRef: job.ref } : {}),
    })
    // Started by whoever it was given to keeps the assignment on the record.
    const t: UnitTest = waiting
      ? { ...fresh, assignedToId: waiting.assignedToId, assignedToName: waiting.assignedToName, assignedAt: waiting.assignedAt, assignedByName: waiting.assignedByName }
      : { ...fresh, assignedToId: actor.id, assignedToName: actor.name }
    return { ok: true, tests: waiting ? tests.map(x => (x.id === waiting.id ? t : x)) : [...tests, t], value: t }
  })
}

/** Save the form; with `complete`, finish it and work out the result. */
export async function saveUnitTest(testId: string, patch: Partial<UnitTest>, opts: { complete?: boolean; canAssign?: boolean }, actor: Actor): Promise<{ ok: true; value: UnitTest } | Fail> {
  const settings = await loadTestSettings()
  return mutate(tests => {
    const t = tests.find(x => x.id === testId)
    if (!t) return fail('Test not found', 404)
    if (!opts.canAssign && t.assignedToId !== actor.id && t.startedById !== actor.id) return fail('This test belongs to another tester.', 403)
    if (t.status !== 'in_progress') return fail('This test is finished. Reopen it to change it.')
    let next = applyTestPatch(t, patch)
    if (opts.complete) {
      const missing = missingForCompletion(next)
      if (missing.length) return fail(`Not finished: ${missing.join('; ')}.`)
      const r = computeResult(next, settings)
      next = { ...next, status: 'completed', result: r.result, failReasons: r.reasons, completedAt: new Date().toISOString(), testedById: actor.id, testedByName: actor.name }
    }
    return { ok: true, tests: tests.map(x => (x.id === testId ? next : x)), value: next }
  })
}

/** Back on the bench: a finished test not yet placed can be corrected. */
export async function reopenUnitTest(testId: string): Promise<{ ok: true; value: UnitTest } | Fail> {
  return mutate(tests => {
    const t = tests.find(x => x.id === testId)
    if (!t) return fail('Test not found', 404)
    if (t.status !== 'completed') return fail(t.status === 'placed' ? 'This unit has been placed already: send it back to Inbound to test it again.' : 'Only a finished test can be reopened.')
    const { result: _r, failReasons: _f, completedAt: _c, override: _o, ...rest } = t
    const next: UnitTest = { ...rest, status: 'in_progress' }
    return { ok: true, tests: tests.map(x => (x.id === testId ? next : x)), value: next }
  })
}

/** Take it off the bench without a result (back to Awaiting test). */
export async function cancelUnitTest(testId: string, reason: string): Promise<{ ok: true; value: UnitTest } | Fail> {
  return mutate(tests => {
    const t = tests.find(x => x.id === testId)
    if (!t) return fail('Test not found', 404)
    if (t.status !== 'in_progress') return fail('Only a test still on the bench can be cancelled.')
    const next: UnitTest = { ...t, status: 'cancelled', cancelledAt: new Date().toISOString(), cancelReason: reason || 'Taken off the bench' }
    return { ok: true, tests: tests.map(x => (x.id === testId ? next : x)), value: next }
  })
}

/** The Technical lead passes a failed unit anyway; the reason goes on the label. */
export async function overrideUnitTest(testId: string, reason: string, actor: Actor): Promise<{ ok: true; value: UnitTest } | Fail> {
  if (reason.trim().length < 5) return fail('Give the reason (it is printed on the label).')
  return mutate(tests => {
    const t = tests.find(x => x.id === testId)
    if (!t) return fail('Test not found', 404)
    if (t.status !== 'completed' || effectiveResult(t) !== 'failed') return fail('Only a failed test waiting for placement can be passed anyway.')
    const next: UnitTest = { ...t, override: { byId: actor.id, byName: actor.name, reason: reason.trim().slice(0, 200), at: new Date().toISOString() } }
    return { ok: true, tests: tests.map(x => (x.id === testId ? next : x)), value: next }
  })
}

/**
 * The transfer check: a serialised unit goes into Ready for Sale only from
 * Inbound with a passing test. Returns the first refusal, or null.
 */
export async function testGateError(fromLocation: string, toLocation: string, lines: Array<{ serialIds?: string[] }>): Promise<string | null> {
  if (toLocation !== 'warehouse' || !(TEST_GATED_FROM as readonly string[]).includes(fromLocation)) return null
  const ids = lines.flatMap(l => l.serialIds ?? []).filter(Boolean)
  if (!ids.length) return null
  const [tests, src] = await Promise.all([loadUnitTests(), loadAppState(['deed_serials'])])
  const serials = arr(src.deed_serials)
  for (const id of ids) {
    const s = serials.find(x => x.id === id)
    const r = readyForSaleCheck(tests, id, fromLocation, s?.serial || 'This unit')
    if (!r.ok) return r.error
  }
  return null
}

/**
 * After a transfer out of Inbound: the unit's finished test is used up
 * (placed, with where it went) and an unfinished one is cancelled.
 */
export async function markUnitTestsPlaced(fromLocation: string, toLocation: string, serialIds: string[], actor: Actor): Promise<void> {
  if (fromLocation !== 'pending_testing' || !serialIds.length) return
  const ids = new Set(serialIds)
  const at = new Date().toISOString()
  await mutate(tests => {
    let changed = false
    const next = tests.map(t => {
      if (!ids.has(t.serialId)) return t
      if (t.status === 'completed') { changed = true; return { ...t, status: 'placed' as const, placedAt: at, placedByName: actor.name, placedTo: toLocation } }
      if (t.status === 'in_progress' || t.status === 'assigned') { changed = true; return { ...t, status: 'cancelled' as const, cancelledAt: at, cancelReason: `Moved out of Inbound to ${toLocation}` } }
      return t
    })
    return changed ? { ok: true, tests: next, value: null } : fail('nothing to change', 200)
  }).catch(err => console.error('[unit-tests] could not mark tests placed:', err))
}

export interface UnitTestBrief {
  testId: string
  serialId: string
  number: number
  status: UnitTest['status']
  result: ReturnType<typeof effectiveResult>
  line: string
  grade?: string | null
  batteryHealth?: number | null
  failReasons: string[]
  cosmetic: string[]
  completedAt?: string
  testedByName?: string
  startedByName?: string
  startedAt: string
  placedTo?: string
  source?: UnitTest['source']
  refurbJobRef?: string
  overrideReason?: string
  assignedToId?: string
  assignedToName?: string
  assignedAt?: string
  testedById?: string
  /** The unit's previous finished test, if this one is a retest. */
  previous?: { number: number; result: ReturnType<typeof effectiveResult>; failReasons: string[]; placedTo?: string }
}

/** One line per unit (its newest test), for the lists. */
export function briefs(tests: UnitTest[]): UnitTestBrief[] {
  const latest = new Map<string, UnitTest>()
  for (const t of tests) {
    if (t.status === 'cancelled') continue
    const cur = latest.get(t.serialId)
    if (!cur || (t.number || 0) > (cur.number || 0)) latest.set(t.serialId, t)
  }
  return [...latest.values()].map(t => {
    const s = summarizeTest(t)
    const prev = t.status === 'assigned' || t.status === 'in_progress'
      ? testsForSerial(tests, t.serialId).find(x => x.id !== t.id && (x.status === 'placed' || x.status === 'completed'))
      : undefined
    return {
      testId: t.id,
      serialId: t.serialId,
      number: t.number,
      status: t.status,
      result: effectiveResult(t),
      line: testRowLine(t),
      grade: t.grade ?? null,
      batteryHealth: t.batteryHealth ?? null,
      failReasons: t.failReasons ?? [],
      cosmetic: s.cosmetic,
      completedAt: t.completedAt,
      testedByName: t.testedByName,
      startedByName: t.startedByName,
      startedAt: t.startedAt,
      placedTo: t.placedTo,
      source: t.source,
      refurbJobRef: t.refurbJobRef,
      overrideReason: t.override?.reason,
      assignedToId: t.assignedToId,
      assignedToName: t.assignedToName,
      assignedAt: t.assignedAt,
      testedById: t.testedById,
      ...(prev ? { previous: { number: prev.number, result: effectiveResult(prev), failReasons: prev.failReasons ?? [], placedTo: prev.placedTo } } : {}),
    }
  })
}
