import { describe, it, expect } from 'vitest'
import { dayValueForHours, payableValue, payableDays, networkKey, isOfficeIp, dayProblems, monthRange, dailyPay } from '@/lib/hr/attendance-core'

const at = (h: number, m = 0) => `2026-11-24T${String(h - 3).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z` // Nairobi is UTC+3

describe('attendance rules', () => {
  it('6 hours is a full day, 3 to 6 a half day, less nothing', () => {
    expect(dayValueForHours(9)).toBe(1)
    expect(dayValueForHours(6)).toBe(1)
    expect(dayValueForHours(5.99)).toBe(0.5)
    expect(dayValueForHours(3)).toBe(0.5)
    expect(dayValueForHours(2.9)).toBe(0)
  })

  it('only approved days with a clock-out are paid', () => {
    expect(payableValue({ status: 'approved', clockIn: at(8), clockOut: at(17) })).toBe(1)
    expect(payableValue({ status: 'pending', clockIn: at(8), clockOut: at(17) })).toBe(0)
    expect(payableValue({ status: 'rejected', clockIn: at(8), clockOut: at(17) })).toBe(0)
    expect(payableValue({ status: 'approved', clockIn: at(8), clockOut: null })).toBe(0)
    expect(payableDays([
      { status: 'approved', clockIn: at(8), clockOut: at(17) },
      { status: 'approved', clockIn: at(8), clockOut: at(12) },
      { status: 'pending', clockIn: at(8), clockOut: at(17) },
    ])).toBe(1.5)
    expect(dailyPay(20.5, 800)).toBe(16400)
  })

  it('lists what needs a supervisor', () => {
    expect(dayProblems({ clockIn: at(8), clockOut: null, inOffice: false, outOffice: null, inVerified: false }, '2026-11-25', '2026-11-24'))
      .toEqual(['no_clock_out', 'outside_office', 'no_fingerprint'])
    expect(dayProblems({ clockIn: at(8), clockOut: null, inOffice: true, outOffice: null, inVerified: true }, '2026-11-24', '2026-11-24')).toEqual([])
  })

  it('matches office connections: IPv4 whole, IPv6 by the office block', () => {
    expect(networkKey('::ffff:41.90.1.2')).toBe('41.90.1.2')
    expect(networkKey('2c0f:fe38:2001:abcd:1111:2222:3333:4444')).toBe('2c0f:fe38:2001:abcd::/64')
    expect(networkKey('2c0f:fe38:2001:abcd::1')).toBe('2c0f:fe38:2001:abcd::/64')
    expect(networkKey('unknown')).toBeNull()
    const office = [{ ip: '41.90.1.2' }, { ip: '2c0f:fe38:2001:abcd::/64' }]
    expect(isOfficeIp('41.90.1.2', office)).toBe(true)
    expect(isOfficeIp('41.90.1.3', office)).toBe(false)
    expect(isOfficeIp('2c0f:fe38:2001:abcd:9:8:7:6', office)).toBe(true)
    expect(isOfficeIp('2c0f:fe38:2001:abce::5', office)).toBe(false)
    expect(isOfficeIp(null, office)).toBe(false)
  })

  it('month range', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })
})
