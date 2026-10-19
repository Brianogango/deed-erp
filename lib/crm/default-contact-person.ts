/**
 * Which contact person to fill in when a company is chosen.
 *
 * The company's primary contact if one is marked; otherwise the only person
 * on file. With several people and no primary there is no honest default, so
 * the field is left for the user to choose.
 */
export interface DefaultablePerson {
  id: string
  companyId?: string
  clientId?: string
  isPrimary?: boolean
}

export function defaultContactPerson<T extends DefaultablePerson>(persons: readonly T[], companyId: string): T | null {
  if (!companyId) return null
  const mine = persons.filter(p => (p.companyId ?? p.clientId) === companyId || p.clientId === companyId)
  if (mine.length === 0) return null
  const primary = mine.filter(p => p.isPrimary)
  if (primary.length === 1) return primary[0]
  if (primary.length === 0 && mine.length === 1) return mine[0]
  return null
}
