import { describe, expect, it } from 'vitest'

/** Pure reorder helper matching quote/invoice ↑↓ behavior. */
function moveLineById<T extends { id: string }>(lines: T[], id: string, direction: -1 | 1): T[] {
  const index = lines.findIndex(line => line.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= lines.length) return lines
  const next = [...lines]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

describe('document line reorder', () => {
  const lines = [
    { id: 'a', name: 'Section A' },
    { id: 'b', name: 'Product B' },
    { id: 'c', name: 'Product C' },
  ]

  it('moves a product below a section', () => {
    expect(moveLineById(lines, 'b', -1).map(l => l.id)).toEqual(['b', 'a', 'c'])
  })

  it('moves a section down past products', () => {
    expect(moveLineById(lines, 'a', 1).map(l => l.id)).toEqual(['b', 'a', 'c'])
  })

  it('no-ops at edges', () => {
    expect(moveLineById(lines, 'a', -1)).toBe(lines)
    expect(moveLineById(lines, 'c', 1)).toBe(lines)
  })
})
