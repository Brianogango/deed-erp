import { describe, expect, it } from 'vitest'
import { isLeaveActiveOnDate, localDateString } from '@/lib/leave-utils'

describe('leave active date helpers', () => {
  it('formats local dates without UTC shifting', () => {
    expect(localDateString(new Date(2026, 5, 15, 23, 30))).toBe('2026-06-15')
  })

  it('counts approved leave during its inclusive date range', () => {
    const leave = { status: 'approved', startDate: '2026-06-10', endDate: '2026-06-15' }

    expect(isLeaveActiveOnDate(leave, '2026-06-10')).toBe(true)
    expect(isLeaveActiveOnDate(leave, '2026-06-15')).toBe(true)
  })

  it('does not count leave before it starts or after the end date has passed', () => {
    const leave = { status: 'approved', startDate: '2026-06-10', endDate: '2026-06-15' }

    expect(isLeaveActiveOnDate(leave, '2026-06-09')).toBe(false)
    expect(isLeaveActiveOnDate(leave, '2026-06-16')).toBe(false)
  })

  it('ignores non-approved leave requests', () => {
    const leave = { status: 'pending_hr', startDate: '2026-06-10', endDate: '2026-06-15' }

    expect(isLeaveActiveOnDate(leave, '2026-06-12')).toBe(false)
  })
})
