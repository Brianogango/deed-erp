import { describe, expect, it } from 'vitest'
import {
  abandonStaleOpenPosSessions,
  hasActivePosSession,
  isOrphanedPosSession,
  isStaleOpenPosSession,
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
    expect(resolveOpenPosSessionId({
      posSessionOpen: true,
      posSessionId: null,
      posSessions: [
        { id: 'closed-1', status: 'closed' },
        { id: 'open-1', status: 'open' },
      ],
    })).toBe('open-1')
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

  it('does not recover a leftover open session from days ago', () => {
    const nowMs = Date.parse('2026-08-14T18:00:00.000Z')
    expect(resolveOpenPosSessionId({
      posSessionOpen: true,
      posSessionId: null,
      posSessions: [{ id: 'old', status: 'open', openedAt: '2026-08-11T08:00:00.000Z' }],
      nowMs,
    })).toBeNull()
    expect(isStaleOpenPosSession(
      { id: 'old', status: 'open', openedAt: '2026-08-11T08:00:00.000Z' },
      nowMs,
    )).toBe(true)
  })

  it('still recovers a session opened earlier today', () => {
    const nowMs = Date.parse('2026-08-14T18:00:00.000Z')
    expect(resolveOpenPosSessionId({
      posSessionOpen: true,
      posSessionId: null,
      posSessions: [{ id: 'today', status: 'open', openedAt: '2026-08-14T08:00:00.000Z' }],
      nowMs,
    })).toBe('today')
  })
})

describe('abandonStaleOpenPosSessions', () => {
  it('closes leftover open rows that are older than a work day', () => {
    const nowMs = Date.parse('2026-08-14T18:00:00.000Z')
    const next = abandonStaleOpenPosSessions(
      [
        { id: 'stale', status: 'open', openedAt: '2026-08-11T08:00:00.000Z' },
        { id: 'live', status: 'open', openedAt: '2026-08-14T10:00:00.000Z' },
        { id: 'done', status: 'closed', openedAt: '2026-08-10T08:00:00.000Z' },
      ],
      'live',
      nowMs,
    )
    expect(next.find(s => s.id === 'stale')?.status).toBe('closed')
    expect(next.find(s => s.id === 'live')?.status).toBe('open')
    expect(next.find(s => s.id === 'done')?.status).toBe('closed')
  })
})
