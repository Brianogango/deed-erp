import { describe, expect, it } from 'vitest'
import { buildRefurbWeeklyReport, refurbWeekRange, refurbWeekStart, type ReportJob } from '@/lib/refurbishment/weekly-report'

const job = (over: Partial<ReportJob>): ReportJob => ({
  id: over.ref ?? 'j', ref: 'REF/0001', status: 'queued', serialNumber: 'SN', productName: 'HP 840 G5',
  intakeDate: '2026-10-20T08:00:00.000Z', partsNeeded: [], ...over,
})

describe('refurb weeks (Monday–Sunday, Kenya time)', () => {
  it('starts the week on Monday in Kenya time', () => {
    expect(refurbWeekStart('2026-10-28T10:00:00.000Z')).toBe('2026-10-26') // Wednesday
    expect(refurbWeekStart('2026-10-25T22:30:00.000Z')).toBe('2026-10-26') // Mon 01:30 EAT
    expect(refurbWeekStart('2026-10-25T20:00:00.000Z')).toBe('2026-10-19') // Sun 23:00 EAT
  })
  it('labels the week', () => {
    expect(refurbWeekRange('2026-10-26').label).toBe('26 Oct – 1 Nov 2026')
  })
})

describe('buildRefurbWeeklyReport', () => {
  const jobs: ReportJob[] = [
    job({ ref: 'A', status: 'ready', assignedTechnicianId: 't1', assignedTechnicianName: 'Cynthia', intakeDate: '2026-10-20T08:00:00Z', completedDate: '2026-10-27T08:00:00Z', partsNeeded: [{ partName: 'Battery', qty: 1, estimatedCost: 3500, status: 'used' }] }),
    job({ ref: 'B', status: 'transferred', assignedTechnicianId: 't1', assignedTechnicianName: 'Cynthia', intakeDate: '2026-10-26T08:00:00Z', completedDate: '2026-10-28T08:00:00Z', transferDate: '2026-10-29T08:00:00Z' }),
    job({ ref: 'C', status: 'written_off', assignedTechnicianId: 't2', assignedTechnicianName: 'Ken', intakeDate: '2026-10-10T08:00:00Z', completedDate: '2026-10-28T09:00:00Z' }),
    job({ ref: 'D', status: 'in_progress', assignedTechnicianId: 't2', assignedTechnicianName: 'Ken', intakeDate: '2026-10-01T08:00:00Z', partsNeeded: [{ partName: 'Screen', qty: 1, estimatedCost: 8000, status: 'ordered' }] }),
    job({ ref: 'E', status: 'queued', intakeDate: '2026-10-28T08:00:00Z' }),
    job({ ref: 'F', status: 'transferred', intakeDate: '2026-09-01T08:00:00Z', completedDate: '2026-09-10T08:00:00Z', transferDate: '2026-09-11T08:00:00Z' }),
  ]

  it('splits the week into completed, written off, sent for retest and received', () => {
    const r = buildRefurbWeeklyReport(jobs, '2026-10-26', new Date('2026-10-29T12:00:00Z'))
    expect(r.completed.map(c => c.ref)).toEqual(['A', 'B'])
    expect(r.writtenOff.map(c => c.ref)).toEqual(['C'])
    expect(r.sentForRetest.map(c => c.ref)).toEqual(['B'])
    expect(r.received.map(c => c.ref).sort()).toEqual(['B', 'E'])
    expect(r.completed[0]).toMatchObject({ daysToComplete: 7, cost: 3500 })
    expect(r.totals).toMatchObject({ completed: 2, writtenOff: 1, partsCostCompleted: 3500, avgDaysToComplete: 4.5 })
  })

  it('lists open machines oldest first, with why they wait', () => {
    const r = buildRefurbWeeklyReport(jobs, '2026-10-26', new Date('2026-10-29T12:00:00Z'))
    expect(r.isCurrentWeek).toBe(true)
    expect(r.pending.map(p => [p.ref, p.stage])).toEqual([['D', 'Waiting for parts'], ['E', 'Waiting for a technician']])
    expect(r.pending[0].waitingParts).toEqual(['Screen × 1'])
  })

  it('for a past week, counts what was open at its end', () => {
    const r = buildRefurbWeeklyReport(jobs, '2026-10-19', new Date('2026-10-29T12:00:00Z'))
    expect(r.isCurrentWeek).toBe(false)
    // A (done 27th), C (written off 28th) and D were all still open on Sunday 25th.
    expect(r.pending.map(p => p.ref).sort()).toEqual(['A', 'C', 'D'])
    expect(r.completed).toHaveLength(0)
  })

  it('summarises each technician', () => {
    const r = buildRefurbWeeklyReport(jobs, '2026-10-26', new Date('2026-10-29T12:00:00Z'))
    expect(r.technicians).toEqual([
      { name: 'Cynthia', completed: 2, writtenOff: 0, open: 0, avgDays: 4.5 },
      { name: 'Ken', completed: 0, writtenOff: 1, open: 1, avgDays: null },
    ])
  })
})

import { refurbPartStockTaken } from '@/lib/refurbishment/refurb-parts'
describe('refurbPartStockTaken', () => {
  it('trusts the flag, else an allocation date', () => {
    expect(refurbPartStockTaken({ stockTaken: true })).toBe(true)
    expect(refurbPartStockTaken({ stockTaken: false, allocatedDate: 'x' })).toBe(false)
    expect(refurbPartStockTaken({ allocatedDate: '2026-10-01' })).toBe(true)
    expect(refurbPartStockTaken({})).toBe(false)
  })
})
