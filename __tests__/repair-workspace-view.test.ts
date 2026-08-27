import { describe, it, expect } from 'vitest'
import { repairModuleView } from '@/lib/repair-workspace-view'

describe('repairModuleView', () => {
  it('stays on the job card when an id is set even if intake is false', () => {
    expect(repairModuleView(false, 'rep-1')).toBe('detail')
  })

  it('does not snap to list when the URL id has not landed yet if local id is already set', () => {
    // The old dual-state effect treated a still-empty URL as “close the job”.
    expect(repairModuleView(false, 'rep-click-test-1')).toBe('detail')
    expect(repairModuleView(false, null)).toBe('list')
  })

  it('prefers intake over an open id until intake is dismissed', () => {
    expect(repairModuleView(true, null)).toBe('intake')
    expect(repairModuleView(true, 'rep-1')).toBe('intake')
  })
})
