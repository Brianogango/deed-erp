import { describe, expect, it } from 'vitest'
import {
  buyBackConditionFromRepair,
  canConvertRetainedRepair,
  canCreateTradeInFromRepair,
  findRepairCatalogProduct,
  matchRepairDeviceSerial,
} from '@/lib/repair-retain-convert'

describe('repair-retain-convert helpers', () => {
  const products = [
    { id: 'p1', name: 'HP ProBook 450' },
    { id: 'p2', name: 'Dell Latitude 5420' },
  ]

  it('finds catalog product by id then name', () => {
    expect(findRepairCatalogProduct(products, { productId: 'p2', productName: 'Other' })?.id).toBe('p2')
    expect(findRepairCatalogProduct(products, { productId: '', productName: 'hp probook 450' })?.id).toBe('p1')
    expect(findRepairCatalogProduct(products, { productName: 'missing' })).toBeNull()
  })

  it('recovers a missing catalog link from repair brand/model metadata', () => {
    const catalog = [
      { id: 'elite-840', name: 'HP EliteBook 840 G5' },
      { id: 'elite-850', name: 'HP EliteBook 850 G5' },
      { id: 'lat-5420', name: 'Dell Latitude 5420' },
    ]

    expect(findRepairCatalogProduct(catalog, {
      productName: 'HP EliteBook',
      deviceBrand: 'HP',
      deviceModel: '840 G5',
    })?.id).toBe('elite-840')

    expect(findRepairCatalogProduct(catalog, {
      productName: 'EliteBook',
      deviceModel: '850 G5',
    })?.id).toBe('elite-850')
  })

  it('does not guess when a repair family name matches multiple catalog SKUs', () => {
    const catalog = [
      { id: 'elite-840', name: 'HP EliteBook 840 G5' },
      { id: 'elite-850', name: 'HP EliteBook 850 G5' },
    ]
    expect(findRepairCatalogProduct(catalog, { productName: 'HP EliteBook' })).toBeNull()
  })

  it('accepts a unique family-name match for older repair records', () => {
    const catalog = [
      { id: 'elite-840', name: 'HP EliteBook 840 G5' },
      { id: 'lat-5420', name: 'Dell Latitude 5420' },
    ]
    expect(findRepairCatalogProduct(catalog, { productName: 'HP EliteBook' })?.id).toBe('elite-840')
  })

  it('maps device condition for buy-back', () => {
    expect(buyBackConditionFromRepair('damaged')).toBe('poor')
    expect(buyBackConditionFromRepair('fair')).toBe('fair')
    expect(buyBackConditionFromRepair('good')).toBe('good')
  })

  it('matches existing serial or returns serial text for intake', () => {
    const serials = [
      { id: 's1', productId: 'p1', serial: 'ABC123' },
    ]
    const hit = matchRepairDeviceSerial(serials, 'p1', { serialNumber: 'abc123' })
    expect('existing' in hit && hit.existing?.id).toBe('s1')

    const miss = matchRepairDeviceSerial(serials, 'p1', { serialNumber: 'NEW-999' })
    expect('existing' in miss && miss.existing).toBeNull()
    expect('serialText' in miss && miss.serialText).toBe('NEW-999')

    const err = matchRepairDeviceSerial(serials, 'p1', { serialNumber: '' })
    expect('error' in err).toBe(true)
  })

  it('only allows convert when retained and not already linked', () => {
    expect(canConvertRetainedRepair({ status: 'retained' })).toBe(true)
    expect(canConvertRetainedRepair({ status: 'retained', retainedDonationId: 'd1' })).toBe(false)
    expect(canConvertRetainedRepair({ status: 'retained', retainedBuyBackId: 'b1' })).toBe(false)
    expect(canConvertRetainedRepair({ status: 'in_repair' })).toBe(false)
  })

  it('allows paid trade-in from evaluation / declined / unrepairable / retained', () => {
    expect(canCreateTradeInFromRepair({ status: 'diagnosed' })).toBe(true)
    expect(canCreateTradeInFromRepair({ status: 'declined' })).toBe(true)
    expect(canCreateTradeInFromRepair({ status: 'unrepairable' })).toBe(true)
    expect(canCreateTradeInFromRepair({ status: 'retained' })).toBe(true)
    expect(canCreateTradeInFromRepair({ status: 'retained', retainedBuyBackId: 'b1' })).toBe(false)
    expect(canCreateTradeInFromRepair({ status: 'returned' })).toBe(false)
    expect(canCreateTradeInFromRepair({ status: 'delivered' })).toBe(false)
  })
})
