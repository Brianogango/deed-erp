import { describe, expect, it } from 'vitest'
import { allocateDocNumberSync } from '@/lib/doc-numbers'

describe('local document number fallback', () => {
  it('never lands in the server sequence (PREFIX/YYYY/NNNN)', () => {
    const year = new Date().getFullYear()
    const n = allocateDocNumberSync('DN')
    expect(n.startsWith(`DN/${year}/L`)).toBe(true)
    expect(n).not.toMatch(/^DN\/\d{4}\/\d+$/)
    expect(n.length).toBeLessThanOrEqual(30)
  })

  it('gives different numbers on each call', () => {
    const seen = new Set(Array.from({ length: 50 }, () => allocateDocNumberSync('INV')))
    expect(seen.size).toBeGreaterThan(45)
  })
})
