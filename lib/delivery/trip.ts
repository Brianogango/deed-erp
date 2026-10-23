/**
 * A delivery job is one trip: one rider, one fee, and a list of stops done in
 * order. At each stop the rider hands items over (drop), brings items back
 * (collect), or both (exchange). A customer can also hand the rider something
 * the office did not plan — a return, a device for repair — which the rider
 * records on the spot.
 *
 * Anything the rider has collected, or could not hand over, is "with the
 * rider" until the office confirms it arrived back at the shop. Only then is
 * the trip finished. Jobs made before stops existed are read as one stop.
 */

export type StopKind = 'drop' | 'collect' | 'exchange'
export type UnplannedReason = 'return' | 'repair' | 'exchange' | 'other'

export type TripCash = { amount: number; method: 'cash' | 'mpesa'; reference?: string; at: string }

export type StopItem = {
  id: string
  /** out: rider hands it to the customer. in: rider brings it back. */
  direction: 'out' | 'in'
  description: string
  serial?: string
  qty: number
  status?: 'done' | 'not_done'
  /** Set when the rider added it at the stop; the office did not plan it. */
  unplanned?: { reason: UnplannedReason; note?: string; billOnInvoice?: boolean; at: string }
  receivedAt?: string
  receivedBy?: string
  /** What the office did about an unplanned item (credit, invoice line, repair intake…). */
  followUp?: { status: 'open' | 'handled'; note?: string; by?: string; at?: string }
}

export type Stop = {
  id: string
  kind: StopKind
  address: string
  contactName?: string
  contactPhone?: string
  notes?: string
  items: StopItem[]
  status: 'pending' | 'done' | 'failed'
  doneAt?: string
  recipientName?: string
  cashCollected?: TripCash
  failureReason?: string
}

export type TripJob = {
  id: string
  ref: string
  type?: string
  status: string
  riderId?: string
  customerName?: string
  customerPhone?: string
  pickupAddress?: string
  deliveryAddress?: string
  pickedUpAt?: string
  deliveredAt?: string
  recipientName?: string
  cashCollected?: TripCash
  failureReason?: string
  notes?: string
  stops?: Stop[]
  /** Every stop is done or failed. */
  stopsFinishedAt?: string
  /** Rider says they are back at the shop with what they carry. */
  backAtShopAt?: string
  /** Office confirmed everything the rider carried came back. */
  returnConfirmedAt?: string
  returnConfirmedBy?: string
  riderUpdatedAt?: string
  /** Last change made on the server (rider link or office trip action). */
  tripUpdatedAt?: string
  [key: string]: unknown
}

const OPEN = new Set(['assigned', 'in_transit'])
export const STOP_KIND_LABELS: Record<StopKind, string> = { drop: 'Drop off', collect: 'Collect', exchange: 'Exchange' }
export const UNPLANNED_REASON_LABELS: Record<UnplannedReason, string> = {
  return: 'Customer return', repair: 'For repair', exchange: 'Exchange', other: 'Other',
}

export const hasStops = (job: Pick<TripJob, 'stops'>) => Array.isArray(job.stops) && job.stops.length > 0

/** The trip's stops; a job from before stops existed reads as one stop. */
export function jobStops(job: TripJob): Stop[] {
  if (hasStops(job)) return job.stops as Stop[]
  const collect = job.type === 'repair_pickup'
  return [{
    id: 'main',
    kind: collect ? 'collect' : 'drop',
    address: String((collect ? job.pickupAddress : job.deliveryAddress) ?? ''),
    contactName: job.customerName,
    contactPhone: job.customerPhone,
    items: [],
    status: job.status === 'delivered' ? 'done' : job.status === 'failed' ? 'failed' : 'pending',
    doneAt: job.deliveredAt,
    recipientName: job.recipientName,
    cashCollected: job.cashCollected,
    failureReason: job.failureReason,
  }]
}

/**
 * What the rider holds right now and must bring to the shop: items collected,
 * plus items to hand over that were not handed over (failed stop, not done,
 * or a stop not reached yet). Nothing before pick-up. Items the office has
 * received are no longer with the rider.
 */
export function carriedItems(job: TripJob): Array<StopItem & { stopId: string; stopAddress: string }> {
  if (!job.pickedUpAt && job.status !== 'in_transit') return []
  const out: Array<StopItem & { stopId: string; stopAddress: string }> = []
  for (const stop of jobStops(job)) {
    for (const item of stop.items) {
      if (item.receivedAt) continue
      const withRider = item.direction === 'in'
        ? stop.status === 'done' && item.status === 'done'
        : stop.status !== 'done' || item.status === 'not_done'
      if (withRider) out.push({ ...item, stopId: stop.id, stopAddress: stop.address })
    }
  }
  return out
}

/** Items to bring back once every stop is finished (what the office checks in). */
export const itemsToReturn = (job: TripJob) => (stopsFinished(job) ? carriedItems(job) : [])

export const stopsFinished = (job: TripJob) => jobStops(job).every(s => s.status !== 'pending')

/** Cash and M-Pesa the customers paid the rider on this trip. */
export function tripCashTotal(job: TripJob): number {
  if (!hasStops(job)) return Number(job.cashCollected?.amount) || 0
  return jobStops(job).reduce((t, s) => t + (Number(s.cashCollected?.amount) || 0), 0)
}

/** Unplanned items still waiting for the office to deal with them. */
export function openFollowUps(job: TripJob): Array<StopItem & { stopId: string; stopAddress: string }> {
  return jobStops(job).flatMap(stop => stop.items
    .filter(i => i.unplanned && i.status === 'done' && i.followUp?.status !== 'handled')
    .map(i => ({ ...i, stopId: stop.id, stopAddress: stop.address })))
}

/** "2 of 3 stops", for lists. */
export function stopProgress(job: TripJob): { done: number; total: number } {
  const stops = jobStops(job)
  return { done: stops.filter(s => s.status !== 'pending').length, total: stops.length }
}

/** Trip outcome once nothing is left with the rider: delivered if any stop was done. */
function finish(job: TripJob, at: string): TripJob {
  const stops = jobStops(job)
  if (stops.some(s => s.status === 'pending')) return job
  const anyDone = stops.some(s => s.status === 'done')
  const lastDone = [...stops].reverse().find(s => s.status === 'done')
  const failed = stops.filter(s => s.status === 'failed')
  const next: TripJob = { ...job, stopsFinishedAt: job.stopsFinishedAt ?? at }
  if (carriedItems(next).length > 0) return next // waits for the office to check items in
  return {
    ...next,
    status: anyDone ? 'delivered' : 'failed',
    deliveredAt: anyDone ? (job.deliveredAt ?? next.stopsFinishedAt) : job.deliveredAt,
    recipientName: lastDone?.recipientName ?? job.recipientName,
    failureReason: failed.length ? failed.map(s => s.failureReason).filter(Boolean).join('; ') : job.failureReason,
  }
}

const cleanCash = (cash: { amount: number; method: 'cash' | 'mpesa'; reference?: string } | undefined, at: string):
  { ok: true; cash?: TripCash } | { ok: false; error: string } => {
  if (!cash || !(Number(cash.amount) > 0)) return { ok: true }
  const amount = Math.round(Number(cash.amount) * 100) / 100
  if (!(amount > 0) || amount > 10_000_000) return { ok: false, error: 'Enter a valid amount' }
  const reference = String(cash.reference ?? '').trim().slice(0, 40)
  if (cash.method === 'mpesa' && !reference) return { ok: false, error: 'Enter the M-Pesa code for money sent to you' }
  return { ok: true, cash: { amount, method: cash.method === 'mpesa' ? 'mpesa' : 'cash', reference: reference || undefined, at } }
}

export type StopAction =
  | { action: 'stop_done'; stopId: string; recipientName: string; items?: Record<string, 'done' | 'not_done'>; cash?: { amount: number; method: 'cash' | 'mpesa'; reference?: string } }
  | { action: 'stop_failed'; stopId: string; reason: string }
  | { action: 'add_item'; stopId: string; description: string; serial?: string; qty?: number; reason: UnplannedReason; note?: string; billOnInvoice?: boolean; id: string }
  | { action: 'back_at_shop' }

type Result = { ok: true; job: TripJob } | { ok: false; error: string }

/** A rider's update to one stop of their trip. */
export function applyStopAction(job: TripJob, riderId: string, input: StopAction, at = new Date().toISOString()): Result {
  if (job.riderId !== riderId) return { ok: false, error: 'This job is not assigned to you' }
  if (!OPEN.has(job.status)) return { ok: false, error: `This job is already ${job.status.replace('_', ' ')}` }
  const stamp = (j: TripJob): TripJob => ({ ...j, riderUpdatedAt: at, tripUpdatedAt: at })

  if (input.action === 'back_at_shop') {
    if (!stopsFinished(job)) return { ok: false, error: 'Finish every stop first' }
    if (!carriedItems(job).length) return { ok: false, error: 'You are not carrying anything back' }
    return { ok: true, job: stamp({ ...job, backAtShopAt: job.backAtShopAt ?? at }) }
  }

  const stops = jobStops(job)
  const idx = stops.findIndex(s => s.id === input.stopId)
  if (idx === -1) return { ok: false, error: 'Stop not found' }
  const stop = stops[idx]
  // Started the trip: picked up implicitly by the first stop update.
  const base: TripJob = { ...job, status: 'in_transit', pickedUpAt: job.pickedUpAt ?? at }
  const withStop = (next: Stop): TripJob => ({ ...base, stops: stops.map((s, i) => (i === idx ? next : s)) })

  if (input.action === 'add_item') {
    if (stop.status === 'failed') return { ok: false, error: 'This stop was marked not done' }
    const description = input.description.trim()
    if (description.length < 2) return { ok: false, error: 'Say what the customer gave you' }
    if (stop.items.some(i => i.id === input.id)) return { ok: true, job } // repeated tap
    const qty = Math.max(1, Math.min(999, Math.round(Number(input.qty) || 1)))
    const item: StopItem = {
      id: input.id,
      direction: 'in',
      description: description.slice(0, 160),
      serial: input.serial?.trim().slice(0, 60) || undefined,
      qty,
      status: 'done',
      unplanned: {
        reason: input.reason,
        note: input.note?.trim().slice(0, 240) || undefined,
        billOnInvoice: input.billOnInvoice || undefined,
        at,
      },
      followUp: { status: 'open' },
    }
    const next = withStop({ ...stop, items: [...stop.items, item] })
    return { ok: true, job: stamp(stop.status === 'done' ? finish({ ...next, status: 'in_transit' }, at) : next) }
  }

  if (stop.status !== 'pending') return { ok: false, error: 'This stop is already finished' }

  if (input.action === 'stop_failed') {
    const reason = input.reason.trim()
    if (reason.length < 3) return { ok: false, error: 'Say why this stop could not be done' }
    const next = withStop({ ...stop, status: 'failed', doneAt: at, failureReason: reason.slice(0, 240) })
    return { ok: true, job: stamp(finish(next, at)) }
  }

  const name = input.recipientName.trim()
  if (name.length < 2) {
    return { ok: false, error: stop.kind === 'collect' ? 'Enter the name of the person who handed it over' : 'Enter the name of the person who received it' }
  }
  const cash = cleanCash(input.cash, at)
  if (!cash.ok) return cash
  const marks = input.items ?? {}
  const items = stop.items.map(i => (i.unplanned ? i : { ...i, status: marks[i.id] === 'not_done' ? 'not_done' as const : 'done' as const }))
  const next = withStop({
    ...stop,
    items,
    status: 'done',
    doneAt: at,
    recipientName: name.slice(0, 80),
    ...(cash.cash ? { cashCollected: cash.cash } : {}),
  })
  return { ok: true, job: stamp(finish(next, at)) }
}

/** Office: these carried items arrived back at the shop. Finishes the trip once nothing is left out. */
export function confirmReturn(job: TripJob, itemIds: string[], by: string, at = new Date().toISOString()): Result {
  if (!hasStops(job)) return { ok: false, error: 'This job has no items to check in' }
  const wanted = new Set(itemIds)
  const carried = new Set(carriedItems(job).map(i => i.id))
  const ids = [...wanted].filter(id => carried.has(id))
  if (!ids.length) return { ok: false, error: 'Tick the items that came back' }
  const stops = jobStops(job).map(s => ({
    ...s,
    items: s.items.map(i => (ids.includes(i.id) ? { ...i, receivedAt: at, receivedBy: by } : i)),
  }))
  let next: TripJob = { ...job, stops, tripUpdatedAt: at }
  if (stopsFinished(next) && carriedItems(next).length === 0) {
    next = finish({ ...next, returnConfirmedAt: at, returnConfirmedBy: by }, at)
  }
  return { ok: true, job: next }
}

/** Office: an unplanned item was dealt with (credit note, invoice line, repair booked in…). */
export function closeFollowUp(job: TripJob, itemId: string, note: string, by: string, at = new Date().toISOString()): Result {
  const text = note.trim()
  if (text.length < 3) return { ok: false, error: 'Say what was done, e.g. "Credit note CN/2026/0012"' }
  let found = false
  const stops = jobStops(job).map(s => ({
    ...s,
    items: s.items.map(i => {
      if (i.id !== itemId || !i.unplanned) return i
      found = true
      return { ...i, followUp: { status: 'handled' as const, note: text.slice(0, 240), by, at } }
    }),
  }))
  if (!found) return { ok: false, error: 'Item not found' }
  return { ok: true, job: { ...job, stops, tripUpdatedAt: at } }
}
