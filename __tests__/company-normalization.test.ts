import { describe, it, expect } from 'vitest'
import { normalizeCompanyForClient, normalizeCompaniesForClient } from '@/lib/company-normalization'

// Regression: /api/companies returns raw Prisma `clients` rows without a
// `status` field, which crashed the CRM → Companies tab (Badge called
// status.replace on undefined). The normalizer must guarantee the client
// Company shape regardless of source shape.

const rawPrismaRow = {
  id: '44e7fd42-fc7c-49a0-ac14-b6211ded3bde',
  clientNumber: 'CLT-S4MJ9L3SQ',
  name: 'Bluecom',
  industry: null,
  segment: null,
  tags: [],
  companyName: null,
  clientType: 'company',
  email: 'bluecom@gmail.com',
  phone: '0728504216',
  kraPin: 'A012345678Z',
  addressLine1: 'Moi Avenue',
  addressLine2: null,
  city: null,
  country: 'Kenya',
  creditLimit: '12,000',
  creditBalance: '500',
  isCustomer: false,
  isVendor: true,
  paymentTermsDays: 30,
  createdAt: '2025-01-01T00:00:00.000Z',
}

describe('normalizeCompanyForClient', () => {
  it('fills status from isActive when missing', () => {
    expect(normalizeCompanyForClient(rawPrismaRow).status).toBe('active')
    expect(normalizeCompanyForClient({ ...rawPrismaRow, isActive: false }).status).toBe('inactive')
  })

  it('preserves an already-valid client status', () => {
    expect(normalizeCompanyForClient({ ...rawPrismaRow, status: 'suspended' }).status).toBe('suspended')
  })

  it('maps Prisma fields onto the client Company shape', () => {
    const c = normalizeCompanyForClient(rawPrismaRow)
    expect(c.taxId).toBe('A012345678Z')
    expect(c.physicalAddress).toBe('Moi Avenue')
    expect(c.paymentTerms).toBe(30)
  })

  it('coerces string money fields to finite numbers', () => {
    const c = normalizeCompanyForClient(rawPrismaRow)
    expect(c.creditLimit).toBe(12000)
    expect(c.creditUsed).toBe(500)
    expect(normalizeCompanyForClient({ ...rawPrismaRow, creditLimit: 'oops' }).creditLimit).toBe(0)
  })

  it('is idempotent for rows already in client shape', () => {
    const once = normalizeCompanyForClient(rawPrismaRow)
    const twice = normalizeCompanyForClient(once)
    expect(twice).toEqual(once)
  })

  it('tolerates junk input without throwing', () => {
    expect(normalizeCompaniesForClient(undefined as any)).toEqual([])
    expect(normalizeCompaniesForClient([null, 'x', rawPrismaRow] as any).length).toBe(3)
  })
})
