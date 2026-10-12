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
import { BAD_LINK_LIMIT, clientIp, portalHandler, resetBadLinks } from '@/lib/credit/portal-guard.server'
import { CreditFacilityError } from '@/lib/credit/credit-facility.server'

const req = (xff: string) => new NextRequest('http://localhost/api/portal/credit/x', { headers: { 'x-forwarded-for': xff } })

describe('sanitizeClientForm', () => {
  it('keeps only the form\'s own fields', () => {
    const out = sanitizeClientForm({ registeredName: 'Acme', isAdmin: true, __proto__x: 1, status: 'approved' })
    expect(out).toEqual({ registeredName: 'Acme' })
  })

  it('strips HTML brackets and control characters, and caps length', () => {
    const out = sanitizeClientForm({ tradingName: '<script>alert(1)</script>\u0000x', natureOfBusiness: 'line 1\nline 2', city: 'a'.repeat(5000) })
    expect(out.tradingName).toBe('scriptalert(1)/scriptx')
    expect(out.natureOfBusiness).toBe('line 1\nline 2')
    expect((out.city as string).length).toBe(300)
  })

  it('caps rows per list and drops unknown row fields', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ fullName: `D${i}`, salary: 1 }))
    const out = sanitizeClientForm({ directors: rows })
    expect((out.directors as unknown[]).length).toBe(10)
    expect((out.directors as any[])[0]).toEqual({ fullName: 'D0' })
  })

  it('takes only listed choices and real booleans', () => {
    const out = sanitizeClientForm({
      businessType: 'evil', paymentMethods: ['cheque', 'crypto', 'cheque'], policyAccepted: 'yes', declarationAccepted: true,
      stakeholders: { managingDirector: { name: 'Jane', ssn: '1' }, hacker: { name: 'x' } },
    })
    expect(out.businessType).toBeUndefined()
    expect(out.paymentMethods).toEqual(['cheque'])
    expect(out.policyAccepted).toBeUndefined()
    expect(out.declarationAccepted).toBe(true)
    expect(out.stakeholders).toEqual({ managingDirector: { name: 'Jane' } })
  })
})

describe('credit link guard', () => {
  beforeEach(() => resetBadLinks())

  it('uses the address Nginx added, not one the visitor made up', () => {
    expect(clientIp(req('6.6.6.6, 41.90.1.2'))).toBe('41.90.1.2')
  })

  it('shuts an address out after repeated wrong links', async () => {
    const wrong = () => portalHandler(req('41.90.9.9'), 'read', 1000, async () => { throw new CreditFacilityError('This link is not valid', 404) })
    for (let i = 0; i < BAD_LINK_LIMIT; i++) expect((await wrong()).status).toBe(404)
    const blocked = await portalHandler(req('41.90.9.9'), 'read', 1000, async () => new Response('ok'))
    expect(blocked.status).toBe(429)
    // Other addresses are unaffected; a fake first address does not help.
    expect((await portalHandler(req('41.90.9.9, 41.90.1.3'), 'read', 1000, async () => new Response('ok'))).status).toBe(200)
    expect((await portalHandler(req('1.1.1.1, 41.90.9.9'), 'read', 1000, async () => new Response('ok'))).status).toBe(429)
  })

  it('limits one link however many addresses use it', async () => {
    const ok = async () => new Response('ok')
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) statuses.push((await portalHandler(req(`41.91.0.${i}`), 'submit-test', 2, ok, 'tok-abcdefghijklmnopqrst')).status)
    expect(statuses).toEqual([200, 200, 200, 200, 429])
  })
})
