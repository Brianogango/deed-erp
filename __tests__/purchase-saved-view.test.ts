import { describe, expect, it } from 'vitest'
import {
  parsePurchaseSavedView,
  purchaseSavedViewQueryPatch,
} from '@/lib/purchases-filter'

describe('purchase saved-view pagination contract', () => {
  it('parses the current saved filter shape', () => {
    expect(parsePurchaseSavedView(JSON.stringify({ type: 'po', status: 'received' }))).toEqual({
      typeFilter: 'po',
      statusFilter: 'received',
    })
  })

  it('migrates legacy saved views', () => {
    expect(parsePurchaseSavedView('rfq')).toEqual({
      typeFilter: 'rfq',
      statusFilter: 'all',
    })
    expect(parsePurchaseSavedView('received')).toEqual({
      typeFilter: 'all',
      statusFilter: 'received',
    })
  })

  it('never clears or replaces the current page when applying saved filters', () => {
    const currentQuery = { tab: 'orders', page: '2', q: 'Evercomps' }
    const patch = purchaseSavedViewQueryPatch({
      typeFilter: 'po',
      statusFilter: 'received',
    })

    expect(patch).not.toHaveProperty('page')
    expect({ ...currentQuery, ...patch }).toEqual({
      tab: 'orders',
      page: '2',
      q: 'Evercomps',
      type: 'po',
      status: 'received',
    })
  })
})
