/**
 * The rider's own page: a personal link per rider, unlocked with a 4-digit
 * PIN (last 4 digits of their ID number, or of their phone when no ID is on
 * file). The rider sees only their own jobs, marks them picked up, delivered
 * (with the recipient's name) or not delivered (with a reason), records cash
 * a customer paid them, and sees their trips and pay by week.
 */
import crypto from 'node:crypto'
import { carriedItems, hasStops, jobStops, stopProgress, tripCashTotal, type Stop, type TripJob } from './trip'

export type RiderLike = {
  id: string
  name: string
  phone?: string
  idNumber?: string
  vehicle?: string
  active?: boolean
  ratePerDelivery?: number
  portalToken?: string
}

export type JobLike = {
  id: string
  ref: string
  type?: string
  status: string
  riderId?: string
  customerName?: string
  customerPhone?: string
  pickupAddress?: string
  deliveryAddress?: string
  scheduledDate?: string
  pickedUpAt?: string
  deliveredAt?: string
  riderFee?: number
  notes?: string
  failureReason?: string
  saleOrderRef?: string
  invoiceRef?: string
  repairOrderRef?: string
  recipientName?: string
  cashCollected?: { amount: number; method: 'cash' | 'mpesa'; reference?: string; at: string }
  /** When the rider last changed this job from their link. */
  riderUpdatedAt?: string
  stops?: Stop[]
  stopsFinishedAt?: string
  backAtShopAt?: string
  returnConfirmedAt?: string
  tripUpdatedAt?: string
}

export type PayLike = { riderId: string; weekStart: string; status: string; totalAmount?: number; paidDate?: string; jobIds?: string[] }

/** Digits only. */
const digits = (v?: string) => String(v ?? '').replace(/\D/g, '')

/** The PIN a rider types: last 4 digits of the ID number, else of the phone. */
export function riderPin(rider: Pick<RiderLike, 'idNumber' | 'phone'>): string | null {
  const id = digits(rider.idNumber)
  if (id.length >= 4) return id.slice(-4)
  const phone = digits(rider.phone)
  return phone.length >= 4 ? phone.slice(-4) : null
}

export function pinMatches(rider: Pick<RiderLike, 'idNumber' | 'phone'>, typed: unknown): boolean {
  const pin = riderPin(rider)
  const given = digits(typeof typed === 'string' || typeof typed === 'number' ? String(typed) : '')
  if (!pin || given.length !== 4) return false
  return crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(given))
}

export function newRiderToken(): string {
  return crypto.randomBytes(18).toString('base64url')
}

const sessionSecret = () => process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'deed-rider-portal'

/** Cookie value proving the PIN was entered for this rider and this link. Resetting the link ends it. */
export function riderSession(rider: Pick<RiderLike, 'id' | 'portalToken'>): string {
  return crypto.createHmac('sha256', sessionSecret()).update(`rider:${rider.id}:${rider.portalToken ?? ''}`).digest('base64url')
}

export function sessionValid(rider: Pick<RiderLike, 'id' | 'portalToken'>, cookie: string | undefined): boolean {
  if (!cookie || !rider.portalToken) return false
  const expected = riderSession(rider)
  return cookie.length === expected.length && crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(expected))
}

export const riderCookieName = (riderId: string) => `deed_rider_${riderId.replace(/[^A-Za-z0-9_-]/g, '')}`

/** Monday of the week (Nairobi time) a moment falls in, as YYYY-MM-DD. */
export function weekStartOf(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 3 * 3600_000) // EAT
  if (Number.isNaN(d.getTime())) return ''
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

const ACTIVE = new Set(['assigned', 'in_transit'])

/** What a rider may see of a job: no prices except their own fee. Phone only while the job is open. */
export function riderJobView(job: JobLike) {
  const open = ACTIVE.has(job.status)
  return {
    id: job.id,
    ref: job.ref,
    type: job.type ?? 'delivery',
    status: job.status,
    customerName: job.customerName ?? '',
    customerPhone: open ? (job.customerPhone ?? '') : '',
    pickupAddress: job.pickupAddress ?? '',
    deliveryAddress: job.deliveryAddress ?? '',
    scheduledDate: job.scheduledDate ?? '',
    pickedUpAt: job.pickedUpAt,
    deliveredAt: job.deliveredAt,
    notes: open ? (job.notes ?? '') : '',
    document: job.saleOrderRef || job.invoiceRef || job.repairOrderRef || '',
    fee: Number(job.riderFee) || 0,
    recipientName: job.recipientName,
    failureReason: job.failureReason,
    cashCollected: job.cashCollected,
    cashTotal: tripCashTotal(job as TripJob),
    // Stops: contact phones only while the trip is open.
    stops: jobStops(job as TripJob).map(s => ({
      id: s.id, kind: s.kind, address: s.address, contactName: s.contactName ?? '',
      contactPhone: open ? (s.contactPhone ?? '') : '', notes: open ? (s.notes ?? '') : '',
      status: s.status, doneAt: s.doneAt, recipientName: s.recipientName, failureReason: s.failureReason,
      cashCollected: s.cashCollected,
      items: s.items.map(i => ({
        id: i.id, direction: i.direction, description: i.description, serial: i.serial ?? '', qty: i.qty,
        status: i.status, unplanned: i.unplanned ? { reason: i.unplanned.reason, billOnInvoice: !!i.unplanned.billOnInvoice, note: i.unplanned.note ?? '' } : undefined,
        received: !!i.receivedAt,
      })),
    })),
    hasStops: hasStops(job as TripJob),
    progress: stopProgress(job as TripJob),
    carrying: carriedItems(job as TripJob).map(i => ({ id: i.id, description: i.description, serial: i.serial ?? '', qty: i.qty, direction: i.direction, stopAddress: i.stopAddress })),
    stopsFinished: !!job.stopsFinishedAt,
    backAtShopAt: job.backAtShopAt,
  }
}

export type RiderWeek = { weekStart: string; trips: number; earned: number; cashCollected: number; paid: boolean }

/** Trips by week, newest first: delivered jobs, what they earned, cash collected, and whether the week was paid. */
export function riderWeeks(riderId: string, jobs: JobLike[], pays: PayLike[], weeks = 8, now = new Date().toISOString()): RiderWeek[] {
  const out = new Map<string, RiderWeek>()
  const current = weekStartOf(now)
  for (let i = 0; i < weeks; i++) {
    const d = new Date(`${current}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - i * 7)
    const key = d.toISOString().slice(0, 10)
    out.set(key, { weekStart: key, trips: 0, earned: 0, cashCollected: 0, paid: false })
  }
  for (const job of jobs) {
    if (job.riderId !== riderId || job.status !== 'delivered' || !job.deliveredAt) continue
    const w = out.get(weekStartOf(job.deliveredAt))
    if (!w) continue
    w.trips += 1
    w.earned += Number(job.riderFee) || 0
    w.cashCollected += tripCashTotal(job as TripJob)
  }
  for (const pay of pays) {
    if (pay.riderId !== riderId || pay.status !== 'paid') continue
    const w = out.get(pay.weekStart)
    if (w) w.paid = true
  }
  return [...out.values()]
}

export type RiderAction =
  | { action: 'picked_up' }
  | { action: 'delivered'; recipientName: string; cash?: { amount: number; method: 'cash' | 'mpesa'; reference?: string } }
  | { action: 'failed'; reason: string }

/** Apply a rider's update to a job, or say why it cannot be done. */
export function applyRiderAction(job: JobLike, riderId: string, input: RiderAction, at = new Date().toISOString()):
  { ok: true; job: JobLike } | { ok: false; error: string } {
  if (job.riderId !== riderId) return { ok: false, error: 'This job is not assigned to you' }
  if (!ACTIVE.has(job.status)) return { ok: false, error: `This job is already ${job.status.replace('_', ' ')}` }
  if (input.action !== 'picked_up' && hasStops(job as TripJob)) return { ok: false, error: 'This trip has several stops: update each stop' }
  if (input.action === 'picked_up') {
    if (job.status === 'in_transit') return { ok: true, job }
    return { ok: true, job: { ...job, status: 'in_transit', pickedUpAt: at, riderUpdatedAt: at, tripUpdatedAt: at } }
  }
  if (input.action === 'delivered') {
    const name = input.recipientName.trim()
    if (name.length < 2) return { ok: false, error: 'Enter the name of the person who received it' }
    let cash: JobLike['cashCollected']
    if (input.cash && Number(input.cash.amount) > 0) {
      const amount = Math.round(Number(input.cash.amount) * 100) / 100
      if (!(amount > 0) || amount > 10_000_000) return { ok: false, error: 'Enter a valid amount' }
      if (input.cash.method === 'mpesa' && !String(input.cash.reference ?? '').trim()) {
        return { ok: false, error: 'Enter the M-Pesa code for money sent to you' }
      }
      cash = { amount, method: input.cash.method, reference: String(input.cash.reference ?? '').trim().slice(0, 40) || undefined, at }
    }
    return {
      ok: true,
      job: {
        ...job,
        status: 'delivered',
        pickedUpAt: job.pickedUpAt ?? at,
        deliveredAt: at,
        recipientName: name.slice(0, 80),
        ...(cash ? { cashCollected: cash } : {}),
        riderUpdatedAt: at,
        tripUpdatedAt: at,
      },
    }
  }
  const reason = input.reason.trim()
  if (reason.length < 3) return { ok: false, error: 'Say why it could not be delivered' }
  return { ok: true, job: { ...job, status: 'failed', failureReason: reason.slice(0, 240), riderUpdatedAt: at, tripUpdatedAt: at } }
}
