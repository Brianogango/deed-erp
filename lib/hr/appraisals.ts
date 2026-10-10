/** Performance review rules shared by the API and the screens. */

export type AppraisalStatus = 'pending_self' | 'pending_manager' | 'completed'

export interface Goal {
  id: string
  title: string
  /** Share of the overall score, 0 to 100. Weights are normalised, so they need not add to 100. */
  weight: number
  selfScore?: number
  managerScore?: number
}

export const STATUS_LABEL: Record<AppraisalStatus, string> = {
  pending_self: 'Waiting for self-assessment',
  pending_manager: 'Waiting for manager review',
  completed: 'Completed',
}

export const RATING_LABEL: Record<number, string> = { 1: 'Needs improvement', 2: 'Below expectations', 3: 'Meets expectations', 4: 'Exceeds expectations', 5: 'Outstanding' }

export const isScore = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5

/** Clean a goals array from the client: at most 12, titled, weights 0 to 100, scores 1 to 5 or dropped. */
export function sanitizeGoals(input: unknown): Goal[] {
  if (!Array.isArray(input)) return []
  const out: Goal[] = []
  for (const raw of input.slice(0, 12)) {
    const g = (raw ?? {}) as Record<string, unknown>
    const title = String(g.title ?? '').trim().slice(0, 160)
    if (!title) continue
    const id = String(g.id ?? '').slice(0, 60) || `g${out.length + 1}`
    const weight = Math.min(100, Math.max(0, Number(g.weight) || 0))
    const goal: Goal = { id, title, weight }
    if (isScore(Number(g.selfScore))) goal.selfScore = Number(g.selfScore)
    if (isScore(Number(g.managerScore))) goal.managerScore = Number(g.managerScore)
    out.push(goal)
  }
  return out
}

/** Weighted average of one side's scores (1 to 5), or null when nothing is scored. Unweighted goals count equally. */
export function weightedScore(goals: Goal[], side: 'selfScore' | 'managerScore'): number | null {
  const scored = goals.filter(g => isScore(g[side]))
  if (scored.length === 0) return null
  const totalWeight = scored.reduce((s, g) => s + g.weight, 0)
  const total = totalWeight > 0
    ? scored.reduce((s, g) => s + (g[side] as number) * g.weight, 0) / totalWeight
    : scored.reduce((s, g) => s + (g[side] as number), 0) / scored.length
  return Math.round(total * 10) / 10
}

/** The rating recorded when a review is completed: the manager's overall rating, else their goal scores, else the self-rating. */
export function deriveFinalRating(a: { managerRating?: number | null; selfRating?: number | null; goals: Goal[] }): number | null {
  if (isScore(a.managerRating)) return a.managerRating
  const fromGoals = weightedScore(a.goals, 'managerScore')
  if (fromGoals !== null) return Math.min(5, Math.max(1, Math.round(fromGoals)))
  return isScore(a.selfRating) ? a.selfRating : null
}

export interface Actor { employeeId?: string | null; isHr: boolean }
export interface AppraisalLike { employeeId: string; managerEmployeeId?: string | null; status: AppraisalStatus }

export const canSelfAssess = (a: AppraisalLike, who: Actor) => who.employeeId === a.employeeId && a.status === 'pending_self'
export const canManagerAssess = (a: AppraisalLike, who: Actor) =>
  a.status === 'pending_manager' && who.employeeId !== a.employeeId && (who.isHr || (!!who.employeeId && who.employeeId === a.managerEmployeeId))
export const canAcknowledge = (a: AppraisalLike & { employeeAckAt?: string | null }, who: Actor) =>
  a.status === 'completed' && who.employeeId === a.employeeId && !a.employeeAckAt
