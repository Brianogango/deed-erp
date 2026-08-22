import { describe, expect, it } from 'vitest'
import { customerPickerItems } from '@/lib/contact-search'

describe('customerPickerItems', () => {
  it('drops archived contacts and non-customers', () => {
    const items = customerPickerItems([
      { id: '1', name: 'Kelvin Mwangi', isCustomer: true },
      { id: '2', name: 'Archived Buyer', isCustomer: true, isArchived: true },
      { id: '3', name: 'Vendor Only', isCustomer: false },
    ])
    expect(items.map(item => item.name)).toEqual(['Kelvin Mwangi'])
  })

  it('keeps phone, email, and mobile so POS search can match them', () => {
    const items = customerPickerItems([
      {
        id: '1',
        name: 'Kelvin Mwangi',
        phone: '0712345678',
        email: 'kelvin@example.com',
        mobile: '0722000000',
        isCustomer: true,
      },
    ])
    expect(items[0]).toMatchObject({
      phone: '0712345678',
      email: 'kelvin@example.com',
      mobile: '0722000000',
    })
  })
})
