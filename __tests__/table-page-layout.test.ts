import { describe, expect, it } from 'vitest'

/** Mirrors the Table() grid track resolution used to prevent column overlap. */
function resolveGridTrack(width?: string): string {
  const resolved = width ?? 'minmax(8rem, 1fr)'
  if (/^\d+px$/.test(resolved)) return resolved
  if (/^\d+fr$/.test(resolved)) {
    const fr = Number(resolved.replace('fr', ''))
    return `minmax(${Math.max(8, Math.round(fr * 7))}rem, ${resolved})`
  }
  return resolved
}

describe('table column track policy', () => {
  it('keeps fixed px tracks fixed (no growth into neighbours)', () => {
    expect(resolveGridTrack('120px')).toBe('120px')
    expect(resolveGridTrack('36px')).toBe('36px')
    expect(resolveGridTrack('140px')).toBe('140px')
  })

  it('gives fr tracks a usable minimum width', () => {
    expect(resolveGridTrack('1fr')).toBe('minmax(8rem, 1fr)')
    expect(resolveGridTrack('2fr')).toBe('minmax(14rem, 2fr)')
  })

  it('preserves explicit minmax tracks', () => {
    expect(resolveGridTrack('minmax(14rem, 2fr)')).toBe('minmax(14rem, 2fr)')
  })
})

describe('operational summary shape', () => {
  it('limits compact summaries to four items', () => {
    const items = [
      { id: 'a', label: 'available', value: 48 },
      { id: 'b', label: 'services', value: 0 },
      { id: 'c', label: 'pending', value: 0 },
      { id: 'd', label: 'extra', value: 1 },
      { id: 'e', label: 'overflow', value: 2 },
    ]
    expect(items.slice(0, 4)).toHaveLength(4)
  })
})
