import { describe, expect, it } from 'vitest'
import { isSticky, selectNewPopups, POPUP_MAX_AGE_MS, type PopupNotification } from '@/components/layout/NotificationPopups'

const now = new Date('2026-10-10T10:00:00Z').getTime()
const n = (over: Partial<PopupNotification> = {}): PopupNotification => ({
  id: 'n1', title: 'New repair request received', body: 'Repair Job #REP-1045 has been assigned to you.',
  read: false, createdAt: new Date(now - 5_000).toISOString(), ...over,
})

describe('notification pop-ups', () => {
  it('pops up unread notifications that just arrived, oldest first', () => {
    const list = [n({ id: 'b', createdAt: new Date(now - 1_000).toISOString() }), n({ id: 'a', createdAt: new Date(now - 9_000).toISOString() })]
    expect(selectNewPopups(list, new Set(), now).map(x => x.id)).toEqual(['a', 'b'])
  })

  it('skips read, already-seen and old notifications', () => {
    const list = [
      n({ id: 'read', read: true }),
      n({ id: 'seen' }),
      n({ id: 'old', createdAt: new Date(now - POPUP_MAX_AGE_MS - 1_000).toISOString() }),
      n({ id: 'fresh' }),
    ]
    expect(selectNewPopups(list, new Set(['seen']), now).map(x => x.id)).toEqual(['fresh'])
  })

  it('keeps critical and urgent pop-ups on screen until dismissed', () => {
    expect(isSticky({ severity: 'critical' })).toBe(true)
    expect(isSticky({ priority: 'urgent' })).toBe(true)
    expect(isSticky({ severity: 'warning', priority: 'high' })).toBe(false)
    expect(isSticky({})).toBe(false)
  })
})
