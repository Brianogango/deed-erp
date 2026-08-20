import { describe, expect, it } from 'vitest'
import { clip, leadCustomerDisplayName, looksLikeEnquiryTitle, salesQuoteHref, splitContactName } from '@/lib/crm/lead-convert'

describe('lead-convert helpers', () => {
  it('clips oversized contact fields that caused LengthMismatch on convert', () => {
    const long = 'K-elec — 1 × External portable disc 2TB (DW or Sandisk SSD) upto 1050MBS/s, USB-C, USB 3.2Gen 2'
    const { firstName, lastName } = splitContactName(long)
    expect(firstName.length).toBeLessThanOrEqual(80)
    expect(lastName.length).toBeLessThanOrEqual(80)
    expect(firstName).toBe('K-elec')
    expect(clip('+254726719882', 20)).toBe('+254726719882')
    expect(clip('x'.repeat(40), 20)?.length).toBe(20)
  })

  it('builds a Sales new-quotation deep link', () => {
    expect(salesQuoteHref({
      customerId: 'cust-1',
      customerName: 'Acme',
      opportunityId: 'opp-9',
    })).toBe('/sales?new=1&customerId=cust-1&customerName=Acme&opportunityId=opp-9')
  })

  it('does not use an inbound RFQ subject as the customer name', () => {
    expect(looksLikeEnquiryTitle('K-elec — 1 × External portable disc 2TB')).toBe(true)
    expect(leadCustomerDisplayName({
      name: 'K-elec — 1 × External portable disc 2TB (DW or Sandisk SSD)',
      companyName: 'Kijabe Hospital',
      email: 'procurement@kijabehospital.org',
    })).toBe('Kijabe Hospital')
    expect(leadCustomerDisplayName({
      name: 'Need 10 laptops RFQ',
      email: 'jane.doe@acme.co.ke',
    })).toBe('Jane Doe')
    expect(leadCustomerDisplayName({
      name: 'Jane Doe',
      email: 'jane@gmail.com',
    })).toBe('Jane Doe')
  })
})
