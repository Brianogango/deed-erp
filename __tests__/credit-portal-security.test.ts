import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/credit/credit-facility.server', () => {
  class CreditFacilityError extends Error {
    constructor(message: string, public status = 400) { super(message) }
  }
  return { CreditFacilityError }
})

import { NextRequest } from 'next/server'
import { sanitizeClientForm } from '@/lib/credit/credit-form-fields'
import { clientIp, portalHandler, resetBadLinks } from '@/lib/credit/portal-guard.server'

const req = (xff: string) => new NextRequest('http://localhost/api/portal/credit/x', { headers: { 'x-forwarded-for': xff } })

describe('sanitizeClientForm', () => {
  it('keeps only the form\'s own fields', () => {
    const out = sanitizeClientForm({ registeredName: 'Acme', isAdmin: true, __proto__x: 1, status: 'approved' })
    expect(out).toEqual({ registeredName: 'Acme' })
  })

  it('strips HTML brackets and control characters, and caps length', () => {
    const out = sanitizeClientForm({ registeredName: '<script>alert(1)</script>\u0000x', physicalAddress: 'a'.repeat(5000), representativeName: 'Jane\nDoe' })
    expect(out.registeredName).toBe('scriptalert(1)/scriptx')
    expect((out.physicalAddress as string).length).toBe(300)
    expect(out.representativeName).toBe('JaneDoe')
  })

  it('caps rows per list and drops unknown row fields', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ fullName: `D${i}`, salary: 1 }))
    const out = sanitizeClientForm({ directors: rows })
    expect((out.directors as unknown[]).length).toBe(6)
    expect((out.directors as any[])[0]).toEqual({ fullName: 'D0' })
  })

  it('takes only listed choices and real booleans', () => {
    expect(sanitizeClientForm({ businessType: 'evil' }).businessType).toBeUndefined()
    expect(sanitizeClientForm({ businessType: 'partnership' }).businessType).toBe('partnership')
    expect(sanitizeClientForm({ declarationAccepted: 'yes' }).declarationAccepted).toBeUndefined()
    expect(sanitizeClientForm({ declarationAccepted: true }).declarationAccepted).toBe(true)
    // Office-use fields are staff-only: the client's link can never set them.
    const out = sanitizeClientForm({ officeAccountNo: 'X1', salesManagerApproval: 'approved', officeRemarks: 'ok' })
    expect(out).toEqual({})
  })
})

describe('credit link guard', () => {
  beforeEach(() => resetBadLinks())

  it('uses the address Nginx added, not one the visitor made up', () => {
    expect(clientIp(req('6.6.6.6, 41.90.1.2'))).toBe('41.90.1.2')
  })

  
  it('limits one link however many addresses use it', async () => {
    const ok = async () => new Response('ok')
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) statuses.push((await portalHandler(req(`41.91.0.${i}`), 'submit-test', 2, ok, 'tok-abcdefghijklmnopqrst')).status)
    expect(statuses).toEqual([200, 200, 200, 200, 429])
  })
})
