/**
 * Customer invoice GL journals split revenue per line onto the official
 * chart: product → category sale account, repair service lines → 5121
 * Hardware Support, company fallback 5000. Previously everything posted
 * flat to 5000 and the per-category / repair revenue accounts stayed empty.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockLoadAppState } = vi.hoisted(() => ({ mockLoadAppState: vi.fn() }))

vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: vi.fn(),
}))

import { buildInvoiceJournalInput } from '@/lib/accounting/invoice-journals'

const LAPTOP = { id: 'prod-laptop', name: 'HP ProBook', category: 'Laptops' }
const ACCESSORY = { id: 'prod-acc', name: 'USB Cable', category: 'Accessories' }

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadAppState.mockResolvedValue({ deed_products: [LAPTOP, ACCESSORY] })
})

describe('buildInvoiceJournalInput — customer invoice revenue split', () => {
  it('splits revenue per line onto category sale accounts', async () => {
    const journal = await buildInvoiceJournalInput({
      id: 'inv-1',
      ref: 'INV/2026/0001',
      partnerName: 'Acme',
      total: 3480,
      subtotal: 3000,
      taxTotal: 480,
      type: 'customer_invoice',
      lines: [
        { productId: 'prod-laptop', qty: 1, unitPrice: 2000, subtotal: 2000 },
        { productId: 'prod-acc', qty: 2, unitPrice: 500, subtotal: 1000 },
      ],
    })
    const credits = journal.lines.filter(l => l.credit > 0)
    expect(credits.find(l => l.accountLabel.startsWith('5001'))?.credit).toBe(2000)
    expect(credits.find(l => l.accountLabel.startsWith('5002'))?.credit).toBe(1000)
    expect(credits.find(l => l.accountLabel.startsWith('3301'))?.credit).toBe(480)
    expect(journal.lines.find(l => l.debit > 0)?.accountLabel).toContain('1800')
  })

  it('posts repair service lines (labor/diagnosis, no product) to 5121 Hardware Support', async () => {
    const journal = await buildInvoiceJournalInput({
      id: 'inv-2',
      ref: 'INV/2026/0002',
      partnerName: 'Ann',
      total: 3500,
      subtotal: 3500,
      taxTotal: 0,
      type: 'customer_invoice',
      repairId: 'rep-1',
      lines: [
        { description: 'Labor & Service Charges', qty: 1, unitPrice: 2500, subtotal: 2500 },
        { description: 'Diagnosis Fee', qty: 1, unitPrice: 1000, subtotal: 1000 },
      ],
    })
    const revenue = journal.lines.filter(l => l.credit > 0)
    expect(revenue).toHaveLength(1)
    expect(revenue[0].accountLabel).toBe('5121')
    expect(revenue[0].credit).toBe(3500)
  })

  it('falls back to 5000 when there are no lines', async () => {
    const journal = await buildInvoiceJournalInput({
      id: 'inv-3',
      ref: 'INV/2026/0003',
      partnerName: 'Walk-in',
      total: 1000,
      subtotal: 1000,
      taxTotal: 0,
      type: 'customer_invoice',
      lines: [],
    })
    expect(journal.lines.find(l => l.credit === 1000)?.accountLabel).toBe('5000')
  })
})
