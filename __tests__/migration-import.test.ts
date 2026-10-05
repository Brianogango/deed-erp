import { describe, expect, it } from 'vitest'
import { migrationDate, planMigrationImport } from '@/lib/finance/migration-import'

const TODAY = '2026-10-05'
const row = (over: Record<string, unknown> = {}) => ({
  Kind: 'customer', Name: 'Acme Ltd', Email: '', Phone: '0712000000', Address: '', 'VAT Number': '',
  'Opening Balance': 25000, Reference: 'OLD-INV-001', Date: '2026-09-01', 'Due Date': '2026-09-30', Notes: '',
  ...over,
})

describe('migrationDate', () => {
  it('reads Excel day numbers, ISO and day-first dates', () => {
    expect(migrationDate('46300')).toBe('2026-10-05')
    expect(migrationDate('2026-09-01')).toBe('2026-09-01')
    expect(migrationDate('05/10/2026')).toBe('2026-10-05')
    expect(migrationDate('5.10.2026')).toBe('2026-10-05')
  })
  it('rejects what is not a date', () => {
    expect(migrationDate('31/02/2026')).toBeNull()
    expect(migrationDate('next week')).toBeNull()
    expect(migrationDate('12')).toBeNull()
  })
})

describe('planMigrationImport', () => {
  it('plans a new contact and its opening balance', () => {
    const plan = planMigrationImport([row()], { contacts: [], invoices: [], today: TODAY })
    expect(plan.errors).toEqual([])
    expect([...plan.contactsToCreate.values()]).toMatchObject([{ name: 'Acme Ltd', isCustomer: true, isVendor: false }])
    expect(plan.documents).toMatchObject([{ type: 'customer_invoice', ref: 'OLD-INV-001', amount: 25000, date: '2026-09-01', dueDate: '2026-09-30' }])
  })

  it('uses an existing contact by name instead of creating a duplicate', () => {
    const plan = planMigrationImport([row({ Name: ' acme ltd ' })], { contacts: [{ id: 'c1', name: 'Acme Ltd' }], invoices: [], today: TODAY })
    expect(plan.contactsToCreate.size).toBe(0)
    expect(plan.existingContactIds.get('acme ltd')).toBe('c1')
  })

  it('skips a document already in the books, so the same file can be uploaded twice', () => {
    const plan = planMigrationImport([row()], {
      contacts: [{ id: 'c1', name: 'Acme Ltd' }],
      invoices: [{ type: 'customer_invoice', ref: 'old-inv-001', partnerName: 'Acme Ltd', status: 'posted' }],
      today: TODAY,
    })
    expect(plan.documents).toEqual([])
    expect(plan.skipped).toHaveLength(1)
  })

  it('without a reference, matches by partner, amount and date', () => {
    const plan = planMigrationImport([row({ Reference: '' }), row({ Reference: '' })], { contacts: [], invoices: [], today: TODAY })
    expect(plan.documents).toHaveLength(1)
    expect(plan.skipped).toHaveLength(1)
  })

  it('converts Excel day-number dates', () => {
    const plan = planMigrationImport([row({ Date: 46296, 'Due Date': 46300 })], { contacts: [], invoices: [], today: TODAY })
    expect(plan.documents[0]).toMatchObject({ date: '2026-10-01', dueDate: '2026-10-05' })
  })

  it('reports bad rows instead of importing them', () => {
    const plan = planMigrationImport([
      row({ Name: '' }),
      row({ 'Opening Balance': -5 }),
      row({ Date: 'yesterday' }),
      row({ Date: '2026-10-10', 'Due Date': '2026-10-01' }),
      row({ Kind: 'partner' }),
    ], { contacts: [], invoices: [], today: TODAY })
    expect(plan.errors).toHaveLength(5)
    expect(plan.documents).toEqual([])
  })

  it('a supplier row makes a vendor bill; one name on both kinds is one contact', () => {
    const plan = planMigrationImport([row(), row({ Kind: 'supplier', Reference: 'OLD-BILL-1' })], { contacts: [], invoices: [], today: TODAY })
    expect(plan.contactsToCreate.size).toBe(1)
    expect([...plan.contactsToCreate.values()][0]).toMatchObject({ isCustomer: true, isVendor: true })
    expect(plan.documents.map(d => d.type)).toEqual(['customer_invoice', 'vendor_bill'])
  })

  it('accepts amounts written with commas and a zero balance creates only the contact', () => {
    const plan = planMigrationImport([row({ 'Opening Balance': '1,250.50' }), row({ Name: 'Zero Co', 'Opening Balance': 0 })], { contacts: [], invoices: [], today: TODAY })
    expect(plan.documents).toHaveLength(1)
    expect(plan.documents[0].amount).toBe(1250.5)
    expect(plan.contactsToCreate.size).toBe(2)
  })
})
