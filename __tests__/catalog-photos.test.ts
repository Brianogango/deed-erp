import { describe, it, expect } from 'vitest'
import { matchCatalogPhotoPack, CATALOG_PHOTO_PACKS } from '@/lib/catalog-photos'
import { partnerImagesFromSlots, productImagePublicPath, catalogPhotoPublicPath } from '@/lib/product-images'
import { findDuplicateProductGroups, pickKeepProduct, normalizeProductIdentity } from '@/lib/inventory/duplicate-products'
import { rewriteProductIdsInRecords } from '@/lib/inventory/duplicate-products'

describe('matchCatalogPhotoPack', () => {
  it('matches the exact Logitech M185 SKU', () => {
    const pack = matchCatalogPhotoPack('Logitech M185 Wireless Mouse')
    expect(pack?.id).toBe('logitech-m185')
  })

  it('matches the TP-Link 300Mbps router, not the USB adapter', () => {
    expect(matchCatalogPhotoPack('TP-Link 300Mbps Wireless N Router')?.id).toBe('tplink-wr740n')
    expect(matchCatalogPhotoPack('TP-Link 300Mbps Mini Wireless N USB Adapter')?.id).toBe('tplink-usb-wifi')
  })

  it('does not invent a pack for unknown machines', () => {
    expect(matchCatalogPhotoPack('Random OEM Chromebook 14')).toBeNull()
  })

  it('has unique pack ids', () => {
    const ids = CATALOG_PHOTO_PACKS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('partnerImagesFromSlots', () => {
  it('prefers uploaded slots and fills the rest from the catalog pack', () => {
    expect(partnerImagesFromSlots('prod-1', { 1: true }, 'logitech-m185')).toEqual([
      { url: productImagePublicPath('prod-1', 1), role: 'hero' },
      { url: catalogPhotoPublicPath('logitech-m185', 2), role: 'detail' },
    ])
  })

  it('returns an empty list when nothing is uploaded and no pack matches', () => {
    expect(partnerImagesFromSlots('prod-1', {})).toEqual([])
  })
})

describe('duplicate products', () => {
  it('groups by name, SKU, and barcode and keeps the active high-ref row', () => {
    const groups = findDuplicateProductGroups([
      { id: 'a', name: 'HP EliteBook 830 G5', sku: 'SKU-A', barcode: '', isActive: true, createdAt: '2026-01-01', refCount: 1 },
      { id: 'b', name: 'hp elitebook 830 g5', sku: 'SKU-B', barcode: '', isActive: true, createdAt: '2026-02-01', refCount: 8 },
      { id: 'c', name: 'Other', sku: 'SKU-A', barcode: '111', isActive: false, createdAt: '2026-03-01', refCount: 0 },
    ])
    expect(groups.some(g => g.kind === 'name' && g.members.map(m => m.id).sort().join() === 'a,b')).toBe(true)
    expect(groups.some(g => g.kind === 'sku' && g.members.map(m => m.id).sort().join() === 'a,c')).toBe(true)
    const nameGroup = groups.find(g => g.kind === 'name')!
    expect(pickKeepProduct(nameGroup.members).id).toBe('b')
  })

  it('does not treat parent/variant shared names as duplicates', () => {
    const groups = findDuplicateProductGroups([
      { id: 'p', name: 'ThinkPad', sku: 'P', barcode: '', parentId: null, isActive: true, refCount: 1 },
      { id: 'v', name: 'ThinkPad', sku: 'V', barcode: '', parentId: 'p', isActive: true, refCount: 1 },
    ])
    expect(groups).toHaveLength(0)
  })

  it('rewrites blob product ids and drops the merged master row', () => {
    const next = rewriteProductIdsInRecords([
      { id: 'keep', name: 'Keep' },
      { id: 'drop', name: 'Drop' },
      { id: 's1', productId: 'drop' },
    ], 'drop', 'keep')
    expect(next).toEqual([
      { id: 'keep', name: 'Keep' },
      { id: 's1', productId: 'keep' },
    ])
  })

  it('normalizes identity', () => {
    expect(normalizeProductIdentity('  HP  EliteBook  ')).toBe('hp elitebook')
  })
})
