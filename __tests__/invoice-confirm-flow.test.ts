import { describe, expect, it } from 'vitest'
import { lockVersionMismatch, readExpectedVersion } from '@/lib/optimistic-lock'
import { invoicePersistBody } from '@/lib/invoice-persist'

describe('invoice confirm after edit', () => {
  it('Confirm PUT without lockVersion never mismatches the post-edit row', () => {
    const localInvoice = { status: 'posted', lockVersion: 0, lines: [{ qty: 1 }] }
    const body = invoicePersistBody(localInvoice)
    expect(readExpectedVersion(body as Record<string, unknown>)).toBeUndefined()
    expect(lockVersionMismatch(2, readExpectedVersion(body as Record<string, unknown>))).toBe(false)
  })

  it('stale lockVersion still mismatches when provided', () => {
    expect(lockVersionMismatch(2, 0)).toBe(true)
    expect(lockVersionMismatch(2, 2)).toBe(false)
  })
})
