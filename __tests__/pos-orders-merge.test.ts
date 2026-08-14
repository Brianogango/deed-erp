import { afterEach, describe, expect, it } from 'vitest'
import {
  mergePosOrdersRemoteState,
  mergePosOrdersStoreWrite,
  nextPosSessionRef,
  nextPosTicketRef,
} from '@/lib/pos-orders-merge'

describe('mergePosOrdersStoreWrite', () => {
  it('keeps server tickets a stale shorter client list omitted', () => {
    const current = [
      { id: 'a', ref: 'POS/0016', total: 1500 },
      { id: 'b', ref: 'POS/0017', total: 32000 },
      { id: 'c', ref: 'POS/0018', total: 14000 },
    ]
    const incoming = [{ id: 'a', ref: 'POS/0016', total: 1500 }]
    const merged = mergePosOrdersStoreWrite(current, incoming)
    expect(merged.map(o => o.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('appends a newly charged ticket onto the existing till list', () => {
    const current = [{ id: 'a', ref: 'POS/0016', total: 1500 }]
    const incoming = [
      { id: 'new', ref: 'POS/0017', total: 32000 },
      { id: 'a', ref: 'POS/0016', total: 1500 },
    ]
    const merged = mergePosOrdersStoreWrite(current, incoming)
    expect(merged.map(o => o.ref)).toEqual(['POS/0017', 'POS/0016'])
  })

  it('ignores an empty incoming payload so a wiped tab cannot delete the till', () => {
    const current = [{ id: 'a', ref: 'POS/0016', total: 1500 }]
    expect(mergePosOrdersStoreWrite(current, [])).toEqual(current)
    expect(mergePosOrdersStoreWrite(current, null)).toEqual(current)
  })
})

describe('mergePosOrdersRemoteState', () => {
  it('returns the same array reference when the union is unchanged', () => {
    const local = [{ id: 'a', ref: 'POS/0016', total: 1500 }]
    const next = mergePosOrdersRemoteState(local, [{ id: 'a', ref: 'POS/0016', total: 1500 }])
    expect(next).toBe(local)
  })
})

describe('nextPosTicketRef', () => {
  afterEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('deed_seq2_pos_ticket')
      localStorage.removeItem('deed_seq2_possess')
    }
  })

  it('continues POS/NNNN from existing tickets, not from POSSESS', () => {
    expect(nextPosTicketRef(['POS/0016', 'POSSESS/0020', 'POS/0013'])).toBe('POS/0017')
  })

  it('does not share a counter with session refs', () => {
    expect(nextPosSessionRef(['POSSESS/0013', 'POS/0019'])).toBe('POSSESS/0014')
    expect(nextPosTicketRef(['POS/0019', 'POSSESS/0099'])).toBe('POS/0020')
  })
})
