import type { Candidate, CandidateStage, Employee, JobPosting } from '@/lib/store'

export const PIPELINE_STAGES: Array<{ id: CandidateStage; label: string }> = [
  { id: 'applied', label: 'Applied' },
  { id: 'screening', label: 'Screening' },
  { id: 'interview', label: 'Interview' },
  { id: 'offered', label: 'Offered' },
  { id: 'hired', label: 'Hired' },
  { id: 'rejected', label: 'Rejected' },
]

export const REJECTION_REASONS = [
  'Not enough experience',
  'Skills do not match the role',
  'Salary expectations too high',
  'Failed the interview',
  'Withdrew from the process',
  'Declined the offer',
  'Position filled',
  'Other',
]

export const stageLabel = (s: CandidateStage) => PIPELINE_STAGES.find(x => x.id === s)?.label ?? s

/** Last nine digits of a phone number, so +254 712 345 678 and 0712345678 compare equal. */
export const phoneKey = (phone: string) => String(phone ?? '').replace(/\D/g, '').slice(-9)
export const emailKey = (email: string) => String(email ?? '').trim().toLowerCase()

/** Candidates already on file with the same email or phone (any job), excluding `selfId`. */
export function findDuplicates(candidates: Candidate[], draft: { email: string; phone: string }, selfId?: string): Candidate[] {
  const e = emailKey(draft.email)
  const p = phoneKey(draft.phone)
  return candidates.filter(c => c.id !== selfId && ((e && emailKey(c.email) === e) || (p.length >= 9 && phoneKey(c.phone) === p)))
}

export function groupByStage(candidates: Candidate[]): Record<CandidateStage, Candidate[]> {
  const out = Object.fromEntries(PIPELINE_STAGES.map(s => [s.id, [] as Candidate[]])) as Record<CandidateStage, Candidate[]>
  for (const c of candidates) (out[c.stage] ?? out.applied).push(c)
  return out
}

export interface JobFunnel { total: number; active: number; hired: number; rejected: number; openings: number; filled: boolean }

export function jobFunnel(job: JobPosting, candidates: Candidate[]): JobFunnel {
  const mine = candidates.filter(c => c.jobId === job.id)
  const hired = mine.filter(c => c.stage === 'hired').length
  const rejected = mine.filter(c => c.stage === 'rejected').length
  const openings = Math.max(1, Number(job.openings) || 1)
  return { total: mine.length, active: mine.length - hired - rejected, hired, rejected, openings, filled: hired >= openings }
}

/** Next free EMP-### number given the existing employee numbers. */
export function nextEmployeeNumber(employees: Pick<Employee, 'employeeNo'>[]): string {
  let max = 0
  let width = 3
  for (const e of employees) {
    const m = /^EMP-(\d+)$/i.exec(e.employeeNo ?? '')
    if (!m) continue
    max = Math.max(max, Number(m[1]))
    width = Math.max(width, m[1].length)
  }
  return `EMP-${String(max + 1).padStart(width, '0')}`
}

export function averageRating(candidate: Candidate): number | null {
  const scores = (candidate.interviews ?? []).filter(i => i.status === 'done' && i.rating).map(i => Number(i.rating))
  if (!scores.length) return candidate.rating ?? null
  return Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 10) / 10
}

/** Days since the candidate last moved stage (or applied); highlights stalled applications. */
export function daysInStage(candidate: Candidate, today: Date = new Date()): number {
  const since = new Date(candidate.stageChangedDate || candidate.appliedDate)
  if (Number.isNaN(since.getTime())) return 0
  return Math.max(0, Math.floor((today.getTime() - since.getTime()) / 86400000))
}
