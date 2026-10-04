import { describe, expect, it } from 'vitest'
import { withRecentRecord, type RecentRecord } from '@/lib/recent-records'

const rec = (n: number): RecentRecord => ({ href: `/repairs?id=${n}`, label: `Repair ${n}`, kind: 'repair', at: n })

describe('withRecentRecord', () => {
  it('puts the newest first', () => {
    const out = withRecentRecord([rec(1)], { href: '/sales?id=9', label: 'Sale order SO9', kind: 'sale_order' }, 100)
    expect(out.map(r => r.href)).toEqual(['/sales?id=9', '/repairs?id=1'])
    expect(out[0].at).toBe(100)
  })

  it('keeps one entry per record', () => {
    const out = withRecentRecord([rec(1), rec(2)], { href: '/repairs?id=2', label: 'Repair 2', kind: 'repair' }, 50)
    expect(out.map(r => r.href)).toEqual(['/repairs?id=2', '/repairs?id=1'])
  })

  it('keeps at most six', () => {
    const list = [1, 2, 3, 4, 5, 6].map(rec)
    const out = withRecentRecord(list, { href: '/contacts?id=c', label: 'Jane', kind: 'contact' })
    expect(out).toHaveLength(6)
    expect(out[0].href).toBe('/contacts?id=c')
    expect(out.some(r => r.href === '/repairs?id=6')).toBe(false)
  })
})
