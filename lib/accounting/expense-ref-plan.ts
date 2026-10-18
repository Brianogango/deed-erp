/**
 * Plan for claims that share one EXP number.
 *
 * EXP numbers used to come from each browser's own counter, and one browser
 * kept handing out the same number (EXP/0006 ended up on 28 claims). Every
 * expense journal is keyed on the claim's number, so only the first claim
 * under a number reached the books; the rest were skipped as "already
 * posted".
 *
 * Pure: works out which claim keeps each number, which get a new one, and
 * which journals each claim is still missing. Journals already posted are
 * never renamed or moved — a journal's id is derived from its ref — so a
 * claim that is renumbered keeps any journal it already owns under its old
 * number, and only what is missing is posted under the new one.
 */

export type PlanClaim = {
  id: string
  ref: string
  status: string
  amount: number
  paymentMethod?: string
  submittedByName?: string
  submittedDate?: string
  createdAt?: string
  expenseDate?: string
}

export type PlanJournal = {
  ref: string
  blobId?: string | null
  sourceId?: string | null
  totalDebit: number
  isReversed?: boolean
}

export type JournalKind = 'approval' | 'payment' | 'reimbursement'

export type ClaimPlan = {
  id: string
  ref: string
  newRef: boolean
  submittedByName?: string
  amount: number
  status: string
  expenseDate?: string
  /** Journals this claim already owns, by kind → journal ref. */
  owned: Partial<Record<JournalKind, string>>
  /** Journals the claim's status calls for that it does not own. */
  missing: JournalKind[]
  /** A journal was matched to this claim by number and position, not by id or amount. */
  uncertain?: boolean
}

export function journalKind(ref: string): { kind: JournalKind; claimRef: string } | null {
  if (ref.startsWith('JRN/EXPPAY/')) return { kind: 'payment', claimRef: ref.slice('JRN/EXPPAY/'.length) }
  if (ref.startsWith('JRN/RIM/')) return { kind: 'reimbursement', claimRef: ref.slice('JRN/RIM/'.length) }
  if (ref.startsWith('JRN/EXP/')) return { kind: 'approval', claimRef: ref.slice('JRN/EXP/'.length) }
  return null
}

/** The journals a claim in this status should have. */
export function requiredJournals(claim: Pick<PlanClaim, 'status' | 'paymentMethod'>): JournalKind[] {
  if (claim.status === 'approved') return ['approval']
  if (claim.status === 'paid') return ['approval', 'payment']
  if (claim.status === 'reimbursed') return ['approval', 'reimbursement']
  return []
}

const submittedAt = (c: PlanClaim) => String(c.submittedDate || c.createdAt || '')
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export function planExpenseRefRepair(claims: PlanClaim[], journals: PlanJournal[]): ClaimPlan[] {
  const byRef = new Map<string, PlanClaim[]>()
  for (const c of claims) {
    if (!c?.id || !c.ref) continue
    const list = byRef.get(c.ref) ?? []
    list.push(c)
    byRef.set(c.ref, list)
  }
  for (const list of byRef.values()) list.sort((a, b) => submittedAt(a).localeCompare(submittedAt(b)))

  const owned = new Map<string, Partial<Record<JournalKind, string>>>()
  const uncertain = new Set<string>()
  const own = (claimId: string, kind: JournalKind, ref: string) => {
    const o = owned.get(claimId) ?? {}
    o[kind] = ref
    owned.set(claimId, o)
  }
  const owns = (claimId: string, kind: JournalKind) => Boolean(owned.get(claimId)?.[kind])
  const claimIds = claims.map(c => c.id).filter(Boolean).sort((a, b) => b.length - a.length)

  // First pass: journals that name their claim (blob/source id starts with the claim id).
  const legacy: Array<{ j: PlanJournal; kind: JournalKind; claimRef: string }> = []
  for (const j of journals) {
    if (j.isReversed) continue
    const k = journalKind(j.ref)
    if (!k) continue
    const tag = `${j.blobId ?? ''} ${j.sourceId ?? ''}`
    const id = claimIds.find(cid => tag.split(' ').some(t => t.startsWith(cid)))
    if (id && !owns(id, k.kind)) own(id, k.kind, j.ref)
    else if (!id) legacy.push({ j, ...k })
  }

  // Second pass: older journals carry no claim id. Give each to a claim with
  // that number whose status calls for it and that has none of that kind —
  // same amount first, else the earliest such claim (flagged as uncertain).
  for (const { j, kind, claimRef } of legacy) {
    const candidates = (byRef.get(claimRef) ?? [])
      .filter(c => requiredJournals(c).includes(kind) && !owns(c.id, kind))
    const sameAmount = candidates.find(c => round2(c.amount) === round2(j.totalDebit))
    const pick = sameAmount ?? candidates[0]
    if (!pick) continue
    own(pick.id, kind, j.ref)
    if (!sameAmount) uncertain.add(pick.id)
  }

  const plans: ClaimPlan[] = []
  for (const [ref, list] of byRef) {
    // The claim that owns a journal under this number keeps it (approval
    // first); otherwise the earliest claim does.
    const keeper = list.find(c => owned.get(c.id)?.approval?.endsWith(`/${ref}`))
      ?? list.find(c => Object.values(owned.get(c.id) ?? {}).some(r => r?.endsWith(`/${ref}`)))
      ?? list[0]
    for (const c of list) {
      const o = owned.get(c.id) ?? {}
      plans.push({
        id: c.id,
        ref: c.ref,
        newRef: c.id !== keeper.id,
        submittedByName: c.submittedByName,
        amount: c.amount,
        status: c.status,
        expenseDate: c.expenseDate,
        owned: o,
        missing: requiredJournals(c).filter(k => !o[k]),
        uncertain: uncertain.has(c.id) || undefined,
      })
    }
  }
  return plans
}
