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

describe('local number collisions', () => {
  // Birthday odds: with a two-character salt a burst inside one millisecond
  // repeated a number often enough to fail this suite at random.
  it('survives a thousand draws in the same instant', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => allocateDocNumberSync('INV')))
    expect(seen.size).toBeGreaterThan(995)
    expect([...seen][0].length).toBeLessThanOrEqual(30)
  })
})
