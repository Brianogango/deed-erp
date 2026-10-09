import { describe, expect, it } from 'vitest'
import { averageRating, daysInStage, findDuplicates, groupByStage, jobFunnel, nextEmployeeNumber, phoneKey } from '@/lib/hr/recruitment'
import type { Candidate, JobPosting } from '@/lib/store'

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  id: 'c1', jobId: 'j1', firstName: 'Ann', lastName: 'Mwangi', email: 'ann@x.com', phone: '0712 345 678',
  stage: 'applied', appliedDate: '2026-09-01', ...over,
})
const job: JobPosting = { id: 'j1', title: 'Tech', departmentId: 'd', location: 'Nairobi', type: 'full_time', status: 'open', postedDate: '2026-09-01', description: 'x', openings: 2 }

describe('recruitment helpers', () => {
  it('matches duplicates by email or phone across formats, ignoring self', () => {
    const list = [cand(), cand({ id: 'c2', email: 'other@x.com', phone: '+254712345678' }), cand({ id: 'c3', email: 'z@x.com', phone: '0799000111' })]
    expect(findDuplicates(list, { email: 'ANN@x.com', phone: '' }).map(c => c.id)).toEqual(['c1'])
    expect(findDuplicates(list, { email: 'new@x.com', phone: '0712345678' }).map(c => c.id)).toEqual(['c1', 'c2'])
    expect(findDuplicates(list, { email: 'ann@x.com', phone: '' }, 'c1')).toEqual([])
    expect(phoneKey('+254 712 345 678')).toBe('712345678')
  })

  it('groups by stage and counts the funnel against openings', () => {
    const list = [cand(), cand({ id: 'c2', stage: 'hired' }), cand({ id: 'c3', stage: 'hired' }), cand({ id: 'c4', stage: 'rejected' }), cand({ id: 'c5', jobId: 'other' })]
    expect(groupByStage(list).hired).toHaveLength(2)
    expect(jobFunnel(job, list)).toEqual({ total: 4, active: 1, hired: 2, rejected: 1, openings: 2, filled: true })
    expect(jobFunnel({ ...job, openings: undefined }, list).openings).toBe(1)
  })

  it('suggests the next employee number keeping the padding', () => {
    expect(nextEmployeeNumber([])).toBe('EMP-001')
    expect(nextEmployeeNumber([{ employeeNo: 'EMP-009' }, { employeeNo: 'EMP-012' }, { employeeNo: 'X1' }])).toBe('EMP-013')
    expect(nextEmployeeNumber([{ employeeNo: 'EMP-0099' }])).toBe('EMP-0100')
  })

  it('averages completed interview ratings and falls back to the overall rating', () => {
    const iv = (rating: number, status: 'done' | 'scheduled' = 'done') => ({ id: String(rating), scheduledAt: '', mode: 'phone' as const, interviewer: '', status, rating })
    expect(averageRating(cand({ interviews: [iv(4), iv(5), iv(1, 'scheduled')] }))).toBe(4.5)
    expect(averageRating(cand({ rating: 3 }))).toBe(3)
    expect(averageRating(cand())).toBeNull()
  })

  it('counts days in stage from the last move', () => {
    const today = new Date('2026-09-11T12:00:00Z')
    expect(daysInStage(cand({ appliedDate: '2026-09-01' }), today)).toBe(10)
    expect(daysInStage(cand({ stageChangedDate: '2026-09-09' }), today)).toBe(2)
  })
})
