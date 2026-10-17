import { describe, expect, it } from 'vitest'
import {
  addMonths,
  alertLabel,
  buildChequeDigests,
  canMoveTo,
  chequeAlert,
  daysUntil,
  isStaleCheque,
  normalizeChequeDate,
  validateChequeInput,
  type DigestCheque,
} from '@/lib/cheques/cheque-rules'

const TODAY = '2026-10-17'
const cheque = (over: Partial<DigestCheque>): DigestCheque => ({
  id: 'c1', direction: 'received', status: 'pending', chequeNumber: '000123', partyName: 'Farm To Feed', amount: 249400, chequeDate: TODAY, ...over,
})

describe('cheque dates', () => {
  it('counts whole days either side of today', () => {
    expect(daysUntil('2026-10-18', TODAY)).toBe(1)
    expect(daysUntil(TODAY, TODAY)).toBe(0)
    expect(daysUntil('2026-10-10', TODAY)).toBe(-7)
  })

  it('adds months without overflowing short months', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28')
    expect(addMonths('2026-10-17', 6)).toBe('2027-04-17')
  })

  it('treats a cheque as stale only after six months', () => {
    expect(isStaleCheque('2026-04-17', TODAY)).toBe(false)
    expect(isStaleCheque('2026-04-16', TODAY)).toBe(true)
  })

  it('reads cheque dates day-first', () => {
    expect(normalizeChequeDate('05/10/2026')).toBe('2026-10-05')
    expect(normalizeChequeDate('5-10-26')).toBe('2026-10-05')
    expect(normalizeChequeDate('5 Oct 2026')).toBe('2026-10-05')
    expect(normalizeChequeDate('2026-10-05')).toBe('2026-10-05')
    expect(normalizeChequeDate('31/02/2026')).toBe('')
    expect(normalizeChequeDate('not a date')).toBe('')
  })
})

describe('cheque alerts', () => {
  it('flags the day before, the day itself and anything past its date', () => {
    expect(chequeAlert({ status: 'pending', chequeDate: '2026-10-18' }, TODAY)).toBe('due_tomorrow')
    expect(chequeAlert({ status: 'pending', chequeDate: TODAY }, TODAY)).toBe('due_today')
    expect(chequeAlert({ status: 'pending', chequeDate: '2026-10-15' }, TODAY)).toBe('overdue')
    expect(chequeAlert({ status: 'pending', chequeDate: '2026-10-25' }, TODAY)).toBeNull()
  })

  it('stops alerting once the cheque is banked or closed', () => {
    for (const status of ['deposited', 'cleared', 'bounced', 'cancelled'] as const) {
      expect(chequeAlert({ status, chequeDate: TODAY }, TODAY)).toBeNull()
    }
  })

  it('marks old cheques stale instead of overdue', () => {
    expect(chequeAlert({ status: 'pending', chequeDate: '2026-01-01' }, TODAY)).toBe('stale')
  })

  it('words the label for the direction', () => {
    expect(alertLabel('received', 'due_today', TODAY, TODAY)).toBe('Ready for banking today')
    expect(alertLabel('given', 'due_today', TODAY, TODAY)).toBe('Due today')
    expect(alertLabel('received', 'overdue', '2026-10-15', TODAY)).toBe('Not banked — 2 days past its date')
  })
})

describe('daily digests', () => {
  it('splits cheques into the three reminders', () => {
    const digests = buildChequeDigests([
      cheque({ id: 'a', chequeDate: '2026-10-18' }),
      cheque({ id: 'b', chequeDate: TODAY }),
      cheque({ id: 'c', direction: 'given', chequeDate: TODAY, partyName: 'Supplier' }),
      cheque({ id: 'd', chequeDate: '2026-10-12' }),
      cheque({ id: 'e', chequeDate: '2026-11-30' }),
    ], TODAY)
    expect(digests.dueTomorrow.map(i => i.id)).toEqual(['a'])
    expect(digests.readyForBanking.map(i => i.id)).toEqual(['d', 'b'])
    expect(digests.givenDue.map(i => i.id)).toEqual(['c'])
    expect(digests.readyForBanking[0].line).toContain('dated 2026-10-12')
  })

  it('leaves out banked, closed and stale cheques', () => {
    const digests = buildChequeDigests([
      cheque({ id: 'a', status: 'deposited' }),
      cheque({ id: 'b', status: 'cleared' }),
      cheque({ id: 'c', chequeDate: '2026-01-01' }),
    ], TODAY)
    expect(digests).toEqual({ dueTomorrow: [], readyForBanking: [], givenDue: [] })
  })
})

describe('cheque workflow and input', () => {
  it('allows only sensible status changes', () => {
    expect(canMoveTo('pending', 'deposited')).toBe(true)
    expect(canMoveTo('deposited', 'cleared')).toBe(true)
    expect(canMoveTo('cleared', 'bounced')).toBe(false)
    expect(canMoveTo('bounced', 'pending')).toBe(true)
  })

  it('rejects incomplete cheques with a plain message', () => {
    const base = { direction: 'received' as const, chequeNumber: '1', partyName: 'A', amount: 100, chequeDate: TODAY }
    expect(validateChequeInput(base)).toBeNull()
    expect(validateChequeInput({ ...base, chequeNumber: ' ' })).toBe('Enter the cheque number')
    expect(validateChequeInput({ ...base, amount: 0 })).toBe('Enter the cheque amount')
    expect(validateChequeInput({ ...base, chequeDate: '10/10/2026' })).toBe('Enter the date written on the cheque')
    expect(validateChequeInput({ ...base, partyName: '' })).toBe('Enter who the cheque is from')
  })
})
