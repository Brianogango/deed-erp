/**
 * Outsource job rules that do not touch the store: promised return dates,
 * the vendor scorecard, the customer's charge for outsourced work and the
 * handover slip the vendor signs.
 */
import { outsourceDaysOut, isOutsourceOverdue } from './outsource-visibility'

/** Days a vendor usually needs, by service. Sets the promised date; it can be changed per job. */
export const OUTSOURCE_TURNAROUND_DAYS: Record<string, number> = {
  bios_repair: 3,
  power_repair: 5,
  body_works: 7,
  laptop_skin: 2,
  screen_replacement: 3,
  keyboard_repair: 3,
  motherboard_repair: 14,
  data_recovery: 10,
  charging_port: 3,
  other: 7,
}

/** Markup on the vendor's cost when it is passed to the customer. */
export const OUTSOURCE_DEFAULT_MARKUP_PCT = 30

function isoDay(raw: string): string | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const t = Date.parse(text.length === 10 ? `${text}T00:00:00Z` : text)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString().slice(0, 10)
}

/** The sent date plus the service's usual turnaround, as YYYY-MM-DD. */
export function defaultExpectedReturnDate(sentDate: string, serviceType: string): string {
  const start = isoDay(sentDate)
  if (!start) return ''
  const days = OUTSOURCE_TURNAROUND_DAYS[serviceType] ?? OUTSOURCE_TURNAROUND_DAYS.other
  const t = Date.parse(`${start}T00:00:00Z`) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** Vendor cost plus markup, rounded up to the next 50 shillings. */
export function suggestedCustomerCharge(vendorCost: number, markupPct = OUTSOURCE_DEFAULT_MARKUP_PCT): number {
  const cost = Number(vendorCost)
  if (!Number.isFinite(cost) || cost <= 0) return 0
  return Math.ceil((cost * (1 + markupPct / 100)) / 50) * 50
}

type ScoreJob = {
  vendorId?: string | null
  status?: string | null
  isResolved?: boolean | null
  sentDate?: string | null
  createdAt?: string | null
  returnedDate?: string | null
  expectedReturnDate?: string | null
  quotedCost?: number | null
  finalCost?: number | null
}

export type VendorScorecard = {
  jobs: number
  out: number
  overdueNow: number
  returned: number
  fixed: number
  /** Fixed ÷ returned, in percent; null until something has come back. */
  fixRate: number | null
  avgDaysOut: number | null
  /** Returned on or before the promised date, in percent of returns that had one. */
  onTimeRate: number | null
  /** Returns that cost more than quoted. */
  overQuote: number
  /** Average final cost against quote, in percent (+12 = 12% over), on jobs with both. */
  avgCostVsQuotePct: number | null
  spent: number
}

/** How a vendor has done: what came back fixed, how fast, and how close to the quote. */
export function vendorScorecard(vendorId: string, jobs: ScoreJob[], now: Date = new Date()): VendorScorecard {
  const mine = (jobs ?? []).filter(j => j?.vendorId === vendorId && j.status !== 'cancelled')
  const returned = mine.filter(j => j.status === 'returned_resolved' || j.status === 'returned_unresolved')
  const fixed = returned.filter(j => j.status === 'returned_resolved' || j.isResolved)
  const durations = returned
    .map(j => (j.returnedDate ? outsourceDaysOut({ sentDate: j.sentDate, createdAt: j.createdAt }, new Date(`${isoDay(j.returnedDate) ?? ''}T12:00:00Z`)) : null))
    .filter((d): d is number => d !== null && Number.isFinite(d))
  const promised = returned.filter(j => j.expectedReturnDate && j.returnedDate)
  const onTime = promised.filter(j => (isoDay(j.returnedDate!) ?? '') <= (isoDay(j.expectedReturnDate!) ?? ''))
  const quoted = returned.filter(j => Number(j.quotedCost) > 0 && j.finalCost != null)
  const ratios = quoted.map(j => (Number(j.finalCost) - Number(j.quotedCost)) / Number(j.quotedCost) * 100)
  return {
    jobs: mine.length,
    out: mine.filter(j => j.status === 'sent').length,
    overdueNow: mine.filter(j => isOutsourceOverdue(j, now)).length,
    returned: returned.length,
    fixed: fixed.length,
    fixRate: returned.length ? Math.round((fixed.length / returned.length) * 100) : null,
    avgDaysOut: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    onTimeRate: promised.length ? Math.round((onTime.length / promised.length) * 100) : null,
    overQuote: quoted.filter(j => Number(j.finalCost) > Number(j.quotedCost)).length,
    avgCostVsQuotePct: ratios.length ? Math.round(ratios.reduce((a, b) => a + b, 0) / ratios.length) : null,
    spent: returned.reduce((sum, j) => sum + (Number(j.finalCost) || 0), 0),
  }
}

/** Where a repair stands when its machine comes back not fixed and the user chose "keep". */
export function statusAfterUnfixedReturn(
  nextStep: 'keep' | 'in_repair' | 'unrepairable' | undefined,
  previousStatus: string | undefined,
): string {
  if (nextStep === 'unrepairable') return 'unrepairable'
  if (nextStep === 'in_repair') return 'in_repair'
  // "Keep": back where it was before it went out (sending it locked it at in_repair).
  return previousStatus && previousStatus !== 'unrepairable' ? previousStatus : 'in_repair'
}

const esc = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export type HandoverSlipInput = {
  companyName: string
  jobRef: string
  vendorName: string
  vendorPhone?: string
  deviceDescription: string
  serial?: string
  serviceLabel: string
  issueDescription: string
  accessories?: string
  quotedCost?: number
  sentDate: string
  expectedReturnDate?: string
  sentByName: string
  repairRef?: string
  fmtKes: (n: number) => string
  fmtDate: (d: string) => string
}

/**
 * A printable page listing what was handed to the vendor, with spaces for
 * both signatures. When a machine goes missing at a vendor, this is the proof
 * it was given to them and in what state.
 */
export function outsourceHandoverSlipHtml(p: HandoverSlipInput): string {
  const row = (label: string, value: string | undefined) =>
    value ? `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>` : ''
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(p.jobRef)} handover</title>
<style>
  body { font: 12px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #172033; margin: 28px; }
  h1 { font-size: 13px; font-weight: 700; margin: 0 0 2px; }
  .sub { color: #667085; margin: 0 0 18px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  th, td { text-align: left; vertical-align: top; padding: 7px 8px; border-bottom: 1px solid #e2e7ee; }
  th { width: 34%; color: #475467; font-weight: 600; }
  .terms { font-size: 12px; color: #475467; margin: 0 0 28px; }
  .signs { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
  .sign { border-top: 1px solid #172033; padding-top: 6px; font-size: 12px; }
  @media print { body { margin: 12mm; } }
</style></head>
<body>
  <h1>${esc(p.companyName)} — device handover to repair vendor</h1>
  <p class="sub">${esc(p.jobRef)} · ${esc(p.fmtDate(p.sentDate))}</p>
  <table>
    ${row('Vendor', [p.vendorName, p.vendorPhone].filter(Boolean).join(' · '))}
    ${row('Device', p.deviceDescription)}
    ${row('Serial / IMEI', p.serial)}
    ${row('Our repair job', p.repairRef)}
    ${row('Service', p.serviceLabel)}
    ${row('Fault / work to do', p.issueDescription)}
    ${row('Handed over with', p.accessories || 'Device only')}
    ${row('Quoted cost', p.quotedCost != null && p.quotedCost > 0 ? p.fmtKes(p.quotedCost) : undefined)}
    ${row('Promised back by', p.expectedReturnDate ? p.fmtDate(p.expectedReturnDate) : undefined)}
    ${row('Sent by', p.sentByName)}
  </table>
  <p class="terms">The vendor confirms receiving the device and items above in the condition described, and will return them to ${esc(p.companyName)}. Any cost above the quote is agreed with ${esc(p.companyName)} before the work is done.</p>
  <div class="signs">
    <div class="sign">Handed over by (${esc(p.companyName)}) — name, signature, date</div>
    <div class="sign">Received by (${esc(p.vendorName)}) — name, signature, date</div>
  </div>
  <script>window.onload = () => { window.print(); }</script>
</body></html>`
}

type StockSerialLike = {
  id: string
  serial: string
  barcode?: string
  productId: string
  productName: string
  location: string
  status: string
}

const NOT_IN_STOCK = new Set(['sold', 'written_off', 'returned', 'capitalised'])
const NOT_HERE = new Set(['customer', 'vendor', 'employee'])

/**
 * A machine of ours (not a customer's) with this serial, still on the
 * premises. Sending it out moves it to the Vendor location, so stock does not
 * show it in the warehouse while it is away.
 */
export function findStockSerialForOutsource<T extends StockSerialLike>(serials: T[] | null | undefined, serialText: string | null | undefined): T | undefined {
  const wanted = String(serialText ?? '').trim().toLowerCase()
  if (!wanted) return undefined
  return (serials ?? []).find(s =>
    s && !NOT_IN_STOCK.has(s.status) && !NOT_HERE.has(s.location)
    && (String(s.serial ?? '').trim().toLowerCase() === wanted || String(s.barcode ?? '').trim().toLowerCase() === wanted))
}

// ── Weekly vendor statements ────────────────────────────────────────────────

/** Monday and Sunday (YYYY-MM-DD) of the week a date falls in. */
export function weekOf(date: string): { weekStart: string; weekEnd: string } | null {
  const day = isoDay(date)
  if (!day) return null
  const t = Date.parse(`${day}T00:00:00Z`)
  const dow = (new Date(t).getUTCDay() + 6) % 7 // Monday = 0
  const start = t - dow * 86_400_000
  return {
    weekStart: new Date(start).toISOString().slice(0, 10),
    weekEnd: new Date(start + 6 * 86_400_000).toISOString().slice(0, 10),
  }
}

type StatementJob = {
  id: string
  ref: string
  vendorId: string
  status: string
  returnedDate?: string
  finalCost?: number
  billId?: string
  statementId?: string
  billingHold?: unknown
  vendorName?: string
  deviceDescription: string
  serviceType: string
}

/**
 * A returned job that belongs on its vendor's weekly statement: back (fixed
 * or not), the vendor charged for it, and not already billed, on a statement
 * or held back.
 */
export function needsWeeklyBilling(job: StatementJob): boolean {
  return (job.status === 'returned_resolved' || job.status === 'returned_unresolved')
    && Number(job.finalCost) > 0
    && !!weekOf(job.returnedDate ?? '')
    && !job.billId && !job.statementId && !job.billingHold
}

export type StatementPlan = {
  vendorId: string
  weekStart: string
  weekEnd: string
  jobs: StatementJob[]
}

/**
 * Last week's and earlier weeks' unbilled jobs, grouped by vendor and the week
 * they came back. The current week is left open until it ends: a statement is
 * prepared on the Monday after.
 */
export function planWeeklyStatements(
  jobs: StatementJob[],
  weeklyVendorIds: Set<string>,
  today: Date = new Date(),
): StatementPlan[] {
  const thisWeek = weekOf(today.toISOString().slice(0, 10))!.weekStart
  const groups = new Map<string, StatementPlan>()
  for (const job of jobs ?? []) {
    if (!weeklyVendorIds.has(job.vendorId) || !needsWeeklyBilling(job)) continue
    const week = weekOf(job.returnedDate!)!
    if (week.weekStart >= thisWeek) continue
    const key = `${job.vendorId}|${week.weekStart}`
    const group = groups.get(key) ?? { vendorId: job.vendorId, ...week, jobs: [] }
    group.jobs.push(job)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.vendorId.localeCompare(b.vendorId))
}

/** The bill account for outsourced repair work. */
export const OUTSOURCE_COST_ACCOUNT = { code: '6301', name: "Solutions and Expert Repair Services' Costs" }
