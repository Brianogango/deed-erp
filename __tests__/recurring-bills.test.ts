import { describe, it, expect } from 'vitest'
import {
  buildBillInput, dueOccurrences, nextRecurringRef, occurrenceDates, periodKey, validateTemplate,
  type RecurringBill,
} from '@/lib/recurring/recurring-bills'

const tpl = (over: Partial<RecurringBill> = {}): RecurringBill => ({
  id: 't1', ref: 'RB/0001', vendorId: 'v1', vendorName: 'Landlord', title: 'Office rent',
  frequency: 'monthly', dayOfMonth: 5, startDate: '2026-08-01', vatRate: 0,
  lines: [{ description: 'Rent', accountCode: '6508', amount: 50000 }],
  paused: false, generated: [], createdAt: 'x', ...over,
})

describe('periods', () => {
  it('labels each period uniquely', () => {
    expect(periodKey('2026-10-05', 'monthly')).toBe('2026-10')
    expect(periodKey('2026-10-05', 'quarterly')).toBe('2026-Q4')
    expect(periodKey('2026-02-05', 'quarterly')).toBe('2026-Q1')
    expect(periodKey('2026-10-05', 'yearly')).toBe('2026')
  })
})

describe('occurrenceDates', () => {
  it('lists monthly dates from the start up to today, not the future', () => {
    expect(occurrenceDates(tpl(), '2026-10-01')).toEqual(['2026-08-05', '2026-09-05'])
    expect(occurrenceDates(tpl(), '2026-10-05')).toEqual(['2026-08-05', '2026-09-05', '2026-10-05'])
  })
  it('clamps day 31 to short months', () => {
    expect(occurrenceDates(tpl({ dayOfMonth: 31, startDate: '2026-01-01' }), '2026-03-31'))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })
  it('skips a first date that falls before the start date', () => {
    expect(occurrenceDates(tpl({ dayOfMonth: 5, startDate: '2026-08-20' }), '2026-10-10'))
      .toEqual(['2026-09-05', '2026-10-05'])
  })
  it('steps quarterly and stops at the end date', () => {
    expect(occurrenceDates(tpl({ frequency: 'quarterly', startDate: '2026-01-01', dayOfMonth: 1, endDate: '2026-08-01' }), '2026-12-31'))
      .toEqual(['2026-01-01', '2026-04-01', '2026-07-01'])
  })
})

describe('dueOccurrences', () => {
  it('excludes periods already generated and everything while paused', () => {
    const t = tpl({ generated: [{ period: '2026-08', invoiceId: 'i', invoiceRef: 'B', billDate: '2026-08-05' }] })
    expect(dueOccurrences(t, '2026-10-10')).toEqual(['2026-09-05', '2026-10-05'])
    expect(dueOccurrences({ ...t, paused: true }, '2026-10-10')).toEqual([])
  })
})

describe('buildBillInput', () => {
  it('builds a draft with the vendor credit period as due date', () => {
    const b = buildBillInput(tpl(), '2026-10-05', {}, 30)
    expect('error' in b).toBe(false)
    if ('error' in b) return
    expect(b.dueDate).toBe('2026-11-04')
    expect(b.lines[0]).toMatchObject({ desc: 'Rent', price: '50000', account: '6508' })
    expect(b.notes).toContain('RB/0001')
  })
  it('requires an amount for a variable line', () => {
    const t = tpl({ lines: [{ description: 'Electricity', accountCode: '6506', amount: null }] })
    expect(buildBillInput(t, '2026-10-05', {}, 0)).toMatchObject({ error: expect.stringContaining('Electricity') })
    const ok = buildBillInput(t, '2026-10-05', { 0: 8200 }, 0)
    expect('error' in ok).toBe(false)
  })
})

describe('validateTemplate / refs', () => {
  it('accepts a good template and rejects bad ones', () => {
    expect(validateTemplate(tpl())).toBeNull()
    expect(validateTemplate(tpl({ vendorId: '' }))).toBeTruthy()
    expect(validateTemplate(tpl({ dayOfMonth: 40 }))).toBeTruthy()
    expect(validateTemplate(tpl({ lines: [] }))).toBeTruthy()
    expect(validateTemplate(tpl({ lines: [{ description: 'x', amount: 0 }] }))).toBeTruthy()
    expect(validateTemplate(tpl({ endDate: '2026-01-01' }))).toBeTruthy()
  })
  it('numbers templates', () => {
    expect(nextRecurringRef([])).toBe('RB/0001')
    expect(nextRecurringRef([{ ref: 'RB/0009' }])).toBe('RB/0010')
  })
})
