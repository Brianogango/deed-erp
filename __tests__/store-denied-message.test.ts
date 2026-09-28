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

  it('stays quiet about lists the browser rewrites on its own', () => {
    // Every tab recomputes product stock counts; refusing those loses nothing
    // anyone typed, and a pop-up for them would drown out the real ones.
    expect(deniedSaveMessage(['deed_products', 'deed_posSessionId'])).toBeNull()
  })

  it('still speaks up for real work refused alongside background noise', () => {
    const message = deniedSaveMessage(['deed_products', 'deed_serials'])
    expect(message).toContain('serials')
    expect(message).not.toContain('products')
  })
})
