import { describe, expect, it } from 'vitest'
import { buildMachineLabelView, compactLabelSpecs, machineLabelVariant } from '@/lib/inventory/machine-label'

describe('machine label', () => {
  it('picks the version from where the machine is', () => {
    expect(machineLabelVariant({ location: 'shop' })).toBe('with_issues')
    expect(machineLabelVariant({ status: 'refurbishment', location: 'repair_unit' })).toBe('with_issues')
    expect(machineLabelVariant({ identityPending: true, location: 'warehouse' })).toBe('with_issues')
    expect(machineLabelVariant({ location: 'warehouse', productType: 'refurbished' })).toBe('refurbished')
    expect(machineLabelVariant({ location: 'warehouse', productType: 'new' })).toBe('new')
    // A ready refurb is still at the repair unit but gets the sale sticker…
    expect(machineLabelVariant({ status: 'refurbishment', location: 'repair_unit', forSale: true })).toBe('refurbished')
    // …unless nobody has identified it yet.
    expect(machineLabelVariant({ location: 'repair_unit', identityPending: true, forSale: true })).toBe('with_issues')
  })

  it('writes the short specs line', () => {
    expect(compactLabelSpecs('Intel Core i5 8th Gen, 8GB RAM, 256GB SSD')).toBe('8th i5 8GB 256GB')
    expect(compactLabelSpecs('8th Gen i5 8GB RAM 256GB SSD')).toBe('8th i5 8GB 256GB')
    expect(compactLabelSpecs('')).toBe('')
  })

  it('internal label: no serial, no specs, asset ID and date in', () => {
    const v = buildMachineLabelView({ productName: 'Laptop — unidentified', category: 'Laptops', serial: 'UNK-261109-001', identityPending: true, assetId: 'LT000124', location: 'shop', specsText: '8GB RAM', receivedDate: '2026-11-09T10:00:00Z' })
    expect(v).toMatchObject({ variant: 'with_issues', specs: '', serial: '', code: 'LT000124', condition: 'WITH ISSUES · INTERNAL' })
    expect(v.dateIn).toMatch(/09 Nov 26/)
  })

  it('sale label: category, condition, specs and serial; barcode is the asset ID', () => {
    const v = buildMachineLabelView({ productName: 'HP EliteBook 840 G5', category: 'Laptops', productType: 'refurbished', serial: '5CG81234', assetId: 'DT000001', location: 'warehouse', specsText: 'Intel Core i5 8th Gen, 8GB RAM, 256GB SSD' })
    expect(v).toMatchObject({ variant: 'refurbished', category: 'LAPTOP', condition: 'REFURBISHED', specs: '8th i5 8GB 256GB', serial: '5CG81234', code: 'DT000001', dateIn: '' })
    expect(buildMachineLabelView({ productName: 'HP ProBook 450 G10', category: 'Laptops', productType: 'new', serial: 'X', assetId: 'LT000125', location: 'warehouse' }).condition).toBe('BRAND NEW')
  })
})
