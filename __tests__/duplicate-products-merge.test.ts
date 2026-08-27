import { describe, expect, it } from 'vitest'
import {
  nextUniqueProductCode,
  planArchivedProductIdentity,
} from '@/lib/inventory/duplicate-products'

describe('nextUniqueProductCode', () => {
  it('returns the desired code when it is free', () => {
    expect(nextUniqueProductCode('DEED-HPELITEB-BG2KH-M', ['DEED-HPELITEB-BG2KH'])).toBe(
      'DEED-HPELITEB-BG2KH-M',
    )
  })

  it('suffixes when the truncated 60-char candidate still matches the original', () => {
    const barcode = 'B'.repeat(60)
    const next = nextUniqueProductCode(`${barcode}-M`, [barcode])
    expect(next).not.toBe(barcode)
    expect(next.length).toBeLessThanOrEqual(60)
    expect(next.endsWith('-M1')).toBe(true)
  })
})

describe('planArchivedProductIdentity', () => {
  it('frees the drop barcode so the keeper can inherit it', () => {
    const plan = planArchivedProductIdentity({
      drop: {
        id: '11111111-2222-3333-4444-555555555555',
        sku: 'HPELITEB-EF1DE8',
        barcode: 'DEED-HPELITEB-BG2KH',
        name: 'HP EliteBook 830 G7',
      },
      keep: { barcode: null },
      takenSkus: ['HPELITEB-BG2KH', 'HPELITEB-EF1DE8'],
      takenBarcodes: ['DEED-HPELITEB-BG2KH'],
    })
    expect(plan.copyBarcodeToKeep).toBe(true)
    expect(plan.barcode).toBe('DEED-HPELITEB-BG2KH-M')
    expect(plan.sku).toContain('HPELITEB-EF1DE8-MERGED-')
    expect(plan.sku).not.toBe('HPELITEB-EF1DE8')
    expect(plan.name).toBe('HP EliteBook 830 G7 (merged)')
  })

  it('does not copy a barcode the keeper already has', () => {
    const plan = planArchivedProductIdentity({
      drop: { id: 'drop-id', sku: 'DROP', barcode: 'BC-DROP', name: 'Drop' },
      keep: { barcode: 'BC-KEEP' },
      takenSkus: ['KEEP', 'DROP'],
      takenBarcodes: ['BC-KEEP', 'BC-DROP'],
    })
    expect(plan.copyBarcodeToKeep).toBe(false)
    expect(plan.barcode).toBe('BC-DROP-M')
  })
})
