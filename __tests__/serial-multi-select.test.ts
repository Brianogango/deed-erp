import { describe, expect, it } from 'vitest'
import { getSerialMenuPlacement } from '@/lib/inventory/serial-menu-placement'

describe('SerialMultiSelect menu placement', () => {
  it('constrains the panel to the space below so the footer stays visible', () => {
    const placement = getSerialMenuPlacement({ bottom: 130 }, 330)
    expect(placement.maxHeight).toBe(186)
  })

  it('keeps the original placement and caps tall panels', () => {
    const placement = getSerialMenuPlacement({ bottom: 100 }, 900)
    expect(placement.maxHeight).toBe(420)
    expect(placement).not.toHaveProperty('top')
    expect(placement).not.toHaveProperty('bottom')
  })
})
