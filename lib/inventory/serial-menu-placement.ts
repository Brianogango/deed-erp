export interface SerialMenuTriggerRect {
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
  return { maxHeight: Math.max(120, Math.min(desiredHeight, spaceBelow - gap)) }
}
