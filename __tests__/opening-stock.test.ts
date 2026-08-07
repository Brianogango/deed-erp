import { describe, expect, it } from 'vitest'
import {
  hasOpeningStockMoves,
  isOpeningStockLocked,
  isOpeningStockMove,
} from '@/lib/inventory/opening-stock'

describe('opening-stock', () => {
  it('detects classic OPENING document moves', () => {
    expect(isOpeningStockMove({ type: 'in', documentRef: 'OPENING', reason: 'Opening stock' })).toBe(true)
  })

  it('detects ops-script OPENING-* document refs', () => {
    expect(isOpeningStockMove({
      type: 'in',
      documentRef: 'OPENING-ACC-PDF-8BAF',
      reason: 'Opening stock',
    })).toBe(true)
  })

  it('detects opening stock by reason text alone', () => {
    expect(isOpeningStockMove({ type: 'in', documentRef: 'ADJ-1', reason: 'Opening stock import' })).toBe(true)
  })

  it('ignores non-opening receipts', () => {
    expect(isOpeningStockMove({ type: 'in', documentRef: 'GRN/0001', reason: 'Receipt' })).toBe(false)
    expect(isOpeningStockMove({ type: 'out', documentRef: 'OPENING', reason: 'Opening stock' })).toBe(false)
  })

  // Regression: reconfiguration blob moves used to omit `reason` (text lived in
  // `notes` only). Inventory report memos must not throw on those rows.
  it('tolerates missing reason on non-opening inbound moves', () => {
    expect(isOpeningStockMove({
      type: 'in',
      documentRef: 'RCF/2026/0001',
      reason: null,
    })).toBe(false)
    expect(isOpeningStockMove({
      type: 'in',
      documentRef: 'RCF/2026/0001',
      reason: undefined,
    })).toBe(false)
  })

  it('locks when moves exist even if flag is false', () => {
    expect(isOpeningStockLocked(false, [
      { type: 'in', documentRef: 'OPENING', reason: 'Opening stock' },
    ])).toBe(true)
    expect(hasOpeningStockMoves([])).toBe(false)
    expect(isOpeningStockLocked(true, [])).toBe(true)
    expect(isOpeningStockLocked(false, [])).toBe(false)
  })
})
