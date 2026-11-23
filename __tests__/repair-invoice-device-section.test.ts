import { describe, expect, it } from 'vitest'
import { findRepairForInvoice, repairDeviceHeading, withDeviceHeading, withRepairDeviceSection } from '@/lib/repair-invoice-device-section'

const line = (description: string) => ({ description, qty: 1, unitPrice: 1500, subtotal: 1500 })

describe('repair invoice device heading', () => {
  it('names the device and its serial', () => {
    expect(repairDeviceHeading({ productName: 'HP EliteBook 840 G8', serialNumber: '5CG123' })).toBe('HP EliteBook 840 G8 · S/N 5CG123')
    expect(repairDeviceHeading({ deviceBrand: 'Epson', deviceModel: 'L3250' })).toBe('Epson L3250')
    expect(repairDeviceHeading({ deviceType: 'Printer' })).toBe('Printer')
    expect(repairDeviceHeading({})).toBe('')
  })

  it('puts the device above the lines', () => {
    const lines = withRepairDeviceSection([line('Service')], { productName: 'Dell Latitude 5420' })
    expect(lines[0]).toMatchObject({ lineType: 'section', description: 'Dell Latitude 5420' })
    expect(lines[1].description).toBe('Service')
  })

  it('leaves lines that already have headings alone', () => {
    const lines = [{ lineType: 'section' as const, description: 'Repair REP-1 — Laptop', qty: 0, unitPrice: 0, subtotal: 0 }, line('Service')]
    expect(withRepairDeviceSection(lines, { productName: 'Dell' })).toBe(lines)
    expect(withRepairDeviceSection([line('Service')], undefined)).toHaveLength(1)
  })

  it('finds the repair however it is linked', () => {
    const repairs = [{ id: 'a', invoiceId: 'i1' }, { id: 'b' }, { id: 'c', previousInvoiceIds: ['i9'] }]
    expect(findRepairForInvoice({ id: 'i1' }, repairs)?.id).toBe('a')
    expect(findRepairForInvoice({ id: 'x', repairId: 'b' }, repairs)?.id).toBe('b')
    expect(findRepairForInvoice({ id: 'x' }, repairs, 'b')?.id).toBe('b')
    expect(findRepairForInvoice({ id: 'i9' }, repairs)?.id).toBe('c')
    expect(findRepairForInvoice({ id: 'none' }, repairs)).toBeUndefined()
  })

  it('takes a heading the server worked out', () => {
    const lines = withDeviceHeading([line('Service')], 'Epson L3250 · S/N X9')
    expect(lines[0]).toMatchObject({ lineType: 'section', description: 'Epson L3250 · S/N X9' })
    expect(withDeviceHeading([line('Service')], null)).toHaveLength(1)
  })
})
