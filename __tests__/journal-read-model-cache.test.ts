import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fp, findMany } = vi.hoisted(() => ({ fp: { value: 'a' }, findMany: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  default: {
    $queryRawUnsafe: vi.fn(async () => [{ fp: fp.value }]),
    journalEntry: { findMany },
  },
}))

import { loadScreenJournals } from '@/lib/journal-read-model.server'
import { clearReadModelCache } from '@/lib/read-model-cache'

const entry = (id: string) => ({
  id, ref: `JRN/${id}`, entryDate: new Date('2026-10-22'), sourceType: 'invoice', journal: null, description: '',
  isPosted: true, totalDebit: 100, totalCredit: 100, invoiceId: null, paymentId: null, sourceId: null,
  isReversed: false, reversalOfId: null, blobId: null, lines: [],
})

describe('journal list cache', () => {
  beforeEach(() => { clearReadModelCache(); findMany.mockReset(); fp.value = 'a' })

  it('reads the tables once while nothing changes, again when journals change', async () => {
    findMany.mockResolvedValue([entry('1')])
    await loadScreenJournals()
    await loadScreenJournals()
    expect(findMany).toHaveBeenCalledTimes(1)
    fp.value = 'b'
    findMany.mockResolvedValue([entry('1'), entry('2')])
    const list = await loadScreenJournals()
    expect(findMany).toHaveBeenCalledTimes(2)
    expect(list.map(j => j.ref)).toEqual(['JRN/1', 'JRN/2'])
  })

  it('a caller editing its copy does not change the cached list', async () => {
    findMany.mockResolvedValue([entry('1')])
    const first = await loadScreenJournals()
    first[0].description = 'changed'
    const again = await loadScreenJournals()
    expect(again[0].description).toBe('')
  })
})
