import { describe, it, expect } from 'vitest'
import {
  parseRiderFeeInput,
  resolveAssignedRiderFee,
  suggestRiderFeePrefill,
} from '@/lib/delivery-job-fee'

describe('resolveAssignedRiderFee', () => {
  it('keeps an existing job fee when assigning a rider with a zero default rate', () => {
    expect(resolveAssignedRiderFee({
      existingFee: 400,
      riderDefaultRate: 0,
    })).toBe(400)
  })

  it('uses an explicit override (including zero) over the existing fee', () => {
    expect(resolveAssignedRiderFee({
      existingFee: 400,
      overrideFee: 250,
      riderDefaultRate: 0,
    })).toBe(250)
    expect(resolveAssignedRiderFee({
      existingFee: 400,
      overrideFee: 0,
      riderDefaultRate: 150,
    })).toBe(0)
  })

  it('falls back to the rider default only when the job has no fee yet', () => {
    expect(resolveAssignedRiderFee({
      existingFee: 0,
      riderDefaultRate: 200,
    })).toBe(200)
    expect(resolveAssignedRiderFee({
      existingFee: undefined,
      riderDefaultRate: 0,
    })).toBe(0)
  })
})

describe('suggestRiderFeePrefill', () => {
  it('does not wipe a user-entered fee when a rider is selected', () => {
    expect(suggestRiderFeePrefill('350', 0)).toBe('350')
    expect(suggestRiderFeePrefill('350', 200)).toBe('350')
  })

  it('suggests a positive default only when the fee field is empty', () => {
    expect(suggestRiderFeePrefill('', 200)).toBe('200')
    expect(suggestRiderFeePrefill('', 0)).toBe('')
    expect(suggestRiderFeePrefill('  ', 150)).toBe('150') // whitespace counts as empty
  })
})

describe('parseRiderFeeInput', () => {
  it('accepts zero and positive amounts, rejects empty/invalid', () => {
    expect(parseRiderFeeInput('0')).toBe(0)
    expect(parseRiderFeeInput('450')).toBe(450)
    expect(parseRiderFeeInput('')).toBeNull()
    expect(parseRiderFeeInput('abc')).toBeNull()
    expect(parseRiderFeeInput('-10')).toBeNull()
  })
})
