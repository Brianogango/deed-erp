import { describe, it, expect } from 'vitest'
import {
  lockVersionMismatch,
  omitLockVersion,
  readExpectedVersion,
  readLockVersionFromResponse,
} from '@/lib/optimistic-lock'
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

describe('omitLockVersion', () => {
  it('drops a stale client lockVersion so Align can rewrite after Reset to Draft', () => {
    const patched = {
      id: 'inv-1',
      status: 'draft',
      lockVersion: 0,
      total: 4500,
      lines: [{ qty: 1, unitPrice: 4000 }, { qty: 1, unitPrice: 500 }],
    }
    const body = omitLockVersion(patched) as Record<string, unknown>
    expect(body).toEqual({
      id: 'inv-1',
      status: 'draft',
      total: 4500,
      lines: [{ qty: 1, unitPrice: 4000 }, { qty: 1, unitPrice: 500 }],
    })
    expect(lockVersionMismatch(1, readExpectedVersion(patched as unknown as Record<string, unknown>))).toBe(true)
    expect(lockVersionMismatch(1, readExpectedVersion(body))).toBe(false)
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
