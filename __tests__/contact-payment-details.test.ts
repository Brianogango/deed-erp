import { describe, it, expect } from 'vitest'
import {
  PAY_BY_LABELS,
  PAY_BY_OPTIONS,
  hasPaymentDetails,
  paymentInstruction,
} from '@/lib/contacts/payment-details'

describe('PAY_BY labels', () => {
  it('derives the label map from the options, so the form and the panel agree', () => {
    expect(Object.keys(PAY_BY_LABELS).sort()).toEqual(['bank', 'mpesa'])
    for (const option of PAY_BY_OPTIONS) {
      expect(PAY_BY_LABELS[option.value]).toBe(option.label)
    }
  })
})

describe('hasPaymentDetails', () => {
  it('is false for a contact with nothing on file', () => {
    expect(hasPaymentDetails({})).toBe(false)
    expect(hasPaymentDetails({ bankName: '', mpesaPaybill: '' })).toBe(false)
  })

  it('is true on any single detail, so the tab survives a half-filled record', () => {
    expect(hasPaymentDetails({ bankName: 'NCBA' })).toBe(true)
    expect(hasPaymentDetails({ bankAccount: '1005157785' })).toBe(true)
    expect(hasPaymentDetails({ bankBranch: 'Eastleigh' })).toBe(true)
    expect(hasPaymentDetails({ mpesaPaybill: '303030' })).toBe(true)
    expect(hasPaymentDetails({ mpesaAccount: 'DEED' })).toBe(true)
  })
})

describe('paymentInstruction', () => {
  const bank = { bankName: 'NCBA Bank Kenya PLC', bankAccount: '1005157785' }
  const paybill = { mpesaPaybill: '303030', mpesaAccount: 'DEED-01' }

  it('says so plainly when there is nothing to pay against', () => {
    expect(paymentInstruction({})).toBe('No payment details on file')
  })

  it('follows payBy when the vendor has stated one', () => {
    expect(paymentInstruction({ ...bank, ...paybill, payBy: 'bank' }))
      .toBe('NCBA Bank Kenya PLC · 1005157785')
    expect(paymentInstruction({ ...bank, ...paybill, payBy: 'mpesa' }))
      .toBe('M-Pesa 303030 · acct DEED-01')
  })

  it('falls back to the rail that has details when the stated one is empty', () => {
    expect(paymentInstruction({ ...bank, payBy: 'mpesa' })).toBe('NCBA Bank Kenya PLC · 1005157785')
    expect(paymentInstruction({ ...paybill, payBy: 'bank' })).toBe('M-Pesa 303030 · acct DEED-01')
  })

  it('prefers M-Pesa when nobody has said which rail', () => {
    expect(paymentInstruction({ ...bank, ...paybill })).toBe('M-Pesa 303030 · acct DEED-01')
  })

  it('leaves the account off a Till number, which does not have one', () => {
    expect(paymentInstruction({ mpesaPaybill: '5204159' })).toBe('M-Pesa 5204159')
  })

  it('still names the account when only the bank name is missing', () => {
    expect(paymentInstruction({ bankAccount: '1005157785' })).toBe('Bank · 1005157785')
  })
})

describe('clientToContact payment columns', () => {
  it('carries the bank and M-Pesa columns onto the contact', async () => {
    const { clientToContact } = await import('@/lib/contact-prisma')
    const contact = clientToContact({
      id: '11111111-1111-4111-8111-111111111111',
      clientType: 'company',
      name: 'Acme Supplies',
      bankName: 'NCBA Bank Kenya PLC',
      bankAccount: '1005157785',
      bankBranch: 'Eastleigh',
      mpesaPaybill: '303030',
      mpesaAccount: 'DEED-01',
      payBy: 'mpesa',
      tags: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    expect(contact.bankAccount).toBe('1005157785')
    expect(contact.mpesaPaybill).toBe('303030')
    expect(contact.mpesaAccount).toBe('DEED-01')
    expect(contact.payBy).toBe('mpesa')
  })

  it('reads an unrecognised pay_by as not set rather than printing it at the reader', async () => {
    const { clientToContact } = await import('@/lib/contact-prisma')
    const base = {
      id: '11111111-1111-4111-8111-111111111111',
      clientType: 'company',
      name: 'Acme Supplies',
      tags: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }
    expect(clientToContact({ ...base, payBy: 'cheque' }).payBy).toBeUndefined()
    expect(clientToContact({ ...base, payBy: '' }).payBy).toBeUndefined()
    expect(clientToContact({ ...base, payBy: null }).payBy).toBeUndefined()
    expect(clientToContact({ ...base, payBy: 'MPESA' }).payBy).toBe('mpesa')
  })
})
