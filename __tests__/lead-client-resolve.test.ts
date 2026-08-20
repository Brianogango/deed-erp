import { describe, expect, it, vi } from 'vitest'
import { findExistingClientForLead, findExistingContactPerson } from '@/lib/crm/lead-client-resolve'

function prismaWithClients(rows: any[]) {
  return {
    client: {
      findUnique: vi.fn(async (args: any) => rows.find(r => r.id === args.where.id) ?? null),
      findFirst: vi.fn(async (args: any) => {
        const where = args.where || {}
        return rows.find(r => {
          if (where.id?.not && r.id === where.id.not) return false
          if (where.isActive && r.isActive === false) return false
          if (where.email?.equals) {
            return String(r.email || '').toLowerCase() === String(where.email.equals).toLowerCase()
          }
          if (where.OR?.some((c: any) => c.phone?.contains)) {
            const needle = where.OR[0].phone.contains
            return String(r.phone || '').includes(needle) || String(r.phoneAlt || '').includes(needle)
          }
          if (where.OR?.some((c: any) => c.name?.equals)) {
            const name = String(where.OR[0].name.equals).toLowerCase()
            return String(r.name || '').toLowerCase() === name
              || String(r.companyName || '').toLowerCase() === name
          }
          if (where.OR?.some((c: any) => c.email?.endsWith)) {
            const suffix = String(where.OR.find((c: any) => c.email?.endsWith).email.endsWith).toLowerCase()
            return String(r.email || '').toLowerCase().endsWith(suffix)
          }
          return false
        }) ?? null
      }),
    },
    contactPerson: {
      findFirst: vi.fn(async (args: any) => {
        const people = rows[0]?.people || []
        const where = args.where || {}
        return people.find((p: any) => {
          if (p.clientId !== where.clientId) return false
          if (where.email?.equals) return String(p.email || '').toLowerCase() === String(where.email.equals).toLowerCase()
          if (where.phone) return p.phone === where.phone
          return false
        }) ?? null
      }),
    },
  }
}

describe('findExistingClientForLead', () => {
  it('reuses a customer with the same email instead of creating another', async () => {
    const prisma = prismaWithClients([
      { id: 'c1', name: 'Acme Ltd', email: 'info@acme.co.ke', phone: null, isActive: true },
    ])
    const match = await findExistingClientForLead(prisma, {
      name: 'Need 10 laptops',
      email: 'info@acme.co.ke',
    })
    expect(match?.id).toBe('c1')
  })

  it('reuses a company by corporate email domain', async () => {
    const prisma = prismaWithClients([
      { id: 'c1', name: 'Kijabe Hospital', email: 'accounts@kijabehospital.org', isActive: true },
    ])
    const match = await findExistingClientForLead(prisma, {
      name: 'Jane Procurement',
      email: 'procurement@kijabehospital.org',
    })
    expect(match?.id).toBe('c1')
  })

  it('does not domain-match gmail senders', async () => {
    const prisma = prismaWithClients([
      { id: 'c1', name: 'Jane', email: 'jane.other@gmail.com', isActive: true },
    ])
    const match = await findExistingClientForLead(prisma, {
      name: 'Jane Doe',
      email: 'jane.doe@gmail.com',
    })
    expect(match).toBeNull()
  })

  it('reuses a customer with the same company name', async () => {
    const prisma = prismaWithClients([
      { id: 'c1', name: 'Safaricom', companyName: 'Safaricom', email: 'a@safaricom.co.ke', isActive: true },
    ])
    const match = await findExistingClientForLead(prisma, {
      name: 'RFQ for 20 laptops',
      companyName: 'Safaricom',
      email: 'buyer@other.co.ke',
    })
    expect(match?.id).toBe('c1')
  })

  it('skips the current row when excludeId is set', async () => {
    const prisma = prismaWithClients([
      { id: 'dup', name: 'Need 10 laptops RFQ', email: 'info@acme.co.ke', isActive: true },
      { id: 'c1', name: 'Acme Ltd', email: 'info@acme.co.ke', isActive: true },
    ])
    const match = await findExistingClientForLead(prisma, {
      name: 'Need 10 laptops RFQ',
      email: 'info@acme.co.ke',
    }, { excludeId: 'dup' })
    expect(match?.id).toBe('c1')
  })
})

describe('findExistingContactPerson', () => {
  it('reuses a person with the same email on that customer', async () => {
    const prisma = prismaWithClients([
      {
        people: [
          { id: 'p1', clientId: 'c1', email: 'jane@acme.co.ke', phone: null },
        ],
      },
    ])
    const match = await findExistingContactPerson(prisma, {
      clientId: 'c1',
      email: 'Jane@acme.co.ke',
    })
    expect(match?.id).toBe('p1')
  })
})
