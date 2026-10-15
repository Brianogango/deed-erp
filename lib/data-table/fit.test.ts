import { describe, expect, it } from 'vitest'
import { fitColumnsToWidth, parseColumnWidth } from './fit'
import type { ColumnDef } from './types'

const col = (key: string, priority: 1 | 2 | 3, width: string): ColumnDef<unknown> => ({ key, label: key, priority, width, render: () => null })

describe('parseColumnWidth', () => {
  it('treats px as a proportion with a small floor', () => {
    expect(parseColumnWidth('120px')).toEqual({ nominal: 120, floor: 80 })
  })
  it('turns fr into a nominal width', () => {
    expect(parseColumnWidth('2fr').nominal).toBe(320)
  })
  it('reads minmax(rem, fr) floors, capped at 10rem', () => {
    expect(parseColumnWidth('minmax(8rem, 2fr)')).toEqual({ nominal: 320, floor: 128 })
    expect(parseColumnWidth('minmax(20rem, 2fr)').floor).toBe(160)
  })
  it('honours an explicit minWidth', () => {
    expect(parseColumnWidth('100px', 100).floor).toBe(100)
  })
})

describe('fitColumnsToWidth', () => {
  const cols = [
    col('name', 1, 'minmax(14rem, 2fr)'),
    col('total', 1, '120px'),
    col('sku', 2, '110px'),
    col('cost', 2, '120px'),
    col('updated', 3, '120px'),
    col('margin', 3, '90px'),
  ]
  it('keeps everything when it fits', () => {
    expect(fitColumnsToWidth(cols, 2000).map(c => c.key)).toEqual(cols.map(c => c.key))
  })
  it('drops priority-3 columns before priority-2, rightmost first', () => {
    const kept = fitColumnsToWidth(cols, 640).map(c => c.key)
    expect(kept).not.toContain('margin')
    expect(kept).not.toContain('updated')
    expect(kept).toContain('name')
    expect(kept).toContain('total')
  })
  it('never drops priority-1 columns, however narrow', () => {
    expect(fitColumnsToWidth(cols, 50).map(c => c.key)).toEqual(['name', 'total'])
  })
  it('keeps original order', () => {
    const kept = fitColumnsToWidth(cols, 760).map(c => c.key)
    expect(kept).toEqual(cols.map(c => c.key).filter(k => kept.includes(k)))
  })
  it('accounts for selection / action columns', () => {
    const withExtras = fitColumnsToWidth(cols, 900, 200).length
    const without = fitColumnsToWidth(cols, 900, 0).length
    expect(withExtras).toBeLessThanOrEqual(without)
  })
})
