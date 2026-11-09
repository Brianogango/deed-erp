import { describe, expect, it } from 'vitest'
import { assetIdPrefix, formatAssetId, highestAssetNumber, isValidAssetId, normalizeAssetId } from '@/lib/inventory/asset-id'

describe('asset IDs', () => {
  it('prefixes by category, keeping DT free for the existing laptop stickers', () => {
    expect(assetIdPrefix('Laptops')).toBe('LT')
    expect(assetIdPrefix('Desktops')).toBe('DK')
    expect(assetIdPrefix('Complete Desktops')).toBe('DK')
    expect(assetIdPrefix('Monitors')).toBe('MN')
    expect(assetIdPrefix('Something new')).toBe('AC')
    expect(Object.values(['Laptops', 'Desktops', 'Monitors', 'Servers', 'Printers', 'Networking']).map(assetIdPrefix)).not.toContain('DT')
  })

  it('formats six digits and reads typed stickers', () => {
    expect(formatAssetId('LT', 124)).toBe('LT000124')
    expect(normalizeAssetId(' dt000005 ')).toBe('DT000005')
    expect(isValidAssetId('DT000005')).toBe(true)
    expect(isValidAssetId('LT-12')).toBe(false)
    expect(isValidAssetId('')).toBe(false)
  })

  it('finds the highest number used per prefix', () => {
    expect(highestAssetNumber('LT', ['LT000009', 'lt000120', 'DT000500', '', null])).toBe(120)
    expect(highestAssetNumber('MN', ['LT000009'])).toBe(0)
  })
})
