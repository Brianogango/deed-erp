import { describe, expect, it } from 'vitest'
import { mergeRepairsStoreWrite } from '@/lib/repair-store-merge'
import { pruneTombstones, tombstoneIds, TOMBSTONE_TTL_DAYS } from '@/lib/repair-tombstones'

const repair = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  ref: `REP/${id}`,
  status: 'in_repair',
  ...over,
})

const daysAgo = (days: number, now = Date.now()) =>
  new Date(now - days * 24 * 60 * 60 * 1000).toISOString()

describe('pruneTombstones', () => {
  const now = Date.parse('2026-09-27T12:00:00.000Z')

  it('keeps a recent deletion', () => {
    const kept = pruneTombstones({ 'rep-1': daysAgo(3, now) }, now)
    expect(Object.keys(kept)).toEqual(['rep-1'])
  })

  it('forgets one past the window, so the record cannot grow forever', () => {
    const map = {
      fresh: daysAgo(TOMBSTONE_TTL_DAYS - 1, now),
      stale: daysAgo(TOMBSTONE_TTL_DAYS + 1, now),
    }
    expect(Object.keys(pruneTombstones(map, now))).toEqual(['fresh'])
  })

  it('keeps an entry whose timestamp it cannot read rather than dropping it', () => {
    // Losing a tombstone re-opens the resurrection window, so an unparseable
    // stamp errs towards keeping the id out.
    expect(Object.keys(pruneTombstones({ 'rep-1': 'not a date' }, now))).toEqual(['rep-1'])
  })
})

describe('mergeRepairsStoreWrite — a deleted repair stays deleted', () => {
  it('drops a deleted repair that a stale client still holds', () => {
    // The merge is union-by-id: before tombstones, this row was treated as new
    // and re-inserted, and the mirror then recreated the Prisma row from it.
    const merged = mergeRepairsStoreWrite(
      [repair('keep')],
      [repair('keep'), repair('deleted')],
      tombstoneIds({ deleted: new Date().toISOString() }),
    )
    expect(merged.map(r => r.id)).toEqual(['keep'])
  })

  it('removes it from the server copy too, if a previous sync already re-added it', () => {
    const merged = mergeRepairsStoreWrite(
      [repair('keep'), repair('deleted')],
      [repair('keep')],
      tombstoneIds({ deleted: new Date().toISOString() }),
    )
    expect(merged.map(r => r.id)).toEqual(['keep'])
  })

  it('leaves everything alone when nothing has been deleted', () => {
    const merged = mergeRepairsStoreWrite([repair('a')], [repair('a'), repair('b')])
    expect(merged.map(r => r.id).sort()).toEqual(['a', 'b'])
  })

  it('still merges the surviving rows normally', () => {
    // A tombstone must not disturb the status-rewind protection around it.
    const merged = mergeRepairsStoreWrite(
      [repair('live', { status: 'ready' }), repair('gone')],
      [repair('live', { status: 'in_repair' }), repair('gone')],
      tombstoneIds({ gone: new Date().toISOString() }),
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('live')
  })

  it('removes a deleted repair even when the incoming array is empty', () => {
    // An empty array is otherwise ignored, so a client that has not hydrated
    // cannot wipe the collection — but the deletion still has to apply.
    const merged = mergeRepairsStoreWrite(
      [repair('a'), repair('gone')],
      [],
      tombstoneIds({ gone: new Date().toISOString() }),
    )
    expect(merged.map(r => r.id)).toEqual(['a'])
  })

  it('still ignores an empty array when nothing has been deleted', () => {
    expect(mergeRepairsStoreWrite([repair('a')], []).map(r => r.id)).toEqual(['a'])
  })
})
