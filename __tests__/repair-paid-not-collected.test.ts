import { describe, expect, it } from 'vitest'
import { isPaidNotCollected, repairInvoiceFor } from '@/lib/repair/paid-not-collected'

const inv = (id: string, over = {}) => ({ id, status: 'posted', total: 5000, amountPaid: 5000, ...over })

describe('paid but not collected', () => {
  it('flags a paid job still at Ready or Invoiced', () => {
    expect(isPaidNotCollected({ id: 'r', status: 'ready', invoiceId: 'i' }, [inv('i')])).toBe(true)
    expect(isPaidNotCollected({ id: 'r', status: 'invoiced' }, [inv('i', { repairId: 'r' })])).toBe(true)
  })

  it('leaves part-paid, unposted, free and collected jobs alone', () => {
    expect(isPaidNotCollected({ id: 'r', status: 'ready', invoiceId: 'i' }, [inv('i', { amountPaid: 4000 })])).toBe(false)
    expect(isPaidNotCollected({ id: 'r', status: 'ready', invoiceId: 'i' }, [inv('i', { status: 'draft' })])).toBe(false)
    expect(isPaidNotCollected({ id: 'r', status: 'ready', invoiceId: 'i' }, [inv('i', { total: 0, amountPaid: 0 })])).toBe(false)
    expect(isPaidNotCollected({ id: 'r', status: 'delivered', invoiceId: 'i' }, [inv('i')])).toBe(false)
    expect(isPaidNotCollected({ id: 'r', status: 'ready' }, [])).toBe(false)
  })

  it('prefers the linked invoice over one that only names the repair', () => {
    expect(repairInvoiceFor({ id: 'r', status: 'ready', invoiceId: 'b' }, [inv('a', { repairId: 'r' }), inv('b')])?.id).toBe('b')
  })
})
