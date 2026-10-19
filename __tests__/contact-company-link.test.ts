import { describe, expect, it, vi } from 'vitest'
import { updateContactById } from '@/lib/contact-prisma'

vi.mock('@/lib/server-store', () => ({
  loadAppState: vi.fn().mockResolvedValue({}),
  saveStoreKeys: vi.fn().mockResolvedValue(undefined),
  notifyStoreKeysChanged: vi.fn().mockResolvedValue(undefined),
}))

const COMPANY = '796d86a7-cbc4-46af-90f4-ef6a0d5b5ddc'
const OTHER = '7274fb0f-27c9-4b7e-85ab-2830bd1b47a0'

function prismaFor(companyId: string | null) {
  const row = {
    id: 'fc97dd54-5f50-4008-9a19-7096ab4bc962', clientNumber: 'CLT-1', name: 'Jane Doe', clientType: 'individual',
    companyId, jobTitle: null, email: 'jane@example.com', phone: '0700000001', country: 'Kenya',
    isCustomer: true, isVendor: false, tags: [], creditLimit: 0, paymentTermsDays: 0, isActive: true, createdAt: new Date('2026-01-01'),
  }
  const update = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }))
  return { row, update, prisma: { client: { findUnique: vi.fn().mockResolvedValue(row), update, findMany: vi.fn().mockResolvedValue([]) } } }
}

describe('linking a person to a company', () => {
  it('saves the chosen company (it used to be dropped for every real id)', async () => {
    const { prisma, row, update } = prismaFor(null)
    const out = await updateContactById(prisma as never, row.id, { companyId: COMPANY })
    expect(update.mock.calls[0][0].data.companyId).toBe(COMPANY)
    expect(typeof out === 'object' && out?.companyId).toBe(COMPANY)
  })

  it('moves a person to another company', async () => {
    const { prisma, row, update } = prismaFor(COMPANY)
    await updateContactById(prisma as never, row.id, { companyId: OTHER })
    expect(update.mock.calls[0][0].data.companyId).toBe(OTHER)
  })

  it('keeps the company when the save does not mention it', async () => {
    const { prisma, row, update } = prismaFor(COMPANY)
    await updateContactById(prisma as never, row.id, { jobTitle: 'IT Manager' })
    expect(update.mock.calls[0][0].data.companyId).toBe(COMPANY)
  })

  it('unlinks when "No company" is chosen', async () => {
    const { prisma, row, update } = prismaFor(COMPANY)
    await updateContactById(prisma as never, row.id, { companyId: '' })
    expect(update.mock.calls[0][0].data.companyId).toBeNull()
  })

  it('ignores a value that is not an id', async () => {
    const { prisma, row, update } = prismaFor(COMPANY)
    await updateContactById(prisma as never, row.id, { companyId: 'c-legacy-1' })
    expect(update.mock.calls[0][0].data.companyId).toBe(COMPANY)
  })
})
