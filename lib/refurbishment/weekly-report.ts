/**
 * Weekly refurbishment report: what was finished in a week (Monday–Sunday,
 * Kenya time), what was still open at the end of it, and who did the work.
 * Pure — built from the refurbishment jobs the screen already holds.
 */

type Part = { partName: string; qty: number; estimatedCost: number; status: string }

export type ReportJob = {
  id: string
  ref: string
  status: 'queued' | 'assigned' | 'in_progress' | 'ready' | 'transferred' | 'written_off'
  serialNumber: string
  productName: string
  intakeDate: string
  intakeIssueDescription?: string
  assignedTechnicianId?: string
  assignedTechnicianName?: string
  assignedDate?: string
  startedDate?: string
  completedDate?: string
  transferDate?: string
  techNotes?: string
  partsNeeded: Part[]
  /** Cost booked as a loss when written off. */
  writeOffCost?: number
}

const EAT_MS = 3 * 3600_000
const DAY_MS = 86_400_000

/** Monday 00:00 Kenya time of the week holding `at`, as a YYYY-MM-DD date. */
export function refurbWeekStart(at: Date | string): string {
  const d = new Date(new Date(at).getTime() + EAT_MS)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** The week as UTC instants [from, to) and a label, e.g. "26 Oct – 1 Nov 2026". */
export function refurbWeekRange(weekStart: string): { from: number; to: number; label: string } {
  const from = Date.parse(`${weekStart}T00:00:00.000Z`) - EAT_MS
  const to = from + 7 * DAY_MS
  const fmt = (ms: number, year: boolean) => new Date(ms + EAT_MS).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC',
  })
  return { from, to, label: `${fmt(from, false)} – ${fmt(to - DAY_MS, true)}` }
}

const at = (iso?: string) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? null : t
}
const inWeek = (iso: string | undefined, from: number, to: number) => {
  const t = at(iso)
  return t !== null && t >= from && t < to
}
const days = (fromIso?: string, toMs?: number | null) => {
  const f = at(fromIso)
  if (f === null || toMs == null) return null
  return Math.max(0, Math.round((toMs - f) / DAY_MS * 10) / 10)
}

export const partsCost = (job: Pick<ReportJob, 'partsNeeded'>) =>
  Math.round(job.partsNeeded.reduce((s, p) => s + (Number(p.estimatedCost) || 0) * (Number(p.qty) || 0), 0))

/** Parts the job is still waiting for (asked for, on order) — the usual reason a machine sits. */
export const partsWaiting = (job: Pick<ReportJob, 'partsNeeded'>) =>
  job.partsNeeded.filter(p => p.status === 'requested' || p.status === 'ordered')

/** Where an open job stands, in words. */
export function pendingStage(job: ReportJob): string {
  if (job.status === 'queued') return job.assignedTechnicianName ? 'Queued (restored)' : 'Waiting for a technician'
  if (partsWaiting(job).length) return 'Waiting for parts'
  if (job.status === 'assigned') return 'Assigned — not started'
  if (job.status === 'in_progress') return 'In progress'
  if (job.status === 'ready') return 'Ready — not yet sent for retest'
  return job.status
}

export type CompletedRow = ReportJob & { daysToComplete: number | null; cost: number }
export type PendingRow = ReportJob & { ageDays: number | null; stage: string; cost: number; waitingParts: string[] }
export type TechRow = { name: string; completed: number; writtenOff: number; open: number; avgDays: number | null }

export type RefurbWeeklyReport = {
  weekStart: string
  label: string
  /** The week is the current one: open jobs are shown as they stand now. */
  isCurrentWeek: boolean
  received: ReportJob[]
  completed: CompletedRow[]
  sentForRetest: ReportJob[]
  writtenOff: CompletedRow[]
  pending: PendingRow[]
  pendingByStage: Array<{ stage: string; count: number }>
  technicians: TechRow[]
  totals: { received: number; completed: number; sentForRetest: number; writtenOff: number; pending: number; partsCostCompleted: number; avgDaysToComplete: number | null; writeOffValue: number }
}

export function buildRefurbWeeklyReport(jobs: ReportJob[], weekStart: string, now: Date = new Date()): RefurbWeeklyReport {
  const { from, to, label } = refurbWeekRange(weekStart)
  const nowMs = now.getTime()
  const isCurrentWeek = nowMs >= from && nowMs < to
  // Open at the end of the week (or now, for the current week): taken in by
  // then and not finished or written off by then. Jobs carry no status
  // history, so the date fields decide.
  const cutoff = isCurrentWeek ? nowMs : to

  const received = jobs.filter(j => inWeek(j.intakeDate, from, to))
  const completed: CompletedRow[] = jobs
    .filter(j => j.status !== 'written_off' && inWeek(j.completedDate, from, to))
    .map(j => ({ ...j, daysToComplete: days(j.intakeDate, at(j.completedDate)), cost: partsCost(j) }))
  const writtenOff: CompletedRow[] = jobs
    .filter(j => j.status === 'written_off' && inWeek(j.completedDate, from, to))
    .map(j => ({ ...j, daysToComplete: days(j.intakeDate, at(j.completedDate)), cost: partsCost(j) }))
  const sentForRetest = jobs.filter(j => inWeek(j.transferDate, from, to))

  const pending: PendingRow[] = jobs
    .filter(j => {
      const intake = at(j.intakeDate)
      if (intake === null || intake >= cutoff) return false
      const done = at(j.completedDate)
      return done === null || done >= cutoff
    })
    .map(j => ({
      ...j,
      ageDays: days(j.intakeDate, cutoff),
      stage: isCurrentWeek ? pendingStage(j) : 'Open at week end',
      cost: partsCost(j),
      waitingParts: partsWaiting(j).map(p => `${p.partName} × ${p.qty}`),
    }))
    .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0))

  const stageCounts = new Map<string, number>()
  for (const p of pending) stageCounts.set(p.stage, (stageCounts.get(p.stage) ?? 0) + 1)

  const techs = new Map<string, { name: string; completed: number; writtenOff: number; open: number; daysSum: number; daysN: number }>()
  const tech = (j: ReportJob) => {
    const key = j.assignedTechnicianId || j.assignedTechnicianName || ''
    if (!key) return null
    if (!techs.has(key)) techs.set(key, { name: j.assignedTechnicianName || 'Unknown', completed: 0, writtenOff: 0, open: 0, daysSum: 0, daysN: 0 })
    return techs.get(key)!
  }
  for (const c of completed) {
    const t = tech(c)
    if (!t) continue
    t.completed++
    if (c.daysToComplete != null) { t.daysSum += c.daysToComplete; t.daysN++ }
  }
  for (const w of writtenOff) { const t = tech(w); if (t) t.writtenOff++ }
  for (const p of pending) { const t = tech(p); if (t) t.open++ }
  const technicians: TechRow[] = [...techs.values()]
    .map(t => ({ name: t.name, completed: t.completed, writtenOff: t.writtenOff, open: t.open, avgDays: t.daysN ? Math.round(t.daysSum / t.daysN * 10) / 10 : null }))
    .sort((a, b) => b.completed - a.completed || b.open - a.open || a.name.localeCompare(b.name))

  const doneDays = completed.map(c => c.daysToComplete).filter((d): d is number => d != null)
  return {
    weekStart,
    label,
    isCurrentWeek,
    received,
    completed,
    sentForRetest,
    writtenOff,
    pending,
    pendingByStage: [...stageCounts].map(([stage, count]) => ({ stage, count })).sort((a, b) => b.count - a.count),
    technicians,
    totals: {
      received: received.length,
      completed: completed.length,
      sentForRetest: sentForRetest.length,
      writtenOff: writtenOff.length,
      pending: pending.length,
      partsCostCompleted: completed.reduce((s, c) => s + c.cost, 0),
      writeOffValue: Math.round(writtenOff.reduce((s, w) => s + (Number(w.writeOffCost) || 0), 0)),
      avgDaysToComplete: doneDays.length ? Math.round(doneDays.reduce((a, b) => a + b, 0) / doneDays.length * 10) / 10 : null,
    },
  }
}
