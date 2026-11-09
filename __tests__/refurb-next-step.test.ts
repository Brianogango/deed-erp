import { describe, expect, it } from 'vitest'
import { refurbFlowProgress, refurbNextStep } from '@/lib/refurbishment/next-step'

const tech = { id: 't1', isLead: false, canAssign: false }
const lead = { id: 'l1', isLead: true, canAssign: true }
const job = (o: Record<string, unknown> = {}) => ({ status: 'in_progress', assignedTechnicianId: 't1', partsNeeded: [], ...o }) as never

describe('refurb next step', () => {
  it('walks the flow in order', () => {
    expect(refurbNextStep(job({ status: 'queued', assignedTechnicianId: undefined }), lead).key).toBe('assign')
    expect(refurbNextStep(job({ status: 'assigned' }), tech).key).toBe('start')
    expect(refurbNextStep(job(), tech).key).toBe('record_issues')
    expect(refurbNextStep(job({ issuesFound: 'No display', partsNeeded: [{ status: 'needed', productId: 'p1' }] }), tech).title).toBe('Request 1 part')
    expect(refurbNextStep(job({ issuesFound: 'No display', partsNeeded: [{ status: 'needed' }] }), tech).title).toBe('Link 1 part to inventory')
    expect(refurbNextStep(job({ issuesFound: 'x', partsNeeded: [{ status: 'requested' }] }), tech)).toMatchObject({ key: 'wait_parts', mine: false })
    expect(refurbNextStep(job({ issuesFound: 'x', partsNeeded: [{ status: 'requested' }] }), lead)).toMatchObject({ key: 'wait_parts', mine: true })
    expect(refurbNextStep(job({ issuesFound: 'x', partsNeeded: [{ status: 'allocated' }] }), tech).key).toBe('fit_parts')
    expect(refurbNextStep(job({ issuesFound: 'x', identityPending: true, partsNeeded: [{ status: 'used' }] }), tech).key).toBe('identify')
    expect(refurbNextStep(job({ issuesFound: 'x', partsNeeded: [{ status: 'used' }] }), tech).key).toBe('mark_ready')
    expect(refurbNextStep(job({ status: 'ready', issuesFound: 'x' }), lead).key).toBe('retest')
  })

  it('only the assigned technician or a lead can act', () => {
    expect(refurbNextStep(job(), { id: 'other', isLead: false, canAssign: false }).mine).toBe(false)
    expect(refurbNextStep(job(), tech).mine).toBe(true)
  })

  it('tracks progress', () => {
    expect(refurbFlowProgress(job({ status: 'queued' }))).toBe(-1)
    expect(refurbFlowProgress(job())).toBe(1)
    expect(refurbFlowProgress(job({ issuesFound: 'x', partsNeeded: [{ status: 'needed' }] }))).toBe(2)
    expect(refurbFlowProgress(job({ issuesFound: 'x' }))).toBe(3)
    expect(refurbFlowProgress(job({ status: 'ready' }))).toBe(4)
  })
})
