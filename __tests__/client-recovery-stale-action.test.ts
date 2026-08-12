import { describe, expect, it } from 'vitest'
import { isRecoverableClientError } from '@/lib/client-recovery'

describe('isRecoverableClientError', () => {
  it('detects Next.js stale Server Action mismatches after deploy', () => {
    expect(isRecoverableClientError({
      name: 'Error',
      message: 'Failed to find Server Action "7g". This request might be from an older or newer deployment.',
    })).toBe(true)
  })

  it('detects corrupt localStorage array crashes', () => {
    expect(isRecoverableClientError(new TypeError('deliveryJobs.filter is not a function'))).toBe(true)
  })

  it('does not treat unrelated errors as recoverable', () => {
    expect(isRecoverableClientError(new Error('Fiscal period is locked'))).toBe(false)
  })
})
