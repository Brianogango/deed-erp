import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const read = vi.fn()
vi.mock('@/lib/ai/read-document.server', () => ({ readDocumentWithClaude: (args: unknown) => read(args) }))

import { readReceiptImage } from '@/lib/scan/receipt-extract.server'
import { readPurchaseDocument } from '@/lib/scan/purchase-extract.server'

beforeEach(() => read.mockReset())

describe('receipt scan', () => {
  it('returns the amount, date, description and category as a draft', async () => {
    read.mockResolvedValue({ engine: 'm', data: { amount: 125.004, date: '2026-11-12', description: ' Bread and milk — Naivas ', category: 'meals' } })
    expect(await readReceiptImage('x', 'image/jpeg')).toEqual({ amount: 125, date: '2026-11-12', description: 'Bread and milk — Naivas', category: 'meals', engine: 'm' })
  })

  it('leaves an unreadable amount and date empty rather than guessing', async () => {
    read.mockResolvedValue({ engine: 'm', data: { amount: 0, date: '12/11/2026', description: '', category: 'other' } })
    const out = await readReceiptImage('x', 'image/jpeg')
    expect(out.amount).toBeNull()
    expect(out.date).toBe('')
  })
})

describe('purchase document scan', () => {
  it('keeps real lines, defaults a missing quantity to 1 and drops blank lines', async () => {
    read.mockResolvedValue({ engine: 'm', data: {
      vendorName: ' Acme Ltd ', date: '2026-11-01', reference: 'INV-9', subtotal: 50000, taxTotal: 8000, total: 58000,
      lines: [
        { productName: 'Dell Latitude 5420', qty: 0, unitPrice: 50000, taxRate: 16, lineTotal: 50000 },
        { productName: '  ', qty: 1, unitPrice: 1, taxRate: 16, lineTotal: 1 },
        { productName: 'Bag', qty: 2, unitPrice: -5, taxRate: 300, lineTotal: 0 },
      ],
    } })
    const out = await readPurchaseDocument('x', 'image/jpeg')
    expect(out.vendorName).toBe('Acme Ltd')
    expect(out.total).toBe(58000)
    expect(out.lines).toEqual([
      { productName: 'Dell Latitude 5420', qty: 1, unitPrice: 50000, taxRate: 16, lineTotal: 50000 },
      { productName: 'Bag', qty: 2, unitPrice: 0, taxRate: 0, lineTotal: null },
    ])
  })
})
