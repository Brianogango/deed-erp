import { describe, expect, it } from 'vitest'
import { getSerialMenuPlacement } from '@/lib/inventory/serial-menu-placement'

describe('SerialMultiSelect menu placement', () => {
  it('constrains the panel to the space below so the footer stays visible', () => {
    const placement = getSerialMenuPlacement({ top: 100, bottom: 130 }, 330)
    expect(placement.openAbove).toBe(false)
    expect(placement.top).toBe(136)
    expect(placement.maxHeight).toBe(192)
  })

  it('opens above the trigger when there is more usable space above', () => {
    const placement = getSerialMenuPlacement({ top: 600, bottom: 630 }, 700)
    expect(placement.openAbove).toBe(true)
    expect(placement.top).toBeUndefined()
    expect(placement.bottom).toBe(106)
    expect(placement.maxHeight).toBe(420)
  })
})
