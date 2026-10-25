/**
 * Office screens save the whole riders / delivery-jobs list from the browser.
 * Riders now change their own jobs from their link, and the server sets each
 * rider's link token, so a save from a screen holding an older copy must not
 * undo either.
 */
type Row = Record<string, any>

const RIDER_FIELDS = [
  'status', 'pickedUpAt', 'deliveredAt', 'recipientName', 'cashCollected', 'failureReason', 'riderUpdatedAt',
  'stops', 'stopsFinishedAt', 'backAtShopAt', 'returnConfirmedAt', 'returnConfirmedBy', 'tripUpdatedAt',
] as const

/** Last server-side change: the rider's link or an office trip action (check-in, follow-up). */
const serverStamp = (r: Row | undefined) => String(r?.tripUpdatedAt ?? r?.riderUpdatedAt ?? '')

/** Keep the rider's (and the office trip actions') latest update on any job the incoming list carries without it. */
export function mergeDeliveryJobsStoreWrite(current: unknown, incoming: unknown): unknown {
  if (!Array.isArray(current) || !Array.isArray(incoming)) return incoming
  const byId = new Map((current as Row[]).filter(r => r?.id).map(r => [String(r.id), r]))
  return (incoming as Row[]).map(row => {
    const server = row?.id ? byId.get(String(row.id)) : undefined
    if (!server || !serverStamp(server) || serverStamp(row) === serverStamp(server)) return row
    const kept: Row = { ...row }
    for (const f of RIDER_FIELDS) {
      if (server[f] === undefined) delete kept[f]
      else kept[f] = server[f]
    }
    return kept
  })
}

/** The link token is set by the server only. */
export function mergeRidersStoreWrite(current: unknown, incoming: unknown): unknown {
  if (!Array.isArray(current) || !Array.isArray(incoming)) return incoming
  const byId = new Map((current as Row[]).filter(r => r?.id).map(r => [String(r.id), r]))
  return (incoming as Row[]).map(row => {
    const server = row?.id ? byId.get(String(row.id)) : undefined
    if (!server) return row
    const kept: Row = { ...row }
    // Readers without rider-admin rights get rows without the ID number
    // (redactStoreValueForUser); their saves must not erase it.
    if (!('idNumber' in row) && server.idNumber !== undefined) kept.idNumber = server.idNumber
    if (row.portalToken === server.portalToken) return kept
    if (server.portalToken === undefined) delete kept.portalToken
    else kept.portalToken = server.portalToken
    return kept
  })
}

export function mergeDeliveryStoreWrite(key: string, current: unknown, incoming: unknown): unknown {
  if (key === 'deed_deliveryJobs') return mergeDeliveryJobsStoreWrite(current, incoming)
  if (key === 'deed_riders') return mergeRidersStoreWrite(current, incoming)
  return incoming
}
