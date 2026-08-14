import { describe, expect, it } from 'vitest'
import {
  hasActivePosSession,
  isOrphanedPosSession,
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
})
