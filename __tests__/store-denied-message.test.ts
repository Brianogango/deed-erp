import { describe, expect, it } from 'vitest'
import { deniedSaveMessage, storeKeyLabel } from '@/lib/store-denied-message'

describe('telling someone their save was refused', () => {
  it('names the list in plain words', () => {
    expect(storeKeyLabel('deed_outsourceJobs')).toBe('outsource jobs')
    expect(storeKeyLabel('deed_audit_timeline_v1')).toBe('audit timeline')
  })

  it('says what was not kept', () => {
    expect(deniedSaveMessage(['deed_outsourceJobs'])).toContain('outsource jobs')
    expect(deniedSaveMessage(['deed_outsourceJobs'])).toContain('not kept')
  })

  it('lists several refused lists once each', () => {
    expect(deniedSaveMessage(['deed_outsourceJobs', 'deed_outsourceVendors', 'deed_outsourceJobs']))
      .toContain('outsource jobs and outsource vendors')
  })

  it('says nothing when nothing was refused', () => {
    expect(deniedSaveMessage([])).toBeNull()
  })
})
