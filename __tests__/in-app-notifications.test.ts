import { describe, it, expect } from 'vitest'
import {
  buildNotifyRows,
  clearReadNotificationsForUser,
  markAllNotificationsReadForUser,
  markNotificationReadInList,
  mergeNotificationsSticky,
  uniqueRecipientIds,
  userIdsWithRoles,
  type AppNotification,
} from '@/lib/in-app-notifications'

function n(partial: Partial<AppNotification> & Pick<AppNotification, 'id' | 'userId'>): AppNotification {
  return {
    type: 'repair',
    title: 't',
    body: 'b',
    read: false,
    createdAt: '2026-08-01T10:00:00.000Z',
    icon: '🔧',
    ...partial,
  }
}

describe('in-app-notifications', () => {
  it('uniqueRecipientIds drops blanks, duplicates, and excluded actor', () => {
    expect(uniqueRecipientIds(['a', 'b', 'a', null, '', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('userIdsWithRoles filters by role and excludes actor', () => {
    const users = [
      { id: 'd1', role: 'director' },
      { id: 'a1', role: 'admin_officer' },
      { id: 'd2', role: 'director' },
    ]
    expect(userIdsWithRoles(users, ['director'], 'd1')).toEqual(['d2'])
  })

  it('sticky merge never flips read back to unread', () => {
    const local = [n({ id: '1', userId: 'u1', read: true, readAt: '2026-08-02T12:00:00.000Z', title: 'local' })]
    const remote = [n({ id: '1', userId: 'u1', read: false, title: 'remote' })]
    const merged = mergeNotificationsSticky(local, remote)
    expect(merged).toHaveLength(1)
    expect(merged[0].read).toBe(true)
    expect(merged[0].readAt).toBe('2026-08-02T12:00:00.000Z')
  })

  it('mark all read only affects the given user', () => {
    const list = [
      n({ id: '1', userId: 'u1' }),
      n({ id: '2', userId: 'u2' }),
    ]
    const next = markAllNotificationsReadForUser(list, 'u1', '2026-08-03T00:00:00.000Z')
    expect(next[0].read).toBe(true)
    expect(next[0].readAt).toBe('2026-08-03T00:00:00.000Z')
    expect(next[1].read).toBe(false)
  })

  it('clear read removes only that user read rows', () => {
    const list = [
      n({ id: '1', userId: 'u1', read: true, readAt: 'x' }),
      n({ id: '2', userId: 'u1', read: false }),
      n({ id: '3', userId: 'u2', read: true, readAt: 'x' }),
    ]
    const next = clearReadNotificationsForUser(list, 'u1')
    expect(next.map(x => x.id)).toEqual(['2', '3'])
  })

  it('markNotificationReadInList is sticky once set', () => {
    const list = [n({ id: '1', userId: 'u1', read: true, readAt: '2026-08-01T00:00:00.000Z' })]
    const next = markNotificationReadInList(list, '1', '2026-08-03T00:00:00.000Z')
    expect(next[0].readAt).toBe('2026-08-01T00:00:00.000Z')
  })

  it('buildNotifyRows dedupes unread by entityKey and skips actor', () => {
    const existing = [
      n({ id: 'old', userId: 'tech', entityKey: 'repair:1:parts', read: false, title: 'old' }),
    ]
    const { next, created, updated } = buildNotifyRows(
      existing,
      {
        recipients: ['tech', 'lead', 'actor'],
        excludeUserId: 'actor',
        type: 'repair',
        title: 'Parts arrived',
        body: 'ready',
        entityKey: 'repair:1:parts',
        icon: '📦',
      },
      () => 'new-id',
      () => '2026-08-03T01:00:00.000Z',
    )
    expect(created).toBe(1)
    expect(updated).toBe(1)
    expect(next.filter(x => x.userId === 'actor')).toHaveLength(0)
    const tech = next.find(x => x.userId === 'tech')!
    expect(tech.title).toBe('Parts arrived')
    expect(tech.id).toBe('old')
    expect(next.find(x => x.userId === 'lead')?.id).toBe('new-id')
  })
})
