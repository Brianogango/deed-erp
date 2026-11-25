import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockEnqueue = vi.fn()
const mockFindUnique = vi.fn()
const mockUpdate = vi.fn()
const mockBuildInput = vi.fn()
const mockAllocateRef = vi.fn()
const mockCreateJournal = vi.fn()
const mockRecordTax = vi.fn()
const mockResolveMirror = vi.fn()

vi.mock('@/lib/infra/jobs', () => ({
  enqueueDurableJob: (...args: unknown[]) => mockEnqueue(...args),
}))
vi.mock('@/lib/prisma', () => ({
  default: {
    invoice: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}))
vi.mock('@/lib/accounting/invoice-journals', () => ({
  buildInvoiceJournalInput: (...args: unknown[]) => mockBuildInput(...args),
  allocateInvoiceJournalRef: (...args: unknown[]) => mockAllocateRef(...args),
}))
vi.mock('@/lib/accounting/journal-service', () => ({
  createJournalEntry: (...args: unknown[]) => mockCreateJournal(...args),
}))
vi.mock('@/lib/accounting/invoice-tax.server', () => ({
  recordInvoiceTax: (...args: unknown[]) => mockRecordTax(...args),
}))
vi.mock('@/lib/accounting/resolve-invoice-mirror', () => ({
  resolveBlobInvoiceMirror: (...args: unknown[]) => mockResolveMirror(...args),
}))

import {
  enqueueInvoicePostingRetry,
  runInvoicePostingRetry,
  INVOICE_POSTING_JOB,
} from '@/lib/invoice-posting-jobs'

const INVOICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    invoiceNumber: 'INV/0042',
    invoiceDate: new Date('2026-11-01T00:00:00Z'),
    totalAmount: 1160,
    subtotal: 1000,
    taxAmount: 160,
    status: 'approved',
    postingStatus: 'unposted',
    postedJournalEntryId: null,
    postedAt: null,
    postedById: null,
    documentType: 'customer_invoice',
    repairId: null,
    items: [{ id: 'li1', productId: null, qty: 1, unitPrice: 1000, lineSubtotal: 1000, description: 'Laptop' }],
    ...over,
  }
}

beforeEach(() => {
  for (const m of [mockEnqueue, mockFindUnique, mockUpdate, mockBuildInput, mockAllocateRef, mockCreateJournal, mockRecordTax, mockResolveMirror]) m.mockReset()
  mockEnqueue.mockResolvedValue({ id: 'job' })
  mockResolveMirror.mockResolvedValue({ type: 'customer_invoice', partnerName: 'Acme', clientName: 'Acme', purchaseOrderId: null })
  mockBuildInput.mockResolvedValue({ ref: 'JRN/INV/0042', journalCode: 'SAL', lines: [] })
  mockAllocateRef.mockImplementation(async (ref: string) => ref)
  mockCreateJournal.mockResolvedValue({ id: 'jrn-1', ref: 'JRN/INV/0042' })
  mockRecordTax.mockResolvedValue(1)
  mockUpdate.mockResolvedValue({})
})

describe('enqueueInvoicePostingRetry', () => {
  it('queues one coalesced retry per invoice', async () => {
    await enqueueInvoicePostingRetry(INVOICE_ID, new Error('period locked'))
    const input = mockEnqueue.mock.calls[0][0]
    expect(input.type).toBe(INVOICE_POSTING_JOB)
    expect(input.uniqueKey).toBe(`${INVOICE_POSTING_JOB}:${INVOICE_ID}`)
    expect(input.payload).toMatchObject({ invoiceId: INVOICE_ID, lastError: 'period locked' })
  })

  it('never throws when the queue is unavailable', async () => {
    mockEnqueue.mockRejectedValueOnce(new Error('queue down'))
    await expect(enqueueInvoicePostingRetry(INVOICE_ID, 'x')).resolves.toBeUndefined()
  })
})

describe('runInvoicePostingRetry', () => {
  it('posts the journal, records tax and marks the invoice posted', async () => {
    mockFindUnique.mockResolvedValue(invoice())
    const result = await runInvoicePostingRetry({ invoiceId: INVOICE_ID })
    expect(result).toEqual({ invoiceId: INVOICE_ID, outcome: 'posted', journalId: 'jrn-1' })
    expect(mockRecordTax).toHaveBeenCalledWith(INVOICE_ID, 'jrn-1')
    expect(mockUpdate.mock.calls[0][0].data).toMatchObject({
      postingStatus: 'posted',
      postedJournalEntryId: 'jrn-1',
    })
  })

  it('does nothing when the invoice is already posted', async () => {
    mockFindUnique.mockResolvedValue(invoice({ postingStatus: 'posted', postedJournalEntryId: 'jrn-existing' }))
    const result = await runInvoicePostingRetry({ invoiceId: INVOICE_ID })
    expect(result).toEqual({ invoiceId: INVOICE_ID, outcome: 'already_posted', journalId: 'jrn-existing' })
    expect(mockCreateJournal).not.toHaveBeenCalled()
  })

  it('links the existing journal instead of posting a second one', async () => {
    // The first attempt created the journal but died before updating the
    // invoice. allocateInvoiceJournalRef returns the same canonical ref and
    // createJournalEntry dedupes on it, so the retry must repair the link
    // rather than double-post — the orphaned state KI-02 describes.
    mockFindUnique.mockResolvedValue(invoice())
    mockCreateJournal.mockResolvedValueOnce({ id: 'jrn-already-there', ref: 'JRN/INV/0042' })
    const result = await runInvoicePostingRetry({ invoiceId: INVOICE_ID })
    expect(mockAllocateRef).toHaveBeenCalledWith('JRN/INV/0042')
    expect(mockCreateJournal).toHaveBeenCalledTimes(1)
    expect(result.journalId).toBe('jrn-already-there')
  })

  it.each(['draft', 'cancelled'])('refuses to resurrect a %s invoice', async status => {
    mockFindUnique.mockResolvedValue(invoice({ status }))
    const result = await runInvoicePostingRetry({ invoiceId: INVOICE_ID })
    expect(result.outcome).toBe('not_postable')
    expect(mockCreateJournal).not.toHaveBeenCalled()
  })

  it('is a no-op for an invoice that no longer exists', async () => {
    mockFindUnique.mockResolvedValue(null)
    expect((await runInvoicePostingRetry({ invoiceId: INVOICE_ID })).outcome).toBe('not_postable')
  })

  it('propagates a posting failure so the job retries with backoff', async () => {
    mockFindUnique.mockResolvedValue(invoice())
    mockCreateJournal.mockRejectedValueOnce(new Error('fiscal period is locked'))
    await expect(runInvoicePostingRetry({ invoiceId: INVOICE_ID })).rejects.toThrow(/fiscal period is locked/)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects a job with no invoiceId', async () => {
    await expect(runInvoicePostingRetry({})).rejects.toThrow(/no invoiceId/)
  })

  it('keeps the original postedAt when one is already set', async () => {
    const postedAt = new Date('2026-11-02T10:00:00Z')
    mockFindUnique.mockResolvedValue(invoice({ postedAt }))
    await runInvoicePostingRetry({ invoiceId: INVOICE_ID })
    expect(mockUpdate.mock.calls[0][0].data.postedAt).toBe(postedAt)
  })
})
