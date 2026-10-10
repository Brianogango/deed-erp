/** Which HR policies a person still has to read and accept. A policy changes version when it is edited. */

export interface PolicyLike { id: string; title: string; updatedAt: string; category?: string }
export interface AckLike { employeeId: string; policyId: string; policyVersion: string }

export const policyVersion = (p: Pick<PolicyLike, 'updatedAt'>) => String(p.updatedAt ?? '').slice(0, 40) || 'v1'

export function hasAcknowledged(acks: AckLike[], employeeId: string, p: PolicyLike): boolean {
  const v = policyVersion(p)
  return acks.some(a => a.employeeId === employeeId && a.policyId === p.id && a.policyVersion === v)
}

export function pendingPolicies<P extends PolicyLike>(policies: P[], acks: AckLike[], employeeId: string): P[] {
  return policies.filter(p => !hasAcknowledged(acks, employeeId, p))
}

export interface PolicyCoverage { policy: PolicyLike; acknowledged: number; total: number; missing: string[] }

/** Per policy: how many active employees accepted its current version, and who has not. */
export function policyCoverage(policies: PolicyLike[], acks: AckLike[], employees: Array<{ id: string; fullName: string; status?: string }>): PolicyCoverage[] {
  const active = employees.filter(e => e.status !== 'exited')
  return policies.map(policy => {
    const missing = active.filter(e => !hasAcknowledged(acks, e.id, policy)).map(e => e.fullName).sort()
    return { policy, acknowledged: active.length - missing.length, total: active.length, missing }
  })
}
