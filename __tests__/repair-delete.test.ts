import { describe, expect, it } from 'vitest'
import { repairHardDeleteBlocker } from '@/lib/repair-delete'

describe('repairHardDeleteBlocker', () => {
  it('allows an erroneous/test repair with no downstream records', () => {
    expect(repairHardDeleteBlocker({ status: 'received' })).toBeNull()
    expect(repairHardDeleteBlocker({ status: 'diagnosed' })).toBeNull()
    expect(repairHardDeleteBlocker({ status: 'cancelled' })).toBeNull()
  })

  it('blocks financially or operationally significant terminal records', () => {
    expect(repairHardDeleteBlocker({ status: 'invoiced' })).toMatch(/cancelled\/closed/i)
    expect(repairHardDeleteBlocker({ status: 'delivered' })).toMatch(/cancelled\/closed/i)
    expect(repairHardDeleteBlocker({ status: 'closed' })).toMatch(/cancelled\/closed/i)
  })

  it('blocks linked invoice and handover records', () => {
    expect(repairHardDeleteBlocker({ status: 'ready', invoiceId: 'inv-1' })).toMatch(/linked invoice/i)
    expect(repairHardDeleteBlocker({ status: 'ready', deliveryJobId: 'd-1' })).toMatch(/delivery\/handover/i)
  })

  it('blocks linked disposition, warranty, diagnosis-fee and confirmed payment history', () => {
    expect(repairHardDeleteBlocker({ status: 'retained', retainedBuyBackId: 'bb-1' })).toMatch(/trade-in\/buy-back/i)
    expect(repairHardDeleteBlocker({ status: 'in_repair', warrantyClaimId: 'wc-1' })).toMatch(/warranty claim/i)
    expect(repairHardDeleteBlocker({ status: 'diagnosed', diagnosisFeeStatus: 'paid' })).toMatch(/diagnosis-fee/i)
    expect(repairHardDeleteBlocker({ status: 'diagnosed', paymentConfirmationStatus: 'approved' })).toMatch(/payment activity/i)
  })
})
