import { describe, it, expect } from 'vitest'
import { planRefurbDelete, refurbPartsToReturn } from '@/lib/refurbishment/refurb-delete'

const serials = [{ id: 's1', serial: 'SN1' }, { id: 's2', serial: 'SN2' }, { id: 's3', serial: 'SN3' }, { id: 's4', serial: 'SN4' }]
const jobs = [
  { id: 'j1', ref: 'REF/0001', serialId: 's1', status: 'queued', partsNeeded: [] },
  { id: 'j2', ref: 'REF/0002', serialId: 's2', status: 'transferred', partsNeeded: [] },
  { id: 'j3', ref: 'REF/0003', serialId: 's3', status: 'written_off', outcome: 'harvested', partsNeeded: [] },
  { id: 'j4', ref: 'REF/0004', serialId: 's4', status: 'ready', partsNeeded: [] },
  { id: 'j5', ref: 'REF/0005', serialId: 'gone', status: 'in_progress', partsNeeded: [] },
  { id: 'j6', ref: 'REF/0006', serialId: 's2', status: 'queued', partsNeeded: [] },
]

describe('planRefurbDelete', () => {
  it('job only: removes open and written-off jobs, refuses transferred, harvested and ready', () => {
    const plan = planRefurbDelete({ jobs, serials, jobIds: ['j1', 'j2', 'j3', 'j4', 'j6'], serialIds: [], mode: 'job_only' })
    expect(plan.jobIds).toEqual(['j1', 'j6'])
    expect(plan.serialIds).toEqual([])
    expect(plan.refused.map(r => r.id)).toEqual(['j2', 'j3', 'j4'])
  })

  it('job only: a machine with no job is refused', () => {
    const plan = planRefurbDelete({ jobs, serials, jobIds: [], serialIds: ['s1'], mode: 'job_only' })
    expect(plan.refused[0].why).toMatch(/no job/i)
  })

  it('job and machine: deletes the machine; a machine already gone leaves just the job', () => {
    const plan = planRefurbDelete({ jobs, serials, jobIds: ['j1', 'j5'], serialIds: [], mode: 'job_and_unit' })
    expect(plan.serialIds).toEqual(['s1'])
    expect(plan.jobIds).toEqual(['j5'])
    expect(plan.refused).toEqual([])
  })

  it('job and machine: an earlier transferred job on the same machine keeps it', () => {
    const plan = planRefurbDelete({ jobs, serials, jobIds: ['j6'], serialIds: [], mode: 'job_and_unit' })
    expect(plan.serialIds).toEqual([])
    expect(plan.refused[0].why).toMatch(/REF\/0002: Transferred/)
  })

  it('job and machine: With Issues machines with no job are deleted', () => {
    const plan = planRefurbDelete({ jobs: [], serials, jobIds: [], serialIds: ['s1', 'nope'], mode: 'job_and_unit' })
    expect(plan.serialIds).toEqual(['s1'])
    expect(plan.refused.map(r => r.why)).toEqual(['Not found'])
  })
})

describe('refurbPartsToReturn', () => {
  it('returns only parts taken from stock and not fitted', () => {
    const parts = refurbPartsToReturn([{ id: 'j', ref: 'R', partsNeeded: [
      { id: 'a', productId: 'p', status: 'allocated', stockTaken: true },
      { id: 'b', productId: 'p', status: 'used', stockTaken: true },
      { id: 'c', productId: 'p', status: 'requested' },
      { id: 'd', status: 'allocated', stockTaken: true },
      { id: 'e', productId: 'p', status: 'received', allocatedDate: '2026-01-01' },
    ] }])
    expect(parts.map(p => p.partId)).toEqual(['a', 'e'])
  })
})
