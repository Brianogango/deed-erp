import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server-store', () => ({ loadAppState: vi.fn(), notifyStoreKeysChanged: vi.fn() }))

import { loadScreenContacts } from '@/lib/contact-prisma'

const client = (over: Record<string, unknown> = {}) => ({
  id: 'c-1', name: 'Acme Ltd', clientType: 'company', email: 'a@acme.test', phone: '0700', loyaltyPoints: 12,
  createdAt: new Date('2026-10-01'), ...over,
})

describe('contacts for the screens, read from the clients table', () => {
  it('maps table rows and keeps contacts only the frozen copy has', async () => {
    const prisma = { client: { findMany: vi.fn(async () => [client()]) } } as any
    const list = await loadScreenContacts(prisma, [
      { id: 'c-1', name: 'Old name', loyaltyPoints: 0 },
      { id: 'local-9', name: 'Only in copy' },
    ])
    expect(list.map(c => c.id)).toEqual(['c-1', 'local-9'])
    expect(list[0]).toMatchObject({ name: 'Acme Ltd', loyaltyPoints: 12, email: 'a@acme.test' })
  })
})
