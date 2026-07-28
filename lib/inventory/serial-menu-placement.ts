export interface SerialMenuTriggerRect {
  top: number
  bottom: number
}

export function getSerialMenuPlacement(
  trigger: SerialMenuTriggerRect,
  viewportHeight: number,
) {
  const edge = 8
  const gap = 6
  const desiredHeight = 420
  const spaceBelow = Math.max(0, viewportHeight - trigger.bottom - edge)
  const spaceAbove = Math.max(0, trigger.top - edge)
  const openAbove = spaceBelow < 280 && spaceAbove > spaceBelow
  const available = openAbove ? spaceAbove - gap : spaceBelow

  return {
    top: openAbove ? undefined : trigger.bottom + gap,
    bottom: openAbove ? viewportHeight - trigger.top + gap : undefined,
    maxHeight: Math.max(96, Math.min(desiredHeight, available)),
    openAbove,
  }
}
