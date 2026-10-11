import { describe, expect, it } from 'vitest'
import { popupEventIdsToClose } from '@/lib/notifications/push-popups'

describe('desktop pop-up closing', () => {
  const bell = [
    { eventId: 'open', read: false, acknowledgedAt: null },
    { eventId: 'read', read: true },
    { eventId: 'acked', read: false, acknowledgedAt: '2026-10-11T08:00:00Z' },
  ]

  it('keeps open alerts and closes read or acknowledged ones', () => {
    expect(popupEventIdsToClose(['open', 'read', 'acked'], bell, true)).toEqual(['read', 'acked'])
  })

  it('closes alerts gone from a complete bell list (resolved)', () => {
    expect(popupEventIdsToClose(['gone'], bell, true)).toEqual(['gone'])
  })

  it('keeps alerts missing from a cut-off bell list', () => {
    expect(popupEventIdsToClose(['gone'], bell, false)).toEqual([])
  })
})
