import { describe, expect, it, vi } from 'vitest'
import { updateContactById } from '@/lib/contact-prisma'

vi.mock('@/lib/server-store', () => ({
  loadAppState: vi.fn().mockResolvedValue({}),
  saveStoreKeys: vi.fn().mockResolvedValue(undefined),
}))

function clientRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    clientNumber: 'CLT-1',
    name: 'Jane Doe',
    clientType: 'individual',
    companyName: null,
    registrationNumber: null,
    kraPin: null,
    idNumber: null,
    email: 'jane@example.com',
    phone: '+254700000001',
    phoneAlt: null,
    website: null,
    addressLine1: 'Nairobi',
    addressLine2: null,
    city: 'Nairobi',
    country: 'Kenya',
    isCustomer: true,
    isVendor: false,
    industry: null,
    tags: [],
    creditLimit: 0,
    paymentTermsDays: 0,
    bankName: null,
    bankAccount: null,
    bankBranch: null,
    notes: null,
    vendorRating: 0,
    loyaltyPoints: 0,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  }
}

describe('updateContactById — type correction', () => {
  it('converts an individual to a company without losing name or email', async () => {
    const existing = clientRow()
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...existing,
          ...data,
        })),
        findMany: vi.fn().mockResolvedValue([]),
      },
    }

    const updated = await updateContactById(prisma as any, existing.id, {
      type: 'company',
      name: 'Jane Doe Ltd',
      email: 'jane@example.com',
      phone: '+254700000001',
    })

    expect(updated).not.toBeNull()
    expect(typeof updated).not.toBe('string')
    expect((updated as { type: string }).type).toBe('company')
    expect((updated as { name: string }).name).toBe('Jane Doe Ltd')
    expect((updated as { email: string }).email).toBe('jane@example.com')
    expect(prisma.client.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clientType: 'company', name: 'Jane Doe Ltd' }),
    }))
  })

  it('converts a company to an individual', async () => {
    const existing = clientRow({ clientType: 'company', name: 'Acme Ltd', companyName: 'Acme' })
    const prisma = {
      client: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...existing,
          ...data,
        })),
        findMany: vi.fn().mockResolvedValue([]),
      },
    }

    const updated = await updateContactById(prisma as any, existing.id, {
      type: 'individual',
      name: 'Acme Ltd',
    })

    expect((updated as { type: string }).type).toBe('individual')
    expect(prisma.client.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clientType: 'individual' }),
    }))
  })
})
