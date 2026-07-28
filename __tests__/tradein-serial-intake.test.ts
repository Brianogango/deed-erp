import { describe, expect, it } from 'vitest'
import {
  findDuplicateSerial,
  parseReturnSerialTokens,
  scoreCustomerReturnSerial,
} from '@/lib/tradein-serial-intake'

const serials = [
  { id: 's1', serial: 'SN-OLD', productId: 'p1', status: 'sold', location: 'customer', saleOrderId: 'so1' },
  { id: 's2', serial: 'SN-WH', productId: 'p1', status: 'available', location: 'warehouse' },
  { id: 's3', serial: 'SN-OTHER', productId: 'p1', status: 'sold', location: 'customer', saleOrderId: 'so2' },
]

describe('tradein serial intake helpers', () => {
  it('resolves known customer-return serials', () => {
    const result = parseReturnSerialTokens({
      raw: 'SN-OLD',
      productId: 'p1',
      productName: 'Laptop',
      requiresSerial: true,
      qty: 1,
      serials,
      mode: 'customer_return',
    })
    expect(result.serialIds).toEqual(['s1'])
    expect(result.pendingIntake).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('queues unknown serials for intake when allowed', () => {
    const result = parseReturnSerialTokens({
      raw: 'BRAND-NEW-SN',
      productId: 'p1',
      productName: 'Laptop',
      requiresSerial: true,
      qty: 1,
      serials,
      mode: 'customer_return',
      allowIntake: true,
    })
    expect(result.serialIds).toEqual([])
    expect(result.pendingIntake).toEqual(['BRAND-NEW-SN'])
    expect(result.errors).toEqual([])
  })

  it('errors on unknown serials when intake is not allowed', () => {
    const result = parseReturnSerialTokens({
      raw: 'BRAND-NEW-SN',
      productId: 'p1',
      productName: 'Laptop',
      requiresSerial: true,
      qty: 1,
      serials,
      mode: 'customer_return',
      allowIntake: false,
    })
    expect(result.serialIds).toEqual([])
    expect(result.errors[0]).toMatch(/not available/)
  })

  it('does not allow stock-out intake for warehouse serials missing from stock', () => {
    const result = parseReturnSerialTokens({
      raw: 'MISSING',
      productId: 'p1',
      productName: 'Laptop',
      requiresSerial: true,
      qty: 1,
      serials,
      mode: 'stock_out',
      location: 'warehouse',
      allowIntake: true,
    })
    expect(result.pendingIntake).toEqual([])
    expect(result.errors[0]).toMatch(/not available/)
  })

  it('blocks intake when serial exists in a non-return status', () => {
    const result = parseReturnSerialTokens({
      raw: 'SN-WH',
      productId: 'p1',
      productName: 'Laptop',
      requiresSerial: true,
      qty: 1,
      serials,
      mode: 'customer_return',
      allowIntake: true,
    })
    expect(result.errors[0]).toMatch(/exists but is not a customer return/)
  })

  it('scores SO / customer-linked serials higher', () => {
    const saleOrders = [
      { id: 'so1', customerId: 'c1' },
      { id: 'so2', customerId: 'c2' },
    ]
    expect(scoreCustomerReturnSerial(serials[0], { customerId: 'c1', saleOrderId: 'so1', saleOrders })).toBeGreaterThan(
      scoreCustomerReturnSerial(serials[2], { customerId: 'c1', saleOrderId: 'so1', saleOrders }),
    )
  })

  it('finds duplicate serials case-insensitively', () => {
    expect(findDuplicateSerial(serials, 'p1', 'sn-old')?.id).toBe('s1')
    expect(findDuplicateSerial(serials, 'p1', 'nope')).toBeUndefined()
  })
})
