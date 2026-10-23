import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fp, sigs, findMany } = vi.hoisted(() => ({
  fp: { value: 'a' },
  sigs: { value: [] as Array<{ id: string; sig: string }> },
  findMany: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  default: {
    $queryRawUnsafe: vi.fn(async (sql: string) => (sql.includes('AS sig') ? sigs.value : [{ fp: fp.value }])),
    journalEntry: { findMany },
  },
}))

import { loadScreenJournals, resetJournalSnapshot } from '@/lib/journal-read-model.server'
import { clearReadModelCache } from '@/lib/read-model-cache'

const entry = (id: string, description = '') => ({
  id, ref: `JRN/${id}`, entryDate: new Date('2026-10-22'), sourceType: 'invoice', journal: null, description,
  isPosted: true, totalDebit: 100, totalCredit: 100, invoiceId: null, paymentId: null, sourceId: null,
  isReversed: false, reversalOfId: null, blobId: null, lines: [],
})

/** findMany answering like the table: all rows, or only the ids asked for. */
function table(rows: ReturnType<typeof entry>[]) {
  findMany.mockImplementation(async (args: any) => {
    const ids: string[] | undefined = args?.where?.id?.in
    return ids ? rows.filter(r => ids.includes(r.id)) : rows
  })
}

describe('journal list cache', () => {
  beforeEach(() => {
    clearReadModelCache(); resetJournalSnapshot(); findMany.mockReset(); fp.value = 'a'
    sigs.value = [{ id: '1', sig: 's1' }]
  })

  it('reads the tables once while nothing changes, again when journals change', async () => {
    table([entry('1')])
    await loadScreenJournals()
    await loadScreenJournals()
    expect(findMany).toHaveBeenCalledTimes(1)
    fp.value = 'b'
    sigs.value = [{ id: '2', sig: 's2' }, { id: '1', sig: 's1' }]
    table([entry('1'), entry('2')])
    const list = await loadScreenJournals()
    expect(findMany).toHaveBeenCalledTimes(2)
    expect(list.map(j => j.ref)).toEqual(['JRN/2', 'JRN/1'])
  })

  it('after a new posting reads only the new or changed entries', async () => {
    table([entry('1'), entry('2')])
    sigs.value = [{ id: '2', sig: 's2' }, { id: '1', sig: 's1' }]
    await loadScreenJournals()
    expect(findMany.mock.calls[0][0].where.id).toBeUndefined()

    fp.value = 'b'
    sigs.value = [{ id: '3', sig: 's3' }, { id: '2', sig: 's2-edited' }, { id: '1', sig: 's1' }]
    table([entry('1'), entry('2', 'edited'), entry('3')])
    const list = await loadScreenJournals()
    expect(findMany.mock.calls[1][0].where.id.in.sort()).toEqual(['2', '3'])
    expect(list.map(j => [j.ref, j.description])).toEqual([['JRN/3', ''], ['JRN/2', 'edited'], ['JRN/1', '']])
  })

  it('drops entries that are no longer posted', async () => {
    table([entry('1'), entry('2')])
    sigs.value = [{ id: '2', sig: 's2' }, { id: '1', sig: 's1' }]
    await loadScreenJournals()
    fp.value = 'b'
    sigs.value = [{ id: '1', sig: 's1' }]
    const list = await loadScreenJournals()
    expect(list.map(j => j.ref)).toEqual(['JRN/1'])
  })

  it('reads everything when the check changed but no entry hash did', async () => {
    table([entry('1')])
    await loadScreenJournals()
    fp.value = 'b'
    table([entry('1', 'relabelled')])
    const list = await loadScreenJournals()
    expect(findMany.mock.calls[1][0].where.id).toBeUndefined()
    expect(list[0].description).toBe('relabelled')
  })

  it('a caller editing its copy does not change the cached list', async () => {
    table([entry('1')])
    const first = await loadScreenJournals()
    first[0].description = 'changed'
    const again = await loadScreenJournals()
    expect(again[0].description).toBe('')
    fp.value = 'b'
    sigs.value = [{ id: '2', sig: 's2' }, { id: '1', sig: 's1' }]
    table([entry('1'), entry('2')])
    const third = await loadScreenJournals()
    expect(third.find(j => j.id === '1')?.description).toBe('')
  })
})
