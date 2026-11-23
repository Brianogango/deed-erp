import { describe, it, expect } from 'vitest'
import { blanksToFill, relinkContact } from '@/lib/contacts/merge-core'

const A = '11111111-1111-4111-8111-111111111111' // stays
const B = '22222222-2222-4222-8222-222222222222' // duplicate

describe('relinkContact', () => {
  it('moves every id field that names the duplicate, and its name beside it', () => {
    const invoices = [
      { id: 'i1', ref: 'INV/1', customerId: B, customerName: 'Acme Ltd ', lines: [{ partnerId: B }] },
      { id: 'i2', ref: 'INV/2', customerId: 'other', customerName: 'Other' },
      { id: B, note: 'an id field named "id" is left alone' },
    ]
    const { value, count } = relinkContact(invoices, B, A, { merged: 'acme  ltd', survivor: 'ACME Limited' })
    expect(count).toBe(2)
    expect(value[0]).toMatchObject({ customerId: A, customerName: 'ACME Limited', lines: [{ partnerId: A }] })
    expect(value[1]).toBe(invoices[1])
    expect(value[2].id).toBe(B)
  })

  it('keeps a different name the document carried (e.g. a contact person)', () => {
    const { value } = relinkContact([{ customerId: B, customerName: 'Jane at Acme' }], B, A, { merged: 'Acme Ltd', survivor: 'ACME Limited' })
    expect(value[0]).toEqual({ customerId: A, customerName: 'Jane at Acme' })
  })

  it('handles snake_case ids and id lists without duplicates', () => {
    const { value, count } = relinkContact({ client_id: B, client_name: 'Acme Ltd', contactIds: [B, A, 'x'] }, B, A, { merged: 'Acme Ltd', survivor: 'ACME' })
    expect(count).toBe(2)
    expect(value).toEqual({ client_id: A, client_name: 'ACME', contactIds: [A, 'x'] })
  })

  it('returns the same object when nothing names the duplicate', () => {
    const data = [{ customerId: A }]
    const r = relinkContact(data, B, A)
    expect(r.count).toBe(0)
    expect(r.value).toBe(data)
  })

  it('does not touch values that merely contain the id or sit in non-id fields', () => {
    const data = [{ notes: `see ${B}`, reference: B }]
    expect(relinkContact(data, B, A).count).toBe(0)
  })
})

describe('blanksToFill', () => {
  it('takes only what the survivor is missing', () => {
    expect(blanksToFill({ email: 'a@x.co', phone: '' }, { email: 'b@x.co', phone: '0712', vatNumber: 'P051' }))
      .toEqual({ phone: '0712', vatNumber: 'P051' })
  })
})
