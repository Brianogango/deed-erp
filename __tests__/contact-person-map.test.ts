import { describe, expect, it } from 'vitest'
import {
  CONTACT_PERSON_SELECT,
  contactPersonFromDb,
  contactPersonToDb,
} from '@/lib/contact-person-map'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const PERSON = '22222222-2222-4222-8222-222222222222'

describe('contactPersonToDb', () => {
  it('keeps the id the browser minted', () => {
    // Without this the database issued its own id, the record changed identity
    // on the next broadcast, and every later edit addressed a missing row.
    const data = contactPersonToDb({ id: PERSON, clientId: CLIENT, firstName: 'Ann', lastName: 'Mwangi' }, { includeId: true })
    expect(data).toMatchObject({ id: PERSON })
  })

  it('ignores a non-uuid id rather than passing it to a uuid column', () => {
    const data = contactPersonToDb({ id: 'cp_123', clientId: CLIENT, firstName: 'Ann', lastName: 'Mwangi' }, { includeId: true })
    expect(data).not.toHaveProperty('id')
  })

  it('maps jobTitle to the position column', () => {
    const data = contactPersonToDb({ clientId: CLIENT, firstName: 'Ann', lastName: 'Mwangi', jobTitle: 'IT Manager' })
    expect(data).toMatchObject({ position: 'IT Manager' })
  })

  it('refuses a contact person with no saved company', () => {
    expect(contactPersonToDb({ clientId: '', firstName: 'Ann', lastName: 'Mwangi' })).toMatch(/saved company/i)
    expect(contactPersonToDb({ firstName: 'Ann', lastName: 'Mwangi' })).toMatch(/saved company/i)
  })

  it('requires both names on a full write', () => {
    expect(contactPersonToDb({ clientId: CLIENT, firstName: '', lastName: 'Mwangi' })).toMatch(/first name/i)
    expect(contactPersonToDb({ clientId: CLIENT, firstName: 'Ann', lastName: '  ' })).toMatch(/last name/i)
  })

  it('clamps to the column widths instead of overflowing', () => {
    const data = contactPersonToDb({
      clientId: CLIENT,
      firstName: 'A'.repeat(200),
      lastName: 'B'.repeat(200),
      phone: '+254 712 345 678 ext 4455 / +254 700 000 000',
      jobTitle: 'C'.repeat(300),
    }) as Record<string, string>
    expect(data.firstName).toHaveLength(80)
    expect(data.lastName).toHaveLength(80)
    expect(data.phone.length).toBeLessThanOrEqual(40)
    expect(data.position).toHaveLength(100)
  })

  it('only touches the keys a partial edit sent', () => {
    const data = contactPersonToDb({ email: 'ann@example.com' }, { partial: true })
    expect(Object.keys(data as object)).toEqual(['email'])
  })

  it('keeps an unrecognised preferred channel out of the column', () => {
    expect(contactPersonToDb({ clientId: CLIENT, firstName: 'A', lastName: 'B', preferredChannel: 'carrier-pigeon' }))
      .toMatchObject({ preferredChannel: null })
    expect(contactPersonToDb({ clientId: CLIENT, firstName: 'A', lastName: 'B', preferredChannel: 'WhatsApp' }))
      .toMatchObject({ preferredChannel: 'whatsapp' })
  })
})

describe('contactPersonFromDb', () => {
  const row = {
    id: PERSON,
    clientId: CLIENT,
    firstName: 'Ann',
    lastName: 'Mwangi',
    email: 'ann@example.com',
    phone: '0712345678',
    mobile: '0700000000',
    position: 'IT Manager',
    department: 'ICT',
    linkedIn: 'in/annmwangi',
    isPrimary: true,
    isDecisionMaker: true,
    isTechnicalContact: false,
    isBillingContact: false,
    preferredChannel: 'email',
    notes: null,
    createdAt: new Date('2026-09-01T09:00:00Z'),
    client: { id: CLIENT, name: 'Centric Limited', companyName: 'Centric Ltd' },
  }

  it('restores jobTitle, which the UI reads everywhere', () => {
    // The round-trip used to lose this: written as position, never mapped
    // back, so every contact person came back with no job title.
    expect(contactPersonFromDb(row).jobTitle).toBe('IT Manager')
  })

  it('carries the fields that used to be dropped entirely', () => {
    expect(contactPersonFromDb(row)).toMatchObject({
      mobile: '0700000000',
      department: 'ICT',
      linkedIn: 'in/annmwangi',
      isPrimary: true,
      isDecisionMaker: true,
      preferredChannel: 'email',
    })
  })

  it('derives fullName, companyId and companyName', () => {
    expect(contactPersonFromDb(row)).toMatchObject({
      fullName: 'Ann Mwangi',
      companyId: CLIENT,
      companyName: 'Centric Ltd',
    })
  })

  it('survives a round trip without losing a field', () => {
    const app = contactPersonFromDb(row)
    const back = contactPersonToDb(app as Record<string, any>, { includeId: true }) as Record<string, unknown>
    expect(back).toMatchObject({
      id: PERSON,
      clientId: CLIENT,
      firstName: 'Ann',
      lastName: 'Mwangi',
      position: 'IT Manager',
      department: 'ICT',
      mobile: '0700000000',
      linkedIn: 'in/annmwangi',
      isPrimary: true,
      isDecisionMaker: true,
      isTechnicalContact: false,
      isBillingContact: false,
      preferredChannel: 'email',
    })
  })
})

describe('CONTACT_PERSON_SELECT', () => {
  it('does not pull the whole client row into the broadcast', () => {
    expect(CONTACT_PERSON_SELECT.client).toEqual({
      select: { id: true, name: true, companyName: true },
    })
  })
})
