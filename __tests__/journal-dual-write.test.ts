import { afterEach, describe, expect, it, vi } from 'vitest'
import { queueJournalPrismaPersist } from '@/lib/accounting/journal-dual-write'
import { areJournalWritersMigratedOffBlob } from '@/lib/accounting/journal-writers-flag'

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.JOURNAL_WRITERS_MIGRATED
})

describe('journal dual-write helper', () => {
  it('POSTs skipIfExists payload for a balanced journal', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    queueJournalPrismaPersist({
      ref: 'INV/2026/001',
      date: '2026-08-01',
      description: 'Invoice post',
      source: 'invoice',
      invoiceId: 'inv-1',
      lines: [
        { account: '1800 Accounts Receivable', debit: 1160, credit: 0 },
        { account: '4000 Sales', debit: 0, credit: 1000 },
        { account: '3301 VAT Output', debit: 0, credit: 160 },
      ],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/accounting/journals')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.ref).toBe('INV/2026/001')
    expect(body.skipIfExists).toBe(true)
    expect(body.sourceId).toBe('inv-1')
    expect(body.lines).toHaveLength(3)
  })

  it('no-ops when ref or lines missing', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    queueJournalPrismaPersist({ ref: '', lines: [] })
    queueJournalPrismaPersist({ ref: 'X', lines: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('journal writers migrated flag', () => {
  it('defaults false', () => {
    expect(areJournalWritersMigratedOffBlob()).toBe(false)
  })

  it('reads JOURNAL_WRITERS_MIGRATED', () => {
    process.env.JOURNAL_WRITERS_MIGRATED = 'true'
    expect(areJournalWritersMigratedOffBlob()).toBe(true)
  })
})
