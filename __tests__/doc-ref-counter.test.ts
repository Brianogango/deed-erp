import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }))

vi.mock('@/lib/auth/db', () => ({ sql: mockSql }))

import { DOC_PREFIX, getNextDocNumber } from '@/lib/doc-ref-counter'
import { prefixToKind } from '@/lib/doc-numbers'

const YEAR = new Date().getFullYear()

const EXPECTED_PREFIXES: Record<string, string> = {
  quote: 'QUO',
  quotation: 'QUO',
  invoice: 'INV',
  sale_order: 'SO',
  client: 'CLT',
  purchase_order: 'PO',
  delivery_note: 'DN',
  credit_note: 'CN',
  vendor_bill: 'BILL',
  receipt: 'REC',
  payment_receipt: 'RCT',
  reconfiguration: 'RCF',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DOC_PREFIX completeness', () => {
  it('maps every commercial DocKind to the expected prefix', () => {
    for (const [kind, prefix] of Object.entries(EXPECTED_PREFIXES)) {
      expect(DOC_PREFIX[kind as keyof typeof DOC_PREFIX]).toBe(prefix)
    }
    expect(Object.keys(DOC_PREFIX).sort()).toEqual(Object.keys(EXPECTED_PREFIXES).sort())
  })
})

describe('prefixToKind()', () => {
  it('maps UI prefix strings to server DocKind values', () => {
    expect(prefixToKind('PO')).toBe('purchase_order')
    expect(prefixToKind('DN')).toBe('delivery_note')
    expect(prefixToKind('CN')).toBe('credit_note')
    expect(prefixToKind('BILL')).toBe('vendor_bill')
    expect(prefixToKind('REC')).toBe('receipt')
    expect(prefixToKind('RCT')).toBe('payment_receipt')
    expect(prefixToKind('QUO')).toBe('quotation')
    expect(prefixToKind('SO')).toBe('sale_order')
    expect(prefixToKind('INV')).toBe('invoice')
  })
})

describe('getNextDocNumber()', () => {
  it('increments an existing counter atomically', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ current_value: 42 }] })

    const num = await getNextDocNumber('invoice')
    expect(num).toBe(`INV/${YEAR}/0042`)
  })

  it('seeds from the highest existing document number on first use', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ max_num: 88 }] })
      .mockResolvedValueOnce({ rows: [{ current_value: 89 }] })

    const num = await getNextDocNumber('quote')
    expect(num).toBe(`QUO/${YEAR}/0089`)
  })

  it('uses the shared QUO sequence for quotation-state sale orders', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ current_value: 7 }] })

    const num = await getNextDocNumber('quotation')
    expect(num).toBe(`QUO/${YEAR}/0007`)
  })

  it('starts at 1 when no documents exist', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ max_num: 0 }] })
      .mockResolvedValueOnce({ rows: [{ current_value: 1 }] })

    const num = await getNextDocNumber('sale_order')
    expect(num).toBe(`SO/${YEAR}/0001`)
  })

  it('keeps the legacy global format for client numbers', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ current_value: 12 }] })

    const num = await getNextDocNumber('client')
    expect(num).toBe('CLT-00012')
  })

  it('formats purchase order numbers with the PO prefix', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ current_value: 3 }] })

    const num = await getNextDocNumber('purchase_order')
    expect(num).toBe(`PO/${YEAR}/0003`)
  })

  it('throws when the counter cannot be generated', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ max_num: 0 }] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(getNextDocNumber('client')).rejects.toThrow()
  })
})
