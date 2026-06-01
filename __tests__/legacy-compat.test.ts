import { describe, it, expect, vi } from 'vitest'

// legacy-compat imports sql at module load time — stub it out
vi.mock('@/lib/auth/db', () => ({ sql: vi.fn() }))

import { isUuid, optionalUuid } from '@/lib/legacy-compat'

describe('isUuid() — strict RFC validator (checks version and variant bits)', () => {
  it('accepts a valid UUID v4', () => {
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('accepts a valid UUID v1', () => {
    expect(isUuid('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true)
  })

  it('rejects all-zero UUID (version 0 fails [1-5] check)', () => {
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(false)
  })

  it('rejects 7-char base-36 legacy ID', () => {
    expect(isUuid('a7f2k4m')).toBe(false)
  })

  it('rejects null', () => {
    expect(isUuid(null)).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isUuid(undefined)).toBe(false)
  })

  it('rejects number', () => {
    expect(isUuid(42)).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isUuid('')).toBe(false)
  })

  it('rejects truncated UUID', () => {
    expect(isUuid('550e8400-e29b-41d4')).toBe(false)
  })

  it('rejects UUID without dashes', () => {
    expect(isUuid('550e8400e29b41d4a716446655440000')).toBe(false)
  })
})

describe('optionalUuid()', () => {
  it('returns the UUID string unchanged when valid', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(optionalUuid(uuid)).toBe(uuid)
  })

  it('returns undefined for a non-UUID string', () => {
    expect(optionalUuid('short-id')).toBeUndefined()
    expect(optionalUuid('a7f2k4m')).toBeUndefined()
  })

  it('returns undefined for null', () => {
    expect(optionalUuid(null)).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(optionalUuid(undefined)).toBeUndefined()
  })

  it('returns undefined for a number', () => {
    expect(optionalUuid(42)).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(optionalUuid('')).toBeUndefined()
  })

  it('returns undefined for all-zero UUID (fails strict version check)', () => {
    expect(optionalUuid('00000000-0000-0000-0000-000000000000')).toBeUndefined()
  })
})
