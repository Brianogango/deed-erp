import { describe, expect, it } from 'vitest'
import {
  activeOutsourceJob,
  isOutsourceOverdue,
  outsourceBadgeLabel,
  outsourceDaysOut,
  outsourcedRepairCounts,
} from '@/lib/repair/outsource-visibility'

const now = new Date('2026-09-28T15:00:00Z')
const job = (over: Record<string, unknown> = {}) => ({
  ref: 'OUT/0076', repairOrderId: 'rep-1', status: 'sent',
  vendorName: 'Fastech Technologies(Mannu)', sentDate: '2026-09-22', ...over,
})

describe('where an outsourced machine is', () => {
  it('finds the open job holding a repair', () => {
    expect(activeOutsourceJob('rep-1', [job({ status: 'returned_resolved' }), job()])?.status).toBe('sent')
  })

  it('does not treat a returned job as holding the machine', () => {
    expect(activeOutsourceJob('rep-1', [job({ status: 'returned_unresolved' })])).toBeUndefined()
  })

  it('leads with the days out, then the vendor without the contact in brackets', () => {
    expect(outsourceBadgeLabel(job(), now)).toBe('6 days at Fastech Technologies')
    expect(outsourceBadgeLabel(job({ sentDate: '2026-09-28' }), now)).toBe('Sent today to Fastech Technologies')
  })
})

describe('how long it has been out', () => {
  it('counts whole days from a date-only sent date', () => {
    expect(outsourceDaysOut(job(), now)).toBe(6)
  })

  it('reads a full timestamp too', () => {
    expect(outsourceDaysOut(job({ sentDate: '2026-06-04T06:26:59.586Z' }), now)).toBe(116)
  })

  it('flags a machine out more than a week', () => {
    // The June Fastech jobs sat open for four months with nothing to say so.
    expect(isOutsourceOverdue(job({ sentDate: '2026-06-04' }), now)).toBe(true)
    expect(isOutsourceOverdue(job(), now)).toBe(false)
  })

  it('never calls a returned job overdue', () => {
    expect(isOutsourceOverdue(job({ status: 'returned_resolved', sentDate: '2026-06-04' }), now)).toBe(false)
  })

  it('copes with a job that has no date', () => {
    expect(outsourceDaysOut(job({ sentDate: '', createdAt: '' }), now)).toBeNull()
  })
})

describe('the Repairs count', () => {
  it('counts repairs at a vendor and how many are overdue', () => {
    const jobs = [job(), job({ repairOrderId: 'rep-2', sentDate: '2026-07-21' }), job({ repairOrderId: 'rep-3', status: 'returned_resolved' })]
    expect(outsourcedRepairCounts([{ id: 'rep-1' }, { id: 'rep-2' }, { id: 'rep-3' }], jobs, now))
      .toEqual({ out: 2, overdue: 1 })
  })
})
