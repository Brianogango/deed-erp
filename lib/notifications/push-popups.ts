/**
 * Desktop pop-ups stay on screen until closed. Once the ERP knows an alert
 * has been read, acknowledged or resolved, its pop-up is closed too.
 */
type BellItem = { eventId?: string | null; read?: boolean; acknowledgedAt?: string | null }

/**
 * Event ids whose pop-ups should close. `listComplete` means the bell list
 * holds every open alert (it was not cut off by the page limit), so an
 * alert missing from it has been resolved or dismissed.
 */
export function popupEventIdsToClose(
  popupEventIds: string[],
  bell: BellItem[],
  listComplete: boolean,
): string[] {
  const byEvent = new Map<string, BellItem>()
  for (const item of bell) if (item.eventId) byEvent.set(item.eventId, item)
  return popupEventIds.filter(id => {
    const item = byEvent.get(id)
    if (!item) return listComplete
    return Boolean(item.read || item.acknowledgedAt)
  })
}

/** Close pop-ups for alerts that have been dealt with in the ERP. */
export async function closeHandledPopups(bell: BellItem[], listComplete: boolean): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration('/')
  if (!registration) return
  const shown = await registration.getNotifications()
  const ids = shown.map(n => (n.data && typeof n.data.eventId === 'string' ? n.data.eventId : '')).filter(Boolean)
  const close = new Set(popupEventIdsToClose(ids, bell, listComplete))
  for (const n of shown) if (n.data?.eventId && close.has(n.data.eventId)) n.close()
}
