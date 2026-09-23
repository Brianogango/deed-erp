import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { paymentMethodEnum } from '@/lib/accounting/payment-allocations'

// The enum as declared in prisma/schema.prisma (`payment_method`).
const PAYMENT_METHOD = ['cash', 'mpesa', 'bank_transfer', 'card', 'credit', 'cheque']

describe('payment method reaches a value the column accepts', () => {
  it('REGRESSION 22-Sep-2026: app-specific methods no longer roll back the receipt', () => {
    // prisma.payment.create() rejected these, taking the payment, its
    // allocations, the GL journal and the audit row down with it.
    expect(paymentMethodEnum('customer_credit')).toBe('credit')
    expect(paymentMethodEnum('deposit_apply')).toBe('credit')
  })

  it('passes enum members through untouched', () => {
    for (const m of PAYMENT_METHOD) expect(paymentMethodEnum(m)).toBe(m)
  })

  it('never returns a value outside the enum', () => {
    for (const input of ['Bank Transfer', 'M-PESA', 'mobile money', 'cheque', 'nonsense', '', null, undefined, 42]) {
      expect(PAYMENT_METHOD).toContain(paymentMethodEnum(input))
    }
  })
})

describe('date validation on finance routes', () => {
  // The routes used /^\\d{4}-\\d{2}-\\d{2}$/, which in a regex literal matches a
  // literal backslash — so every submission was rejected with a 422.
  const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  const isoMonth = z.string().regex(/^\d{4}-\d{2}$/)

  it('accepts the dates the app actually sends', () => {
    expect(isoDate.safeParse('2026-09-23').success).toBe(true)
    expect(isoMonth.safeParse('2026-09').success).toBe(true)
  })

  it('still rejects malformed dates', () => {
    for (const bad of ['23-09-2026', '2026-9-3', 'today', '\\d{4}-\\d{2}-\\d{2}']) {
      expect(isoDate.safeParse(bad).success).toBe(false)
    }
  })

  it('the shipped route schemas match', async () => {
    const fs = await import('node:fs')
    for (const file of [
      'app/api/accounting/bank-statements/route.ts',
      'app/api/accounting/fixed-assets/route.ts',
      'app/api/salary-advances/route.ts',
    ]) {
      const src = fs.readFileSync(file, 'utf8')
      expect(src, `${file} has an over-escaped date regex`).not.toMatch(/regex\(\/\^\\\\d/)
    }
  })
})
