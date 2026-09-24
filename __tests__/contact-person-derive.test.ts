import { describe, expect, it } from 'vitest'
import {
  contactFromPersonInput,
  deriveContactPersons,
  splitContactName,
} from '@/lib/contact-person-derive'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const PERSON = '22222222-2222-4222-8222-222222222222'

const company = { id: COMPANY, type: 'company', name: 'DIB Kenya Limited' }
const laban = {
  id: PERSON,
  type: 'individual',
  name: 'Mr Laban Gathingi',
  companyId: COMPANY,
  jobTitle: 'Head of ICT',
  email: 'Laban.Gathingi@dibkenya.co.ke',
  phone: '+254 722 445259',
}

describe('deriveContactPersons', () => {
  it('finds the person the company detail panel was showing zero of', () => {
    // The whole bug: the form wrote contact_persons, the panel read the
    // directory, and the directory had no employer column to read.
    const people = deriveContactPersons([company, laban], () => 'DIB Kenya Limited')
    expect(people).toHaveLength(1)
    expect(people[0]).toMatchObject({
      id: PERSON,
      clientId: COMPANY,
      companyId: COMPANY,
      fullName: 'Mr Laban Gathingi',
      jobTitle: 'Head of ICT',
      companyName: 'DIB Kenya Limited',
    })
  })

  it('keeps the contact id, so opportunity links still resolve', () => {
    expect(deriveContactPersons([laban])[0].id).toBe(PERSON)
  })

  it('ignores companies, unemployed individuals and archived people', () => {
    expect(deriveContactPersons([company])).toHaveLength(0)
    expect(deriveContactPersons([{ ...laban, companyId: undefined }])).toHaveLength(0)
    expect(deriveContactPersons([{ ...laban, isArchived: true }])).toHaveLength(0)
  })

  it('supplies the first/last split the CRM pickers render', () => {
    const [person] = deriveContactPersons([laban])
    expect(`${person.firstName} ${person.lastName}`).toBe('Mr Laban Gathingi')
  })
})

describe('splitContactName', () => {
  it('keeps a single-name person intact', () => {
    expect(splitContactName('Mary')).toEqual({ firstName: 'Mary', lastName: '' })
  })

  it('does not drop a middle name', () => {
    expect(splitContactName('Jean Paul Mwangi')).toEqual({ firstName: 'Jean', lastName: 'Paul Mwangi' })
  })

  it('handles empty and whitespace names', () => {
    expect(splitContactName('')).toEqual({ firstName: '', lastName: '' })
    expect(splitContactName('   ')).toEqual({ firstName: '', lastName: '' })
  })
})

describe('contactFromPersonInput', () => {
  it('saves a contact person as an individual contact with an employer', () => {
    expect(contactFromPersonInput({
      id: PERSON,
      companyId: COMPANY,
      firstName: 'Mr Laban',
      lastName: 'Gathingi',
      jobTitle: 'Head of ICT',
      email: 'laban@dibkenya.co.ke',
      phone: '0722445259',
    })).toMatchObject({
      id: PERSON,
      type: 'individual',
      name: 'Mr Laban Gathingi',
      companyId: COMPANY,
      jobTitle: 'Head of ICT',
    })
  })

  it('round-trips back through the derivation unchanged', () => {
    const saved = contactFromPersonInput({
      id: PERSON, companyId: COMPANY, fullName: 'Mary', jobTitle: 'Director',
    })
    const [person] = deriveContactPersons([saved as Record<string, unknown>])
    expect(person).toMatchObject({ id: PERSON, fullName: 'Mary', jobTitle: 'Director', clientId: COMPANY })
  })

  it('drops a blank job title rather than storing an empty string', () => {
    expect(contactFromPersonInput({ companyId: COMPANY, fullName: 'Mary', jobTitle: '   ' }).jobTitle)
      .toBeUndefined()
  })
})
