import { describe, expect, it, beforeEach, vi } from 'vitest'
import { assertFiniteSequenceNext } from '@/lib/data-validation'

/**
 * Mirrors lib/store.tsx makeC / seq for the ADV counter — the Apply button
 * previously called seq('ADV', 'adv') without an `adv` key, which threw and
 * made Submit appear to do nothing.
 */
const makeC = () => ({
  so: 88, inv: 88, po: 39, rep: 0, del: 26, pos: 12, war: 10, rec: 0, tr: 0, ret: 0, adj: 0, rma: 0,
  opp: 15, quote: 24, activity: 0, outsource: 4, outsource_pay: 1, exp: 5, sop: 3, refurb: 0,
  djb: 3, rwp: 0, bbk: 0, don: 0, exc: 0, ko: 0, kd: 0, ks: 0, rfd: 0,
  dep: 0, proc: 0, jrn_rfd: 0, orc: 0, adv: 0,
})

function seq(prefix: string, key: keyof ReturnType<typeof makeC>, C: ReturnType<typeof makeC>, storage: Map<string, string>) {
  const lsKey = `deed_seq2_${key}`
  const stored = storage.get(lsKey) ?? null
  const parsed = stored !== null ? parseInt(stored, 10) : NaN
  const fallback = C[key]
  const current = Number.isFinite(parsed) ? parsed : (Number.isFinite(fallback) ? fallback : NaN)
  const next = assertFiniteSequenceNext(current + 1, `${prefix} sequence`)
  storage.set(lsKey, String(next))
  C[key] = next
  return `${prefix}/${String(next).padStart(4, '0')}`
}

describe('salary advance ADV sequence', () => {
  let C: ReturnType<typeof makeC>
  let storage: Map<string, string>

  beforeEach(() => {
    C = makeC()
    storage = new Map()
  })

  it('includes adv in the sequence counter map', () => {
    expect(C).toHaveProperty('adv')
    expect(C.adv).toBe(0)
  })

  it('allocates ADV/0001 then ADV/0002 without throwing', () => {
    expect(seq('ADV', 'adv', C, storage)).toBe('ADV/0001')
    expect(seq('ADV', 'adv', C, storage)).toBe('ADV/0002')
  })

  it('throws for an unknown counter key (the pre-fix bug)', () => {
    const broken = { so: 1 } as ReturnType<typeof makeC>
    expect(() => seq('ADV', 'adv', broken, storage)).toThrow(/Invalid ADV sequence/)
  })
})

describe('toDbAdvance preserves client id', () => {
  it('maps id so POST keeps the optimistic UUID', async () => {
    const { toDbAdvance } = await import('@/lib/hr/salary-advance-store')
    const data = toDbAdvance({
      id: '11111111-1111-4111-8111-111111111111',
      ref: 'ADV/0001',
      employeeId: '22222222-2222-4222-8222-222222222222',
      amount: 5000,
      reason: 'Emergency',
    })
    expect(data.id).toBe('11111111-1111-4111-8111-111111111111')
    expect(data.reference).toBe('ADV/0001')
    expect(data.employeeId).toBe('22222222-2222-4222-8222-222222222222')
  })
})
