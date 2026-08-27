import { describe, expect, it } from 'vitest'
import { shouldDismissOverlay } from '@/lib/overlay-dismiss'

const overlay = { id: 'overlay' } as unknown as EventTarget
const field = { id: 'field' } as unknown as EventTarget

describe('shouldDismissOverlay', () => {
  it('closes when press and release are both on the backdrop', () => {
    expect(shouldDismissOverlay({
      pointerDownOnOverlay: true,
      target: overlay,
      currentTarget: overlay,
    })).toBe(true)
  })

  it('does not close when the user started a text selection inside the dialog', () => {
    // mousedown in the field, mouseup on the dimmed overlay — click retargets
    // to the overlay, which used to dismiss the window.
    expect(shouldDismissOverlay({
      pointerDownOnOverlay: false,
      target: overlay,
      currentTarget: overlay,
    })).toBe(false)
  })

  it('does not close for clicks that stay on the dialog content', () => {
    expect(shouldDismissOverlay({
      pointerDownOnOverlay: false,
      target: field,
      currentTarget: overlay,
    })).toBe(false)
  })
})
