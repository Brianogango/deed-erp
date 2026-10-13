/**
 * Machines registered on a trade-in screen whose trade-in was never saved.
 *
 * Registering a customer's serial (buy-back, exchange, donation-in form)
 * saves it at once as "sold / with customer"; the trade-in record is only
 * saved when the form is submitted. Leave the form half-way and the machine
 * stays registered with nothing holding it — how a Dragonfly sat unnoticed
 * for 11 days. Pure: the page hands in the lists and "now".
 */

type Any = Record<string, any>

/** Screens whose serial intake should end in a trade-in record. */
export const TRADE_IN_INTAKE_SOURCES = new Set(['buyback', 'buyback-bulk', 'exchange', 'exchange-bulk', 'donation-in', 'trade-in'])

const DAY = 86_400_000
const time = (v: unknown) => {
  const t = new Date(String(v ?? '')).getTime()
  return Number.isFinite(t) ? t : NaN
}

/**
 * Registered through a trade-in screen: marked by the screen it came from,
 * or (serials registered before that mark existed) sold to "customer" the
 * same minute it was received, with no sale order.
 */
export function isTradeInIntake(s: Any): boolean {
  if (s.intakeSource) return TRADE_IN_INTAKE_SOURCES.has(String(s.intakeSource))
  if (s.status !== 'sold' || s.location !== 'customer' || s.saleOrderId) return false
  const received = time(s.receivedDate)
  const sold = time(s.soldDate)
  return Number.isFinite(received) && Number.isFinite(sold) && Math.abs(sold - received) < 60_000
}

export function findOrphanTradeInSerials(input: {
  serials: Any[]
  buyBacks?: Any[]
  clientExchanges?: Any[]
  donations?: Any[]
  returnOrders?: Any[]
  now: Date
  /** How long a registered machine may wait for its trade-in (default one day). */
  graceMs?: number
}): Any[] {
  const held = new Set<string>()
  const hold = (lines: unknown) => {
    if (!Array.isArray(lines)) return
    for (const l of lines) for (const id of (Array.isArray(l?.serialIds) ? l.serialIds : [])) held.add(String(id))
  }
  for (const b of input.buyBacks ?? []) hold(b.lines)
  for (const e of input.clientExchanges ?? []) { hold(e.returnLines); hold(e.newLines) }
  for (const d of input.donations ?? []) hold(d.lines)
  for (const r of input.returnOrders ?? []) hold(r.lines)
  const cutoff = input.now.getTime() - (input.graceMs ?? DAY)
  return input.serials.filter(s =>
    s.status === 'sold' && s.location === 'customer'
    && isTradeInIntake(s)
    && !held.has(String(s.id))
    && time(s.receivedDate) <= cutoff)
}
