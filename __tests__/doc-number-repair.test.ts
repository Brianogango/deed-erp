import { describe, expect, it } from 'vitest'
import { adjustmentsMissingValuation, isProvisionalDocRef, recordsNeedingNumbers, repeatedRefs, returnsMissingValuation } from '@/lib/doc-number-repair'

const adj = (id: string, ref: string, date: string, over: Record<string, unknown> = {}) => ({
  id, ref, date, productId: 'p1', type: 'add', status: 'approved', ...over,
})

describe('document number repair', () => {
  it('knows a stand-in number', () => {
    expect(isProvisionalDocRef('ADJ/2026/L5K2J9QX7A')).toBe(true)
    expect(isProvisionalDocRef('ADJ/0001')).toBe(false)
    expect(isProvisionalDocRef('ADJ/2026/SSD512-ADD2')).toBe(false)
  })

  it('the oldest keeps its number; later repeats and stand-ins are renumbered', () => {
    const list = [
      adj('c', 'ADJ/0001', '2026-09-04'),
      adj('a', 'ADJ/0001', '2026-09-02'),
      adj('b', 'ADJ/0002', '2026-09-02'),
      adj('d', 'ADJ/2026/LABC123', '2026-10-01'),
      adj('e', 'ADJ/2026/SSD512-ADD2', '2026-08-28'),
    ]
    expect(recordsNeedingNumbers(list, { dateOf: a => a.date }).sort()).toEqual(['c', 'd'])
    // A stricter form (refurbishment jobs) also renumbers odd numbers.
    expect(recordsNeedingNumbers(list, { dateOf: a => a.date, isFinal: r => /^ADJ\/\d+$/.test(r) }).sort()).toEqual(['c', 'd', 'e'])
  })

  it('flags approved repeats of number + product + direction as missing their stock value', () => {
    const list = [
      adj('a', 'ADJ/0001', '2026-09-02', { approvedDate: '2026-09-02' }),
      adj('b', 'ADJ/0009', '2026-09-24', { formerRef: 'ADJ/0001', approvedDate: '2026-09-24' }), // renumbered repeat
      adj('c', 'ADJ/0001', '2026-09-10', { productId: 'p2' }), // other product: valued
      adj('d', 'ADJ/0001', '2026-09-11', { type: 'subtract' }), // other direction: valued
      adj('e', 'ADJ/0001', '2026-09-12', { status: 'rejected' }),
    ]
    expect(adjustmentsMissingValuation(list).map(a => a.id)).toEqual(['b'])
  })

  it('flags received returns that repeated a number for the same product', () => {
    const r = (id: string, ref: string, receivedDate: string | undefined, products: string[], over = {}) =>
      ({ id, ref, receivedDate, lines: products.map(productId => ({ productId })), ...over })
    const list = [
      r('a', 'RMA/0001', '2026-09-01', ['p1', 'p2']),
      r('b', 'RMA/0001', '2026-09-05', ['p3']),         // same number, other product: valued
      r('c', 'RMA/0007', '2026-09-08', ['p2'], { formerRef: 'RMA/0001' }), // repeat of a's p2
      r('d', 'RMA/0001', undefined, ['p1']),            // not received yet
    ]
    expect(returnsMissingValuation(list).map(x => x.id)).toEqual(['c'])
  })

  it('groups repeated numbers', () => {
    const list = [{ ref: 'RFD/0001', d: '2' }, { ref: 'RFD/0002', d: '1' }, { ref: 'RFD/0001', d: '1' }]
    expect(repeatedRefs(list, x => x.d)).toEqual([{ ref: 'RFD/0001', records: [{ ref: 'RFD/0001', d: '1' }, { ref: 'RFD/0001', d: '2' }] }])
  })
})
