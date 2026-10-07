/**
 * Where an outsourced machine is, and how long it has been there.
 *
 * Outsourcing a repair holds it at "In repair", so in the Repairs list it sits
 * among jobs on Deed's own benches. The vendor's name only appeared in the
 * Location column, the first one dropped on a narrower screen, so a machine
 * with a vendor looked like one in the shop. Five jobs sent to Fastech in early
 * June were still open in late September: either those machines never came
 * back, or they came back and nobody marked the return. Either way it went
 * unnoticed for four months because nothing measured the time out.
 */

export const OUTSOURCE_OVERDUE_DAYS = 7

type OutsourceJobLike = {
  repairOrderId?: string | null
  status?: string | null
  vendorName?: string | null
  sentDate?: string | null
  createdAt?: string | null
  ref?: string | null
}

/** The job currently holding a repair's machine, if any. */
export function activeOutsourceJob<T extends OutsourceJobLike>(
  repairId: string | null | undefined,
  jobs: T[] | null | undefined,
): T | undefined {
  if (!repairId) return undefined
  return (jobs ?? []).find(job => job?.repairOrderId === repairId && job.status === 'sent')
}

/** Whole days since the machine left. Counts calendar days in Nairobi-agnostic UTC. */
export function outsourceDaysOut(job: OutsourceJobLike, now: Date = new Date()): number | null {
  const raw = String(job.sentDate || job.createdAt || '').trim()
  if (!raw) return null
  const sent = Date.parse(raw.length === 10 ? `${raw}T00:00:00Z` : raw)
  if (!Number.isFinite(sent)) return null
  const day = 86_400_000
  const startOfSent = Math.floor(sent / day)
  const startOfToday = Math.floor(now.getTime() / day)
  return Math.max(0, startOfToday - startOfSent)
}

export function isOutsourceOverdue(job: OutsourceJobLike, now: Date = new Date()): boolean {
  if (job.status !== 'sent') return false
  const days = outsourceDaysOut(job, now)
  return days !== null && days > OUTSOURCE_OVERDUE_DAYS
}

export function formatDaysOut(days: number | null): string {
  if (days === null) return ''
  if (days === 0) return 'today'
  return days === 1 ? '1 day' : `${days} days`
}

/**
 * "12 days at Fastech Technologies" — the line under a repair's status. The
 * days come first: in a narrow column the end of the line is what gets cut,
 * and how long it has been away is the part worth reading.
 */
export function outsourceBadgeLabel(job: OutsourceJobLike, now: Date = new Date()): string {
  const vendor = String(job.vendorName ?? '').replace(/\s*\(.*\)\s*$/, '').trim() || 'a vendor'
  const days = outsourceDaysOut(job, now)
  if (days === null) return `At ${vendor}`
  if (days === 0) return `Sent today to ${vendor}`
  return `${formatDaysOut(days)} at ${vendor}`
}

export function outsourcedRepairCounts(
  repairs: { id: string }[],
  jobs: OutsourceJobLike[],
  now: Date = new Date(),
): { out: number; overdue: number } {
  let out = 0
  let overdue = 0
  for (const repair of repairs ?? []) {
    const job = activeOutsourceJob(repair.id, jobs)
    if (!job) continue
    out += 1
    if (isOutsourceOverdue(job, now)) overdue += 1
  }
  return { out, overdue }
}
