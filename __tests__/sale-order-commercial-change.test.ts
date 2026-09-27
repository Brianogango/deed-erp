import { describe, expect, it } from 'vitest'
import {
  commercialLineKey,
  hasCommercialChange,
} from '@/lib/sales/sale-order-commercial-change'

/** A persisted Prisma line: discount lives in `discountPct`. */
const stored = (over: Record<string, unknown> = {}) => ({
  id: 'line-1',
  productId: 'prod-1',
  description: 'Laptop',
  qty: 10,
  unitPrice: 10_000,
  taxRate: 16,
  discountPct: 20,
  lineTotal: 80_000,
  qtyDelivered: 0,
  qtyInvoiced: 0,
  ...over,
})

/** The same line as the client holds it: `discount` and `discountPercent`. */
const clientLine = (over: Record<string, unknown> = {}) => ({
  id: 'line-1',
  productId: 'prod-1',
  description: 'Laptop',
  productName: 'Laptop',
  qty: 10,
  unitPrice: 10_000,
  taxRate: 16,
  discount: 20,
  discountPercent: 20,
  subtotal: 80_000,
  lineTotal: 80_000,
  ...over,
})

/** A section heading as it is persisted: qty 0, no product, no price, no lineType. */
const storedSection = (over: Record<string, unknown> = {}) => ({
  id: 'line-0',
  productId: null,
  description: 'Hardware',
  qty: 0,
  unitPrice: 0,
  taxRate: 0,
  discountPct: 0,
  lineTotal: 0,
  ...over,
})

const order = (items: any[], over: Record<string, unknown> = {}) => ({
  clientId: 'client-1',
  subtotal: 80_000,
  taxAmount: 12_800,
  totalAmount: 92_800,
  discountAmount: 0,
  items,
  ...over,
})

describe('commercialLineKey', () => {
  it('reads the discount from either shape, so a round-trip is not a change', () => {
    // The stored row and the client copy of the same line must produce the
    // same key, or the freeze reports a change on every save.
    expect(commercialLineKey(clientLine())).toBe(commercialLineKey(stored()))
  })

  it('changes when only the discount changes', () => {
    // This is the bypass. The key omitted the discount entirely, so these two
    // compared equal and a PATCH that halved the discount sailed through the
    // confirmed-order freeze.
    expect(commercialLineKey(clientLine({ discount: 10, discountPercent: 10 })))
      .not.toBe(commercialLineKey(stored()))
  })

  it('ignores fulfilment counters, which are not commercial terms', () => {
    expect(commercialLineKey(stored({ qtyDelivered: 4, qtyInvoiced: 4 })))
      .toBe(commercialLineKey(stored()))
  })
})

describe('hasCommercialChange — the discount bypass', () => {
  it('catches a discount cut that re-sends the stored lineTotal', () => {
    // Re-sending the original lineTotal was what made this invisible: the route
    // recomputes header totals server-side, so the attacker never has to send a
    // consistent total, and every other field is untouched.
    const changed = hasCommercialChange(
      order([stored()]),
      { lines: [clientLine({ discount: 0, discountPercent: 0 })] },
    )
    expect(changed).toBe(true)
  })

  it('catches a discount increase just the same', () => {
    expect(hasCommercialChange(
      order([stored()]),
      { lines: [clientLine({ discount: 45, discountPercent: 45 })] },
    )).toBe(true)
  })

  it('does not fire when the client saves the line back unchanged', () => {
    expect(hasCommercialChange(order([stored()]), { lines: [clientLine()] })).toBe(false)
  })

  it('still catches the terms it always caught', () => {
    expect(hasCommercialChange(order([stored()]), { lines: [clientLine({ unitPrice: 9_000 })] })).toBe(true)
    expect(hasCommercialChange(order([stored()]), { lines: [clientLine({ qty: 12 })] })).toBe(true)
    expect(hasCommercialChange(order([stored()]), { lines: [clientLine({ taxRate: 0 })] })).toBe(true)
  })
})

describe('hasCommercialChange — sections on both sides', () => {
  it('does not report a change on an order that merely contains a section heading', () => {
    // Sections were filtered from the request only, and a persisted section has
    // no `lineType` to filter on anyway. So for any order with a heading the
    // lengths never matched, every PATCH looked like a commercial change, and a
    // confirmed order refused edits that the workflow allows.
    const changed = hasCommercialChange(
      order([storedSection(), stored()]),
      { lines: [{ ...storedSection(), lineType: 'section' }, clientLine()] },
    )
    expect(changed).toBe(false)
  })

  it('is unmoved by renaming or reordering a heading', () => {
    expect(hasCommercialChange(
      order([storedSection(), stored()]),
      { lines: [clientLine(), { ...storedSection(), description: 'Devices', lineType: 'section' }] },
    )).toBe(false)
  })

  it('recognises a persisted section that never carried lineType', () => {
    // Both sides go through the same predicate, so a heading saved before
    // lineType was written is still treated as a heading.
    expect(hasCommercialChange(
      order([storedSection(), stored()]),
      { lines: [storedSection(), clientLine()] },
    )).toBe(false)
  })

  it('does not mistake a zero-qty priced product row for a heading', () => {
    // Dropping a real line to qty 0 is a commercial change, not a heading.
    expect(hasCommercialChange(
      order([stored()]),
      { lines: [clientLine({ qty: 0, lineTotal: 0, subtotal: 0 })] },
    )).toBe(true)
  })

  it('still notices a line added alongside a heading', () => {
    expect(hasCommercialChange(
      order([storedSection(), stored()]),
      { lines: [
        { ...storedSection(), lineType: 'section' },
        clientLine(),
        clientLine({ id: 'line-2', productId: 'prod-2', description: 'Mouse' }),
      ] },
    )).toBe(true)
  })

  it('still notices a line removed from beside a heading', () => {
    expect(hasCommercialChange(
      order([storedSection(), stored(), stored({ id: 'line-2', productId: 'prod-2' })]),
      { lines: [{ ...storedSection(), lineType: 'section' }, clientLine()] },
    )).toBe(true)
  })
})

describe('hasCommercialChange — everything else it gates', () => {
  it('treats a body that submits no lines as no line change', () => {
    expect(hasCommercialChange(order([stored()]), { notes: 'call the client' })).toBe(false)
  })

  it('reads lines from body.items when body.lines is absent', () => {
    expect(hasCommercialChange(order([stored()]), { items: [clientLine({ unitPrice: 1 })] })).toBe(true)
  })

  it('catches a customer swap under either field name', () => {
    expect(hasCommercialChange(order([stored()]), { clientId: 'other' })).toBe(true)
    expect(hasCommercialChange(order([stored()]), { customerId: 'other' })).toBe(true)
  })

  it('catches header figures under either field name', () => {
    expect(hasCommercialChange(order([stored()]), { total: 1 })).toBe(true)
    expect(hasCommercialChange(order([stored()]), { totalAmount: 1 })).toBe(true)
    expect(hasCommercialChange(order([stored()]), { taxTotal: 1 })).toBe(true)
    expect(hasCommercialChange(order([stored()]), { subtotal: 1 })).toBe(true)
    expect(hasCommercialChange(order([stored()]), { discountAmount: 1 })).toBe(true)
  })

  it('does not fire when the header figures are resubmitted unchanged', () => {
    expect(hasCommercialChange(order([stored()]), {
      total: 92_800,
      taxTotal: 12_800,
      subtotal: 80_000,
      discountAmount: 0,
      clientId: 'client-1',
    })).toBe(false)
  })
})
