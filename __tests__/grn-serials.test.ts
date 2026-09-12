import { describe, expect, it } from 'vitest'
import {
  describeGrnSerialMerge,
  mergeGrnSerials,
  normalizeGrnSerialToken,
  parseGrnSerialList,
} from '@/lib/purchase/grn-serials'

describe('parseGrnSerialList', () => {
  it('splits lines and commas, de-duplicates, and extracts SERIAL from QR rows', () => {
    expect(parseGrnSerialList('sn001\nSN001\nSN002, SKU:X|SERIAL:sn003')).toEqual([
      'SN001',
      'SN002',
      'SN003',
    ])
  })

  it('returns empty for blank input', () => {
    expect(parseGrnSerialList('  \n ; \t ')).toEqual([])
  })
})

describe('normalizeGrnSerialToken', () => {
  it('keeps a plain manufacturer serial', () => {
    expect(normalizeGrnSerialToken('  lr0awkl5  ')).toBe('LR0AWKL5')
  })

  it('prefers SERIAL from a label QR', () => {
    expect(normalizeGrnSerialToken('SKU:HP-450|SERIAL:SN9988')).toBe('SN9988')
  })
})

describe('mergeGrnSerials', () => {
  it('appends unique serials up to the received qty', () => {
    const result = mergeGrnSerials({
      existing: ['SN001'],
      incoming: ['SN002', 'SN001', 'SN003', 'SN004'],
      qtyReceived: 3,
    })
    expect(result.next).toEqual(['SN001', 'SN002', 'SN003'])
    expect(result.added).toEqual(['SN002', 'SN003'])
    expect(result.duplicates).toEqual(['SN001'])
    expect(result.overflow).toEqual(['SN004'])
  })

  it('is a no-op when the line is already full', () => {
    const result = mergeGrnSerials({
      existing: ['A', 'B'],
      incoming: ['C'],
      qtyReceived: 2,
    })
    expect(result.next).toEqual(['A', 'B'])
    expect(result.added).toEqual([])
    expect(result.overflow).toEqual(['C'])
  })
})

describe('describeGrnSerialMerge', () => {
  it('stays quiet for a single successful scan', () => {
    expect(describeGrnSerialMerge({ added: ['SN1'], duplicates: [], overflow: [] })).toBeNull()
  })

  it('summarizes a bulk paste with leftovers', () => {
    const text = describeGrnSerialMerge({
      added: ['A', 'B'],
      duplicates: ['C'],
      overflow: ['D'],
    })
    expect(text?.kind).toBe('info')
    expect(text?.message).toBe('Added 2 serials · 1 duplicate skipped · 1 over the received qty ignored')
  })

  it('errors when every pasted serial is already on the line', () => {
    expect(describeGrnSerialMerge({ added: [], duplicates: ['SN001'], overflow: [] })).toEqual({
      kind: 'error',
      message: 'SN001 already added',
    })
  })
})
