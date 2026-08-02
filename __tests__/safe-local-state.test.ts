import { describe, expect, it } from 'vitest'
import { ensureArray, parseStoredState } from '@/lib/safe-local-state'

describe('parseStoredState', () => {
  it('returns seed when storage is empty', () => {
    expect(parseStoredState(null, [])).toEqual({ value: [], corrupted: false })
  })

  it('accepts valid array JSON for array seeds', () => {
    expect(parseStoredState('[{"id":"1"}]', [])).toEqual({
      value: [{ id: '1' }],
      corrupted: false,
    })
  })

  it('rejects object JSON when seed is an array (blank-page crash case)', () => {
    expect(parseStoredState('{"not":"an-array"}', [])).toEqual({
      value: [],
      corrupted: true,
    })
  })

  it('rejects null JSON when seed is an array', () => {
    expect(parseStoredState('null', ['keep-seed'])).toEqual({
      value: ['keep-seed'],
      corrupted: true,
    })
  })

  it('falls back on invalid JSON', () => {
    expect(parseStoredState('{', [1])).toEqual({ value: [1], corrupted: true })
  })
})

describe('ensureArray', () => {
  it('passes through arrays', () => {
    expect(ensureArray([1, 2])).toEqual([1, 2])
  })

  it('replaces non-arrays with fallback', () => {
    expect(ensureArray({ not: 'array' }, [9])).toEqual([9])
    expect(ensureArray(null)).toEqual([])
  })
})
