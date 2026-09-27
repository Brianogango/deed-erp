import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  dismissJournalMirrorFailure,
  outstandingMirrorFailures,
  recordJournalMirrorFailure,
  clearJournalMirrorFailure,
  type JournalMirrorFailureMap,
} from '@/lib/accounting/journal-mirror-failures'

/** An aborted POS ticket: zero amount, one line, can never satisfy the validator. */
const unpostable = (ref: string): JournalMirrorFailureMap =>
  recordJournalMirrorFailure(
    {},
    { ref, source: 'pos', date: '2026-09-17', lines: [] },
    new Error(`Journal ${ref} must contain at least two lines`),
  )

describe('dismissing a journal that can never post', () => {
  it('takes it out of the backlog the gate counts', () => {
    // JRN/POS/0108 and JRN/POS/0083 had each failed 38 times for this reason.
    // Retrying cannot help, so without a dismissal they would have failed every
    // month-end from now on over sales that never completed.
    const map = dismissJournalMirrorFailure(unpostable('JRN/POS/0108'), 'JRN/POS/0108', 'user-1', 'Aborted till sale, no lines')
    expect(outstandingMirrorFailures(map)).toEqual([])
  })

  it('keeps the entry, because the record is the point', () => {
    const map = dismissJournalMirrorFailure(unpostable('JRN/POS/0108'), 'JRN/POS/0108', 'user-1', 'Aborted till sale')
    expect(map['JRN/POS/0108']).toMatchObject({
      ref: 'JRN/POS/0108',
      attempts: 1,
      dismissedBy: 'user-1',
      dismissReason: 'Aborted till sale',
    })
    expect(map['JRN/POS/0108'].dismissedAt).toBeTruthy()
  })

  it('leaves a live failure counted', () => {
    let map = unpostable('JRN/POS/0108')
    map = recordJournalMirrorFailure(map, { ref: 'JRN/INV/2026/0300', source: 'invoice', date: '2026-09-20', lines: [] }, new Error('Account 4000 is inactive'))
    map = dismissJournalMirrorFailure(map, 'JRN/POS/0108', null, 'Aborted till sale')
    expect(outstandingMirrorFailures(map).map(f => f.ref)).toEqual(['JRN/INV/2026/0300'])
  })

  it('does nothing for a ref that is not on file', () => {
    const map = unpostable('JRN/POS/0108')
    expect(dismissJournalMirrorFailure(map, 'JRN/POS/9999', null, 'whatever')).toBe(map)
  })

  it('still lets a later success clear the entry outright', () => {
    // Dismissal is not a tombstone: if the underlying journal is ever fixed and
    // mirrors, the normal clear path removes it as it always did.
    let map = dismissJournalMirrorFailure(unpostable('JRN/POS/0108'), 'JRN/POS/0108', null, 'Aborted')
    map = clearJournalMirrorFailure(map, 'JRN/POS/0108')
    expect(map['JRN/POS/0108']).toBeUndefined()
  })

  it('counts a re-recorded failure again if it starts failing anew', () => {
    // A dismissal reflects a judgement about one refusal. If the mirror refuses
    // the same ref later for a different reason, that is news.
    let map = dismissJournalMirrorFailure(unpostable('JRN/POS/0108'), 'JRN/POS/0108', null, 'Aborted')
    map = recordJournalMirrorFailure(map, { ref: 'JRN/POS/0108', source: 'pos', date: '2026-09-17', lines: [] }, new Error('Account 4000 is inactive'))
    expect(map['JRN/POS/0108'].dismissedAt).toBeUndefined()
    expect(outstandingMirrorFailures(map).map(f => f.ref)).toEqual(['JRN/POS/0108'])
    expect(map['JRN/POS/0108'].attempts).toBe(2)
  })
})
