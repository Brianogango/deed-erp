import { describe, expect, it } from 'vitest'
import {
  hasActivePosSession,
  isOrphanedPosSession,
  mergePosSessionsStoreWrite,
  posOrderBelongsToSession,
  posOrdersForSession,
  reconcileOpenPosSessionFlags,
  resolveOpenPosSessionId,
} from '@/lib/pos-session'

describe('resolveOpenPosSessionId', () => {
  it('prefers explicit session id', () => {
    expect(resolveOpenPosSessionId({
      posSessionOpen: true,
      posSessionId: 'sess-1',
      posSessions: [{ id: 'sess-2', status: 'open' }],
    })).toBe('sess-1')
  })

  it('recovers id from open session history when flag is set', () => {
    const opts = {
      posSessionOpen: true,
      posSessionId: null as string | null,
      posSessions: [
        { id: 'closed-1', status: 'closed' },
        { id: 'open-1', status: 'open' },
      ],
    }
    expect(resolveOpenPosSessionId(opts)).toBe('open-1')
    expect(isOrphanedPosSession(opts)).toBe(false)
  })

  it('returns null for orphaned open flag', () => {
    expect(resolveOpenPosSessionId({
      posSessionOpen: true,
      posSessionId: null,
      posSessions: [],
    })).toBeNull()
    expect(isOrphanedPosSession({
      posSessionOpen: true,
      posSessionId: null,
      posSessions: [],
    })).toBe(true)
  })

  it('does not treat closed-only history as active', () => {
    expect(hasActivePosSession({
      posSessionOpen: false,
      posSessionId: null,
      posSessions: [{ id: 'x', status: 'closed' }],
    })).toBe(false)
  })

  it('never falls back to the legacy sessionId "active"', () => {
    expect(resolveOpenPosSessionId({
      posSessionOpen: true,
      posSessionId: null,
      posSessions: [],
    })).toBeNull()
    expect(resolveOpenPosSessionId({
      posSessionOpen: true,
      posSessionId: '   ',
      posSessions: [],
    })).toBeNull()
  })

  it('keeps an overnight open till recoverable until Close Session', () => {
    expect(resolveOpenPosSessionId({
      posSessionOpen: true,
      posSessionId: null,
      posSessions: [{ id: 'old', status: 'open', openedAt: '2026-08-11T08:00:00.000Z' }],
    })).toBe('old')
    expect(hasActivePosSession({
      posSessionOpen: true,
      posSessionId: 'sess-overnight',
      posSessions: [{ id: 'sess-overnight', status: 'open', openedAt: '2026-08-13T08:00:00.000Z' }],
    })).toBe(true)
  })

  it('recovers the live open session when the explicit id was already closed', () => {
    expect(resolveOpenPosSessionId({
      posSessionOpen: true,
      posSessionId: 'stale-closed',
      posSessions: [
        { id: 'stale-closed', status: 'closed' },
        { id: 'live', status: 'open' },
      ],
    })).toBe('live')
  })
})

describe('mergePosSessionsStoreWrite', () => {
  it('keeps the live till a stale shorter client list omitted', () => {
    const current = [
      { id: 's19', ref: 'POSSESS/0019', status: 'open', openedAt: '2026-08-15T06:16:19.000Z' },
      { id: 's13', ref: 'POSSESS/0013', status: 'closed' },
    ]
    const incoming = [
      { id: 's14', ref: 'POSSESS/0014', status: 'open', openedAt: '2026-08-14T15:23:41.000Z' },
      { id: 's13', ref: 'POSSESS/0013', status: 'closed' },
    ]
    const merged = mergePosSessionsStoreWrite(current, incoming)
    expect(merged.map(s => s.id)).toEqual(['s14', 's13', 's19'])
    expect(merged.find(s => s.id === 's19')?.status).toBe('open')
  })

  it('lets Close Session mark the live id closed', () => {
    const current = [{ id: 's19', status: 'open' }]
    const incoming = [{ id: 's19', status: 'closed', closedAt: '2026-08-15T08:00:00.000Z' }]
    const merged = mergePosSessionsStoreWrite(current, incoming)
    expect(merged).toEqual([expect.objectContaining({ id: 's19', status: 'closed' })])
  })

  it('ignores an empty incoming payload', () => {
    const current = [{ id: 's19', status: 'open' }]
    expect(mergePosSessionsStoreWrite(current, [])).toEqual(current)
    expect(mergePosSessionsStoreWrite(current, null)).toEqual(current)
  })
})

describe('reconcileOpenPosSessionFlags', () => {
  it('pins the live till when a stale tab sends an older session id', () => {
    const merged = mergePosSessionsStoreWrite(
      [{ id: 's19', status: 'open' }],
      [{ id: 's14', status: 'open' }],
    )
    expect(reconcileOpenPosSessionFlags({
      currentOpen: true,
      currentId: 's19',
      incomingOpen: true,
      incomingId: 's14',
      mergedSessions: merged,
    })).toEqual({ pinLiveTill: true, posSessionOpen: true, posSessionId: 's19' })
  })

  it('does not pin after Close Session closes the live id', () => {
    const merged = mergePosSessionsStoreWrite(
      [{ id: 's19', status: 'open' }],
      [{ id: 's19', status: 'closed' }],
    )
    expect(reconcileOpenPosSessionFlags({
      currentOpen: true,
      currentId: 's19',
      incomingOpen: false,
      incomingId: null,
      mergedSessions: merged,
    })).toEqual({ pinLiveTill: false, posSessionOpen: false, posSessionId: null })
  })
})

describe('posOrdersForSession', () => {
  const openedAt = '2026-08-18T09:47:43.048Z'
  const orders = [
    { id: 'a', sessionId: 'sess-21', createdAt: '2026-08-18T10:20:30.000Z', total: 15900 },
    { id: 'b', sessionId: 'active', createdAt: '2026-08-13T12:33:09.818Z', total: 22900 },
    { id: 'c', sessionId: 'active', createdAt: '2026-08-18T09:50:00.000Z', total: 700 },
    { id: 'd', sessionId: 'other', createdAt: '2026-08-18T11:00:00.000Z', total: 98000 },
  ]

  it('does not pull a leftover active ticket from an earlier day into today\'s close', () => {
    const scoped = posOrdersForSession(orders, 'sess-21', openedAt)
    expect(scoped.map(o => o.id)).toEqual(['a', 'c'])
    expect(posOrderBelongsToSession(orders[1], 'sess-21', openedAt)).toBe(false)
  })

  it('counts a ticket stamped on the session even if it was taken before openedAt', () => {
    const orphan = {
      id: 'cash-orphan',
      sessionId: 'sess-21',
      createdAt: '2026-08-18T06:06:15.576Z',
      total: 31000,
    }
    expect(posOrderBelongsToSession(orphan, 'sess-21', openedAt)).toBe(true)
  })
})
