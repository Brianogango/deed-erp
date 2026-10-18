/**
 * CRM report for a period: how leads turned into deals and sales, how fast
 * each rep answered, and why business was lost. Pure — the route hands in
 * rows from the leads and opportunities tables.
 */

type LeadRow = {
  id: string
  source?: string | null
  stage: string
  ownerId?: string | null
  createdAt: Date | string
  activity?: unknown
}

type DealRow = {
  id: string
  stage: string
  value?: unknown
  assignedToId?: string | null
  createdById?: string | null
  createdAt: Date | string
  screenExtras?: unknown
}

type Activity = { type?: string; at?: string; note?: string }

const CONTACT = new Set(['call', 'email', 'whatsapp', 'meeting'])
const WON = new Set(['closed_won', 'won'])
const LOST = new Set(['closed_lost', 'lost'])
const HOUR = 3_600_000
const DAY = 24 * HOUR

const time = (v: unknown) => new Date(String(v ?? '')).getTime()
const money = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function activities(lead: LeadRow): Activity[] {
  return Array.isArray(lead.activity) ? (lead.activity as Activity[]) : []
}

/** Hours from arrival to the first call / email / WhatsApp / meeting, or null. */
export function firstResponseHours(lead: LeadRow): number | null {
  const created = time(lead.createdAt)
  const contacts = activities(lead)
    .filter(a => CONTACT.has(String(a.type)) && Number.isFinite(time(a.at)))
    .map(a => time(a.at))
  if (!contacts.length || !Number.isFinite(created)) return null
  return Math.max(0, (Math.min(...contacts) - created) / HOUR)
}

/** "Marked lost: price too high" → "price too high". */
function leadLostReason(lead: LeadRow): string | null {
  const note = activities(lead).find(a => String(a.note ?? '').startsWith('Marked lost:'))?.note
  return note ? note.slice('Marked lost:'.length).trim() || null : null
}

/** Group free-text reasons loosely: case and punctuation do not split them. */
function reasonKey(reason: string) {
  return reason.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function tally(reasons: string[]) {
  const by = new Map<string, { reason: string; count: number }>()
  for (const r of reasons) {
    const key = reasonKey(r)
    if (!key) continue
    const hit = by.get(key)
    if (hit) hit.count++
    else by.set(key, { reason: r, count: 1 })
  }
  return [...by.values()].sort((a, b) => b.count - a.count).slice(0, 10)
}

const extras = (d: DealRow) => (d.screenExtras && typeof d.screenExtras === 'object' ? d.screenExtras as Record<string, unknown> : {})
const dealOwner = (d: DealRow) => d.assignedToId || d.createdById || null

export type CrmReport = ReturnType<typeof buildCrmReport>

export function buildCrmReport(input: {
  leads: LeadRow[]
  deals: DealRow[]
  from: Date
  to: Date
  reps: Array<{ id: string; name: string }>
}) {
  const from = input.from.getTime()
  const to = input.to.getTime()
  const inPeriod = (v: unknown) => { const t = time(v); return t >= from && t <= to }

  const leads = input.leads.filter(l => inPeriod(l.createdAt))
  const converted = leads.filter(l => l.stage === 'converted')
  const lostLeads = leads.filter(l => l.stage === 'lost')
  const responses = leads.map(firstResponseHours).filter((h): h is number => h !== null)
  const within24 = responses.filter(h => h <= 24).length

  // Deals closed in the period (by close date), and deals opened in it.
  const closeTime = (d: DealRow) => time(extras(d).actualCloseDate) || time(d.createdAt)
  const closed = input.deals.filter(d => (WON.has(d.stage) || LOST.has(d.stage)) && inPeriod(new Date(closeTime(d))))
  const won = closed.filter(d => WON.has(d.stage))
  const lost = closed.filter(d => LOST.has(d.stage))
  const wonValue = (d: DealRow) => money(extras(d).actualValue ?? d.value)
  const open = input.deals.filter(d => !WON.has(d.stage) && !LOST.has(d.stage))
  // The close date is a day with no time: a deal won the day it opened is 0 days, not negative.
  const daysToClose = won.map(d => Math.max(0, (closeTime(d) - time(d.createdAt)) / DAY)).filter(n => Number.isFinite(n))

  const bySource = new Map<string, { source: string; leads: number; converted: number }>()
  for (const l of leads) {
    const source = l.source || 'not set'
    const row = bySource.get(source) ?? { source, leads: 0, converted: 0 }
    row.leads++
    if (l.stage === 'converted') row.converted++
    bySource.set(source, row)
  }

  const pipeline = new Map<string, { stage: string; deals: number; value: number }>()
  for (const d of open) {
    const row = pipeline.get(d.stage) ?? { stage: d.stage, deals: 0, value: 0 }
    row.deals++
    row.value = money(row.value + money(d.value))
    pipeline.set(d.stage, row)
  }

  const repName = new Map(input.reps.map(r => [r.id, r.name]))
  const repIds = new Set<string>([
    ...leads.map(l => l.ownerId).filter(Boolean) as string[],
    ...closed.map(dealOwner).filter(Boolean) as string[],
  ])
  const byRep = [...repIds].map(id => {
    const mine = leads.filter(l => l.ownerId === id)
    const hours = mine.map(firstResponseHours).filter((h): h is number => h !== null)
    const myWon = won.filter(d => dealOwner(d) === id)
    const myLost = lost.filter(d => dealOwner(d) === id)
    return {
      id,
      name: repName.get(id) ?? 'Unknown',
      leads: mine.length,
      notContacted: mine.filter(l => !['converted', 'lost'].includes(l.stage) && firstResponseHours(l) === null).length,
      medianFirstResponseHours: median(hours),
      contactedWithin24h: pct(hours.filter(h => h <= 24).length, mine.length),
      converted: mine.filter(l => l.stage === 'converted').length,
      dealsWon: myWon.length,
      dealsLost: myLost.length,
      wonValue: money(myWon.reduce((s, d) => s + wonValue(d), 0)),
      winRate: pct(myWon.length, myWon.length + myLost.length),
    }
  }).sort((a, b) => b.wonValue - a.wonValue || b.leads - a.leads)

  return {
    period: { from: input.from.toISOString(), to: input.to.toISOString() },
    leads: {
      created: leads.length,
      converted: converted.length,
      lost: lostLeads.length,
      unassigned: leads.filter(l => !l.ownerId).length,
      conversionRate: pct(converted.length, leads.length),
      medianFirstResponseHours: median(responses),
      contactedWithin24h: pct(within24, leads.length),
      neverContacted: leads.filter(l => !['converted', 'lost'].includes(l.stage) && firstResponseHours(l) === null).length,
      bySource: [...bySource.values()].sort((a, b) => b.leads - a.leads)
        .map(r => ({ ...r, conversionRate: pct(r.converted, r.leads) })),
      lostReasons: tally(lostLeads.map(leadLostReason).filter((r): r is string => Boolean(r))),
    },
    deals: {
      won: won.length,
      lost: lost.length,
      wonValue: money(won.reduce((s, d) => s + wonValue(d), 0)),
      lostValue: money(lost.reduce((s, d) => s + money(d.value), 0)),
      winRate: pct(won.length, won.length + lost.length),
      medianDaysToClose: median(daysToClose),
      openCount: open.length,
      openValue: money(open.reduce((s, d) => s + money(d.value), 0)),
      pipeline: [...pipeline.values()],
      lostReasons: tally(lost.map(d => String(extras(d).lostReason ?? '')).filter(Boolean)),
    },
    byRep,
  }
}
