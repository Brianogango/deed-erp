'use client'

import { useCallback, useRef } from 'react'

/**
 * Backdrop dismiss that does not close a dialog when the user is
 * highlighting text.
 *
 * A click event fires on the nearest common ancestor of mousedown and
 * mouseup. Dragging a selection from an input onto the dimmed overlay
 * therefore looks like an overlay click — and used to close the window.
 * Require the pointer to have gone down on the overlay itself.
 */

export function shouldDismissOverlay(opts: {
  pointerDownOnOverlay: boolean
  target: EventTarget | null
  currentTarget: EventTarget | null
}): boolean {
  return opts.pointerDownOnOverlay && opts.target === opts.currentTarget
}

type OverlayPointerEvent = {
  target: EventTarget | null
  currentTarget: EventTarget | null
}

/** Mouse handlers to spread onto a backdrop / overlay root. */
export function useOverlayDismiss(onDismiss?: (() => void) | null) {
  const pressedOnOverlay = useRef(false)
  const onMouseDown = useCallback((event: OverlayPointerEvent) => {
    pressedOnOverlay.current = event.target === event.currentTarget
  }, [])
  const onClick = useCallback((event: OverlayPointerEvent) => {
    const dismiss = shouldDismissOverlay({
      pointerDownOnOverlay: pressedOnOverlay.current,
      target: event.target,
      currentTarget: event.currentTarget,
    })
    pressedOnOverlay.current = false
    if (dismiss) onDismiss?.()
  }, [onDismiss])
  return { onMouseDown, onClick }
}
