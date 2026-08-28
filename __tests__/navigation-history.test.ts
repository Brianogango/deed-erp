import { describe, expect, it } from 'vitest'
import { decideRecordNavigation } from '@/lib/navigation-history'

describe('ERP record navigation history', () => {
  it('pushes when opening the first record from a list', () => {
    expect(decideRecordNavigation({
      nextId: 'rec-1',
      currentQueryId: null,
      openedViaPush: false,
    })).toBe('push')
  })

  it('replaces when switching from one open record to another', () => {
    expect(decideRecordNavigation({
      nextId: 'rec-2',
      currentQueryId: 'rec-1',
      openedViaPush: true,
    })).toBe('replace')
  })

  it('goes back when closing a record that was pushed from a list', () => {
    expect(decideRecordNavigation({
      nextId: null,
      currentQueryId: 'rec-1',
      openedViaPush: true,
    })).toBe('back')
  })

  it('replaces the URL when closing a direct deep link', () => {
    expect(decideRecordNavigation({
      nextId: null,
      currentQueryId: 'rec-1',
      openedViaPush: false,
    })).toBe('replace')
  })

  it('honours explicit push and replace overrides', () => {
    expect(decideRecordNavigation({
      nextId: 'rec-1',
      currentQueryId: 'existing',
      openedViaPush: false,
      history: 'push',
    })).toBe('push')

    expect(decideRecordNavigation({
      nextId: null,
      currentQueryId: 'rec-1',
      openedViaPush: true,
      history: 'replace',
    })).toBe('replace')
  })
})
