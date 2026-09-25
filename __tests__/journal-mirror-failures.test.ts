import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockLoadAppState = vi.fn()
const mockSaveStoreKeys = vi.fn()
const mockPersist = vi.fn()

vi.mock('@/lib/server-store', () => ({
  loadAppState: (...args: unknown[]) => mockLoadAppState(...args),
  saveStoreKeys: (...args: unknown[]) => mockSaveStoreKeys(...args),
}))

vi.mock('@/lib/prisma', () => ({
  default: { accountCode: { upsert: vi.fn() } },
}))

vi.mock('@/lib/accounting/journal-service', () => ({
  persistStoreJournalEntry: (...args: unknown[]) => mockPersist(...args),
}))

import { mirrorJournalEntriesToPrisma } from '@/lib/accounting/account-journal-mirror'
import {
  JOURNAL_MIRROR_FAILURE_KEY,
  clearJournalMirrorFailure,
  describeMirrorError,
  pruneJournalMirrorFailures,
  recordJournalMirrorFailure,
  sortJournalMirrorFailures,
  type JournalMirrorFailureMap,
} from '@/lib/accounting/journal-mirror-failures'

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'jrn-1',
  ref: 'JRN/INV/0042',
  date: '2026-09-25',
  source: 'invoice',
  description: 'Invoice posting',
  lines: [
    { id: 'l1', account: '1800 - Accounts Receivable', description: 'AR', debit: 100_000, credit: 0 },
    { id: 'l2', account: '4000 - Sales', description: 'Revenue', debit: 0, credit: 100_000 },
  ],
  ...over,
})

/** app_state as the mirror sees it: hash record first, failure record second. */
const appState = (state: Record<string, unknown> = {}) => {
  mockLoadAppState.mockImplementation(async (keys: string[]) => {
    const out: Record<string, unknown> = {}
    for (const k of keys) if (k in state) out[k] = state[k]
    return out
  })
}

const savedFailures = (): JournalMirrorFailureMap | null => {
  const call = mockSaveStoreKeys.mock.calls.find(c => JOURNAL_MIRROR_FAILURE_KEY in (c[0] as object))
  return call ? JSON.parse((call[0] as Record<string, string>)[JOURNAL_MIRROR_FAILURE_KEY]) : null
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  appState({})
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockPersist.mockResolvedValue({ id: 'row-1' })
})

describe('the failure record', () => {
  it('keeps the reason, not a stack trace', () => {
    const map = recordJournalMirrorFailure({}, entry(), new Error('Unknown account 6301.'))
    expect(map['JRN/INV/0042'].reason).toBe('Unknown account 6301.')
  })

  it('counts attempts across passes and keeps the first sighting', () => {
    let map = recordJournalMirrorFailure({}, entry(), new Error('boom'), '2026-09-24T10:00:00.000Z')
    map = recordJournalMirrorFailure(map, entry(), new Error('boom'), '2026-09-25T10:00:00.000Z')
    expect(map['JRN/INV/0042']).toMatchObject({
      attempts: 2,
      firstFailedAt: '2026-09-24T10:00:00.000Z',
      lastFailedAt: '2026-09-25T10:00:00.000Z',
    })
  })

  it('carries enough context to find the journal: source, date and amount', () => {
    const map = recordJournalMirrorFailure({}, entry(), new Error('boom'))
    expect(map['JRN/INV/0042']).toMatchObject({
      source: 'invoice',
      date: '2026-09-25',
      amount: 100_000,
    })
  })

  it('survives a thrown non-Error', () => {
    expect(describeMirrorError({ weird: true })).toBe('Unknown mirror failure')
    expect(describeMirrorError('plain string')).toBe('plain string')
  })

  it('clears one ref and prunes refs that left the blob', () => {
    let map = recordJournalMirrorFailure({}, entry(), new Error('a'))
    map = recordJournalMirrorFailure(map, entry({ ref: 'JRN/EXP/0001' }), new Error('b'))
    expect(Object.keys(clearJournalMirrorFailure(map, 'JRN/INV/0042'))).toEqual(['JRN/EXP/0001'])
    expect(Object.keys(pruneJournalMirrorFailures(map, new Set(['JRN/INV/0042'])))).toEqual(['JRN/INV/0042'])
  })

  it('lists the most recent failure first', () => {
    let map = recordJournalMirrorFailure({}, entry({ ref: 'OLD' }), new Error('a'), '2026-09-01T00:00:00.000Z')
    map = recordJournalMirrorFailure(map, entry({ ref: 'NEW' }), new Error('b'), '2026-09-25T00:00:00.000Z')
    expect(sortJournalMirrorFailures(map).map(f => f.ref)).toEqual(['NEW', 'OLD'])
  })
})

describe('mirrorJournalEntriesToPrisma — a refused journal is never silent', () => {
  it('records the ref and the reason when the ledger refuses the entry', async () => {
    mockPersist.mockRejectedValue(new Error('Unknown account 6301. Create and approve the account'))

    const result = await mirrorJournalEntriesToPrisma([entry()])

    expect(result.failed).toBe(1)
    expect(savedFailures()).toMatchObject({
      'JRN/INV/0042': { attempts: 1, reason: expect.stringContaining('Unknown account 6301') },
    })
  })

  it('does not fingerprint a refused entry, so the next pass retries it', async () => {
    mockPersist.mockRejectedValue(new Error('Fiscal period is closed'))
    await mirrorJournalEntriesToPrisma([entry()])

    const hashCall = mockSaveStoreKeys.mock.calls.find(c => 'journal_mirror_hashes_v1' in (c[0] as object))
    expect(hashCall).toBeUndefined()
  })

  it('clears the failure once the entry finally posts', async () => {
    appState({
      journal_mirror_failures_v1: {
        'JRN/INV/0042': {
          ref: 'JRN/INV/0042', reason: 'Unknown account 6301', source: 'invoice',
          date: '2026-09-25', amount: 100_000, attempts: 4,
          firstFailedAt: '2026-09-20T00:00:00.000Z', lastFailedAt: '2026-09-24T00:00:00.000Z',
        },
      },
    })

    const result = await mirrorJournalEntriesToPrisma([entry()])

    expect(result.mirrored).toBe(1)
    expect(savedFailures()).toEqual({})
  })

  it('forgets failures for journals that are no longer in the blob', async () => {
    appState({
      journal_mirror_failures_v1: {
        GONE: {
          ref: 'GONE', reason: 'boom', source: null, date: null, amount: null,
          attempts: 1, firstFailedAt: '2026-09-01T00:00:00.000Z', lastFailedAt: '2026-09-01T00:00:00.000Z',
        },
      },
    })

    await mirrorJournalEntriesToPrisma([entry()])

    expect(savedFailures()).toEqual({})
  })

  it('keeps mirroring the rest of the batch after one entry is refused', async () => {
    mockPersist.mockImplementation(async (e: { ref: string }) => {
      if (e.ref === 'JRN/BAD') throw new Error('Unbalanced journal')
      return { id: 'ok' }
    })

    const result = await mirrorJournalEntriesToPrisma([
      entry({ ref: 'JRN/GOOD/1' }),
      entry({ ref: 'JRN/BAD' }),
      entry({ ref: 'JRN/GOOD/2' }),
    ])

    expect(result).toMatchObject({ mirrored: 2, failed: 1 })
    expect(Object.keys(savedFailures() ?? {})).toEqual(['JRN/BAD'])
  })

  it('leaves the failure record untouched when a clean pass changes nothing', async () => {
    await mirrorJournalEntriesToPrisma([entry()])
    expect(savedFailures()).toBeNull()
  })

  it('still skips blob payroll journals — the statutory copy is posted separately', async () => {
    const result = await mirrorJournalEntriesToPrisma([entry({ source: 'payroll' })])
    expect(result).toMatchObject({ mirrored: 0, skipped: 1, failed: 0 })
    expect(mockPersist).not.toHaveBeenCalled()
  })
})

describe('the fingerprint version', () => {
  it('ignores hashes written before the version was introduced, forcing one re-mirror', async () => {
    // A bare md5 of the old payload shape. The versioned fingerprint cannot
    // collide with it, so the entry is re-mirrored rather than skipped.
    appState({ journal_mirror_hashes_v1: { 'JRN/INV/0042': 'd41d8cd98f00b204e9800998ecf8427e' } })

    const result = await mirrorJournalEntriesToPrisma([entry()])

    expect(result.mirrored).toBe(1)
    expect(mockPersist).toHaveBeenCalledOnce()
  })

  it('skips an entry whose versioned fingerprint already matches', async () => {
    await mirrorJournalEntriesToPrisma([entry()])
    const hashCall = mockSaveStoreKeys.mock.calls.find(c => 'journal_mirror_hashes_v1' in (c[0] as object))
    const hashes = JSON.parse((hashCall![0] as Record<string, string>)['journal_mirror_hashes_v1'])

    vi.clearAllMocks()
    appState({ journal_mirror_hashes_v1: hashes })
    mockSaveStoreKeys.mockResolvedValue(undefined)

    const result = await mirrorJournalEntriesToPrisma([entry()])

    expect(result).toMatchObject({ mirrored: 0, skipped: 1 })
    expect(mockPersist).not.toHaveBeenCalled()
  })
})
