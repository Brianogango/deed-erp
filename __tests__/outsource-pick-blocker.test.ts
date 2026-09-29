import { describe, expect, it } from 'vitest'
import { isOpenForOutsourcePicker, outsourcePickBlocker } from '@/lib/repair-outsource'

const ready = { id: 'r1', assignedTechnicianId: 'u4', repairPath: 'diagnosis_first', diagnosis: { findings: 'Board fault' } }

describe('why a repair cannot be outsourced yet', () => {
  it('is clear to go when assigned and diagnosed', () => {
    expect(outsourcePickBlocker(ready)).toBeNull()
  })

  it('asks for a technician first', () => {
    expect(outsourcePickBlocker({ ...ready, assignedTechnicianId: '' })).toContain('Assign a technician')
  })

  it('asks for a diagnosis on a diagnosis-first job', () => {
    expect(outsourcePickBlocker({ ...ready, diagnosis: null })).toContain('Log a diagnosis')
  })

  it('does not ask a direct repair for a diagnosis', () => {
    expect(outsourcePickBlocker({ ...ready, repairPath: 'direct_repair', diagnosis: null })).toBeNull()
  })

  it('names the vendor and job already holding the machine', () => {
    // The June Fastech jobs were never marked returned, so those repairs could
    // not be sent out again and the picker gave no reason.
    const jobs = [{ repairOrderId: 'r1', status: 'sent', ref: 'OUT/0007', vendorName: 'Fastech Technologies(Mannu)' }]
    expect(outsourcePickBlocker(ready, jobs)).toBe('Already at Fastech Technologies via OUT/0007 — mark it returned first')
  })

  it('ignores a job that has come back', () => {
    expect(outsourcePickBlocker(ready, [{ repairOrderId: 'r1', status: 'returned_resolved' }])).toBeNull()
  })
})

describe('which repairs the picker lists', () => {
  it('lists open workshop jobs and leaves out finished ones', () => {
    expect(isOpenForOutsourcePicker({ status: 'in_repair' })).toBe(true)
    expect(isOpenForOutsourcePicker({ status: 'collected' })).toBe(false)
  })
})
