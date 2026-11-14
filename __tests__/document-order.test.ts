import { describe, expect, it } from 'vitest'
import { newestDocumentFirst } from '@/lib/document-order'

const docs = [
  { ref: 'INV/2026/0425', date: '2026-11-14' },
  { ref: 'INV/2026/0429', date: '2026-11-14' },
  { ref: 'INV/2026/0424', date: '2026-11-13' },
  { ref: 'INV/2026/0422', date: '2026-11-13' },
  { ref: 'POS/0231', date: '2026-11-13' },
  { ref: 'INV/2026/0419', date: '2026-11-13' },
  { ref: 'INV/2026/0423', date: '2026-11-13' },
  { ref: 'INV/2026/1000', date: '2026-11-13' },
]

describe('newestDocumentFirst', () => {
  it('newest day first; within a day, highest number first, series together', () => {
    expect([...docs].sort(newestDocumentFirst).map(d => d.ref)).toEqual([
      'INV/2026/0429', 'INV/2026/0425',
      'POS/0231', 'INV/2026/1000', 'INV/2026/0424', 'INV/2026/0423', 'INV/2026/0422', 'INV/2026/0419',
    ])
  })
  it('the same order whatever order they arrive in', () => {
    const once = [...docs].sort(newestDocumentFirst).map(d => d.ref)
    expect([...docs].reverse().sort(newestDocumentFirst).map(d => d.ref)).toEqual(once)
  })
})
