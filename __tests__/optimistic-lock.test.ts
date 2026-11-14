import { describe, it, expect } from 'vitest'
import { readLockVersionFromResponse } from '@/lib/optimistic-lock'
import { nextJournalSourceVersion } from '@/lib/accounting/ids'

describe('readLockVersionFromResponse', () => {
  it('reads a numeric lockVersion from a PUT success body', () => {
    expect(readLockVersionFromResponse({ id: 'inv-1', lockVersion: 2, status: 'draft' })).toBe(2)
  })

  it('reads lockVersion from a 409 conflict body', () => {
    expect(readLockVersionFromResponse({
      error: 'Record was modified by another user',
      lockVersion: 1,
    })).toBe(1)
  })

  it('ignores missing or non-numeric versions', () => {
    expect(readLockVersionFromResponse(null)).toBeUndefined()
    expect(readLockVersionFromResponse({})).toBeUndefined()
    expect(readLockVersionFromResponse({ lockVersion: 'nope' })).toBeUndefined()
  })
})


describe('nextJournalSourceVersion', () => {
  it('starts at 1 when nothing has been posted', () => {
    expect(nextJournalSourceVersion(null)).toBe(1)
    expect(nextJournalSourceVersion(undefined)).toBe(1)
    expect(nextJournalSourceVersion(0)).toBe(1)
  })

  it('increments after Reset to Draft so the re-post does not collide', () => {
    expect(nextJournalSourceVersion(1)).toBe(2)
    expect(nextJournalSourceVersion(2)).toBe(3)
  })
})
